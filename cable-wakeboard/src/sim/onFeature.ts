import { cos } from './math/detmath';
import type { SimConfig } from './config';
import { deg, DT, GRAVITY } from './config';
import { edgeNorm, toeSign, updateEdge } from './edge';
import { featureUnder, surfaceAt, toWorld } from './features';
import { transition } from './fsm';
import { updateHandle } from './handle';
import type { InputFrame, InputMemory } from './input';
import { approach, mod, sign, wrapAngle } from './math/scalar';
import { valueNoise } from './math/noise';
import { add, dot, forwardOf, horizontal, horizontalLength, rightOf, scale } from './math/vec';
import type { ResolvedFeature, SliderDef } from './park';
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
 * Kickers and obstacles (spec section 9): riding up a kicker ramp to the lip,
 * the safety (sloped entry) of a box or rail with its pop window, sliding the
 * main with 90-degree board rotations and a balance meter, and landing on a
 * main from the air.
 */

const featureById = (s: SimState, id: string): ResolvedFeature => {
  const f = s.features.find((x) => x.def.id === id);
  if (!f) throw new Error(`unknown feature ${id}`);
  return f;
};

/** The safety's pop window: from `start` (m along the feature) to the end of the safety. */
export function safetyWindow(def: SliderDef, cfg: SimConfig): { start: number; end: number } {
  const len = Math.max(def.entryLength * cfg.safety.popWindowFraction, cfg.safety.popWindowMinMetres);
  return { start: Math.max(0, def.entryLength - len), end: def.entryLength };
}

/**
 * Called from the water step after moving. If the rider is now over a
 * feature, ride onto it (kicker ramp or safety, from the start, roughly
 * aligned, at a low surface) or crash into it. Returns true if the rider left
 * the water modes.
 */
export function tryEnterFeature(s: SimState): boolean {
  const r = s.rider;
  const hit = featureUnder(s.features, r.pos);
  if (!hit) return false;
  const { feature, local, surface } = hit;
  const speed = horizontalLength(r.vel);
  const along = speed > 0.1 ? dot(horizontal(r.vel), forwardOf(feature.heading)) / speed : 0;
  if (r.mode === 'ridingBlind' || surface.height > s.cfg.feature.mountHeight || along < cos(s.cfg.feature.mountAngle)) {
    crash(s, 'hitFeature');
    return true;
  }
  r.ramp = { featureId: feature.def.id, u: local.u, v: local.v, releaseTick: -1, releaseTimeToLip: -1, sketchy: false };
  transition(s, feature.def.kind === 'kicker' ? 'onKicker' : 'onSafety', 'rideOn');
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
function leaveFeature(s: SimState, f: ResolvedFeature, popSpeed: number, popQuality: number): AirState {
  const r = s.rider;
  const spinStart = r.jib ? wrapAngle(r.jib.boardAngle) : 0;
  const keepHandle = r.handle;
  endSlide(s);
  s.events.push({ type: 'featureExit', tick: s.tick, featureId: f.def.id });
  const onMain = !!r.ramp && !!surfaceAt(f, { u: r.ramp.u, v: r.ramp.v })?.onTop;
  const air = takeOff(s, f.def.kind === 'kicker' ? 'kicker' : 'feature', f.def.id, popSpeed, popQuality, spinStart);
  // Already above the part being left: the clearance check is for parts flown onto.
  air.overFeature = `${f.def.id}:${onMain ? 'main' : 'ramp'}`;
  r.handle = keepHandle === 'passing' ? 'inFront' : keepHandle;
  return air;
}

/** One tick on a kicker ramp or a safety. */
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
    leaveFeature(s, f, 0, 0);
    return;
  }
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
    if (f.def.kind === 'kicker') {
      ramp.releaseTimeToLip = (f.def.length - ramp.u) / horizontalSpeed;
    } else {
      // Safety pop: only the last part of the safety counts.
      const w = safetyWindow(f.def, cfg);
      if (ramp.u >= w.start) {
        const centre = (w.start + w.end) / 2;
        const perfect = Math.abs(ramp.u - centre) <= (cfg.safety.perfectFraction * (w.end - w.start)) / 2;
        mountMain(s, f, ramp.u, ramp.v, vt, perfect ? 'popOn' : 'pop', ramp.sketchy);
        return;
      }
      if (f.def.safety === 'gap') {
        crash(s, 'missedSafetyPop');
        return;
      }
      ramp.sketchy = true;
    }
  }

  ramp.u += vt * dot(t, forwardOf(f.heading)) * DT;
  ramp.v += vl * DT;
  const next = surfaceAt(f, { u: ramp.u, v: ramp.v });
  if (f.def.kind === 'slider' && next && next.onTop) {
    // Reached the main without a valid pop.
    if (f.def.safety === 'gap') {
      crash(s, 'missedSafetyPop');
      return;
    }
    mountMain(s, f, ramp.u, ramp.v, vt, 'rideOn', ramp.sketchy);
    return;
  }
  if (!next) {
    // Off the lip, or off the side: momentum carries on.
    r.vel = add(scale(t, vt), scale(right, vl));
    r.pos = toWorld(f, ramp.u, ramp.v, surface.height);
    let popSpeed = 0;
    let quality = 0;
    const lipPop = f.def.kind === 'kicker' && ramp.releaseTimeToLip >= 0 && ramp.releaseTimeToLip <= cfg.kicker.lipPopWindow;
    if (lipPop && r.vel.y > 0) {
      popSpeed = r.vel.y * cfg.kicker.lipPopBonus;
      quality = 1 - ramp.releaseTimeToLip / cfg.kicker.lipPopWindow;
    }
    const air = leaveFeature(s, f, popSpeed, quality);
    air.lipPop = lipPop;
    return;
  }
  r.pos = toWorld(f, ramp.u, ramp.v, next.height);
  r.vel = add(scale(next.tangent, vt), scale(right, vl));
  r.heading = f.heading;
}

