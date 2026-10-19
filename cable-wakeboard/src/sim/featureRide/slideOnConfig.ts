import type { SimConfig } from '../config';
import { sin } from '../math/detmath';
import { clamp01, lerp } from '../math/scalar';

/**
 * SlideOnConfig (side approaches re-imagined, spec section 4): every number of
 * the nose-lift slide-on, and the reachable-height calculator. Part of the
 * sim config (`DEFAULT_CONFIG.slideOn`), generated into Config.luau
 * (`FeatureRideSlideOnConfig.luau` re-exports it with the calculator). Angles
 * in radians, lengths in m, speeds in m/s.
 */
const deg = (d: number): number => (d * Math.PI) / 180;

/** Edge of a feature's top the board slides on over (derived from the ride data; see sideTypeOf). */
export type SideType = 'Rounded' | 'Coping' | 'Round' | 'Kanted' | 'Rail' | 'Bank' | 'Wall';

export interface SlideOnConfig {
  /** Board as a line from tail to nose. */
  BoardLength: number;
  BaseWidth: number;
  /**
   * Vertical pop of a side-entry ollie as a share of the game's ollie speed:
   * edging alongside a feature, the rider cannot load the board like on open
   * water (side approach v2 spec 5: a full-charge, flat-board side ollie clears
   * about 0.70 m).
   */
  SidePopScale: number;
  /**
   * Edge to pop (v2 spec 1.1): the edge held into the pop loads it. Edge load
   * = edge (0..1 of the most, carving toward the feature) x tension / EdgeTensionRef
   * clamped to EdgeTensionMin..EdgeTensionMax; it adds EdgePopBonus x load
   * upward and EdgeReleaseBonus x load toward the feature (m/s).
   */
  EdgePopBonus: number;
  EdgeReleaseBonus: number;
  EdgeTensionRef: number;
  EdgeTensionMin: number;
  EdgeTensionMax: number;
  /** Nose lift: automatic, and with W held at the pop (within WWindow of the release). */
  AutoNoseLift: number;
  MaxNoseLift: number;
  NoseLiftTime: number;
  WWindow: number;
  /** A clean nose-over passes the edge this far above the top (coping is sharp: + CopingExtraClearance). */
  NoseClearance: number;
  CopingExtraClearance: number;
  /**
   * The nose may be this far below the top at the edge (by edge type): the
   * rounded edge lifts it the rest of the way. Up to ScrapeBand further down
   * it scrapes up (ScrapeSpeedLoss; sketchy past half the band). Lower still,
   * the nose digs in, unless the board still has the energy to climb the face
   * (just popped and rising): then it scrapes up too.
   */
  NoseTolerance: Record<SideType, number>;
  ScrapeBand: number;
  ScrapeSpeedLoss: number;
  /** Availability (v2 spec 2): turn-in toward the feature, distance off its side, feature left, walls. */
  TrackRange: number;
  MinAngle: number;
  MaxAngle: number;
  MinLateral: number;
  MaxLateral: number;
  MinRemaining: number;
  /** A wall more than this above the riding top blocks a slide-on. */
  WallBlock: number;
  /** Flat tops narrower than this are thin rails (no side face to climb). */
  RailMaxWidth: number;
  /** Climb: share of the inward kinetic energy that lifts the board, the rope's help, and the scrape cost by edge (J/kg). */
  ClimbEfficiency: number;
  RopeAssistScale: number;
  EdgeFriction: Record<SideType, number>;
  /** A round side (pipe) starts the climb lower; a thin rail only needs the board's middle over it. */
  RoundTailAllowance: number;
  RailCentreAllowance: number;
  /**
   * Hang-up: only below HangUpSpeed inward with the board's middle more than
   * HangUpDrop under the top (closer, it finishes the climb). With
   * SketchySaveShare of the board on top it is a save (balance hit
   * SketchySaveHit), else the board drops back into the water beside it.
   */
  HangUpSpeed: number;
  HangUpDrop: number;
  SketchySaveShare: number;
  SketchySaveHit: number;
  /** Getting on from the side, the legs absorb this much of the inward speed (m/s); the rest carries on across. A landing from the air (an air-on) absorbs LandingCarryAbsorb. */
  CarryAbsorb: number;
  LandingCarryAbsorb: number;
  /** Past the far balance limit within this (s) the board slides off the far side; counter-steer bleeds this share per 0.1 s. */
  OvershootWindow: number;
  CounterSteerBleed: number;
  /** After the slide-on the base slides sideways and bites: the inward speed bleeds at this x g (m/s^2 per g). */
  InwardFriction: number;
  /** On a round top (pipe) the base wraps it: the inward speed bleeds at this x g instead. */
  RoundInwardFriction: number;
  /** Settle: the board snaps flat over this (s); the scrape costs SpeedLoss of the forward speed; the tail clearing pops up ClearPop (m/s). */
  SettleTime: number;
  SpeedLoss: number;
  ClearPop: number;
  /** A/D during the slide-on: yaw correction (rad). */
  YawCorrection: number;
  /** A clean slide-on keeps at least this share of its inward speed (style bonus). */
  CleanInwardShare: number;
  /**
   * Board angle to the axis at contact (v2 spec 2): up to AlignClean it lines
   * up into a 50-50; to AlignHit it does with a balance hit (AlignHitAmount);
   * from there to 180 - AlignHit it takes the nearest 90 slide (boardslide /
   * lipslide); the same mirrored toward 180 (fakie). Never a crash. Leading
   * with the edge (contact across the board) from EdgeLeadAngle.
   */
  AlignClean: number;
  AlignHit: number;
  AlignHitAmount: number;
  EdgeLeadAngle: number;
  /** Coyote time: charging into the side, the pop goes off on its own at the edge, CoyotePenalty lower. */
  CoyotePenalty: number;
  /** Air-on (a side ollie-on that clears the board): points per second of air. */
  AirOnBonus: number;
  /** Jump-over (v2 spec 3 D): the board passing this close above the top (m) brushes it, a Tap. */
  TapHeight: number;
  /** Contact phase sub-steps per sim tick (1/240 s at 4). */
  SubSteps: number;
  /** The calculator's reference approach (spec 4.3: at 8.3 m/s). */
  CalcSpeed: number;
  CalcAngle: number;
}

