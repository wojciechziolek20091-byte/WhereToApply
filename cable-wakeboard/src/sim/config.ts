/**
 * Every tunable in the sim. SI units. See docs/MECHANICS.md for what each
 * section models. Defaults are starting points for tuning, not measurements.
 */

export const DT = 1 / 60;
export const GRAVITY = 9.81;

export interface TowerDef {
  x: number;
  z: number;
}

export interface CableConfig {
  /** Tower positions in order of travel. The loop closes back to the first. */
  towers: TowerDef[];
  /** Radius of the arc the cable makes around each tower wheel (m). */
  cornerRadius: number;
  /** Height of the cable above the water (m). */
  cableHeight: number;
  /** Constant carrier speed along the cable (m/s). 8.3 m/s is about 30 km/h. */
  carrierSpeed: number;
  /** 'loop': carriers lap the towers. 'twoTower': one carrier shuttles between the first two towers. */
  mode: 'loop' | 'twoTower';
}

export interface RopeConfig {
  /** Rope length from carrier to handle (m). */
  length: number;
  /** Stand-in stiffness for body and arms (N/m). */
  stiffness: number;
  /** Damping while taut (N per m/s of stretch rate). */
  damping: number;
  /** Stretch rate (m/s) above which going taut counts as a rope snap. */
  snapRate: number;
  /** Tension cap (N). */
  maxTension: number;
  /** A snap back to taut above this tension while off-balance yanks the rider over (N). */
  yankCrashImpulse: number;
  /** Time constant of the smoothed tension used by the HUD and trick logic (s). */
  smoothTau: number;
}

export interface RiderConfig {
  /** Rider plus board (kg). */
  mass: number;
  /** Height of the hips / handle above the board (m). */
  hipHeight: number;
  stance: 'regular' | 'goofy';
}

export interface HydroConfig {
  /** Planing drag along the board: F = c * v^2 (N s^2 / m^2). */
  dragCoef: number;
  /** Sideways grip at full edge: F = c * vLat * max(|v|, gripMinSpeed). */
  lateralGrip: number;
  /** Fraction of lateral grip a flat board still has. */
  flatGripFraction: number;
  gripMinSpeed: number;
  /** Dead-in-the-water drag so a detached rider stops (N per m/s). */
  linearDrag: number;
  /** Rope lift above this multiple of body weight pulls the rider off the water. */
  liftOffFactor: number;
  /** Drag on a fallen rider in the water (N per m/s). */
  fallenDrag: number;
}

export interface EdgeConfig {
  /** Largest edge angle the rider can hold (rad). */
  maxEdgeAngle: number;
  /** How fast the edge loads up (rad/s). Slow on purpose: progressive edge. */
  edgeBuildRate: number;
  /** How fast the edge flattens (rad/s). */
  edgeReleaseRate: number;
  /** Cut angle relative to the rope at full edge (rad). */
  maxCutAngle: number;
  /** First-order yaw response toward the target cut heading (1/s). */
  yawResponse: number;
  /** Carve curvature while slack: yaw rate = carveCurvature * speed * edgeNorm (1/m). */
  carveCurvature: number;
  maxYawRate: number;
  /** Tension (N) at which the rope fully controls heading. */
  ropeControlTension: number;
}

export interface PostureConfig {
  /** Handle-to-hips distance with the handle pulled in (m). */
  handleInDist: number;
  /** Handle-to-hips distance with arms fully extended (m). */
  handleOutDist: number;
  /** Speed the handle moves between those (m/s). */
  handleRate: number;
  /** Waist hinge growth per second at reference tension with arms out. */
  hingeGain: number;
  /** Waist hinge recovery per second when connected. */
  hingeRecovery: number;
  hingeTensionRef: number;
  /** Connection lost per unit of normalised handle distance. */
  handleWeight: number;
  /** Connection lost per unit of hinge. */
  hingeWeight: number;
  /** Knee bend rate while holding load (1/s) and its recovery when standing. */
  compressRate: number;
  standRate: number;
}

