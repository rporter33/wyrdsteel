import { msToTicks } from '../sim/constants';
import { ST_BURN, ST_CHILL, ST_ROOT, ST_SHOCK, type Entity, type StatusId, type World } from '../sim/types';

const IDX: Record<StatusId, number> = { root: ST_ROOT, chill: ST_CHILL, burn: ST_BURN, shock: ST_SHOCK };
const ROOT_T = msToTicks(1500);
const CHILL_T = msToTicks(3000);
const FREEZE_T = msToTicks(1200);
const BURN_T = msToTicks(3000);
const SHOCK_STUN = msToTicks(200);
/** Build-up bleeds off this much per tick (10 per second). */
const DECAY = 10 / 60;
const CCRES_DECAY = 0.05 / 60;

/**
 * Statuses build up instead of rolling a chance: each hit adds to a meter, and reaching 100
 * applies the status. Repeated crowd control raises a resistance that decays over time, so a
 * target can't be held forever (bosses resist twice as fast).
 */
export function addBuildup(w: World, t: Entity, k: StatusId, amt: number, resist: number, boss: boolean): StatusId | 'freeze' | null {
  if (t.dead || amt <= 0) return null;
  const i = IDX[k];
  t.status.b[i] = Math.min(100, t.status.b[i]! + amt * (1 - resist));
  if (t.status.b[i]! < 100) return null;
  t.status.b[i] = 0;
  const cc = 1 - t.status.ccRes;
  switch (k) {
    case 'root':
      t.status.root = Math.round(ROOT_T * cc);
      t.status.ccRes = Math.min(0.9, t.status.ccRes + (boss ? 0.5 : 0.25));
      return 'root';
    case 'chill':
      if (t.status.chill > 0 || t.status.freeze > 0) {
        t.status.freeze = Math.round(FREEZE_T * cc);
        t.status.chill = 0;
        t.status.ccRes = Math.min(0.9, t.status.ccRes + (boss ? 0.5 : 0.25));
        t.act = null;
        return 'freeze';
      }
      t.status.chill = CHILL_T;
      t.status.burn = 0;
      return 'chill';
    case 'burn':
      t.status.burn = BURN_T;
      t.status.burnDmg = Math.max(1, Math.round(t.hpMax * (t.kind === 'player' ? 0.006 : 0.012)));
      t.status.chill = 0;
      t.status.freeze = 0;
      return 'burn';
    case 'shock':
      t.status.shock = SHOCK_STUN;
      if (!boss && t.act) t.act = null;
      return 'shock';
  }
  void w;
  return null;
}

export function statusSystem(w: World): void {
  for (const e of w.entities) {
    if (e.dead || (e.kind !== 'enemy' && e.kind !== 'player')) continue;
    const s = e.status;
    for (let i = 0; i < 4; i++) if (s.b[i]! > 0) s.b[i] = Math.max(0, s.b[i]! - DECAY);
    if (s.root > 0) s.root--;
    if (s.chill > 0) s.chill--;
    if (s.freeze > 0) s.freeze--;
    if (s.shock > 0) s.shock--;
    if (s.ccRes > 0) s.ccRes = Math.max(0, s.ccRes - CCRES_DECAY);
    if (s.burn > 0) {
      s.burn--;
      // Burn ticks twice a second.
      if (s.burn % 30 === 0) {
        e.hp -= s.burnDmg;
        e.hurtAt = w.tick;
        w.events.push({ k: 'hit', t: w.tick, src: e.lastHit, dst: e.id, dmg: s.burnDmg, crit: false, weak: false, x: e.x, y: e.y + e.h * 0.6, z: e.z, heavy: false, status: 'burn' });
      }
    }
  }
}

export function isFrozen(e: Entity): boolean {
  return e.status.freeze > 0;
}
