import type { AttackDef, ContentDb, EnemyDef } from '../data/types';
import type { Entity, World } from '../sim/types';
import { byId } from '../sim/entity';
import { msToTicks } from '../sim/constants';
import { nextInt, nextFloat } from '../rng/xoshiro';
import { norm } from '../math/vec';
import { startAction } from '../sim/systems/actions';
import { requestToken, releaseToken, flankPoint, TOKEN_HEAVY, TOKEN_MELEE, TOKEN_RANGED } from './director';
import { moveTo, moveAway, face, stop, speedOf, lineOfSight, dist } from './steer';
import { spawnEnemy } from '../sim/spawn';

const KIND_TOKEN = { melee: TOKEN_MELEE, ranged: TOKEN_RANGED, heavy: TOKEN_HEAVY } as const;

/** Nearest living player with line of sight (or any living player once aggroed). */
export function pickTarget(w: World, e: Entity, range: number): Entity | null {
  let best: Entity | null = null;
  let bd = Infinity;
  for (const p of w.entities) {
    if (p.kind !== 'player' || p.dead) continue;
    const d = dist(e, p);
    if (d > range && !e.ai!.aggro) continue;
    if (!e.ai!.aggro && !lineOfSight(w, e, p)) continue;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function cdScale(e: Entity): number {
  return (e.elite ?? []).includes('hasted') ? 0.7 : 1;
}

/** Choose an attack whose band contains the distance and whose cooldown is ready. */
function chooseAttack(w: World, e: Entity, def: EnemyDef, d: number): number {
  const ready: number[] = [];
  def.attacks.forEach((a, i) => {
    if (e.ai!.cds[i]! > 0 || d < a.min || d > a.max) return;
    if (a.needsPart && e.parts?.find((p) => p.id.startsWith(a.needsPart!) && p.broken)) return;
    ready.push(i);
  });
  if (!ready.length) return -1;
  const weights = ready.map((i) => def.attacks[i]!.weight);
  let total = 0;
  for (const x of weights) total += x;
  let r = nextFloat(w.rng.ai) * total;
  for (let k = 0; k < ready.length; k++) {
    r -= weights[k]!;
    if (r < 0) return ready[k]!;
  }
  return ready[ready.length - 1]!;
}

function attack(w: World, db: ContentDb, e: Entity, a: AttackDef, i: number, t: Entity): void {
  const ai = e.ai!;
  const [dx, dz] = norm(t.x - e.x, t.z - e.z, e.fx, e.fz);
  const act = db.actions[a.action]!;
  startAction(w, e, act, dx, dz, t.id, 'enemy');
  ai.cds[i] = Math.round(a.cd * cdScale(e));
  ai.gcd = Math.round(msToTicks(500) * cdScale(e));
  ai.st = 'attack';
  ai.t = 0;
  if (act.tele) {
    // Lobbed shots land about 0.7 s after release; the decal stays until then.
    const first = act.hits[0]?.from ?? (act.shoot ? act.shoot.at[0]! + 42 : act.dash?.from ?? 30);
    const at = act.hits[0]?.at === 'target' || act.tele.at === 'target';
    w.events.push({ k: 'telegraph', t: w.tick, src: e.id, shape: act.tele.shape, x: at ? e.act!.ax : e.x, z: at ? e.act!.az : e.z, r: act.tele.r, dx, dz, len: act.tele.r, width: act.tele.width, dur: first });
  }
}

/**
 * The shared fighter: approach, wait at a flank slot for an attack token, attack, recover. Ranged
 * fighters hold a distance band and back off when crowded. Archetype brains add their quirks.
 */
export function fighter(w: World, db: ContentDb, e: Entity, def: EnemyDef, t: Entity): void {
  const ai = e.ai!;
  const d = dist(e, t);
  const speed = speedOf(e, def.speed);
  if (ai.st === 'attack') {
    if (!e.act) {
      releaseToken(e);
      ai.st = 'recover';
      ai.t = 0;
    }
    return;
  }
  if (ai.st === 'recover') {
    stop(e);
    face(e, t.x, t.z, 0.12);
    if (++ai.t > msToTicks(350)) ai.st = 'chase';
    return;
  }
  const ranged = def.keep[0] > 2;
  // Kiters back off when a player closes in.
  if (ranged && d < def.keep[0] * 0.55) {
    moveAway(w, e, t.x, t.z, speed);
    face(e, t.x, t.z, 0.1);
    ai.st = 'kite';
    return;
  }
  const i = ai.gcd === 0 ? chooseAttack(w, e, def, d) : -1;
  if (i >= 0 && lineOfSight(w, e, t)) {
    const a = def.attacks[i]!;
    if (requestToken(w, e, KIND_TOKEN[a.kind])) {
      attack(w, db, e, a, i, t);
      return;
    }
  }
  if (ranged) {
    if (d > def.keep[1] || !lineOfSight(w, e, t)) moveTo(w, e, t.x, t.z, speed);
    else {
      // Strafe while in band so ranged enemies don't stand still.
      const [nx, nz] = norm(t.x - e.x, t.z - e.z, e.fx, e.fz);
      moveTo(w, e, e.x - nz * ai.side * 2, e.z + nx * ai.side * 2, speed * 0.5, false);
      if (nextInt(w.rng.ai, 180) === 0) ai.side = -ai.side;
    }
    face(e, t.x, t.z, 0.2);
    ai.st = 'chase';
    return;
  }
  // Melee without a token waits on a ring around the target, flankers behind it.
  if (d < 5.5 && ai.token === 0) {
    ai.st = 'wait';
    const [fx, fz] = flankPoint(w, e, t, 3.4, def.brain === 'thrall');
    moveTo(w, e, fx, fz, speed * 0.7, false);
    face(e, t.x, t.z, 0.2);
    return;
  }
  ai.st = 'chase';
  if (d > def.range * 0.85) moveTo(w, e, t.x, t.z, speed);
  else stop(e);
  face(e, t.x, t.z, def.weight === 'heavy' ? 0.06 : def.guard === 'front' ? 0.05 : 0.2);
}

/** Frostwright: a fighter that self-destructs when nearly dead, after a long, visible fuse. */
export function frostwright(w: World, db: ContentDb, e: Entity, def: EnemyDef, t: Entity): void {
  const ai = e.ai!;
  if (ai.st === 'fuse') {
    stop(e);
    if (++ai.t >= msToTicks(1500)) {
      startAction(w, e, db.actions['fw.burst']!, e.fx, e.fz, 0, 'enemy');
      ai.st = 'bursting';
    }
    return;
  }
  if (ai.st === 'bursting') {
    if (!e.act) e.hp = 0;
    return;
  }
  if (e.hp < e.hpMax * 0.25 && ai.c === 0) {
    ai.c = 1;
    ai.st = 'fuse';
    ai.t = 0;
    e.act = null;
    releaseToken(e);
    w.events.push({ k: 'telegraph', t: w.tick, src: e.id, shape: 'circle', x: e.x, z: e.z, r: 3.2, dx: 0, dz: 1, len: 3.2, width: 0, dur: msToTicks(1500) });
    return;
  }
  fighter(w, db, e, def, t);
}

/** Mender: keeps away from players and tethers the most hurt ally with a regenerating shield. */
export function mender(w: World, db: ContentDb, e: Entity, def: EnemyDef, t: Entity): void {
  const ai = e.ai!;
  const speed = speedOf(e, def.speed);
  let ally = ai.a ? byId(w, ai.a) : null;
  if (!ally || ally.dead || dist(e, ally) > 11 || e.stun > 0) {
    ai.a = 0;
    ally = null;
    let best = Infinity;
    for (const o of w.entities) {
      if (o === e || o.kind !== 'enemy' || o.dead || o.def === e.def || db.enemies[o.def]?.brain === 'dummy') continue;
      const d = dist(e, o);
      if (d > 10) continue;
      const score = o.hp / o.hpMax + d * 0.02;
      if (score < best) {
        best = score;
        ally = o;
      }
    }
    if (ally && e.stun === 0) ai.a = ally.id;
  }
  if (ally && ++ai.t >= msToTicks(3500)) {
    ai.t = 0;
    ally.shield = Math.min(Math.round(ally.hpMax * 0.5), ally.shield + Math.round(ally.hpMax * 0.3));
    w.events.push({ k: 'ability', t: w.tick, src: e.id, id: 'tether' });
  }
  const d = dist(e, t);
  if (d < 6) moveAway(w, e, t.x, t.z, speed);
  else if (ally && dist(e, ally) > 6) moveTo(w, e, ally.x, ally.z, speed);
  else if (!ally) fighter(w, db, e, def, t);
  else stop(e);
  face(e, t.x, t.z, 0.15);
}

/** Burrower: travels unseen and invulnerable, erupts under the target (cracks warn), then fights. */
export function burrower(w: World, db: ContentDb, e: Entity, def: EnemyDef, t: Entity): void {
  const ai = e.ai!;
  ai.t++;
  if (ai.st === 'idle' || ai.st === 'chase') {
    ai.st = 'burrowed';
    ai.t = 0;
  }
  switch (ai.st) {
    case 'burrowed':
    case 'travel': {
      ai.st = 'travel';
      moveTo(w, e, t.x, t.z, speedOf(e, def.speed * 1.4));
      if ((dist(e, t) < 2.2 || ai.t > msToTicks(3000)) && ai.gcd === 0) {
        e.vx = e.vz = 0;
        startAction(w, e, db.actions['burrower.erupt']!, e.fx, e.fz, t.id, 'enemy');
        const act = db.actions['burrower.erupt']!;
        w.events.push({ k: 'telegraph', t: w.tick, src: e.id, shape: 'circle', x: t.x, z: t.z, r: act.tele?.r ?? 2, dx: 0, dz: 1, len: 2, width: 0, dur: act.hits[0]!.from });
        ai.st = 'emerge';
        ai.t = 0;
      }
      return;
    }
    case 'emerge':
      if (!e.act) {
        ai.st = 'surface';
        ai.t = 0;
      } else if (e.act.t === (db.actions['burrower.erupt']!.hits[0]!.from) - 1) {
        // Surface at the eruption point.
        e.x = e.act.ax;
        e.z = e.act.az;
      }
      return;
    case 'surface':
      if (ai.t > msToTicks(4500) && !e.act) {
        releaseToken(e);
        ai.st = 'burrowed';
        ai.t = 0;
        ai.gcd = msToTicks(800);
        return;
      }
      fighter(w, db, e, def, t);
      if ((ai.st as string) !== 'attack' && (ai.st as string) !== 'recover') ai.st = 'surface';
      return;
    default:
      fighter(w, db, e, def, t);
      if (ai.st === 'chase' || ai.st === 'wait') ai.st = 'surface';
  }
}

/** Reinforcing elites call three thralls once, at half health. */
export function eliteHooks(w: World, db: ContentDb, e: Entity): void {
  const el = e.elite;
  if (!el) return;
  if (el.includes('reinforcing') && e.hp < e.hpMax * 0.5 && !(e.ai!.c & 2)) {
    e.ai!.c |= 2;
    for (let k = 0; k < 3; k++) {
      const s = spawnEnemy(w, db, 'thrall', e.x + (k - 1) * 1.4, e.z + 1.2, e.level, []);
      s.ai!.aggro = true;
      s.ai!.enc = e.ai!.enc;
    }
    w.events.push({ k: 'ability', t: w.tick, src: e.id, id: 'reinforce' });
  }
  if (el.includes('frostbound') && w.tick % 30 === 0) {
    for (const p of w.entities) {
      if (p.kind !== 'player' || p.dead) continue;
      if (dist(e, p) < 3) p.status.b[1] = Math.min(99, p.status.b[1]! + 12);
    }
  }
}
