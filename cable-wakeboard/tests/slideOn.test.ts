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

import type { FeatureDef } from '../src/sim/park';
import { toWorld } from '../src/sim/features';
import { trackApproach } from '../src/sim/featureRide/approachTracker';
import { forwardOf, scale } from '../src/sim/math/vec';
import { featureSim } from './helpers';

const box = (o: Partial<Extract<FeatureDef, { kind: 'slider' }>> = {}): FeatureDef => ({
  kind: 'slider', id: 'b', name: 'B', style: 'box', s: 135, offset: 0, length: 8, width: 1, height: 0.5, entryLength: 3, safety: 'flush', ...o,
});
const cat = (name: string): FeatureDef => ({ kind: 'feature', id: 'b', name, catalog: name, s: 135, offset: 0 }) as FeatureDef;

/** Beside the feature on its left (v < 0), `gap` m off the side, `u` along it, turned `turn` degrees in at 8.3 m/s. */
function approachAt(def: FeatureDef, gap: number, u: number, turn: number) {
  const s = featureSim(def);
  const f = s.features[0]!;
  const r = s.rider;
  r.pos = toWorld(f, u, f.shape.vMin - gap, 0);
  r.heading = f.heading + deg(turn);
  r.vel = scale(forwardOf(r.heading), 8.3);
  trackApproach(s);
  return r.approach!;
}

describe('Slide-on availability (side approaches spec 3)', () => {
  it('beside a box, turned 15 degrees in: available, contact predicted on the main', () => {
    const a = approachAt(box(), 1, 2, 15);
    expect(a.slideOnBlock).toBe('');
    expect(a.turnIn).toBeCloseTo(deg(15), 6);
    expect(a.inwardSpeed).toBeCloseTo(8.3 * Math.sin(deg(15)), 6);
    // 1 m off at 15 degrees: the edge comes 1 / tan(15) = 3.7 m further on.
    expect(a.contactU).toBeCloseTo(2 + 1 / Math.tan(deg(15)), 3);
    expect(a.topHeight).toBeCloseTo(0.5, 6);
    expect(a.sideType).toBe('Rounded');
  });

  it('blocked: too parallel, too steep, too far off, a tall wall, too near the end, too high', () => {
    expect(approachAt(box(), 1, 2, 3).slideOnBlock).toBe('angle');
    expect(approachAt(box(), 1, 2, 40).slideOnBlock).toBe('angle');
    expect(approachAt(box(), 3.5, -4, 15).slideOnBlock).toBe('distance');
    expect(approachAt(box({ sideWall: 0.5 }), 1, 2, 15).slideOnBlock).toBe('wall');
    expect(approachAt(box({ sideWall: 0.2 }), 1, 2, 15).slideOnBlock).toBe('');
    expect(approachAt(box(), 1, 5.8, 15).slideOnBlock).toBe('end');
    expect(approachAt(cat('Funbox'), 1, 3, 15).slideOnBlock).toBe('height');
  });

  it('edge types from the ride data: pipes are round, narrow tops thin rails, a pyramid has banks', () => {
    expect(approachAt(cat('PipeRail'), 1, 2, 15).sideType).toBe('Round');
    expect(approachAt(box({ style: 'rail', width: 0.12 }), 1, 2, 15).sideType).toBe('Rail');
    expect(approachAt(cat('Pyramid'), 1, 0, 15).sideType).toBe('Bank');
    expect(approachAt(box({ sideType: 'Coping' }), 1, 2, 15).sideType).toBe('Coping');
  });
});

import { ride } from './scenarios/featureScenarios';

/**
 * A scripted side approach: a box `height` m high (1 m wide) set `off` m to
 * the side of the line and turned `yawDeg` in across it; pop held from
 * `g0` m off its side to `g1` m (the release), W held the first 0.2 s of
 * the entry air with `w`, A/D `steer` for the first 0.5 m on the main.
 */
function sideLine(height: number, yawDeg: number, off: number, g0: number, g1: number, o: { w?: boolean; steer?: number } = {}) {
  const def: FeatureDef = { kind: 'slider', id: 'f', name: 'Box', style: 'box', s: 135, offset: off, yaw: deg(yawDeg), length: 8, width: 1, height, entryLength: 3, safety: 'flush' };
  let held = false;
  let released = false;
  let maxFlip = 0;
  let maxPitch = 0;
  const run = ride(def, (c) => {
    const a = c.s.rider.approach;
    const so = c.s.rider.air?.slideOn;
    if (so) {
      maxPitch = Math.max(maxPitch, so.pitch);
      if (so.phase === 'air') maxFlip = Math.max(maxFlip, Math.abs(c.s.rider.air!.rot.flipAngle));
    }
    if (c.mode === 'riding' && a && !released && a.slideOnBlock !== 'front' && a.sideGap < g0) held = true;
    if (held && a && a.sideGap < g1) {
      held = false;
      released = true;
    }
    return {
      pop: held,
      forward: !!o.w && c.entryAir >= 0 && c.entryAir < 0.2,
      steer: c.mode === 'onFeature' && c.mainU < 0.5 ? (o.steer ?? 0) : 0,
    };
  });
  return { ...run, jib: run.jibs[0], maxFlip, maxPitch };
}

describe('Slide-on physics (side approaches spec 4)', () => {
  it('a 0.5 m box from 15 degrees: the nose lifts 18 degrees, the board slides on into a clean 50-50', () => {
    const r = sideLine(0.5, 15, -2, 2.4, 1.0);
    expect(r.crash).toBeNull();
    expect(r.jib?.entry).toBe('slideOn');
    expect(r.jib?.slideOrder[0]).toBe('fiftyFifty');
    expect(r.jib?.sketchy).toBe(false);
    expect(r.jib?.slideOnClean).toBe(true);
    expect(r.maxPitch).toBeCloseTo(deg(18), 3);
  });

  it('a 0.8 m ledge needs W: it lifts the nose to 30 degrees (and does not flip); without it the nose digs in', () => {
    const w = sideLine(0.8, 18, -2, 5, 1.2, { w: true });
    expect(w.crash).toBeNull();
    expect(w.jib?.entry).toBe('slideOn');
    expect(w.maxPitch).toBeCloseTo(deg(30), 3);
    expect(w.maxFlip).toBe(0);
    expect(sideLine(0.8, 18, -2, 5, 1.2).crash).toBe('noseDig');
  });

  it('out of inward speed on the edge: a hang-up crash, or a sketchy save with most of the board on top', () => {
    expect(sideLine(0.8, 15, -2, 5, 1.2, { w: true }).crash).toBe('hangUp');
    const save = sideLine(0.8, 15, -2, 5, 1.0, { w: true });
    expect(save.crash).toBeNull();
    expect(save.jib?.entry).toBe('slideOn');
    expect(save.jib?.sketchy).toBe(true);
  });

  it('popped too close at 20 degrees: the nose is still low at the edge (NoseDig)', () => {
    expect(sideLine(0.5, 20, -2, 1.6, 0.4).crash).toBe('noseDig');
  });

  it('25 degrees in carries the board across: overshoot, unless A/D counter-steers', () => {
    expect(sideLine(0.5, 25, -2, 2.4, 1.0).crash).toBe('overshoot');
    const saved = sideLine(0.5, 25, -2, 2.4, 1.0, { steer: 1 });
    expect(saved.crash).toBeNull();
    expect(saved.jib?.entry).toBe('slideOn');
  });
});
