import { flipRateScale, flipTuckAt, landingSpeedKeep, piecewise, preWindScale, spinRateScale } from '../src/sim/bodyPhysics';
import { DEFAULT_CONFIG, makeConfig } from '../src/sim/config';
import { createRotation } from '../src/sim/rotation';
import { flatSim, launch, run } from './helpers';

const cfg = DEFAULT_CONFIG;
const off = makeConfig({ physics: { tuckRotation: false, preWind: false, ropeAtShoulders: false, landingSpeedCost: false } });

describe('section 11 physics: the body in the rotation', () => {
  it('piecewise curves interpolate and clamp', () => {
    const k = [[0, 0], [0.5, 1], [1, 0]];
    expect(piecewise(k, -1)).toBe(0);
    expect(piecewise(k, 0.25)).toBeCloseTo(0.5, 12);
    expect(piecewise(k, 2)).toBe(0);
  });

  it('a tucked flip turns faster than its throw and its open-and-spot', () => {
    const at = (p: number) => flipRateScale(cfg, p * 2 * Math.PI);
    expect(flipTuckAt(cfg, 0.45)).toBe(1);
    expect(at(0.45)).toBeGreaterThan(at(0.02) * 2);
    expect(at(0.45)).toBeGreaterThan(at(0.97) * 2);
  });

  it('a whole flip still takes as long as at the old constant rate (controls keep their timing)', () => {
    const timeFor = (c: typeof cfg) => {
      const s = flatSim(c);
      launch(s, 9);
      let t = 0;
      while (Math.abs(s.rider.air!.rot.flipAngle) < 2 * Math.PI && t < 3) {
        run(s, 1 / 60, () => ({ forward: true }));
        t += 1 / 60;
      }
      return t;
    };
    expect(Math.abs(timeFor(cfg) - timeFor(off))).toBeLessThanOrEqual(2 / 60);
  });

  it('spins are at the input rate when tucked, slower while tucking in and opening to spot', () => {
    const rot = createRotation(0.25);
    rot.spinTime = 0;
    expect(spinRateScale(cfg, rot)).toBeLessThan(0.6);
    rot.spinTime = 1;
    expect(spinRateScale(cfg, rot)).toBeCloseTo(1, 9);
    rot.spinTarget = 0.1;
    rot.spinAngle = 0;
    expect(spinRateScale(cfg, rot)).toBeLessThan(0.6);
    expect(spinRateScale(off, rot)).toBe(1);
  });

  it('a pre-wound spin is faster only in the wound direction', () => {
    expect(preWindScale(cfg, 1, 1)).toBeCloseTo(1 + cfg.physics.preWindBonus, 12);
    expect(preWindScale(cfg, 1, -1)).toBe(1);
    expect(preWindScale(off, 1, 1)).toBe(1);
  });

  it('A/D held just before the pop winds up the spin that way', () => {
    const s = flatSim();
    run(s, 0.5, () => ({ steer: 1 }));
    run(s, 0.1, () => ({}));
    launch(s, 6);
    expect(s.rider.air!.preWind).toBe(1);
    const late = flatSim();
    run(late, 0.5, () => ({ steer: 1 }));
    run(late, 0.5, () => ({}));
    launch(late, 6);
    expect(late.rider.air!.preWind).toBe(0);
  });

  it('landings cost speed, sketchy ones more', () => {
    expect(landingSpeedKeep(cfg, 5, true)).toBeCloseTo(1 - 5 * cfg.physics.landingCostPerMS, 12);
    expect(landingSpeedKeep(cfg, 5, false)).toBeLessThan(landingSpeedKeep(cfg, 5, true));
    expect(landingSpeedKeep(cfg, 500, false)).toBe(0.5);
    expect(landingSpeedKeep(off, 5, false)).toBe(1);
  });

  it('the pull reaches the body at the shoulders without changing the tension', () => {
    const a = flatSim(cfg);
    const b = flatSim(off);
    run(a, 1, () => ({}));
    run(b, 1, () => ({}));
    expect(a.rider.ropeTension).toBeGreaterThan(0);
    // Same stretch, so (nearly) the same tension; the direction is a little flatter.
    expect(Math.abs(a.rider.ropeTension - b.rider.ropeTension)).toBeLessThan(0.1 * b.rider.ropeTension);
    expect(a.rider.ropeForce.y / a.rider.ropeTension).toBeLessThan(b.rider.ropeForce.y / b.rider.ropeTension);
  });
});
