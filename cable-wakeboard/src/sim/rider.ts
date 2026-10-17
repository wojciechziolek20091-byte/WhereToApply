import type { Vec3 } from './math/vec';
import type { GrabId, SlideId } from './tricks/data';

/**
 * Top-level rider state (spec section 4.3). Every change goes through
 * `transition()` in fsm.ts, which knows the legal moves.
 *
 * - riding          on the water, handle in front
 * - ridingBlind     on the water, handle behind the back
 * - waterTrickLoad  tension over the threshold while edging: a water trick is armed
 * - waterTrickAir   in the air from a raley, roll or S-bend
 * - airborne        in the air from an ollie, kicker or feature exit
 * - onKicker        on a kicker ramp (no tricks except the lip pop)
 * - onSafety        on the sloped entry of a box or rail
 * - onFeature       sliding the main part of a box or rail
 * - landing         short grace after touching down on the water
 * - crashed         in the water, waiting for the respawn
 */
export type RiderMode =
  | 'riding'
  | 'ridingBlind'
  | 'waterTrickLoad'
  | 'waterTrickAir'
  | 'airborne'
  | 'onKicker'
  | 'onSafety'
  | 'onFeature'
  | 'landing'
  | 'crashed';

/** Where the handle is relative to the body (spec section 8). */
export type HandleState = 'inFront' | 'behind' | 'passing' | 'dropped';

export type CrashReason =
  | 'shortOllie'
  | 'missedSafetyPop'
  | 'handleDropped'
  | 'underRotated'
  | 'overRotated'
  | 'grabHeldOnLanding'
  | 'raleyExtendedOnLanding'
  | 'caughtEdgeBlind'
  | 'fellOffFeature'
  | 'ropeYank'
  | 'badLandingYaw'
  /** Impact harder than the legs can absorb. */
  | 'hardLanding'
  /** Rode or flew into a feature the wrong way. */
  | 'hitFeature'
  /** Let go of the handle (X). */
  | 'letGo'
  /** Side ollie-on short of the side edge, or landed short of the balance width (feature riding spec 3.3). */
  | 'clippedSide'
  /** Side ollie-on at too big an angle to the feature. */
  | 'noseHitSide'
  /** Side hop past the far edge of the balance width. */
  | 'overshoot'
  /** A hard edge held to takeoff rolled the base on landing. */
  | 'slippedOut'
  /** Board too far off a slide angle at contact. */
  | 'badAngle'
  /** Too slow along the feature (up a rooftop, a step-up): slid back. */
  | 'stalled'
  /** Over a sharp kink too fast: thrown off the line. */
  | 'kinkThrow'
  /** Popped off a gap safety into the gap. */
  | 'landedInGap';

export type TakeoffSource = 'flat' | 'kicker' | 'feature' | 'waterTrick' | 'lineLift' | 'blindPop';

export type RotationSide = 'frontside' | 'backside';

/**
 * Spin (around world up) and flip (around the board's long axis), plus the
 * handle-pass bookkeeping for the spin. Used in the air and on features.
 */
export interface RotationState {
  /** Yaw since the rotation context started (rad), + clockwise from above. */
  spinAngle: number;
  /** Current spin rate (rad/s), signed like spinAngle. */
  spinRate: number;
  /** After A/D is released: where the spin carries to, or null when stopped. */
  spinTarget: number | null;
  /** Direction of the current spin: -1, 0 or 1 (sign of spinAngle growth). */
  spinDir: number;
  /** Direction the first spin of this context went (-1 or 1), 0 before any spin. */
  startDir: number;
  /** Handle progress at spinAngle 0 (rad): PI when the context starts blind. */
  progressOffset: number;
  /** Decided when the spin starts: does the chest or the back turn to the pull first. */
  spinSide: RotationSide | null;
  /** Largest |spinAngle| reached in this context (rad). */
  maxSpin: number;
  /** Flip angle (rad): + front flip, - tantrum. */
  flipAngle: number;
  flipRate: number;
  flipTarget: number | null;
  /** Handle-pass window length for this context (s). */
  passWindow: number;
  /** Handle-pass zones already resolved (passed, or stopped at). */
  zonesResolved: number;
  /** Successful handle passes. */
  passes: number;
  /** Seconds left in a pass animation. */
  passTimer: number;
  /** Spin was stopped by the rope (no pass): the rider is at the wrapped limit. */
  stoppedByRope: boolean;
  /** Spin direction that took the rider blind, or 0. */
  blindDir: number;
  /** Seconds since the current spin started (0 when not spinning): its tuck. */
  spinTime: number;
}

