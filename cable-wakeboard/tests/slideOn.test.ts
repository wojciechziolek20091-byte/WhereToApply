import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { maxReachableHeight } from '../src/sim/featureRide/slideOnConfig';

const deg = (d: number) => (d * Math.PI) / 180;
const h = (charge: number, lift: number, type?: Parameters<typeof maxReachableHeight>[3]) => maxReachableHeight(DEFAULT_CONFIG, charge, deg(lift), type);

describe('SlideOnConfig.maxReachableHeight (side approaches spec 4.3, 8.1)', () => {
  it('full charge at 8.3 m/s: plain side ollie ~0.55-0.65 m, slide-on 18 deg ~0.80 m, 30 deg ~0.95 m', () => {
    expect(h(1, 0)).toBeGreaterThan(0.5);
    expect(h(1, 0)).toBeLessThan(0.65);
    expect(h(1, 18)).toBeCloseTo(0.8, 1);
    expect(h(1, 30)).toBeCloseTo(0.95, 1);
  });

  it('low features (0.35 m) take a slide-on with a small charge', () => {
    expect(h(0, 18)).toBeGreaterThanOrEqual(0.35);
  });

  it('more charge and more nose lift reach higher; a thin rail is about a plain ollie plus 0.10 m', () => {
    for (const c of [0, 0.25, 0.5, 0.75]) {
      expect(h(c + 0.25, 18)).toBeGreaterThan(h(c, 18));
      expect(h(c, 30)).toBeGreaterThan(h(c, 18));
      expect(h(c, 18)).toBeGreaterThan(h(c, 0));
      expect(h(c, 18, 'Rail') - h(c, 0)).toBeCloseTo(0.1, 6);
    }
  });

  it('a near-parallel approach lacks the inward speed to climb high', () => {
    const at = (a: number) => maxReachableHeight(DEFAULT_CONFIG, 1, deg(18), 'Rounded', 8.3, deg(a));
    expect(at(6)).toBeLessThan(at(20) - 0.1);
  });
});
