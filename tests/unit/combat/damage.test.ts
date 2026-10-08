import { describe, expect, it } from 'vitest';
import { armorFactor, computeDamage, juggleLift } from '../../../src/core/combat/damage';

const base = { base: 10, mult: 1, pct: 0, crit: false, critMult: 1.5, weak: 1, airborne: false, armor: 0, attackerLevel: 1, cap: 0, targetHpMax: 100, taken: 0 };

describe('damage', () => {
  it('armor scales with attacker level and never zeroes damage', () => {
    expect(armorFactor(0, 1)).toBe(1);
    expect(armorFactor(52, 1)).toBeCloseTo(0.5, 9);
    expect(armorFactor(52, 10)).toBeGreaterThan(armorFactor(52, 1));
    expect(computeDamage({ ...base, base: 0.01, armor: 1e6 })).toBe(1);
  });
  it('applies additive bonuses, crit, weak point and airborne multipliers', () => {
    expect(computeDamage({ ...base, pct: 0.5 })).toBe(15);
    expect(computeDamage({ ...base, crit: true })).toBe(15);
    expect(computeDamage({ ...base, weak: 2 })).toBe(20);
    expect(computeDamage({ ...base, airborne: true })).toBe(11);
  });
  it('caps a single hit on a player at the cap fraction of max HP: no one-shots', () => {
    expect(computeDamage({ ...base, base: 10_000, cap: 0.35, targetHpMax: 400 })).toBe(140);
    expect(computeDamage({ ...base, base: 10_000, cap: 0.45, targetHpMax: 400 })).toBe(180);
  });
  it('juggle lift decays geometrically', () => {
    expect(juggleLift(10, 0)).toBe(10);
    expect(juggleLift(10, 2)).toBeCloseTo(6.4, 9);
  });
});
