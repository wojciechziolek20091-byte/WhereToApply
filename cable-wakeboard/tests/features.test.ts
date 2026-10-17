import type { SimEvent } from '../src/sim/events';
import type { InputFrame } from '../src/sim/input';
import type { FeatureDef, SliderDef } from '../src/sim/park';
import { classifyAir, classifySlide } from '../src/sim/tricks/classify';
import { featureSim, run, runUntil } from './helpers';
import type { SimState } from '../src/sim/world';

// The rider starts about 17 m behind the carrier (s 125), so near s 108; features sit at s 135.
const kicker: FeatureDef = { kind: 'kicker', id: 'k', name: 'K', s: 135, offset: 0, length: 4.5, width: 3.5, height: 1.2, lipAngle: 0.5 };
const box = (safety: 'flush' | 'gap', style: SliderDef['style'] = 'box'): FeatureDef => ({
  kind: 'slider', id: 'b', name: 'B', style, s: 135, offset: 0, length: 8, width: style === 'box' ? 1 : 0.12, height: 0.5, entryLength: 3, safety,
});
const noBalance = { feature: { balanceEnabled: false } };
const between = (a: number, b: number) => (t: number) => t >= a && t < b;

/** Play a script and collect every event. */
function play(def: FeatureDef, script: (t: number, s: SimState) => Partial<InputFrame>, cfg = {}, seconds = 7): { s: SimState; events: SimEvent[] } {
  const s = featureSim(def, cfg);
  const events: SimEvent[] = [];
  runUntil(s, seconds, script, (e) => {
    events.push(e);
    return false;
  });
  return { s, events };
}
const crashOf = (events: SimEvent[]) => events.find((e) => e.type === 'crash');
const modesOf = (events: SimEvent[]) => events.flatMap((e) => (e.type === 'transition' ? [e.to] : []));

describe('kicker (milestone 6)', () => {
  it('rides up the ramp (no tricks on it) and launches with the ramp exit velocity', () => {
    const { s, events } = play(kicker, (t) => ({ steer: between(3.3, 3.6)(t) ? 1 : 0 }));
    expect(modesOf(events)).toEqual(expect.arrayContaining(['onKicker', 'airborne', 'landing']));
    const landed = events.find((e) => e.type === 'landed');
    if (landed?.type !== 'landed') throw new Error('no landing');
    expect(landed.air.source).toBe('kicker');
    expect(landed.air.peakHeight).toBeGreaterThan(1.6);
    expect(landed.air.rot.spinAngle).toBe(0); // A/D on the ramp does nothing
    expect(classifyAir(landed.air, landed.landing, s.cfg)?.name).toBe('Kicker Air');
  });

  it('a pop within lipPopWindow of the lip adds height; too early or after the lip does not', () => {
    const peak = (release: number) => {
      const { events } = play(kicker, (t) => ({ pop: between(release - 0.4, release)(t) }));
      const l = events.find((e) => e.type === 'landed');
      return l?.type === 'landed' ? { peak: l.air.peakHeight, lip: l.air.lipPop } : null;
    };
    const plain = peak(3.55)!;
    const popped = peak(3.7)!;
    expect(plain.lip).toBe(false);
    expect(popped.lip).toBe(true);
    expect(popped.peak).toBeGreaterThan(plain.peak * 1.1);
  });
});

