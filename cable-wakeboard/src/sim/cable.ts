import { tan } from './math/detmath';
import type { CableConfig } from './config';
import { mod, wrapAngle } from './math/scalar';
import { type Vec3, forwardOf, rightOf, scale, vec3, addScaled, sub, normalize, headingOf, length } from './math/vec';

/** A straight run of cable between two tower arcs. */
export interface LineSegment {
  kind: 'line';
  start: Vec3;
  heading: number;
  length: number;
  s0: number;
}

/** The cable wrapping around a tower wheel. */
export interface ArcSegment {
  kind: 'arc';
  center: Vec3;
  radius: number;
  /** Tangent heading at the start of the arc. */
  heading0: number;
  /** +1 turning right (clockwise from above), -1 turning left. */
  turn: 1 | -1;
  length: number;
  s0: number;
}

export type CableSegment = LineSegment | ArcSegment;

export interface CablePath {
  segments: CableSegment[];
  length: number;
  height: number;
}

export interface CablePoint {
  /** Point on the cable, at cable height. */
  pos: Vec3;
  /** Heading of the cable's direction of travel. */
  heading: number;
  /** Index of the segment the point lies on. */
  segment: number;
}

/**
 * Build the closed cable loop: straight lines between towers, joined by arcs
 * of `cornerRadius` around each tower. The arcs cut the corner, so the cable
 * passes inside the tower positions.
 */
export function buildCablePath(cfg: CableConfig): CablePath {
  const n = cfg.towers.length;
  if (n < 3) throw new Error('A closed cable loop needs at least 3 towers');
  const p = cfg.towers.map((t) => vec3(t.x, 0, t.z));
  const at = (i: number): Vec3 => p[mod(i, n)]!;

  interface Corner {
    a: Vec3;
    b: Vec3;
    center: Vec3;
    headingIn: number;
    turn: 1 | -1;
    sweep: number;
  }
  const corners: Corner[] = [];
  for (let i = 0; i < n; i++) {
    const dIn = normalize(sub(at(i), at(i - 1)));
    const dOut = normalize(sub(at(i + 1), at(i)));
    const headingIn = headingOf(dIn);
    const delta = wrapAngle(headingOf(dOut) - headingIn);
    const turn: 1 | -1 = delta >= 0 ? 1 : -1;
    const tangentLen = cfg.cornerRadius * tan(Math.abs(delta) / 2);
    const inLen = length(sub(at(i), at(i - 1)));
    const outLen = length(sub(at(i + 1), at(i)));
    if (tangentLen * 2 > Math.min(inLen, outLen)) {
      throw new Error(`cornerRadius too large for tower ${i}`);
    }
    const a = addScaled(at(i), dIn, -tangentLen);
    const b = addScaled(at(i), dOut, tangentLen);
    const center = addScaled(a, rightOf(headingIn), turn * cfg.cornerRadius);
    corners.push({ a, b, center, headingIn, turn, sweep: Math.abs(delta) });
  }

  const segments: CableSegment[] = [];
  let s = 0;
  // Start on the straight leaving tower 0, so s = 0 is just past its arc.
  for (let i = 0; i < n; i++) {
    const prev = corners[i]!;
    const c = corners[mod(i + 1, n)]!;
    const lineLen = length(sub(c.a, prev.b));
    segments.push({ kind: 'line', start: prev.b, heading: c.headingIn, length: lineLen, s0: s });
    s += lineLen;
    const arcLen = cfg.cornerRadius * c.sweep;
    segments.push({
      kind: 'arc',
      center: c.center,
      radius: cfg.cornerRadius,
      heading0: c.headingIn,
      turn: c.turn,
      length: arcLen,
      s0: s,
    });
    s += arcLen;
  }
  return { segments, length: s, height: cfg.cableHeight };
}

/** Point and heading on the cable at arc length `s` (wraps around the loop). */
export function cablePointAt(path: CablePath, s: number): CablePoint {
  const ss = mod(s, path.length);
  // Few segments: a linear scan is fine and keeps this obviously correct.
  let index = path.segments.length - 1;
  for (let i = 0; i < path.segments.length; i++) {
    const seg = path.segments[i]!;
    if (ss < seg.s0 + seg.length) {
      index = i;
      break;
    }
  }
  const seg = path.segments[index]!;
  const u = Math.min(ss - seg.s0, seg.length);
  if (seg.kind === 'line') {
    const pos = addScaled(seg.start, forwardOf(seg.heading), u);
    return { pos: vec3(pos.x, path.height, pos.z), heading: seg.heading, segment: index };
  }
  const heading = seg.heading0 + (seg.turn * u) / seg.radius;
  const pos = addScaled(seg.center, rightOf(heading), -seg.turn * seg.radius);
  return { pos: vec3(pos.x, path.height, pos.z), heading, segment: index };
}

/** The carrier clamped to the cable. Plain data. */
export interface CarrierState {
  /** Arc length along the loop since the run started (not wrapped). */
  s: number;
  pos: Vec3;
  vel: Vec3;
  heading: number;
}

export function createCarrier(path: CablePath, s: number, speed: number): CarrierState {
  const p = cablePointAt(path, s);
  return { s, pos: p.pos, vel: scale(forwardOf(p.heading), speed), heading: p.heading };
}

/** Advance the carrier at constant speed. The carrier never slows for the rider. */
export function stepCarrier(c: CarrierState, path: CablePath, speed: number, dt: number): void {
  c.s += speed * dt;
  const p = cablePointAt(path, c.s);
  c.pos = p.pos;
  c.heading = p.heading;
  c.vel = scale(forwardOf(p.heading), speed);
}

/** Number of completed laps for an unwrapped arc length. */
export const lapsAt = (path: CablePath, s: number): number => Math.floor(s / path.length);
