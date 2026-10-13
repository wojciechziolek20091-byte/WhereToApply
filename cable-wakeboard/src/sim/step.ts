import { stepCarrier } from './cable';
import { DT, GRAVITY } from './config';
import { edgeNorm, updateEdge, updateHeading } from './edge';
import { computeHydroForces } from './hydro';
import type { InputFrame } from './input';
import { type Vec3, add, addScaled, headingOf, horizontalLength, scale, vec3 } from './math/vec';
import { updatePosture } from './posture';
import type { RiderMode } from './rider';
import { type RopeResult, computeRopeTension } from './rope';
import type { SimState } from './world';

/** Hips position: the rope attaches here. Bent knees lower the hips. */
export const hipPosition = (s: SimState): Vec3 =>
  addScaled(s.rider.pos, vec3(0, 1, 0), s.cfg.rider.hipHeight * (1 - 0.35 * s.rider.legCompression));

export function setMode(s: SimState, mode: RiderMode): void {
  if (s.rider.mode !== mode) {
    s.rider.mode = mode;
    s.rider.modeTime = 0;
  }
}

/** Rope tension this tick, with slack, snap and grip tracking. */
function applyRope(s: SimState): RopeResult {
  const { rider, cfg } = s;
  const hip = hipPosition(s);
  if (!rider.hasHandle) {
    rider.ropeTension = 0;
    rider.ropeForce = vec3();
    return { tension: 0, dir: vec3(0, 1, 0), force: vec3(), stretch: -1, stretchRate: 0 };
  }
  const rope = computeRopeTension(
    s.carrier.pos,
    s.carrier.vel,
    hip,
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

/** Let go, or have the handle ripped away. */
function checkGrip(s: SimState, input: InputFrame): boolean {
  const { rider, cfg } = s;
  if (!rider.hasHandle) return false;
  if (input.release || rider.overGripTime > cfg.rope.gripTime) {
    rider.hasHandle = false;
    rider.connection = 0;
    return true;
  }
  return false;
}

/** On the water: rope, planing forces, edge and heading. */
function stepRiding(s: SimState, input: InputFrame): void {
  const { rider, cfg } = s;
  const m = cfg.rider.mass;
  updatePosture(rider, input.handleIn, input.load, rider.ropeTension, cfg.posture, DT);
  updateEdge(rider, rider.hasHandle ? input.edge : 0, cfg.edge, DT);

  const rope = applyRope(s);
  const hydro = computeHydroForces(rider.vel, rider.heading, edgeNorm(rider, cfg.edge), cfg.hydro);
  rider.edgeLoad = hydro.edgeLoad;

  const horizontalForce = add(vec3(rope.force.x, 0, rope.force.z), hydro.force);
  rider.vel = addScaled(rider.vel, scale(horizontalForce, 1 / m), DT);
  rider.vel = vec3(rider.vel.x, 0, rider.vel.z);
  rider.pos = addScaled(rider.pos, rider.vel, DT);
  rider.pos = vec3(rider.pos.x, 0, rider.pos.z);

  updateHeading(rider, rider.ropeHeading, rope.tension, horizontalLength(rider.vel), cfg.edge, DT);
  rider.loadHeld = input.load;
  void GRAVITY;
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
    default:
      break;
  }
  checkGrip(s, input);
  rider.modeTime += DT;
  s.tick += 1;
  s.time = s.tick * DT;
}
