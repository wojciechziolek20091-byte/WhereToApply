import { atan, cos } from './math/detmath';
import { FEATURE_CATALOG } from './featureCatalog';
import type { SimConfig } from './config';
import { deg, DT, GRAVITY } from './config';
import { edgeNorm, updateEdge } from './edge';
import { type FeatureSurface, featureUnder, offCentre, pieceHeading, surfaceAt, toWorld } from './features';
import { type RidePiece, wallHeightAt } from './featureShapes';
import { transition } from './fsm';
import type { InputFrame, InputMemory } from './input';
import { sign, wrapAngle } from './math/scalar';
import { add, dot, forwardOf, headingOf, horizontal, horizontalLength, rightOf, scale, vec3 } from './math/vec';
import type { ResolvedFeature } from './park';
import { ollieCharge, ollieSpeed } from './pop';
import { updatePosture } from './posture';
import type { AirState, FeatureExit, JibState } from './rider';
import { createRotation } from './rotation';
import type { SimState } from './world';
import { applyRope, crash, takeOff } from './actions';
import { landingSpeedKeep } from './bodyPhysics';
import { evaluateLanding } from './landing';
import { crossEdge, overshotSide, resolveLanding, safetyPitchError } from './featureRide/entryResolver';
import { isBoardslide, partEnd, slideFriction, stepBalance, stepKink } from './featureRide/slideController';
import { stepPress } from './featureRide/pressController';
import { exitOf, popKind } from './featureRide/exitResolver';
import { popScaleOn, wallTooSlow } from './featureRide/featureSpecials';
import { midRotation, slideIdAt, stepFeatureRotation } from './featureRide/featureRotation';

/**
 * Kickers and obstacles (spec section 9), on any feature's ride pieces
 * (featureShapes.ts): riding up a ramp to its lip, the safety of a box or
 * rail with its pop window, sliding mains (kinks, exit ramps) with
 * 90-degree board rotations and a balance meter, landing on a main or a
 * landing ramp from the air, and riding back out into the water.
 */

const featureById = (s: SimState, id: string): ResolvedFeature => {
  const f = s.features.find((x) => x.def.id === id);
  if (!f) throw new Error(`unknown feature ${id}`);
  return f;
};

/** The safety's pop window: from `start` (m along the feature) to the end of the safety piece. */
export function safetyWindow(p: RidePiece, cfg: SimConfig): { start: number; end: number } {
  const len = Math.max((p.u1 - p.u0) * cfg.safety.popWindowFraction, cfg.safety.popWindowMinMetres);
  return { start: Math.max(p.u0, p.u1 - len), end: p.u1 };
}

/** The first slideable piece starting where `p` ends (a flush main), if any. */
const flushNext = (f: ResolvedFeature, p: RidePiece): RidePiece | null =>
  f.shape.pieces.find((q) => q.slide && q.axis === 'u' && q.u0 === p.u1) ?? null;

/** First piece of a part. */
const partStart = (f: ResolvedFeature, part: number): RidePiece => f.shape.pieces.find((q) => q.part === part)!;

/** Ramp-like modes: kickers, landing ramps and the pyramid's faces ride as `onKicker`, safeties as `onSafety`. */
const rampMode = (p: RidePiece): 'onKicker' | 'onSafety' => (p.role === 'Safety' ? 'onSafety' : 'onKicker');

/** A piece going down toward the water (exit ramps, landing ramps, down rails). */
const descending = (p: RidePiece): boolean => p.h1 < p.h0;

/**
 * Called from the water step after moving. If the rider is now over a
 * feature, ride onto it (an entry ramp, from the start, roughly aligned, at a
 * low surface) or crash into it. Parts under the water are ridden over.
 * Returns true if the rider left the water modes.
 */
