import type { ContentDb } from '../data/types';
import type { Entity, Feature, World } from '../sim/types';
import { msToTicks } from '../sim/constants';
import { addBuildup } from '../combat/status';
import { T_CRACKED, T_ICE, T_PIT, tileAt } from './grid';
import { byId } from '../sim/entity';

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
  conveyors(w);
  vents(w, db);
  geysers(w, db);
  thinIce(w);
  void db;
}

const CONVEYOR_SPEED = 2.6;
const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/** Conveyor belts carry every grounded body standing on them. */
function conveyors(w: World): void {
  const belts = w.room.features.filter((f) => f.kind === 'conveyor');
  if (!belts.length) return;
  for (const e of w.entities) {
    if ((e.kind !== 'player' && e.kind !== 'enemy') || e.dead || e.y > 0.1) continue;
    const tx = Math.floor(e.x);
    const tz = Math.floor(e.z);
    const b = belts.find((f) => Math.floor(f.x) === tx && Math.floor(f.z) === tz);
    if (!b) continue;
    const [dx, dz] = DIRS[b.dir]!;
    e.x += (dx * CONVEYOR_SPEED) / 60;
    e.z += (dz * CONVEYOR_SPEED) / 60;
  }
}

const VENT_IDLE = msToTicks(3500);
const VENT_WARN = msToTicks(1000);
const VENT_FIRE = msToTicks(1200);
const VENT_CYCLE = VENT_IDLE + VENT_WARN + VENT_FIRE;

/**
 * Furnace vents cycle idle -> warning -> fire. Fire burns whatever stands on them, enemies
 * included: launching a crowd onto a vent is the point.
 */
function vents(w: World, db: ContentDb): void {
  w.room.features.forEach((f, i) => {
    if (f.kind !== 'vent') return;
    const phase = (w.tick + i * 47) % VENT_CYCLE;
    const prev = f.a;
    f.a = phase < VENT_IDLE ? 0 : phase < VENT_IDLE + VENT_WARN ? 1 : 2;
    if (f.a === 1 && prev === 0) w.events.push({ k: 'telegraph', t: w.tick, src: 0, shape: 'circle', x: f.x, z: f.z, r: 1.3, dx: 0, dz: 1, len: 1.3, width: 0, dur: VENT_WARN });
    if (f.a !== 2) return;
    if (prev !== 2) w.events.push({ k: 'hazard', t: w.tick, what: 'vent', x: f.x, z: f.z });
    if (phase % 30 !== 0) return;
    for (const e of w.entities) {
      if ((e.kind !== 'player' && e.kind !== 'enemy') || e.dead || e.y > 2.5 || e.iframes > 0) continue;
      if ((e.x - f.x) * (e.x - f.x) + (e.z - f.z) * (e.z - f.z) > 1.4 * 1.4) continue;
      if (e.kind === 'enemy' && db.enemies[e.def]?.brain === 'static') continue;
      const dmg = Math.max(1, Math.round(e.hpMax * (e.kind === 'player' ? 0.06 : 0.14)));
      e.hp -= dmg;
      e.hurtAt = w.tick;
      addBuildup(w, e, 'burn', 60, e.kind === 'player' ? 0.2 : 0, false);
      w.events.push({ k: 'hit', t: w.tick, src: 0, dst: e.id, dmg, crit: false, weak: false, x: e.x, y: e.y + 1, z: e.z, heavy: false, status: 'burn' });
    }
  });
}

const GEY_IDLE = msToTicks(4200);
const GEY_WARN = msToTicks(1000);
const GEY_FIRE = msToTicks(800);
const GEY_CYCLE = GEY_IDLE + GEY_WARN + GEY_FIRE;

