import { describe, expect, it } from 'vitest';
import type { FeatureDef } from '../src/sim/park';
import { surfaceAt, toWorld } from '../src/sim/features';
import { trackApproach } from '../src/sim/featureRide/approachTracker';
import { balanceHalfWidth } from '../src/sim/featureRide/entryResolver';
import { foreLimit, slideFriction, stepBalance } from '../src/sim/featureRide/slideController';
import { sideEntrySlide, slideSide } from '../src/sim/featureRide/featureRotation';
import { cos } from '../src/sim/math/detmath';
import { SLIDES } from '../src/sim/tricks/data';
import type { SimEvent } from '../src/sim/events';
import type { InputFrame } from '../src/sim/input';
import { add, forwardOf, normalize, scale, vec3 } from '../src/sim/math/vec';
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
    // A crash ends the slide in the same tick: keep it.
    return e.type === 'crash' || (e.type === 'slideDone' && !s.events.some((x) => x.type === 'crash'));
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

const catalog = (name: string): FeatureDef => ({ kind: 'feature', id: 'g', name, catalog: name, s: 135, offset: 0 }) as FeatureDef;

/** Ride straight onto a feature; `onFeature` runs once on the first tick on the main. */
function ride(def: FeatureDef, cfg: Parameters<typeof featureSim>[1], onFeature: (s: SimState) => void = () => {}, input: (t: number, s: SimState) => Partial<InputFrame> = () => ({})) {
  const s = featureSim(def, cfg);
  let on = false;
  let lift = 0;
  const events: SimEvent[] = [];
  runUntil(
    s,
    12,
    (t, st) => {
      if (!on && st.rider.mode === 'onFeature') {
        on = true;
        onFeature(st);
      }
      if (st.rider.jib) lift = Math.max(lift, st.rider.jib.lift);
      return input(t, st);
    },
    (e) => {
      events.push(e);
      return e.type === 'crash' || e.type === 'featureExit';
    },
  );
  const c = events.find((e) => e.type === 'crash');
  const slide = events.find((e) => e.type === 'slideDone');
  return { s, crash: c?.type === 'crash' ? c.reason : null, lift, jib: slide?.type === 'slideDone' ? slide.jib : null };
}

describe('SlideController: slide physics on the feature (feature ride M4, spec 5.1)', () => {
  it('friction from the material (HDPE 0.06, pipe 0.05); boardslides x1.6', () => {
    const on = (def: FeatureDef) => {
      const s = featureSim(def);
      const j = { boardAngle: 0 } as Parameters<typeof slideFriction>[1];
      const f = s.features[0]!;
      return [slideFriction(f, j, s), slideFriction(f, { ...j, boardAngle: Math.PI / 2 }, s)];
    };
    const [box, boxBoard] = on(slider());
    expect(box).toBeCloseTo(0.06, 9);
    expect(boxBoard).toBeCloseTo(0.096, 9);
    expect(on(slider({ style: 'tube', width: 0.4 }))[0]).toBeCloseTo(0.05, 9);
    expect(on(catalog('PipeRail'))[0]).toBeCloseTo(0.05, 9);
  });

  it('fail 8: up a rooftop too slow (rope slack): Stalled', () => {
    const slow = ride(catalog('Rooftop'), noBalance, (s) => {
      s.rider.vel = scale(normalize(s.rider.vel), 1.5);
      s.carrier.s -= 14;
    });
    expect(slow.crash).toBe('stalled');
    expect(ride(catalog('Rooftop'), noBalance).crash).toBeNull();
  });

  it('kinks: a down kink at speed lifts the board 0.05-0.15 s; a sharp one too fast throws the rider (KinkThrow)', () => {
    const kink = ride(catalog('KinkRail'), noBalance);
    expect(kink.crash).toBeNull();
    expect(kink.lift).toBeGreaterThanOrEqual(0.05);
    expect(kink.lift).toBeLessThanOrEqual(0.15);
    // The rooftop's 15-degree down kink at the park's speed is fine; much faster is sketchy, then a throw.
    expect(ride(catalog('Rooftop'), noBalance).jib?.sketchy).toBe(false);
    expect(ride(catalog('Rooftop'), { ...noBalance, cable: { carrierSpeed: 10 } }).jib?.sketchy).toBe(true);
    expect(ride(catalog('Rooftop'), { ...noBalance, cable: { carrierSpeed: 12 } }).crash).toBe('kinkThrow');
  });

  it('landing a kink lift with an input held costs balance; soft knees (nothing held) do not', () => {
    const balanceAfter = (hold: boolean) => {
      let out = 0;
      ride(catalog('KinkRail'), {}, () => {}, (_t, s) => {
        const j = s.rider.jib;
        if (j && j.lift > 0) out = -1;
        if (j && out === -1 && j.lift === 0) out = j.balance;
        return { armsOut: false, pop: hold && !!j && j.lift > 0 };
      });
      return out;
    };
    const soft = balanceAfter(false);
    const stiff = balanceAfter(true);
    expect(Math.abs(stiff - soft)).toBeGreaterThan(0.1);
  });
});

