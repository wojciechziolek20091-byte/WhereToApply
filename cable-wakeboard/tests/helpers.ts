import { neutralInput, type InputFrame } from '../src/sim/input';
import { dot, horizontal, rightOf, sub } from '../src/sim/math/vec';
import { stepSim } from '../src/sim/step';
import type { SimState } from '../src/sim/world';

/** Run `seconds` of sim with an input produced per tick. */
export function run(s: SimState, seconds: number, input: (t: number, s: SimState) => Partial<InputFrame> = () => ({})): void {
  const ticks = Math.round(seconds * 60);
  for (let i = 0; i < ticks; i++) {
    stepSim(s, { ...neutralInput(), ...input(i / 60, s) });
  }
}

/** Rider's sideways offset from the carrier, + right of the carrier's travel. */
export const lateralOffset = (s: SimState): number =>
  dot(sub(horizontal(s.rider.pos), horizontal(s.carrier.pos)), rightOf(s.carrier.heading));
