import type { ContentDb, HitDef } from '../data/types';
import type { Entity, Profile, StatusId, World } from '../sim/types';
export type { Profile };
import { byId } from '../sim/entity';
import { nextFloat } from '../rng/xoshiro';
import { computeDamage, juggleLift } from './damage';
import { addBuildup } from './status';
import { msToTicks } from '../sim/constants';
import { shielded, crackIce } from '../level/hazards';
import { interruptChannel } from '../ai/bossState';
import { modMult } from '../level/trials';

/** Bits recorded on the victim describing how the killing blow landed (charm quests read them). */
export const HOW_AIR = 1;
export const HOW_BEHIND = 2;
export const HOW_STATUS = 4;
export const HOW_WEAK = 8;
export const HOW_RANGED = 16;

const DIFF_DMG = [0.6, 1, 1.35];
const DIFF_HP = [0.75, 1, 1.3];
export function difficultyHp(w: World): number {
  return DIFF_HP[w.difficulty]!;
}

/** What an attacker brings to a hit: rolled weapon damage plus every additive bonus. */
export function profile(w: World, db: ContentDb, src: Entity, ranged: boolean): Profile {
  if (src.kind === 'player' && src.pl) {
    const p = w.players[src.pl.slot]!;
    const s = p.stats;
    const [lo, hi] = ranged ? s.ranged : s.melee;
    const base = lo + nextFloat(w.rng.combat) * (hi - lo);
    const hpFrac = src.hp / src.hpMax;
    let pct = s.dmgPct + (ranged ? s.rangedPct : s.meleePct) + s.lowHpPct * (1 - hpFrac);
    if (src.pl.buffUntil > w.tick) pct += src.pl.buffDmg;
    return {
      base,
      pct,
      critChance: s.critChance,
      critMult: s.critMult,
      poiseMult: s.poiseMult,
      statusPct: s.statusPct,
      lifesteal: s.lifesteal,
      level: src.level,
      onHit: s.onHit,
      weakPct: s.weakPct,
      airPct: s.airPct,
      ruinGain: s.ruinGain,
    };
  }
  const def = db.enemies[src.def];
  const lvl = src.level;
  let base = def ? def.dmg + def.dmgPerLevel * (lvl - 1) : 10;
  base *= DIFF_DMG[w.difficulty]!;
  for (const el of src.elite ?? []) base *= db.elites[el]?.dmgMult ?? 1;
  if (w.zone.trial) base *= modMult(w, db, 'dmgMult');
  const onHit: Profile['onHit'] = (src.elite ?? []).includes('frostbound') ? [{ k: 'chill', amt: 30 }] : [];
  return { base, pct: 0, critChance: 0, critMult: 1, poiseMult: 1, statusPct: 0, lifesteal: 0, level: lvl, onHit, weakPct: 0, airPct: 0, ruinGain: 0 };
}

export interface HitSpec {
  src: Entity;
  /** Direction the blow travels (attacker toward target). */
  dx: number;
  dz: number;
  hit: Pick<HitDef, 'dmg' | 'poise' | 'launch' | 'knock' | 'down' | 'stop' | 'status' | 'guardBreak' | 'tag' | 'cap'>;
  ranged: boolean;
  /** Where the blow lands, for weak-point selection. */
  px: number;
  pz: number;
  prof: Profile;
}

export type HitResult = 'hit' | 'blocked' | 'dodged' | 'immune';

function partWorld(t: Entity, fwd: number, right: number): [number, number] {
  return [t.x + t.fx * fwd + t.fz * right, t.z + t.fz * fwd - t.fx * right];
}

