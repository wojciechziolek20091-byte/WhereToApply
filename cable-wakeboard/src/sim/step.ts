import { createAirState, stepAir } from './air';
import { stepCarrier } from './cable';
import { DT, GRAVITY } from './config';
import { edgeNorm, updateEdge, updateHeading } from './edge';
import { computeHydroForces } from './hydro';
import type { InputFrame } from './input';
import { evaluateLanding, type LandingResult } from './landing';
import { type Vec3, add, addScaled, headingOf, horizontalLength, scale, UP, vec3 } from './math/vec';
import { computePop, flatPopInputs, updateLoadTracker } from './pop';
import { updatePosture } from './posture';
import type { AirState, FallKind, RiderMode, TakeoffSource } from './rider';
import { type RopeResult, computeRopeTension } from './rope';
import type { SimState } from './world';

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
function checkGrip(s: SimState, input: InputFrame): boolean {
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

/** On the water: rope, planing forces, edge and heading. */
function stepRiding(s: SimState, input: InputFrame): void {
  const { rider, cfg } = s;
  const m = cfg.rider.mass;
  const released = popReleased(s, input);
  const compression = rider.legCompression;
  updatePosture(rider, input.handleIn, input.load, rider.ropeTension, cfg.posture, DT);
  updateEdge(rider, rider.hasHandle ? input.edge : 0, cfg.edge, DT);

  const rope = applyRope(s);
  const hydro = computeHydroForces(rider.vel, rider.heading, edgeNorm(rider, cfg.edge), cfg.hydro);
  rider.edgeLoad = hydro.edgeLoad;
  updateLoadTracker(rider.load, rider.edgeLoad, cfg.pop, DT);

  const horizontalForce = add(vec3(rope.force.x, 0, rope.force.z), hydro.force);
  rider.vel = addScaled(rider.vel, scale(horizontalForce, 1 / m), DT);
  rider.vel = vec3(rider.vel.x, 0, rider.vel.z);
  rider.pos = addScaled(rider.pos, rider.vel, DT);
  rider.pos = vec3(rider.pos.x, 0, rider.pos.z);
  updateHeading(rider, rider.ropeHeading, rope.tension, horizontalLength(rider.vel), cfg.edge, DT);
  rider.loadHeld = input.load;

  if (released) {
    const pop = computePop(
      flatPopInputs(rider.load, rider.edgeLoad, rope.tension, rider.connection, compression, cfg.pop),
      cfg.pop,
    );
    takeOff(s, 'flat', null, pop.speed, pop.quality, rider.load.peakEdgeLoad, input);
  } else if (!input.load && rope.force.y > m * GRAVITY * cfg.hydro.liftOffFactor) {
    // A loading rider is pressing into the water; otherwise a big pull lifts them off.
    takeOff(s, 'lineLift', null, 0, 0, rider.load.peakEdgeLoad, input);
  }
}

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

function stepAirborne(s: SimState, input: InputFrame): void {
  const { rider, cfg } = s;
  const air = rider.air;
  if (!air) throw new Error('air mode without AirState');
  updatePosture(rider, input.handleIn, input.load, rider.ropeTension, cfg.posture, DT);
  updateEdge(rider, 0, cfg.edge, DT);
  rider.edgeLoad = 0;
  rider.extendTimer = Math.max(0, rider.extendTimer - DT);
  const rope = applyRope(s);
  stepAir(rider, air, rope.force, input, cfg);
  rider.loadHeld = input.load;
  if (rider.pos.y <= 0 && rider.vel.y < 0) touchDown(s, air, UP, 0);
}

function stepFallen(s: SimState): void {
  const { rider, cfg } = s;
  rider.vel = addScaled(rider.vel, scale(rider.vel, -cfg.hydro.fallenDrag / cfg.rider.mass), DT);
  rider.pos = addScaled(rider.pos, rider.vel, DT);
  rider.fallTimer = Math.max(0, rider.fallTimer - DT);
  rider.ropeTension = 0;
  rider.ropeForce = vec3();
  rider.edgeLoad = 0;
}

/**
 * Advance the whole sim by one fixed tick. Deterministic: depends only on the
 * state and the input.
 */
export function stepSim(s: SimState, input: InputFrame): void {
  s.events = [];
  stepCarrier(s.carrier, s.path, s.cfg.cable.carrierSpeed, DT);
  const rider = s.rider;
  switch (rider.mode) {
    case 'riding':
      stepRiding(s, input);
      break;
    case 'air':
      stepAirborne(s, input);
      break;
    case 'feature':
      break;
    case 'fallen':
      stepFallen(s);
      break;
  }
  if (rider.mode !== 'fallen' && checkGrip(s, input) && rider.mode !== 'air') {
    fallRider(s, 'droppedHandle');
  }
  rider.modeTime += DT;
  s.tick += 1;
  s.time = s.tick * DT;
}