describe('SlideController: balance (feature ride M4, spec 5.6, 5.7)', () => {
  /** A box slide in progress, for driving stepBalance directly. */
  const onBox = (def = slider()) => {
    const s = featureSim(def);
    runUntil(s, 6, () => ({}), () => s.rider.mode === 'onFeature');
    const f = s.features[0]!;
    const j = s.rider.jib!;
    const piece = f.shape.pieces.find((p) => p.slide)!;
    const surface = surfaceAt(f, { u: s.rider.ramp!.u, v: 0 })!;
    const mem = { steerTap: 0, foreTap: 0 } as Parameters<typeof stepBalance>[8];
    return { s, f, j, piece, surface, mem };
  };

  it('a rope tension spike over 1600 N throws the balance toward the cable side, once per spike', () => {
    const { s, f, j, piece, surface, mem } = onBox();
    j.balance = 0;
    j.time = 0;
    s.rider.ropeTension = 1700;
    stepBalance(s, j, f, piece, surface, 6, 300, 800, mem);
    const first = j.balance;
    expect(first).toBeGreaterThan(0.3);
    stepBalance(s, j, f, piece, surface, 6, 300, 800, mem);
    expect(j.balance - first).toBeLessThan(0.1);
  });

  it('out of balance mid-feature falls off; within the last metre it is a sketchy exit', () => {
    const { s, f, j, piece, surface, mem } = onBox();
    s.rider.ropeTension = 800;
    j.balance = 1.5;
    expect(stepBalance(s, j, f, piece, surface, 6, 0, 800, mem)).toBe('fell');
    j.balance = 1.5;
    expect(stepBalance(s, j, f, piece, surface, piece.u1 - 0.5, 0, 800, mem)).toBe('sketchyExit');
  });

  it('fore-aft only moves in boardslides (rope along the feature tips it; W/S taps correct it) and settles in a 50-50', () => {
    const { s, f, j, piece, surface, mem } = onBox();
    s.rider.ropeTension = 800;
    j.balance = 0;
    j.fore = 0.5;
    stepBalance(s, j, f, piece, surface, 6, 0, 800, mem);
    expect(j.fore).toBeLessThan(0.5);
    j.boardAngle = Math.PI / 2;
    j.fore = 0;
    for (let i = 0; i < 60; i++) stepBalance(s, j, f, piece, surface, 6, 0, 2000, mem);
    expect(j.fore).toBeGreaterThan(0.2);
    const before = j.fore;
    stepBalance(s, j, f, piece, surface, 6, 0, 2000, { ...mem, foreTap: -1 });
    expect(j.fore).toBeLessThan(before - 0.25);
  });

  it('noise: pipes drift more than rails, rails more than boxes; on a pipe a boardslide is steadier than a 50-50', () => {
    const drift = (def: FeatureDef, boardAngle: number) => {
      const { s, f, j, piece, surface, mem } = onBox(def);
      s.rider.ropeTension = 0;
      let sum = 0;
      j.boardAngle = boardAngle;
      for (let i = 0; i < 300; i++) {
        j.balance = 0;
        j.time = i * 0.05;
        stepBalance(s, j, f, piece, surface, 6, 0, 0, mem);
        sum += Math.abs(j.balance);
      }
      return sum;
    };
    const box = drift(slider(), 0);
    const rail = drift(slider({ style: 'rail', width: 0.12 }), 0);
    const pipe = drift(slider({ style: 'tube', width: 0.4 }), 0);
    expect(rail).toBeGreaterThan(box);
    expect(pipe).toBeGreaterThan(rail);
    expect(drift(slider({ style: 'tube', width: 0.4 }), Math.PI / 2)).toBeLessThan(pipe);
    expect(drift(slider(), Math.PI / 2)).toBeGreaterThan(box);
  });
});

