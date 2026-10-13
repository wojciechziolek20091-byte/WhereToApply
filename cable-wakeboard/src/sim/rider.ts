import type { GrabId } from './tricks/data';
import type { Vec3 } from './math/vec';

export type RiderMode = 'riding' | 'feature' | 'air' | 'fallen';

export type Approach = 'heelside' | 'toeside' | 'neutral';

export type TakeoffSource = 'flat' | 'kicker' | 'slider' | 'lineLift';

export type FallKind =
  | 'buttCheck'
  | 'caughtEdge'
  | 'overRotation'
  | 'underRotation'
  | 'droppedHandle'
  | 'featureCrash';

/** Remembers edge load for the pop. See pop.ts. */
export interface LoadTracker {
  /** Edge load when the rider hit the base of the current feature (N), or 0. */
  edgeLoadAtBase: number;
  /** Peak edge load in the last `pop.peakMemory` seconds (N). */
  peakEdgeLoad: number;
  /** Seconds since that peak. */
  peakAge: number;
}

/** Everything about the current jump. Null while on the water. */
export interface AirState {
  source: TakeoffSource;
  featureId: string | null;
  time: number;
  takeoffPos: Vec3;
  /** Direction of travel at takeoff. */
  takeoffHeading: number;
  approach: Approach;
  takeoffSwitch: boolean;
  /** Cut angle relative to the rope at takeoff (rad). */
  cutAtTakeoff: number;
  edgeLoadAtTakeoff: number;
  tensionAtTakeoff: number;
  /** Vertical speed added by the pop (m/s). */
  popSpeed: number;
  /** 0..1 pop quality used by scoring. */
  popQuality: number;
  /** Highest board height above the water (m). */
  peakHeight: number;
  passedPeak: boolean;
  /** Board yaw relative to takeoff heading (rad), signed. */
  spinAngle: number;
  spinStarted: boolean;
  spunBeforePeak: boolean;
  /** -1 back, +1 front, 0 no invert. */
  flipDir: -1 | 0 | 1;
  /** Invert rotation so far (rad), always >= 0. */
  flipAngle: number;
  axis: 'flip' | 'roll';
  grab: GrabId | null;
  grabTime: number;
  /** Grab held long enough to count, if any. */
  grabbed: GrabId | null;
  raleyEligible: boolean;
  /** 0 board under the rider .. 1 body fully stretched out above. */
  raleyExtension: number;
  raleyPeak: number;
}

/** State while sliding a box or rail. */
export interface JibState {
  featureId: string;
  /** Must stay in [-1, 1]. */
  balance: number;
  /** Board yaw relative to the rail axis (rad). */
  boardAngle: number;
  time: number;
  /** Seconds spent near 0 and 90 degrees. */
  alignedTime: number;
  crossedTime: number;
}

/** Contact with a kicker ramp. */
export interface RampState {
  featureId: string;
  /** Distance along the ramp from its start (m). */
  u: number;
  /** Tick the pop was released while on this ramp, or -1. */
  releaseTick: number;
}

export interface RiderState {
  mode: RiderMode;
  /** Board contact point. y = 0 on the water. */
  pos: Vec3;
  vel: Vec3;
  /** Direction of travel of the board's leading end (rad). */
  heading: number;
  stance: 'regular' | 'goofy';
  switchStance: boolean;
  /** Signed: + heelside, - toeside (rad). */
  edgeAngle: number;
  /** Sideways force the edge is holding (N). */
  edgeLoad: number;
  ropeTension: number;
  ropeForce: Vec3;
  /** Heading from rider toward the carrier (rad). */
  ropeHeading: number;
  slackTime: number;
  overGripTime: number;
  hasHandle: boolean;
  handleDist: number;
  waistHinge: number;
  connection: number;
  legCompression: number;
  /** Load input last tick, to detect release. */
  loadHeld: boolean;
  /** Seconds left in the leg extension after a pop release. */
  extendTimer: number;
  load: LoadTracker;
  air: AirState | null;
  ramp: RampState | null;
  jib: JibState | null;
  fallTimer: number;
  lastFall: FallKind | null;
  /** Seconds in the current mode. */
  modeTime: number;
}