/** Degrees to radians, for writing angles the way the design spec states them. */
export const deg = (d: number): number => (d * Math.PI) / 180;

/** Ollie: charge with Space held, pop on release. */
export interface OllieConfig {
  /** Time to full charge (s). */
  chargeTime: number;
  /** Vertical speed at zero and full charge (m/s). */
  minV: number;
  maxV: number;
  /** Clearance the board needs over an obstacle's main surface when ollied onto it (m). */
  clearance: number;
}

/** Kicker lip pop. */
export interface KickerConfig {
  /** Releasing the pop this long or less before the lip counts as a lip pop (s). */
  lipPopWindow: number;
  /** Extra vertical speed from a lip pop, as a fraction of the launch's vertical speed. */
  lipPopBonus: number;
}

/** Safety (sloped entry) of a box or rail. */
export interface SafetyConfig {
  /** The pop window is the last fraction of the safety's length... */
  popWindowFraction: number;
  /** ...but at least this long (m). */
  popWindowMinMetres: number;
  /** Centre fraction of the window that counts as a perfect pop-on. */
  perfectFraction: number;
  /** Combo multiplier for a sketchy pop-on (early pop onto a flush main). */
  sketchyMultiplier: number;
  /**
   * Popping across a water gap (gap boxes) uses this fraction of the ollie's
   * pop speed: the safety's slope already carries the rider over.
   */
  gapPopScale: number;
}

/** Spins (around the vertical axis), from A/D. */
export interface SpinConfig {
  /** Full spin rate (rad/s). */
  rate: number;
  /** Time to reach full rate (s). */
  accelTime: number;
  /** After release, keep rotating to the next half turn only if it is this close (rad). */
  maxCarry: number;
}

/** Flips (around the board's long axis), from W / S in the air. */
export interface FlipConfig {
  rate: number;
  /** After release, keep rotating to the next whole turn only if it is this close (rad). */
  maxCarry: number;
}

/** Handle-pass windows (s), by where the rotation happens. */
export interface HandlePassConfig {
  featureWindow: number;
  kickerWindow: number;
  obstacleAirWindow: number;
  waterTrickWindow: number;
  /** Ollies from flat water. */
  flatAirWindow: number;
  /** How long a pass takes (s). */
  passTime: number;
}

/** Riding blind: handle behind the back. */
export interface BlindConfig {
  /** Seconds before riding blind catches an edge. */
  maxRideTime: number;
  /** Steering authority while blind. */
  steerFactor: number;
  /** Largest edge (fraction of max) while blind. */
  maxEdge: number;
  /** Tension cap while blind (N). */
  maxTension: number;
  /** Time to spin back out of blind on the water (s). */
  spinOutTime: number;
}

/** Tension-based water tricks: raley, backroll, frontroll, S-bend. */
export interface WaterTrickConfig {
  /** Smoothed tension that arms a water trick (N). */
  tensionThreshold: number;
  /** Disarm below threshold minus this (N). */
  hysteresis: number;
  /** Edge needed to arm (fraction of max). */
  minEdge: number;
  /** Travel at least this far off the rope direction counts as sideways (rad). */
  sidewaysAngle: number;
  /** Release within this of the tension peak for full timing (s). */
  peakWindow: number;
  /** How far back the tension history looks for the peak (s). */
  historyTime: number;
  /** Height at 1000 N and perfect timing (m), and the cap (m). */
  baseHeight: number;
  maxHeight: number;
  /** Rolls below this height cannot finish (m). */
  minRollHeight: number;
  /** Raley extension still showing at touchdown that crashes (rad of body angle). */
  maxLandingExtension: number;
  /** Raley phases as fractions of the trick's airtime. */
  popPhaseEnd: number;
  extensionEnd: number;
  swingDownEnd: number;
  /** While spinning, grabbing or S-bending, the swing-down runs this much slower. */
  heldSwingFactor: number;
}

