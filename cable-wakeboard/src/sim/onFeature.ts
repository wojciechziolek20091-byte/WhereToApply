import { cos } from './math/detmath';
import type { SimConfig } from './config';
import { deg, DT, GRAVITY } from './config';
import { edgeNorm, toeSign, updateEdge } from './edge';
import { type FeatureSurface, featureUnder, offCentre, pieceHeading, surfaceAt, toWorld } from './features';
import type { RidePiece } from './featureShapes';
import { transition } from './fsm';
import { updateHandle } from './handle';
import type { InputFrame, InputMemory } from './input';
import { approach, mod, sign, wrapAngle } from './math/scalar';
import { valueNoise } from './math/noise';
import { add, dot, forwardOf, headingOf, horizontal, horizontalLength, rightOf, scale, vec3 } from './math/vec';
import type { ResolvedFeature } from './park';
import { ollieCharge, ollieSpeed } from './pop';
import { updatePosture } from './posture';
import type { AirState, JibState, RiderState } from './rider';
import { createRotation, rotationSide } from './rotation';
import type { SlideId } from './tricks/data';
import type { SimState } from './world';
import { applyRope, crash, takeOff } from './actions';
import { landingSpeedKeep } from './bodyPhysics';
import { evaluateLanding } from './landing';

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
  if (r.mode === 'ridingBlind' || surface.height > s.cfg.feature.mountHeight || along < cos(s.cfg.feature.mountAngle) || surface.piece.wall) {
    crash(s, 'hitFeature');
    return true;
  }
  r.ramp = { featureId: feature.def.id, u: local.u, v: local.v, releaseTick: -1, releaseTimeToLip: -1, sketchy: false };
  transition(s, rampMode(surface.piece), 'rideOn');
  s.events.push({ type: 'featureEnter', tick: s.tick, featureId: feature.def.id });
  return true;
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
    slideTimes: { fiftyFifty: 0, switchFiftyFifty: 0, backboard: 0, frontboard: 0 },
    slideOrder: [],
    entry,
    sketchy,
    rot,
    noiseSeed: s.tick,
  };
}

/**
 * Slide name for a board angle on the feature (spec section 2.6): parallel is
 * a 50-50 (switch after a half turn), perpendicular with the chest toward the
 * direction of travel is a backboard, with the back toward it a frontboard.
 */
export function slideIdAt(boardAngle: number, featureHeading: number, travelHeading: number, r: RiderState): SlideId {
  const k = Math.round(boardAngle / (Math.PI / 2));
  const m = mod(k, 4);
  if (m === 0) return r.switchStance ? 'switchFiftyFifty' : 'fiftyFifty';
  if (m === 2) return r.switchStance ? 'fiftyFifty' : 'switchFiftyFifty';
  const chest = featureHeading + boardAngle + (toeSign(r) * Math.PI) / 2;
  return cos(chest - travelHeading) > 0 ? 'backboard' : 'frontboard';
}

function endSlide(s: SimState): void {
  const j = s.rider.jib;
  if (!j) return;
  s.events.push({ type: 'slideDone', tick: s.tick, jib: j });
}

/** Leave the feature into the air. Leaving a slide keeps the board's angle as the start of the spin. */
function leaveFeature(s: SimState, f: ResolvedFeature, popSpeed: number, popQuality: number, from: RidePiece | null): AirState {
  const r = s.rider;
  const spinStart = r.jib ? wrapAngle(r.jib.boardAngle) : 0;
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
  r.handle = keepHandle === 'passing' ? 'inFront' : keepHandle;
  return air;
}

