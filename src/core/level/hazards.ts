import type { ContentDb } from '../data/types';
import type { Entity, Feature, World } from '../sim/types';
import { msToTicks } from '../sim/constants';
import { addBuildup } from '../combat/status';

const SURGE_WARN = msToTicks(3000);
const SURGE_LEN = msToTicks(10000);
const SURGE_GAP = msToTicks(24000);
const HEAT_R = 4;
const BURN_HEAT_R = 2.5;

/** Is this body standing in heat: a lit brazier, or a burning enemy close by? */
export function inHeat(w: World, e: Entity): boolean {
  for (const f of w.room.features) {
    if (f.kind === 'brazier' && f.a > 0 && (f.x - e.x) * (f.x - e.x) + (f.z - e.z) * (f.z - e.z) < HEAT_R * HEAT_R) return true;
  }
  for (const o of w.entities) {
    if (o.kind === 'enemy' && !o.dead && o.status.burn > 0 && (o.x - e.x) * (o.x - e.x) + (o.z - e.z) * (o.z - e.z) < BURN_HEAT_R * BURN_HEAT_R) return true;
  }
  return false;
}

function light(w: World, f: Feature): void {
  if (f.a > 0) return;
  f.a = 1;
  w.events.push({ k: 'hazard', t: w.tick, what: 'brazier', x: f.x, z: f.z });
}

/**
 * Per-room mechanics. The Iron Wood's blizzard surges build chill on anyone outside heat; braziers
 * are heat, lit by a shot, a burning blow, or a hand. The foundry and the roots add theirs.
 */
export function roomSystem(w: World, db: ContentDb): void {
  const room = w.room;
  // Braziers: player shots that pass close light them.
  for (const f of room.features) {
    if (f.kind !== 'brazier' || f.a > 0) continue;
    for (const p of w.entities) {
      if (p.kind !== 'projectile' || p.dead || p.team !== 0) continue;
      if ((p.x - f.x) * (p.x - f.x) + (p.z - f.z) * (p.z - f.z) < 0.9 * 0.9) {
        light(w, f);
        break;
      }
    }
  }
  // Blizzard surges.
  if (room.surgeAt >= 0 && !room.cleared) {
    if (w.tick === room.surgeAt - SURGE_WARN) w.events.push({ k: 'surge', t: w.tick, on: false, warn: true });
    if (w.tick === room.surgeAt) {
      room.surgeEnd = w.tick + SURGE_LEN;
      w.events.push({ k: 'surge', t: w.tick, on: true, warn: false });
    }
    if (room.surgeEnd > w.tick) {
      for (const e of w.entities) {
        if (e.kind !== 'player' || e.dead || inHeat(w, e)) continue;
        addBuildup(w, e, 'chill', 0.42, 0.2, false);
      }
    }
    if (w.tick === room.surgeEnd) {
      room.surgeAt = w.tick + SURGE_GAP;
      w.events.push({ k: 'surge', t: w.tick, on: false, warn: false });
    }
  }
  void db;
}

export function lightBrazierNear(w: World, x: number, z: number, r: number): boolean {
  for (const f of w.room.features) {
    if (f.kind === 'brazier' && f.a === 0 && (f.x - x) * (f.x - x) + (f.z - z) * (f.z - z) < r * r) {
      light(w, f);
      return true;
    }
  }
  return false;
}
