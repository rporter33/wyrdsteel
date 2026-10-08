import { BTN, emptyInput, type PlayerInput } from '../../src/core/input/frame';
import { seedRng, nextFloat, nextInt, type RngState } from '../../src/core/rng/xoshiro';

/** Deterministic pseudo-player for tests: wanders, aims, mashes buttons. */
export function chaosInputs(seed: number, ticks: number, buttons = Object.values(BTN)): PlayerInput[][] {
  const r: RngState = seedRng(seed);
  const out: PlayerInput[][] = [];
  let cur = emptyInput();
  for (let i = 0; i < ticks; i++) {
    if (nextFloat(r) < 0.08) {
      cur = {
        mx: nextInt(r, 255) - 127,
        mz: nextInt(r, 255) - 127,
        ax: nextInt(r, 160) - 80,
        az: nextInt(r, 160) - 80,
        held: 0,
        pressed: 0,
      };
    }
    const pressed = nextFloat(r) < 0.15 ? buttons[nextInt(r, buttons.length)]! : 0;
    out.push([{ ...cur, pressed, held: pressed }]);
  }
  return out;
}

export function hold(mx: number, mz: number, ticks: number, extra: Partial<PlayerInput> = {}): PlayerInput[][] {
  return Array.from({ length: ticks }, () => [{ ...emptyInput(), mx, mz, ...extra }]);
}

export function press(btn: number, then = 0): PlayerInput[][] {
  return [[{ ...emptyInput(), pressed: btn, held: btn }], ...Array.from({ length: then }, () => [emptyInput()])];
}