/** S-bend: A/D in this part of the raley's airtime (fractions). */
export interface SBendConfig {
  windowStart: number;
  windowEnd: number;
}

export interface GrabConfig {
  /** After E, a modifier key within this time picks the grab (s). */
  chordWindow: number;
}

/** Air flight. */
export interface AirConfig {
  /** Quadratic air drag (N s^2/m^2). */
  dragCoef: number;
  /** Shortest air that can count as a trick (s). */
  minAirTime: number;
}

export interface LandingConfig {
  /** Board heading this far from forward or switch crashes (rad). */
  maxYawError: number;
  /** Flip residual from a whole turn that crashes (rad). */
  maxFlipError: number;
  /** Both errors under this is a clean landing (rad). */
  cleanThreshold: number;
  /** Bonus for a clean landing. */
  cleanBonus: number;
  /** DECISION: a grab still held on touchdown crashes (else: sketchy, combo multiplier halved). */
  grabHeldCrashes: boolean;
  /** Normal impact speed a straight-legged rider can take (m/s). */
  stiffImpact: number;
  /** Extra normal impact speed per unit of leg compression (m/s). */
  absorbImpact: number;
  /** Short grace state after touchdown (s). */
  graceTime: number;
}

export interface FeatureConfig {
  /** Wet ramp friction coefficient. */
  rampFriction: number;
  /** Highest surface (m) a rider can ride onto; above that it is a crash. */
  mountHeight: number;
  /** Largest angle between travel and the feature axis to ride onto it (rad). */
  mountAngle: number;
  /** Below this speed up a ramp the rider stalls and falls (m/s). */
  stallSpeed: number;
  /** Slide friction on a box or rail main. */
  friction: number;
  /** Time for each 90-degree board rotation on a feature (s). */
  rotateTimePer90: number;
  /** A/D held longer than this rotates the board; shorter is a balance tap (s). */
  tapTime: number;
  /** DECISION: balance can be switched off for early testing. */
  balanceEnabled: boolean;
  /** Balance drift rate on boxes and rails (per second at full noise). */
  balanceDriftBox: number;
  balanceDriftRail: number;
  /** Noise frequency of the drift (1/s). */
  balanceNoiseRate: number;
  /** Balance moved by one tap. */
  tapStrength: number;
  /** The rope's sideways pull tips the balance: pull (N) for one unit per second. */
  ropeTip: number;
  /** Sideways damping on a slide (1/s). */
  lateralDamping: number;
  /** Popping off a wall ride pushes away from its face with this fraction of the ollie's speed. */
  wallPopOut: number;
}

export interface ComboConfig {
  /** Riding time after a landing in which the next trick still links (s). */
  linkWindow: number;
  /** Points multiplier for repeating a trick name in one combo. */
  repeatPenalty: number;
  /** Combo multiplier per extra trick, and its cap. */
  perTrick: number;
  maxMultiplier: number;
}

export interface CrashConfig {
  /** Time from a crash to the respawn (s). */
  respawnDelay: number;
}

/**
 * Gameplay side of the animation spec's section 11, each switchable so the
 * old and new feel can be compared (`?physics=old` in the web game).
 */
export interface PhysicsConfig {
  /**
   * Flips and spins turn at L / I(tuck): fast tucked, slow opened up. L is
   * set so a full turn takes as long as before at the input rate, so the
   * controls keep their timing; only the speed profile within the turn changes.
   */
  tuckRotation: boolean;
  /** Moments of inertia (kg m^2), open and tucked. */
  flipInertiaOpen: number;
  flipInertiaTucked: number;
  spinInertiaOpen: number;
  spinInertiaTucked: number;
  /** Tuck by flip progress through the turn: [progress 0..1, tuck 0..1] keys (the animation's flip clips follow the same curve). */
  flipTuck: number[][];
  /** Spins: tucked after this long into the spin (s), opened up over the last `spinOpen` of it (rad). */
  spinTuckIn: number;
  spinOpen: number;
  /** A/D held in the `preWindWindow` before the pop: the spin that way is `preWindBonus` faster. */
  preWind: boolean;
  preWindWindow: number;
  preWindBonus: number;
  /** The pull reaches the body at the shoulders (height above the board, m): its direction; the stretch stays at the handle. */
  ropeAtShoulders: boolean;
  shoulderHeight: number;
  /** Landings cost speed: this fraction per m/s of impact, times `sketchyCost` when not clean. */
  landingSpeedCost: boolean;
  landingCostPerMS: number;
  sketchyCost: number;
}

