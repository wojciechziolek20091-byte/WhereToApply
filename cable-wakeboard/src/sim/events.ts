import type { LandingResult } from './landing';
import type { AirState, CrashReason, JibState, RiderMode, TakeoffSource } from './rider';

/** Emitted by stepSim(). The session and renderer read these; physics ignores them. */
export type SimEvent =
  | { type: 'takeoff'; tick: number; source: TakeoffSource; popSpeed: number; popQuality: number }
  /** Touchdown without a crash, on the water or onto a feature. */
  | { type: 'landed'; tick: number; air: AirState; landing: LandingResult; onFeature: boolean }
  | { type: 'crash'; tick: number; reason: CrashReason; air: AirState | null; landing: LandingResult | null }
  | { type: 'ropeSnap'; tick: number; stretchRate: number }
  | { type: 'featureEnter'; tick: number; featureId: string }
  | { type: 'featureExit'; tick: number; featureId: string }
  /** Left the main of a box or rail (not by crashing): the whole slide. */
  | { type: 'slideDone'; tick: number; jib: JibState }
  | { type: 'handlePass'; tick: number }
  /** Spun back out of blind on the water. */
  | { type: 'blindSpinOut'; tick: number }
  /** Debug log of the state machine (only with `debug.enabled`). */
  | { type: 'transition'; tick: number; from: RiderMode; to: RiderMode; reason: string };
