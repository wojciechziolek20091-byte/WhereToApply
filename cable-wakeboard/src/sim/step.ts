import { applyRope, checkGrip, fallRider, popReleased, takeOff, touchDown } from './actions';
import { stepAir } from './air';
import { stepCarrier } from './cable';
import { DT, GRAVITY } from './config';
import { edgeNorm, updateEdge, updateHeading } from './edge';
import { computeHydroForces } from './hydro';
import type { InputFrame } from './input';
import { add, addScaled, horizontalLength, scale, UP, vec3 } from './math/vec';
import { stepFeature, touchDownOnFeature, tryEnterFeature } from './onFeature';
import { computePop, flatPopInputs, updateLoadTracker } from './pop';
import { updatePosture } from './posture';
import type { SimState } from './world';

export { hipPosition, takeOff } from './actions';

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
    // Releasing on flat water, including just before a feature: that is
    // popping too early for the feature.
    const pop = computePop(
      flatPopInputs(rider.load, rider.edgeLoad, rope.tension, rider.connection, compression, cfg.pop),
      cfg.pop,
    );
    takeOff(s, 'flat', null, pop.speed, pop.quality, rider.load.peakEdgeLoad, input);
    return;
  }
  if (tryEnterFeature(s)) return;
  if (!input.load && rope.force.y > m * GRAVITY * cfg.hydro.liftOffFactor) {
    // A loading rider is pressing into the water; otherwise a big pull lifts them off.
    takeOff(s, 'lineLift', null, 0, 0, rider.load.peakEdgeLoad, input);
  }
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
  if (touchDownOnFeature(s, air)) return;
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
      stepFeature(s, input);
      break;
    case 'fallen':
      stepFallen(s);
      break;
  }
  // Losing the handle on the water or a feature is an immediate fall; in the
  // air it is judged on touchdown.
  if (rider.mode !== 'fallen' && checkGrip(s, input) && rider.mode !== 'air') {
    fallRider(s, 'droppedHandle');
  }
  rider.modeTime += DT;
  s.tick += 1;
  s.time = s.tick * DT;
}
