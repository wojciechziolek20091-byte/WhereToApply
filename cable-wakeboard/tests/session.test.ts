import { makeConfig } from '../src/sim/config';
import { neutralInput, type InputFrame } from '../src/sim/input';
import { FLAT_PARK } from '../src/sim/park';
import { createRun, stepRun, type RunState } from '../src/sim/session';

function runFor(run: RunState, seconds: number, input: (t: number) => Partial<InputFrame> = () => ({})) {
  for (let i = 0; i < seconds * 60 && !run.finished; i++) stepRun(run, { ...neutralInput(), ...input(i / 60) });
}

describe('run session', () => {
  it('two falls end the run', () => {
    const run = createRun(makeConfig({}), FLAT_PARK);
    // Let go twice, waiting out the recovery between.
    runFor(run, 1, (t) => ({ release: t > 0.5 && t < 0.55 }));
    expect(run.falls).toHaveLength(1);
    runFor(run, 3);
    expect(run.sim.rider.mode).toBe('riding');
    runFor(run, 1, (t) => ({ release: t > 0.5 && t < 0.55 }));
    expect(run.finished).toBe(true);
    expect(run.endReason).toBe('falls');
    expect(run.score?.judges).toHaveLength(3);
  });

  it('the fall limit is configurable', () => {
    const run = createRun(makeConfig({ run: { maxFalls: 3 } }), FLAT_PARK);
    for (let k = 0; k < 2; k++) {
      runFor(run, 1, (t) => ({ release: t > 0.5 && t < 0.55 }));
      runFor(run, 3);
    }
    expect(run.finished).toBe(false);
    expect(run.falls).toHaveLength(2);
  });

  it('ends after two passes of the cable', () => {
    const run = createRun(makeConfig({}), FLAT_PARK);
    const lapTime = run.sim.path.length / run.sim.cfg.cable.carrierSpeed;
    runFor(run, lapTime * 1.5);
    expect(run.pass).toBe(1);
    expect(run.finished).toBe(false);
    runFor(run, lapTime);
    expect(run.finished).toBe(true);
    expect(run.endReason).toBe('passes');
    // Nothing done all run: dead water everywhere, minimum scores.
    expect(run.score!.base).toEqual({ execution: 1, intensity: 1, composition: 1 });
  });

  it('logs a landed trick', () => {
    const run = createRun(makeConfig({}));
    // Default park: from the starting dock, straight over the dock kicker west.
    runFor(run, 12);
    expect(run.tricks.length).toBeGreaterThan(0);
    expect(run.tricks[0]!.trick.name).toBe('Straight Kicker Air');
    expect(run.tricks[0]!.featureId).toBe('k3');
  });
});

import { trickPoints } from '../src/sim/session';

describe('HUD points', () => {
  const base = { name: 'x', key: 'x', family: 'jump' as const, difficulty: 1, spinDegrees: 0, spinDirection: null, invert: null, grab: null, switchStance: false, modifiers: [] };
  it('rewards harder, cleaner and bigger tricks', () => {
    const small = trickPoints({ trick: base, landingQuality: 0.5, height: 0.5, airTime: 0.5 });
    const harder = trickPoints({ trick: { ...base, difficulty: 3 }, landingQuality: 0.5, height: 0.5, airTime: 0.5 });
    const cleaner = trickPoints({ trick: base, landingQuality: 1, height: 0.5, airTime: 0.5 });
    const bigger = trickPoints({ trick: base, landingQuality: 0.5, height: 3, airTime: 1.5 });
    expect(harder).toBeGreaterThan(small);
    expect(cleaner).toBeGreaterThan(small);
    expect(bigger).toBeGreaterThan(small);
  });

  it('adds up during a run', () => {
    const run = createRun(makeConfig({}));
    runFor(run, 12);
    expect(run.points).toBeGreaterThan(0);
  });
});
