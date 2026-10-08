// Small 2D helpers on the XZ ground plane. Plain numbers in, plain numbers out; no allocation in
// hot paths beyond the returned tuple.

export function len(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}

/** Unit vector, or the fallback when the input is (near) zero. */
export function norm(x: number, z: number, fx = 0, fz = 1): [number, number] {
  const l = Math.sqrt(x * x + z * z);
  if (l < 1e-9) return [fx, fz];
  return [x / l, z / l];
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Rotate a unit vector toward a target unit vector by at most `maxCos`-limited step (radians via polynomial). */
export function rotateToward(fx: number, fz: number, tx: number, tz: number, maxStep: number): [number, number] {
  const dot = fx * tx + fz * tz;
  const cross = fx * tz - fz * tx;
  // Small-angle stepping: if the angle between is within maxStep, snap.
  // cos(maxStep) via 1 - s^2/2 + s^4/24 is plenty accurate for steps under 0.6 rad.
  const s2 = maxStep * maxStep;
  const cosMax = 1 - s2 / 2 + (s2 * s2) / 24;
  if (dot >= cosMax) return [tx, tz];
  const sinMax = maxStep - (maxStep * s2) / 6 + (maxStep * s2 * s2) / 120;
  const sign = cross >= 0 ? 1 : -1;
  // Rotate (fx,fz) by sign*maxStep. Positive cross means target is counter-clockwise in (x,z).
  const nx = fx * cosMax - sign * fz * sinMax;
  const nz = sign * fx * sinMax + fz * cosMax;
  return norm(nx, nz, tx, tz);
}

/** Integer power by repeated multiplication (the ** operator is not guaranteed correctly rounded). */
export function ipow(base: number, exp: number): number {
  let r = 1;
  for (let i = 0; i < exp; i++) r *= base;
  return r;
}