export interface DebugConfig {
  /** Log state transitions as events and assert illegal ones. */
  enabled: boolean;
}

export interface RunConfig {
  passesPerRun: number;
  maxFalls: number;
  /** Seconds without a trick or feature that count as dead water. */
  deadWaterTime: number;
  /** Rope distance behind the carrier at respawn as a fraction of length. */
  respawnSlack: number;
}

export interface ScoringConfig {
  judges: number;
  weights: { execution: number; intensity: number; composition: number };
  /** Max absolute bias per judge per criterion (points). */
  judgeBias: number;
  seed: number;
}

export interface SimConfig {
  cable: CableConfig;
  rope: RopeConfig;
  rider: RiderConfig;
  hydro: HydroConfig;
  edge: EdgeConfig;
  posture: PostureConfig;
  ollie: OllieConfig;
  kicker: KickerConfig;
  safety: SafetyConfig;
  spin: SpinConfig;
  flip: FlipConfig;
  handlePass: HandlePassConfig;
  blind: BlindConfig;
  waterTrick: WaterTrickConfig;
  sBend: SBendConfig;
  grab: GrabConfig;
  air: AirConfig;
  landing: LandingConfig;
  feature: FeatureConfig;
  combo: ComboConfig;
  crash: CrashConfig;
  run: RunConfig;
  scoring: ScoringConfig;
  physics: PhysicsConfig;
  debug: DebugConfig;
}

