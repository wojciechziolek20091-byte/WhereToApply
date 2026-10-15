import { makeConfig } from '../src/sim/config';
import { neutralInput, type InputFrame } from '../src/sim/input';
import { FLAT_PARK, type ParkDef } from '../src/sim/park';
import { createRun, liveCombo, stepRun, type RunState } from '../src/sim/session';

/** One kicker right on the cable line, so riding straight goes over it. */
const KICKER_PARK: ParkDef = {
  name: 'One kicker',
  features: [{ kind: 'kicker', id: 'k1', name: 'Kicker', s: 75, offset: 0, length: 4.5, width: 3.5, height: 1.1, lipAngle: 0.5 }],
};

function runFor(run: RunState, seconds: number, input: (t: number) => Partial<InputFrame> = () => ({})) {
  for (let i = 0; i < seconds * 60 && !run.finished; i++) stepRun(run, { ...neutralInput(), ...input(i / 60) });
}
const ollieAndSpin = (spinFor: number) => (t: number): Partial<InputFrame> => ({ pop: t < 0.6, steer: t > 0.62 && t < 0.62 + spinFor ? -1 : 0 });

describe('run session', () => {
  it('two crashes end the run, and the judges score it', () => {
    const run = createRun(makeConfig({}), FLAT_PARK);
    runFor(run, 1, (t) => ({ letGo: t > 0.5 && t < 0.55 }));
    expect(run.crashes).toHaveLength(1);
    runFor(run, 3);
    expect(run.sim.rider.mode).toBe('riding');
    runFor(run, 1, (t) => ({ letGo: t > 0.5 && t < 0.55 }));
    expect(run.finished).toBe(true);
    expect(run.endReason).toBe('falls');
    expect(run.score?.judges).toHaveLength(3);
  });

  it('the crash limit is configurable', () => {
    const run = createRun(makeConfig({ run: { maxFalls: 3 } }), FLAT_PARK);
    for (let k = 0; k < 2; k++) {
      runFor(run, 1, (t) => ({ letGo: t > 0.5 && t < 0.55 }));
      runFor(run, 3);
    }
    expect(run.finished).toBe(false);
  });

  it('ends after two passes of the cable', () => {
    const run = createRun(makeConfig({}), FLAT_PARK);
    const lapTime = run.sim.path.length / run.sim.cfg.cable.carrierSpeed;
    runFor(run, lapTime * 1.5);
    expect(run.pass).toBe(1);
    runFor(run, lapTime);
    expect(run.finished).toBe(true);
    expect(run.endReason).toBe('passes');
    expect(run.score!.base).toEqual({ execution: 1, intensity: 1, composition: 1 });
  });

  it('logs a kicker air', () => {
    const run = createRun(makeConfig({}), KICKER_PARK);
    runFor(run, 12);
    expect(run.tricks[0]!.trick.name).toBe('Kicker Air');
    expect(run.tricks[0]!.featureId).toBe('k1');
  });
});

describe('combos (milestone 9)', () => {
  it('a trick banks after the link window of riding', () => {
    const run = createRun(makeConfig({}), FLAT_PARK);
    runFor(run, 3);
    runFor(run, 2.2, ollieAndSpin(0.25));
    expect(run.combo?.entries.map((e) => e.name)).toEqual(['Frontside 180']);
    runFor(run, 2.2);
    expect(run.combo).toBeNull();
    expect(run.lastCombo?.voided).toBe(false);
    expect(run.points).toBe(Math.round(150 * 1.1)); // clean landing bonus
  });

  it('tricks inside the link window chain, and the multiplier grows', () => {
    const run = createRun(makeConfig({}), FLAT_PARK);
    runFor(run, 3);
    runFor(run, 2, ollieAndSpin(0.25));
    runFor(run, 2, ollieAndSpin(0.25));
    const live = liveCombo(run)!;
    expect(run.combo!.entries).toHaveLength(2);
    expect(live.multiplier).toBeCloseTo(1.25, 9);
  });

  it('a crash voids the whole combo', () => {
    const run = createRun(makeConfig({}), FLAT_PARK);
    runFor(run, 3);
    runFor(run, 2, ollieAndSpin(0.25));
    runFor(run, 0.5, (t) => ({ letGo: t < 0.05 }));
    expect(run.combo).toBeNull();
    expect(run.lastCombo?.voided).toBe(true);
    expect(run.points).toBe(0);
  });
});
