import type { ContentDb } from '../data/types';
import type { PlayerInput } from '../input/frame';
import type { Entity, PlayerSlot, World } from '../sim/types';

/** Melee strings, ranged fire, abilities and lock-on. Filled in with the combat milestone. */
export function attackControl(
  _w: World,
  _db: ContentDb,
  _p: PlayerSlot,
  _e: Entity,
  _inp: PlayerInput,
  _aim: [number, number] | null,
  _move: [number, number] | null,
): void {}
