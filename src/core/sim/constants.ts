// All authored timings are in milliseconds and converted with msToTicks when packs load, so the
// tick rate is one constant away from changing (followed by re-baselining the golden replays).
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
export const DT = 1 / TICK_HZ;

export function msToTicks(ms: number): number {
  return Math.round((ms * TICK_HZ) / 1000);
}

export function ticksToMs(t: number): number {
  return (t * 1000) / TICK_HZ;
}

/** Metres per second squared. */
export const GRAVITY = 32;

export const MAX_PLAYERS = 4;
