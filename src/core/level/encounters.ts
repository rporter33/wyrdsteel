import type { ContentDb } from '../data/types';
import type { EncounterState, World } from '../sim/types';
import { spawnEnemy } from '../sim/spawn';
import { blocksMove, tileAt } from './grid';
import { sin, cos, TAU } from '../math/trig';
import { msToTicks } from '../sim/constants';
import { byId } from '../sim/entity';

const ACTIVATE_R = 7.5;

/** Spawn one wave on walkable tiles in a ring around the encounter's marker. */
function spawnWave(w: World, db: ContentDb, enc: EncounterState): void {
  const ids = enc.waves[enc.wave] ?? [];
  const n = ids.length;
  enc.alive = [];
  ids.forEach((id, k) => {
    let x = enc.x;
    let z = enc.z;
    for (let tries = 0; tries < 8; tries++) {
      const a = (TAU * (k + tries * 0.37)) / Math.max(1, n);
      const r = 2.2 + (k % 3) * 1.1 + tries * 0.4;
      const cx = enc.x + cos(a) * r;
      const cz = enc.z + sin(a) * r;
      if (!blocksMove(tileAt(w.room, Math.floor(cx), Math.floor(cz)))) {
        x = cx;
        z = cz;
        break;
      }
    }
    // Elite affixes go on the toughest enemy of the final wave.
    const last = enc.wave === enc.waves.length - 1;
    const e = spawnEnemy(w, db, id, x, z, enc.level, []);
    e.ai!.enc = enc.id;
    e.ai!.aggro = enc.wave > 0;
    enc.alive.push(e.id);
    void last;
  });
  if (enc.wave === enc.waves.length - 1 && enc.elite.length) {
    let best = -1;
    let hp = -1;
    for (const id of enc.alive) {
      const e = byId(w, id)!;
      if (e.hpMax > hp) {
        hp = e.hpMax;
        best = id;
      }
    }
    const e = byId(w, best);
    if (e) {
      e.elite = [...enc.elite];
      let mult = 1;
      for (const el of enc.elite) mult *= db.elites[el]?.hpMult ?? 1;
      e.hpMax = Math.round(e.hpMax * mult);
      e.hp = e.hpMax;
      if (enc.elite.includes('linked')) {
        const partner = enc.alive.map((i) => byId(w, i)!).find((o) => o.id !== e.id);
        if (partner) {
          e.ai!.link = partner.id;
          partner.ai!.link = e.id;
          partner.elite = ['linked'];
        }
      }
    }
  }
  w.events.push({ k: 'encounter', t: w.tick, id: enc.id, state: enc.wave === 0 ? 'start' : 'wave' });
}

/** Encounters wake when a player comes close, run their waves, and open the exits when done. */
export function encounterSystem(w: World, db: ContentDb): void {
  const room = w.room;
  for (const enc of room.encounters) {
    if (enc.state === 'done') continue;
    if (enc.state === 'idle') {
      const near = w.entities.some((p) => p.kind === 'player' && !p.dead && (p.x - enc.x) * (p.x - enc.x) + (p.z - enc.z) * (p.z - enc.z) < ACTIVATE_R * ACTIVATE_R);
      if (near) {
        enc.state = 'active';
        enc.wave = 0;
        spawnWave(w, db, enc);
      }
      continue;
    }
    enc.alive = enc.alive.filter((id) => {
      const e = byId(w, id);
      return !!e && !e.dead;
    });
    // Late spawns (reinforcements, summons) belong to the encounter too.
    for (const e of w.entities) if (e.kind === 'enemy' && !e.dead && e.ai?.enc === enc.id && !enc.alive.includes(e.id)) enc.alive.push(e.id);
    if (enc.alive.length) continue;
    if (enc.wave + 1 < enc.waves.length) {
      enc.wave++;
      spawnWave(w, db, enc);
    } else {
      enc.state = 'done';
      w.events.push({ k: 'encounter', t: w.tick, id: enc.id, state: 'done' });
    }
  }
  if (!room.cleared && room.encounters.length && room.encounters.every((e) => e.state === 'done')) {
    room.cleared = true;
    for (const ex of room.exits) ex.open = true;
    if (!w.zone.cleared.includes(w.zone.node)) w.zone.cleared.push(w.zone.node);
  }
  if (!room.encounters.length) for (const ex of room.exits) ex.open = true;
}

/**
 * After a player death, unfinished encounters reset to their authored state: their enemies leave
 * and they wait to be triggered again. Finished encounters stay finished; nothing respawns.
 */
export function resetActiveEncounters(w: World): void {
  for (const enc of w.room.encounters) {
    if (enc.state !== 'active') continue;
    for (const e of w.entities) if (e.kind === 'enemy' && e.ai?.enc === enc.id) {
      e.dead = true;
      e.removeAt = w.tick + 1;
    }
    enc.state = 'idle';
    enc.wave = 0;
    enc.alive = [];
  }
  // Projectiles in flight vanish with them.
  for (const e of w.entities) if (e.kind === 'projectile') {
    e.dead = true;
    e.removeAt = w.tick + 1;
  }
}

export const RESPAWN_TICKS = msToTicks(2500);
export const SKIP_AFTER = msToTicks(300);
