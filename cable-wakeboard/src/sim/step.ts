import { applyRope, crash, takeOff, touchDown } from './actions';
import { stepAir } from './air';
import { stepCarrier } from './cable';
import { DT, GRAVITY } from './config';
import { carveToEdge, updateEdge, updateHeading } from './edge';
import { inAir, onWater, transition } from './fsm';
import { computeHydroForces } from './hydro';
import { edgeNorm } from './edge';
import { type InputFrame, updateInputMemory } from './input';
import { addScaled, horizontalLength, scale, UP, vec3, add } from './math/vec';
import { airOverFeature, stepRamp, stepSlide, stepSlideOnContact, tryEnterFeature } from './onFeature';
import { leadCrossing, predictSlideOn, stepNoseLift } from './featureRide/slideOn';
import { trackApproach } from './featureRide/approachTracker';
import { landedInGap, startEntry } from './featureRide/entryResolver';
import { stepExitAssist } from './featureRide/exitResolver';
import { markSpineFlat, spineFlatLanding } from './featureRide/featureSpecials';
import { sign } from './math/scalar';
import { ollieCharge, ollieSpeed, waterTrickTiming } from './pop';
import { updatePosture } from './posture';
import { canArm, planWaterTrick, shouldDisarm } from './waterTrick';
import type { SimState } from './world';

export { hipPosition, takeOff } from './actions';

/**
 * On the water: riding, riding blind, loaded for a water trick, or the short
 * landing grace. Rope, planing forces, edge and heading, then what the
 * buttons do in this mode.
 */
function stepWater(s: SimState, input: InputFrame): void {
  const { rider: r, cfg } = s;
  const mem = s.inputs;
  const m = cfg.rider.mass;
  const blind = r.mode === 'ridingBlind';

  // Riding blind: A/D spins back out the way the rider came; the other way catches an edge.
  // A pop on the same tick wins: the spin-out then happens in the air.
  if (blind && !r.spinOut && !mem.popReleased) {
    r.blindTime += DT;
    const pressed = mem.steerDir !== 0 && mem.steerHeldTime === 0;
    if (pressed && mem.steerDir === -r.blindDir) r.spinOut = { time: cfg.blind.spinOutTime, dir: mem.steerDir };
    else if (pressed || r.blindTime > cfg.blind.maxRideTime) {
      crash(s, 'caughtEdgeBlind');
      return;
    }
  }

  const steer = blind ? input.steer * cfg.blind.steerFactor : input.steer;
  const edgeLimit = blind ? cfg.blind.maxEdge : 1;
  const request = r.mode === 'landing' || r.handle === 'dropped' ? 0 : Math.max(-edgeLimit, Math.min(edgeLimit, carveToEdge(r, steer)));
  updatePosture(r, input.armsOut ? 0 : 1, input.pop, r.ropeTension, cfg.posture, DT);
  updateEdge(r, request, cfg.edge, DT);
  const rope = applyRope(s);
  if (!rope) return;
  const hydro = computeHydroForces(r.vel, r.heading, edgeNorm(r, cfg.edge), cfg.hydro);
  r.edgeLoad = hydro.edgeLoad;
  const horizontalForce = add(vec3(rope.force.x, 0, rope.force.z), hydro.force);
  r.vel = addScaled(r.vel, scale(horizontalForce, 1 / m), DT);
  r.vel = vec3(r.vel.x, 0, r.vel.z);
  r.pos = addScaled(r.pos, r.vel, DT);
  r.pos = vec3(r.pos.x, 0, r.pos.z);
  updateHeading(r, r.ropeHeading, rope.tension, horizontalLength(r.vel), cfg.edge, DT);
  trackApproach(s);
  if (input.pop) r.popCharge = ollieCharge(mem.popHeldTime, cfg);

  if (r.spinOut) {
    r.spinOut.time -= DT;
    if (r.spinOut.time <= 0) {
      r.spinOut = null;
      r.switchStance = !r.switchStance;
      r.handle = 'inFront';
      r.blindDir = 0;
      transition(s, 'riding', 'spinOut');
      s.events.push({ type: 'blindSpinOut', tick: s.tick });
    }
    return;
  }

  if (r.mode === 'landing') {
    if (r.modeTime >= cfg.landing.graceTime) transition(s, r.handle === 'behind' ? 'ridingBlind' : 'riding', 'graceOver');
    else return;
  }

  if (mem.popReleased) {
    const charge = ollieCharge(mem.popHeldTime, cfg);
    if (r.mode === 'waterTrickLoad') {
      const plan = planWaterTrick(r.tensionSmooth, waterTrickTiming(r, cfg, DT), input, cfg);
      const air = takeOff(s, 'waterTrick', null, plan.vy, plan.trick.timing);
      air.trick = plan.trick;
      return;
    }
    const air = takeOff(s, r.mode === 'ridingBlind' ? 'blindPop' : 'flat', null, ollieSpeed(charge, cfg), charge);
    startEntry(s, air, sign(input.steer), charge);
    predictSlideOn(s, air, ollieSpeed(charge, cfg));
    return;
  }
  if (r.mode === 'riding' && canArm(r, cfg)) transition(s, 'waterTrickLoad', 'loaded');
  else if (r.mode === 'waterTrickLoad' && shouldDisarm(r, cfg)) transition(s, 'riding', 'unloaded');

  if (tryEnterFeature(s)) return;
  if (!input.pop && rope.force.y > m * GRAVITY * cfg.hydro.liftOffFactor && r.mode !== 'ridingBlind') {
    // A loading rider is pressing into the water; otherwise a big pull lifts them off.
    takeOff(s, 'lineLift', null, 0, 0);
  }
}

