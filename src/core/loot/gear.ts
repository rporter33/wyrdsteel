import type { ContentDb } from '../data/types';
import type { CharacterState } from '../progression/character';
import { applyStat, type DerivedStats } from '../progression/stats';
import { GEAR_SLOTS, type Item } from './item';
import { RARITY_MULT } from './generate';

/** Weapon damage range for an item: the kind's base range, scaled by item level and rarity. */
export function weaponDamage(db: ContentDb, it: Item): [number, number] | null {
  const base = db.bases[it.base];
  if (!base || (base.slot !== 'melee' && base.slot !== 'ranged')) return null;
  const kind = db.weapons[base.kind];
  if (!kind) return null;
  const k = (1 + 0.1 * (it.ilvl - 1)) * RARITY_MULT[it.rarity];
  return [Math.round(kind.dmg[0] * k * 10) / 10, Math.round(kind.dmg[1] * k * 10) / 10];
}

export function itemArmor(db: ContentDb, it: Item): number {
  const base = db.bases[it.base];
  if (!base || !base.armor) return 0;
  return Math.round(base.armor * (1 + 0.08 * (it.ilvl - 1)) * RARITY_MULT[it.rarity]);
}

/** Every stat line an item grants: affixes, socketed runes, unique power. */
export function itemStats(db: ContentDb, it: Item): { stat: string; amt: number }[] {
  const out: { stat: string; amt: number }[] = [];
  for (const a of it.affixes) {
    const def = db.affixes.find((x) => x.id === a.id);
    if (def) out.push({ stat: def.stat, amt: a.v });
  }
  for (const r of it.sockets) if (r) for (const s of db.runes[r]?.stats ?? []) out.push(s);
  if (it.unique) for (const s of db.uniques[it.unique]?.stats ?? []) out.push(s);
  return out;
}

/** Equipped gear into derived stats: weapons set kind and damage; everything adds its lines. */
export function applyGear(c: CharacterState, db: ContentDb, s: DerivedStats): void {
  for (const slot of GEAR_SLOTS) {
    const it = c.equip[slot];
    if (!it) continue;
    const base = db.bases[it.base];
    if (!base) continue;
    if (slot === 'melee' || slot === 'ranged') {
      const dmg = weaponDamage(db, it);
      if (dmg) {
        if (slot === 'melee') {
          s.meleeKind = base.kind;
          s.melee = dmg;
        } else {
          s.rangedKind = base.kind;
          s.ranged = dmg;
        }
      }
    }
    s.armor += itemArmor(db, it);
    for (const l of itemStats(db, it)) applyStat(s, l.stat, l.amt);
  }
}

/**
 * One number to compare items by, for "only salvage if worse" and keep-best on a full bag. Not
 * shown as truth to the player: the tooltip compares real stats.
 */
export function itemPower(db: ContentDb, it: Item): number {
  const dmg = weaponDamage(db, it);
  const core = dmg ? (dmg[0] + dmg[1]) * 2 : itemArmor(db, it) * 1.5;
  return Math.round(core + it.affixes.length * 6 + it.sockets.length * 4 + (it.unique ? 20 : 0) + RARITY_MULT[it.rarity] * 10);
}

export function itemName(db: ContentDb, it: Item): string {
  if (it.unique) return db.uniques[it.unique]?.name ?? it.base;
  const base = db.bases[it.base]?.name ?? it.base;
  const pre = it.affixes.map((a) => db.affixes.find((x) => x.id === a.id)).find((a) => a?.kind === 'prefix');
  const suf = it.affixes.map((a) => db.affixes.find((x) => x.id === a.id)).find((a) => a?.kind === 'suffix');
  return [pre?.name, base, suf?.name].filter(Boolean).join(' ');
}