describe('obstacles (milestone 7)', () => {
  it('flush safety: ride on without a pop', () => {
    const { events } = play(box('flush'), () => ({}), noBalance);
    expect(modesOf(events)).toEqual(expect.arrayContaining(['onSafety', 'onFeature', 'airborne']));
    const slide = events.find((e) => e.type === 'slideDone');
    if (slide?.type !== 'slideDone') throw new Error('no slide');
    expect(slide.jib.entry).toBe('rideOn');
    expect(classifySlide(slide.jib, featureSim(box('flush')).cfg)?.name).toBe('50-50');
  });

  it('gap safety: no pop crashes, an early hop back onto the safety still needs the pop; a pop in the window gets on, the centre is a Pop-on', () => {
    expect(crashOf(play(box('gap'), () => ({}), noBalance).events)).toMatchObject({ reason: 'missedSafetyPop' });
    const early = play(box('gap'), (t) => ({ pop: between(3.15, 3.2)(t) }), noBalance).events;
    expect(modesOf(early)).toEqual(['onSafety', 'airborne', 'onSafety', 'crashed']);
    expect(crashOf(early)).toMatchObject({ reason: 'missedSafetyPop' });
    const { s, events } = play(box('gap'), (t) => ({ pop: between(3.2, 3.5)(t) }), noBalance);
    const slide = events.find((e) => e.type === 'slideDone');
    if (slide?.type !== 'slideDone') throw new Error('no slide');
    expect(slide.jib.entry).toBe('popOn');
    expect(classifySlide(slide.jib, s.cfg)?.name).toBe('Pop-on 50-50');
  });

  it('flush safety: an early pop is lower, just short of the main is a tail clip: a sketchy entry (combo multiplier)', () => {
    const { s, events } = play(box('flush'), (t) => ({ pop: between(2.9, 3.25)(t) }), noBalance);
    const slide = events.find((e) => e.type === 'slideDone');
    if (slide?.type !== 'slideDone') throw new Error('no slide');
    expect(slide.jib.sketchy).toBe(true);
    expect(classifySlide(slide.jib, s.cfg)?.comboFactor).toBe(s.cfg.safety.sketchyMultiplier);
  });

  it('an ollie that comes down short clips the main', () => {
    expect(crashOf(play(box('gap'), (t) => ({ pop: between(1.7, 2.3)(t) }), noBalance).events)).toMatchObject({ reason: 'shortOllie' });
  });

  it('holding A/D rotates the board 90 degrees: backboard (chest forward) and frontboard', () => {
    const name = (steer: number) => {
      const { s, events } = play(box('flush'), (t) => ({ steer: between(3.6, 3.8)(t) ? steer : 0 }), noBalance);
      const slide = events.find((e) => e.type === 'slideDone');
      return slide?.type === 'slideDone' ? classifySlide(slide.jib, s.cfg)?.name : null;
    };
    expect(name(-1)).toBe('50-50 to Backboard');
    expect(name(1)).toBe('50-50 to Frontboard');
  });

  it('a backside 180 on the feature needs a handle pass in its window, else the handle drops', () => {
    expect(crashOf(play(box('flush'), (t) => ({ steer: between(3.6, 4.0)(t) ? 1 : 0 }), noBalance).events)).toMatchObject({ reason: 'handleDropped' });
    const { s, events } = play(box('flush'), (t) => ({ steer: between(3.6, 4.0)(t) ? 1 : 0, pass: between(3.85, 3.9)(t) }), noBalance);
    expect(crashOf(events)).toBeUndefined();
    const slide = events.find((e) => e.type === 'slideDone');
    if (slide?.type !== 'slideDone') throw new Error('no slide');
    expect(slide.jib.rot.passes).toBe(1);
    expect(classifySlide(slide.jib, s.cfg)?.name).toContain('Switch 50-50');
  });

  it('balance drifts (faster on rails) and taps correct it; off by config', () => {
    const rail = box('flush', 'rail');
    const long = { ...rail, length: 30 } as FeatureDef;
    expect(crashOf(play(long, () => ({}), {}, 9).events)).toMatchObject({ reason: 'fellOffFeature' });
    expect(crashOf(play(long, () => ({}), noBalance, 9).events)).toBeUndefined();
    // Tapping against the drift keeps the rider on.
    const { events } = play(long, (_t, s) => {
      const b = s.rider.jib?.balance ?? 0;
      const tick = Math.round(s.time * 60);
      return { steer: Math.abs(b) > 0.3 && tick % 12 < 2 ? (b > 0 ? -1 : 1) : 0 };
    }, {}, 9);
    expect(crashOf(events)).toBeUndefined();
  });

  it('pop off the main into the air; leaving a boardslide needs a spin off to land', () => {
    const { events } = play(box('flush'), (t) => ({ pop: between(3.6, 4.0)(t) }), noBalance);
    expect(crashOf(events)).toBeUndefined();
    const sideways = play(box('flush'), (t) => ({ steer: between(3.6, 3.8)(t) ? -1 : 0 }), noBalance);
    expect(crashOf(sideways.events)?.type).toBe('crash');
    const spunOff = play(box('flush'), (t) => ({ steer: between(3.6, 3.8)(t) ? -1 : between(4.6, 4.75)(t) ? 1 : 0 }), noBalance);
    const landed = spunOff.events.filter((e) => e.type === 'landed').at(-1);
    if (landed?.type !== 'landed') throw new Error(`no landing: ${JSON.stringify(crashOf(spunOff.events))}`);
    expect(classifyAir(landed.air, landed.landing, spunOff.s.cfg)?.name).toMatch(/90 Off|270 Off/);
    void run;
  });
});