/** Resolve one blow against one target: guard, weak points, damage, poise, launch, statuses. */
export function applyHit(w: World, db: ContentDb, h: HitSpec, t: Entity): HitResult {
  const src = h.src;
  if (t.dead) return 'immune';
  if (t.boss && t.boss.invuln > 0) {
    w.events.push({ k: 'immune', t: w.tick, dst: t.id });
    return 'immune';
  }
  if (t.ai && (t.ai.st === 'burrowed' || t.ai.st === 'travel')) return 'immune';
  if (t.iframes > 0) {
    // Perfect dodge: the hit arrives in the first moments of a dodge's i-frames.
    if (t.pl && t.act && t.act.id.startsWith('dodge') && t.act.t <= 12 && t.pl.empowered < w.tick) {
      t.pl.empowered = w.tick + msToTicks(2000);
      t.pl.dodges = Math.min(t.pl.dodges + 1, w.players[t.pl.slot]!.stats.dodgeCharges);
      w.events.push({ k: 'dodge', t: w.tick, src: t.id, perfect: true });
    }
    return 'dodged';
  }
  const tdef = t.kind === 'enemy' ? db.enemies[t.def] : null;
  let wyrdMarkOnly = false;
  if (shielded(w, t)) {
    w.events.push({ k: 'immune', t: w.tick, dst: t.id });
    return 'immune';
  }
  // Well of Wyrd, rule of the mark: only foes already suffering a status can be hurt.
  if (w.room.rule === 'status' && t.kind === 'enemy') {
    const st = t.status;
    const marked = st.burn > 0 || st.chill > 0 || st.freeze > 0 || st.root > 0 || st.shock > 0;
    if (!marked && !h.hit.status && !h.prof.onHit.length) {
      w.events.push({ k: 'immune', t: w.tick, dst: t.id });
      return 'immune';
    }
    if (!marked) wyrdMarkOnly = true;
  }
  // Well of Wyrd, rule of the air: grounded foes shrug off everything but the blow that lifts them.
  let wyrdZero = false;
  if (w.room.rule === 'air' && t.kind === 'enemy' && t.y < 0.3) {
    if (h.hit.tag !== 'launcher' && h.hit.launch <= 0) {
      w.events.push({ k: 'immune', t: w.tick, dst: t.id });
      return 'immune';
    }
    wyrdZero = true;
  }
  const fromFront = t.fx * -h.dx + t.fz * -h.dz > 0.35;
  const behind = t.fx * -h.dx + t.fz * -h.dz < -0.3;

  // Front guard (shield bearers): blocks light blows and projectiles from the front.
  const guarding = tdef?.guard === 'front' && t.stun === 0 && t.status.freeze === 0 && !(t.elite ?? []).includes('broken');
  if (guarding && fromFront && !h.hit.guardBreak && (h.hit.tag === 'light' || h.hit.tag === 'air' || h.ranged)) {
    t.poise -= h.hit.poise * 0.35 * h.prof.poiseMult;
    src.hitstop = Math.max(src.hitstop, 4);
    w.events.push({ k: 'hit', t: w.tick, src: src.id, dst: t.id, dmg: 0, crit: false, weak: false, x: t.x, y: t.y + 1.2, z: t.z, heavy: false });
    if (t.poise <= 0) breakPoise(w, t, tdef?.weight ?? 'medium');
    return 'blocked';
  }

  // Weak points: the part nearest the strike point, if the strike reaches it.
  let weak = 1;
  let partHit = -1;
  if (t.parts && t.parts.length && tdef && h.hit.tag !== 'finisher') {
    let bestD = Infinity;
    tdef.parts.forEach((pd, i) => {
      const [x, z] = partWorld(t, pd.fwd, pd.right);
      const d = (x - h.px) * (x - h.px) + (z - h.pz) * (z - h.pz);
      if (d < (pd.r + 0.9) * (pd.r + 0.9) && d < bestD) {
        bestD = d;
        partHit = i;
      }
    });
    if (partHit >= 0) {
      const pd = tdef.parts[partHit]!;
      const ps = t.parts[partHit]!;
      weak = ps.broken ? 1 : pd.weak * (1 + h.prof.weakPct);
    }
  }
  if (t.boss && t.boss.exposed > 0) weak = Math.max(weak, 1.8 * (1 + h.prof.weakPct));

  const crit = h.prof.critChance > 0 && nextFloat(w.rng.combat) < h.prof.critChance;
  const airborne = t.y > 0.3;
  let pct = h.prof.pct + (airborne ? h.prof.airPct : 0);
  let mult = h.hit.dmg;
  if (src.pl && src.pl.empowered > w.tick) {
    mult *= 1.5;
    src.pl.empowered = -1;
  }
  if (behind && src.kind === 'player') pct += 0.15;
  // Inferno capstone: burning targets take more from this attacker.
  const ownerSlot = src.pl ? w.players[src.pl.slot] : null;
  if (ownerSlot?.stats.flags.includes('cap.inferno') && t.status.burn > 0) pct += 0.2;
  let armor = t.kind === 'player' ? w.players[t.pl!.slot]!.stats.armor : (tdef?.armor ?? 0);
  const taken = t.kind === 'player' ? w.players[t.pl!.slot]!.stats.dmgTakenPct : t.status.freeze > 0 ? 0.25 : 0;
  // Under the rule of the mark, an unmarked foe only takes the status, not the damage.
  if (wyrdZero || wyrdMarkOnly) mult = 0;
  const finisher = h.hit.tag === 'finisher';
  // The finishing blow ends the kneel: the troll gets up, legs still broken.
  if (finisher) t.stun = Math.min(t.stun, 30);
  const dmg = finisher ? Math.round(t.hpMax * (t.boss ? 0.08 : 0.35)) : wyrdZero || wyrdMarkOnly ? 0 : computeDamage({
    base: h.prof.base,
    mult,
    pct,
    crit,
    critMult: h.prof.critMult,
    weak,
    airborne,
    armor,
    attackerLevel: h.prof.level,
    cap: t.kind === 'player' ? h.hit.cap : 0,
    targetHpMax: t.hpMax,
    taken,
  });
  let absorbed = 0;
  if (t.shield > 0) {
    absorbed = Math.min(t.shield, dmg);
    t.shield -= absorbed;
  }
  let toHp = dmg - absorbed;
  // Stone hide: shots chip a boss until its heart is exposed; then everything lands in full.
  if (t.boss && h.ranged && t.boss.exposed === 0) toHp = Math.max(1, Math.round(toHp * (db.bosses[t.def]?.rangedTaken ?? 1)));
  // Boss plating takes the blow; only a fraction bleeds through until the plates break.
  if (t.boss && t.boss.plating > 0 && toHp > 0) {
    const into = Math.min(t.boss.plating, toHp);
    t.boss.plating -= into;
    toHp -= Math.round(into * (1 - (db.bosses[t.def]?.bleed ?? 0.25)));
    if (t.boss.plating <= 0) w.events.push({ k: 'boss', t: w.tick, what: 'broken', value: '' });
  }
  t.hp -= toHp;
  if (t.boss && t.hp < t.boss.floor) t.hp = t.boss.floor;
  t.hurtAt = w.tick;
  // Linked elites share one life: damage to either lands on both.
  if (t.ai?.link) {
    const partner = byId(w, t.ai.link);
    if (partner && !partner.dead) {
      partner.hp -= dmg - absorbed;
      partner.hurtAt = w.tick;
    }
  }
  t.lastHit = src.kind === 'projectile' && src.proj ? src.proj.owner : src.id;
  t.lastHow = (airborne ? HOW_AIR : 0) | (behind ? HOW_BEHIND : 0) | (t.status.burn || t.status.chill || t.status.freeze || t.status.root ? HOW_STATUS : 0) | (weak > 1 ? HOW_WEAK : 0) | (h.ranged ? HOW_RANGED : 0);
  if (t.pl) {
    t.pl.dmgTaken += dmg;
    t.pl.maxHitFrac = Math.max(t.pl.maxHitFrac, dmg / t.hpMax);
  }

  if (partHit >= 0 && t.parts && tdef) {
    const ps = t.parts[partHit]!;
    if (!ps.broken) {
      ps.hp -= dmg;
      if (ps.hp <= 0) {
        ps.broken = true;
        w.events.push({ k: 'partBreak', t: w.tick, dst: t.id, part: ps.id });
        const eff = tdef.parts[partHit]!.effect;
        if (eff === 'kneel') {
          t.stun = Math.max(t.stun, msToTicks(3500));
          t.stunKind = 2;
          t.act = null;
        }
      }
    }
  }

  // Attacker sustain and ruin.
  const owner = src.kind === 'projectile' && src.proj ? byId(w, src.proj.owner) : src;
  if (owner && owner.pl) {
    if (h.prof.lifesteal > 0) owner.hp = Math.min(owner.hpMax, owner.hp + Math.round(dmg * h.prof.lifesteal));
    owner.pl.ruin = Math.min(100, owner.pl.ruin + 2.5 * h.prof.ruinGain);
    owner.pl.dealt += dmg;
  }

  // Poise, launch, knockback.
  const weight = t.kind === 'player' ? 'medium' : (tdef?.weight ?? 'light');
  const armored = t.armorT > 0 || (t.boss !== undefined);
  if (!armored) t.poise -= h.hit.poise * h.prof.poiseMult;
  const canLaunch = weight !== 'heavy' && t.kind !== 'player' && !armored;
  if (h.hit.launch > 0 && canLaunch) {
    const lift = juggleLift(h.hit.launch, t.juggle);
    if (lift > 1) {
      t.vy = Math.max(t.vy, lift);
      if (t.y < 0.05) t.y = 0.05;
      t.juggle++;
      t.stun = Math.max(t.stun, 8);
      t.stunKind = Math.max(t.stunKind, 2);
      t.act = null;
      if (t.juggle === 1) w.events.push({ k: 'launch', t: w.tick, dst: t.id });
    }
  } else if (airborne && canLaunch && t.juggle > 0) {
    // Air hits without lift still hold the target up a little.
    t.vy = Math.max(t.vy, juggleLift(3, t.juggle));
    t.juggle++;
  }
  if (h.hit.down && airborne && canLaunch) t.vy = Math.min(t.vy, -24);
  if (h.hit.knock > 0 && weight !== 'heavy' && !armored) {
    const k = weight === 'medium' ? h.hit.knock * 0.6 : h.hit.knock;
    t.vx += h.dx * k;
    t.vz += h.dz * k;
  }
  if (t.poise <= 0 && !armored) breakPoise(w, t, weight);

  // Statuses: the blow's own, plus the attacker's on-hit runes.
  const warded = (t.elite ?? []).includes('warded');
  const resist = (k: StatusId) => (warded ? 1 : (tdef?.resist[k] ?? 0) + (t.kind === 'player' ? 0.2 : 0));
  const applied: (StatusId | 'freeze')[] = [];
  const boss = !!t.boss || weight === 'heavy';
  if (h.hit.status) {
    const r = addBuildup(w, t, h.hit.status.k, h.hit.status.amt * (1 + h.prof.statusPct), resist(h.hit.status.k), boss);
    if (r) applied.push(r);
  }
  for (const oh of h.prof.onHit) {
    const r = addBuildup(w, t, oh.k, oh.amt * (1 + h.prof.statusPct), resist(oh.k), boss);
    if (r) applied.push(r);
  }
  // A heavy blow shatters a frozen target for bonus damage.
  if (t.status.freeze > 0 && (h.hit.tag === 'heavy' || h.hit.guardBreak) && !applied.includes('freeze')) {
    const bonus = Math.round(dmg * 0.75);
    t.hp -= bonus;
    t.status.freeze = 0;
    w.events.push({ k: 'shatter', t: w.tick, dst: t.id });
  }
  for (const a of applied) {
    w.events.push({ k: 'status', t: w.tick, dst: t.id, status: a });
    if (a === 'shock') chainShock(w, db, src, t, h);
  }

  t.hitstop = Math.max(t.hitstop, h.hit.stop);
  w.events.push({ k: 'hit', t: w.tick, src: owner?.id ?? src.id, dst: t.id, dmg, crit, weak: weak > 1, x: h.px, y: t.y + t.h * 0.6, z: h.pz, heavy: h.hit.tag === 'heavy' || h.hit.tag === 'launcher' || h.hit.tag === 'finisher', status: applied[0] === 'freeze' ? undefined : (applied[0] as StatusId | undefined) });
  return 'hit';
}

