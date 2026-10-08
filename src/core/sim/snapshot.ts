import type { World } from './types';

/** A deep copy of the world. structuredClone keeps -0 and every number bit exactly. */
export function snapshot(w: World): World {
  return structuredClone(w);
}

export function restore(s: World): World {
  return structuredClone(s);
}
