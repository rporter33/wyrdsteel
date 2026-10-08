import { describe, expect, it } from 'vitest';
import { seedRng, nextU32, nextFloat, nextInt, pickWeighted, deriveSeed, hashString } from '../../src/core/rng/xoshiro';

describe('xoshiro128**', () => {
  it('is reproducible from a seed (known-answer vector)', () => {
    const a = seedRng(42);
    const seq = [nextU32(a), nextU32(a), nextU32(a), nextU32(a)];
    const b = seedRng(42);
    expect([nextU32(b), nextU32(b), nextU32(b), nextU32(b)]).toEqual(seq);
    // Pinned so an accidental change to the generator shows up as a diff, not a silent desync.
    expect(seq).toMatchInlineSnapshot(`
      [
        2837322924,
        544945897,
        479756282,
        3500138142,
      ]
    `);
  });

  it('produces uniform floats (chi-square, 20 buckets)', () => {
    const s = seedRng(7);
    const buckets = new Array(20).fill(0);
    const N = 200_000;
    for (let i = 0; i < N; i++) buckets[Math.floor(nextFloat(s) * 20)]++;
    const exp = N / 20;
    const chi = buckets.reduce((acc, o) => acc + ((o - exp) * (o - exp)) / exp, 0);
    expect(chi).toBeLessThan(43.8); // p = 0.001 for 19 dof
  });

  it('nextInt stays in range and pickWeighted respects weights', () => {
    const s = seedRng(1);
    const counts = [0, 0, 0];
    for (let i = 0; i < 30_000; i++) {
      const n = nextInt(s, 5);
      expect(n >= 0 && n < 5).toBe(true);
      counts[pickWeighted(s, [1, 2, 7])]++;
    }
    expect(counts[2]! / 30_000).toBeGreaterThan(0.67);
    expect(counts[2]! / 30_000).toBeLessThan(0.73);
  });

  it('derived streams differ by label and are stable', () => {
    expect(deriveSeed(1, 'ai')).not.toBe(deriveSeed(1, 'combat'));
    expect(deriveSeed(1, 'ai')).toBe(deriveSeed(1, 'ai'));
    expect(hashString('abc')).toBe(0x1a47e90b);
  });
});