export const DEFAULT_SLIDE_ON: SlideOnConfig = {
  BoardLength: 1.4,
  BaseWidth: 0.42,
  SidePopScale: 0.586,
  EdgePopBonus: 0.7,
  EdgeReleaseBonus: 0.8,
  EdgeTensionRef: 1000,
  EdgeTensionMin: 0.3,
  EdgeTensionMax: 1.5,
  AutoNoseLift: deg(18),
  MaxNoseLift: deg(30),
  NoseLiftTime: 0.05,
  WWindow: 0.25,
  NoseClearance: 0.03,
  CopingExtraClearance: 0.02,
  NoseTolerance: { Rounded: 0.12, Coping: 0.08, Round: 0.18, Kanted: 0.18, Rail: 0.04, Bank: 0.3, Wall: 0 },
  ScrapeBand: 0.15,
  ScrapeSpeedLoss: 0.12,
  TrackRange: 20,
  MinAngle: 0,
  MaxAngle: deg(75),
  MinLateral: 0,
  MaxLateral: 4.0,
  MinRemaining: 1.2,
  WallBlock: 0.3,
  RailMaxWidth: 0.35,
  ClimbEfficiency: 0.95,
  RopeAssistScale: 2,
  EdgeFriction: { Rounded: 0.15, Coping: 0.1, Round: 0.08, Kanted: 0.12, Rail: 0.05, Bank: 0, Wall: 0 },
  RoundTailAllowance: 0.15,
  RailCentreAllowance: 0.02,
  HangUpSpeed: 0.5,
  HangUpDrop: 0.25,
  SketchySaveShare: 0.5,
  SketchySaveHit: 0.6,
  CarryAbsorb: 6,
  LandingCarryAbsorb: 9,
  OvershootWindow: 0.4,
  CounterSteerBleed: 0.75,
  InwardFriction: 0.8,
  RoundInwardFriction: 3.0,
  SettleTime: 0.08,
  SpeedLoss: 0.06,
  ClearPop: 0.4,
  YawCorrection: deg(5),
  CleanInwardShare: 0.3,
  AlignClean: deg(35),
  AlignHit: deg(60),
  AlignHitAmount: 0.4,
  EdgeLeadAngle: deg(60),
  CoyotePenalty: 0.05,
  AirOnBonus: 60,
  TapHeight: 0.12,
  SubSteps: 4,
  CalcSpeed: 8.3,
  CalcAngle: deg(20),
};

