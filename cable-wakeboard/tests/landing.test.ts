import { createAirState } from '../src/sim/air';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { neutralInput } from '../src/sim/input';
import { evaluateLanding } from '../src/sim/landing';
import { TAU } from '../src/sim/math/scalar';
import { UP, vec3 } from '../src/sim/math/vec';
import type { AirState, RiderState } from '../src/sim/rider';
import { createRider, createSim } from '../src/sim/world';
import { launch, run, untilTouchdown } from './helpers';

const cfg = DEFAULT_CONFIG;

function setup(airPatch: Partial<AirState> = {}, riderPatch: Partial<RiderState> = {}) {
  const r = createRider(cfg, vec3(), vec3(8, 0, 0), 0);
  const air = { ...createAirState(r, 'flat', null, 3, 0.6, 0, neutralInput(), cfg), ...airPatch };
  Object.assign(r, { mode: 'air', air, vel: vec3(8, -3, 0) }, riderPatch);
  return evaluateLanding(r, air, UP, cfg);
}

describe('evaluateLanding', () => {
  it('lands a clean straight air', () => {
    const l = setup();
    expect(l.fall).toBeNull();
    expect(l.quality).toBeGreaterThan(0.5);
  });

  it('lands a 180 and counts the half turn', () => {
    const l = setup({ spinAngle: Math.PI + 0.2, spinStarted: true });
    expect(l.fall).toBeNull();
    expect(l.halfTurns).toBe(1);
  });

  it('under-rotates a short spin and over-rotates a long one', () => {
    expect(setup({ spinAngle: Math.PI - 0.9, spinStarted: true }).fall).toBe('underRotation');
    expect(setup({ spinAngle: Math.PI + 0.9, spinStarted: true }).fall).toBe('overRotation');
  });

  it('under- and over-rotates inverts', () => {
    expect(setup({ flipDir: -1, flipAngle: TAU - 1.2 }).fall).toBe('underRotation');
    expect(setup({ flipDir: 1, flipAngle: TAU + 1.2 }).fall).toBe('overRotation');
    expect(setup({ flipDir: 1, flipAngle: TAU + 0.2 }).fall).toBeNull();
  });

  it('catches an edge landing on a big edge angle', () => {
    expect(setup({}, { edgeAngle: cfg.edge.maxEdgeAngle }).fall).toBe('caughtEdge');
  });

  it('butt checks a heavy landing on straight legs but absorbs it with bent knees', () => {
    expect(setup({}, { vel: vec3(8, -6, 0), legCompression: 0 }).fall).toBe('buttCheck');
    expect(setup({}, { vel: vec3(8, -6, 0), legCompression: 1 }).fall).toBeNull();
  });

  it('butt checks a raley that was not brought back', () => {
    expect(setup({ raleyExtension: 0.8 }).fall).toBe('buttCheck');
  });

  it('falls without the handle', () => {
    expect(setup({}, { hasHandle: false }).fall).toBe('droppedHandle');
  });
});

describe('air in the sim', () => {
  it('lands switch after a 180', () => {
    const s = createSim();
    run(s, 3);
    launch(s, 4.5);
    // Spin after the peak, for about half a turn.
    const spinTime = Math.PI / cfg.air.spinRate;
    let spinning = 0;
    const e = untilTouchdown(s, (_t, st) => {
      const go = st.rider.air!.passedPeak && spinning < spinTime;
      if (go) spinning += 1 / 60;
      return { spin: go ? 1 : 0 };
    });
    expect(e.type).toBe('landed');
    expect(s.rider.switchStance).toBe(true);
  });

  it('spinning before the peak costs height', () => {
    const peakWith = (early: boolean) => {
      const s = createSim();
      run(s, 3);
      launch(s, 4.5);
      const e = untilTouchdown(s, (t) => ({ spin: early ? (t < 0.05 ? 1 : 0) : 0 }));
      return e.air!;
    };
    const early = peakWith(true);
    const none = peakWith(false);
    expect(early.spunBeforePeak).toBe(true);
    expect(early.peakHeight).toBeLessThan(none.peakHeight);
  });

  it('letting go in the air is a dropped-handle fall', () => {
    const s = createSim();
    run(s, 3);
    launch(s, 3);
    const e = untilTouchdown(s, (t) => ({ release: t < 0.05 }));
    expect(e.type === 'fall' && e.kind).toBe('droppedHandle');
  });

  it('an invert without enough air under-rotates', () => {
    const s = createSim();
    run(s, 3);
    launch(s, 1.5, { flip: -1 });
    const e = untilTouchdown(s);
    expect(e.type === 'fall' && e.kind).toBe('underRotation');
  });
});
