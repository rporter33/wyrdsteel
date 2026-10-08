import type { Entity, EntityKind, Status, World } from './types';

export function newStatus(): Status {
  return { b: [0, 0, 0, 0], root: 0, chill: 0, freeze: 0, burn: 0, burnDmg: 0, shock: 0, ccRes: 0 };
}

export function newEntity(w: World, kind: EntityKind, def: string, team: number, x: number, z: number): Entity {
  const e: Entity = {
    id: w.nextId++,
    kind,
    def,
    team,
    level: 1,
    x,
    z,
    y: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    px: x,
    pz: z,
    py: 0,
    fx: 0,
    fz: -1,
    r: 0.45,
    h: 1.8,
    hp: 1,
    hpMax: 1,
    poise: 0,
    poiseMax: 0,
    poiseAt: 0,
    act: null,
    stun: 0,
    stunKind: 0,
    hitstop: 0,
    iframes: 0,
    armorT: 0,
    juggle: 0,
    status: newStatus(),
    dead: false,
    removeAt: -1,
    shield: 0,
    hurtAt: -1000,
    lastHit: 0,
    lastHow: 0,
  };
  w.entities.push(e);
  return e;
}

/** Entities are kept sorted by id (append-only ids), so a linear scan is in id order. */
export function byId(w: World, id: number): Entity | null {
  // Binary search: ids are strictly increasing in the array.
  const es = w.entities;
  let lo = 0;
  let hi = es.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = es[mid]!;
    if (m.id === id) return m;
    if (m.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

export function alive(e: Entity | null): e is Entity {
  return !!e && !e.dead;
}

export function isAirborne(e: Entity): boolean {
  return e.y > 0.05;
}
