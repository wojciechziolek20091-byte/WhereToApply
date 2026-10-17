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
   * water (spec 4.3: a full-charge plain side ollie clears about 0.55-0.65 m).
   */
  SidePopScale: number;
  /** Nose lift: automatic, and with W held at the pop (within WWindow of the release). */
  AutoNoseLift: number;
  MaxNoseLift: number;
  NoseLiftTime: number;
  WWindow: number;
  /** The nose must pass the edge this far above the top (coping is sharp: + CopingExtraClearance). */
  NoseClearance: number;
  CopingExtraClearance: number;
  /** Availability (spec 3): turn-in toward the feature, distance off its side, feature left, walls. */
  TrackRange: number;
  MinAngle: number;
  MaxAngle: number;
  /** Steeper than this the nose hits the side face head-on (NoseDig). */
  HeadOnAngle: number;
  MinLateral: number;
  MaxLateral: number;
  MinRemaining: number;
  /** A wall more than this above the riding top blocks a slide-on. */
  WallBlock: number;
  /** Climb: share of the inward kinetic energy that lifts the board, and the scrape cost by edge (J/kg). */
  ClimbEfficiency: number;
  EdgeFriction: Record<SideType, number>;
  /** A round side (pipe) starts the climb lower; a thin rail only needs the board's middle over it. */
  RoundTailAllowance: number;
  RailCentreAllowance: number;
  /** Hang-up: with at least this share of the board on top it is a sketchy save. */
  SketchySaveShare: number;
  SketchySaveHit: number;
  /** Overshoot: carried past the far balance limit within this (s); counter-steer bleeds this share per 0.1 s. */
  OvershootWindow: number;
  CounterSteerBleed: number;
  /** Settle: the board snaps flat over this (s); the scrape costs SpeedLoss of the forward speed; the tail clearing pops up ClearPop (m/s). */
  SettleTime: number;
  SpeedLoss: number;
  ClearPop: number;
  /** A/D during the slide-on: yaw correction (rad). */
  YawCorrection: number;
  /** A clean slide-on keeps at least this share of its inward speed (style bonus). */
  CleanInwardShare: number;
  /** Board angle to the axis at contact: sketchy from SketchyAngle, a crash from BadAngle unless near 90. */
  SketchyAngle: number;
  BadAngle: number;
  /** Contact phase sub-steps per sim tick (1/240 s at 4). */
  SubSteps: number;
  /** The calculator's reference approach (spec 4.3: at 8.3 m/s). */
  CalcSpeed: number;
  CalcAngle: number;
}

export const DEFAULT_SLIDE_ON: SlideOnConfig = {
  BoardLength: 1.4,
  BaseWidth: 0.42,
  SidePopScale: 0.537,
  AutoNoseLift: deg(18),
  MaxNoseLift: deg(30),
  NoseLiftTime: 0.12,
  WWindow: 0.25,
  NoseClearance: 0.03,
  CopingExtraClearance: 0.02,
  TrackRange: 20,
  MinAngle: deg(6),
  MaxAngle: deg(32),
  HeadOnAngle: deg(35),
  MinLateral: 0.2,
  MaxLateral: 2.8,
  MinRemaining: 2.0,
  WallBlock: 0.3,
  ClimbEfficiency: 0.85,
  EdgeFriction: { Rounded: 0.15, Coping: 0.1, Round: 0.08, Kanted: 0.12, Rail: 0.05, Bank: 0, Wall: 0 },
  RoundTailAllowance: 0.15,
  RailCentreAllowance: 0.02,
  SketchySaveShare: 0.7,
  SketchySaveHit: 0.6,
  OvershootWindow: 0.4,
  CounterSteerBleed: 0.5,
  SettleTime: 0.08,
  SpeedLoss: 0.06,
  ClearPop: 0.4,
  YawCorrection: deg(5),
  CleanInwardShare: 0.3,
  SketchyAngle: deg(20),
  BadAngle: deg(70),
  SubSteps: 4,
  CalcSpeed: 8.3,
  CalcAngle: deg(20),
};

/** config.ts's GRAVITY (not imported: config.ts imports this file). */
const G = 9.81;

/** Vertical speed of a side-entry pop with this charge (m/s). */
export function sidePopSpeed(charge: number, cfg: SimConfig): number {
  return lerp(cfg.ollie.minV, cfg.ollie.maxV, clamp01(charge)) * cfg.slideOn.SidePopScale;
}

/** Nose clearance over an edge of this type (m). */
export const noseClearance = (type: SideType, cfg: SimConfig): number =>
  cfg.slideOn.NoseClearance + (type === 'Coping' ? cfg.slideOn.CopingExtraClearance : 0);

/**
 * Highest top above the water a side entry can reach (spec 4.3), at
 * `speed` and turn-in `angle` (defaults: the reference approach).
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
): number {
  const S = cfg.slideOn;
  const vy = sidePopSpeed(charge, cfg);
  const peak = (vy * vy) / (2 * G);
  if (noseLift <= 0) return peak - cfg.featureRide.Entry.Clearance;
  if (type === 'Rail') return peak + S.RailCentreAllowance;
  const nose = peak + (S.BoardLength / 2) * sin(noseLift) - noseClearance(type, cfg);
  const vin = speed * sin(angle);
  const budget = 0.5 * vin * vin * S.ClimbEfficiency - S.EdgeFriction[type];
  const climb = peak + budget / G + (type === 'Round' ? S.RoundTailAllowance : 0);
  return Math.min(nose, climb);
}
