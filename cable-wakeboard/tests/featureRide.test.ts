import { describe, expect, it } from 'vitest';
import type { FeatureDef } from '../src/sim/park';
import { surfaceAt, toWorld } from '../src/sim/features';
import { trackApproach } from '../src/sim/featureRide/approachTracker';
import { balanceHalfWidth } from '../src/sim/featureRide/entryResolver';
import type { SimEvent } from '../src/sim/events';
import type { InputFrame } from '../src/sim/input';
import { add, forwardOf, scale, vec3 } from '../src/sim/math/vec';
import { airOverFeature } from '../src/sim/onFeature';
import type { AirState } from '../src/sim/rider';
import { takeOff } from '../src/sim/step';
import type { SimState } from '../src/sim/world';
import { featureSim, run, runUntil } from './helpers';

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

const deg = (d: number) => (d * Math.PI) / 180;
const between = (a: number, b: number) => (t: number) => t >= a && t < b;
const noBalance = { feature: { balanceEnabled: false } };
const slider = (o: Partial<Extract<FeatureDef, { kind: 'slider' }>> = {}): FeatureDef => ({
  kind: 'slider', id: 'b', name: 'B', style: 'box', s: 135, offset: 0, length: 8, width: 1, height: 0.5, entryLength: 3, safety: 'flush', ...o,
});

/** Play a script; events until the first slide or crash. */
function play(def: FeatureDef, script: (t: number) => Partial<InputFrame>, setup: (s: SimState) => void = () => {}, seconds = 6) {
  const s = featureSim(def, noBalance);
  setup(s);
  const events: SimEvent[] = [];
  runUntil(s, seconds, script, (e) => {
    events.push(e);
    return e.type === 'crash' || e.type === 'slideDone';
  });
  const crash = events.find((e) => e.type === 'crash');
  const slide = events.find((e) => e.type === 'slideDone');
  const landed = events.find((e) => e.type === 'landed');
  return {
    takeoffSide: landed?.type === 'landed' ? landed.air.entry?.side ?? null : null,
    s,
    events,
    crash: crash?.type === 'crash' ? crash.reason : null,
    jib: slide?.type === 'slideDone' ? slide.jib : null,
    modes: events.flatMap((e) => (e.type === 'transition' ? [e.to] : [])),
  };
}

/**
 * Drop the board onto the box's main from the air: at feature-local (u, v),
 * coming down at `vy`, the board turned `yaw` from the axis. `air` adjusts
 * the AirState first (entry, crossing, spin rate). Returns the crash reason
 * or the jib it started.
 */
function drop(def: FeatureDef, o: { u?: number; v?: number; yaw?: number; vy?: number; air?: (a: AirState) => void }) {
  const s = featureSim(def, noBalance);
  run(s, 1);
  const f = s.features[0]!;
  const air = takeOff(s, 'flat', null, 0, 0);
  const u = o.u ?? 6;
  const v = o.v ?? 0;
  const top = surfaceAt(f, { u, v })!;
  s.rider.pos = toWorld(f, u, v, top.height - 0.01);
  s.rider.vel = add(scale(forwardOf(f.heading), 8), vec3(0, -(o.vy ?? 2), 0));
  air.takeoffHeading = f.heading;
  air.rot.spinAngle = o.yaw ?? 0;
  air.overFeature = `b:${top.piece.part}`;
  o.air?.(air);
  s.events.length = 0;
  airOverFeature(s, air);
  const c = s.events.find((e) => e.type === 'crash');
  return { s, crash: c?.type === 'crash' ? c.reason : null, jib: s.rider.jib };
}

