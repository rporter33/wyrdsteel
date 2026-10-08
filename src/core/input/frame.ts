// One tick of one player's intent. Small integers only, so frames compress well in replays and
// cross the network unchanged later.

export const BTN = {
  light: 1 << 0,
  heavy: 1 << 1,
  launcher: 1 << 2,
  dodge: 1 << 3,
  fire: 1 << 4,
  precise: 1 << 5,
  ab1: 1 << 6,
  ab2: 1 << 7,
  ab3: 1 << 8,
  ab4: 1 << 9,
  ruiner: 1 << 10,
  interact: 1 << 11,
  lock: 1 << 12,
  lockNext: 1 << 13,
  lockPrev: 1 << 14,
  flask: 1 << 15,
  skip: 1 << 16,
  /** Set by the sampler when the input came from a gamepad: enables aim magnetism. */
  pad: 1 << 17,
} as const;
export type ButtonName = keyof typeof BTN;

export interface PlayerInput {
  /** Move direction in world XZ, each axis in [-127, 127]. */
  mx: number;
  mz: number;
  /** Aim point relative to the player, in 1/16 m. Both zero means "no aim": use facing. */
  ax: number;
  az: number;
  /** Buttons currently down, and buttons that went down since the previous tick. */
  held: number;
  pressed: number;
}

export interface InputFrame {
  tick: number;
  /** Indexed by player slot. */
  inputs: PlayerInput[];
}

export const AIM_UNIT = 1 / 16;

export function emptyInput(): PlayerInput {
  return { mx: 0, mz: 0, ax: 0, az: 0, held: 0, pressed: 0 };
}

export function quantizeMove(x: number, z: number): [number, number] {
  const l = Math.sqrt(x * x + z * z);
  const s = l > 1 ? 1 / l : 1;
  return [Math.round(x * s * 127), Math.round(z * s * 127)];
}

export function quantizeAim(dx: number, dz: number): [number, number] {
  const q = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v / AIM_UNIT)));
  return [q(dx), q(dz)];
}

export function sameInput(a: PlayerInput, b: PlayerInput): boolean {
  return a.mx === b.mx && a.mz === b.mz && a.ax === b.ax && a.az === b.az && a.held === b.held && a.pressed === b.pressed;
}

export function has(mask: number, b: ButtonName): boolean {
  return (mask & BTN[b]) !== 0;
}
