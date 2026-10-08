import type { BossDef, BossPatternDef, ContentDb, EnemyDef } from '../data/types';
import type { BossComp, Entity, World } from '../sim/types';
import { msToTicks } from '../sim/constants';
import { nextFloat } from '../rng/xoshiro';
import { startAction } from '../sim/systems/actions';
import { fighter, strike } from './brains';
import { releaseToken, requestToken, TOKEN_HEAVY } from './director';
import { moveTo, face, stop, speedOf, dist } from './steer';
import { T_CRACKED, T_FLOOR, T_ICE } from '../level/grid';
import { interruptChannel } from './bossState';

/** Inside this, a player counts as fighting up close; beyond FAR, as keeping away. */
const NEAR = 5.5;
const FAR = 7;
const CRACK_WARN = msToTicks(2500);

function patternOf(bd: BossDef, id: string): BossPatternDef | undefined {
  return bd.patterns.find((p) => p.id === id);
}

/**
 * Count how each player fights: ticks close, ticks far, dodges. At the end of each span the boss
 * settles on a read of its target, and announces it when it changes.
 */
function observe(w: World, e: Entity, b: BossComp, bd: BossDef, t: Entity): void {
  for (const p of w.entities) {
    if (!p.pl || p.dead) continue;
    const d = dist(e, p);
    if (d < NEAR) p.pl.obsNear++;
    else if (d > FAR) p.pl.obsFar++;
  }
  if (++b.obsT < bd.span) return;
  b.obsT = 0;
  const read = readOf(t, bd.span);
  for (const p of w.entities) if (p.pl) p.pl.obsNear = p.pl.obsFar = p.pl.obsDodge = 0;
  if (read !== b.read) {
    b.read = read;
    w.events.push({ k: 'boss', t: w.tick, what: 'read', value: read });
  }
}

/** The habit a span of observations shows: dodging a lot, hugging, keeping away, or neither. */
export function readOf(t: Entity, span: number): string {
  const pl = t.pl;
  if (!pl) return 'mid';
  if (pl.obsDodge >= 3) return 'dodgy';
  if (pl.obsNear > span * 0.55) return 'close';
  if (pl.obsFar > span * 0.55) return 'far';
  return 'mid';
}

/**
 * Adaptive choice for phases 1 and 2: patterns that punish the current read weigh four times as
 * much, a pattern never runs three times in a row, and patterns that need distance are skipped
 * while the target is too close for them.
 */
export function choosePattern(w: World, bd: BossDef, b: BossComp, d: number, bulwarks: number): string {
  const h = b.history;
  const twice = h.length >= 2 && h[h.length - 1] === h[h.length - 2] ? h[h.length - 1] : '';
  const cands = bd.patterns.filter((p) => p.phases.includes(b.phase) && d >= p.min - 0.5 && p.id !== twice && !(p.id === 'summon' && bulwarks >= 2));
  if (!cands.length) return bd.patterns.find((p) => p.id !== twice)?.id ?? bd.patterns[0]!.id;
  const weights = cands.map((p) => (p.vs.includes(b.read) ? 4 : 1));
  let total = 0;
  for (const x of weights) total += x;
  let r = nextFloat(w.rng.ai) * total;
  for (let i = 0; i < cands.length; i++) {
    r -= weights[i]!;
    if (r < 0) return cands[i]!.id;
  }
  return cands[cands.length - 1]!.id;
}

/** Floor tiles beyond radius r of the arena centre crack now and fall into the spring shortly after. */
export function collapseArena(w: World, b: BossComp, r: number): void {
  const room = w.room;
  let any = false;
  for (let tz = 0; tz < room.h; tz++) {
    for (let tx = 0; tx < room.w; tx++) {
      const i = tz * room.w + tx;
      const tile = room.tiles[i]!;
      if (tile !== T_FLOOR && tile !== T_ICE) continue;
      const dx = tx + 0.5 - b.cx;
      const dz = tz + 0.5 - b.cz;
      if (dx * dx + dz * dz <= r * r) continue;
      room.tiles[i] = T_CRACKED;
      room.features.push({ kind: 'crack', x: tx + 0.5, z: tz + 0.5, a: CRACK_WARN, b: 0, id: '', dir: 0 });
      any = true;
    }
  }
  if (any) {
    room.ver++;
    w.events.push({ k: 'boss', t: w.tick, what: 'collapse', value: String(r) });
  }
}