/** Raley, backroll, frontroll and S-bend: the parts physics needs while they run. */
export interface WaterTrickState {
  kind: 'raley' | 'backroll' | 'frontroll';
  /** -1 / +1 once a raley has turned into an S-bend (left / right), else 0. */
  sBend: number;
  /** Predicted airtime at the pop (s). */
  airtime: number;
  /** Progress through the trick, 0..1 of the predicted airtime (slowed by held inputs). */
  u: number;
  /** Raley body extension (rad): 0 over the board, PI/2 horizontal. */
  extension: number;
  /** Roll angle around the roll axis (rad), for rolls and S-bends. */
  rollAngle: number;
  rollRate: number;
  /** 0..1 pop timing against the tension peak. */
  timing: number;
  /** Planned height (m). */
  height: number;
  /** The A/D key that started the S-bend is still held, so it does not also spin. */
  sBendKeyHeld: boolean;
}

/** Everything about the current jump. Null while not airborne. */
export interface AirState {
  source: TakeoffSource;
  featureId: string | null;
  time: number;
  takeoffPos: Vec3;
  /** Direction of travel at takeoff. */
  takeoffHeading: number;
  takeoffSwitch: boolean;
  tensionAtTakeoff: number;
  /** Vertical speed added at takeoff (m/s). */
  popSpeed: number;
  /** 0..1 pop timing quality. */
  popQuality: number;
  /** Highest board height above the water (m). */
  peakHeight: number;
  passedPeak: boolean;
  /** Board yaw off the travel direction at takeoff (rad): leaving a feature sideways starts at 90. */
  spinStart: number;
  rot: RotationState;
  /** Grab being held right now (null before the chord resolves). */
  grab: GrabId | null;
  /** Seconds held of each grab this air. */
  grabTimes: Record<GrabId, number>;
  /** Water trick in progress, if this air is one. */
  trick: WaterTrickState | null;
  /** Popped from riding blind: spinning out counts as "Blind N Out". */
  fromBlind: boolean;
  /** Kicker: popped at the lip. */
  lipPop: boolean;
  /** A/D held just before the pop (-1, 0, 1): a spin that way gets the pre-wind bonus. */
  preWind: number;
  /** Feature part ('id:main' / 'id:ramp') the board is above, for the clearance check. */
  overFeature: string | null;
  /** Popped off a gap safety: landing on its main is this entry (Pop-on / pop). */
  pendingEntry: 'popOn' | 'pop' | null;
  /** Water takeoff near a feature (EntryResolver): how the rider came at it. */
  entry: AirEntry | null;
  /** The last feature part flown onto across an edge, and which edge: 0 its front, +-1 its right / left side. */
  crossing: { featureId: string; part: string; side: number; height: number } | null;
  /** Feature parts already left from (no clearance check flying over them). */
  cleared: string[];
  /** Crossed an edge short by less than the tail-clip tolerance: the landing is sketchy. */
  tailClip: boolean;
}

/** How the rider came at a feature when popping off the water (ApproachTracker at takeoff). */
export interface AirEntry {
  featureId: string;
  side: ApproachState['side'];
  /** Approach angle to the feature axis (rad, 0..PI/2). */
  angle: number;
  /** Sideways hop toward the feature (m/s), 0 if none. */
  hop: number;
  /** Roll of the base left by a hard edge held to takeoff (rad). */
  roll: number;
}

/** Contact with a feature surface (kicker ramp or the safety of a box or rail). */
export interface RampState {
  featureId: string;
  /** Distance along the feature axis from its start (m). */
  u: number;
  /** Distance to the right of the axis (m). */
  v: number;
  /** Space released while on this ramp: the tick, or -1. */
  releaseTick: number;
  /** Kicker: time to the lip when the pop was released (s), or -1. */
  releaseTimeToLip: number;
  /** Safety: an early pop onto a flush main makes the entry sketchy. */
  sketchy: boolean;
}

