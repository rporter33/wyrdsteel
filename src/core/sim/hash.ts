import { hashString } from '../rng/xoshiro';
import type { World } from './types';

/** Key-sorted JSON, so two worlds that are equal hash equal regardless of property order. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const keys = Object.keys(v as object).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}';
}

/** Hash of the full simulation state except the per-tick event list. */
export function hashWorld(w: World): string {
  const { events: _e, ...rest } = w;
  const s = canonical(rest);
  return hashString(s).toString(16).padStart(8, '0') + hashString(s, 0x12345).toString(16).padStart(8, '0');
}