describe('EntryResolver: landing on the feature (feature ride M2, spec 4)', () => {
  it('balance width: box top minus 0.2 m, rail 0.15 m, pipe 0.1 m from the centre', () => {
    const half = (style: 'box' | 'rail' | 'tube', width: number) => {
      const s = featureSim(slider({ style, width }));
      return balanceHalfWidth(s.features[0]!.shape.pieces[1]!, s);
    };
    expect(half('box', 1)).toBeCloseTo(0.4, 9);
    expect(half('rail', 0.12)).toBeCloseTo(0.15, 9);
    expect(half('tube', 0.4)).toBeCloseTo(0.1, 9);
  });

  it('board angle snaps within 20 degrees, is sketchy to 30, crashes past it (BadAngle)', () => {
    const clean = drop(slider(), { yaw: deg(12) });
    expect(clean.crash).toBeNull();
    expect(clean.jib?.boardAngle).toBe(0);
    expect(clean.jib?.sketchy).toBe(false);
    const sketchy = drop(slider(), { yaw: deg(25) });
    expect(sketchy.crash).toBeNull();
    expect(sketchy.jib?.sketchy).toBe(true);
    expect(Math.abs(sketchy.jib!.balance)).toBeGreaterThan(0.5);
    expect(drop(slider(), { yaw: deg(35) }).crash).toBe('badAngle');
    expect(drop(slider(), { yaw: deg(80) }).jib?.boardAngle).toBeCloseTo(Math.PI / 2, 9);
  });

  it('a hard edge held to takeoff rolls the base: past 12 degrees it slips out, past 8 it is sketchy', () => {
    const withRoll = (roll: number) => drop(slider(), { air: (a) => (a.entry = { featureId: 'b', side: 'heelside', angle: 0, hop: 0, roll }) });
    expect(withRoll(deg(16)).crash).toBe('slippedOut');
    expect(withRoll(deg(10)).jib?.sketchy).toBe(true);
    expect(withRoll(0).jib?.sketchy).toBe(false);
  });

  it('across the feature: short of the balance width on the side it came from clips it, just past the far side is sketchy', () => {
    const side = (v: number, from: number) => drop(slider(), { v, air: (a) => (a.crossing = { featureId: 'b', part: 'b:1', side: from, height: 0.5 }) });
    expect(side(0.45, 1).crash).toBe('clippedSide');
    expect(side(0.45, -1).jib?.sketchy).toBe(true);
    expect(side(0.2, -1).jib?.sketchy).toBe(false);
  });

  it('pipe rails: the board has to land within 0.1 m of the top centre, further rolls off', () => {
    const pipe = slider({ style: 'tube', width: 0.4 });
    expect(drop(pipe, { v: 0.05 }).crash).toBeNull();
    expect(drop(pipe, { v: 0.15 }).crash).toBe('fellOffFeature');
  });

  it('impact: a balance hit above 5 m/s, a crash above 8 m/s; still spinning fast skids (sketchy)', () => {
    expect(drop(slider(), { vy: 4 }).jib?.balance).toBeCloseTo(0, 9);
    expect(Math.abs(drop(slider(), { vy: 6.5 }).jib!.balance)).toBeGreaterThan(0.2);
    expect(drop(slider(), { vy: 8.5 }).crash).toBe('hardLanding');
    expect(drop(slider(), { air: (a) => (a.rot.spinRate = deg(200)) }).jib?.sketchy).toBe(true);
  });
});

