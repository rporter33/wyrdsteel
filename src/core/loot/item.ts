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