export function tryEnterFeature(s: SimState): boolean {
  const r = s.rider;
  const hit = featureUnder(s.features, r.pos);
  if (!hit) return false;
  const { feature, local, surface } = hit;
  if (surface.height < 0) return false;
  const speed = horizontalLength(r.vel);
  const along = speed > 0.1 ? dot(horizontal(r.vel), forwardOf(feature.heading)) / speed : 0;
  if (r.mode === 'ridingBlind' || surface.height > s.cfg.feature.mountHeight || along < cos(s.cfg.feature.mountAngle)) {
    crash(s, 'hitFeature');
    return true;
  }
  r.ramp = { featureId: feature.def.id, u: local.u, v: local.v, releaseTick: -1, releaseTimeToLip: -1, sketchy: false };
  if (surface.piece.wall) {
    // Up a wall ride's transition: a slide on the wall.
    r.jib = startJib(s, feature, 0, 'rideOn', false);
    transition(s, 'onFeature', 'wallRide');
    s.events.push({ type: 'featureEnter', tick: s.tick, featureId: feature.def.id });
    return true;
  }
  transition(s, rampMode(surface.piece), 'rideOn');
  s.events.push({ type: 'featureEnter', tick: s.tick, featureId: feature.def.id });
  return true;
}

/** Points multiplier of a feature's catalogue difficulty (the old defs count as 1). */
function difficultyOf(f: ResolvedFeature, s: SimState): number {
  const S = s.cfg.featureRide.Scoring;
  const level = f.def.kind === 'feature' ? (FEATURE_CATALOG[f.def.catalog]?.meta.difficulty ?? 1) : 1;
  return S.DifficultyBase + S.DifficultyPerLevel * level;
}

function startJib(s: SimState, feature: ResolvedFeature, boardAngle: number, entry: JibState['entry'], sketchy: boolean): JibState {
  const rot = createRotation(s.cfg.handlePass.featureWindow);
  return {
    featureId: feature.def.id,
    balance: 0,
    boardAngle,
    targetAngle: boardAngle,
    entryAngle: boardAngle,
    time: 0,
    slideTimes: { fiftyFifty: 0, switchFiftyFifty: 0, backboard: 0, frontboard: 0, backLip: 0, frontLip: 0, wallRide: 0 },
    slideOrder: [],
    entry,
    inRotation: 0,
    entryQuality: 1,
    fore: 0,
    pitch: 0,
    lift: 0,
    spiked: false,
    entrySlide: null,
    rotations: [],
    press: 0,
    pressTime: 0,
    pressAmount: 0,
    pressTimes: { nose: 0, tail: 0 },
    endTap: null,
    chain: [],
    switchStance: s.rider.switchStance,
    slideMetres: { fiftyFifty: 0, switchFiftyFifty: 0, backboard: 0, frontboard: 0, backLip: 0, frontLip: 0, wallRide: 0 },
    uMin: s.rider.ramp ? s.rider.ramp.u : 0,
    uMax: s.rider.ramp ? s.rider.ramp.u : 0,
    partLength: 0,
    difficulty: difficultyOf(feature, s),
    sketchy,
    rot,
    noiseSeed: s.tick,
  };
}

/** Slide name for a board angle on the feature (FeatureRotation). */
export { slideIdAt } from './featureRide/featureRotation';

function endSlide(s: SimState): void {
  const j = s.rider.jib;
  if (!j) return;
  s.events.push({ type: 'slideDone', tick: s.tick, jib: j });
}

/** Leave the feature into the air. Leaving a slide keeps the board's angle as the start of the spin. */
function leaveFeature(
  s: SimState,
  f: ResolvedFeature,
  popSpeed: number,
  popQuality: number,
  from: RidePiece | null,
  kind: FeatureExit['kind'] = 'rideOff',
): AirState {
  const r = s.rider;
  const jib = r.jib;
  const spinStart = jib ? wrapAngle(jib.boardAngle) : 0;
  const keepHandle = r.handle;
  endSlide(s);
  s.events.push({ type: 'featureExit', tick: s.tick, featureId: f.def.id });
  const piece = from ?? (r.ramp ? surfaceAt(f, { u: r.ramp.u, v: r.ramp.v })?.piece : undefined) ?? null;
  // Off a ramp's lip is a kicker takeoff; with no piece under the rider, the feature's entry decides.
  const src = piece ?? f.shape.pieces[0]!;
  const fromRamp = src.lip && !src.slide;
  const air = takeOff(s, fromRamp ? 'kicker' : 'feature', f.def.id, popSpeed, popQuality, spinStart);
  // Already above the part being left: the clearance check is for parts flown onto.
  // Off a lip straight onto the next part (a pyramid's top), that part counts as left too.
  const onto = piece && piece.lip ? f.shape.pieces.find((q) => q.axis === 'u' && q.u0 === piece.u1 && q.part !== piece.part) : undefined;
  air.overFeature = `${f.def.id}:${onto ? onto.part : piece ? piece.part : 0}`;
  // The part left from: landing on another one is a transfer.
  air.cleared.push(air.overFeature);
  if (jib) air.exit = exitOf(jib, kind, r.switchStance);
  r.handle = keepHandle === 'passing' ? 'inFront' : keepHandle;
  return air;
}

