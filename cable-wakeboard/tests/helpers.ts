import { neutralInput, type InputFrame } from '../src/sim/input';
import { dot, horizontal, rightOf, sub } from '../src/sim/math/vec';
import { stepSim, takeOff } from '../src/sim/step';
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


/** Put the rider in the air from flat water with a given pop. */
export function launch(s: SimState, popSpeed: number, input: Partial<InputFrame> = {}): void {
  takeOff(s, 'flat', null, popSpeed, popSpeed / s.cfg.pop.maxPop, s.rider.edgeLoad, { ...neutralInput(), ...input });
}

/** Run until the rider lands or falls (max 5 s). Returns the event. */
export function untilTouchdown(s: SimState, input: (t: number, s: SimState) => Partial<InputFrame> = () => ({})) {
  for (let i = 0; i < 300; i++) {
    stepSim(s, { ...neutralInput(), ...input(i / 60, s) });
    const e = s.events.find((ev) => ev.type === 'landed' || ev.type === 'fall');
    if (e) return e;
  }
  throw new Error('no touchdown');
}

/** The standard toeside-out, heelside-in cut, releasing the pop at `releaseAt` seconds into the cut back. */
export function cutAndPop(s: SimState, opts: { releaseAt?: number; flattenAt?: number; flip?: number; raley?: boolean } = {}) {
  const releaseAt = opts.releaseAt ?? 2.2;
  const flattenAt = opts.flattenAt ?? 99;
  run(s, 4);
  run(s, 1.6, () => ({ edge: -1 }));
  let tookOff = false;
  for (let i = 0; i < 600 && !tookOff; i++) {
    const t = i / 60;
    stepSim(s, {
      ...neutralInput(),
      edge: t < flattenAt ? 1 : 0,
      load: t > releaseAt - 0.4 && t < releaseAt,
      flip: opts.flip ?? 0,
      raley: opts.raley ?? false,
    });
    tookOff = s.events.some((e) => e.type === 'takeoff');
  }
  return s.events.find((e) => e.type === 'takeoff');
}
