import type { ContentDb } from '../../data/types';
import type { Entity, World } from '../types';
import { BTN } from '../../input/frame';
import { byId } from '../entity';
import { msToTicks } from '../constants';
import { resetActiveEncounters, RESPAWN_TICKS, SKIP_AFTER } from '../../level/encounters';
import { spawnPickup } from '../../progression/drops';
import { startAction } from './actions';

const WAYSTONE_R = 2.2;
const PICK_R = 1.4;
const MAGNET_R = 3.2;

/** Player-side upkeep: downed state and the Valkyrie, waystones, pickups, interactions, exits. */
export function playerSystem(w: World, db: ContentDb): void {
  for (const p of w.players) {
    const e = byId(w, p.entity);
    if (!e || !e.pl) continue;
    const pl = e.pl;
    const inp = p.lastInput;
    if (e.dead) {
      if (!pl.downed) {
        pl.downed = true;
        pl.respawnAt = w.tick + RESPAWN_TICKS;
        p.character.deaths++;
        // The Valkyrie's toll: a tenth of the bounty earned since the last waystone, left behind as
        // a shade you can win back. Dying again before reaching it loses it.
        const toll = Math.floor(w.zone.sinceWaystone * 0.1);
        p.character.bounty = Math.max(0, p.character.bounty - toll);
        w.zone.sinceWaystone -= toll;
        w.zone.shade = toll > 0 ? { node: w.zone.node, x: e.x, z: e.z, amount: toll } : null;
        w.events.push({ k: 'playerDown', t: w.tick, slot: p.slot });
      }
      const skip = (inp.pressed & (BTN.skip | BTN.light | BTN.dodge | BTN.interact)) !== 0 && w.tick - (pl.respawnAt - RESPAWN_TICKS) >= SKIP_AFTER;
      if (w.tick >= pl.respawnAt || skip) respawn(w, db, p.slot);
      continue;
    }

    // Waystones: touching one heals, refills flasks and makes it the respawn point.
    for (const f of w.room.features) {
      if (f.kind !== 'waystone') continue;
      const inside = (e.x - f.x) * (e.x - f.x) + (e.z - f.z) * (e.z - f.z) < WAYSTONE_R * WAYSTONE_R;
      const bit = 1 << p.slot;
      if (inside && !(f.b & bit)) {
        f.b |= bit;
        e.hp = e.hpMax;
        pl.flasks = p.stats.flasks;
        w.zone.waystone = w.zone.node;
        w.zone.sinceWaystone = 0;
        w.events.push({ k: 'waystone', t: w.tick, slot: p.slot, id: f.id });
      } else if (!inside && f.b & bit) f.b &= ~bit;
    }

    // Pickups: bounty is pulled in from a little further; everything is collected by walking over it.
    for (const it of w.entities) {
      if (it.kind !== 'pickup' || it.dead || !it.pick) continue;
      if (it.pick.owner >= 0 && it.pick.owner !== p.slot) continue;
      const dx = e.x - it.x;
      const dz = e.z - it.z;
      const d2 = dx * dx + dz * dz;
      if (it.pick.kind === 'bounty' && d2 < MAGNET_R * MAGNET_R && d2 > 0.01) {
        const d = Math.sqrt(d2);
        it.x += (dx / d) * 0.25;
        it.z += (dz / d) * 0.25;
      }
      if (d2 > PICK_R * PICK_R || it.y > 0.3) continue;
      collect(w, db, p.slot, e, it);
    }

    // Interact: finishers on kneeling heavies, then features.
    if (inp.pressed & BTN.interact) interact(w, db, p.slot, e);
  }

  // Exits: an open exit takes the party to the next room.
  if (!w.transition) {
    for (const ex of w.room.exits) {
      if (!ex.open || !ex.to) continue;
      const any = w.entities.some((e) => e.kind === 'player' && !e.dead && (e.x - ex.x) * (e.x - ex.x) + (e.z - ex.z) * (e.z - ex.z) < 1.3 * 1.3);
      if (any) {
        w.transition = { to: ex.to, at: w.tick };
        w.events.push({ k: 'exit', t: w.tick, to: ex.to });
        break;
      }
    }
  }
}

function collect(w: World, db: ContentDb, slot: number, e: Entity, it: Entity): void {
  const pk = it.pick!;
  const p = w.players[slot]!;
  switch (pk.kind) {
    case 'bounty': {
      const amt = Math.round(pk.amount * (1 + p.stats.bountyPct));
      p.character.bounty += amt;
      w.zone.sinceWaystone += amt;
      break;
    }
    case 'shade':
      p.character.bounty += pk.amount;
      w.zone.shade = null;
      break;
    case 'heal':
      e.hp = Math.min(e.hpMax, e.hp + Math.round(e.hpMax * pk.amount));
      break;
    default:
      pickupItem(w, db, slot, it);
  }
  w.events.push({ k: 'pickup', t: w.tick, slot, kind: pk.kind, ref: pk.ref, amount: pk.amount, rarity: pk.item?.rarity, name: pk.item?.base });
  it.dead = true;
  it.removeAt = w.tick + 1;
}