/** Ride off a feature's end into the water (exit ramps, landing ramps, down rails into the water). */
function rideOut(s: SimState, f: ResolvedFeature): void {
  const r = s.rider;
  const jib = r.jib;
  if (jib && isBoardslide(jib.boardAngle)) {
    // Down into the water still across the board: it catches.
    endSlide(s);
    crash(s, 'badAngle');
    return;
  }
  endSlide(s);
  if (jib) s.events.push({ type: 'featureLine', tick: s.tick, exit: exitOf(jib, 'rideOff', r.switchStance), air: null, landing: null });
  s.events.push({ type: 'featureExit', tick: s.tick, featureId: f.def.id });
  r.pos = vec3(r.pos.x, 0, r.pos.z);
  r.vel = horizontal(r.vel);
  if (horizontalLength(r.vel) > 0.5) r.heading = headingOf(r.vel);
  r.ramp = null;
  r.jib = null;
  r.popCharge = 0;
  transition(s, 'riding', 'rodeOut');
}

/** One tick on a ramp-like piece: kicker ramp, safety, landing ramp, pyramid face. */
export function stepRamp(s: SimState, input: InputFrame, mem: InputMemory): void {
  const { rider: r, cfg } = s;
  const ramp = r.ramp;
  if (!ramp) throw new Error('ramp mode without RampState');
  const f = featureById(s, ramp.featureId);
  const m = cfg.rider.mass;
  updatePosture(r, input.armsOut ? 0 : 1, input.pop, r.ropeTension, cfg.posture, DT);
  updateEdge(r, 0, cfg.edge, DT);
  const rope = applyRope(s);
  if (!rope) return;

  const surface = surfaceAt(f, { u: ramp.u, v: ramp.v });
  if (!surface) {
    leaveFeature(s, f, 0, 0, null);
    return;
  }
  const piece = surface.piece;
  const t = surface.tangent;
  const n = surface.normal;
  const right = rightOf(f.heading);
  let vt = dot(r.vel, t);
  let vl = dot(r.vel, right);
  const normalForce = Math.max(0, m * GRAVITY * n.y - dot(rope.force, n));
  const at = (dot(rope.force, t) - m * GRAVITY * t.y - cfg.feature.rampFriction * normalForce * sign(vt)) / m;
  vt += at * DT;
  const ropeLat = dot(rope.force, right);
  const grip = cfg.hydro.lateralGrip * (cfg.hydro.flatGripFraction + (1 - cfg.hydro.flatGripFraction) * edgeNorm(r, cfg.edge));
  vl += ((ropeLat - grip * vl * Math.max(Math.abs(vt), cfg.hydro.gripMinSpeed)) / m) * DT;
  r.edgeLoad = 0;
  if (vt < cfg.feature.stallSpeed) {
    crash(s, 'hitFeature');
    return;
  }
  const horizontalSpeed = Math.max(vt * dot(t, forwardOf(f.heading)), 0.5);

  if (mem.popPressed || input.pop) r.popCharge = ollieCharge(mem.popHeldTime, cfg);
  if (mem.popReleased && ramp.releaseTick < 0) {
    ramp.releaseTick = s.tick;
    if (piece.role !== 'Safety') {
      ramp.releaseTimeToLip = (piece.u1 - ramp.u) / horizontalSpeed;
    } else {
      // Safety pop: only the last part of the safety counts.
      const w = safetyWindow(piece, cfg);
      // Into the air off the safety (spec 3.6): in the window, with the
      // main flush, the board leaves at the main's height, so flying onto it
      // needs no clearance check; an early pop is lower and has to clear it.
      // A/D in the air rotates in (180-in, 270-in).
      const inWindow = ramp.u >= w.start;
      const centre = (w.start + w.end) / 2;
      const perfect = inWindow && Math.abs(ramp.u - centre) <= (cfg.safety.perfectFraction * (w.end - w.start)) / 2;
      const main = flushNext(f, piece);
      r.vel = add(scale(t, vt), scale(right, vl));
      const charge = ollieCharge(mem.popHeldTime, cfg);
      const air = leaveFeature(s, f, ollieSpeed(charge, cfg) * cfg.safety.gapPopScale, charge, piece);
      air.pendingEntry = perfect ? 'popOn' : 'pop';
      if (main && inWindow) air.cleared.push(`${f.def.id}:${main.part}`);
      if (ramp.sketchy) air.tailClip = true;
      return;
    }
  }

  ramp.u += vt * dot(t, forwardOf(f.heading)) * DT;
  ramp.v += vl * DT;
  const next = surfaceAt(f, { u: ramp.u, v: ramp.v });
  if (next && next.onTop && !piece.slide && !piece.lip) {
    // Reached the main without a valid pop.
    if (f.shape.safetyMode === 'Gap') {
      crash(s, 'missedSafetyPop');
      return;
    }
    mountMain(s, f, next.piece, ramp.u, ramp.v, vt, 'rideOn', ramp.sketchy);
    return;
  }
  if (piece.role === 'Safety' && f.shape.safetyMode === 'Gap' && !next && ramp.u >= piece.u1 && !flushNext(f, piece)) {
    // Rolled off the end of a gap safety into the water.
    crash(s, 'missedSafetyPop');
    return;
  }
  if (descending(piece) && (!next || next.height < 0)) {
    r.vel = add(scale(t, vt), scale(right, vl));
    rideOut(s, f);
    return;
  }
  if (!next || (piece.lip && next.piece.part !== piece.part)) {
    // Off the lip, or off the side: momentum carries on.
    r.vel = add(scale(t, vt), scale(right, vl));
    r.pos = toWorld(f, ramp.u, ramp.v, surface.height);
    let popSpeed = 0;
    let quality = 0;
    const lipPop = piece.lip && ramp.releaseTimeToLip >= 0 && ramp.releaseTimeToLip <= cfg.kicker.lipPopWindow;
    if (lipPop && r.vel.y > 0) {
      popSpeed = r.vel.y * cfg.kicker.lipPopBonus;
      quality = 1 - ramp.releaseTimeToLip / cfg.kicker.lipPopWindow;
    }
    const air = leaveFeature(s, f, popSpeed, quality, piece);
    air.lipPop = lipPop;
    return;
  }
  r.pos = toWorld(f, ramp.u, ramp.v, next.height);
  r.vel = add(scale(next.tangent, vt), scale(right, vl));
  r.heading = f.heading;
}