/** Get onto the main of a box or rail: from the safety, or landing from the air. */
function mountMain(
  s: SimState,
  f: ResolvedFeature,
  u: number,
  v: number,
  speed: number,
  entry: JibState['entry'],
  sketchy: boolean,
  boardAngle = 0,
): void {
  const r = s.rider;
  const top = surfaceAt(f, { u: Math.max(u, (f.def as SliderDef).entryLength), v });
  const height = top ? top.height : f.def.height;
  r.ramp = { featureId: f.def.id, u: Math.max(u, (f.def as SliderDef).entryLength), v, releaseTick: -1, releaseTimeToLip: -1, sketchy };
  r.pos = toWorld(f, r.ramp.u, v, height);
  r.vel = scale(forwardOf(f.heading), Math.max(speed, s.cfg.feature.stallSpeed + 0.5));
  r.heading = f.heading;
  r.jib = startJib(s, f, boardAngle, entry, sketchy);
  r.popCharge = 0;
  transition(s, 'onFeature', entry);
}

/** One tick sliding the main of a box or rail (spec section 9.4). */
export function stepSlide(s: SimState, input: InputFrame, mem: InputMemory): void {
  const { rider: r, cfg } = s;
  const ramp = r.ramp;
  const j = r.jib;
  if (!ramp || !j) throw new Error('onFeature without RampState / JibState');
  const f = featureById(s, ramp.featureId);
  const def = f.def as SliderDef;
  const m = cfg.rider.mass;
  updatePosture(r, input.armsOut ? 0 : 1, input.pop, r.ropeTension, cfg.posture, DT);
  const rope = applyRope(s);
  if (!rope) return;
  const surface = surfaceAt(f, { u: ramp.u, v: ramp.v });
  if (!surface || !surface.onTop) {
    leaveFeature(s, f, 0, 0);
    return;
  }
  const t = surface.tangent;
  const right = rightOf(f.heading);
  let vt = dot(r.vel, t);
  let vl = dot(r.vel, right);
  const at = (dot(rope.force, t) - cfg.feature.friction * m * GRAVITY * sign(vt)) / m;
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
      j.rot.spinSide = rotationSide(dir, f.heading + j.boardAngle, toeSign(r), r.ropeHeading);
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
    const drift = def.style === 'box' ? cfg.feature.balanceDriftBox : cfg.feature.balanceDriftRail;
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
    const id = slideIdAt(j.boardAngle, f.heading, f.heading, r);
    j.slideTimes[id] += DT;
    if (j.slideOrder.length === 0 || j.slideOrder[j.slideOrder.length - 1] !== id) j.slideOrder.push(id);
  }

  if (input.pop) r.popCharge = ollieCharge(mem.popHeldTime, cfg);
  if (mem.popReleased) {
    const charge = ollieCharge(mem.popHeldTime, cfg);
    leaveFeature(s, f, ollieSpeed(charge, cfg), charge);
    return;
  }

  ramp.u += vt * dot(t, forwardOf(f.heading)) * DT;
  ramp.v += vl * DT;
  const next = surfaceAt(f, { u: ramp.u, v: ramp.v });
  if (!next || !next.onTop) {
    if (Math.abs(ramp.v) > def.width / 2 + 0.3) {
      endSlide(s);
      crash(s, 'fellOffFeature');
      return;
    }
    // Off the end: roll off with whatever speed there is.
    r.vel = add(scale(t, vt), scale(right, vl));
    r.pos = toWorld(f, ramp.u, ramp.v, surface.height);
    leaveFeature(s, f, 0, 0);
    return;
  }
  r.pos = toWorld(f, ramp.u, ramp.v, next.height);
  r.vel = add(scale(next.tangent, vt), scale(right, vl));
  r.heading = f.heading;
}

/**
 * In the air over a feature. Coming in below a main's top plus
 * `ollie.clearance` clips its edge (short ollie); coming down on a kicker or a
 * safety is a crash; coming down on a main with the board near a multiple of
 * 90 degrees to it starts a slide. Returns true if a feature handled it.
 */
export function airOverFeature(s: SimState, air: AirState): boolean {
  const r = s.rider;
  const hit = featureUnder(s.features, r.pos);
  if (!hit) {
    air.overFeature = null;
    return false;
  }
  const { feature, local, surface } = hit;
  const part = `${feature.def.id}:${surface.onTop ? 'main' : 'ramp'}`;
  const isMain = feature.def.kind === 'slider' && surface.onTop;
  const clearance = isMain ? s.cfg.ollie.clearance : 0;
  if (air.overFeature !== part) {
    if (r.pos.y < surface.height + clearance) {
      crash(s, isMain ? 'shortOllie' : 'hitFeature');
      return true;
    }
    air.overFeature = part;
  }
  if (r.pos.y > surface.height || r.vel.y >= 0) return false;
  if (!isMain) {
    crash(s, 'hitFeature');
    return true;
  }
  const yaw = wrapAngle(r.heading + air.rot.spinAngle - feature.heading);
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
  mountMain(s, feature, local.u, local.v, speed, 'ollieOn', false, boardAngle);
  s.events.push({ type: 'landed', tick: s.tick, air, landing, onFeature: true });
  s.events.push({ type: 'featureEnter', tick: s.tick, featureId: feature.def.id });
  return true;
}
