import type { Entity, World } from './types';
import { TEAM_NEUTRAL } from './types';
import { newEntity } from './entity';
import { nextFloat } from '../rng/xoshiro';

export function spawnPickup(w: World, kind: 'bounty' | 'heal' | 'shade' | 'item' | 'rune' | 'mat', x: number, z: number, amount: number, ref = '', owner = -1): Entity {
  const p = newEntity(w, 'pickup', kind, TEAM_NEUTRAL, x, z);
  p.r = 0.3;
  p.h = 0.5;
  p.pick = { kind, owner, ref, amount, item: null };
  // A small hop so drops scatter visibly.
  const a = nextFloat(w.rng.combat) * 6.283;
  p.vx = (a < 3.14 ? 1 : -1) * (0.6 + nextFloat(w.rng.combat) * 1.2);
  p.vz = (a % 2 < 1 ? 1 : -1) * (0.6 + nextFloat(w.rng.combat) * 1.2);
  p.vy = 4;
  p.y = 0.1;
  return p;
}

