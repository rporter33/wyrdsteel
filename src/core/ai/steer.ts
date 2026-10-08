import type { Entity, World } from '../sim/types';
import { flowField, flowDir } from '../nav/flowfield';
import { segmentBlocked } from '../level/grid';
import { norm, rotateToward } from '../math/vec';

const ACCEL = 0.22;

export function speedOf(e: Entity, base: number): number {
  let s = base;
  if ((e.elite ?? []).includes('hasted')) s *= 1.35;
  if (e.status.chill > 0) s *= 0.6;
  if (e.status.root > 0 || e.status.freeze > 0) s = 0;
  if (e.parts?.some((p) => p.id.startsWith('leg') && p.broken)) s *= 0.6;
  return s;
}

export function face(e: Entity, tx: number, tz: number, rate = 0.25): void {
  const [dx, dz] = norm(tx - e.x, tz - e.z, e.fx, e.fz);
  [e.fx, e.fz] = rotateToward(e.fx, e.fz, dx, dz, rate);
}

export function stop(e: Entity): void {
  e.vx += (0 - e.vx) * ACCEL;
  e.vz += (0 - e.vz) * ACCEL;
}

/** Walk toward a point: straight if there is line of sight, else down the flow field to it. */
export function moveTo(w: World, e: Entity, tx: number, tz: number, speed: number, faceMove = true): void {
  let dir: [number, number] | null;
  if (!segmentBlocked(w.room, e.x, e.z, tx, tz, (t) => t !== 0 && t !== 4 && t !== 5)) {
    const dx = tx - e.x;
    const dz = tz - e.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    dir = d < 0.15 ? null : [dx / d, dz / d];
  } else {
    const field = flowField(w.room, `${w.room.id}:${w.room.variant}:${w.room.ver}`, Math.floor(tx), Math.floor(tz));
    dir = flowDir(w.room, field, e.x, e.z);
  }
  if (!dir) {
    stop(e);
    return;
  }
  e.vx += (dir[0] * speed - e.vx) * ACCEL;
  e.vz += (dir[1] * speed - e.vz) * ACCEL;
  if (faceMove) [e.fx, e.fz] = rotateToward(e.fx, e.fz, dir[0], dir[1], 0.2);
}

/** Back away from a point, sliding along walls; used by kiting and fleeing archetypes. */
export function moveAway(w: World, e: Entity, fx: number, fz: number, speed: number): void {
  const [dx, dz] = norm(e.x - fx, e.z - fz, -e.fx, -e.fz);
  const tx = e.x + dx * 3;
  const tz = e.z + dz * 3;
  // If straight back is blocked, strafe instead.
  if (segmentBlocked(w.room, e.x, e.z, tx, tz, (t) => t !== 0 && t !== 4)) {
    const side = e.ai?.side ?? 1;
    moveTo(w, e, e.x - dz * 3 * side, e.z + dx * 3 * side, speed, false);
  } else {
    moveTo(w, e, tx, tz, speed, false);
  }
}

export function lineOfSight(w: World, a: Entity, b: Entity): boolean {
  return !segmentBlocked(w.room, a.x, a.z, b.x, b.z);
}

export function dist(a: Entity, b: Entity): number {
  return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));
}
