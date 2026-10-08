import type { ContentDb } from '../data/types';
import type { Entity, World } from '../sim/types';
import { nextFloat, nextInt, mix } from '../rng/xoshiro';
import { generateItem } from './generate';
import { RARITIES, rarityIndex } from './item';
import { spawnPickup } from '../sim/pickups';
import { rarityShift, shiftWeights } from '../level/trials';

const RUNE_FAMILIES = ['tyr', 'uruz', 'sowilo', 'algiz', 'raido', 'kaun', 'isa', 'thurs', 'naud'];
const MATS = ['mat.iron', 'mat.iron', 'mat.iron', 'mat.rune', 'mat.star'];

/**
 * Loot is per player: each player rolls on their own stream and sees their own drops, so co-op
 * never fights over an item and adding a player never changes what another one finds.
 */
export function dropLoot(w: World, db: ContentDb, e: Entity, elite: boolean): void {
  const def = db.enemies[e.def];
  if (!def) return;
  const table = db.drops[elite && def.drop === 'common' ? 'elite' : def.drop] ?? db.drops.common!;
  w.players.forEach((p, slot) => {
    const r = w.rng.loot[slot]!;
    const ilvl = Math.max(1, e.level + (elite ? 1 : 0));
    if (nextFloat(r) < table.itemChance) {
      const seed = mix(w.seed, w.tick, e.id, slot);
      // Bosses guarantee Ascendant or better the first time (pity).
      const pity = def.drop === 'boss' && !p.character.bossPity ? 'ascendant' : undefined;
      const weights = shiftWeights(table.rarityWeights, rarityShift(w, db));
      const item = generateItem(seed, { ilvl, cls: p.character.cls, weights, minRarity: pity }, db);
      if (pity) p.character.bossPity = item.rarity;
      const pk = spawnPickup(w, 'item', e.x, e.z, 1, item.uid, slot);
      pk.pick!.item = item;
      w.events.push({ k: 'drop', t: w.tick, id: pk.id, rarity: item.rarity });
    }
    if (nextFloat(r) < table.runeChance) {
      const fam = RUNE_FAMILIES[nextInt(r, RUNE_FAMILIES.length)]!;
      const tier = def.drop === 'boss' ? 2 : 1;
      spawnPickup(w, 'rune', e.x, e.z, 1, `rune.${fam}.${tier}`, slot);
    }
    if (nextFloat(r) < table.matChance) {
      const m = MATS[nextInt(r, MATS.length)]!;
      spawnPickup(w, 'mat', e.x, e.z, 1 + nextInt(r, 3), m, slot);
    }
  });
}

/** Chests: a guaranteed item, often a blueprint the opener doesn't have yet. */
export function openChest(w: World, db: ContentDb, slot: number, x: number, z: number, level: number): void {
  const p = w.players[slot]!;
  const r = w.rng.loot[slot]!;
  const table = db.drops.chest!;
  const item = generateItem(mix(w.seed, w.tick, 0xc4e57, slot), { ilvl: level + 1, cls: p.character.cls, weights: table.rarityWeights }, db);
  const pk = spawnPickup(w, 'item', x, z, 1, item.uid, slot);
  pk.pick!.item = item;
  spawnPickup(w, 'bounty', x, z, table.bounty[0] + nextInt(r, table.bounty[1] - table.bounty[0] + 1), '', slot);
  const unknown = Object.values(db.blueprints).filter((b) => !p.character.blueprints.includes(b.id) && db.bases[b.base]!.ilvl <= level + 3);
  if (unknown.length && nextFloat(r) < 0.6) {
    const bp = unknown[nextInt(r, unknown.length)]!;
    p.character.blueprints.push(bp.id);
    w.events.push({ k: 'pickup', t: w.tick, slot, kind: 'blueprint', ref: bp.id, amount: 1 });
  }
  void RARITIES;
  void rarityIndex;
}