/** Get onto a main (`main`: a slideable piece): from the safety, or landing from the air. */
function mountMain(
  s: SimState,
  f: ResolvedFeature,
  main: RidePiece,
  u: number,
  v: number,
  speed: number,
  entry: JibState['entry'],
  sketchy: boolean,
  boardAngle = 0,
): void {
  const r = s.rider;
  const start = partStart(f, main.part);
  const mu = Math.max(u, start.u0);
  const top = surfaceAt(f, { u: mu, v });
  const height = top ? top.height : main.h0;
  r.ramp = { featureId: f.def.id, u: mu, v, releaseTick: -1, releaseTimeToLip: -1, sketchy };
  r.pos = toWorld(f, r.ramp.u, v, height);
  const along = f.shape.legacy || !top ? forwardOf(f.heading) : top.tangent;
  r.vel = scale(along, Math.max(speed, s.cfg.feature.stallSpeed + 0.5));
  r.heading = f.shape.legacy ? f.heading : pieceHeading(f, top ? top.piece : main);
  r.jib = startJib(s, f, boardAngle, entry, sketchy);
  r.jib.pitch = atan(top ? top.slope : 0);
  r.jib.partLength = partEnd(f, main.part) - start.u0;
  r.popCharge = 0;
  transition(s, 'onFeature', entry);
}

