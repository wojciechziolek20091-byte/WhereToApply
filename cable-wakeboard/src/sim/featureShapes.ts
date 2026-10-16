import { cos, pow, sin, tan } from './math/detmath';
import { type Vec3, addScaled, normalize, UP, vec3 } from './math/vec';
import {
  type BoxParams,
  CATALOG_COMMON,
  type CatalogEntry,
  FEATURE_CATALOG,
  type FeatureMeta,
  type KickerParams,
  type PyramidParams,
  type SafetyMode,
  type ShapeParams,
  type SpineParams,
  type SurfaceMaterial,
  type TransferParams,
  type WallParams,
} from './featureCatalog';

/**
 * Ride surfaces of a feature (features spec section 4.2), in the feature's
 * frame: u along its axis from its start, v to its right, heights above the
 * water. A feature is a list of pieces; each kink of a rail is its own piece,
 * and consecutive pieces share their joint exactly. The sim rides these; the
 * Roblox FeatureBuilder builds a `Ride/` part per piece from the same numbers.
 */

/** SurfaceRole attribute values. */
export type SurfaceRole = 'Safety' | 'Main' | 'ExitRamp' | 'Ramp' | 'Lip' | 'Transition' | 'Wall' | 'LandingRamp';

/** Cross-section of a wall ride (axis 'v' pieces): a circular transition from under the water, then a straight wall. */
export interface WallProfile {
  /** +1: the wall rises toward +v (right of the axis); -1 toward -v. */
  side: number;
  /** v where the transition's bottom is. */
  base: number;
  radius: number;
  /** Wall angle from horizontal (rad). */
  angle: number;
  depth: number;
  /** Height of the wall's top edge. */
  top: number;
}

export interface RidePiece {
  role: SurfaceRole;
  /** SegmentIndex: order along the feature. */
  index: number;
  /** Pieces of one rideable part (a main with its kinks and exit) share this. */
  part: number;
  /** 'u': height varies along the axis. 'v': across it (wall rides). */
  axis: 'u' | 'v';
  u0: number;
  u1: number;
  h0: number;
  h1: number;
  /**
   * Power-curve exponent for kicker-style transitions, flat at the low end
   * and steepest at the high end. 0 = a straight piece.
   */
  power: number;
  /** Centre line across the axis at u0 and u1 (splayed boxes). */
  v0: number;
  v1: number;
  width: number;
  profile: 'Flat' | 'Round';
  /** Pipe radius, coping radius on boxes, transition radius on walls. */
  radius: number;
  /** Slideable (mains, exit ramps) rather than ridden like a ramp. */
  slide: boolean;
  /** Riding off its high end launches the rider. */
  lip: boolean;
  /** Includes u = u1 (no piece starts there). */
  closed: boolean;
  /** Frustum side faces (pyramids): height is capped by the face across the axis. */
  cap: { half: number; halfTop: number; top: number; bottom: number } | null;
  /** Wall ride cross-section, for axis 'v' pieces: this piece covers d0..d1 out from the base. */
  wall: (WallProfile & { d0: number; d1: number }) | null;
}

export interface FeatureShape {
  type: string;
  pieces: RidePiece[];
  /** Footprint bounds in the feature frame. */
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  safetyMode: SafetyMode;
  material: SurfaceMaterial;
  /** Slide friction coefficient, or null for the sim's default (`feature.friction`). */
  friction: number | null;
  bidirectional: boolean;
  /** Legacy shapes (`kicker` / `slider` defs) ride exactly as before. */
  legacy: boolean;
}

/** Surface under a point of a shape. */
export interface ShapeSurface {
  piece: RidePiece;
  height: number;
  /** dh/du along the axis (0 on walls and pyramid side faces). */
  slope: number;
  /** dh/d(distance across) on walls and pyramid side faces. */
  crossSlope: number;
  normal: Vec3;
  /** Unit tangent along the piece, in the feature frame (x = u, z = v). */
  tangent: Vec3;
}

const piece = (p: Partial<RidePiece> & Pick<RidePiece, 'role' | 'u0' | 'u1' | 'h0' | 'h1' | 'width'>): RidePiece => ({
  index: 0,
  part: 0,
  axis: 'u',
  power: 0,
  v0: 0,
  v1: 0,
  profile: 'Flat',
  radius: 0.04,
  slide: false,
  lip: false,
  closed: false,
  cap: null,
  wall: null,
  ...p,
});

const rad = (d: number): number => (d * Math.PI) / 180;

