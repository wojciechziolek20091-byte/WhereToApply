import { describe, expect, it } from 'vitest';
import type { FeatureDef } from '../src/sim/park';
import { toWorld } from '../src/sim/features';
import { trackApproach } from '../src/sim/featureRide/approachTracker';
import { forwardOf, scale } from '../src/sim/math/vec';
import type { SimState } from '../src/sim/world';
import { featureSim } from './helpers';

const box: FeatureDef = {
  kind: 'slider', id: 'b', name: 'B', style: 'box', s: 135, offset: 0, length: 8, width: 1, height: 0.5, entryLength: 3, safety: 'flush',
};

/** Put the rider at feature-local (u, v), travelling along the feature at 6 m/s (or against it with dir -1). */
function place(s: SimState, u: number, v: number, dir = 1): void {
  const f = s.features[0]!;
  const r = s.rider;
  r.pos = toWorld(f, u, v, r.pos.y);
  r.heading = f.heading + (dir > 0 ? 0 : Math.PI);
  r.vel = scale(forwardOf(r.heading), 6);
}

describe('ApproachTracker (feature ride M1)', () => {
  it('tracks distance to start, lateral offset and angle in front of a feature', () => {
    const s = featureSim(box);
    const sh = s.features[0]!.shape;
    place(s, sh.uMin - 10, 0);
    trackApproach(s);
    const a = s.rider.approach!;
    expect(a.featureId).toBe('b');
    expect(a.toStart).toBeCloseTo(10, 6);
    expect(a.lateral).toBeCloseTo(0, 6);
    expect(a.sideGap).toBe(0);
    expect(Math.abs(a.angle)).toBeLessThan(1e-6);
    expect(a.side).toBe('front');
    expect(a.speed).toBeCloseTo(6, 6);
  });

  it('is null out of range', () => {
    const s = featureSim(box);
    const sh = s.features[0]!.shape;
    place(s, sh.uMin - 40, 0);
    trackApproach(s);
    expect(s.rider.approach).toBeNull();
    place(s, sh.uMin - 5, sh.vMax + 20);
    trackApproach(s);
    expect(s.rider.approach).toBeNull();
  });

  it('names the side by stance: a feature on the right is toeside for regular, heelside for goofy and switch', () => {
    const side = (stance: 'regular' | 'goofy', sw: boolean, dir = 1) => {
      const s = featureSim(box);
      const sh = s.features[0]!.shape;
      s.rider.stance = stance;
      s.rider.switchStance = sw;
      // Feature to the rider's right: rider left of it when going along, right of it when going against.
      place(s, dir > 0 ? sh.uMin - 2 : (sh.uMin + sh.uMax) / 2, dir > 0 ? sh.vMin - 2 : sh.vMax + 2, dir);
      trackApproach(s);
      return s.rider.approach!.side;
    };
    expect(side('regular', false)).toBe('toeside');
    expect(side('goofy', false)).toBe('heelside');
    expect(side('regular', true)).toBe('heelside');
    expect(side('regular', false, -1)).toBe('toeside');
  });

  it('runs the edge clock only while the edge is held hard', () => {
    const s = featureSim(box);
    const sh = s.features[0]!.shape;
    place(s, sh.uMin - 10, 0);
    s.rider.edgeAngle = 1.2;
    for (let i = 0; i < 12; i++) trackApproach(s);
    expect(Math.abs(s.rider.approach!.edge)).toBeGreaterThanOrEqual(s.cfg.featureRide.Approach.HardEdge);
    expect(s.rider.approach!.edgeTime).toBeCloseTo(12 / 60, 6);
    s.rider.edgeAngle = 0;
    trackApproach(s);
    expect(s.rider.approach!.edgeTime).toBe(0);
  });
});