describe('Entry scenarios (feature ride M2-M3, spec 12.2)', () => {
  // The rider rides the line; the box starts about 3.2 s in (safety 0..3 m, main 3..11 m).
  const sideHop = (offset: number, pop: [number, number], stance: 'regular' | 'goofy' = 'regular', carve?: [number, number]) => {
    const toward = offset > 0 ? 1 : -1;
    return play(
      slider({ offset }),
      (t) => ({
        pop: between(pop[0], pop[1])(t),
        steer: between(pop[1] - 1 / 60, pop[1] + 1 / 60)(t) ? toward : carve && between(carve[0], carve[1])(t) ? toward : 0,
      }),
      (s) => (s.rider.stance = stance),
    );
  };

  it('pass 1: front ollie-on with enough charge: 50-50', () => {
    const { jib, crash } = play(slider(), (t) => ({ pop: between(2.6, 2.9)(t) }));
    expect(crash).toBeNull();
    expect(jib?.entry).toBe('ollieOn');
    expect(jib?.slideOrder).toEqual(['fiftyFifty']);
  });

  it('pass 2: side ollie-on from the heelside and from the toeside: 50-50', () => {
    for (const [offset, stance, side] of [[-1.6, 'regular', 'heelside'], [1.6, 'regular', 'toeside'], [1.6, 'goofy', 'heelside'], [-1.6, 'goofy', 'toeside']] as const) {
      const r = sideHop(offset, [3.2, 3.4], stance);
      const takeoff = r.events.find((e) => e.type === 'takeoff');
      expect(takeoff).toBeDefined();
      expect(r.crash).toBeNull();
      expect(r.jib?.entry).toBe('sideOllieOn');
      expect(r.jib?.slideOrder).toEqual(['fiftyFifty']);
      expect(r.takeoffSide).toBe(side);
    }
  });

  it('pass 4: ride up a flush safety: 50-50', () => {
    const { jib, modes } = play(slider(), () => ({}));
    expect(modes.slice(0, 2)).toEqual(['onSafety', 'onFeature']);
    expect(jib?.entry).toBe('rideOn');
  });

  it('pass 5: ollie onto the safety from beside it, then pop in the window: onto the main', () => {
    const { jib, modes, crash } = play(slider({ offset: 1.3, entryLength: 6, safety: 'gap' }), (t) => ({
      pop: between(3.0, 3.1)(t) || between(3.65, 3.9)(t),
      steer: between(3.1 - 1 / 60, 3.1 + 1 / 60)(t) ? 1 : 0,
    }));
    expect(crash).toBeNull();
    expect(modes.slice(0, 4)).toEqual(['airborne', 'onSafety', 'airborne', 'onFeature']);
    expect(['pop', 'popOn']).toContain(jib?.entry);
  });

  it('pass 6: pop off the safety with a 180-in: switch 50-50', () => {
    const { jib, crash } = play(slider(), (t) => ({ pop: between(3.2, 3.5)(t), steer: between(3.5, 3.8)(t) ? 1 : 0 }));
    expect(crash).toBeNull();
    expect(jib?.entry).toBe('popOn');
    expect(Math.round((jib!.inRotation * 180) / Math.PI)).toBe(180);
    expect(jib?.slideOrder).toEqual(['switchFiftyFifty']);
  });

  it('fail 1: an ollie too low for the front: ShortOllie', () => {
    expect(play(slider({ safety: 'gap' }), (t) => ({ pop: between(1.7, 2.3)(t) })).crash).toBe('shortOllie');
  });

  it('fail 2: a side ollie too low clips the side (ClippedSide)', () => {
    expect(sideHop(1.6, [3.3, 3.4]).crash).toBe('clippedSide');
  });

  it('fail 3: a side approach at 40 degrees: NoseHitSide', () => {
    expect(play(slider({ offset: -3, yaw: 0.7 }), (t) => ({ pop: between(3.0, 3.3)(t), steer: between(3.3 - 1 / 60, 3.3 + 1 / 60)(t) ? -1 : 0 })).crash).toBe('noseHitSide');
    expect(play(slider({ offset: 3, yaw: -0.7 }), (t) => ({ pop: between(3.0, 3.3)(t), steer: between(3.3 - 1 / 60, 3.3 + 1 / 60)(t) ? 1 : 0 })).crash).toBe('noseHitSide');
  });

  it('fail 4: a side hop too strong for the gap: Overshoot (just past it is a sketchy recovery)', () => {
    expect(sideHop(1.0, [3.2, 3.4]).crash).toBe('overshoot');
    const just = sideHop(1.1, [3.2, 3.4]);
    expect(just.crash).toBeNull();
    expect(just.jib?.sketchy).toBe(true);
  });

  it('fail 5: gap box with no pop: MissedSafetyPop', () => {
    expect(play(slider({ safety: 'gap' }), () => ({})).crash).toBe('missedSafetyPop');
  });

  it('fail 6: a hard edge held to takeoff on a backside entry: SlippedOut', () => {
    // Heelside approach (regular, feature on the left), carving hard toward it right up to the pop.
    expect(sideHop(-2.2, [3.2, 3.4], 'regular', [3.0, 3.39]).crash).toBe('slippedOut');
  });

  it('popped off a gap safety and down in the gap: LandedInGap (early pops off the 17-degree safety still carry, so set it up)', () => {
    const s = featureSim({ kind: 'feature', id: 'g', name: 'G', catalog: 'GapBox', s: 135, offset: 0 } as FeatureDef, noBalance);
    run(s, 1);
    const f = s.features[0]!;
    const safety = f.shape.pieces.find((p) => p.role === 'Safety')!;
    const main = f.shape.pieces.find((p) => p.slide)!;
    expect(main.u0).toBeGreaterThan(safety.u1 + 0.5);
    const air = takeOff(s, 'feature', 'g', 0, 0);
    air.pendingEntry = 'pop';
    s.rider.pos = toWorld(f, (safety.u1 + main.u0) / 2, 0, 0.005);
    s.rider.vel = add(scale(forwardOf(f.heading), 2), vec3(0, -1, 0));
    const events: SimEvent[] = [];
    runUntil(s, 0.1, () => ({}), (e) => {
      events.push(e);
      return e.type === 'crash';
    });
    expect(events.find((e) => e.type === 'crash')).toMatchObject({ reason: 'landedInGap' });
  });
});
