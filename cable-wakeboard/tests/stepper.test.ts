import { advanceStepper, createStepper } from '../src/sim/stepper';

describe('fixed stepper', () => {
  it('runs whole ticks and keeps the remainder', () => {
    const st = createStepper(8, 0.01);
    let n = 0;
    const r = advanceStepper(st, 0.035, () => n++);
    expect(n).toBe(3);
    expect(r.alpha).toBeCloseTo(0.5, 6);
    advanceStepper(st, 0.005, () => n++);
    expect(n).toBe(4);
  });

  it('caps ticks per frame and drops the backlog', () => {
    const st = createStepper(4, 0.01);
    let n = 0;
    advanceStepper(st, 1, () => n++);
    expect(n).toBe(4);
    expect(st.accumulator).toBe(0);
  });
});
