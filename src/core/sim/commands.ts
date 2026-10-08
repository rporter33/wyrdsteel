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
  | { t: 'stash'; uid: string; dir: 'in' | 'out' }
  | { t: 'assist'; value: number }
  | { t: 'difficulty'; value: 0 | 1 | 2 };