/** Kicker exponent so the slope at the top equals tan(angle) over `rise` and `len`. */
export const powerFor = (angle: number, len: number, rise: number): number => Math.max(1, (tan(angle) * len) / rise);

function kickerPieces(k: KickerParams, d: number): RidePiece[] {
  return [
    piece({
      role: 'Ramp', u0: 0, u1: k.length, h0: -d, h1: k.lipHeight, width: k.width,
      power: powerFor(rad(k.lipAngle), k.length, k.lipHeight + d), lip: true,
    }),
  ];
}

function boxPieces(b: BoxParams, d: number): RidePiece[] {
  const out: RidePiece[] = [];
  const first = b.mains[0]!;
  const top = b.safetyTop > 0 ? b.safetyTop : first.height;
  const run = b.safetyLength > 0 ? b.safetyLength : top / tan(rad(b.safetyAngle));
  const ext = (d * run) / top;
  let u = ext + run;
  out.push(piece({ role: 'Safety', u0: 0, u1: u, h0: -d, h1: top, width: b.safetyWidth }));
  u += b.gap;
  const round = b.style === 'Pipe';
  let h = 0;
  b.mains.forEach((m, k) => {
    u += m.gapBefore;
    h = m.height;
    for (const kink of m.kinks) {
      const a = rad(kink.angle);
      const du = kink.length * cos(a);
      const dh = kink.length * sin(a);
      out.push(piece({
        role: 'Main', u0: u, u1: u + du, h0: h, h1: h + dh, width: b.width, part: k + 1, slide: true,
        profile: round ? 'Round' : 'Flat', radius: round ? b.width / 2 : 0.04,
      }));
      u += du;
      h += dh;
    }
  });
  if (b.exitLength > 0) {
    const ext2 = (d * b.exitLength) / h;
    out.push(piece({ role: 'ExitRamp', u0: u, u1: u + b.exitLength + ext2, h0: h, h1: -d, width: b.width, part: b.mains.length, slide: true }));
  }
  return out;
}

function transferPieces(t: TransferParams & { side: number }, d: number): RidePiece[] {
  const run = t.height / tan(rad(t.safetyAngle));
  const ext = (d * run) / t.height;
  const a0 = ext + run;
  const b0 = a0 + t.stagger;
  const vb = t.side * (t.width + t.apart);
  const s = rad(t.splay);
  return [
    piece({ role: 'Safety', u0: 0, u1: a0, h0: -d, h1: t.height, width: t.safetyWidth }),
    piece({ role: 'Main', u0: a0, u1: a0 + t.length, h0: t.height, h1: t.height, width: t.width, part: 1, slide: true }),
    piece({
      role: 'Main', u0: b0, u1: b0 + t.length * cos(s), h0: t.height, h1: t.height, width: t.width, part: 2, slide: true,
      v0: vb, v1: vb + t.side * t.length * sin(s),
    }),
  ];
}

/** Wall ride cross-section: height at distance `x` out from the transition's bottom, and dh/dx. */
export function wallHeightAt(w: WallProfile, x: number): { height: number; slope: number } {
  const dw = w.radius * sin(w.angle);
  if (x <= dw) {
    const r = Math.sqrt(Math.max(w.radius * w.radius - x * x, 1e-9));
    return { height: -w.depth + w.radius - r, slope: x / r };
  }
  const hw = -w.depth + w.radius * (1 - cos(w.angle));
  const t = tan(w.angle);
  return { height: hw + (x - dw) * t, slope: t };
}

function wallPieces(p: WallParams & { side: number }): RidePiece[] {
  const angle = rad(p.angle);
  const profile: WallProfile = { side: p.side, base: p.side * p.standoff, radius: p.radius, angle, depth: p.depth, top: p.height };
  const dw = p.radius * sin(angle);
  const hw = -p.depth + p.radius * (1 - cos(angle));
  const dTop = dw + (p.height - hw) / tan(angle);
  const common = { axis: 'v' as const, u0: 0, u1: p.length, width: p.length, slide: true, radius: p.radius };
  return [
    piece({ ...common, role: 'Transition', h0: -p.depth, h1: hw, wall: { ...profile, d0: 0, d1: dw } }),
    piece({ ...common, role: 'Wall', h0: hw, h1: p.height, part: 0, radius: 0.04, wall: { ...profile, d0: dw, d1: dTop } }),
  ];
}

