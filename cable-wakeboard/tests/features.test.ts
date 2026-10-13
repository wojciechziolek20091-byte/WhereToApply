import { DEFAULT_CONFIG } from '../src/sim/config';
import { kickerHeightAt, sliderHeightAt, toLocal, toWorld } from '../src/sim/features';
import { neutralInput, type InputFrame } from '../src/sim/input';
import { vec3 } from '../src/sim/math/vec';
import type { KickerDef, ParkDef, SliderDef } from '../src/sim/park';
import type { SimEvent } from '../src/sim/events';
import { stepSim } from '../src/sim/step';
import { createSim, type SimState } from '../src/sim/world';

const kicker: KickerDef = { kind: 'kicker', id: 'k', name: 'K', s: 75, offset: 0, length: 4.5, width: 3.5, height: 1.1, lipAngle: 0.5 };
const box: SliderDef = {
  kind: 'slider',
  id: 'b',
  name: 'Box',
  style: 'box',
  s: 75,
  offset: 0,
  length: 10,
  width: 0.6,
  height: 0.5,
  entryLength: 3,
};
const park = (...features: ParkDef['features']): ParkDef => ({ name: 'test', features });

/** Step until `stop` returns true for an event (max 20 s). Collects all events. */
function runUntil(s: SimState, input: (tick: number) => Partial<InputFrame>, stop: (e: SimEvent) => boolean): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < 60 * 20; t++) {
    stepSim(s, { ...neutralInput(), ...input(t) });
    all.push(...s.events);
    if (s.events.some(stop)) return all;
  }
  throw new Error('condition never met');
}
const touchdown = (e: SimEvent) => e.type === 'landed' || e.type === 'fall';

/** Tick the rider leaves the kicker lip with no input. */
function lipTick(): number {
  const s = createSim(DEFAULT_CONFIG, park(kicker));
  let tick = -1;
  runUntil(s, () => ({}), (e) => {
    if (e.type === 'takeoff') tick = e.tick;
    return e.type === 'takeoff';
  });
  return tick;
}

describe('feature geometry', () => {
  it('kicker curve meets the lip angle', () => {
    expect(kickerHeightAt(kicker, 0).height).toBe(0);
    expect(kickerHeightAt(kicker, kicker.length).height).toBeCloseTo(kicker.height, 9);
    expect(kickerHeightAt(kicker, kicker.length).slope).toBeCloseTo(Math.tan(kicker.lipAngle), 9);
    expect(kickerHeightAt(kicker, kicker.length / 2).height).toBeLessThan(kicker.height / 2);
  });

  it('slider has an entry ramp then a flat top', () => {
    expect(sliderHeightAt(box, 1.5).height).toBeCloseTo(box.height / 2, 9);
    expect(sliderHeightAt(box, 5)).toEqual({ height: box.height, slope: 0, onTop: true });
  });

  it('local and world coordinates round-trip', () => {
    const f = { def: kicker, origin: vec3(10, 0, -4), heading: 0.7 };
    const w = toWorld(f, 2, -0.5, 0);
    const l = toLocal(f, w);
    expect(l.u).toBeCloseTo(2, 9);
    expect(l.v).toBeCloseTo(-0.5, 9);
  });
});

describe('kicker', () => {
  const lip = lipTick();
  const hit = (releaseOffset: number | null) => {
    const s = createSim(DEFAULT_CONFIG, park(kicker));
    const events = runUntil(
      s,
      (t) => ({ load: releaseOffset !== null && t >= lip + releaseOffset - 24 && t < lip + releaseOffset }),
      touchdown,
    );
    const takeoff = events.find((e) => e.type === 'takeoff');
    const end = events.find(touchdown)!;
    return { takeoff, end };
  };

  it('launches off the lip without any pop and lands clean', () => {
    const { takeoff, end } = hit(null);
    expect(takeoff?.type === 'takeoff' && takeoff.source).toBe('kicker');
    expect(end.type).toBe('landed');
    if (end.type === 'landed') expect(end.air.peakHeight).toBeGreaterThan(kicker.height + 0.3);
  });

  it('a pop released just before the lip goes higher than an early one or none', () => {
    const peak = (r: ReturnType<typeof hit>) => (r.end.type === 'landed' ? r.end.air.peakHeight : 0);
    const timed = hit(-4);
    const early = hit(-20);
    const none = hit(null);
    expect(peak(timed)).toBeGreaterThan(peak(early));
    expect(peak(early)).toBeGreaterThanOrEqual(peak(none));
  });

  it('popping on the water before the ramp lands on the ramp and crashes', () => {
    const { takeoff, end } = hit(-45);
    expect(takeoff?.type === 'takeoff' && takeoff.source).toBe('flat');
    expect(end.type === 'fall' && end.kind).toBe('featureCrash');
  });

  it('hitting a kicker from the side is a crash', () => {
    const s = createSim(DEFAULT_CONFIG, park({ ...kicker, yaw: Math.PI / 2, offset: -2 }));
    const events = runUntil(s, () => ({}), touchdown);
    expect(events.find(touchdown)).toMatchObject({ type: 'fall', kind: 'featureCrash' });
  });
});

describe('slider', () => {
  it('slides a centred box 50-50 and rolls off the end', () => {
    const s = createSim(DEFAULT_CONFIG, park(box));
    const events = runUntil(s, () => ({}), (e) => e.type === 'jibDone');
    const done = events.find((e) => e.type === 'jibDone');
    expect(done?.type === 'jibDone' && done.alignedTime).toBeGreaterThan(0.5);
    expect(events.some((e) => e.type === 'fall')).toBe(false);
  });

  it('turns the board across for a boardslide', () => {
    const s = createSim(DEFAULT_CONFIG, park(box));
    const events = runUntil(s, () => ({ spin: 1 }), (e) => e.type === 'jibDone' || e.type === 'fall');
    const done = events.find((e) => e.type === 'jibDone');
    expect(done?.type === 'jibDone' && done.crossedTime).toBeGreaterThan(0.3);
  });

  it('leaning hard off balance falls off', () => {
    const s = createSim(DEFAULT_CONFIG, park(box));
    let onBox = false;
    const events = runUntil(
      s,
      () => ({ edge: onBox ? 1 : 0 }),
      (e) => {
        if (e.type === 'featureEnter') onBox = true;
        return e.type === 'fall' || e.type === 'jibDone';
      },
    );
    expect(events.some((e) => e.type === 'fall' && e.kind === 'featureCrash')).toBe(true);
  });
});
