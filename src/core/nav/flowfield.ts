// pure-cache: flow fields are derived from (room tiles, goal tile) only, so memoizing them outside
// the world state cannot change outcomes. The cache key includes the tiles' version.
import { blocksMove, type Grid } from '../level/grid';

const cache = new Map<string, Int32Array>();
const MAX = 64;

/** BFS distance (in tile steps x10, diagonals x14) from the goal tile over walkable tiles. */
export function flowField(g: Grid, key: string, gx: number, gz: number): Int32Array {
  const ck = `${key}:${gx}:${gz}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const n = g.w * g.h;
  const dist = new Int32Array(n).fill(0x3fffffff);
  const goal = gz * g.w + gx;
  if (gx < 0 || gz < 0 || gx >= g.w || gz >= g.h) return dist;
  dist[goal] = 0;
  // Dijkstra with a bucket queue: costs are small integers.
  const buckets: number[][] = [[goal]];
  for (let c = 0; c < buckets.length; c++) {
    const b = buckets[c];
    if (!b) continue;
    for (const i of b) {
      if (dist[i]! !== c) continue;
      const x = i % g.w;
      const z = (i - x) / g.w;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= g.w || nz >= g.h) continue;
          const j = nz * g.w + nx;
          if (blocksMove(g.tiles[j]!)) continue;
          // No corner cutting past walls.
          if (dx && dz && (blocksMove(g.tiles[z * g.w + nx]!) || blocksMove(g.tiles[nz * g.w + x]!))) continue;
          const nc = c + (dx && dz ? 14 : 10);
          if (nc < dist[j]!) {
            dist[j] = nc;
            (buckets[nc] ??= []).push(j);
          }
        }
      }
    }
  }
  if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
  cache.set(ck, dist);
  return dist;
}

/** Direction to step from (x, z) to descend the field; null at the goal or when unreachable. */
export function flowDir(g: Grid, field: Int32Array, x: number, z: number): [number, number] | null {
  const tx = Math.floor(x);
  const tz = Math.floor(z);
  if (tx < 0 || tz < 0 || tx >= g.w || tz >= g.h) return null;
  const here = field[tz * g.w + tx]!;
  if (here === 0 || here >= 0x3fffffff) return null;
  let best = here;
  let bx = 0;
  let bz = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = tx + dx;
      const nz = tz + dz;
      if (nx < 0 || nz < 0 || nx >= g.w || nz >= g.h) continue;
      const d = field[nz * g.w + nx]!;
      if (d < best) {
        best = d;
        bx = nx;
        bz = nz;
      }
    }
  }
  if (best === here) return null;
  const vx = bx + 0.5 - x;
  const vz = bz + 0.5 - z;
  const l = Math.sqrt(vx * vx + vz * vz);
  return l < 1e-6 ? null : [vx / l, vz / l];
}

export function clearFlowCache(): void {
  cache.clear();
}