/** Ride off a feature's end into the water (exit ramps, landing ramps, down rails into the water). */
function rideOut(s: SimState, f: ResolvedFeature): void {
  const r = s.rider;
  endSlide(s);
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
      if (ramp.u >= w.start) {
        const centre = (w.start + w.end) / 2;
        const perfect = Math.abs(ramp.u - centre) <= (cfg.safety.perfectFraction * (w.end - w.start)) / 2;
        const main = flushNext(f, piece);
        if (main) {
          mountMain(s, f, main, ramp.u, ramp.v, vt, perfect ? 'popOn' : 'pop', ramp.sketchy);
          return;
        }
        // A water gap before the main: pop across it.
        r.vel = add(scale(t, vt), scale(right, vl));
        const charge = ollieCharge(mem.popHeldTime, cfg);
        const air = leaveFeature(s, f, ollieSpeed(charge, cfg) * cfg.safety.gapPopScale, charge, piece);
        air.pendingEntry = perfect ? 'popOn' : 'pop';
        return;
      }
      if (f.shape.safetyMode === 'Gap') {
        crash(s, 'missedSafetyPop');
        return;
      }
      ramp.sketchy = true;
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
  const friction = f.shape.friction ?? cfg.feature.friction;
  let vt = dot(r.vel, t);
  let vl = dot(r.vel, right);
  const at = (dot(rope.force, t) - m * GRAVITY * t.y - friction * m * GRAVITY * surface.normal.y * sign(vt)) / m;
  vt += at * DT;
  const ropeLat = dot(rope.force, right);
  vl += (ropeLat / m - cfg.feature.lateralDamping * vl) * DT;
  r.edgeLoad = 0;
  if (vt < cfg.feature.stallSpeed) {
    endSlide(s);
    crash(s, 'fellOffFeature');
    return;
  }

  // Board rotation in 90-degree steps: holding A/D past a tap rotates.
  const stepRate = Math.PI / 2 / cfg.feature.rotateTimePer90;
  if (j.boardAngle === j.targetAngle && mem.steerDir !== 0 && mem.steerHeldTime >= cfg.feature.tapTime) {
    const dir = mem.steerDir;
    if (j.rot.spinSide === null) {
      j.rot.spinSide = rotationSide(dir, heading + j.boardAngle, toeSign(r), r.ropeHeading);
      j.rot.startDir = dir;
    }
    j.rot.spinDir = dir;
    j.targetAngle = j.boardAngle + (dir * Math.PI) / 2;
  }
  j.boardAngle = approach(j.boardAngle, j.targetAngle, stepRate * DT);
  j.rot.spinAngle = j.boardAngle - j.entryAngle;
  j.rot.maxSpin = Math.max(j.rot.maxSpin, Math.abs(j.rot.spinAngle));
  const h = updateHandle(r.handle, j.rot, mem.passPressed, { rate: stepRate, inAir: false }, cfg, DT);
  r.handle = h.handle;
  if (h.result.passed) s.events.push({ type: 'handlePass', tick: s.tick });
  if (h.result.dropped) {
    endSlide(s);
    crash(s, 'handleDropped');
    return;
  }

  // Balance: drifts with smooth noise (faster on rails) and the rope's sideways pull; taps correct it.
  if (cfg.feature.balanceEnabled) {
    const drift = piece.width >= 0.6 ? cfg.feature.balanceDriftBox : cfg.feature.balanceDriftRail;
    const noise = valueNoise(j.time * cfg.feature.balanceNoiseRate, j.noiseSeed);
    j.balance += (noise * drift + ropeLat / cfg.feature.ropeTip) * DT + mem.steerTap * cfg.feature.tapStrength;
    if (Math.abs(j.balance) > 1) {
      endSlide(s);
      crash(s, 'fellOffFeature');
      return;
    }
  }
  j.time += DT;
  const nearest = Math.round(j.boardAngle / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(j.boardAngle - nearest) < deg(20)) {
    const id = slideIdAt(j.boardAngle, heading, heading, r);
    j.slideTimes[id] += DT;
    if (j.slideOrder.length === 0 || j.slideOrder[j.slideOrder.length - 1] !== id) j.slideOrder.push(id);
  }

  if (input.pop) r.popCharge = ollieCharge(mem.popHeldTime, cfg);
  if (mem.popReleased) {
    const charge = ollieCharge(mem.popHeldTime, cfg);
    leaveFeature(s, f, ollieSpeed(charge, cfg), charge, piece);
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
 * In the air over a feature. Coming in below a main's top plus
 * `ollie.clearance` clips its edge (short ollie); coming down on a ramp or a
 * safety is a crash; coming down on a landing ramp is a landing; coming down
 * on a main with the board near a multiple of 90 degrees to it starts a
 * slide. Returns true if a feature handled it.
 */
export function airOverFeature(s: SimState, air: AirState): boolean {
  const r = s.rider;
  const hit = featureUnder(s.features, r.pos);
  if (!hit) {
    air.overFeature = null;
    return false;
  }
  const { feature, local, surface } = hit;
  const piece = surface.piece;
  const part = `${feature.def.id}:${piece.part}`;
  const isMain = surface.onTop && !piece.wall;
  const clearance = isMain ? s.cfg.ollie.clearance : 0;
  if (air.overFeature !== part) {
    if (r.pos.y < surface.height + clearance) {
      crash(s, isMain ? 'shortOllie' : 'hitFeature');
      return true;
    }
    air.overFeature = part;
  }
  if (r.pos.y > surface.height || r.vel.y >= 0) return false;
  if (piece.role === 'LandingRamp') {
    landOnRamp(s, feature, air, surface, local.u, local.v);
    return true;
  }
  if (!isMain) {
    crash(s, 'hitFeature');
    return true;
  }
  const heading = feature.shape.legacy ? feature.heading : pieceHeading(feature, piece);
  const yaw = wrapAngle(r.heading + air.rot.spinAngle - heading);
  const quarter = Math.round(yaw / (Math.PI / 2));
  const boardAngle = quarter * (Math.PI / 2);
  const offQuarter = Math.abs(yaw - boardAngle);
  const level = { ...air, rot: { ...air.rot, spinAngle: Math.round(air.rot.spinAngle / Math.PI) * Math.PI } };
  const landing = evaluateLanding(r, level, surface.normal, s.cfg);
  if (offQuarter > s.cfg.landing.maxYawError || landing.crash) {
    crash(s, landing.crash ?? 'badLandingYaw', landing);
    return true;
  }
  if (r.handle === 'passing') r.handle = 'inFront';
  const speed = Math.max(dot(r.vel, surface.tangent) * landingSpeedKeep(s.cfg, landing.impact, landing.clean), s.cfg.feature.stallSpeed + 0.5);
  r.air = null;
  mountMain(s, feature, piece, local.u, local.v, speed, air.pendingEntry ?? 'ollieOn', false, boardAngle);
  s.events.push({ type: 'landed', tick: s.tick, air, landing, onFeature: true });
  s.events.push({ type: 'featureEnter', tick: s.tick, featureId: feature.def.id });
  return true;
}
