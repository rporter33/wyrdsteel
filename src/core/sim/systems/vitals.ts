import type { ContentDb } from '../../data/types';
import type { World } from '../types';

/** Stun timers, poise regeneration, and the training dummy's patience. */
export function vitalsSystem(w: World, db: ContentDb): void {
  for (const e of w.entities) {
    if (e.dead || (e.kind !== 'enemy' && e.kind !== 'player')) continue;
    if (e.hitstop > 0) continue;
    if (e.stun > 0) {
      // Airborne targets stay stunned until they land.
      if (e.y <= 0.05 || e.stunKind !== 2) e.stun--;
      if (e.stun === 0) e.stunKind = 0;
    }
    if (e.status.freeze > 0) e.stunKind = 3;
    else if (e.stunKind === 3) e.stunKind = 0;
    if (e.poise < e.poiseMax && w.tick >= e.poiseAt && w.tick - e.hurtAt > 90) e.poise = Math.min(e.poiseMax, e.poise + e.poiseMax / 60);
    if (e.kind === 'enemy' && db.enemies[e.def]?.brain === 'dummy' && w.tick - e.hurtAt > 180 && e.hp < e.hpMax) {
      e.hp = e.hpMax;
      if (e.parts) for (const p of e.parts) {
        p.hp = p.hpMax;
        p.broken = false;
      }
    }
  }
}
