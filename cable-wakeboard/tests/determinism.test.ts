import { DEFAULT_CONFIG } from '../src/sim/config';
import { hashSim } from '../src/sim/hash';
import { neutralInput, type InputFrame } from '../src/sim/input';
import { createRng, nextFloat } from '../src/sim/math/rng';
import { createRun, stepRun } from '../src/sim/session';

/** A long, busy, reproducible input script: carves, pops, spins, grabs. */
function script(ticks: number, seed: number): InputFrame[] {
  const rng = createRng(seed);
  const out: InputFrame[] = [];
  let edge = 0;
  let load = false;
  let spin = 0;
  for (let i = 0; i < ticks; i++) {
    if (i % 45 === 0) edge = Math.round(nextFloat(rng) * 2 - 1);
    if (i % 30 === 0) load = nextFloat(rng) < 0.3;
    if (i % 20 === 0) spin = nextFloat(rng) < 0.2 ? 1 : 0;
    out.push({ ...neutralInput(), edge, load, spin, grab: nextFloat(rng) < 0.05 ? 'indy' : null });
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
    expect(a.falls).toEqual(b.falls);
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
      stepRun(b, { ...inputs[i]!, edge: 1 });
    }
    expect(hashSim(a.sim)).not.toBe(hashSim(b.sim));
  });
});