/** Geysers throw everything nearby into the air: free juggles, or a nasty surprise. */
function geysers(w: World, db: ContentDb): void {
  w.room.features.forEach((f, i) => {
    if (f.kind !== 'geyser') return;
    const phase = (w.tick + i * 61) % GEY_CYCLE;
    const prev = f.a;
    f.a = phase < GEY_IDLE ? 0 : phase < GEY_IDLE + GEY_WARN ? 1 : 2;
    if (f.a === 1 && prev === 0) w.events.push({ k: 'telegraph', t: w.tick, src: 0, shape: 'circle', x: f.x, z: f.z, r: 1.7, dx: 0, dz: 1, len: 1.7, width: 0, dur: GEY_WARN });
    if (f.a !== 2 || prev === 2) return;
    w.events.push({ k: 'hazard', t: w.tick, what: 'geyser', x: f.x, z: f.z });
    for (const e of w.entities) {
      if ((e.kind !== 'player' && e.kind !== 'enemy') || e.dead || e.iframes > 0) continue;
      if ((e.x - f.x) * (e.x - f.x) + (e.z - f.z) * (e.z - f.z) > 1.8 * 1.8) continue;
      if (e.kind === 'enemy' && (db.enemies[e.def]?.brain === 'static' || e.r > 0.9)) continue;
      if (e.kind === 'player') {
        e.vy = Math.max(e.vy, 9);
        e.hp -= Math.round(e.hpMax * 0.04);
      } else {
        e.vy = Math.max(e.vy, 13);
        e.juggle = Math.max(e.juggle, 1);
        e.stun = Math.max(e.stun, 30);
        e.stunKind = 2;
        e.act = null;
        w.events.push({ k: 'launch', t: w.tick, dst: e.id });
      }
      e.y = Math.max(e.y, 0.06);
      e.hurtAt = w.tick;
    }
  });
}

/** Cracked ice gives way a moment later; anything still standing on it falls through. */
function thinIce(w: World): void {
  const room = w.room;
  for (const f of room.features) {
    if (f.kind !== 'crack' || f.a <= 0) continue;
    if (--f.a > 0) continue;
    const tx = Math.floor(f.x);
    const tz = Math.floor(f.z);
    if (tileAt(room, tx, tz) !== T_CRACKED) continue;
    room.tiles[tz * room.w + tx] = T_PIT;
    room.ver++;
    w.events.push({ k: 'hazard', t: w.tick, what: 'icebreak', x: f.x, z: f.z });
  }
  room.features = room.features.filter((f) => f.kind !== 'crack' || f.a > 0 || f.b === 1);
}

/** A heavy blow or a slam cracks thin ice around it; it breaks 1.5 s later. */
export function crackIce(w: World, x: number, z: number, r: number): void {
  const room = w.room;
  let any = false;
  for (let tz = Math.floor(z - r); tz <= Math.floor(z + r); tz++) {
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
      if (tileAt(room, tx, tz) !== T_ICE) continue;
      if ((tx + 0.5 - x) * (tx + 0.5 - x) + (tz + 0.5 - z) * (tz + 0.5 - z) > r * r) continue;
      room.tiles[tz * room.w + tx] = T_CRACKED;
      room.features.push({ kind: 'crack', x: tx + 0.5, z: tz + 0.5, a: msToTicks(1500), b: 0, id: '', dir: 0 });
      any = true;
    }
  }
  if (any) {
    room.ver++;
    w.events.push({ k: 'hazard', t: w.tick, what: 'icecrack', x, z });
  }
}

/** Shield generators keep every bulwark in the room invulnerable until they're destroyed. */
export function shielded(w: World, t: Entity): boolean {
  if (t.def !== 'bulwark') return false;
  return w.entities.some((e) => e.def === 'generator' && !e.dead);
}

export { byId };

export function lightBrazierNear(w: World, x: number, z: number, r: number): boolean {
  for (const f of w.room.features) {
    if (f.kind === 'brazier' && f.a === 0 && (f.x - x) * (f.x - x) + (f.z - z) * (f.z - z) < r * r) {
      light(w, f);
      return true;
    }
  }
  return false;
}
