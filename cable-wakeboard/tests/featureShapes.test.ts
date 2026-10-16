import { FEATURE_CATALOG } from '../src/sim/featureCatalog';
import { buildShape, legacyShape, pieceHeightAt, shapeSurfaceAt, wallHeightAt } from '../src/sim/featureShapes';
import { kickerHeightAt, sliderHeightAt } from '../src/sim/features';
import { LAKESIDE_PARK, TEST_PARK } from '../src/sim/parkLayout';
import { atan } from '../src/sim/math/detmath';

const deg = (r: number) => (r * 180) / Math.PI;
const names = Object.keys(FEATURE_CATALOG);

describe('feature catalogue shapes', () => {
  it('has the 15 spec features', () => {
    expect(names).toHaveLength(15);
  });

  it.each(names)('%s: pieces are ordered, finite, and their joints meet exactly', (name) => {
    const shape = buildShape(name);
    expect(shape.pieces.length).toBeGreaterThan(0);
    shape.pieces.forEach((p, i) => {
      expect(p.index).toBe(i + 1);
      expect(p.u1).toBeGreaterThan(p.u0);
      for (const x of [p.u0, p.h0, p.u1, p.h1, p.width]) expect(Number.isFinite(x)).toBe(true);
    });
    // Consecutive pieces of one part share their joint point.
    for (let i = 1; i < shape.pieces.length; i++) {
      const a = shape.pieces[i - 1]!;
      const b = shape.pieces[i]!;
      if (a.part !== b.part || a.axis !== b.axis || a.axis === 'v') continue;
      expect(Math.abs(a.u1 - b.u0)).toBeLessThan(1e-9);
      expect(Math.abs(pieceHeightAt(a, a.u1).height - pieceHeightAt(b, b.u0).height)).toBeLessThan(0.01);
    }
  });

  it('entry ramps start 0.25 m under the water on a 12-22 degree safety', () => {
    for (const name of names) {
      const first = buildShape(name).pieces[0]!;
      if (first.role === 'Safety') {
        expect(first.h0).toBeCloseTo(-0.25, 9);
        const a = deg(atan((first.h1 - first.h0) / (first.u1 - first.u0)));
        expect(a).toBeGreaterThanOrEqual(12);
        expect(a).toBeLessThanOrEqual(22);
      }
    }
  });

  it.each([
    ['BeginnerKicker', 0.6, 18],
    ['MediumKicker', 1.2, 25],
    ['ProKicker', 1.9, 32],
  ])('%s: lip %f m at %f degrees', (name, lip, angle) => {
    const p = buildShape(name).pieces[0]!;
    const top = pieceHeightAt(p, p.u1);
    expect(top.height).toBeCloseTo(lip, 9);
    expect(deg(atan(top.slope))).toBeCloseTo(angle, 6);
    expect(p.lip).toBe(true);
  });

  it('the spec dimensions come out of the parameters', () => {
    const top = (name: string) => Math.max(...buildShape(name).pieces.filter((p) => p.slide).map((p) => Math.max(p.h0, p.h1)));
    expect(top('Funbox')).toBeCloseTo(1.0, 9);
    expect(top('Rooftop')).toBeCloseTo(1.2, 6);
    expect(top('StepUp')).toBeCloseTo(1.0, 9);
    const kink = buildShape('KinkRail').pieces.filter((p) => p.role === 'Main');
    expect(kink).toHaveLength(2);
    expect(deg(atan((kink[1]!.h1 - kink[1]!.h0) / (kink[1]!.u1 - kink[1]!.u0)))).toBeCloseTo(-12, 6);
    const gap = buildShape('GapBox').pieces;
    expect(gap[1]!.u0 - gap[0]!.u1).toBeCloseTo(1.2, 9);
    expect(gap[0]!.h1).toBeCloseTo(0.9, 9);
    expect(gap[1]!.h0).toBeCloseTo(0.8, 9);
    const step = buildShape('StepUp').pieces.filter((p) => p.role === 'Main');
    expect(step[1]!.u0 - step[0]!.u1).toBeCloseTo(0.8, 9);
    expect(step[0]!.part).not.toBe(step[1]!.part);
    const pyr = buildShape('Pyramid');
    expect(shapeSurfaceAt(pyr, (pyr.uMin + pyr.uMax) / 2, 0)!.height).toBeCloseTo(1.3, 9);
    // The pyramid's side faces: at the base corner the height is at the waterline or below.
    expect(shapeSurfaceAt(pyr, (pyr.uMin + pyr.uMax) / 2, 3.99)!.height).toBeLessThan(0.05);
    const spine = buildShape('Spine').pieces;
    expect(spine.map((p) => p.role)).toEqual(['Ramp', 'LandingRamp']);
    expect(spine[0]!.h1).toBeCloseTo(1.4, 9);
  });

  it('the wall ride: a 2 m transition from under the water into a 78 degree wall 3 m tall', () => {
    const shape = buildShape('WallRide');
    const [tr, wall] = shape.pieces;
    expect(tr!.role).toBe('Transition');
    expect(wall!.role).toBe('Wall');
    const w = wall!.wall!;
    expect(wallHeightAt(w, w.d1).height).toBeCloseTo(3, 9);
    expect(deg(atan(wallHeightAt(w, w.d1).slope))).toBeCloseTo(78, 6);
    expect(wallHeightAt(w, 0).height).toBeCloseTo(-0.15, 9);
    // Continuous at the transition / wall joint.
    expect(wallHeightAt(w, w.d0 - 1e-9).height).toBeCloseTo(wallHeightAt(w, w.d0 + 1e-9).height, 6);
  });
});

describe('legacy kicker and slider defs as pieces', () => {
  it('give bit-identical heights and slopes to the old formulas', () => {
    for (const def of [...LAKESIDE_PARK.features, ...TEST_PARK.features]) {
      if (def.kind === 'feature') continue;
      const shape = legacyShape(def);
      const len = def.kind === 'kicker' ? def.length : def.entryLength + def.length;
      for (let i = 0; i <= 400; i++) {
        const u = (len * i) / 400;
        const s = shapeSurfaceAt(shape, u, 0)!;
        const old = def.kind === 'kicker' ? { ...kickerHeightAt(def, u), onTop: false } : sliderHeightAt(def, u);
        expect(s.height).toBe(old.height);
        expect(s.slope).toBe(old.slope);
        expect(s.piece.slide).toBe(old.onTop);
      }
    }
  });
});
