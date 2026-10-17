import type { RidePiece } from '../featureShapes';
import type { LandingResult } from '../landing';
import type { AirState, CrashReason, JibState } from '../rider';
import type { SimState } from '../world';

/**
 * FeatureSpecials (feature riding spec 7): the rules particular to one kind
 * of feature. Most of the table falls out of the shapes and the shared
 * rules (gap boxes: landedInGap; pipes: the balance width and noise; kinks
 * and rooftops: SlideController; step-ups and transfer boxes: crossEdge and
 * transfers; pyramids ride as kickers or boxes). The rest is here.
 */

/** Funbox: popping off the down end gets less air (the board is going down). */
export function popScaleOn(piece: RidePiece, s: SimState): number {
  return piece.h1 < piece.h0 ? s.cfg.featureRide.Specials.DownEndPopScale : 1;
}

/** Rooftop and kinks: rotations are best on the flat; a step started on a slope costs balance. */
export function slopedTurnHit(j: JibState, s: SimState): number {
  const S = s.cfg.featureRide.Specials;
  return Math.abs(j.pitch) > S.SlopedTurnPitch ? S.SlopedTurnHit : 0;
}

/**
 * Wall ride too slow along the wall: low on the transition it slides back
 * down into the water (sketchy); higher up the rider slides down the wall
 * (`wallSlideDown`). `up` is how far up the profile the board is (m).
 */
export function wallTooSlow(up: number, s: SimState): 'sketchy' | CrashReason {
  return up <= s.cfg.featureRide.Specials.WallSketchyHeight ? 'sketchy' : 'wallSlideDown';
}

/**
 * Spine: launched off one side, the rider should land on the far side's
 * down slope. Missing it and landing flat on the water is a hard impact: a
 * crash ('hard') past Specials.SpineFlatCrash, otherwise a sketchy landing
 * ('flat'). Null for any other air.
 */
export function spineFlatLanding(s: SimState, air: AirState): 'hard' | 'flat' | null {
  if (air.source !== 'kicker' || air.featureId === null) return null;
  const f = s.features.find((x) => x.def.id === air.featureId);
  if (!f || f.shape.type !== 'Spine') return null;
  return -s.rider.vel.y > s.cfg.featureRide.Specials.SpineFlatCrash ? 'hard' : 'flat';
}

/** A flat landing past a spine is never clean. */
export function markSpineFlat(landing: LandingResult): void {
  landing.clean = false;
  landing.quality *= 0.6;
}
