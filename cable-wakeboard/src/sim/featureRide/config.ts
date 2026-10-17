/**
 * FeatureRideConfig: every number of the feature riding spec. Part of the
 * sim config (`DEFAULT_CONFIG.featureRide`), so it reaches Luau through the
 * generated Config.luau (`FeatureRideConfig.luau` re-exports it). Angles in
 * radians.
 */
const deg = (d: number): number => (d * Math.PI) / 180;

export interface FeatureRideConfig {
  /** ApproachTracker (spec 3.1). */
  Approach: {
    /** Track features whose start is within this distance ahead (m). */
    Range: number;
    /** ...and whose nearest side is within this distance (m). */
    LateralRange: number;
    /** Within this of the feature's width (m), the approach is a front one. */
    FrontMargin: number;
    /** Edge amount (0..1) that counts as a hard edge. */
    HardEdge: number;
    /** Riders flatten the board this far before the feature (m): the guide's cue. */
    FlattenDistance: number;
  };
  /** Ollie-on clearance (spec 3.2). */
  Entry: {
    /** Board base must cross the edge this far above the top (m). */
    Clearance: number;
    /** Short by less than this (m): tail clip, sketchy but on. */
    TailClipTolerance: number;
    /** Speed kept after a tail clip. */
    TailClipSpeedKeep: number;
    /** Balance hit of a tail clip (meter units, 1 = off). */
    TailClipHit: number;
  };
  /** Side ollie-on (spec 3.3). */
  SideEntry: {
    /** Largest approach angle to the feature axis (rad). */
    MaxAngle: number;
    /** Farthest from the feature's side at takeoff for the hop (m). */
    MaxLateral: number;
    /** Sideways hop toward the feature with A/D held at release, by charge (m/s). */
    HopLateralVMin: number;
    HopLateralVMax: number;
    /** Box balance width: top width minus this (m). */
    BoxEdgeMargin: number;
    /** Narrower than this (m) a flat top is a rail. */
    RailMaxWidth: number;
    /** Balance half-width on a flat rail and a pipe (m from centre). */
    RailHalfWidth: number;
    PipeHalfWidth: number;
    /** Past the far edge of the balance width by up to this (m): a sketchy recovery. */
    OvershootRecover: number;
    OvershootHit: number;
    /** Coming down past the far side this little above the top (m) catches it: overshoot. Higher is a clean hop over. */
    OvershootCatch: number;
  };
  /** Landing on the feature (spec 4). */
  Landing: {
    /** Base roll to the surface beyond this crashes (slipped out) (rad). */
    MaxRoll: number;
    /** Beyond this it is sketchy (rad). */
    SketchyRoll: number;
    RollHit: number;
    /** A hard edge held this long before takeoff (s) rolls the base on landing. */
    SlipWindow: number;
    /** That roll, by approach side (rad): backside entries slip worst. */
    SlipRollHeelside: number;
    SlipRollToeside: number;
    SlipRollFront: number;
    /** Board angle snaps to the nearest slide within this (rad)... */
    SnapTolerance: number;
    /** ...is sketchy up to this, and crashes (bad angle) beyond (rad). */
    SketchyAngle: number;
    AngleHit: number;
    /** Impact along the surface normal: a balance hit above HardImpact, a crash above CrashImpact (m/s). */
    HardImpact: number;
    CrashImpact: number;
    ImpactHit: number;
    /** Still spinning faster than this at contact (rad/s) skids: sketchy. */
    SkidRate: number;
    SkidHit: number;
    /** Largest balance offset an entry leaves (meter units). */
    MaxHit: number;
  };
  /** Slide physics on the feature (spec 5.1). */
  Slide: {
    /** Friction by surface material where the feature sets none (wet HDPE, pipe, skatelite). */
    MaterialFriction: Record<'HDPE' | 'Pipe' | 'Skatelite', number>;
    /** Boardslides and lipslides skid more; presses ride on less base. */
    BoardslideFriction: number;
    PressFriction: number;
    /** Slower than this along the feature (m/s): stalled. */
    StallSpeed: number;
    /** Pitch changes smaller than this between ticks are not kinks (rad). */
    KinkMinAngle: number;
    /** Over a down kink the board lifts for (this x angle x speed) s, if at least KinkLiftMin, at most KinkLiftMax. */
    KinkLiftPerRadSpeed: number;
    KinkLiftMin: number;
    KinkLiftMax: number;
    /** Balance hit when the board re-lands with any input held (knees not soft). */
    KinkHit: number;
    /** Kinks sharper than this get a speed check (rad)... */
    KinkCheckAngle: number;
    /** ...against this speed at the check angle, less for sharper kinks (m/s). */
    KinkThrowSpeed: number;
    /** Up to this fraction over: sketchy with a hit; more throws the rider off. */
    KinkSketchyMargin: number;
    KinkSketchyHit: number;
  };
  /** Two-axis balance on the feature (spec 5.6, 5.7), meter units (out past 1). */
  Balance: {
    /** Smooth noise drift by top: box, flat rail, pipe (per s). */
    NoiseBox: number;
    NoiseRail: number;
    NoisePipe: number;
    /** Narrower than this a flat top is a rail for the noise (m). */
    BoxMinWidth: number;
    NoiseRate: number;
    /** Drift by slide: boardslides and lipslides are less stable; on a pipe boardslides are the stable ones. */
    BoardslideFactor: number;
    LipslideFactor: number;
    PipeFiftyFactor: number;
    PipeBoardslideFactor: number;
    /** Rope pull across the feature that tips one unit per second (N). */
    RopeTip: number;
    /** Drift per unit of cross slope (per s). */
    CrossSlopeGain: number;
    /** An A/D tap (shorter than feature.tapTime) corrects this much. */
    TapStrength: number;
    /** Rope tension spike: above this (N) the rider is thrown toward the cable side by SpikeImpulse. */
    SpikeTension: number;
    SpikeImpulse: number;
    /** Fore-aft (boardslides and presses): noise, rope pull along the feature that tips one unit per second (N), slope. */
    ForeNoise: number;
    ForeRopeTip: number;
    ForeSlopeGain: number;
    /** A W/S tap corrects this much. */
    ForeTapStrength: number;
    /** Fore-aft settles back to centre at this rate outside boardslides and presses (per s). */
    ForeDecay: number;
    /** Losing balance within this of the end (m) is a sketchy exit, not a crash. */
    LastMetre: number;
  };
  /** Ollie onto the safety and pop off it (spec 3.5, 3.6). */
  Safety: {
    /** Board pitch off the safety's slope: sketchy beyond the tolerance, a crash beyond the limit (rad). */
    LandingPitchTolerance: number;
    LandingPitchCrash: number;
  };
}

