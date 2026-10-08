import { DT, GRAVITY } from '../sim/constants';
import type { ContentDb } from '../data/types';
import type { Entity, World } from '../sim/types';
import { newEntity, byId } from '../sim/entity';
import { segmentBlocked } from '../level/grid';
import { rotateToward, norm } from '../math/vec';
import { applyHit, profile, type Profile } from './hits';

export interface ShotSpec {
  owner: Entity;
  def: string;
  x: number;
  z: number;
  y: number;
  dx: number;
  dz: number;
  /** Damage multiplier on the owner's ranged roll (enemies: on their base damage). */
  mult: number;
  /** For arcing shots: distance to the landing point. */
  arcDist?: number;
  prof?: Profile;
}

/** Spawn a projectile. Its owner's damage profile is rolled at fire time and carried with it. */
export function spawnShot(w: World, db: ContentDb, s: ShotSpec): Entity {
  const def = db.projectiles[s.def]!;
  const p = newEntity(w, 'projectile', s.def, s.owner.team, s.x, s.z);
  p.y = p.py = s.y;
  p.r = def.radius;
  p.h = 0.2;
  p.vx = s.dx * def.speed;
  p.vz = s.dz * def.speed;
  p.fx = s.dx;
  p.fz = s.dz;
  let arc = 0;
  if (s.arcDist !== undefined && def.gravity > 0) {
    // Lob so it lands at the aim point: flight time T = d / v, launch vy = g T / 2.
    const T = Math.max(0.2, s.arcDist / def.speed);
    p.vy = (GRAVITY * def.gravity * T) / 2;
    arc = 1;
  }
  const prof = s.prof ?? profile(w, db, s.owner, true);
  p.proj = {
    owner: s.owner.id,
    prof: { ...prof, base: prof.base * s.mult },
    dmg: prof.base * s.mult,
    poise: def.poise,
    life: def.life,
    pierce: def.pierce,
    hit: [],
    status: def.status,
    homing: def.homing,
    aoe: def.aoe,
    launch: def.launch,
    stop: def.stop,
    crit: 0,
    arc,
  };
  w.events.push({ k: 'shoot', t: w.tick, src: s.owner.id, weapon: s.def });
  return p;
}

/** The damage profile rolled at fire time travels with the shot (its owner may be gone by impact). */
function profOf(p: Entity): Profile {
  return p.proj!.prof;
}

function explode(w: World, db: ContentDb, p: Entity): void {
  const def = db.projectiles[p.def]!;
  const r = def.aoe;
  const owner = byId(w, p.proj!.owner) ?? p;
  for (const t of w.entities) {
    if (t.dead || t.team === p.team || t.team === 2 || (t.kind !== 'enemy' && t.kind !== 'player')) continue;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    if (dx * dx + dz * dz > (r + t.r) * (r + t.r)) continue;
    if (t.y > p.y + 2.5) continue;
    const [nx, nz] = norm(dx, dz, p.fx, p.fz);
    applyHit(w, db, { src: owner, dx: nx, dz: nz, hit: { dmg: 1, poise: p.proj!.poise, launch: p.proj!.launch, knock: 4, down: false, stop: 2, status: p.proj!.status, guardBreak: true, tag: 'ability', cap: 0.3 }, ranged: true, px: t.x, pz: t.z, prof: profOf(p) }, t);
  }
  w.events.push({ k: 'hazard', t: w.tick, what: `blast:${p.def}`, x: p.x, z: p.z });
}