export type ItemPickup = (w: World, db: ContentDb, slot: number, it: Entity) => void;
let pickupItem: ItemPickup = () => {};
export function setItemPickup(f: ItemPickup): void {
  pickupItem = f;
}

function interact(w: World, db: ContentDb, slot: number, e: Entity): void {
  // Finisher: climb a kneeling heavy from behind.
  for (const t of w.entities) {
    if (t.kind !== 'enemy' || t.dead || t.stunKind !== 2 || !t.parts) continue;
    const d2 = (t.x - e.x) * (t.x - e.x) + (t.z - e.z) * (t.z - e.z);
    if (d2 > (t.r + 1.6) * (t.r + 1.6)) continue;
    const [dx, dz] = [(t.x - e.x) / Math.sqrt(d2 || 1), (t.z - e.z) / Math.sqrt(d2 || 1)];
    startAction(w, e, db.actions['finisher.climb']!, dx, dz, t.id, 'finisher');
    e.iframes = msToTicks(1100);
    t.stun = Math.max(t.stun, msToTicks(1300));
    w.events.push({ k: 'finisher', t: w.tick, src: e.id, dst: t.id });
    return;
  }
  let best = -1;
  let bd = 2.6 * 2.6;
  w.room.features.forEach((f, i) => {
    if (f.kind !== 'npc' && f.kind !== 'chest' && f.kind !== 'shrine' && f.kind !== 'waystone') return;
    const d2 = (f.x - e.x) * (f.x - e.x) + (f.z - e.z) * (f.z - e.z);
    if (d2 < bd) {
      bd = d2;
      best = i;
    }
  });
  if (best >= 0) {
    const f = w.room.features[best]!;
    w.events.push({ k: 'interact', t: w.tick, slot, what: f.kind, id: f.id });
    if (f.kind === 'chest' && f.a === 0) {
      f.a = 1;
      openChest(w, db, slot, f.x, f.z);
    }
  }
}

export type ChestOpen = (w: World, db: ContentDb, slot: number, x: number, z: number) => void;
let openChest: ChestOpen = (w, _db, _slot, x, z) => {
  spawnPickup(w, 'bounty', x, z, 20);
};
export function setChestOpen(f: ChestOpen): void {
  openChest = f;
}

/** Back at the last waystone with full health and flasks; unfinished fights reset. */
export function respawn(w: World, db: ContentDb, slot: number): void {
  const p = w.players[slot]!;
  const e = byId(w, p.entity);
  if (!e || !e.pl) return;
  resetActiveEncounters(w);
  e.dead = false;
  e.hp = e.hpMax;
  e.act = null;
  e.stun = 0;
  e.stunKind = 0;
  e.status.b = [0, 0, 0, 0];
  e.status.burn = e.status.chill = e.status.freeze = e.status.root = e.status.shock = 0;
  e.iframes = msToTicks(1500);
  e.pl.downed = false;
  e.pl.flasks = p.stats.flasks;
  e.pl.dodges = p.stats.dodgeCharges;
  e.pl.lock = 0;
  e.pl.soft = 0;
  e.pl.ruin = 0;
  w.events.push({ k: 'respawn', t: w.tick, slot });
  if (w.zone.waystone !== w.zone.node) {
    w.transition = { to: w.zone.waystone, at: w.tick };
    return;
  }
  const ws = w.room.features.find((f) => f.kind === 'waystone');
  const pos = ws ? { x: ws.x, z: ws.z + 1.2 } : spawnPoint(w);
  e.x = e.px = pos.x;
  e.z = e.pz = pos.z;
  e.vx = e.vz = 0;
  void db;
}

function spawnPoint(w: World): { x: number; z: number } {
  return { x: w.room.spawnX, z: w.room.spawnZ };
}

/** Place the shade (the Valkyrie's toll) when its room is entered. */
export function placeShade(w: World): void {
  const s = w.zone.shade;
  if (!s || s.node !== w.zone.node) return;
  if (w.entities.some((e) => e.kind === 'pickup' && e.pick?.kind === 'shade')) return;
  const p = spawnPickup(w, 'shade', s.x, s.z, s.amount);
  p.vx = p.vz = p.vy = 0;
  p.y = 0;
}
