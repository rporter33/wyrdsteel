import type { ContentDb } from '../data/types';
import type { Entity, World } from '../sim/types';
import { TEAM_PLAYERS } from '../sim/types';
import { newEntity, byId } from '../sim/entity';
import { msToTicks } from '../sim/constants';
import { segmentBlocked } from '../level/grid';
import { spawnShot } from './projectiles';
import { profile } from './hits';

export function spawnTurret(w: World, owner: Entity, x: number, z: number): Entity {
  // One turret per player: a new one replaces the old.
  for (const e of w.entities) if (e.tur && e.tur.owner === owner.id) e.removeAt = w.tick + 1;
  const t = newEntity(w, 'prop', 'turret', TEAM_PLAYERS, x, z);
  t.r = 0.45;
  t.h = 1.2;
  const slot = owner.pl ? w.players[owner.pl.slot] : null;
  const long = slot?.stats.flags.includes('cap.overwatch');
  t.tur = { owner: owner.id, life: msToTicks(long ? 24000 : 12000), cd: 20 };
  return t;
}

/** Turrets shoot the nearest visible enemy within 13 m, with their owner's ranged profile. */
export function turretSystem(w: World, db: ContentDb): void {
  for (const t of w.entities) {
    if (!t.tur) continue;
    if (--t.tur.life <= 0) {
      t.removeAt = w.tick + 1;
      continue;
    }
    if (t.tur.cd > 0) {
      t.tur.cd--;
      continue;
    }
    const owner = byId(w, t.tur.owner);
    if (!owner) continue;
    let best: Entity | null = null;
    let bd = 13 * 13;
    for (const e of w.entities) {
      if (e.kind !== 'enemy' || e.dead) continue;
      if (e.ai && (e.ai.st === 'travel' || e.ai.st === 'burrowed')) continue;
      const d = (e.x - t.x) * (e.x - t.x) + (e.z - t.z) * (e.z - t.z);
      if (d < bd && !segmentBlocked(w.room, t.x, t.z, e.x, e.z)) {
        bd = d;
        best = e;
      }
    }
    if (!best) continue;
    const d = Math.sqrt(bd) || 1;
    const dx = (best.x - t.x) / d;
    const dz = (best.z - t.z) / d;
    t.fx = dx;
    t.fz = dz;
    const prof = profile(w, db, owner, true);
    spawnShot(w, db, { owner: t, def: 'round', x: t.x + dx * 0.5, z: t.z + dz * 0.5, y: 1.0, dx, dz, mult: 0.55, prof });
    t.tur.cd = msToTicks(450);
  }
}
