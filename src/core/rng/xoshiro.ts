// xoshiro128** seeded through splitmix32. 32-bit integer math only (Math.imul, >>>), so every
// engine produces the same sequence. State is a plain 4-number array so it snapshots as JSON.

export type RngState = [number, number, number, number];

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function seedRng(seed: number): RngState {
  const sm = splitmix32(seed);
  const s: RngState = [sm(), sm(), sm(), sm()];
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1;
  return s;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function nextU32(s: RngState): number {
  const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;
  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);
  return result;
}

/** Uniform in [0, 1). */
export function nextFloat(s: RngState): number {
  return nextU32(s) / 4294967296;
}

/** Uniform integer in [0, n). */
export function nextInt(s: RngState, n: number): number {
  return Math.floor(nextFloat(s) * n);
}

/** Uniform in [lo, hi]. Integers only. */
export function rangeInt(s: RngState, lo: number, hi: number): number {
  return lo + nextInt(s, hi - lo + 1);
}

export function chance(s: RngState, p: number): boolean {
  return nextFloat(s) < p;
}

/** Weighted pick: returns an index into `weights`. Weights must sum > 0. */
export function pickWeighted(s: RngState, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = nextFloat(s) * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** FNV-1a over UTF-16 code units. */
export function hashString(str: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Mix several 32-bit values into one seed. */
export function mix(...vals: number[]): number {
  let h = 0x9e3779b9;
  for (const v of vals) {
    h = Math.imul(h ^ (v >>> 0), 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h >>> 0;
}

/** Independent stream seed: adding draws to one stream never shifts another. */
export function deriveSeed(master: number, label: string): number {
  return mix(master, hashString(label));
}
