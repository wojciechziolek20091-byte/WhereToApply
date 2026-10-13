import { createAirState } from './air';
import { DT } from './config';
import type { InputFrame } from './input';
import { evaluateLanding, type LandingResult } from './landing';
import { type Vec3, add, addScaled, headingOf, horizontalLength, UP, vec3 } from './math/vec';
import type { AirState, FallKind, RiderMode, TakeoffSource } from './rider';
import { type RopeResult, computeRopeTension } from './rope';
import type { SimState } from './world';

/** Rider state transitions and helpers shared by the per-mode steps. */

/** Hips position: the rope attaches here. Bent knees lower the hips. */
export const hipPosition = (s: SimState): Vec3 =>
  addScaled(s.rider.pos, UP, s.cfg.rider.hipHeight * (1 - 0.35 * s.rider.legCompression));

export function setMode(s: SimState, mode: RiderMode): void {
  if (s.rider.mode !== mode) {
    s.rider.mode = mode;
    s.rider.modeTime = 0;
  }
}

/** Rope tension this tick, with slack, snap and grip tracking. */
export function applyRope(s: SimState): RopeResult {
  const { rider, cfg } = s;
  if (!rider.hasHandle) {
    rider.ropeTension = 0;
    rider.ropeForce = vec3();
    return { tension: 0, dir: UP, force: vec3(), stretch: -1, stretchRate: 0 };
  }
  const rope = computeRopeTension(
    s.carrier.pos,
    s.carrier.vel,
    hipPosition(s),
    rider.vel,
    cfg.rope.length + rider.handleDist,
    cfg.rope,
  );
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
  rider.overGripTime = rope.tension > cfg.rope.gripLimit ? rider.overGripTime + DT : 0;
  return rope;
}

/** Let go, or have the handle ripped away. Returns true the tick it happens. */
export function checkGrip(s: SimState, input: InputFrame): boolean {
  const { rider, cfg } = s;
  if (!rider.hasHandle) return false;
  if (input.release || rider.overGripTime > cfg.rope.gripTime) {
    rider.hasHandle = false;
    rider.connection = 0;
    rider.ropeTension = 0;
    rider.ropeForce = vec3();
    return true;
  }
  return false;
}

export function fallRider(s: SimState, kind: FallKind, landing: LandingResult | null = null): void {
  const r = s.rider;
  s.events.push({ type: 'fall', tick: s.tick, kind, air: r.air, landing });
  setMode(s, 'fallen');
  r.lastFall = kind;
  r.fallTimer = s.cfg.landing.fallRecovery;
  r.hasHandle = false;
  r.connection = 0;
  r.edgeAngle = 0;
  r.air = null;
  r.ramp = null;
  r.jib = null;
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
  edgeLoadAtBase: number,
  input: InputFrame,
): void {
  const r = s.rider;
  r.vel = add(r.vel, vec3(0, popSpeed, 0));
  r.pos = addScaled(r.pos, UP, 1e-3);
  r.air = createAirState(r, source, featureId, popSpeed, popQuality, edgeLoadAtBase, input, s.cfg);
  r.ramp = null;
  r.jib = null;
  r.extendTimer = s.cfg.pop.extendTime;
  setMode(s, 'air');
  s.events.push({ type: 'takeoff', tick: s.tick, source, popSpeed, popQuality });
}

/** Load released this tick with bent knees: the legs extend. */
export const popReleased = (s: SimState, input: InputFrame): boolean =>
  s.rider.loadHeld && !input.load && s.rider.legCompression > 0.15;

/** Touch down on a surface. Returns the landing result. */
export function touchDown(s: SimState, air: AirState, normal: Vec3, surfaceY: number): LandingResult {
  const r = s.rider;
  const landing = evaluateLanding(r, air, normal, s.cfg);
  r.pos = vec3(r.pos.x, surfaceY, r.pos.z);
  if (landing.fall) {
    fallRider(s, landing.fall, landing);
    return landing;
  }
  if (Math.abs(landing.halfTurns) % 2 === 1) r.switchStance = !r.switchStance;
  r.vel = vec3(r.vel.x, 0, r.vel.z);
  r.heading = horizontalLength(r.vel) > 0.5 ? headingOf(r.vel) : air.takeoffHeading;
  r.air = null;
  r.load = { edgeLoadAtBase: 0, peakEdgeLoad: 0, peakAge: 0 };
  setMode(s, 'riding');
  s.events.push({ type: 'landed', tick: s.tick, air, landing });
  return landing;
}

