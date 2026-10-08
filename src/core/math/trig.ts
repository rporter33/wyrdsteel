// Deterministic trig. Math.sin/cos are not specified to be correctly rounded, so two browsers
// may disagree in the last bit, and a co-op lockstep sim would desync on that bit. These use only
// + - * / and Math.round, which IEEE 754 pins down exactly on every engine.

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
const QUARTER_PI = 0.7853981633974483;

// Taylor series on [-pi/4, pi/4]; error < 1e-11 there.
function sinPoly(y: number): number {
  const y2 = y * y;
  return y * (1 + y2 * (-1 / 6 + y2 * (1 / 120 + y2 * (-1 / 5040 + y2 * (1 / 362880 + y2 * (-1 / 39916800))))));
}
function cosPoly(y: number): number {
  const y2 = y * y;
  return 1 + y2 * (-1 / 2 + y2 * (1 / 24 + y2 * (-1 / 720 + y2 * (1 / 40320 + y2 * (-1 / 3628800 + y2 / 479001600)))));
}

export function sin(x: number): number {
  const q = Math.round(x / HALF_PI);
  const y = x - q * HALF_PI;
  const m = ((q % 4) + 4) % 4;
  if (m === 0) return sinPoly(y);
  if (m === 1) return cosPoly(y);
  if (m === 2) return -sinPoly(y);
  return -cosPoly(y);
}

export function cos(x: number): number {
  return sin(x + HALF_PI);
}

export function degToRad(d: number): number {
  return (d * PI) / 180;
}

/** Arctangent on [-1, 1] via a series in the reduced argument. Used only at pack-load time. */
export function atanUnit(t: number): number {
  // atan(t) = 2 * atan(t / (1 + sqrt(1 + t^2))) halves the argument twice, then a short series.
  let a = t;
  for (let i = 0; i < 2; i++) a = a / (1 + Math.sqrt(1 + a * a));
  const a2 = a * a;
  const s = a * (1 + a2 * (-1 / 3 + a2 * (1 / 5 + a2 * (-1 / 7 + a2 * (1 / 9 + a2 * (-1 / 11))))));
  return s * 4;
}

export { QUARTER_PI };
