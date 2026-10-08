import { DT, GRAVITY } from '../constants';
import { collideCircle, blocksMove, T_PIT, tileAt, type Grid } from '../../level/grid';
import type { ContentDb } from '../../data/types';
import type { Entity, World } from '../types';
import { crackIce } from '../../level/hazards';

export function gridOf(w: World): Grid {
  return w.room as unknown as Grid;
}

/** Integrate velocity and gravity, then resolve walls and body overlap. */
export function motionSystem(w: World, db: ContentDb): void {
  const g = gridOf(w);
  for (const e of w.entities) {
    if (e.kind === 'projectile') continue;
    if (e.dead && e.kind !== 'enemy') continue;
    if (e.hitstop > 0) continue;
    const def = e.act ? db.actions[e.act.id] : null;
    const airborne = e.y > 0 || e.vy > 0;
    if (airborne) {
      // Juggled enemies fall slower so an air string can connect; the juggle decay still ends it.
      const hover = def && def.hover !== 1 ? def.hover : e.kind === 'enemy' && e.juggle > 0 ? 0.5 : 1;
      e.vy -= GRAVITY * DT * hover;
      e.y += e.vy * DT;
      if (e.y <= 0) {
        const fast = e.vy < -14;
        e.y = 0;
        e.vy = 0;
        if (e.juggle > 0 || fast) w.events.push({ k: 'land', t: w.tick, dst: e.id, slam: fast });
        // A hard landing (a slam, or a body hurled down) cracks thin ice.
        if (fast) crackIce(w, e.x, e.z, 1.4);
        e.juggle = 0;
        // Landing ends an air string (a slam finishes its own impact window first).
        if (def && def.air && !def.slam) e.act = null;
        if (def && def.slam && e.act) e.act.t = Math.max(e.act.t, def.cancel - 6);
      }
    }
    if (e.kind === 'pickup' || e.kind === 'npc' || e.kind === 'prop') continue;
    // The ground gave way (cracked ice became water): grounded enemies fall in.
    if (e.kind === 'enemy' && !e.dead && e.y <= 0 && tileAt(g, Math.floor(e.x), Math.floor(e.z)) === T_PIT) {
      e.hp = 0;
      continue;
    }
    let nx = e.x + e.vx * DT;
    let nz = e.z + e.vz * DT;
    // Knocked or slid into a pit: enemies fall (handled by deaths), players are stopped at the edge.
    const block = e.kind === 'enemy' && e.stunKind > 0 ? (t: number) => t !== T_PIT && blocksMove(t) : blocksMove;
    [nx, nz] = collideCircle(g, nx, nz, e.r, block);
    e.x = nx;
    e.z = nz;
    if (e.kind === 'enemy' && !e.dead && tileAt(g, Math.floor(e.x), Math.floor(e.z)) === T_PIT && e.y <= 0) {
      e.hp = 0;
    }
  }
  separate(w, g);
}

const CELL = 2;

/** Push overlapping bodies apart. Visits pairs in id order through a uniform grid. */
function separate(w: World, g: Grid): void {
  const bodies: Entity[] = [];
  for (const e of w.entities) {
    if ((e.kind === 'player' || e.kind === 'enemy' || e.kind === 'npc') && !e.dead) bodies.push(e);
  }
  if (bodies.length < 2) return;
  const cw = Math.ceil(g.w / CELL) + 1;
  const ch = Math.ceil(g.h / CELL) + 1;
  const cells: number[][] = [];
  for (let i = 0; i < cw * ch; i++) cells.push([]);
  const cellOf = (e: Entity) => {
    const cx = Math.max(0, Math.min(cw - 1, Math.floor(e.x / CELL)));
    const cz = Math.max(0, Math.min(ch - 1, Math.floor(e.z / CELL)));
    return [cx, cz] as const;
  };
  bodies.forEach((e, i) => {
    const [cx, cz] = cellOf(e);
    cells[cz * cw + cx]!.push(i);
  });
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!;
    const [cx, cz] = cellOf(a);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (x < 0 || z < 0 || x >= cw || z >= ch) continue;
        for (const j of cells[z * cw + x]!) {
          if (j <= i) continue;
          const b = bodies[j]!;
          // Airborne bodies pass over grounded ones (juggles over a crowd).
          if (Math.abs(a.y - b.y) > 1.2) continue;
          const ddx = b.x - a.x;
          const ddz = b.z - a.z;
          const min = a.r + b.r;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2);
          const nx = d > 1e-6 ? ddx / d : 1;
          const nz = d > 1e-6 ? ddz / d : 0;
          const push = min - d;
          // Heavier/anchored bodies move less: players and NPCs are not shoved around by fodder.
          const wa = mass(a);
          const wb = mass(b);
          const fa = wb / (wa + wb);
          const fb = wa / (wa + wb);
          a.x -= nx * push * fa;
          a.z -= nz * push * fa;
          b.x += nx * push * fb;
          b.z += nz * push * fb;
        }
      }
    }
  }
  for (const e of bodies) {
    const [x, z] = collideCircle(g, e.x, e.z, e.r);
    e.x = x;
    e.z = z;
  }
}

function mass(e: Entity): number {
  if (e.kind === 'npc') return 1000;
  if (e.kind === 'player') return 3;
  if (e.r > 0.9) return 12;
  return 1;
}