/** One tick sliding a main of a box or rail (spec section 9.4): flat, kinked, or down an exit ramp. */
export function stepSlide(s: SimState, input: InputFrame, mem: InputMemory): void {
  const { rider: r, cfg } = s;
  const ramp = r.ramp;
  const j = r.jib;
  if (!ramp || !j) throw new Error('onFeature without RampState / JibState');
  const f = featureById(s, ramp.featureId);
  if (f.shape.pieces[0]!.wall) {
    stepWall(s, input, mem, f);
    return;
  }
  const m = cfg.rider.mass;
  updatePosture(r, input.armsOut ? 0 : 1, input.pop, r.ropeTension, cfg.posture, DT);
  const rope = applyRope(s);
  if (!rope) return;
  const surface = surfaceAt(f, { u: ramp.u, v: ramp.v });
  if (!surface || !surface.onTop) {
    leaveFeature(s, f, 0, 0, null);
    return;
  }
  const piece = surface.piece;
  const heading = f.shape.legacy ? f.heading : pieceHeading(f, piece);
  const t = surface.tangent;
  const right = rightOf(heading);
  // SlideController: friction by material and slide, stall, kinks.
  const friction = slideFriction(f, j, s);
  let vt = dot(r.vel, t);
  let vl = dot(r.vel, right);
  const at = (dot(rope.force, t) - m * GRAVITY * t.y - friction * m * GRAVITY * surface.normal.y * sign(vt)) / m;
  vt += at * DT;
  const ropeLat = dot(rope.force, right);
  vl += (ropeLat / m - cfg.feature.lateralDamping * vl) * DT;
  r.edgeLoad = 0;
  if (vt < cfg.featureRide.Slide.StallSpeed) {
    endSlide(s);
    crash(s, 'stalled');
    return;
  }
  const kink = stepKink(s, j, atan(surface.slope), vt, input);
  if (kink) {
    endSlide(s);
    crash(s, kink);
    return;
  }

  // Rotations in 90-degree hop steps, hard way, handle passes (FeatureRotation).
  const turned = stepFeatureRotation(s, j, heading, mem);
  if (turned) {
    endSlide(s);
    crash(s, turned);
    return;
  }

  // Presses (W/S held on a 50-50) and end taps.
  stepPress(s, j, mem, partEnd(f, piece.part) - ramp.u);
  // Balance across and fore-aft (SlideController); out near the end is a sketchy exit.
  const fell = stepBalance(s, j, f, piece, surface, ramp.u, ropeLat, dot(rope.force, t), mem);
  if (fell === 'fell') {
    endSlide(s);
    crash(s, 'fellOffFeature');
    return;
  }
  if (fell === 'sketchyExit') {
    j.sketchy = true;
    r.vel = add(scale(t, vt), scale(right, vl));
    leaveFeature(s, f, 0, 0, piece, 'sketchy');
    return;
  }
  j.time += DT;
  const nearest = Math.round(j.boardAngle / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(j.boardAngle - nearest) < deg(20)) {
    const id = slideIdAt(j.boardAngle, heading, heading, r, j);
    j.slideTimes[id] += DT;
    j.slideMetres[id] += vt * DT;
    if (j.slideOrder.length === 0 || j.slideOrder[j.slideOrder.length - 1] !== id) j.slideOrder.push(id);
  }

  if (input.pop) r.popCharge = ollieCharge(mem.popHeldTime, cfg);
  if (mem.popReleased) {
    const charge = ollieCharge(mem.popHeldTime, cfg);
    // A/D pressed as the pop goes: off the side (a side pop, or across to a transfer box).
    if (mem.steerDir !== 0) r.vel = add(r.vel, scale(right, mem.steerDir * cfg.feature.sideHop));
    leaveFeature(s, f, ollieSpeed(charge, cfg) * popScaleOn(piece, s), charge, piece, popKind(s, partEnd(f, piece.part) - ramp.u, mem.steerDir));
    return;
  }

  const fwd = forwardOf(f.heading);
  if (piece.v1 === piece.v0) {
    ramp.u += vt * dot(t, fwd) * DT;
    ramp.v += vl * DT;
  } else {
    // A splayed box: move along the piece, then back into the feature frame.
    const vel = add(scale(t, vt), scale(right, vl));
    ramp.u += dot(vel, fwd) * DT;
    ramp.v += dot(vel, rightOf(f.heading)) * DT;
  }
  const next = surfaceAt(f, { u: ramp.u, v: ramp.v });
  if ((!next || !next.onTop || next.height < 0) && midRotation(j) && Math.abs(offCentre(piece, ramp)) <= piece.width / 2 + 0.3) {
    // Off the end with the board still turning (spec 5.4).
    endSlide(s);
    crash(s, 'ranOutMidRotation');
    return;
  }
  if (next && next.height < 0) {
    // Slid down into the water (a down rail or an exit ramp).
    r.vel = add(scale(t, vt), scale(right, vl));
    rideOut(s, f);
    return;
  }
  if (!next || !next.onTop) {
    if (Math.abs(offCentre(piece, ramp)) > piece.width / 2 + 0.3) {
      endSlide(s);
      crash(s, 'fellOffFeature');
      return;
    }
    r.vel = add(scale(t, vt), scale(right, vl));
    if (next && next.piece.role === 'LandingRamp' && next.piece.u0 === piece.u1) {
      // Over the top and down the far side: roll down it.
      endSlide(s);
      r.jib = null;
      r.pos = toWorld(f, ramp.u, ramp.v, next.height);
      r.heading = f.heading;
      transition(s, 'onKicker', 'rollDown');
      return;
    }
    if (descending(piece) && piece.h1 <= 0.05) {
      rideOut(s, f);
      return;
    }
    // Off the end: roll off with whatever speed there is.
    r.pos = toWorld(f, ramp.u, ramp.v, surface.height);
    leaveFeature(s, f, 0, 0, piece);
    return;
  }
  r.pos = toWorld(f, ramp.u, ramp.v, next.height);
  r.vel = add(scale(next.tangent, vt), scale(right, vl));
  r.heading = f.shape.legacy ? f.heading : pieceHeading(f, next.piece);
  j.uMin = Math.min(j.uMin, ramp.u);
  j.uMax = Math.max(j.uMax, ramp.u);
}

