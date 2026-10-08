import type { ButtonName } from '../../core/input/frame';

/** Keyboard codes and mouse buttons (as 'Mouse0'/'Mouse2') per action. Rebindable in Settings. */
export type KeyBindings = Record<ButtonName, string[]>;

export const DEFAULT_KEYS: KeyBindings = {
  light: ['Mouse0'],
  heavy: ['KeyE'],
  launcher: ['KeyQ'],
  dodge: ['Space'],
  fire: ['Mouse2'],
  precise: ['ShiftLeft', 'ShiftRight'],
  ab1: ['Digit1'],
  ab2: ['Digit2'],
  ab3: ['Digit3'],
  ab4: ['Digit4'],
  ruiner: ['KeyR'],
  interact: ['KeyF'],
  lock: ['Tab'],
  lockNext: ['WheelDown'],
  lockPrev: ['WheelUp'],
  flask: ['KeyC'],
  skip: ['Space', 'Enter', 'Escape', 'Mouse0'],
  pad: [],
};

export const MOVE_KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
};

/** Standard-mapping gamepad buttons. Abilities are LB + face button (see sampler). */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  View: 8,
  Menu: 9,
  L3: 10,
  R3: 11,
  Up: 12,
  Down: 13,
  Left: 14,
  Right: 15,
} as const;
