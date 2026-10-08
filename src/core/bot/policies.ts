import { BTN, emptyInput, quantizeAim, quantizeMove, type PlayerInput } from '../input/frame';
import type { ContentDb } from '../data/types';
import type { Entity, SimEvent, World } from '../sim/types';
import { byId } from '../sim/entity';
import { boundAbilities } from '../combat/attack';
import { flowField, flowDir } from '../nav/flowfield';
import { T_CRACKED, blocksMove, segmentBlocked, tileAt } from '../level/grid';

export type Policy = 'tactical' | 'mash' | 'kite';

export interface BotMemory {
  /** Telegraphs seen recently that might cover the bot: shape, place, and when they land. */
  threats: { x: number; z: number; r: number; until: number; line: boolean; dx: number; dz: number; len: number; w: number }[];
  t: number;
}

export function newMemory(): BotMemory {
  return { threats: [], t: 0 };
}

/**
 * Shield pylons first while a bulwark lives (they make bulwarks invulnerable); a guardian mid-channel
 * (break it or the boss re-plates); an exposed boss heart; then the nearest.
 */
function botTarget(w: World, e: Entity): Entity | null {
  const channel = w.entities.find((o) => o.kind === 'enemy' && !o.dead && o.ai?.st === 'channel');
  if (channel) return channel;
  const boss = w.entities.find((o) => o.boss && !o.dead);
  if (boss && (boss.boss!.exposed > 0 || !w.entities.some((o) => o.kind === 'enemy' && !o.dead && o !== boss && o.def !== 'bulwark'))) return boss;
  const pylon = w.entities.find((o) => o.def === 'generator' && !o.dead);
  if (pylon && w.entities.some((o) => o.def === 'bulwark' && !o.dead)) return pylon;
  return nearestEnemy(w, e);
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

/** Solid, uncracked ground at a point. */
function clear(w: World, x: number, z: number): boolean {
  const t = tileAt(w.room, Math.floor(x), Math.floor(z));
  return !blocksMove(t) && t !== T_CRACKED;
}

/**
 * The wanted direction, turned as little as possible to keep `reach` metres of clear ground ahead:
 * a kiting bot slides along the arena wall instead of backing into it.
 */
function clearDir(w: World, e: Entity, dx: number, dz: number, reach: number): [number, number] {
  const l = Math.sqrt(dx * dx + dz * dz) || 1;
  const ux = dx / l;
  const uz = dz / l;
  // Rotations of 0, ±45, ±90, ±135 degrees (cos, sin pairs), nearest first.
  const R: [number, number][] = [
    [1, 0],
    [0.7071, 0.7071],
    [0.7071, -0.7071],
    [0, 1],
    [0, -1],
    [-0.7071, 0.7071],
    [-0.7071, -0.7071],
  ];
  for (const [c, s] of R) {
    const rx = ux * c - uz * s;
    const rz = ux * s + uz * c;
    if (clear(w, e.x + rx * reach, e.z + rz * reach) && clear(w, e.x + rx * reach * 0.5, e.z + rz * reach * 0.5)) return [rx, rz];
  }
  return [ux, uz];
}

/** Toward a point: straight when the way is clear, else down the room's flow field around walls. */
function walkDir(w: World, e: Entity, tx: number, tz: number): [number, number] {
  if (!segmentBlocked(w.room, e.x, e.z, tx, tz, blocksMove)) return [tx - e.x, tz - e.z];
  const field = flowField(w.room, `${w.room.id}:${w.room.variant}:${w.room.ver}`, Math.floor(tx), Math.floor(tz));
  return flowDir(w.room, field, e.x, e.z) ?? [tx - e.x, tz - e.z];
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
  const t = botTarget(w, e);
  if (!t) return explore(w, e, inp, slot);
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

  // Tactical: off cracking ground first (it is about to fall into the spring), toward the boss's centre.
  const boss = w.entities.find((o) => o.boss && !o.dead);
  if (boss && tileAt(w.room, Math.floor(e.x), Math.floor(e.z)) === T_CRACKED) {
    [inp.mx, inp.mz] = quantizeMove(boss.boss!.cx - e.x, boss.boss!.cz - e.z);
    return inp;
  }
  // Dodge out of telegraphed ground, perpendicular to the threat; with no dodge left, walk out early.
  const threat = mem.threats.find((th) => inThreat(e, th) && th.until - w.tick < (e.pl!.dodges > 0 ? 22 : 70));
  if (threat && e.pl!.dodges === 0) {
    let ox = e.x - threat.x;
    let oz = e.z - threat.z;
    if (threat.line) {
      const side = (e.x - threat.x) * -threat.dz + (e.z - threat.z) * threat.dx >= 0 ? 1 : -1;
      ox = -threat.dz * side;
      oz = threat.dx * side;
    }
    [inp.mx, inp.mz] = quantizeMove(...clearDir(w, e, ox || 1, oz, 2));
    return inp;
  }
  if (threat && e.pl!.dodges > 0) {
    let ox = e.x - threat.x;
    let oz = e.z - threat.z;
    if (threat.line) {
      // Out of a charge's lane: whichever side of it we already stand on.
      const side = (e.x - threat.x) * -threat.dz + (e.z - threat.z) * threat.dx >= 0 ? 1 : -1;
      ox = -threat.dz * side;
      oz = threat.dx * side;
    }
    const [cx, cz] = clearDir(w, e, ox || 1, oz, 4.2);
    const [mx, mz] = quantizeMove(cx, cz);
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
  const tdef = db.enemies[t.def];
  const guardedFromUs = tdef?.guard === 'front' && t.fx * -dx / d + t.fz * -dz / d > 0.3;
  // Shots break on a shield: lob a grenade over it if one is ready, else draw steel and break the
  // guard with heavy blows, as the Berserker does.
  let melee = !ranged;
  if (ranged && guardedFromUs) {
    const gi = abil.indexOf('cmdo.grenade');
    if (gi >= 0 && e.pl!.cds[gi] === 0 && d < 12) {
      inp.pressed = [BTN.ab1, BTN.ab2, BTN.ab3, BTN.ab4][gi]!;
      return inp;
    }
    melee = true;
  }
  if (!melee || policy === 'kite') {
    // Hold the band; strafe around the target; shoot.
    const want = 8;
    let mx = 0;
    let mz = 0;
    if (d < want - 2) {
      mx = -dx;
      mz = -dz;
    } else if (d > want + 2 || segmentBlocked(w.room, e.x, e.z, t.x, t.z)) {
      [mx, mz] = walkDir(w, e, t.x, t.z);
    } else {
      mx = -dz;
      mz = dx;
    }
    [mx, mz] = clearDir(w, e, mx, mz, 2.5);
    [inp.mx, inp.mz] = quantizeMove(mx, mz);
    inp.held = BTN.fire;
    // Guarded enemies from the front: lob instead (ability 1 is the grenade).
    return inp;
  }
  // Melee: close in, string lights, launch and slam light targets, heavy against guards.
  const def = db.enemies[t.def];
  // Respect the telegraph: don't walk into ground that is about to be hit; wait at its edge.
  const marked = mem.threats.find((th) => !th.line && th.until - w.tick < 80 && (t.x - th.x) * (t.x - th.x) + (t.z - th.z) * (t.z - th.z) < th.r * th.r);
  if (marked && !inThreat(e, marked)) {
    [inp.mx, inp.mz] = quantizeMove(...clearDir(w, e, -(t.z - e.z), t.x - e.x, 1.5));
    inp.mx = Math.round(inp.mx * 0.3);
    inp.mz = Math.round(inp.mz * 0.3);
    return inp;
  }
  if (d > 1.9 + t.r) {
    [inp.mx, inp.mz] = quantizeMove(...walkDir(w, e, t.x, t.z));
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

/**
 * With nothing to fight: walk to the next unfinished encounter, then to an open exit (the first
 * one, which is the critical path). Uses the room's flow field, like the enemies do.
 */
function explore(w: World, e: Entity, inp: PlayerInput, slot: number): PlayerInput {
  let tx: number | null = null;
  let tz: number | null = null;
  // Loot first, as a player would: the nearest item, rune or flask on the floor that is ours.
  let best = Infinity;
  for (const it of w.entities) {
    if (it.kind !== 'pickup' || it.dead || !it.pick || it.pick.kind === 'bounty') continue;
    if (it.pick.owner >= 0 && it.pick.owner !== slot) continue;
    if (it.pick.kind === 'heal' && e.hp >= e.hpMax) continue;
    const d = (it.x - e.x) * (it.x - e.x) + (it.z - e.z) * (it.z - e.z);
    if (d < best && d < 30 * 30 && !blocksMove(tileAt(w.room, Math.floor(it.x), Math.floor(it.z)))) {
      best = d;
      tx = it.x;
      tz = it.z;
    }
  }
  // Then unopened chests: walk up and open them.
  if (tx === null) {
    const chest = w.room.features.find((f) => f.kind === 'chest' && f.a === 0 && w.room.cleared);
    if (chest) {
      if ((chest.x - e.x) * (chest.x - e.x) + (chest.z - e.z) * (chest.z - e.z) < 1.8 * 1.8) {
        inp.pressed = BTN.interact;
        return inp;
      }
      tx = chest.x;
      tz = chest.z;
    }
  }
  const enc = tx === null ? w.room.encounters.find((x) => x.state !== 'done') : undefined;
  if (tx !== null) {
    // Already chosen.
  } else if (enc) {
    tx = enc.x;
    tz = enc.z;
  } else {
    const ex = w.room.exits.find((x) => x.open && x.to);
    if (ex) {
      tx = ex.x;
      tz = ex.z;
    }
  }
  if (tx === null || tz === null) return inp;
  const field = flowField(w.room, `${w.room.id}:${w.room.variant}:${w.room.ver}`, Math.floor(tx), Math.floor(tz));
  const dir = flowDir(w.room, field, e.x, e.z) ?? [tx - e.x, tz - e.z];
  [inp.mx, inp.mz] = quantizeMove(dir[0], dir[1]);
  return inp;
}