describe('FeatureRotation: boardslide / lipslide and frontside / backside (feature ride M5, spec 5.2, 12.1)', () => {
  it('every approach side, rotation direction and stance (regular / goofy, normal / switch)', () => {
    const rows: string[] = [];
    for (const stance of ['regular', 'goofy'] as const)
      for (const sw of [false, true])
        for (const featureRight of [true, false])
          for (const dir of [1, -1]) {
            const heading = 0.3;
            const toes = (stance === 'regular' ? 1 : -1) * (sw ? -1 : 1);
            // The rider is on the feature's left when it is on their right (feature axis = travel).
            const fromSide = featureRight ? -1 : 1;
            const yaw = heading + (dir * Math.PI) / 2;
            const id = sideEntrySlide(yaw, heading, fromSide, toes, heading);
            const toeside = (toes > 0) === featureRight;
            const noseOver = (dir > 0) === featureRight;
            expect(slideSide(id)).toBe(toeside ? 'frontside' : 'backside');
            expect(id === 'backLip' || id === 'frontLip').toBe(!noseOver);
            // Backside boardslide: chest forward; frontside: back forward. Lipslides the other way round.
            const chestForward = cos(yaw + (toes * Math.PI) / 2 - heading) > 0;
            expect(chestForward).toBe((slideSide(id) === 'backside') === noseOver);
            rows.push(`${stance}${sw ? ' switch' : ''} feature ${featureRight ? 'right' : 'left'} turn ${dir > 0 ? '+' : '-'}: ${SLIDES[id].name}`);
          }
    expect(new Set(rows).size).toBe(16);
  });
});

describe('Rotations on and onto the feature (feature ride M5, spec 5.3, 5.4)', () => {
  const side90 = (offset: number, turn: 1 | -1, stance: 'regular' | 'goofy' = 'regular') => {
    const toward = offset > 0 ? 1 : -1;
    return play(
      slider({ offset }),
      (t) => ({
        pop: between(3.2, 3.4)(t),
        steer: between(3.4 - 1 / 60, 3.4 + 1 / 60)(t) ? toward : between(3.4 + 1 / 60, 3.6)(t) ? toward * turn : 0,
      }),
      (s) => (s.rider.stance = stance),
    );
  };

  it('pass 3: side ollie-on with a 90 turning the nose over: heelside a backside boardslide, toeside a frontside boardslide', () => {
    expect(side90(-1.6, 1).jib?.slideOrder).toEqual(['backboard']);
    expect(side90(1.6, 1).jib?.slideOrder).toEqual(['frontboard']);
    expect(side90(1.6, 1, 'goofy').jib?.slideOrder).toEqual(['backboard']);
    // The tail over first: lipslides.
    expect(side90(-1.6, -1).jib?.slideOrder).toEqual(['backLip']);
    expect(side90(1.6, -1).jib?.slideOrder).toEqual(['frontLip']);
    expect(SLIDES.backboard.name).toBe('Backside Boardslide');
  });

  it('pass 7: 50-50, then A/D on the feature: backside or frontside boardslide by direction', () => {
    const turn = (dir: number) => play(slider(), (t) => ({ steer: between(3.6, 3.8)(t) ? dir : 0 })).jib?.slideOrder;
    expect(turn(-1)).toEqual(['fiftyFifty', 'backboard']);
    expect(turn(1)).toEqual(['fiftyFifty', 'frontboard']);
  });

  it('holding A/D chains the 90-degree steps into one rotation (50-50 180 switch 50-50)', () => {
    const { jib, crash } = play(slider(), (t) => ({ steer: between(3.6, 3.95)(t) ? -1 : 0 }));
    expect(crash).toBeNull();
    expect(jib?.rotations.map((x) => x.deg)).toEqual([180]);
    expect(jib?.slideOrder.at(-1)).toBe('switchFiftyFifty');
  });

  it('hard way: a rotation against the slide it comes out of is marked (and allowed)', () => {
    const out = (dir: number) => {
      const r = play(slider({ offset: 1.6 }), (t) => ({
        pop: between(3.2, 3.4)(t),
        steer: between(3.4 - 1 / 60, 3.4 + 1 / 60)(t) ? 1 : between(3.4 + 1 / 60, 3.6)(t) ? 1 : between(4.3, 4.5)(t) ? dir : 0,
        pass: between(4.35, 4.6)(t),
      }));
      return r.jib?.rotations[0];
    };
    const a = out(1);
    const b = out(-1);
    expect(a?.from).toBe('frontboard');
    expect(b?.from).toBe('frontboard');
    expect([a?.hardWay, b?.hardWay].sort()).toEqual([false, true]);
    expect((a?.hardWay ? a : b)?.side).toBe('backside');
  });

  it('a rotation started too close to the end runs out mid-rotation (RanOutMidRotation)', () => {
    const s = featureSim(slider(), noBalance);
    let crash: string | null = null;
    runUntil(s, 6, (_t, st) => ({ steer: st.rider.ramp && st.rider.mode === 'onFeature' && st.rider.ramp.u > 9.2 ? -1 : 0 }), (e) => {
      if (e.type === 'crash') crash = e.reason;
      return e.type === 'crash';
    });
    expect(crash).toBe('ranOutMidRotation');
    // With room to finish (the step starts about 2 m before the end) it is fine.
    const ok = featureSim(slider(), noBalance);
    let c2: string | null = null;
    let started = false;
    runUntil(ok, 6, (_t, st) => {
      if (st.rider.ramp && st.rider.mode === 'onFeature' && st.rider.ramp.u > 7.6) started = true;
      return { steer: started && st.rider.mode === 'onFeature' && st.rider.jib!.rotations.length === 0 ? -1 : 0 };
    }, (e) => {
      if (e.type === 'crash') c2 = e.reason;
      return e.type === 'crash' || e.type === 'featureExit';
    });
    expect(c2).toBeNull();
  });

  it('fail 7: a backside rotation on the feature without Q drops the handle', () => {
    expect(play(slider(), (t) => ({ steer: between(3.6, 4.0)(t) ? 1 : 0 })).crash).toBe('handleDropped');
  });
});

