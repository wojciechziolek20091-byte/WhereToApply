/**
 * The wake park feature catalogue (features spec section 2): every feature
 * type's default dimensions and gameplay metadata, as plain data. Metres and
 * degrees. `featureShapes.ts` turns an entry (plus overrides) into the ride
 * surfaces the sim rides; the Roblox FeatureBuilder builds the same surfaces
 * as parts. roblox/src/shared/Sim/FeatureCatalog.luau is generated from this
 * file by scripts/gen-luau-data.ts.
 *
 * Lengths of safeties and kickers are measured from the waterline ("L x W x H
 * above water"); each entry ramp also runs `submerged` metres under the water
 * before that, on the same slope, so the board rides up without a step.
 */
import { sin } from './math/detmath';

/** FeatureType attribute values (spec section 4.1). */
export type FeatureType =
  | 'Kicker'
  | 'Slider'
  | 'Funbox'
  | 'GapBox'
  | 'PipeRail'
  | 'FlatRail'
  | 'KinkRail'
  | 'Rooftop'
  | 'StepUp'
  | 'Transfer'
  | 'WallRide'
  | 'Pyramid'
  | 'Spine';

export type SurfaceMaterial = 'HDPE' | 'Pipe' | 'Skatelite';
export type SafetyMode = 'Flush' | 'Gap' | 'None';
/** Look of a slide surface: a flat box top, a flat rail, or a round pipe. */
export type SurfaceStyle = 'Box' | 'Rail' | 'Pipe';

/** One straight piece of a kinked main: its length along the slope and its pitch (deg, + up). */
export interface KinkDef {
  length: number;
  angle: number;
}

export interface KickerParams {
  shape: 'kicker';
  length: number;
  width: number;
  lipHeight: number;
  /** Ramp angle at the lip (deg). */
  lipAngle: number;
}

/**
 * Boxes and rails: a straight safety from under the water up to the main,
 * then one or more mains (each a list of kinks), optionally an exit ramp
 * back down to the water. Mains after the first are separate pieces with a
 * water gap before them (step-ups); the safety may also end in a gap.
 */
export interface BoxParams {
  shape: 'box';
  style: SurfaceStyle;
  /** Main top width; for pipes the pipe diameter. */
  width: number;
  safetyMode: SafetyMode;
  /** Safety length from the waterline to its top (m). 0 = from `safetyAngle`. */
  safetyLength: number;
  /** Safety slope when `safetyLength` is 0 (deg). */
  safetyAngle: number;
  /** Height the safety reaches; 0 = the main's start height (flush). */
  safetyTop: number;
  safetyWidth: number;
  /** Water gap between the safety and the first main (m). */
  gap: number;
  /** Mains in order: each starts at `height`, then follows its kinks. */
  mains: { height: number; gapBefore: number; kinks: KinkDef[] }[];
  /** Exit ramp length from the last main's end down to the water (m); 0 = none. */
  exitLength: number;
}

/** Two boxes side by side; the safety leads onto A, riders transfer to B. */
export interface TransferParams {
  shape: 'transfer';
  width: number;
  length: number;
  height: number;
  /** Clear water between the boxes where B starts (m). */
  apart: number;
  /** B angles away from A by this much (deg). */
  splay: number;
  /** B starts this far after A (m). */
  stagger: number;
  safetyAngle: number;
  safetyWidth: number;
}

/** A near-vertical wall along the travel direction with a curved transition out of the water. */
export interface WallParams {
  shape: 'wall';
  /** Face length along the travel direction (the "4 m wide"). */
  length: number;
  height: number;
  /** Wall angle from horizontal at the top (deg). */
  angle: number;
  /** Transition radius (m). */
  radius: number;
  /** Depth of the transition's bottom under the water (m). */
  depth: number;
  /** Clear water from the feature's axis to where the transition starts (m). */
  standoff: number;
}

/** Four-sided frustum: ramps up each face to a flat top. Ridden along its axis either way. */
export interface PyramidParams {
  shape: 'pyramid';
  base: number;
  top: number;
  height: number;
}

/** Two kickers back to back: a launch ramp up to the peak, a landing ramp down. */
export interface SpineParams {
  shape: 'spine';
  rampLength: number;
  width: number;
  peak: number;
  lipAngle: number;
}