function breakPoise(w: World, t: Entity, weight: string): void {
  t.poise = t.poiseMax;
  // Breaking a Warded elite's poise strips the ward.
  if (t.elite?.includes('warded')) t.elite = t.elite.filter((x) => x !== 'warded');
  t.poiseAt = w.tick + msToTicks(1500);
  // Heavies shrug off staggers, except mid-channel: that is what breaks a guardian's spell.
  if (t.ai?.st === 'channel') {
    interruptChannel(w, t);
    return;
  }
  if (weight === 'heavy' || t.boss) return;
  const down = weight === 'medium' && t.kind !== 'player';
  t.stun = Math.max(t.stun, down ? msToTicks(1200) : msToTicks(t.kind === 'player' ? 300 : 450));
  t.stunKind = down ? 2 : 1;
  t.act = null;
  w.events.push({ k: 'stagger', t: w.tick, dst: t.id, down });
}

/** Shock arcs to the two nearest enemies within 4 m of the struck target. */
function chainShock(w: World, db: ContentDb, src: Entity, t: Entity, h: HitSpec): void {
  const near: Entity[] = [];
  for (const e of w.entities) {
    if (e === t || e.dead || e.team !== t.team || (e.kind !== 'enemy' && e.kind !== 'player')) continue;
    const d = (e.x - t.x) * (e.x - t.x) + (e.z - t.z) * (e.z - t.z);
    if (d < 16) near.push(e);
  }
  near.sort((a, b) => (a.x - t.x) * (a.x - t.x) + (a.z - t.z) * (a.z - t.z) - ((b.x - t.x) * (b.x - t.x) + (b.z - t.z) * (b.z - t.z)) || a.id - b.id);
  for (const e of near.slice(0, 2)) {
    const prof = { ...h.prof, base: h.prof.base * 0.5, onHit: [] };
    applyHit(w, db, { src, dx: e.x - t.x, dz: e.z - t.z, hit: { ...h.hit, status: null, launch: 0, knock: 0, stop: 2, tag: 'ability' }, ranged: true, px: e.x, pz: e.z, prof }, e);
  }
}

