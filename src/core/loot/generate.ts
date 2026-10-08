import type { AffixDef, BaseItemDef, ContentDb } from '../data/types';
import { seedRng, nextFloat, nextInt, pickWeighted, rangeInt, type RngState } from '../rng/xoshiro';
import { RARITIES, type GearSlot, type Item, type ItemAffix, type Rarity } from './item';

export interface DropContext {
  ilvl: number;
  /** Class of the player this drop is for: 60% of drops are something they can use. */
  cls: string;
  /** Rarity weights by index (worn..relic). */
  weights: number[];
  /** Floor: never below this rarity (boss pity). */
  minRarity?: Rarity;
  base?: string;
  rarity?: Rarity;
  guaranteed?: string[];
}

const AFFIX_COUNT: Record<Rarity, [number, number]> = { worn: [0, 0], forged: [1, 1], runed: [2, 3], ascendant: [3, 4], relic: [4, 4] };
const SOCKETS: Record<Rarity, [number, number]> = { worn: [0, 0], forged: [0, 1], runed: [1, 2], ascendant: [1, 3], relic: [2, 3] };
export const RARITY_MULT: Record<Rarity, number> = { worn: 0.9, forged: 1, runed: 1.08, ascendant: 1.17, relic: 1.27 };

/** Can this class use this base? Weapons by kind; armour and charms by everyone. */
export function usable(db: ContentDb, base: BaseItemDef, cls: string): boolean {
  const c = db.classes[cls];
  if (!c) return true;
  if (base.slot === 'melee') return c.melee.includes(base.kind);
  if (base.slot === 'ranged') return c.ranged.includes(base.kind);
  return !base.classes || base.classes.includes(cls);
}

function pickBase(r: RngState, db: ContentDb, ctx: DropContext): BaseItemDef {
  const all = Object.values(db.bases).filter((b) => b.slot !== 'charm' && b.ilvl <= ctx.ilvl + 1);
  const forClass = all.filter((b) => usable(db, b, ctx.cls));
  const pool = forClass.length && nextFloat(r) < 0.6 ? forClass : all;
  // Prefer the highest tier the item level reaches, with some older tiers mixed in.
  const weights = pool.map((b) => 1 + b.ilvl / 4);
  return pool[pickWeighted(r, weights)]!;
}

function rollAffixes(r: RngState, db: ContentDb, base: BaseItemDef, ilvl: number, n: number, fixed: ItemAffix[]): ItemAffix[] {
  const out: ItemAffix[] = [...fixed];
  const groups: string[] = fixed.map((f) => db.affixes.find((a) => a.id === f.id)?.group ?? '');
  let prefixes = fixed.filter((f) => db.affixes.find((a) => a.id === f.id)?.kind === 'prefix').length;
  let suffixes = fixed.length - prefixes;
  for (let i = out.length; i < n; i++) {
    // Alternate so a four-affix item has two of each.
    const want: AffixDef['kind'] = prefixes <= suffixes ? 'prefix' : 'suffix';
    const pool = db.affixes.filter((a) => a.kind === want && a.ilvl <= ilvl && a.slots.includes(base.slot) && !groups.includes(a.group));
    if (!pool.length) continue;
    // Highest tier available per group is twice as likely as lower tiers.
    const weights = pool.map((a) => a.weight * (a.ilvl + 6 > ilvl ? 2 : 1));
    const pick = pool[pickWeighted(r, weights)]!;
    groups.push(pick.group);
    if (want === 'prefix') prefixes++;
    else suffixes++;
    out.push({ id: pick.id, v: rollValue(r, pick) });
  }
  return out;
}

export function rollValue(r: RngState, a: AffixDef): number {
  const [lo, hi] = a.range;
  // Integers stay integers; fractions keep three decimals so tooltips stay tidy.
  if (Number.isInteger(lo) && Number.isInteger(hi)) return rangeInt(r, Math.min(lo, hi), Math.max(lo, hi));
  const v = lo + nextFloat(r) * (hi - lo);
  return Math.round(v * 1000) / 1000;
}

/**
 * One item from one seed: same seed and context, same item, on every machine. Rarity, base,
 * affixes (exclusive groups, gated by item level), sockets, and a unique power for relics.
 */
export function generateItem(seed: number, ctx: DropContext, db: ContentDb): Item {
  const r = seedRng(seed);
  let rarityIdx = ctx.rarity ? RARITIES.indexOf(ctx.rarity) : pickWeighted(r, ctx.weights);
  if (ctx.minRarity) rarityIdx = Math.max(rarityIdx, RARITIES.indexOf(ctx.minRarity));
  const rarity = RARITIES[rarityIdx]!;
  const base = ctx.base ? db.bases[ctx.base]! : pickBase(r, db, ctx);
  const fixed = (ctx.guaranteed ?? []).map((id) => {
    const a = db.affixes.find((x) => x.id === id)!;
    return { id, v: rollValue(r, a) };
  });
  const [lo, hi] = AFFIX_COUNT[rarity];
  const n = lo + nextInt(r, hi - lo + 1);
  const affixes = rollAffixes(r, db, base, ctx.ilvl, Math.max(n, fixed.length), fixed);
  const [slo, shi] = SOCKETS[rarity];
  const socketable = base.slot === 'melee' || base.slot === 'ranged' || base.slot === 'chest' || base.slot === 'helm';
  const sockets = socketable ? slo + nextInt(r, shi - slo + 1) : 0;
  let unique: string | null = null;
  if (rarity === 'relic') {
    const fits = Object.values(db.uniques).filter((u) => u.slot === base.slot);
    if (fits.length) unique = fits[nextInt(r, fits.length)]!.id;
  }
  return {
    uid: `i${(seed >>> 0).toString(36)}`,
    base: base.id,
    rarity,
    ilvl: ctx.ilvl,
    affixes,
    sockets: Array.from({ length: sockets }, () => null),
    seed,
    unique,
    v: 1,
  };
}

export function slotOf(db: ContentDb, it: Item): GearSlot {
  return db.bases[it.base]!.slot;
}
