import type { World } from '../types';

/** Drop entities whose removal time has passed. Filtering keeps the array sorted by id. */
export function cleanupSystem(w: World): void {
  if (!w.entities.some((e) => e.removeAt >= 0 && e.removeAt <= w.tick)) return;
  w.entities = w.entities.filter((e) => !(e.removeAt >= 0 && e.removeAt <= w.tick));
}