/** Melee and ability hit windows of every running action, resolved against every hostile body. */
export function hitSystem(w: World, db: ContentDb): void {
  for (const a of w.entities) {
    if (a.dead || !a.act || a.hitstop > 0 || a.kind === 'projectile') continue;
    const def = db.actions[a.act.id];
    if (!def || !def.hits.length) continue;
    let landed = false;
    def.hits.forEach((hd, hi) => {
      if (a.act!.t < hd.from || a.act!.t > hd.to) return;
      let prof: Profile | null = null;
      for (const t of w.entities) {
        if (t === a || t.dead || t.team === a.team || t.team === 2) continue;
        if (t.kind !== 'enemy' && t.kind !== 'player') continue;
        const key = hi * 1_000_000 + t.id;
        if (a.act!.hit.includes(key)) continue;
        if (!inShape(a, t, hd)) continue;
        a.act!.hit.push(key);
        prof ??= profile(w, db, a, false);
        const vx = t.x - a.x;
        const vz = t.z - a.z;
        const d = Math.sqrt(vx * vx + vz * vz);
        const dx = d > 1e-6 ? vx / d : a.act!.dx;
        const dz = d > 1e-6 ? vz / d : a.act!.dz;
        const px = a.x + dx * Math.min(d, hd.range * 0.7);
        const pz = a.z + dz * Math.min(d, hd.range * 0.7);
        const r = applyHit(w, db, { src: a, dx, dz, hit: hd, ranged: false, px, pz, prof }, t);
        if (r === 'hit') landed = true;
        if (r === 'hit' && (hd.tag === 'heavy' || hd.down) && hd.poise >= 40) crackIce(w, t.x, t.z, 1.6);
      }
      if (landed) a.hitstop = Math.max(a.hitstop, hd.stop);
    });
  }
}

