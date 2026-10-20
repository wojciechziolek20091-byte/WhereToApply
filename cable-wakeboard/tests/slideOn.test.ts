import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { maxReachableHeight } from '../src/sim/featureRide/slideOnConfig';

const deg = (d: number) => (d * Math.PI) / 180;
const h = (charge: number, lift: number, type?: Parameters<typeof maxReachableHeight>[3]) => maxReachableHeight(DEFAULT_CONFIG, charge, deg(lift), type);

describe('SlideOnConfig.maxReachableHeight (side approaches spec 4.3, 8.1)', () => {
  it('full charge at 8.3 m/s (v2 spec 5): air-on ~0.70 m, auto lift 18 deg ~0.90 m, W 30 deg ~1.05 m', () => {
    expect(h(1, 0)).toBeGreaterThan(0.6);
    expect(h(1, 0)).toBeLessThan(0.75);
    expect(h(1, 18)).toBeCloseTo(0.9, 1);
    expect(h(1, 30)).toBeCloseTo(1.05, 1);
  });

  it('a loaded edge at the pop reaches higher (v2 spec 1.1)', () => {
    const at = (edge: number) => maxReachableHeight(DEFAULT_CONFIG, 1, deg(18), 'Rounded', 8.3, undefined, edge);
    expect(at(1)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(0));
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

  it('the v2 window (spec 2): any angle to 75 degrees, up to 4 m off; past them, a tall wall, the end or too high is blocked', () => {
    expect(approachAt(box(), 1, 2, 40).slideOnBlock).toBe('');
    expect(approachAt(box(), 0.5, 4, 74).slideOnBlock).toBe('');
    expect(approachAt(box(), 0.5, 2, 80).slideOnBlock).toBe('angle');
    expect(approachAt(box(), 3.5, -4, 15).slideOnBlock).toBe('');
    expect(approachAt(box(), 4.5, -8, 15).slideOnBlock).toBe('distance');
    expect(approachAt(box({ sideWall: 0.5 }), 1, 2, 15).slideOnBlock).toBe('wall');
    expect(approachAt(box({ sideWall: 0.2 }), 1, 2, 15).slideOnBlock).toBe('');
    expect(approachAt(box(), 1, 5.8, 15).slideOnBlock).toBe('');
    expect(approachAt(box(), 1, 6.3, 15).slideOnBlock).toBe('end');
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
function sideLine(height: number, yawDeg: number, off: number, g0: number, g1: number, o: LineOpts = {}) {
  const box: FeatureDef = { kind: 'slider', id: 'f', name: 'Box', style: 'box', s: 135, offset: 0, length: 8, width: 1, height, entryLength: 3, safety: 'flush' };
  return sideLineOn(box, yawDeg, off, g0, g1, o);
}

interface LineOpts {
  w?: boolean;
  steer?: number;
  stance?: 'regular' | 'goofy';
}

/** The same on any feature def, moved `off` m to the side and turned `yawDeg` in. */
function sideLineOn(def0: FeatureDef, yawDeg: number, off: number, g0: number, g1: number, o: LineOpts = {}) {
  const def = { ...def0, offset: off, yaw: deg(yawDeg) * (off < 0 ? 1 : -1) } as FeatureDef;
  let mountV: number | null = null;
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
    if (c.mode === 'onFeature' && mountV === null) mountV = c.s.rider.ramp!.v;
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
  }, o.stance);
  return { ...run, jib: run.jibs[0], maxFlip, maxPitch, mountV };
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

  it('a 0.8 m ledge with W: the nose lifts to 30 degrees (and does not flip); a weak pop without it digs in', () => {
    const w = sideLine(0.8, 18, -2, 5, 1.2, { w: true });
    expect(w.crash).toBeNull();
    expect(['slideOn', 'edgeSlideOn']).toContain(w.jib?.entry);
    expect(w.maxPitch).toBeCloseTo(deg(30), 3);
    expect(w.maxFlip).toBe(0);
    expect(sideLine(0.8, 18, -2, 1.5, 1.2).crash).toBe('noseDig');
  });

  it('popped close, the nose low at the edge: it scrapes up (v2 spec 2), no NoseDig', () => {
    for (const g of [0.6, 0.4, 0.2]) {
      const r = sideLine(0.5, 20, -2, g + 0.3, g);
      expect(r.crash).toBeNull();
      expect(r.jib?.entry).toBe('slideOn');
    }
  });

  it('no v1 side crashes are left: no HangUp, Overshoot or SlippedOut at any angle, and steep with a full pop is no crash', () => {
    for (const a of [10, 15, 20, 30, 45, 60]) {
      for (const [h, w] of [[0.5, false], [0.8, true]] as const) {
        const r = sideLine(h, a, -2, 2.4, 1.0, { w });
        expect(['hangUp', 'overshoot', 'slippedOut']).not.toContain(r.crash);
        if (a >= 45) expect(sideLine(h, a, -6, 8, 1.0, { w }).crash).toBeNull();
      }
    }
  });
});

describe('Slide-on edge cases (side approaches spec 7)', () => {
  const feature = (name: string): FeatureDef => ({ kind: 'feature', id: 'f', name, catalog: name, s: 135, offset: 0 }) as FeatureDef;

  it('a sloped part: onto the down slope of the Rooftop', () => {
    const r = sideLineOn(feature('Rooftop'), 12, -2.5, 2.4, 1.0);
    expect(r.crash).toBeNull();
    expect(r.jib?.entry).toBe('slideOn');
  });

  it('a multi-lane feature: the lane on the approach side (Transfer, both sides)', () => {
    const left = sideLineOn(feature('Transfer'), 15, 2, 2.4, 1.0);
    expect(left.jib?.entry).toBe('slideOn');
    expect(Math.abs(left.mountV!)).toBeLessThan(0.45);
    const right = sideLineOn(feature('Transfer'), 18, -4, 5, 0.9, { w: true });
    expect(['slideOn', 'edgeSlideOn']).toContain(right.jib?.entry);
    expect(right.mountV!).toBeGreaterThan(1.7);
  });

  it('goofy riders slide on the same way', () => {
    const r = sideLine(0.5, 15, -2, 2.4, 1.0, { stance: 'goofy' });
    expect(r.crash).toBeNull();
    expect(r.jib?.entry).toBe('slideOn');
  });
});


import { makeConfig } from '../src/sim/config';
import { stepSim } from '../src/sim/step';
import { neutralInput } from '../src/sim/input';
import { createSim } from '../src/sim/world';
import { toLocal } from '../src/sim/features';
import { isBoardslide } from '../src/sim/featureRide/slideController';

/**
 * The player's line: a box `off` m to the side of the cable line; A/D toward it from `start` m before
 * its main and Space held from `hold` m before, never released. Returns the slides and how it ended.
 */
function holdInto(off: number, start: number, hold: number) {
  const def = { kind: 'slider', id: 'b', name: 'Box', style: 'box', s: 135, offset: off, length: 8, width: 1, height: 0.5, entryLength: 3, safety: 'flush' } as FeatureDef;
  const s = createSim(makeConfig({}), { name: 'hold', features: [def] }, 125);
  const f = s.features[0]!;
  const m0 = f.shape.pieces.find((p) => p.slide)!.u0;
  const jibs: { entry: string; boardAngle: number }[] = [];
  let crashed: string | null = null;
  let off_ = false;
  for (let i = 0; i < 60 * 14 && !crashed; i++) {
    const toMain = m0 - toLocal(f, s.rider.pos).u;
    const inp = neutralInput();
    if (s.rider.mode === 'riding' && !off_) {
      if (toMain < start) inp.steer = off < 0 ? -1 : 1;
      if (toMain < hold) inp.pop = true;
    }
    stepSim(s, inp);
    for (const e of s.events) {
      if (e.type === 'crash') crashed = e.reason;
      if (e.type === 'featureEnter' && s.rider.jib) jibs.push({ entry: s.rider.jib.entry, boardAngle: s.rider.jib.boardAngle });
      if (e.type === 'featureExit') off_ = true;
    }
  }
  return { jibs, crashed };
}

describe('Space held into the side (auto pop, a sideways landing)', () => {
  it('pops on its own, lands across the box (a boardslide) and turns out off the end', () => {
    for (const [off, start, hold] of [[-3, 6, 6], [-3, 8, 3], [-4, 8, 6], [-4, 10, 6], [3, 6, 6], [4, 8, 6]] as const) {
      const r = holdInto(off, start, hold);
      expect(r.crashed, `${off}/${start}/${hold}`).toBeNull();
      expect(r.jibs.length, `${off}/${start}/${hold}`).toBeGreaterThan(0);
      expect(isBoardslide(r.jibs[0]!.boardAngle), `${off}/${start}/${hold}: ${r.jibs[0]!.entry}`).toBe(true);
    }
  });
});