export type ShapeParams = KickerParams | BoxParams | TransferParams | WallParams | PyramidParams | SpineParams;

export interface FeatureMeta {
  type: FeatureType;
  /** Display name. */
  label: string;
  /** 1 green, 2 blue, 3 black, 4 double black. */
  difficulty: 1 | 2 | 3 | 4;
  material: SurfaceMaterial;
  /** CSV of slides scored on it (spec 4.1). */
  allowedSlides: string;
  bidirectional: boolean;
  /** CollectionService category tag (`Kicker` or `Obstacle`). */
  tag: 'Kicker' | 'Obstacle';
  /** Map / minimap icon. */
  icon: 'kicker' | 'box' | 'rail' | 'kink' | 'wall' | 'air';
}

export interface CatalogEntry {
  meta: FeatureMeta;
  params: ShapeParams;
}

/** Shared numbers (spec sections 1, 4). */
export const CATALOG_COMMON = {
  /** Entry ramps start this far under the waterline (m). */
  submerged: 0.25,
  /** Slide friction by material (spec 4.1). Ramps use the sim's `feature.rampFriction`. */
  friction: { HDPE: 0.06, Pipe: 0.05, Skatelite: 0.12 } as Record<SurfaceMaterial, number>,
  /** ScoreMultiplier by difficulty. */
  scoreMultiplier: [1.0, 1.2, 1.4, 1.6],
  /** Pipe rail diameter (m). */
  pipeDiameter: 0.25,
};

const ALL_SLIDES = 'FiftyFifty,Backboard,Frontboard,SwitchFiftyFifty';

const box = (p: Partial<BoxParams> & Pick<BoxParams, 'style' | 'width' | 'mains'>): BoxParams => ({
  shape: 'box',
  safetyMode: 'Flush',
  safetyLength: 0,
  safetyAngle: 17,
  safetyTop: 0,
  safetyWidth: Math.max(p.width, 0.6),
  gap: 0,
  exitLength: 0,
  ...p,
});

