/**
 * FeatureRideConfig (feature riding spec): every number of the feature
 * riding mechanics in one place, merged into DEFAULT_CONFIG as
 * `featureRide` (so it is generated to Luau with the rest of the config).
 * Metres, seconds, radians, newtons. Keys follow the spec's names.
 */

export interface FeatureRideConfig {
  /** Approach tracking (spec 3.1). */
  Approach: {
    /** Track a feature from this far before its start (m). */
    Range: number;
    /** ... and this far to either side of its footprint (m). */
    LateralRange: number;
    /** Riding within this much of the feature's width counts as a front approach (m). */
    FrontMargin: number;
    /** |edge| (0..1) above this is "on the edge". */
    HardEdge: number;
    /** Riders flatten the board about this far before the feature (m): the guide's marker. */
    FlattenDistance: number;
  };
}

export const DEFAULT_FEATURE_RIDE: FeatureRideConfig = {
  Approach: {
    Range: 25,
    LateralRange: 8,
    FrontMargin: 0.3,
    HardEdge: 0.5,
    FlattenDistance: 1.5,
  },
};
