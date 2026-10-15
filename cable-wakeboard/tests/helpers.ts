import { DEFAULT_CONFIG, makeConfig } from '../src/sim/config';
import { neutralInput, type InputFrame } from '../src/sim/input';
import { dot, horizontal, rightOf, sub } from '../src/sim/math/vec';
import { FLAT_PARK, type FeatureDef, type ParkDef } from '../src/sim/park';
import type { SimEvent } from '../src/sim/events';
import type { TakeoffSource } from '../src/sim/rider';
import { stepSim, takeOff } from '../src/sim/step';
import { createSim, type SimState } from '../src/sim/world';

/** Run `seconds` of sim with an input produced per tick. */
export function run(s: SimState, seconds: number, input: (t: number, s: SimState) => Partial<InputFrame> = () => ({})): void {
  const ticks = Math.round(seconds * 60);
  for (let i = 0; i < ticks; i++) {
    stepSim(s, { ...neutralInput(), ...input(i / 60, s) });
  }
}

/** Run until `until` returns true for a tick's events or state (max `seconds`). Returns the matching event, if any. */
export function runUntil(
  s: SimState,
  seconds: number,
  input: (t: number, s: SimState) => Partial<InputFrame>,
  until: (e: SimEvent) => boolean,
): SimEvent | null {
  const ticks = Math.round(seconds * 60);
  for (let i = 0; i < ticks; i++) {
    stepSim(s, { ...neutralInput(), ...input(i / 60, s) });
    const e = s.events.find(until);
    if (e) return e;
  }
  return null;
}

/** Rider's sideways offset from the carrier, + right of the carrier's travel. */
export const lateralOffset = (s: SimState): number =>
  dot(sub(horizontal(s.rider.pos), horizontal(s.carrier.pos)), rightOf(s.carrier.heading));

/** Put the rider in the air from flat water with a given upward speed. */
export function launch(s: SimState, popSpeed: number, source: TakeoffSource = 'flat'): void {
  takeOff(s, source, null, popSpeed, 1);
}

/** Run until the rider lands, lands on a feature, or crashes (max 5 s). */
export function untilTouchdown(s: SimState, input: (t: number, s: SimState) => Partial<InputFrame> = () => ({})): SimEvent {
  const e = runUntil(s, 5, input, (ev) => ev.type === 'landed' || ev.type === 'crash');
  if (!e) throw new Error('no touchdown');
  return e;
}

/**
 * The standard water-trick setup for a regular rider: cruise, then cut hard
 * away from the line on the heelside (A) and release Space at `releaseAt`
 * seconds into the cut (the default is at the tension peak). `back` /
 * `forward` are held at the pop (backroll / frontroll). Returns the takeoff event.
 */
export function cutAndPop(
  s: SimState,
  opts: { releaseAt?: number; back?: boolean; forward?: boolean } = {},
): SimEvent | null {
  const releaseAt = opts.releaseAt ?? 1.45;
  run(s, 3);
  return runUntil(
    s,
    4,
    (t) => ({ steer: -1, pop: t > releaseAt - 0.4 && t < releaseAt, back: !!opts.back, forward: !!opts.forward }),
    (e) => e.type === 'takeoff',
  );
}

/**
 * A sim on flat water with no features, starting on the longest straight (the
 * east side, s = 107..249) so cut-and-pop tests stay clear of the corners.
 */
export const flatSim = () => createSim(DEFAULT_CONFIG, FLAT_PARK, 125);

/** A sim with debug asserts and one feature on the east straight, `s` metres after the rider's start. */
export function featureSim(def: FeatureDef, cfgOverrides: Parameters<typeof makeConfig>[0] = {}): SimState {
  const park: ParkDef = { name: 'test', features: [def] };
  return createSim(makeConfig(cfgOverrides), park, 125);
}
