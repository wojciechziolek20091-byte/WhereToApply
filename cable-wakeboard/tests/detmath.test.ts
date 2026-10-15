import { atan, atan2, cos, exp, log, pow, sin, tan } from '../src/sim/math/detmath';

/** Relative error against the engine's Math, with an absolute floor near zero. */
const err = (a: number, b: number): number => Math.abs(a - b) / Math.max(1, Math.abs(b));

describe('detmath', () => {
  const angles = Array.from({ length: 4001 }, (_, i) => (i - 2000) * 0.0173);

  it('sin, cos and tan match Math to about 1 ulp', () => {
    for (const x of angles) {
      expect(err(sin(x), Math.sin(x))).toBeLessThan(4e-16);
      expect(err(cos(x), Math.cos(x))).toBeLessThan(4e-16);
      if (Math.abs(Math.cos(x)) > 0.01) expect(err(tan(x), Math.tan(x))).toBeLessThan(2e-14);
    }
    expect(sin(0)).toBe(0);
    expect(cos(0)).toBe(1);
  });

  it('atan and atan2 match Math, including every quadrant and the axes', () => {
    for (const v of [-1e9, -3, -1, -0.5, -1e-9, 0, 1e-9, 0.3, 0.5, 0.9, 1, 1.5, 2, 2.5, 40, 1e9]) {
      expect(err(atan(v), Math.atan(v))).toBeLessThan(4e-16);
    }
    for (const a of angles) {
      const y = Math.sin(a) * 3;
      const x = Math.cos(a) * 3;
      expect(err(atan2(y, x), Math.atan2(y, x))).toBeLessThan(1e-15);
    }
    expect(atan2(1, 0)).toBe(Math.PI / 2);
    expect(atan2(-1, 0)).toBe(-Math.PI / 2);
    expect(atan2(0, -1)).toBe(Math.PI);
    expect(atan2(0, 0)).toBe(0);
  });

  it('log, exp and pow match Math', () => {
    for (const x of [1e-300, 1e-20, 0.001, 0.1, 0.5, 0.7, 1, 1.4, 2, 10, 1e5, 1e300]) {
      expect(err(log(x), Math.log(x))).toBeLessThan(4e-16);
    }
    for (const x of [-700, -50, -1, -0.1, 0, 0.1, 1, 5, 50, 700]) {
      expect(Math.abs(exp(x) - Math.exp(x)) / Math.exp(x)).toBeLessThan(1e-15);
    }
    for (const x of [0.001, 0.2, 0.5, 0.9, 1]) {
      for (const p of [1, 1.3, 2, 2.7, 4.5]) expect(Math.abs(pow(x, p) - x ** p) / x ** p).toBeLessThan(1e-14);
    }
    expect(pow(0, 2)).toBe(0);
    expect(pow(1, 3.3)).toBe(1);
    expect(log(0)).toBe(-Infinity);
  });
});