function pyramidPieces(p: PyramidParams, d: number): RidePiece[] {
  const run = (p.base - p.top) / 2;
  const ext = (d * run) / p.height;
  const half = p.base / 2 + ext;
  const cap = { half, halfTop: p.top / 2, top: p.height, bottom: -d };
  const w = 2 * half;
  const a = ext + run;
  return [
    piece({ role: 'Ramp', u0: 0, u1: a, h0: -d, h1: p.height, width: w, cap, lip: true }),
    piece({ role: 'Main', u0: a, u1: a + p.top, h0: p.height, h1: p.height, width: w, cap, part: 1, slide: true }),
    piece({ role: 'LandingRamp', u0: a + p.top, u1: 2 * a + p.top, h0: p.height, h1: -d, width: w, cap, part: 2 }),
  ];
}

function spinePieces(p: SpineParams, d: number): RidePiece[] {
  const power = powerFor(rad(p.lipAngle), p.rampLength, p.peak + d);
  return [
    piece({ role: 'Ramp', u0: 0, u1: p.rampLength, h0: -d, h1: p.peak, width: p.width, power, lip: true }),
    piece({ role: 'LandingRamp', u0: p.rampLength, u1: 2 * p.rampLength, h0: p.peak, h1: -d, width: p.width, power, part: 1 }),
  ];
}

function finish(type: string, pieces: RidePiece[], meta: Pick<FeatureMeta, 'material' | 'bidirectional'>, safetyMode: SafetyMode, legacy: boolean): FeatureShape {
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  pieces.forEach((p, i) => {
    p.index = i + 1;
    p.closed = !pieces.some((q) => q !== p && q.axis === p.axis && q.u0 === p.u1);
    uMin = Math.min(uMin, p.u0);
    uMax = Math.max(uMax, p.u1);
    if (p.wall) {
      const a = p.wall.base + p.wall.side * p.wall.d0;
      const b = p.wall.base + p.wall.side * p.wall.d1;
      vMin = Math.min(vMin, a, b);
      vMax = Math.max(vMax, a, b);
    } else {
      vMin = Math.min(vMin, p.v0 - p.width / 2, p.v1 - p.width / 2);
      vMax = Math.max(vMax, p.v0 + p.width / 2, p.v1 + p.width / 2);
    }
  });
  return {
    type,
    pieces,
    uMin,
    uMax,
    vMin,
    vMax,
    safetyMode,
    material: meta.material,
    friction: legacy ? null : CATALOG_COMMON.friction[meta.material],
    bidirectional: meta.bidirectional,
    legacy,
  };
}

/** Catalogue params with overrides merged in (one level deep; `mains` replaces). */
export function catalogParams(name: string, overrides: Partial<ShapeParams> = {}): { entry: CatalogEntry; params: ShapeParams } {
  const entry = FEATURE_CATALOG[name];
  if (!entry) throw new Error(`unknown catalogue feature ${name}`);
  return { entry, params: { ...entry.params, ...overrides } as ShapeParams };
}

/**
 * Ride pieces of a catalogue feature. `side` (+1 right, -1 left) picks which
 * side a transfer's second box or a wall ride's wall is on.
 */
export function buildShape(name: string, overrides: Partial<ShapeParams> = {}, side = 1): FeatureShape {
  const { entry, params } = catalogParams(name, overrides);
  const d = CATALOG_COMMON.submerged;
  let pieces: RidePiece[];
  let safety: SafetyMode = 'None';
  switch (params.shape) {
    case 'kicker':
      pieces = kickerPieces(params, d);
      break;
    case 'box':
      pieces = boxPieces(params, d);
      safety = params.safetyMode;
      break;
    case 'transfer':
      pieces = transferPieces({ ...params, side }, d);
      safety = 'Flush';
      break;
    case 'wall':
      pieces = wallPieces({ ...params, side });
      break;
    case 'pyramid':
      pieces = pyramidPieces(params, d);
      break;
    case 'spine':
      pieces = spinePieces(params, d);
      break;
  }
  return finish(entry.meta.type, pieces, entry.meta, safety, false);
}