/** Sliding the main part of a box or rail. */
export interface JibState {
  featureId: string;
  /** Balance meter, must stay in [-1, 1]. */
  balance: number;
  /** Board yaw relative to the feature axis (rad). Rests on multiples of 90 degrees. */
  boardAngle: number;
  /** Where the current 90-degree step ends (rad). */
  targetAngle: number;
  /** Board angle on getting on (rad): landing in a boardslide starts at 90. */
  entryAngle: number;
  /** Seed of this slide's balance noise. */
  noiseSeed: number;
  time: number;
  /** Seconds spent in each slide. */
  slideTimes: Record<SlideId, number>;
  /** Slides in the order they were first held. */
  slideOrder: SlideId[];
  /** How the rider got on: a perfect pop off the safety, a pop in its window, an ollie or air onto it, or rode on. */
  entry: JibEntry;
  /** Spin in the air before landing on the feature (rad, signed; 0 for ride-ons). */
  inRotation: number;
  /** 0..1 entry quality (EntryResolver). */
  entryQuality: number;
  /** Fore-aft balance (boardslides and presses), meter units, + toward the pull. */
  fore: number;
  /** Board pitch along the feature last tick (rad), for kinks. */
  pitch: number;
  /** Seconds left of a kink lift (the board off the surface), 0 when down. */
  lift: number;
  /** Rope tension above the spike threshold (one impulse per spike). */
  spiked: boolean;
  /** Early pop onto a flush main: combo multiplier x0.8. */
  sketchy: boolean;
  /** Rotation on the feature (spin only), with handle-pass windows. */
  rot: RotationState;
}

/** How the rider got onto a feature (EntryResolver). */
export type JibEntry = 'popOn' | 'pop' | 'ollieOn' | 'sideOllieOn' | 'transfer' | 'rideOn';

/** How the rider is coming at the nearest feature (featureRide/approachTracker.ts). */
export interface ApproachState {
  featureId: string;
  /** Metres before the feature's start along its axis (negative once alongside it). */
  toStart: number;
  /** Offset from the feature's centre line (m, + to the feature's right). */
  lateral: number;
  /** Gap to the feature's nearest side edge (m; 0 when in line with it). */
  sideGap: number;
  /** Direction of travel relative to the feature axis (rad, + turning toward its right). */
  angle: number;
  /** Where the feature is: dead ahead (riding at its end), on the heelside or the toeside. */
  side: 'front' | 'heelside' | 'toeside';
  /** Edge 0..1, + heelside. */
  edge: number;
  /** Seconds the edge has been held past FeatureRide.Approach.HardEdge (0 once flat). */
  edgeTime: number;
  /** Seconds since the edge was last past HardEdge (0 while it is; large if never on this approach). */
  edgeAge: number;
  /** The feature's side of the direction of travel: +1 right, -1 left, 0 dead ahead. */
  featureSide: number;
  speed: number;
  tension: number;
  /** Rope direction relative to the feature axis (rad). */
  ropeAngle: number;
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
  /** Raw rope tension (N) and its smoothed value for the HUD and trick logic. */
  ropeTension: number;
  tensionSmooth: number;
  /** Peak smoothed tension over the last `waterTrick.historyTime`, and its age (s). */
  tensionPeak: number;
  tensionPeakAge: number;
  /** Smoothed tension one and two ticks ago, for its rate of change. */
  tensionPrev: number;
  tensionPrev2: number;
  ropeForce: Vec3;
  /** Heading from rider toward the carrier (rad). */
  ropeHeading: number;
  slackTime: number;
  handle: HandleState;
  handleDist: number;
  waistHinge: number;
  connection: number;
  /** Knee bend (visual and landing absorption), follows the pop charge. */
  legCompression: number;
  /** 0..1 ollie charge while Space is held. */
  popCharge: number;
  /** Seconds riding blind. */
  blindTime: number;
  /** Spinning back out of blind on the water: seconds left and direction, or null. */
  spinOut: { time: number; dir: number } | null;
  /** Rotation that took the rider blind (kept while riding blind). */
  blindDir: number;
  air: AirState | null;
  ramp: RampState | null;
  jib: JibState | null;
  /** The approach to the nearest feature while on the water, else null. */
  approach: ApproachState | null;
  /** Seconds left before the respawn while crashed. */
  crashTimer: number;
  lastCrash: CrashReason | null;
  /** Seconds in the current mode. */
  modeTime: number;
}
