import { DT } from '../config';
import type { InputFrame } from '../input';
import type { LandingResult } from '../landing';
import { approach, wrapHalfTurn } from '../math/scalar';
import type { AirState, FeatureExit, JibState } from '../rider';
import type { SimState } from '../world';

/**
 * ExitResolver (feature riding spec 6): how the rider leaves a feature.
 *
 *   rideOff  ran off the end without popping: low air, the board as it was.
 *            Out of a 90-degree slide it has to turn before the water; within
 *            Exit.AssistAngle of forward or fakie the air finishes the turn.
 *   popOff   Space in the last Exit.PopOffZone: real air for out-rotations.
 *   sidePop  Space with A/D held, anywhere: off the side (a short slide).
 *   hop      Space mid-feature: up and (usually) back onto it.
 *   sketchy  lost balance in the last metre.
 *
 * A pop onto another feature (or another part) is a transfer: the line
 * carries on there. The whole line (every slide, then the exit air) is
 * reported as one `featureLine` event when the rider lands on the water.
 */

/** Which pop off the feature this is. */
export function popKind(s: SimState, remaining: number, steerDir: number): FeatureExit['kind'] {
  if (steerDir !== 0) return 'sidePop';
  return remaining <= s.cfg.featureRide.Exit.PopOffZone ? 'popOff' : 'hop';
}

/** The exit record a leaving rider takes into the air: the line so far plus this slide. */
export function exitOf(j: JibState, kind: FeatureExit['kind'], switchStance: boolean): FeatureExit {
  return { kind, jibs: [...j.chain, j], boardAngle: j.boardAngle, switchStance };
}

/**
 * In the air after a ride-off: with no A/D held and the board within
 * Exit.AssistAngle of forward or fakie, turn it the rest of the way at
 * Exit.AssistRate.
 */
export function stepExitAssist(s: SimState, air: AirState, input: InputFrame): void {
  const E = s.cfg.featureRide.Exit;
  if (!air.exit || air.exit.kind !== 'rideOff' || input.steer !== 0 || air.rot.spinRate !== 0) return;
  const off = wrapHalfTurn(air.rot.spinAngle);
  if (off === 0 || Math.abs(off) > E.AssistAngle) return;
  air.rot.spinAngle = approach(air.rot.spinAngle, air.rot.spinAngle - off, E.AssistRate * DT);
}

/** Report a finished line on the water (spec 8: the out-part is named on landing). */
export function finishLine(s: SimState, air: AirState, landing: LandingResult | null): void {
  if (!air.exit) return;
  s.events.push({ type: 'featureLine', tick: s.tick, exit: air.exit, air, landing });
}
