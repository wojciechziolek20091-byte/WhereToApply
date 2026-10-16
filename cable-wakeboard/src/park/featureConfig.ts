/**
 * FeatureConfig (features spec rule 3): every number and name the wake park
 * features use outside the sim's riding: units, collision groups, tags,
 * attribute names, colours and materials, validator thresholds, approach,
 * bobbing, FX and sound ids. The ride dimensions themselves are the sim's
 * catalogue (src/sim/featureCatalog.ts) and are included here as `Catalog`,
 * so the Roblox FeatureConfig holds every dimension in one place.
 *
 * roblox/src/shared/Park/FeatureConfig.luau is generated from this file by
 * scripts/gen-luau-data.ts. Metres, seconds, degrees; convert to studs with
 * `StudsPerMetre` (the rider rig uses the same 0.28 m per stud).
 */
import { CATALOG_COMMON, FEATURE_CATALOG } from '../sim/featureCatalog';
import { DEFAULT_CONFIG } from '../sim/config';

type RGB = [number, number, number];

export const FEATURE_CONFIG = {
  StudsPerMetre: 3.57,

  /** Collision groups (spec section 3). The rider collides only with Ride and queries Crash. */
  CollisionGroups: {
    Ride: 'FeatureRide',
    Visual: 'FeatureVisual',
    Crash: 'FeatureCrash',
    Rider: 'Rider',
  },
  /** Pairs that collide; every other pair among these groups does not. */
  Collidable: [
    ['Rider', 'FeatureRide'],
    ['Default', 'FeatureRide'],
  ] as [string, string][],

  /** CollectionService tags (spec 4.1). `Kicker` / `Obstacle` are the category tags; `ParkFeature` is on every feature. */
  Tags: { All: 'ParkFeature', Kicker: 'Kicker', Obstacle: 'Obstacle', RideSurface: 'FeatureRideSurface', CrashVolume: 'FeatureCrashVolume' },

  /** Child folders of every feature model (spec section 3). */
  Folders: ['Visual', 'Ride', 'Crash', 'Approach', 'Signage', 'FX'],

  /** Where generated features go. */
  ParkFolder: 'Park',
  FeaturesFolder: 'Features',

  /** Shared catalogue numbers and the 15 features (spec section 2). */
  Common: CATALOG_COMMON,
  Catalog: FEATURE_CATALOG,

  /** Difficulty 1-4: sign colour, name, stripes on the leading edge (spec 1, 7). */
  Difficulty: [
    { name: 'Beginner', color: [46, 160, 67] as RGB, stripes: 1 },
    { name: 'Intermediate', color: [33, 110, 210] as RGB, stripes: 1 },
    { name: 'Advanced', color: [24, 24, 28] as RGB, stripes: 1 },
    { name: 'Pro', color: [24, 24, 28] as RGB, stripes: 2 },
  ],

  /** Colours (spec section 7). One accent per line. */
  Colors: {
    TopBlack: [32, 34, 38] as RGB,
    TopWhite: [236, 238, 240] as RGB,
    Frame: [150, 156, 162] as RGB,
    PontoonWhite: [232, 232, 226] as RGB,
    PontoonYellow: [240, 196, 40] as RGB,
    Coping: [196, 200, 204] as RGB,
    Pipe: [178, 184, 190] as RGB,
    Chain: [70, 72, 76] as RGB,
    BuoyOrange: [244, 112, 28] as RGB,
    BuoyWhite: [244, 244, 240] as RGB,
    WetBand: [40, 52, 58] as RGB,
    Algae: [64, 96, 70] as RGB,
    Foam: [250, 252, 252] as RGB,
    Wall: [236, 238, 240] as RGB,
    Sign: [250, 250, 246] as RGB,
    Dock: [150, 112, 74] as RGB,
  },
  Accents: {
    Orange: [244, 120, 32] as RGB,
    Teal: [20, 160, 160] as RGB,
    Yellow: [246, 200, 30] as RGB,
    Magenta: [210, 40, 140] as RGB,
  } as Record<string, RGB>,

  /** Roblox materials (spec section 7). Wood only for docks. */
  Materials: {
    HDPE: 'SmoothPlastic',
    Frame: 'DiamondPlate',
    Pipe: 'Metal',
    Pontoon: 'Plastic',
    Chain: 'Metal',
    Skatelite: 'SmoothPlastic',
    Dock: 'Wood',
  },
  /** HDPE sheen (spec 7: 0.05-0.1). */
  HDPEReflectance: 0.07,
  /** Coping radius on box edges (m, validator: at least 0.03). */
  CopingRadius: 0.04,
  /** Visual top sheet thickness (m): the ride surface is its top face. */
  TopSheet: 0.05,
  /** Bolt rows along the coping: spacing (m). */
  BoltSpacing: 0.6,
  /** Ride sub-segments per kicker transition (validator: at least 6). */
  KickerSubsegments: 10,

  /** Floating features bob (spec 7). Only the Visual folder moves, and never near a rider. */
  Bob: { Amplitude: 0.03, Frequency: 0.2, FreezeRadius: 6 },

  /** Approach data (spec section 6). */
  Approach: {
    EntryDistance: 12,
    IdealSpeed: DEFAULT_CONFIG.cable.carrierSpeed,
    /** IdealPopOffset for kickers: the middle of the sim's lip pop window (s). */
    IdealPopOffset: DEFAULT_CONFIG.kicker.lipPopWindow / 2,
    /** Name + difficulty tag shows this far before a feature (spec 11). */
    NameTagDistance: 25,
  },

  /** Safety pop zone: the sim's window (spec 4.2 asks 0.5 m; the sim uses at least `safety.popWindowMinMetres`). */
  PopZoneLength: DEFAULT_CONFIG.safety.popWindowMinMetres,

  /** FeatureValidator thresholds (spec section 5). */
  Validator: {
    SafetySlope: [12, 22],
    SafetyDepth: [0.15, 0.35],
    KickerWidthMin: 2.5,
    BoxWidthMin: 0.8,
    SliderWidthMin: 1.0,
    RailHeight: [0.4, 1.4],
    /** Max ollie height from the sim (v^2 / 2g at full charge). */
    MaxOllieHeight: (DEFAULT_CONFIG.ollie.maxV * DEFAULT_CONFIG.ollie.maxV) / (2 * 9.81),
    KinkJoinTolerance: 0.01,
    KinkMaxAngle: 20,
    VisualTolerance: 0.02,
    RopeLength: DEFAULT_CONFIG.rope.length,
    MinOffLine: 2,
    ApproachClearance: 8,
    ExitClearance: 12,
    CopingMin: 0.03,
    KickerMinSubsegments: 6,
    MaxParts: 120,
  },

  /**
   * Crash volumes (spec 4.3): CrashReason is the sim's crash reason; the
   * message is what the crash UI shows.
   */
  CrashMessages: {
    shortOllie: 'Clipped the edge: ollie higher',
    missedSafetyPop: 'Into the gap: pop at the end of the safety',
    hitFeature: 'Hit the frame',
    fellOffFeature: 'Over the top',
  } as Record<string, string>,
  /** Clear space kept below a slide top before its crash volume starts (m). */
  CrashBelowTop: 0.06,

  /** Sounds by SurfaceMaterial and event (spec 8). Empty: no assets yet. */
  Sounds: {
    HDPE: { Slide: '', Enter: '' },
    Pipe: { Slide: '', Enter: '' },
    Skatelite: { Slide: '', Enter: '' },
    KickerRoll: '',
    WallSlap: '',
    Splash: '',
    Impact: '',
  },
};
