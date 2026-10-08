import type { Entity, World } from '../sim/types';
import { sin, cos, TAU } from '../math/trig';

export const TOKEN_MELEE = 1;
export const TOKEN_RANGED = 2;
export const TOKEN_HEAVY = 3;

/**
 * How many enemies may be mid-attack against one player at once, by kind. The crowd still
 * surrounds you; only a few swing at a time, which is what makes a mob readable.
 */
export function tokenCap(w: World, kind: number): number {
  const hard = w.difficulty === 2 ? 1 : 0;
  if (kind === TOKEN_MELEE) return 2 + hard;
  if (kind === TOKEN_RANGED) return 3 + hard;
  return 1;
}

export function holders(w: World, target: number, kind: number): number {
  let n = 0;
  for (const e of w.entities) if (e.ai && !e.dead && e.ai.token === kind && e.ai.target === target) n++;
  return n;
}

export function requestToken(w: World, e: Entity, kind: number): boolean {
  const ai = e.ai!;
  if (ai.token === kind) return true;
  if (holders(w, ai.target, kind) >= tokenCap(w, kind)) return false;
  ai.token = kind;
  return true;
}

export function releaseToken(e: Entity): void {
  if (e.ai) e.ai.token = 0;
}

/**
 * A waiting spot around the target: eight slots on a ring. Flankers prefer the slots behind the
 * target's facing. Slots are handed out in id order so every peer agrees.
 */
export function flankPoint(w: World, e: Entity, target: Entity, radius: number, behind: boolean): [number, number] {
  const waiting: number[] = [];
  for (const o of w.entities) if (o.ai && !o.dead && o.ai.target === target.id && o.ai.st === 'wait') waiting.push(o.id);
  const idx = Math.max(0, waiting.indexOf(e.id));
  const n = Math.max(1, waiting.length);
  // Base angle: behind the target for flankers, else the side the enemy is already on.
  let baseX = behind ? -target.fx : e.x - target.x;
  let baseZ = behind ? -target.fz : e.z - target.z;
  const l = Math.sqrt(baseX * baseX + baseZ * baseZ) || 1;
  baseX /= l;
  baseZ /= l;
  const spread = (TAU / 8) * (idx - (n - 1) / 2);
  const c = cos(spread);
  const s = sin(spread);
  const dx = baseX * c - baseZ * s;
  const dz = baseX * s + baseZ * c;
  return [target.x + dx * radius, target.z + dz * radius];
}
