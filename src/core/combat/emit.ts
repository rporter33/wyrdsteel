import type { ContentDb } from '../data/types';
import type { World } from '../sim/types';
import { spawnShot } from './projectiles';
import { spawnEnemy } from '../sim/spawn';
import { AIM_UNIT } from '../input/frame';
import { spawnTurret } from './turret';

export function lobDist(x: number, z: number, ax: number, az: number): number {
  return Math.min(14, Math.sqrt((ax - x) * (ax - x) + (az - z) * (az - z)));
}

/** Scripted side effects of actions at their marked ticks: shots, summons, buffs, heals. */
export function emitSystem(w: World, db: ContentDb): void {
  const n = w.entities.length;
  for (let i = 0; i < n; i++) {
    const e = w.entities[i]!;
    if (e.dead || !e.act || e.hitstop > 0) continue;
    const def = db.actions[e.act.id];
    if (!def) continue;
    const t = e.act.t;
    if (def.shoot && def.shoot.at.includes(t)) {
      const sh = def.shoot;
      let arcDist: number | undefined;
      const pdef = db.projectiles[sh.proj];
      if (pdef && pdef.gravity > 0) {
        // Lobbed: land on the aim point (players) or the target (enemies).
        if (e.pl) {
          const inp = w.players[e.pl.slot]!.lastInput;
          arcDist = inp.ax || inp.az ? Math.min(12, Math.sqrt(inp.ax * inp.ax + inp.az * inp.az) * AIM_UNIT) : 7;
        } else {
          // Enemies lob at the point they telegraphed when the throw began, not wherever you are now.
          arcDist = lobDist(e.x, e.z, e.act.ax, e.act.az);
        }
      }
      for (let k = 0; k < sh.count; k++) {
        const side = sh.count === 1 ? 0 : k - (sh.count - 1) / 2;
        const c = side === 0 ? 1 : sh.spreadCos;
        const s = side === 0 ? 0 : sh.spreadSin * side;
        const dx = e.act.dx * c - e.act.dz * s;
        const dz = e.act.dx * s + e.act.dz * c;
        spawnShot(w, db, { owner: e, def: sh.proj, x: e.x + dx * (e.r + 0.3), z: e.z + dz * (e.r + 0.3), y: Math.min(e.h * 0.65, 2.4) + e.y, dx, dz, mult: sh.dmg, arcDist });
      }
    }
    if (def.spawn && t === def.spawn.at && def.spawn.def === 'turret') {
      spawnTurret(w, e, e.x + e.act.dx * 1.4, e.z + e.act.dz * 1.4);
    } else if (def.spawn && t === def.spawn.at) {
      for (let k = 0; k < def.spawn.count; k++) {
        const ox = (k - (def.spawn.count - 1) / 2) * 1.6;
        const s = spawnEnemy(w, db, def.spawn.def, e.x + e.act.dx * 2 + e.act.dz * ox, e.z + e.act.dz * 2 - e.act.dx * ox, e.level, []);
        if (s.ai) {
          s.ai.aggro = true;
          s.ai.enc = e.ai?.enc ?? -1;
        }
      }
    }
    if (def.buff && t === 1 && e.pl) {
      e.pl.buffDmg = def.buff.amt;
      e.pl.buffUntil = w.tick + def.buff.dur;
    }
    if (def.heal > 0 && t === 1) e.hp = Math.min(e.hpMax, e.hp + Math.round(e.hpMax * def.heal));
  }
}