/** The old `kicker` / `slider` defs as pieces: same numbers, same formulas. */
export function legacyShape(def: { kind: 'kicker'; length: number; width: number; height: number; lipAngle: number } | { kind: 'slider'; style: string; length: number; width: number; height: number; entryLength: number; safety: 'flush' | 'gap' }): FeatureShape {
  if (def.kind === 'kicker') {
    const p = piece({ role: 'Ramp', u0: 0, u1: def.length, h0: 0, h1: def.height, width: def.width, power: powerFor(def.lipAngle, def.length, def.height), lip: true });
    return finish('Kicker', [p], { material: 'HDPE', bidirectional: false }, 'None', true);
  }
  const round = def.style === 'tube';
  const pieces = [
    piece({ role: 'Safety', u0: 0, u1: def.entryLength, h0: 0, h1: def.height, width: def.width }),
    piece({
      role: 'Main', u0: def.entryLength, u1: def.entryLength + def.length, h0: def.height, h1: def.height, width: def.width, part: 1, slide: true,
      profile: round ? 'Round' : 'Flat', radius: round ? def.width / 2 : 0.04,
    }),
  ];
  const type = def.style === 'box' ? 'Slider' : def.style === 'tube' ? 'PipeRail' : 'FlatRail';
  return finish(type, pieces, { material: round ? 'Pipe' : 'HDPE', bidirectional: false }, def.safety === 'gap' ? 'Gap' : 'Flush', true);
}

/** Centre line of a piece across the axis at `u`. */
export const pieceCentre = (p: RidePiece, u: number): number => p.v0 + (p.v1 - p.v0) * ((u - p.u0) / (p.u1 - p.u0));

/** Height and dh/du of an axis-'u' piece along its centre line. */
export function pieceHeightAt(p: RidePiece, u: number): { height: number; slope: number } {
  const len = p.u1 - p.u0;
  if (p.power > 0) {
    const x = Math.min(Math.max((u - p.u0) / len, 0), 1);
    if (p.h1 >= p.h0) {
      const rise = p.h1 - p.h0;
      return { height: p.h0 + rise * pow(x, p.power), slope: ((rise * p.power) / len) * pow(x, p.power - 1) };
    }
    const drop = p.h0 - p.h1;
    const w = 1 - x;
    return { height: p.h1 + drop * pow(w, p.power), slope: -((drop * p.power) / len) * pow(w, p.power - 1) };
  }
  const slope = (p.h1 - p.h0) / len;
  return { height: p.h0 + slope * (Math.min(Math.max(u, p.u0), p.u1) - p.u0), slope };
}

function inPiece(p: RidePiece, u: number, v: number): boolean {
  if (u < p.u0 || u > p.u1 || (u === p.u1 && !p.closed)) return false;
  if (p.wall) {
    const x = (v - p.wall.base) * p.wall.side;
    return x >= p.wall.d0 && (x < p.wall.d1 || (x === p.wall.d1 && p.role === 'Wall'));
  }
  return Math.abs(v - pieceCentre(p, u)) <= p.width / 2;
}

function surfaceOf(p: RidePiece, u: number, v: number): ShapeSurface {
  if (p.wall) {
    const x = (v - p.wall.base) * p.wall.side;
    const w = wallHeightAt(p.wall, x);
    // Normal leans away from the wall: up, and back toward -side across the axis.
    const normal = normalize(vec3(0, 1, -p.wall.side * w.slope));
    return { piece: p, height: w.height, slope: 0, crossSlope: w.slope, normal, tangent: vec3(1, 0, 0) };
  }
  const along = pieceHeightAt(p, u);
  const k = (p.v1 - p.v0) / (p.u1 - p.u0);
  if (p.cap) {
    const dv = Math.abs(v - pieceCentre(p, u));
    const fall = (p.cap.top - p.cap.bottom) / (p.cap.half - p.cap.halfTop);
    const side = dv <= p.cap.halfTop ? p.cap.top : p.cap.top - (dv - p.cap.halfTop) * fall;
    if (side < along.height) {
      const sgn = v >= pieceCentre(p, u) ? 1 : -1;
      return { piece: p, height: side, slope: 0, crossSlope: -fall, normal: normalize(vec3(0, 1, sgn * fall)), tangent: vec3(1, 0, 0) };
    }
  }
  const fwd = vec3(1, 0, k);
  return {
    piece: p,
    height: along.height,
    slope: along.slope,
    crossSlope: 0,
    normal: normalize(addScaled(UP, vec3(1, 0, 0), -along.slope)),
    tangent: normalize(addScaled(fwd, UP, along.slope)),
  };
}

/**
 * Highest ride surface of a shape at (u, v), or null off every piece. At a
 * joint the later piece wins, so a box's main starts exactly where its
 * safety ends.
 */
export function shapeSurfaceAt(shape: FeatureShape, u: number, v: number): ShapeSurface | null {
  if (u < shape.uMin || u > shape.uMax || v < shape.vMin || v > shape.vMax) return null;
  let best: ShapeSurface | null = null;
  for (const p of shape.pieces) {
    if (!inPiece(p, u, v)) continue;
    const s = surfaceOf(p, u, v);
    if (!best || s.height > best.height) best = s;
  }
  return best;
}
