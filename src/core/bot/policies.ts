import { BTN, emptyInput, quantizeAim, quantizeMove, type PlayerInput } from '../input/frame';
import type { ContentDb } from '../data/types';
import type { Entity, SimEvent, World } from '../sim/types';
import { byId } from '../sim/entity';
import { boundAbilities } from '../combat/attack';

export type Policy = 'tactical' | 'mash' | 'kite';

export interface BotMemory {
  /** Telegraphs seen recently that might cover the bot: shape, place, and when they land. */
  threats: { x: number; z: number; r: number; until: number; line: boolean; dx: number; dz: number; len: number; w: number }[];
  t: number;
}

export function newMemory(): BotMemory {
  return { threats: [], t: 0 };
}

function nearestEnemy(w: World, e: Entity): Entity | null {
  let best: Entity | null = null;
  let bd = Infinity;
  for (const o of w.entities) {
    if (o.kind !== 'enemy' || o.dead) continue;
    if (o.ai && (o.ai.st === 'travel' || o.ai.st === 'burrowed')) continue;
    const d = (o.x - e.x) * (o.x - e.x) + (o.z - e.z) * (o.z - e.z);
    // Bosses' guardians and menders first? Tactical bots go for the closest; good enough.
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

function inThreat(e: Entity, th: BotMemory['threats'][number]): boolean {
  if (th.line) {
    const vx = e.x - th.x;
    const vz = e.z - th.z;
    const along = vx * th.dx + vz * th.dz;
    const across = Math.abs(vx * -th.dz + vz * th.dx);
    return along > -1 && along < th.len + 1 && across < th.w / 2 + 0.8;
  }
  return (e.x - th.x) * (e.x - th.x) + (e.z - th.z) * (e.z - th.z) < (th.r + 0.8) * (th.r + 0.8);
}

/**
 * Scripted players for the balance suite. They see what a player sees (positions, telegraph
 * decals) and act only through PlayerInput, so they exercise exactly the controls people use.
 */
export function botInput(w: World, db: ContentDb, slot: number, policy: Policy, mem: BotMemory, events: SimEvent[]): PlayerInput {
  const p = w.players[slot]!;
  const e = byId(w, p.entity);
  const inp = emptyInput();
  mem.t++;
  if (!e || e.dead) {
    inp.pressed = BTN.skip;
    return inp;
  }
  for (const ev of events) {
    if (ev.k === 'telegraph') mem.threats.push({ x: ev.x, z: ev.z, r: ev.r, until: w.tick + ev.dur + 4, line: ev.shape === 'line', dx: ev.dx, dz: ev.dz, len: ev.len, w: ev.width });
  }
  mem.threats = mem.threats.filter((t) => t.until > w.tick);
  const t = nearestEnemy(w, e);
  if (!t) {
    // Walk toward any burrower or encounter: just drift to centre.
    const [mx, mz] = quantizeMove(w.room.spawnX - e.x, w.room.spawnZ - e.z);
    inp.mx = mx;
    inp.mz = mz;
    return inp;
  }
  const dx = t.x - e.x;
  const dz = t.z - e.z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  const [ax, az] = quantizeAim(dx, dz);
  inp.ax = ax;
  inp.az = az;
  const ranged = p.character.cls === 'commando';

  if (policy === 'mash') {
    if (ranged) {
      inp.held = BTN.fire;
    } else {
      const [mx, mz] = quantizeMove(dx, dz);
      if (d > 1.8) {
        inp.mx = mx;
        inp.mz = mz;
      }
      if (mem.t % 6 === 0) inp.pressed = BTN.light;
    }
    return inp;
  }

  // Tactical: dodge out of telegraphed ground first, perpendicular to the threat.
  const threat = mem.threats.find((th) => inThreat(e, th) && th.until - w.tick < 22);
  if (threat && e.pl!.dodges > 0) {
    let ox = e.x - threat.x;
    let oz = e.z - threat.z;
    if (threat.line) {
      ox = -threat.dz;
      oz = threat.dx;
    }
    const [mx, mz] = quantizeMove(ox || 1, oz);
    inp.mx = mx;
    inp.mz = mz;
    inp.pressed = BTN.dodge;
    return inp;
  }
  if (e.hp < e.hpMax * 0.4 && e.pl!.flasks > 0 && !e.act) {
    inp.pressed = BTN.flask;
    return inp;
  }
  // Abilities when ready and something is in reach.
  const abil = boundAbilities(p, db);
  for (let i = 0; i < abil.length; i++) {
    if (e.pl!.cds[i] === 0 && abil[i] && d < (ranged ? 10 : 4) && mem.t % 3 === 0) {
      inp.pressed = [BTN.ab1, BTN.ab2, BTN.ab3, BTN.ab4][i]!;
      return inp;
    }
  }
  if (e.pl!.ruin >= 100) {
    inp.pressed = BTN.ruiner;
    return inp;
  }
  // Kneeling heavy: climb it.
  if (t.stunKind === 2 && t.parts && d < t.r + 1.5) {
    inp.pressed = BTN.interact;
    return inp;
  }
  if (ranged || policy === 'kite') {
    // Hold the band; strafe around the target; shoot.
    const want = 8;
    let mx = 0;
    let mz = 0;
    if (d < want - 2) {
      mx = -dx;
      mz = -dz;
    } else if (d > want + 2) {
      mx = dx;
      mz = dz;
    } else {
      mx = -dz;
      mz = dx;
    }
    [inp.mx, inp.mz] = quantizeMove(mx, mz);
    inp.held = BTN.fire;
    // Guarded enemies from the front: lob instead (ability 1 is the grenade).
    return inp;
  }
  // Melee: close in, string lights, launch and slam light targets, heavy against guards.
  const def = db.enemies[t.def];
  if (d > 1.9 + t.r) {
    [inp.mx, inp.mz] = quantizeMove(dx, dz);
    return inp;
  }
  const cycle = mem.t % 40;
  if (def?.guard === 'front' && t.fx * -dx / d + t.fz * -dz / d > 0.3) {
    if (cycle === 0) inp.pressed = BTN.heavy;
    else [inp.mx, inp.mz] = quantizeMove(-dz, dx);
  } else if (def?.weight === 'light' && cycle === 0 && mem.t % 160 < 40) {
    inp.pressed = BTN.launcher;
    inp.held = BTN.launcher;
  } else if (cycle % 9 === 0) {
    inp.pressed = BTN.light;
  }
  if (e.y > 0.3 && cycle % 9 === 0) inp.pressed = BTN.light;
  return inp;
}