/** Move projectiles with swept collision: walls, bodies, and fragile enemy shots. */
export function projectileSystem(w: World, db: ContentDb): void {
  for (const p of w.entities) {
    if (p.kind !== 'projectile' || p.dead) continue;
    const pr = p.proj!;
    const def = db.projectiles[p.def]!;
    p.px = p.x;
    p.pz = p.z;
    p.py = p.y;
    if (--pr.life <= 0) {
      if (pr.aoe > 0) explode(w, db, p);
      kill(w, p);
      continue;
    }
    if (def.speed === 0) {
      // Mines: wait for a hostile to step close.
      for (const t of w.entities) {
        if (t.dead || t.team === p.team || t.kind !== 'enemy') continue;
        if ((t.x - p.x) * (t.x - p.x) + (t.z - p.z) * (t.z - p.z) < 1.6 * 1.6) {
          explode(w, db, p);
          kill(w, p);
          break;
        }
      }
      continue;
    }
    if (pr.homing > 0) {
      let best: Entity | null = null;
      let bd = 100;
      for (const t of w.entities) {
        if (t.dead || t.team === p.team || t.team === 2 || (t.kind !== 'player' && t.kind !== 'enemy')) continue;
        const d = (t.x - p.x) * (t.x - p.x) + (t.z - p.z) * (t.z - p.z);
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      if (best) {
        const [tx, tz] = norm(best.x - p.x, best.z - p.z, p.fx, p.fz);
        [p.fx, p.fz] = rotateToward(p.fx, p.fz, tx, tz, pr.homing);
        p.vx = p.fx * def.speed;
        p.vz = p.fz * def.speed;
      }
    }
    const ax = p.x;
    const az = p.z;
    const bx = p.x + p.vx * DT;
    const bz = p.z + p.vz * DT;
    if (pr.arc) {
      p.vy -= GRAVITY * def.gravity * DT;
      p.y += p.vy * DT;
    }
    // Walls.
    if (segmentBlocked(w.room, ax, az, bx, bz)) {
      if (pr.aoe > 0) explode(w, db, p);
      kill(w, p);
      continue;
    }
    p.x = bx;
    p.z = bz;
    if (pr.arc) {
      if (p.y <= 0) {
        p.y = 0;
        if (pr.aoe > 0) explode(w, db, p);
        kill(w, p);
      }
      continue;
    }
    // Bodies, nearest first along the path.
    const hits: { t: Entity; s: number }[] = [];
    for (const t of w.entities) {
      if (t.dead || t.team === p.team || t.team === 2 || (t.kind !== 'enemy' && t.kind !== 'player')) continue;
      if (pr.hit.includes(t.id)) continue;
      if (p.y < t.y - 0.2 || p.y > t.y + t.h + 0.2) continue;
      const s = sweep(ax, az, bx, bz, t.x, t.z, t.r + p.r);
      if (s >= 0) hits.push({ t, s });
    }
    hits.sort((a, b) => a.s - b.s || a.t.id - b.t.id);
    const owner = byId(w, pr.owner) ?? p;
    for (const { t, s } of hits) {
      const r = applyHit(w, db, { src: owner, dx: p.fx, dz: p.fz, hit: { dmg: 1, poise: pr.poise, launch: pr.launch, knock: 1.5, down: false, stop: pr.stop, status: pr.status, guardBreak: false, tag: 'light', cap: 0.25 }, ranged: true, px: ax + (bx - ax) * s, pz: az + (bz - az) * s, prof: profOf(p) }, t);
      pr.hit.push(t.id);
      if (r === 'dodged') continue;
      if (pr.aoe > 0) {
        p.x = ax + (bx - ax) * s;
        p.z = az + (bz - az) * s;
        explode(w, db, p);
      }
      if (r === 'blocked' || pr.pierce-- <= 0) {
        kill(w, p);
        break;
      }
    }
    if (p.dead) continue;
    // Player shots knock down fragile enemy shots (shards, grenades).
    if (p.team === 0) {
      for (const q of w.entities) {
        if (q.kind !== 'projectile' || q.dead || q.team === p.team) continue;
        if (!db.projectiles[q.def]?.fragile) continue;
        if ((q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z) < (q.r + p.r + 0.25) * (q.r + p.r + 0.25)) {
          kill(w, q);
          kill(w, p);
          w.events.push({ k: 'hazard', t: w.tick, what: 'shotdown', x: q.x, z: q.z });
          break;
        }
      }
    }
  }
}

function kill(w: World, p: Entity): void {
  p.dead = true;
  p.removeAt = w.tick + 1;
}

/** First parameter s in [0,1] where segment a->b comes within r of point c, or -1. */
export function sweep(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, r: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const fx = ax - cx;
  const fz = az - cz;
  const a = dx * dx + dz * dz;
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0;
  if (a < 1e-12) return -1;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const s = (-b - Math.sqrt(disc)) / (2 * a);
  return s >= 0 && s <= 1 ? s : -1;
}