describe('PressController: presses and taps (feature ride M6, spec 5.5)', () => {
  it('W held on a 50-50 is a nose press, S a tail press: the board rocks 10 degrees onto that end', () => {
    const nose = play(slider(), (t) => ({ forward: between(3.6, 4.4)(t) }));
    expect(nose.crash).toBeNull();
    expect(nose.jib!.pressTimes.nose).toBeGreaterThan(0.5);
    expect(nose.jib!.pressTimes.tail).toBe(0);
    const tail = play(slider(), (t) => ({ back: between(3.6, 4.4)(t) }));
    expect(tail.jib!.pressTimes.tail).toBeGreaterThan(0.5);
    expect(nose.s.cfg.featureRide.Press.Pitch).toBeCloseTo(deg(10), 9);
  });

  it('a press rides on less base: friction x0.8', () => {
    const s = featureSim(slider());
    const f = s.features[0]!;
    const j = { boardAngle: 0, pressAmount: 1 } as Parameters<typeof slideFriction>[1];
    expect(slideFriction(f, j, s)).toBeCloseTo(0.06 * 0.8, 9);
  });

  it('no press in a boardslide; a W/S tap is not a press', () => {
    const board = play(slider(), (t) => ({ steer: between(3.6, 3.8)(t) ? -1 : 0, forward: between(4.0, 4.4)(t) }));
    expect(board.jib!.pressTimes.nose).toBe(0);
    const tap = play(slider(), (t) => ({ forward: between(3.7, 3.75)(t) }));
    expect(tap.jib!.pressTimes.nose).toBe(0);
  });

  it('the fore-aft window narrows the longer the press is held: let go in time or fall off', () => {
    const s = featureSim(slider());
    const j = { press: 1, pressTime: 0 } as Parameters<typeof foreLimit>[0];
    expect(foreLimit(j, s)).toBe(1);
    j.pressTime = 2;
    expect(foreLimit(j, s)).toBeCloseTo(0.5, 9);
    j.pressTime = 10;
    expect(foreLimit(j, s)).toBeCloseTo(s.cfg.featureRide.Press.MinWindow, 9);
    // A long box: holding the press the whole way falls off; letting go after a second is fine.
    const long = slider({ length: 16 });
    const withBalance = (s: SimState) => (s.cfg.feature.balanceEnabled = true);
    const held = play(long, (t) => ({ forward: between(3.6, 6)(t) }), withBalance, 7);
    expect(held.crash).toBe('fellOffFeature');
    expect(held.jib!.pressTimes.nose).toBeGreaterThan(1);
    const brief = play(long, (t) => ({ forward: between(3.6, 4.4)(t) }), withBalance, 7);
    expect(brief.jib!.pressTimes.nose).toBeGreaterThan(0.5);
    expect(brief.crash).not.toBe('fellOffFeature');
  });

  it('a W tap in the last 0.5 m is a nose tap, S a tail tap; earlier it is not', () => {
    const tapAt = (key: 'forward' | 'back', fromEnd: number) => {
      const s = featureSim(slider(), noBalance);
      let slide: SimEvent | undefined;
      // Down for 0.3 m (under feature.tapTime at this speed), let go `fromEnd` before the end.
      runUntil(s, 6, (_t, st) => {
        const u = st.rider.mode === 'onFeature' && st.rider.ramp ? st.rider.ramp.u : -1;
        return { [key]: u >= 11 - fromEnd - 0.3 && u < 11 - fromEnd };
      }, (e) => {
        if (e.type === 'slideDone') slide = e;
        return e.type === 'slideDone';
      });
      return slide?.type === 'slideDone' ? slide.jib.endTap : 'none';
    };
    expect(tapAt('forward', 0.2)).toBe('nose');
    expect(tapAt('back', 0.2)).toBe('tail');
    expect(tapAt('forward', 2)).toBeNull();
  });
});
