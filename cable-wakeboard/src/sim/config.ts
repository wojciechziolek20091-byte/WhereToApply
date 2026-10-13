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
}

export interface RopeConfig {
  /** Rope length from carrier to handle (m). */
  length: number;
  /** Stand-in stiffness for body and arms (N/m). */
  stiffness: number;
  /** Damping while taut (N per m/s of stretch rate). */
  damping: number;
  /** Tension above which the handle is ripped out of the rider's hands (N). */
  gripLimit: number;
  /** How long tension can exceed gripLimit before the handle goes (s). */
  gripTime: number;
  /** Stretch rate (m/s) above which going taut counts as a rope snap. */
  snapRate: number;
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

export interface PopConfig {
  /** Pop from leg extension alone (m/s). */
  base: number;
  /** Extra pop at reference edge load (m/s). */
  edgeGain: number;
  edgeLoadRef: number;
  /** Extra pop at reference tension (m/s). */
  tensionGain: number;
  tensionRef: number;
  /** Upper bound on the pop impulse (m/s). */
  maxPop: number;
  /** Time over which the legs extend after release (s). */
  extendTime: number;
  /** Kicker timing: ideal release this long before leaving the lip (s). */
  lipLead: number;
  /** Kicker timing window half-width (s). Outside it the pop is absorbed. */
  lipWindow: number;
  /** Flat water: how long the peak edge load is remembered (s). */
  peakMemory: number;
  /** Minimum edge load for a flat-water pop to count as loaded (N). */
  flatMinLoad: number;
}

export interface AirConfig {
  /** Quadratic air drag (N s^2/m^2). */
  dragCoef: number;
  /** Spin rate with the handle in (rad/s). */
  spinRate: number;
  /** Invert rate with the handle in (rad/s). */
  invertRate: number;
  /** Rotation rate multiplier with the handle fully out. */
  handleOutRotation: number;
  /** Fraction of upward velocity lost when a spin starts before the peak. */
  earlySpinPenalty: number;
  /** Cut angle at takeoff above which an invert goes on the roll axis (rad). */
  rollAxisCut: number;
  /** Grab must be held this long to count (s). */
  minGrabTime: number;
  /** Raley body swing rate (1/s) out and back. */
  raleyRate: number;
  /** Ballistic time to stay airborne before tricks count (s). */
  minAirTime: number;
}

export interface LandingConfig {
  /** Board-to-travel misalignment that catches an edge (rad, mod PI). */
  maxYawError: number;
  /** Edge angle on touchdown that catches an edge (fraction of max). */
  maxEdgeFraction: number;
  /** Rotation residual that is over or under rotation (rad). */
  maxFlipError: number;
  /** Normal impact speed a straight-legged rider can take (m/s). */
  stiffImpact: number;
  /** Extra normal impact speed per unit of leg compression (m/s). */
  absorbImpact: number;
  /** Time spent fallen before respawn (s). */
  fallRecovery: number;
}

export interface JibConfig {
  friction: number;
  /** Balance drift per second per unit of lateral offset. */
  drift: number;
  /** Balance correction per second at full input. */
  correction: number;
  /** Balance kick from board angle off the two stable positions. */
  angleDrift: number;
}

export interface RaleyConfig {
  minEdgeLoad: number;
  minTension: number;
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
  pop: PopConfig;
  air: AirConfig;
  landing: LandingConfig;
  jib: JibConfig;
  raley: RaleyConfig;
  run: RunConfig;
  scoring: ScoringConfig;
}

export const DEFAULT_CONFIG: SimConfig = {
  cable: {
    // Counter-clockwise seen from above: east, then north (-z), west, south.
    towers: [
      { x: 0, z: 0 },
      { x: 240, z: 0 },
      { x: 240, z: -110 },
      { x: 0, z: -110 },
    ],
    cornerRadius: 12,
    cableHeight: 9,
    carrierSpeed: 8.3,
  },
  rope: {
    length: 18,
    stiffness: 8000,
    damping: 900,
    gripLimit: 3200,
    gripTime: 0.3,
    snapRate: 2.5,
  },
  rider: { mass: 80, hipHeight: 1.0, stance: 'regular' },
  hydro: {
    dragCoef: 4.0,
    lateralGrip: 70,
    flatGripFraction: 0.25,
    gripMinSpeed: 2,
    linearDrag: 8,
  },
  edge: {
    maxEdgeAngle: 0.7,
    edgeBuildRate: 1.0,
    edgeReleaseRate: 3.0,
    maxCutAngle: 0.9,
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
  pop: {
    base: 1.0,
    edgeGain: 2.2,
    edgeLoadRef: 1500,
    tensionGain: 1.6,
    tensionRef: 1500,
    maxPop: 5.5,
    extendTime: 0.15,
    lipLead: 0.06,
    lipWindow: 0.25,
    peakMemory: 0.6,
    flatMinLoad: 400,
  },
  air: {
    dragCoef: 0.4,
    spinRate: 8.0,
    invertRate: 7.0,
    handleOutRotation: 0.6,
    earlySpinPenalty: 0.35,
    rollAxisCut: 0.45,
    minGrabTime: 0.15,
    raleyRate: 3.0,
    minAirTime: 0.25,
  },
  landing: {
    maxYawError: 0.5,
    maxEdgeFraction: 0.75,
    maxFlipError: 0.7,
    stiffImpact: 4.0,
    absorbImpact: 4.0,
    fallRecovery: 2.0,
  },
  jib: { friction: 0.08, drift: 1.6, correction: 2.5, angleDrift: 1.2 },
  raley: { minEdgeLoad: 1400, minTension: 1200 },
  run: { passesPerRun: 2, maxFalls: 2, deadWaterTime: 8, respawnSlack: 0.98 },
  scoring: {
    judges: 3,
    weights: { execution: 3.3, intensity: 3.4, composition: 3.3 },
    judgeBias: 0.4,
    seed: 20261013,
  },
};

/** Deep-ish copy with overrides per section, for tests and variants. */
export function makeConfig(overrides: { [K in keyof SimConfig]?: Partial<SimConfig[K]> } = {}): SimConfig {
  const out = structuredClone(DEFAULT_CONFIG);
  for (const key of Object.keys(overrides) as (keyof SimConfig)[]) {
    Object.assign(out[key], overrides[key]);
  }
  return out;
}
