import { finishLine } from './featureRide/exitResolver';
import { createAirState } from './air';
import { landingSpeedKeep } from './bodyPhysics';
import { DT } from './config';
import { transition } from './fsm';
import { evaluateLanding, type LandingResult } from './landing';
import { type Vec3, add, addScaled, headingOf, horizontalLength, normalize, scale, sub, UP, vec3 } from './math/vec';
import { updateTensionTracker } from './pop';
import type { AirState, CrashReason, TakeoffSource } from './rider';
import { type RopeResult, computeRopeTension } from './rope';
import type { SimState } from './world';

/** Rider state transitions and helpers shared by the per-mode steps. */

/** Hips position: the handle is held here, so the rope's stretch is measured from it. Bent knees lower it. */
export const hipPosition = (s: SimState): Vec3 =>
  addScaled(s.rider.pos, UP, s.cfg.rider.hipHeight * (1 - 0.35 * s.rider.legCompression));

/**
 * Where the pull reaches the body (section 11): through the arms to the
 * shoulders. The stretch (and so the tension) is still measured at the
 * handle; only the direction of the force changes. Off: the hips.
 */
const pullPoint = (s: SimState): Vec3 =>
  s.cfg.physics.ropeAtShoulders ? addScaled(s.rider.pos, UP, s.cfg.physics.shoulderHeight * (1 - 0.35 * s.rider.legCompression)) : hipPosition(s);

/** Off balance: a snap back to taut can yank the rider over. */
const offBalance = (s: SimState): boolean =>
  s.rider.connection < 0.6 || s.rider.mode === 'landing' || s.rider.mode === 'ridingBlind';

/**
 * Rope tension this tick: one-sided spring-damper, capped at `rope.maxTension`
 * (and at `blind.maxTension` while riding blind), smoothed for the HUD and
 * trick logic. A hard snap back to taut while off balance crashes (rope yank).
 * Returns null when the yank crashed the rider.
 */
export function applyRope(s: SimState): RopeResult | null {
  const { rider, cfg } = s;
  if (rider.handle === 'dropped') {
    rider.ropeTension = 0;
    rider.ropeForce = vec3();
    updateTensionTracker(rider, cfg, DT);
    return { tension: 0, dir: UP, force: vec3(), stretch: -1, stretchRate: 0 };
  }
  const raw = computeRopeTension(s.carrier.pos, s.carrier.vel, hipPosition(s), rider.vel, cfg.rope.length + rider.handleDist, cfg.rope);
  const cap = rider.mode === 'ridingBlind' ? Math.min(cfg.rope.maxTension, cfg.blind.maxTension) : cfg.rope.maxTension;
  const tension = Math.min(raw.tension, cap);
  const dir = s.cfg.physics.ropeAtShoulders ? normalize(sub(s.carrier.pos, pullPoint(s))) : raw.dir;
  const rope: RopeResult = { ...raw, dir, tension, force: scale(dir, tension) };
  const wasSlack = rider.ropeTension <= 0;
  if (rope.tension <= 0) {
    rider.slackTime += DT;
  } else {
    if (wasSlack && rider.slackTime > 0.2 && rope.stretchRate > cfg.rope.snapRate) {
      s.events.push({ type: 'ropeSnap', tick: s.tick, stretchRate: rope.stretchRate });
    }
    rider.slackTime = 0;
  }
  rider.ropeTension = rope.tension;
  rider.ropeForce = rope.force;
  rider.ropeHeading = headingOf(rope.dir);
  updateTensionTracker(rider, cfg, DT);
  const onSurface = rider.mode !== 'airborne' && rider.mode !== 'waterTrickAir';
  if (wasSlack && onSurface && raw.tension > cfg.rope.yankCrashImpulse && offBalance(s)) {
    crash(s, 'ropeYank');
    return null;
  }
  return rope;
}

/**
 * Every crash goes through here (spec section 12): the handle goes, the rope
 * goes slack, the combo is voided by the session, and the rider waits
 * `crash.respawnDelay` in the water.
 */
export function crash(s: SimState, reason: CrashReason, landing: LandingResult | null = null): void {
  const r = s.rider;
  s.events.push({ type: 'crash', tick: s.tick, reason, air: r.air, landing });
  transition(s, 'crashed', reason);
  r.lastCrash = reason;
  r.crashTimer = s.cfg.crash.respawnDelay;
  r.handle = 'dropped';
  r.connection = 0;
  r.edgeAngle = 0;
  r.air = null;
  r.ramp = null;
  r.jib = null;
  r.spinOut = null;
  r.ropeTension = 0;
  r.ropeForce = vec3();
  r.pos = vec3(r.pos.x, 0, r.pos.z);
  r.vel = vec3(r.vel.x, 0, r.vel.z);
}

/** Leave the surface with an upward speed and start an AirState. */
export function takeOff(
  s: SimState,
  source: TakeoffSource,
  featureId: string | null,
  popSpeed: number,
  popQuality: number,
  spinStart = 0,
): AirState {
  const r = s.rider;
  r.vel = add(r.vel, vec3(0, popSpeed, 0));
  r.pos = addScaled(r.pos, UP, 1e-3);
  const air = createAirState(r, source, featureId, popSpeed, popQuality, s.cfg, spinStart);
  if (s.inputs.steerAge <= s.cfg.physics.preWindWindow) air.preWind = s.inputs.lastSteerDir;
  r.air = air;
  r.ramp = null;
  r.jib = null;
  r.popCharge = 0;
  transition(s, source === 'waterTrick' ? 'waterTrickAir' : 'airborne', source);
  s.events.push({ type: 'takeoff', tick: s.tick, source, popSpeed, popQuality });
  return air;
}

/**
 * Touch down on the water. Crashes if the landing fails; otherwise goes to
 * the short `landing` grace state, then riding (or riding blind).
 */
export function touchDown(s: SimState, air: AirState, normal: Vec3, surfaceY: number): LandingResult {
  const r = s.rider;
  const landing = evaluateLanding(r, air, normal, s.cfg);
  r.pos = vec3(r.pos.x, surfaceY, r.pos.z);
  if (landing.crash) {
    crash(s, landing.crash, landing);
    return landing;
  }
  if (Math.abs(Math.round(air.rot.spinAngle / Math.PI)) % 2 === 1) r.switchStance = !r.switchStance;
  if (r.handle === 'passing') r.handle = 'inFront';
  if (r.handle === 'behind') {
    r.blindDir = air.rot.blindDir !== 0 ? air.rot.blindDir : r.blindDir;
    r.blindTime = 0;
  }
  const keep = landingSpeedKeep(s.cfg, landing.impact, landing.clean);
  r.vel = vec3(r.vel.x * keep, 0, r.vel.z * keep);
  r.heading = horizontalLength(r.vel) > 0.5 ? headingOf(r.vel) : air.takeoffHeading;
  r.air = null;
  transition(s, 'landing', 'touchdown');
  s.events.push({ type: 'landed', tick: s.tick, air, landing, onFeature: false });
  finishLine(s, air, landing);
  return landing;
}