function vent(w: World, db: ContentDb, e: Entity, b: BossComp): void {
  const act = db.actions['hr.vent']!;
  releaseToken(e);
  startAction(w, e, act, e.fx, e.fz, 0, 'enemy');
  e.ai!.st = 'vent';
  b.exposed = act.len;
  b.heat = 0;
  w.events.push({ k: 'boss', t: w.tick, what: 'exposed', value: '' });
}

function beginPhase(w: World, db: ContentDb, e: Entity, bd: BossDef, b: BossComp, phase: number, t: Entity): void {
  b.phase = phase;
  b.floor = phase <= bd.phases.length ? Math.round(e.hpMax * bd.phases[phase - 1]!) : 0;
  b.invuln = bd.transition;
  b.heat = 0;
  b.exposed = 0;
  b.history = [];
  releaseToken(e);
  e.act = null;
  strike(w, db, e, 'hr.roar', t);
  e.ai!.st = 'transition';
  w.events.push({ k: 'boss', t: w.tick, what: 'phase', value: String(phase) });
  if (phase === 2) {
    // The guardian's clay gives out, and the plates it kept are gone with it.
    for (const o of w.entities) if (o.def === bd.guardian && !o.dead) o.hp = 0;
    b.plating = 0;
    b.platingMax = 0;
  }
  if (phase === bd.phases.length + 1 && bd.arena.length) {
    collapseArena(w, b, bd.arena[0]!);
    b.collapse = 1;
    b.seq = 0;
  }
}

/**
 * Hrungnir. Phase 1: plated, mended by its guardian. Phase 2: adapts to how its target fights and
 * overheats every few patterns, exposing its heart. Phase 3: the arena shrinks and it runs a fixed,
 * learnable sequence. Phase floors mean no burst can skip a phase; each change is a short,
 * invulnerable roar.
 */
