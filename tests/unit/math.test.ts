import { describe, expect, it } from 'vitest';
import { sin, cos, degToRad, atanUnit, PI } from '../../src/core/math/trig';
import { rotateToward, ipow, norm } from '../../src/core/math/vec';

describe('deterministic trig', () => {
  it('matches Math.sin/cos to 1e-10 over a wide range', () => {
    for (let i = -2000; i <= 2000; i++) {
      const x = i * 0.0137;
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(1e-10);
      expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(1e-10);
    }
  });
  it('hits exact quadrant values', () => {
    expect(sin(0)).toBe(0);
    expect(cos(0)).toBe(1);
    expect(sin(PI / 2)).toBe(1);
  });
  it('degToRad and atanUnit agree with Math', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);
    for (let t = -1; t <= 1; t += 0.05) expect(atanUnit(t)).toBeCloseTo(Math.atan(t), 8);
  });
});

describe('vector helpers', () => {
  it('rotateToward snaps within the step and limits beyond it', () => {
    expect(rotateToward(0, 1, 0.1, 0.995, 0.5)).toEqual([0.1, 0.995]);
    const [x, z] = rotateToward(0, 1, 1, 0, 0.1);
    expect(Math.abs(Math.atan2(x, z) - 0.1)).toBeLessThan(1e-3);
    expect(Math.hypot(x, z)).toBeCloseTo(1, 9);
  });
  it('ipow multiplies', () => {
    expect(ipow(0.8, 3)).toBeCloseTo(0.512, 12);
    expect(ipow(2, 0)).toBe(1);
  });
  it('norm falls back on zero', () => {
    expect(norm(0, 0, 1, 0)).toEqual([1, 0]);
  });
});
