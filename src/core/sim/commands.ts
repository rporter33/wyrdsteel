import type { ContentDb } from '../data/types';
import type { World } from './types';

/**
 * Menu actions (equip, salvage, allocate a skill point...) are commands, not direct mutations, so
 * replays and co-op peers apply the same changes at the same point in the tick stream.
 */
export type Command =
  | { t: 'equip'; uid: string }
  | { t: 'unequip'; slot: string }
  | { t: 'salvage'; uids: string[] }
  | { t: 'unsalvage'; uid: string }
  | { t: 'allocSkill'; node: string; tree: 'cls' | 'human' | 'cyber' }
  | { t: 'respec' }
  | { t: 'chooseAlignment'; a: 'human' | 'cyber' }
  | { t: 'swapAspect' }
  | { t: 'craft'; blueprint: string }
  | { t: 'socket'; uid: string; rune: string; idx: number }
  | { t: 'fuseRunes'; rune: string }
  | { t: 'addSocket'; uid: string }
  | { t: 'setAbility'; idx: number; ability: string }
  | { t: 'setCharm'; charm: string }
  | { t: 'takeQuest'; charm: string }
  | { t: 'setAutoSalvage'; maxRarity: number; onlyIfWorse: boolean; keepSockets: number }
  | { t: 'story'; key: string; value: number }
  | { t: 'travel'; zone: string; node: string; trial?: number; mods?: string[] }
  | { t: 'flask' }
  | { t: 'stash'; uid: string; dir: 'in' | 'out' };

export type CommandHandler = (w: World, slot: number, c: Command, db: ContentDb) => string | null;

const handlers: CommandHandler[] = [];

/** Handlers return null if they handled the command, or an error string; unknown ones are ignored. */
export function registerCommandHandler(h: CommandHandler): void {
  if (!handlers.includes(h)) handlers.push(h);
}

export function applyCommands(w: World, slot: number, cmds: Command[], db: ContentDb): string[] {
  const errors: string[] = [];
  for (const c of cmds) {
    for (const h of handlers) {
      const r = h(w, slot, c, db);
      if (r === 'skip') continue;
      if (r) errors.push(r);
      break;
    }
  }
  return errors;
}
