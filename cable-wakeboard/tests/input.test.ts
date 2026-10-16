import { DEFAULT_CONFIG } from '../src/sim/config';
import { createInputMemory, neutralInput, type InputFrame, updateInputMemory } from '../src/sim/input';
import { canTransition, TRANSITIONS } from '../src/sim/fsm';
import { flatSim } from './helpers';
import { transition } from '../src/sim/fsm';

const DT = 1 / 60;
const cfg = DEFAULT_CONFIG;
const feed = (frames: Partial<InputFrame>[]) => {
  const m = createInputMemory();
  const out = frames.map((f) => {
    updateInputMemory(m, { ...neutralInput(), ...f }, cfg, DT);
    return { ...m };
  });
  return out;
};

describe('input memory', () => {
  it('detects presses, releases and hold time', () => {
    const m = feed([{}, { pop: true }, { pop: true }, { pop: true }, {}]);
    expect(m[1]!.popPressed).toBe(true);
    expect(m[3]!.popHeldTime).toBeCloseTo(2 * DT, 9);
    expect(m[4]!.popReleased).toBe(true);
    expect(m[4]!.popHeldTime).toBeCloseTo(2 * DT, 9);
  });

  it('tells a short A/D tap from a hold', () => {
    const tap = feed([{ steer: 1 }, { steer: 1 }, {}]);
    expect(tap[2]!.steerTap).toBe(1);
    const hold = feed([...Array(20).fill({ steer: -1 }), {}]);
    expect(hold.at(-1)!.steerTap).toBe(0);
  });

  it('resolves grab chords: E alone is an indy, E + R/N/T within the window picks the other grabs', () => {
    expect(feed([{ grab: true }, { grab: true }, { grab: true }, { grab: true }, { grab: true }, { grab: true }]).at(-1)!.grabChoice).toBe('indy');
    expect(feed([{ grab: true }, { grab: true, grabMod: 'stalefish' }]).at(-1)!.grabChoice).toBe('stalefish');
    expect(feed([{ grab: true, grabMod: 'nose' }]).at(-1)!.grabChoice).toBe('nose');
    // E then T quickly (inside 0.08 s) is still a tail grab, even after it first read as an indy.
    const late = feed([{ grab: true }, { grab: true }, { grab: true }, { grab: true }, { grab: true, grabMod: 'tail' }]);
    expect(late.at(-1)!.grabChoice).toBe('tail');
    // After the window a modifier no longer changes the grab.
    const tooLate = feed([...Array(8).fill({ grab: true }), { grab: true, grabMod: 'tail' }]);
    expect(tooLate.at(-1)!.grabChoice).toBe('indy');
  });
});

describe('state machine', () => {
  it('every state has a way out and only legal moves are allowed', () => {
    for (const tos of Object.values(TRANSITIONS)) expect(tos.length).toBeGreaterThan(0);
    expect(canTransition('riding', 'airborne')).toBe(true);
    expect(canTransition('airborne', 'riding')).toBe(false); // must go through landing
    expect(canTransition('crashed', 'airborne')).toBe(false);
  });

  it('asserts on an illegal transition and logs legal ones in debug mode', () => {
    const s = flatSim();
    expect(() => transition(s, 'landing', 'test')).toThrow(/illegal transition riding -> landing/);
    transition(s, 'airborne', 'test');
    expect(s.events.at(-1)).toMatchObject({ type: 'transition', from: 'riding', to: 'airborne', reason: 'test' });
  });
});