function stepAirborne(s: SimState, input: InputFrame): void {
  const { rider: r, cfg } = s;
  const air = r.air;
  if (!air) throw new Error('air mode without AirState');
  updatePosture(r, input.armsOut ? 0 : 1, false, r.ropeTension, cfg.posture, DT);
  updateEdge(r, 0, cfg.edge, DT);
  r.edgeLoad = 0;
  const rope = applyRope(s);
  if (!rope) return;
  // A slide-on climbing over the side edge (slideOn.ts) instead of flying.
  if (stepSlideOnContact(s, air, input)) return;
  if (stepAir(r, air, rope.force, input, s.inputs, cfg)) s.events.push({ type: 'handlePass', tick: s.tick });
  stepExitAssist(s, air, input);
  stepNoseLift(s, air, input);
  const lead = leadCrossing(s, air);
  if (lead === 'noseDig' || lead === 'hangUp') {
    crash(s, lead);
    return;
  }
  if (lead === 'contact') return;
  if (airOverFeature(s, air)) return;
  if (r.pos.y <= 0 && r.vel.y < 0) {
    const spine = spineFlatLanding(s, air);
    if (landedInGap(s, air)) crash(s, 'landedInGap');
    else if (spine === 'hard') crash(s, 'hardLanding');
    else {
      const landing = touchDown(s, air, UP, 0);
      if (spine === 'flat') markSpineFlat(landing);
    }
  }
}

function stepCrashed(s: SimState): void {
  const { rider: r, cfg } = s;
  r.vel = addScaled(r.vel, scale(r.vel, -cfg.hydro.fallenDrag / cfg.rider.mass), DT);
  r.pos = addScaled(r.pos, r.vel, DT);
  r.crashTimer = Math.max(0, r.crashTimer - DT);
  r.ropeTension = 0;
  r.ropeForce = vec3();
  r.edgeLoad = 0;
}

/**
 * Advance the whole sim by one fixed tick. Deterministic: depends only on the
 * state and the input.
 */
export function stepSim(s: SimState, input: InputFrame): void {
  s.events = [];
  updateInputMemory(s.inputs, input, s.cfg, DT);
  stepCarrier(s.carrier, s.path, s.cfg.cable.carrierSpeed, DT);
  const r = s.rider;
  const mode = r.mode;
  if (onWater(mode)) stepWater(s, input);
  else if (inAir(mode)) stepAirborne(s, input);
  else if (mode === 'onKicker' || mode === 'onSafety') stepRamp(s, input, s.inputs);
  else if (mode === 'onFeature') stepSlide(s, input, s.inputs);
  else stepCrashed(s);

  // Letting go (X): an immediate crash on a surface; in the air the landing crashes.
  if (input.letGo && r.handle !== 'dropped' && r.mode !== 'crashed') {
    if (inAir(r.mode)) r.handle = 'dropped';
    else crash(s, 'letGo');
  }
  r.modeTime += DT;
  s.tick += 1;
  s.time = s.tick * DT;
}
