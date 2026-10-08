import type { Entity, World } from '../sim/types';
import { segmentBlocked } from '../level/grid';

export interface ConeCfg {
  range: number;
  /** cos of the half-angle. */
  cos: number;
  /** Bonus kept by the current target so the choice does not flicker between two similar ones. */
  sticky: number;
}

/** Melee: 15-40 degrees either side by assist strength, 4.5 m. Ranged: 4-12 degrees, 22 m. */
export function meleeCone(assist: number): ConeCfg {
  const half = 15 + 25 * assist;
  return { range: 3.2 + 1.3 * assist, cos: cosDeg(half), sticky: 0.2 };
}
export function rangedCone(assist: number, precise: boolean): ConeCfg {
  if (precise) return { range: 24, cos: cosDeg(1.5), sticky: 0 };
  const half = 4 + 8 * assist;
  return { range: 22, cos: cosDeg(half), sticky: 0.2 };
}

// cos of small angles by series: exact enough and deterministic without Math.cos.
function cosDeg(d: number): number {
  const r = (d * 3.141592653589793) / 180;
  const r2 = r * r;
  return 1 - r2 / 2 + (r2 * r2) / 24 - (r2 * r2 * r2) / 720 + (r2 * r2 * r2 * r2) / 40320;
}

export function hostile(a: Entity, b: Entity): boolean {
  return a.team !== b.team && b.team !== 2 && (b.kind === 'enemy' || b.kind === 'player') && !b.dead;
}

/**
 * Best target in a cone around (dx, dz). Score favours small angles first, then distance, and
 * breaks exact ties on id so every peer picks the same one. Line of sight is required.
 */
export function coneTarget(w: World, src: Entity, dx: number, dz: number, cfg: ConeCfg, prev: number): Entity | null {
  let best: Entity | null = null;
  let bestScore = -Infinity;
  for (const t of w.entities) {
    if (t === src || !hostile(src, t)) continue;
    if (t.ai && (t.ai.st === 'burrowed' || t.ai.st === 'travel')) continue;
    const vx = t.x - src.x;
    const vz = t.z - src.z;
    const d = Math.sqrt(vx * vx + vz * vz);
    const reach = cfg.range + t.r;
    if (d > reach) continue;
    // Bodies already touching count as in front, whatever the angle.
    const c = d < 1e-6 ? 1 : (vx * dx + vz * dz) / d;
    if (c < cfg.cos && d > src.r + t.r + 0.25) continue;
    if (segmentBlocked(w.room, src.x, src.z, t.x, t.z)) continue;
    let score = c * 2 - d / reach;
    if (t.id === prev) score += cfg.sticky;
    if (score > bestScore || (score === bestScore && best && t.id < best.id)) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/** Hard lock: widest sensible cone toward the aim, then cycle by angle around the player. */
export function lockCandidates(w: World, src: Entity, dx: number, dz: number): Entity[] {
  const out: { e: Entity; c: number }[] = [];
  for (const t of w.entities) {
    if (t === src || !hostile(src, t)) continue;
    const vx = t.x - src.x;
    const vz = t.z - src.z;
    const d = Math.sqrt(vx * vx + vz * vz);
    if (d > 20 || segmentBlocked(w.room, src.x, src.z, t.x, t.z)) continue;
    const c = d < 1e-6 ? 1 : (vx * dx + vz * dz) / d;
    out.push({ e: t, c: c - d * 0.01 });
  }
  out.sort((a, b) => b.c - a.c || a.e.id - b.e.id);
  return out.map((o) => o.e);
}

/** Signed side of t relative to facing: used to order lock cycling clockwise. */
export function sideOf(src: Entity, t: Entity, dx: number, dz: number): number {
  return dx * (t.z - src.z) - dz * (t.x - src.x);
}