/** config.ts's GRAVITY (not imported: config.ts imports this file). */
const G = 9.81;

/** Vertical speed of a side-entry pop with this charge and edge load (m/s, v2 spec 1.1). */
export function sidePopSpeed(charge: number, cfg: SimConfig, edgeLoad = 0): number {
  return lerp(cfg.ollie.minV, cfg.ollie.maxV, clamp01(charge)) * cfg.slideOn.SidePopScale + cfg.slideOn.EdgePopBonus * edgeLoad;
}

/** Nose clearance over an edge of this type (m). */
export const noseClearance = (type: SideType, cfg: SimConfig): number =>
  cfg.slideOn.NoseClearance + (type === 'Coping' ? cfg.slideOn.CopingExtraClearance : 0);

/**
 * Highest top above the water a side entry reaches cleanly (v2 spec 5), at
 * `speed`, turn-in `angle` (defaults: the reference approach) and edge load
 * (the edge into the pop; default a flat board). The nose tolerance and the
 * scrape-up reach further (not counted here).
 * - With no nose lift, the whole board has to clear the top by
 *   Entry.Clearance: the plain side ollie.
 * - With a nose lift, the nose has to clear the edge (at the top of the arc
 *   it is half a board times sin(lift) above the board's middle) and the
 *   rider has to climb the rest. The board's middle (the rider's mass) rises
 *   from its height at contact to the top; what it still moves upward
 *   counts, so contact anywhere on the arc gives the same budget as at its
 *   peak. That budget is the inward kinetic energy x ClimbEfficiency minus
 *   the edge's scrape.
 * - A thin rail has no side face: the board's middle has to pass over it.
 * - A round side starts the climb RoundTailAllowance lower.
 */
export function maxReachableHeight(
  cfg: SimConfig,
  charge: number,
  noseLift: number,
  type: SideType = 'Rounded',
  speed = cfg.slideOn.CalcSpeed,
  angle = cfg.slideOn.CalcAngle,
  edgeLoad = 0,
): number {
  const S = cfg.slideOn;
  const vy = sidePopSpeed(charge, cfg, edgeLoad);
  const peak = (vy * vy) / (2 * G);
  if (noseLift <= 0) return peak - cfg.featureRide.Entry.Clearance;
  if (type === 'Rail') return peak + S.RailCentreAllowance;
  const nose = peak + (S.BoardLength / 2) * sin(noseLift) - noseClearance(type, cfg);
  const vin = speed * sin(angle) + S.EdgeReleaseBonus * edgeLoad;
  const budget = 0.5 * vin * vin * S.ClimbEfficiency - S.EdgeFriction[type];
  const climb = peak + budget / G + (type === 'Round' ? S.RoundTailAllowance : 0);
  // A bank never digs the nose in: only the climb counts.
  return type === 'Bank' ? climb : Math.min(nose, climb);
}

/**
 * The slide a side approach lines up into from the board's angle to the
 * axis (v2 spec 2): a 50-50 up to AlignHit (a balance hit past AlignClean),
 * the nearest 90 between, a fakie 50-50 toward 180. Never a crash.
 */
export function alignSlide(yaw: number, cfg: SimConfig): { boardAngle: number; hit: number } {
  const S = cfg.slideOn;
  const a = Math.abs(yaw);
  if (a <= S.AlignHit) return { boardAngle: 0, hit: a > S.AlignClean ? S.AlignHitAmount : 0 };
  if (a >= Math.PI - S.AlignHit) return { boardAngle: Math.PI, hit: a < Math.PI - S.AlignClean ? S.AlignHitAmount : 0 };
  return { boardAngle: yaw >= 0 ? Math.PI / 2 : -Math.PI / 2, hit: 0 };
}
