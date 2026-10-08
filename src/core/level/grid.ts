// Rooms are tile grids, 1 m per tile, origin at the top-left corner; x grows right, z grows down
// the screen. Tile codes:
export const T_FLOOR = 0;
export const T_WALL = 1;
/** Blocks walking, not projectiles (rails, low walls, rubble). */
export const T_LOW = 2;
/** Outside the room: blocks everything. */
export const T_VOID = 3;
/** Thin ice: walkable until cracked; cracked ice drops enemies. */
export const T_ICE = 4;
export const T_CRACKED = 5;
/** Open water/pit: blocks walking; enemies knocked in die. */
export const T_PIT = 6;

export interface Grid {
  w: number;
  h: number;
  tiles: number[];
}

export function tileAt(g: Grid, tx: number, tz: number): number {
  if (tx < 0 || tz < 0 || tx >= g.w || tz >= g.h) return T_VOID;
  return g.tiles[tz * g.w + tx]!;
}

export function blocksMove(t: number): boolean {
  return t === T_WALL || t === T_LOW || t === T_VOID || t === T_PIT;
}

export function blocksShot(t: number): boolean {
  return t === T_WALL || t === T_VOID;
}

/**
 * Push a circle out of every blocking tile it overlaps. Two passes settle corners. Pure and
 * order-stable: tiles are visited in row-major order.
 */
export function collideCircle(g: Grid, x: number, z: number, r: number, block = blocksMove): [number, number] {
  for (let pass = 0; pass < 2; pass++) {
    const x0 = Math.floor(x - r);
    const x1 = Math.floor(x + r);
    const z0 = Math.floor(z - r);
    const z1 = Math.floor(z + r);
    for (let tz = z0; tz <= z1; tz++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!block(tileAt(g, tx, tz))) continue;
        const cx = x < tx ? tx : x > tx + 1 ? tx + 1 : x;
        const cz = z < tz ? tz : z > tz + 1 ? tz + 1 : z;
        let dx = x - cx;
        let dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          const push = r - d;
          x += (dx / d) * push;
          z += (dz / d) * push;
        } else {
          // Centre inside the tile: leave by the nearest face.
          const left = x - tx;
          const right = tx + 1 - x;
          const top = z - tz;
          const bottom = tz + 1 - z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) x = tx - r;
          else if (m === right) x = tx + 1 + r;
          else if (m === top) z = tz - r;
          else z = tz + 1 + r;
          dx = 0;
          dz = 0;
        }
      }
    }
  }
  return [x, z];
}

/** Does the straight segment cross a tile that blocks shots? Sampled every quarter tile. */
export function segmentBlocked(g: Grid, ax: number, az: number, bx: number, bz: number, block = blocksShot): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const l = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.max(1, Math.ceil(l * 4));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (block(tileAt(g, Math.floor(ax + dx * t), Math.floor(az + dz * t)))) return true;
  }
  return false;
}

/** ASCII legend shared by room templates. Unknown glyphs are floor; markers are read separately. */
export function glyphTile(c: string): number {
  switch (c) {
    case '#':
      return T_WALL;
    case '=':
      return T_LOW;
    case ' ':
      return T_VOID;
    case '~':
      return T_PIT;
    case 'i':
      return T_ICE;
    default:
      return T_FLOOR;
  }
}

export interface Marker {
  c: string;
  x: number;
  z: number;
}

export function parseAscii(rows: string[]): { grid: Grid; markers: Marker[] } {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const tiles: number[] = [];
  const markers: Marker[] = [];
  for (let z = 0; z < h; z++) {
    const row = rows[z]!;
    for (let x = 0; x < w; x++) {
      const c = x < row.length ? row[x]! : ' ';
      tiles.push(glyphTile(c));
      if (!'#=. ~i'.includes(c)) markers.push({ c, x: x + 0.5, z: z + 0.5 });
    }
  }
  return { grid: { w, h, tiles }, markers };
}

/** Flood fill from (sx, sz) over walkable tiles; returns the reached-tile mask. */
export function reachable(g: Grid, sx: number, sz: number): boolean[] {
  const seen = new Array<boolean>(g.w * g.h).fill(false);
  const stack: number[] = [];
  const start = Math.floor(sz) * g.w + Math.floor(sx);
  if (blocksMove(g.tiles[start]!)) return seen;
  seen[start] = true;
  stack.push(start);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % g.w;
    const z = (i - x) / g.w;
    const n = [
      [x + 1, z],
      [x - 1, z],
      [x, z + 1],
      [x, z - 1],
    ];
    for (const [nx, nz] of n) {
      if (nx! < 0 || nz! < 0 || nx! >= g.w || nz! >= g.h) continue;
      const j = nz! * g.w + nx!;
      if (seen[j] || blocksMove(g.tiles[j]!)) continue;
      seen[j] = true;
      stack.push(j);
    }
  }
  return seen;
}
