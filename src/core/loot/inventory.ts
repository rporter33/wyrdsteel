import type { ContentDb } from '../data/types';
import type { World } from '../sim/types';
import type { Command } from '../sim/commands';

/** Item commands (equip, salvage, craft, sockets, stash). Filled in with the loot milestone. */
export function applyItemCommand(_w: World, _slot: number, cmd: Command, _db: ContentDb): string | null {
  return `Unsupported: ${cmd.t}`;
}