export const DEFAULT_FEATURE_RIDE: FeatureRideConfig = {
  Approach: { Range: 25, LateralRange: 8, FrontMargin: 0.3, HardEdge: 0.5, FlattenDistance: 1.5 },
  Entry: { Clearance: 0.08, TailClipTolerance: 0.1, TailClipSpeedKeep: 0.75, TailClipHit: 0.5 },
  SideEntry: {
    MaxAngle: deg(25),
    MaxLateral: 2.5,
    HopLateralVMin: 1.5,
    HopLateralVMax: 3.0,
    BoxEdgeMargin: 0.2,
    RailMaxWidth: 0.3,
    RailHalfWidth: 0.15,
    PipeHalfWidth: 0.1,
    OvershootRecover: 0.1,
    OvershootHit: 0.5,
    OvershootCatch: 0.3,
  },
  Landing: {
    MaxRoll: deg(12),
    SketchyRoll: deg(8),
    RollHit: 0.3,
    SlipWindow: 0.2,
    SlipRollHeelside: deg(16),
    SlipRollToeside: deg(10),
    SlipRollFront: deg(6),
    SnapTolerance: deg(20),
    SketchyAngle: deg(30),
    AngleHit: 0.6,
    HardImpact: 5,
    CrashImpact: 8,
    ImpactHit: 0.6,
    SkidRate: deg(90),
    SkidHit: 0.3,
    MaxHit: 0.85,
  },
  Slide: {
    MaterialFriction: { HDPE: 0.06, Pipe: 0.05, Skatelite: 0.12 },
    BoardslideFriction: 1.6,
    PressFriction: 0.8,
    StallSpeed: 1.0,
    KinkMinAngle: deg(2),
    KinkLiftPerRadSpeed: 0.068,
    KinkLiftMin: 0.05,
    KinkLiftMax: 0.15,
    KinkHit: 0.25,
    KinkCheckAngle: deg(12),
    KinkThrowSpeed: 12,
    KinkSketchyMargin: 0.15,
    KinkSketchyHit: 0.5,
  },
  Balance: {
    NoiseBox: 0.9,
    NoiseRail: 1.6,
    NoisePipe: 2.0,
    BoxMinWidth: 0.6,
    NoiseRate: 1.3,
    BoardslideFactor: 1.3,
    LipslideFactor: 1.5,
    PipeFiftyFactor: 1.25,
    PipeBoardslideFactor: 0.85,
    RopeTip: 1400,
    CrossSlopeGain: 1.5,
    TapStrength: 0.35,
    SpikeTension: 1600,
    SpikeImpulse: 0.35,
    ForeNoise: 0.6,
    ForeRopeTip: 4000,
    ForeSlopeGain: 2.0,
    ForeTapStrength: 0.35,
    ForeDecay: 2,
    LastMetre: 1.0,
  },
  Safety: { LandingPitchTolerance: deg(15), LandingPitchCrash: deg(30) },
};