/** Does hit window hd, from attacker a, touch target t? Shapes live on the ground plane plus a height band. */
export function inShape(a: Entity, t: Entity, hd: HitDef): boolean {
  const ay0 = a.y + hd.yMin;
  const ay1 = a.y + hd.yMax;
  if (t.y > ay1 || t.y + t.h < ay0) return false;
  const fx = a.act ? a.act.dx : a.fx;
  const fz = a.act ? a.act.dz : a.fz;
  const vx = t.x - a.x;
  const vz = t.z - a.z;
  if (hd.shape === 'circle') {
    const cx = hd.at === 'target' && a.act ? a.act.ax : a.x + fx * hd.offset;
    const cz = hd.at === 'target' && a.act ? a.act.az : a.z + fz * hd.offset;
    const dx = t.x - cx;
    const dz = t.z - cz;
    const r = hd.range + t.r;
    return dx * dx + dz * dz <= r * r;
  }
  if (hd.shape === 'line') {
    const along = vx * fx + vz * fz;
    if (along < -t.r || along > hd.range + t.r) return false;
    const across = Math.abs(vx * -fz + vz * fx);
    return across <= hd.width / 2 + t.r;
  }
  const d = Math.sqrt(vx * vx + vz * vz);
  if (d - t.r > hd.range) return false;
  if (d < a.r + t.r + 0.3) return true;
  return (vx * fx + vz * fz) / d >= hd.cosArc;
}
