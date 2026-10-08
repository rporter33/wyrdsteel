import type { GearSlot, Item, Rarity } from '../loot/item';

export type Alignment = 'human' | 'cyber';

export interface SkillAllocation {
  /** Ranks in the class tree, by node id. */
  cls: Record<string, number>;
  /** Separate pools per aspect, so swapping back loses nothing. */
  aspect: { human: Record<string, number>; cyber: Record<string, number> };
  respecs: number;
  swaps: number;
}

export interface CharmProgress {
  id: string;
  progress: number[];
  done: boolean;
}

export interface AutoSalvageRule {
  /** Salvage on pickup when rarity is at or below this, unless another rule keeps it. -1 disables. */
  maxRarity: number;
  /** Only salvage if the item is weaker than what is equipped in its slot. */
  onlyIfWorse: boolean;
  /** Keep anything with at least this many sockets. 0 disables. */
  keepSockets: number;
}

export interface CharacterState {
  name: string;
  cls: string;
  level: number;
  xp: number;
  bounty: number;
  alignment: Alignment | null;
  skills: SkillAllocation;
  equip: Record<GearSlot, Item | null>;
  inv: Item[];
  runes: Record<string, number>;
  mats: Record<string, number>;
  charms: CharmProgress[];
  blueprints: string[];
  recentSalvage: Item[];
  story: Record<string, number>;
  /** Ability ids bound to slots 1-4. */
  abilities: string[];
  autoSalvage: AutoSalvageRule;
  /** Highest rarity a boss has guaranteed so far (pity). */
  bossPity: Rarity | null;
  sigils: number;
  kills: Record<string, number>;
  deaths: number;
}

export const INVENTORY_SIZE = 40;
export const RECENT_SALVAGE = 10;

export function newCharacter(name: string, cls: string): CharacterState {
  return {
    name,
    cls,
    level: 1,
    xp: 0,
    bounty: 0,
    alignment: null,
    skills: { cls: {}, aspect: { human: {}, cyber: {} }, respecs: 0, swaps: 0 },
    equip: { melee: null, ranged: null, helm: null, chest: null, hands: null, legs: null, charm: null },
    inv: [],
    runes: {},
    mats: {},
    charms: [],
    blueprints: [],
    recentSalvage: [],
    story: {},
    abilities: [],
    autoSalvage: { maxRarity: -1, onlyIfWorse: true, keepSockets: 0 },
    bossPity: null,
    sigils: 0,
    kills: {},
    deaths: 0,
  };
}