export function hrungnir(w: World, db: ContentDb, e: Entity, def: EnemyDef, t: Entity): void {
  const ai = e.ai!;
  const b = e.boss!;
  const bd = db.bosses[e.def]!;
  if (ai.st === 'idle') {
    const enc = w.room.encounters[ai.enc];
    if (enc) {
      b.cx = enc.x;
      b.cz = enc.z;
    }
    for (const p of w.entities) if (p.pl) p.pl.obsNear = p.pl.obsFar = p.pl.obsDodge = 0;
    w.events.push({ k: 'boss', t: w.tick, what: 'phase', value: '1' });
    ai.st = 'pick';
  }
  if (b.invuln > 0) b.invuln--;
  if (b.exposed > 0) b.exposed--;
  observe(w, e, b, bd, t);
  if (b.phase <= bd.phases.length && e.hp <= b.floor && ai.st !== 'transition') {
    beginPhase(w, db, e, bd, b, b.phase + 1, t);
    return;
  }
  // The last phase's second collapse comes at half of what is left.
  const last = bd.phases[bd.phases.length - 1] ?? 0;
  if (b.phase > bd.phases.length && b.collapse < bd.arena.length && e.hp < e.hpMax * last * 0.5) {
    collapseArena(w, b, bd.arena[b.collapse]!);
    b.collapse++;
  }
  const d = dist(e, t);
  switch (ai.st) {
    case 'transition':
      if (!e.act && b.invuln === 0) ai.st = 'pick';
      return;
    case 'vent':
      stop(e);
      if (!e.act) {
        b.exposed = 0;
        ai.st = 'pick';
      }
      return;
    case 'attack': {
      if (e.act) return;
      const pat = patternOf(bd, b.pattern);
      b.step++;
      if (pat && b.step < pat.actions.length) {
        strike(w, db, e, pat.actions[b.step]!, t);
        return;
      }
      releaseToken(e);
      ai.st = 'recover';
      ai.t = 0;
      return;
    }
    case 'recover':
      stop(e);
      face(e, t.x, t.z, 0.05);
      if (++ai.t < msToTicks(b.phase > bd.phases.length ? 450 : 700)) return;
      b.heat++;
      if (b.phase === 2 && b.heat >= bd.overheat) {
        vent(w, db, e, b);
        return;
      }
      ai.st = 'pick';
      return;
    case 'pick': {
      let id: string;
      if (b.phase > bd.phases.length) {
        id = bd.final[b.seq % bd.final.length]!;
        b.seq++;
      } else {
        const bulwarks = w.entities.filter((o) => o.def === 'bulwark' && !o.dead).length;
        id = choosePattern(w, bd, b, d, bulwarks);
      }
      if (id === 'overheat') {
        vent(w, db, e, b);
        return;
      }
      b.pattern = id;
      b.step = 0;
      b.history.push(id);
      if (b.history.length > 4) b.history.shift();
      w.events.push({ k: 'boss', t: w.tick, what: 'pattern', value: id });
      ai.st = 'chase';
      ai.t = 0;
      break;
    }
  }
  // Chase: walk into the pattern's band (never for long), then start it once the heavy token is free.
  const pat = patternOf(bd, b.pattern);
  if (!pat) {
    ai.st = 'pick';
    return;
  }
  ai.t++;
  face(e, t.x, t.z, 0.08);
  if (d > pat.max && ai.t < msToTicks(4000)) {
    moveTo(w, e, t.x, t.z, speedOf(e, def.speed));
    return;
  }
  stop(e);
  if (!requestToken(w, e, TOKEN_HEAVY)) return;
  b.step = 0;
  strike(w, db, e, pat.actions[0]!, t);
}

/**
 * Mökkurkálfi: fights like any heavy, but every so often stops to mend its master's plates. The
 * channel is long and tethered; stagger it or hurt it enough and the spell breaks.
 */
export function guardian(w: World, db: ContentDb, e: Entity, def: EnemyDef, t: Entity): void {
  const ai = e.ai!;
  const master = w.entities.find((o) => o.boss && !o.dead && db.bosses[o.def]?.guardian === e.def) ?? null;
  const bd = master ? db.bosses[master.def]! : null;
  if (ai.st === 'channel') {
    if (!master || !bd) {
      ai.st = 'recover';
      e.act = null;
      return;
    }
    stop(e);
    face(e, master.x, master.z, 0.2);
    if (ai.b - e.hp >= e.hpMax * 0.08) {
      interruptChannel(w, e);
      return;
    }
    if (++ai.t >= bd.channel) {
      master.boss!.plating = master.boss!.platingMax;
      w.events.push({ k: 'boss', t: w.tick, what: 'plated', value: '' });
      e.act = null;
      ai.st = 'recover';
      ai.t = 0;
    }
    return;
  }
  if (master && bd && master.boss!.platingMax > 0) {
    ai.c++;
    if (ai.c >= bd.replate && master.boss!.plating < master.boss!.platingMax && !e.act) {
      releaseToken(e);
      ai.st = 'channel';
      ai.t = 0;
      ai.b = e.hp;
      ai.c = 0;
      ai.a = master.id;
      startAction(w, e, db.actions['mk.channel']!, e.fx, e.fz, 0, 'enemy');
      w.events.push({ k: 'boss', t: w.tick, what: 'channel', value: '' });
      return;
    }
  }
  fighter(w, db, e, def, t);
}

/** When the boss falls, whatever it summoned crumbles with it. */
export function onBossDeath(w: World, e: Entity): void {
  w.events.push({ k: 'boss', t: w.tick, what: 'defeated', value: e.def });
  for (const o of w.entities) if (o !== e && o.kind === 'enemy' && !o.dead && o.ai?.enc === e.ai?.enc) o.hp = 0;
}
