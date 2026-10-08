import type { ContentDb } from '../../data/types';
import type { World } from '../types';
import { msToTicks } from '../constants';
import { onBossDeath } from '../../ai/boss';

export type DeathHook = (w: World, db: ContentDb, deadId: number) => void;

/**
 * Anything at zero HP dies here, once. Rewards (XP, drops, quest progress) and the player's
 * Valkyrie respawn hang off the death event in their own systems.
 */
export function deathSystem(w: World, db: ContentDb, onDeath: DeathHook[]): void {
  for (const e of w.entities) {
    if (e.dead || (e.kind !== 'enemy' && e.kind !== 'player')) continue;
    // A boss phase ends at its floor: no burst, burn or vent pushes past it.
    if (e.boss && e.hp < e.boss.floor) e.hp = e.boss.floor;
    if (e.hp > 0) continue;
    if (e.kind === 'enemy' && db.enemies[e.def]?.brain === 'dummy') {
      e.hp = 1;
      continue;
    }
    e.hp = 0;
    e.dead = true;
    e.act = null;
    e.vx = 0;
    e.vz = 0;
    if (e.kind === 'enemy') e.removeAt = w.tick + msToTicks(1500);
    w.events.push({ k: 'death', t: w.tick, src: e.id, def: e.def, x: e.x, z: e.z, killer: e.lastHit });
    for (const h of onDeath) h(w, db, e.id);
    if (e.boss) onBossDeath(w, e);
  }
}