/**
 * One tick on a wall ride: the rider climbs the transition (and the wall)
 * with the speed they cut in with, gravity pulls them back down the profile,
 * the rope pulls them along it. They ride back out into the water, run off
 * the end of the wall into the air, pop off it, or go over the top (crash).
 */
function stepWall(s: SimState, input: InputFrame, mem: InputMemory, f: ResolvedFeature): void {
  const { rider: r, cfg } = s;
  const ramp = r.ramp!;
  const j = r.jib!;
  const m = cfg.rider.mass;
  updatePosture(r, input.armsOut ? 0 : 1, input.pop, r.ropeTension, cfg.posture, DT);
  const rope = applyRope(s);
  if (!rope) return;
  const piece = f.shape.pieces[0]!;
  const w = piece.wall!;
  const top = f.shape.pieces[f.shape.pieces.length - 1]!.wall!.d1;
  const fwd = forwardOf(f.heading);
  const right = rightOf(f.heading);
  let x = (ramp.v - w.base) * w.side;
  const prof = wallHeightAt(w, x);
  const cosT = 1 / Math.sqrt(1 + prof.slope * prof.slope);
  const sinT = prof.slope * cosT;
  // Speeds along the wall (u) and up its profile (ws).
  let vu = dot(r.vel, fwd);
  let ws = dot(r.vel, right) * w.side * cosT + r.vel.y * sinT;
  const speed = Math.sqrt(vu * vu + ws * ws);
  const fr = speed > 1e-6 ? ((f.shape.friction ?? cfg.feature.friction) * GRAVITY * cosT) / speed : 0;
  vu += (dot(rope.force, fwd) / m - fr * vu) * DT;
  ws += (-GRAVITY * sinT + (dot(rope.force, right) * w.side * cosT) / m - fr * ws) * DT;
  r.edgeLoad = 0;
  if (vu < cfg.feature.stallSpeed) {
    // Too slow along the wall (spec 7): low down it slides back into the water, higher up down the wall.
    const slow = wallTooSlow(x, s);
    if (slow === 'sketchy') {
      j.sketchy = true;
      r.vel = add(scale(fwd, Math.max(vu, 0)), scale(right, -w.side * 0.5));
      rideOut(s, f);
      return;
    }
    endSlide(s);
    crash(s, slow);
    return;
  }
  j.time += DT;
  j.slideTimes.wallRide += DT;
  j.slideMetres.wallRide += Math.max(vu, 0) * DT;
  if (j.slideOrder.length === 0) j.slideOrder.push('wallRide');
  const along = (u: number, wsNow: number, c: number, sn: number) => add(add(scale(fwd, u), scale(right, w.side * wsNow * c)), vec3(0, wsNow * sn, 0));

  if (input.pop) r.popCharge = ollieCharge(mem.popHeldTime, cfg);
  if (mem.popReleased) {
    // Pop off the wall: away from its face.
    const charge = ollieCharge(mem.popHeldTime, cfg);
    const out = ollieSpeed(charge, cfg) * cfg.feature.wallPopOut;
    r.vel = add(along(vu, ws, cosT, sinT), add(scale(right, -w.side * out * sinT), vec3(0, out * cosT, 0)));
    leaveFeature(s, f, 0, charge, piece, 'popOff');
    return;
  }

  x += ws * cosT * DT;
  ramp.u += vu * DT;
  ramp.v = w.base + w.side * x;
  if (x >= top) {
    endSlide(s);
    crash(s, 'fellOffFeature');
    return;
  }
  const next = wallHeightAt(w, Math.max(x, 0));
  const c2 = 1 / Math.sqrt(1 + next.slope * next.slope);
  const s2 = next.slope * c2;
  if (next.height <= 0 && ws < 0) {
    r.vel = add(scale(fwd, vu), scale(right, w.side * ws * c2));
    rideOut(s, f);
    return;
  }
  r.pos = toWorld(f, ramp.u, ramp.v, next.height);
  r.vel = along(vu, ws, c2, s2);
  r.heading = f.heading;
  if (ramp.u > piece.u1 || ramp.u < piece.u0) {
    // Off the end of the wall: into the air with this speed.
    leaveFeature(s, f, 0, 0, piece);
  }
}

