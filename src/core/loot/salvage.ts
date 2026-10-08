import type { CharacterState } from '../progression/character';
import { RECENT_SALVAGE } from '../progression/character';
import { rarityIndex, type Item } from './item';

/** What salvaging an item yields: bounty plus materials by rarity. */
export function salvageValue(it: Item): { bounty: number; mats: Record<string, number> } {
  const r = rarityIndex(it.rarity);
  const bounty = Math.round((3 + it.ilvl * 1.5) * (1 + r * 0.8));
  const mats: Record<string, number> = { 'mat.iron': 1 + Math.floor(it.ilvl / 4) };
  if (r >= 2) mats['mat.rune'] = r - 1;
  if (r >= 3) mats['mat.star'] = r - 2;
  return { bounty, mats };
}

/** Salvage into bounty and materials, keeping the last ten for undo. Socketed runes come back. */
export function salvage(c: CharacterState, it: Item): void {
  const v = salvageValue(it);
  c.bounty += v.bounty;
  for (const [k, n] of Object.entries(v.mats)) c.mats[k] = (c.mats[k] ?? 0) + n;
  for (const r of it.sockets) if (r) c.runes[r] = (c.runes[r] ?? 0) + 1;
  c.recentSalvage.push(it);
  if (c.recentSalvage.length > RECENT_SALVAGE) c.recentSalvage.shift();
}

/** Undo a salvage: give the item back and take its yield back. Refused if it was spent. */
export function unsalvage(c: CharacterState, uid: string): string | null {
  const i = c.recentSalvage.findIndex((x) => x.uid === uid);
  if (i < 0) return 'Not in recent salvage';
  const it = c.recentSalvage[i]!;
  const v = salvageValue(it);
  if (c.bounty < v.bounty) return 'That bounty is already spent';
  for (const [k, n] of Object.entries(v.mats)) if ((c.mats[k] ?? 0) < n) return 'Those materials are already spent';
  for (const r of it.sockets) if (r && (c.runes[r] ?? 0) < 1) return 'Its runes are already used';
  if (c.inv.length >= 40) return 'Inventory full';
  c.bounty -= v.bounty;
  for (const [k, n] of Object.entries(v.mats)) c.mats[k] = c.mats[k]! - n;
  for (const r of it.sockets) if (r) c.runes[r] = c.runes[r]! - 1;
  c.recentSalvage.splice(i, 1);
  c.inv.push(it);
  return null;
}

