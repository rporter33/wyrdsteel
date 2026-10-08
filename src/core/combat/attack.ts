import type { ComboInput, ContentDb } from '../data/types';
import { BTN, type PlayerInput } from '../input/frame';
import type { Entity, PlayerSlot, World } from '../sim/types';
import { byId } from '../sim/entity';
import { msToTicks } from '../sim/constants';
import { norm } from '../math/vec';
import { startAction, canCancel } from '../sim/systems/actions';
import { coneTarget, lockCandidates, meleeCone, rangedCone, sideOf } from './targeting';
import { spawnShot } from './projectiles';
import { profile } from './hits';
import { unlockedAbilities } from '../progression/skills';

const ABILITY_BTNS = [BTN.ab1, BTN.ab2, BTN.ab3, BTN.ab4];
const CHAIN_GRACE = msToTicks(220);

/** Abilities bound to slots 1-4: the character's choices, else the first four unlocked. */
export function boundAbilities(p: PlayerSlot, db: ContentDb): string[] {
  if (p.character.abilities.length) return p.character.abilities.slice(0, 4);
  return unlockedAbilities(p.character, db).slice(0, 4);
}

function findNode(db: ContentDb, weapon: string, input: ComboInput, current: string, air: boolean) {
  const combo = db.weapons[weapon]?.combo ?? [];
  const neutral = air ? '@air' : '';
  return (
    (current && combo.find((n) => n.input === input && n.from.includes(current) && airOk(db, n.action, air))) ||
    combo.find((n) => n.input === input && n.from.includes(neutral))
  );
}

function airOk(db: ContentDb, action: string, air: boolean): boolean {
  return (db.actions[action]?.air ?? false) === air;
}