/** Land on a landing ramp: an ordinary landing, then ride down it. */
function landOnRamp(s: SimState, f: ResolvedFeature, air: AirState, surface: FeatureSurface, u: number, v: number): void {
  const r = s.rider;
  const landing = evaluateLanding(r, air, surface.normal, s.cfg);
  r.pos = toWorld(f, u, v, surface.height);
  if (landing.crash) {
    crash(s, landing.crash, landing);
    return;
  }
  if (Math.abs(Math.round(air.rot.spinAngle / Math.PI)) % 2 === 1) r.switchStance = !r.switchStance;
  if (r.handle === 'passing') r.handle = 'inFront';
  const keep = landingSpeedKeep(s.cfg, landing.impact, landing.clean);
  r.vel = scale(surface.tangent, Math.max(dot(r.vel, surface.tangent) * keep, s.cfg.feature.stallSpeed + 0.5));
  r.heading = f.heading;
  r.air = null;
  r.ramp = { featureId: f.def.id, u, v, releaseTick: -1, releaseTimeToLip: -1, sketchy: false };
  transition(s, 'onKicker', 'landedOnRamp');
  s.events.push({ type: 'landed', tick: s.tick, air, landing, onFeature: false });
}

/**
 * Ollie onto a safety (spec 3.5): the game's landing rules, then the board has
 * to match the slope (sketchy past LandingPitchTolerance, a crash past
 * LandingPitchCrash) and the base be flat. Then up the safety as if ridden
 * on, pop window and all.
 */
