export type Rarity = 'worn' | 'forged' | 'runed' | 'ascendant' | 'relic';
export const RARITIES: Rarity[] = ['worn', 'forged', 'runed', 'ascendant', 'relic'];

export type GearSlot = 'melee' | 'ranged' | 'helm' | 'chest' | 'hands' | 'legs' | 'charm';
export const GEAR_SLOTS: GearSlot[] = ['melee', 'ranged', 'helm', 'chest', 'hands', 'legs', 'charm'];

export interface ItemAffix {
  id: string;
  v: number;
}

export interface Item {
  uid: string;
  base: string;
  rarity: Rarity;
  ilvl: number;
  affixes: ItemAffix[];
  /** Rune ids, or null for an empty socket. */
  sockets: (string | null)[];
  seed: number;
  /** Unique effect id for relics. */
  unique: string | null;
  v: 1;
}

export function rarityIndex(r: Rarity): number {
  return RARITIES.indexOf(r);
}

/** A plain item with fixed affixes (quest rewards, starting gear). Random rolls live in generate.ts. */
export function makeItem(base: string, rarity: Rarity, ilvl: number, uid: string, affixes: ItemAffix[], sockets = 0): Item {
  return { uid, base, rarity, ilvl, affixes, sockets: Array.from({ length: sockets }, () => null), seed: 0, unique: null, v: 1 };
}
