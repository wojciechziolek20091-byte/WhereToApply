import { DEFAULT_CONFIG } from '../src/sim/config';
import { hashSim } from '../src/sim/hash';
import { neutralInput, type InputFrame } from '../src/sim/input';
import { createRng, nextFloat } from '../src/sim/math/rng';
import { createRun, stepRun } from '../src/sim/session';

/** A long, busy, reproducible input script: carves, pops, spins, grabs. */
function script(ticks: number, seed: number): InputFrame[] {
  const rng = createRng(seed);
  const out: InputFrame[] = [];
  let steer = 0;
  let pop = false;
  for (let i = 0; i < ticks; i++) {
    if (i % 45 === 0) steer = Math.round(nextFloat(rng) * 2 - 1);
    if (i % 30 === 0) pop = nextFloat(rng) < 0.3;
    out.push({ ...neutralInput(), steer, pop, pass: nextFloat(rng) < 0.03, grab: nextFloat(rng) < 0.05, back: nextFloat(rng) < 0.1 });
  }
  return out;
}

describe('determinism', () => {
  const inputs = script(60 * 90, 42);

  it('same config and inputs give the same state, tick for tick', () => {
    const a = createRun(DEFAULT_CONFIG);
    const b = createRun(DEFAULT_CONFIG);
    for (let i = 0; i < inputs.length; i++) {
      stepRun(a, inputs[i]!);
      stepRun(b, inputs[i]!);
      if (i % 60 === 0) expect(hashSim(a.sim)).toBe(hashSim(b.sim));
    }
    expect(hashSim(a.sim)).toBe(hashSim(b.sim));
    expect(a.tricks.map((t) => t.trick.key)).toEqual(b.tricks.map((t) => t.trick.key));
    expect(a.crashes).toEqual(b.crashes);
  });

  it('state is plain data: a structured clone continues identically', () => {
    const a = createRun(DEFAULT_CONFIG);
    for (let i = 0; i < 1800; i++) stepRun(a, inputs[i]!);
    const b = structuredClone(a);
    for (let i = 1800; i < inputs.length; i++) {
      stepRun(a, inputs[i]!);
      stepRun(b, inputs[i]!);
    }
    expect(hashSim(b.sim)).toBe(hashSim(a.sim));
  });

  it('different inputs diverge', () => {
    const a = createRun(DEFAULT_CONFIG);
    const b = createRun(DEFAULT_CONFIG);
    for (let i = 0; i < 600; i++) {
      stepRun(a, inputs[i]!);
      stepRun(b, { ...inputs[i]!, steer: 1 });
    }
    expect(hashSim(a.sim)).not.toBe(hashSim(b.sim));
  });
});