function landOnSafety(s: SimState, f: ResolvedFeature, air: AirState, surface: FeatureSurface, u: number, v: number): void {
  const r = s.rider;
  const R = s.cfg.featureRide;
  const landing = evaluateLanding(r, air, surface.normal, s.cfg);
  r.pos = toWorld(f, u, v, surface.height);
  const pitch = safetyPitchError(air, surface.slope);
  const reason = landing.crash ?? (pitch > R.Safety.LandingPitchCrash ? 'badAngle' : air.entry && air.entry.roll > R.Landing.MaxRoll ? 'slippedOut' : null);
  if (reason) {
    crash(s, reason, landing);
    return;
  }
  if (Math.abs(Math.round(air.rot.spinAngle / Math.PI)) % 2 === 1) r.switchStance = !r.switchStance;
  if (r.handle === 'passing') r.handle = 'inFront';
  const keep = landingSpeedKeep(s.cfg, landing.impact, landing.clean);
  r.vel = scale(surface.tangent, Math.max(dot(r.vel, surface.tangent) * keep, s.cfg.feature.stallSpeed + 0.5));
  r.heading = f.heading;
  r.air = null;
  const sketchy = pitch > R.Safety.LandingPitchTolerance || air.tailClip;
  r.ramp = { featureId: f.def.id, u, v, releaseTick: -1, releaseTimeToLip: -1, sketchy };
  transition(s, 'onSafety', 'landedOnSafety');
  s.events.push({ type: 'landed', tick: s.tick, air, landing, onFeature: true });
  s.events.push({ type: 'featureEnter', tick: s.tick, featureId: f.def.id });
}

/**
 * In the air over a feature. Coming in below a main's top plus
 * `ollie.clearance` clips its edge (short ollie); coming down on a ramp or a
 * safety is a crash; coming down on a landing ramp is a landing; coming down
 * on a main with the board near a multiple of 90 degrees to it starts a
 * slide. Returns true if a feature handled it.
 */
export function airOverFeature(s: SimState, air: AirState): boolean {
  const r = s.rider;
  const hit = featureUnder(s.features, r.pos);
  const was = air.overFeature;
  if (was !== null && (!hit || `${hit.feature.def.id}:${hit.surface.piece.part}` !== was) && overshotSide(s, air, was)) {
    crash(s, 'overshoot');
    return true;
  }
  if (!hit) {
    air.overFeature = null;
    return false;
  }
  const { feature, local, surface } = hit;
  const piece = surface.piece;
  const part = `${feature.def.id}:${piece.part}`;
  const isMain = surface.onTop && !piece.wall;
  if (air.overFeature !== part) {
    if (!air.cleared.includes(part)) {
      // Flying onto a main or a safety across its edge: EntryResolver's clearance rules.
      const reason = isMain || piece.role === 'Safety' ? crossEdge(s, air, feature, local, surface, part) : r.pos.y < surface.height ? 'hitFeature' : null;
      if (reason) {
        crash(s, reason);
        return true;
      }
    }
    air.overFeature = part;
  }
  if (r.pos.y > surface.height || r.vel.y >= 0) return false;
  if (piece.role === 'LandingRamp') {
    landOnRamp(s, feature, air, surface, local.u, local.v);
    return true;
  }
  if (piece.role === 'Safety') {
    landOnSafety(s, feature, air, surface, local.u, local.v);
    return true;
  }
  if (!isMain) {
    crash(s, 'hitFeature');
    return true;
  }
  const heading = feature.shape.legacy ? feature.heading : pieceHeading(feature, piece);
  const e = resolveLanding(s, air, feature, surface, local, heading);
  const landing = e.landing;
  if (!e.success) {
    crash(s, e.failReason ?? 'badAngle', landing);
    return true;
  }
  if (r.handle === 'passing') r.handle = 'inFront';
  const keep = landingSpeedKeep(s.cfg, landing.impact, landing.clean) * e.speedKeep;
  const speed = Math.max(dot(r.vel, surface.tangent) * keep, s.cfg.feature.stallSpeed + 0.5);
  r.air = null;
  mountMain(s, feature, piece, local.u, local.v, speed, e.kind, e.sketchy, e.boardAngle);
  const j = r.jib!;
  j.balance = e.balance;
  j.inRotation = e.inRotation;
  j.entryQuality = e.quality;
  j.entrySlide = e.slide;
  // A transfer (or a hop back on) carries the line on.
  j.chain = air.exit ? air.exit.jibs : [];
  s.events.push({ type: 'landed', tick: s.tick, air, landing, onFeature: true });
  s.events.push({ type: 'featureEnter', tick: s.tick, featureId: feature.def.id });
  return true;
}