export const DEFAULT_CONFIG: SimConfig = {
  cable: {
    // The sketch park's five towers (parkLayout.ts): south-west, south-east,
    // the east shoulder, the roof apex, north-west. Counter-clockwise seen from above.
    towers: [
      { x: -56.2, z: 110.4 },
      { x: 56.2, z: 102.5 },
      { x: 54.7, z: -55.2 },
      { x: 15.8, z: -110.4 },
      { x: -56.2, z: -72 },
    ],
    cornerRadius: 12,
    cableHeight: 9,
    carrierSpeed: 8.3,
    mode: 'loop',
  },
  rope: {
    length: 18,
    stiffness: 4000,
    damping: 600,
    snapRate: 2.5,
    maxTension: 2500,
    yankCrashImpulse: 1800,
    smoothTau: 0.08,
  },
  rider: { mass: 80, hipHeight: 1.0, stance: 'regular' },
  hydro: {
    dragCoef: 4.0,
    lateralGrip: 70,
    flatGripFraction: 0.25,
    gripMinSpeed: 2,
    linearDrag: 8,
    liftOffFactor: 1.6,
    fallenDrag: 300,
  },
  edge: {
    maxEdgeAngle: 0.7,
    edgeBuildRate: 1.0,
    edgeReleaseRate: 3.0,
    maxCutAngle: 0.82,
    yawResponse: 3.5,
    carveCurvature: 0.12,
    maxYawRate: 2.5,
    ropeControlTension: 250,
  },
  posture: {
    handleInDist: 0.2,
    handleOutDist: 0.7,
    handleRate: 1.6,
    hingeGain: 1.2,
    hingeRecovery: 1.5,
    hingeTensionRef: 1200,
    handleWeight: 0.55,
    hingeWeight: 0.5,
    compressRate: 3.0,
    standRate: 4.0,
  },
  ollie: { chargeTime: 0.5, minV: 3.5, maxV: 6.5, clearance: 0.1 },
  kicker: { lipPopWindow: 0.12, lipPopBonus: 0.2 },
  safety: { popWindowFraction: 0.08, popWindowMinMetres: 1.0, perfectFraction: 0.4, sketchyMultiplier: 0.8, gapPopScale: 0.25 },
  spin: { rate: deg(540), accelTime: 0.1, maxCarry: deg(90) },
  flip: { rate: deg(400), maxCarry: deg(60) },
  handlePass: {
    featureWindow: 0.35,
    kickerWindow: 0.18,
    obstacleAirWindow: 0.25,
    waterTrickWindow: 0.25,
    flatAirWindow: 0.25,
    passTime: 0.15,
  },
  blind: { maxRideTime: 3.0, steerFactor: 0.4, maxEdge: 0.5, maxTension: 900, spinOutTime: 0.4 },
  waterTrick: {
    tensionThreshold: 1000,
    hysteresis: 100,
    minEdge: 0.7,
    sidewaysAngle: deg(35),
    peakWindow: 0.15,
    historyTime: 0.4,
    baseHeight: 1.8,
    maxHeight: 4.5,
    minRollHeight: 1.4,
    maxLandingExtension: deg(30),
    popPhaseEnd: 0.15,
    extensionEnd: 0.55,
    swingDownEnd: 0.85,
    heldSwingFactor: 0.5,
  },
  sBend: { windowStart: 0.25, windowEnd: 0.45 },
  grab: { chordWindow: 0.08 },
  air: { dragCoef: 0.4, minAirTime: 0.25 },
  landing: {
    maxYawError: deg(35),
    maxFlipError: deg(40),
    cleanThreshold: deg(12),
    cleanBonus: 0.1,
    grabHeldCrashes: true,
    stiffImpact: 9.0,
    absorbImpact: 2.0,
    graceTime: 0.15,
  },
  feature: {
    rampFriction: 0.06,
    mountHeight: 0.25,
    mountAngle: 1.0,
    stallSpeed: 0.8,
    friction: 0.08,
    rotateTimePer90: 0.18,
    tapTime: 0.15,
    balanceEnabled: true,
    balanceDriftBox: 0.9,
    balanceDriftRail: 1.6,
    balanceNoiseRate: 1.3,
    tapStrength: 0.35,
    ropeTip: 1400,
    lateralDamping: 6,
    wallPopOut: 0.6,
  },
  combo: { linkWindow: 2.0, repeatPenalty: 0.5, perTrick: 0.25, maxMultiplier: 4 },
  crash: { respawnDelay: 2.5 },
  run: { passesPerRun: 2, maxFalls: 2, deadWaterTime: 8, respawnSlack: 0.98 },
  scoring: {
    judges: 3,
    weights: { execution: 3.3, intensity: 3.4, composition: 3.3 },
    judgeBias: 0.4,
    seed: 20261013,
  },
  physics: {
    tuckRotation: true,
    flipInertiaOpen: 12,
    flipInertiaTucked: 4,
    spinInertiaOpen: 2.5,
    spinInertiaTucked: 1.2,
    flipTuck: [
      [0, 0],
      [0.12, 0.6],
      [0.2, 1],
      [0.72, 1],
      [0.92, 0],
      [1, 0],
    ],
    spinTuckIn: 0.03,
    spinOpen: deg(45),
    preWind: true,
    preWindWindow: 0.2,
    preWindBonus: 0.12,
    ropeAtShoulders: true,
    shoulderHeight: 1.45,
    landingSpeedCost: true,
    landingCostPerMS: 0.012,
    sketchyCost: 2,
  },
  debug: { enabled: true },
};

/** Deep-ish copy with overrides per section, for tests and variants. */
export function makeConfig(overrides: { [K in keyof SimConfig]?: Partial<SimConfig[K]> } = {}): SimConfig {
  const out = structuredClone(DEFAULT_CONFIG);
  for (const key of Object.keys(overrides) as (keyof SimConfig)[]) {
    Object.assign(out[key], overrides[key]);
  }
  return out;
}