/** The 15 catalogue features (spec section 2), keyed by catalogue name. */
export const FEATURE_CATALOG: Record<string, CatalogEntry> = {
  BeginnerKicker: {
    meta: { type: 'Kicker', label: 'Beginner kicker', difficulty: 1, material: 'HDPE', allowedSlides: '', bidirectional: false, tag: 'Kicker', icon: 'kicker' },
    params: { shape: 'kicker', length: 5, width: 3, lipHeight: 0.6, lipAngle: 18 },
  },
  MediumKicker: {
    meta: { type: 'Kicker', label: 'Medium kicker', difficulty: 2, material: 'HDPE', allowedSlides: '', bidirectional: false, tag: 'Kicker', icon: 'kicker' },
    params: { shape: 'kicker', length: 7, width: 3, lipHeight: 1.2, lipAngle: 25 },
  },
  ProKicker: {
    meta: { type: 'Kicker', label: 'Pro kicker', difficulty: 4, material: 'HDPE', allowedSlides: '', bidirectional: false, tag: 'Kicker', icon: 'kicker' },
    params: { shape: 'kicker', length: 9, width: 3.5, lipHeight: 1.9, lipAngle: 32 },
  },
  Slider: {
    meta: { type: 'Slider', label: 'Slider', difficulty: 1, material: 'HDPE', allowedSlides: ALL_SLIDES, bidirectional: true, tag: 'Obstacle', icon: 'box' },
    params: box({ style: 'Box', width: 1.2, mains: [{ height: 0.3, gapBefore: 0, kinks: [{ length: 8, angle: 0 }] }] }),
  },
  Funbox: {
    meta: { type: 'Funbox', label: 'Funbox', difficulty: 2, material: 'HDPE', allowedSlides: ALL_SLIDES, bidirectional: false, tag: 'Obstacle', icon: 'box' },
    params: box({ style: 'Box', width: 1.5, safetyLength: 3, exitLength: 3, mains: [{ height: 1.0, gapBefore: 0, kinks: [{ length: 6, angle: 0 }] }] }),
  },
  GapBox: {
    meta: { type: 'GapBox', label: 'Gap box', difficulty: 3, material: 'HDPE', allowedSlides: ALL_SLIDES, bidirectional: false, tag: 'Obstacle', icon: 'box' },
    params: box({
      style: 'Box', width: 1.0, safetyMode: 'Gap', safetyLength: 3, safetyTop: 0.9, safetyWidth: 1.2, gap: 1.2,
      mains: [{ height: 0.8, gapBefore: 0, kinks: [{ length: 6, angle: 0 }] }],
    }),
  },
  PipeRail: {
    meta: { type: 'PipeRail', label: 'Pipe rail', difficulty: 2, material: 'Pipe', allowedSlides: ALL_SLIDES, bidirectional: false, tag: 'Obstacle', icon: 'rail' },
    params: box({ style: 'Pipe', width: 0.25, mains: [{ height: 0.6, gapBefore: 0, kinks: [{ length: 10, angle: 0 }] }] }),
  },
  FlatRail: {
    meta: { type: 'FlatRail', label: 'Flat rail', difficulty: 2, material: 'HDPE', allowedSlides: ALL_SLIDES, bidirectional: false, tag: 'Obstacle', icon: 'rail' },
    params: box({ style: 'Rail', width: 0.25, mains: [{ height: 0.7, gapBefore: 0, kinks: [{ length: 10, angle: 0 }] }] }),
  },
  KinkRail: {
    meta: { type: 'KinkRail', label: 'Flat-down rail', difficulty: 3, material: 'HDPE', allowedSlides: ALL_SLIDES, bidirectional: false, tag: 'Obstacle', icon: 'kink' },
    params: box({ style: 'Rail', width: 0.3, mains: [{ height: 1.0, gapBefore: 0, kinks: [{ length: 5, angle: 0 }, { length: 5, angle: -12 }] }] }),
  },
  Rooftop: {
    meta: { type: 'Rooftop', label: 'Rooftop', difficulty: 3, material: 'HDPE', allowedSlides: ALL_SLIDES, bidirectional: false, tag: 'Obstacle', icon: 'kink' },
    params: box({
      style: 'Box', width: 0.8,
      // Up 4 m at 15 deg, flat 2 m at 1.2 m, down 4 m at -15 deg: starts at 1.2 - 4 sin 15.
      mains: [{ height: 1.2 - 4 * sin((15 * Math.PI) / 180), gapBefore: 0, kinks: [{ length: 4, angle: 15 }, { length: 2, angle: 0 }, { length: 4, angle: -15 }] }],
    }),
  },
  StepUp: {
    meta: { type: 'StepUp', label: 'Step-up rail', difficulty: 4, material: 'HDPE', allowedSlides: ALL_SLIDES, bidirectional: false, tag: 'Obstacle', icon: 'rail' },
    params: box({
      style: 'Rail', width: 0.3,
      mains: [
        { height: 0.5, gapBefore: 0, kinks: [{ length: 4, angle: 0 }] },
        { height: 1.0, gapBefore: 0.8, kinks: [{ length: 5, angle: 0 }] },
      ],
    }),
  },
  Transfer: {
    meta: { type: 'Transfer', label: 'Transfer box', difficulty: 3, material: 'HDPE', allowedSlides: ALL_SLIDES, bidirectional: false, tag: 'Obstacle', icon: 'box' },
    params: { shape: 'transfer', width: 0.9, length: 6, height: 0.6, apart: 0.8, splay: 10, stagger: 2, safetyAngle: 17, safetyWidth: 1.0 },
  },
  WallRide: {
    meta: { type: 'WallRide', label: 'Wall ride', difficulty: 3, material: 'Skatelite', allowedSlides: 'WallRide', bidirectional: false, tag: 'Obstacle', icon: 'wall' },
    params: { shape: 'wall', length: 4, height: 3, angle: 78, radius: 2, depth: 0.15, standoff: 0.5 },
  },
  Pyramid: {
    meta: { type: 'Pyramid', label: 'Pyramid', difficulty: 2, material: 'HDPE', allowedSlides: ALL_SLIDES, bidirectional: true, tag: 'Kicker', icon: 'air' },
    params: { shape: 'pyramid', base: 8, top: 2, height: 1.3 },
  },
  Spine: {
    meta: { type: 'Spine', label: 'Spine', difficulty: 3, material: 'HDPE', allowedSlides: '', bidirectional: false, tag: 'Kicker', icon: 'air' },
    params: { shape: 'spine', rampLength: 5, width: 3, peak: 1.4, lipAngle: 30 },
  },
};

export type CatalogName = keyof typeof FEATURE_CATALOG;
