import type { ContentDb } from '../data/types';
import type { CharacterState } from '../progression/character';
import type { World } from '../sim/types';
import { hashString, mix, nextFloat, nextInt, seedRng } from '../rng/xoshiro';

/**
 * Wyrd Trials, the endgame: a cleared zone replayed as a seeded remix at a chosen tier. Each tier
 * raises the foes' level, swaps more of each wave for other foes of the same weight, and lays more
 * hardships over the run; every tier past the first also grants a boon. Clearing a tier opens the
 * next, up to ten.
 */
export const TRIAL_MAX = 10;
export const TRIAL_ZONES = ['ironwood', 'foundry', 'roots'];
const LEVEL_PER_TIER = 2;
const POOLS: Record<string, string[]> = {
  light: ['thrall', 'spiker', 'burrower'],
  medium: ['bulwark', 'frostwright', 'mender'],
  heavy: ['troll'],
};

export function trialsOpen(c: CharacterState): boolean {
  return !!c.story['chapter'];
}

/** Highest tier cleared in a zone (0 = none). */
export function bestTier(c: CharacterState, zone: string): number {
  return c.story[`trial:${zone}`] ?? 0;
}

export function trialLevel(base: number, tier: number): number {
  return Math.min(40, base + tier * LEVEL_PER_TIER);
}

/**
 * The modifiers of the next run at this tier: fixed by the zone, the tier and how many trials the
 * character has run, so the gate can show them before you commit and the sim agrees.
 */
export function trialMods(db: ContentDb, c: CharacterState, zone: string, tier: number): string[] {
  const r = seedRng(mix(hashString(zone), tier, c.story['trials.runs'] ?? 0, hashString(c.name)));
  const all = Object.values(db.trials);
  const hard = all.filter((m) => !m.boon).map((m) => m.id);
  const boons = all.filter((m) => m.boon).map((m) => m.id);
  const out: string[] = [];
  const n = Math.min(4, 1 + Math.floor((tier - 1) / 3));
  while (out.length < n && hard.length) out.push(hard.splice(nextInt(r, hard.length), 1)[0]!);
  if (tier >= 2 && boons.length) out.push(boons[nextInt(r, boons.length)]!);
  return out;
}

/** Can this character start this trial with these modifiers? Null if so, else why not. */
export function trialRefusal(db: ContentDb, c: CharacterState, zone: string, tier: number, mods: string[]): string | null {
  if (!trialsOpen(c)) return 'The trials open when the chapter is done';
  if (!TRIAL_ZONES.includes(zone)) return 'No trial there';
  if (!Number.isInteger(tier) || tier < 1 || tier > TRIAL_MAX) return 'No such tier';
  if (tier > bestTier(c, zone) + 1) return 'Clear the tier below first';
  const want = trialMods(db, c, zone, tier);
  if (want.length !== mods.length || want.some((m, i) => m !== mods[i])) return 'The Norns have changed the terms';
  return null;
}

/** Swap some of each wave for other foes of the same weight, and add the extra hands. */
export function remixWaves(w: World, db: ContentDb, waves: string[][]): string[][] {
  const tier = w.zone.trial;
  const swap = Math.min(0.5, 0.15 + tier * 0.04);
  let extra = Math.floor(tier / 4);
  for (const m of w.zone.mods) extra += db.trials[m]?.extra ?? 0;
  return waves.map((wave) => {
    const out = wave.map((id) => {
      const weight = db.enemies[id]?.weight;
      const pool = weight ? POOLS[weight] : undefined;
      if (!pool || !pool.includes(id) || nextFloat(w.rng.level) >= swap) return id;
      return pool[nextInt(w.rng.level, pool.length)]!;
    });
    for (let k = 0; k < extra; k++) out.push(POOLS.light![nextInt(w.rng.level, POOLS.light!.length)]!);
    return out;
  });
}

/** Multiplier from the run's modifiers on one numeric effect. */
export function modMult(w: World, db: ContentDb, key: 'hpMult' | 'dmgMult' | 'flaskMult' | 'bountyMult'): number {
  let m = 1;
  for (const id of w.zone.mods) m *= db.trials[id]?.[key] ?? 1;
  return m;
}

/** Elite affixes every foe carries in this run. */
export function modElites(w: World, db: ContentDb): string[] {
  const out: string[] = [];
  for (const id of w.zone.mods) {
    const el = db.trials[id]?.elite;
    if (el && !out.includes(el)) out.push(el);
  }
  return out;
}

/** Steps of rarity shift on drops: one per three tiers, plus boons. */
export function rarityShift(w: World, db: ContentDb): number {
  if (!w.zone.trial) return 0;
  let s = Math.floor((w.zone.trial + 2) / 3);
  for (const id of w.zone.mods) s += db.trials[id]?.rarity ?? 0;
  return s;
}

/** Rarity weights moved toward the rare end, one step at a time. */
export function shiftWeights(weights: number[], steps: number): number[] {
  let out = [...weights];
  for (let s = 0; s < steps; s++) {
    const next = out.map(() => 0);
    out.forEach((v, i) => {
      // Half of each tier's weight moves up one rarity (the top keeps its own).
      const up = i < out.length - 1 ? v * 0.5 : 0;
      next[i]! += v - up;
      if (i < out.length - 1) next[i + 1]! += up;
    });
    out = next;
  }
  return out;
}
