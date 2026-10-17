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
  Safety: { LandingPitchTolerance: deg(15), LandingPitchCrash: deg(30) },
};