/** Melee strings, ranged fire, abilities, flask and lock-on for one player this tick. */
export function attackControl(
  w: World,
  db: ContentDb,
  p: PlayerSlot,
  e: Entity,
  inp: PlayerInput,
  aim: [number, number] | null,
  move: [number, number] | null,
): void {
  const pl = e.pl!;
  for (let i = 0; i < pl.cds.length; i++) if (pl.cds[i]! > 0) pl.cds[i]!--;
  if (pl.fireCd > 0) pl.fireCd--;
  const airborne = e.y > 0.3;

  // Hard lock: toggle, then cycle by side. Breaks on death or distance.
  const lockDir = aim ?? (move ? norm(move[0], move[1]) : [e.fx, e.fz]);
  if (inp.pressed & BTN.lock) {
    if (pl.lock) pl.lock = 0;
    else pl.lock = lockCandidates(w, e, lockDir[0], lockDir[1])[0]?.id ?? 0;
  }
  if (pl.lock && inp.pressed & (BTN.lockNext | BTN.lockPrev)) {
    const cur = byId(w, pl.lock);
    const cands = lockCandidates(w, e, e.fx, e.fz).filter((c) => c.id !== pl.lock);
    if (cur && cands.length) {
      const right = (inp.pressed & BTN.lockNext) !== 0;
      const sorted = cands.sort((a, b) => sideOf(e, a, e.fx, e.fz) - sideOf(e, b, e.fx, e.fz) || a.id - b.id);
      pl.lock = (right ? sorted[sorted.length - 1] : sorted[0])!.id;
    }
  }
  if (pl.lock) {
    const t = byId(w, pl.lock);
    if (!t || t.dead || (t.x - e.x) * (t.x - e.x) + (t.z - e.z) * (t.z - e.z) > 25 * 25) pl.lock = 0;
  }
  const locked = pl.lock ? byId(w, pl.lock) : null;

  const free = !e.act || canCancel(e, db);
  // Flask.
  if (inp.pressed & BTN.flask && pl.flasks > 0 && free && e.hp < e.hpMax) {
    pl.flasks--;
    const heal = Math.round(e.hpMax * p.stats.flaskHeal);
    e.hp = Math.min(e.hpMax, e.hp + heal);
    startAction(w, e, db.actions['flask.drink']!, e.fx, e.fz);
    w.events.push({ k: 'ability', t: w.tick, src: e.id, id: 'flask' });
    return;
  }

  // Direction an attack goes before assist: lock (if close), aim, movement, facing.
  const attackDir = (): [number, number] => {
    if (locked && (locked.x - e.x) * (locked.x - e.x) + (locked.z - e.z) * (locked.z - e.z) < 8 * 8) return norm(locked.x - e.x, locked.z - e.z, e.fx, e.fz);
    if (aim) return aim;
    if (move) return norm(move[0], move[1], e.fx, e.fz);
    return [e.fx, e.fz];
  };

  // Abilities.
  const abilities = boundAbilities(p, db);
  for (let i = 0; i < 4; i++) {
    if (!(inp.pressed & ABILITY_BTNS[i]!)) continue;
    const id = abilities[i];
    const def = id ? db.abilities[id] : null;
    if (!def || pl.cds[i]! > 0 || !free) continue;
    let [dx, dz] = attackDir();
    const t = coneTarget(w, e, dx, dz, meleeCone(p.assist), pl.soft);
    if (t && !aim) [dx, dz] = norm(t.x - e.x, t.z - e.z, dx, dz);
    startAction(w, e, db.actions[def.action]!, dx, dz, t?.id ?? 0, 'ability');
    pl.cds[i] = Math.round(def.cd * (1 - p.stats.cdr));
    pl.buffer = null;
    w.events.push({ k: 'ability', t: w.tick, src: e.id, id: def.id });
    return;
  }

  // Ruiner: spends a full meter.
  if (inp.pressed & BTN.ruiner && pl.ruin >= 100 && free) {
    const charm = p.character.equip.charm;
    const ruinerId = charm ? db.bases[charm.base]?.ruiner : null;
    const ruiner = ruinerId ? db.ruiners[ruinerId] : db.ruiners['ruiner.basic'];
    if (ruiner) {
      pl.ruin = 0;
      startAction(w, e, db.actions[ruiner.action]!, e.fx, e.fz, 0, 'ruiner');
      w.events.push({ k: 'ruiner', t: w.tick, src: e.id, id: ruiner.id });
      return;
    }
  }

  // Melee strings from the buffered press.
  if (pl.buffer && free && !(inp.held & BTN.fire)) {
    const current = e.act ? e.act.node : w.tick <= pl.chainUntil ? pl.chain : '';
    const node = findNode(db, p.stats.meleeKind, pl.buffer.input, current, airborne);
    if (node) {
      let [dx, dz] = attackDir();
      const t = locked && (locked.x - e.x) * (locked.x - e.x) + (locked.z - e.z) * (locked.z - e.z) < 6 * 6 ? locked : coneTarget(w, e, dx, dz, meleeCone(p.assist), pl.soft);
      pl.soft = t?.id ?? 0;
      if (t) [dx, dz] = norm(t.x - e.x, t.z - e.z, dx, dz);
      const def = db.actions[node.action]!;
      startAction(w, e, def, dx, dz, t?.id ?? 0, node.id);
      pl.chain = node.id;
      pl.chainUntil = w.tick + def.len + CHAIN_GRACE;
      pl.buffer = null;
      w.events.push({ k: 'swing', t: w.tick, src: e.id, action: def.id });
      return;
    }
  }

  // Ranged fire while held; precise aim narrows assist to almost nothing.
  const weapon = db.weapons[p.stats.rangedKind];
  if (inp.held & BTN.fire && weapon?.fire && !e.act && pl.fireCd === 0 && !airborne) {
    const precise = (inp.held & BTN.precise) !== 0;
    const pad = (inp.held & BTN.pad) !== 0;
    let [dx, dz] = locked && !precise ? norm(locked.x - e.x, locked.z - e.z, e.fx, e.fz) : (aim ?? [e.fx, e.fz]);
    // Magnetism only for sticks: a mouse is already precise, and nudging it feels like lag.
    if (!locked && pad && !precise) {
      const t = coneTarget(w, e, dx, dz, rangedCone(p.assist, false), pl.soft);
      pl.soft = t?.id ?? 0;
      if (t) [dx, dz] = norm(t.x - e.x, t.z - e.z, dx, dz);
    }
    e.fx = dx;
    e.fz = dz;
    const f = weapon.fire;
    const prof = profile(w, db, e, true);
    for (let i = 0; i < f.count; i++) {
      // Fan shots symmetrically: -1, +1, -2... times the spread step.
      const k = f.count === 1 ? 0 : (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) + (f.count % 2 === 0 ? 0.5 : 0);
      const c = k === 0 ? 1 : f.spreadCos;
      const s = k === 0 ? 0 : f.spreadSin * Math.sign(k);
      const sx = dx * c - dz * s;
      const sz = dx * s + dz * c;
      spawnShot(w, db, { owner: e, def: f.proj, x: e.x + sx * 0.6, z: e.z + sz * 0.6, y: 1.2, dx: sx, dz: sz, mult: 1, prof });
    }
    pl.fireCd = Math.max(1, Math.round(f.interval / p.stats.atkSpeed));
  }
}
