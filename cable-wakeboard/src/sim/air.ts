import type { SimConfig } from './config';
import { DT, GRAVITY } from './config';
import { cutAngle, edgeNorm, toeSign } from './edge';
import type { InputFrame } from './input';
import { approach, lerp, sign, TAU } from './math/scalar';
import { type Vec3, add, addScaled, headingOf, horizontalLength, length, scale, vec3 } from './math/vec';
import { handleNorm } from './posture';
import type { AirState, Approach, RiderState, TakeoffSource } from './rider';

export function approachOf(r: RiderState, cfg: SimConfig): Approach {
  if (edgeNorm(r, cfg.edge) < 0.2) return 'neutral';
  return r.edgeAngle > 0 ? 'heelside' : 'toeside';
}

/** Snapshot the takeoff. Inverts and raleys are committed here. */
export function createAirState(
  r: RiderState,
  source: TakeoffSource,
  featureId: string | null,
  popSpeed: number,
  popQuality: number,
  edgeLoadAtBase: number,
  input: InputFrame,
  cfg: SimConfig,
): AirState {
  const cut = cutAngle(headingOf(r.vel), r.ropeHeading);
  const load = Math.max(edgeLoadAtBase, r.edgeLoad);
  return {
    source,
    featureId,
    time: 0,
    takeoffPos: r.pos,
    takeoffHeading: headingOf(r.vel),
    approach: approachOf(r, cfg),
    takeoffSwitch: r.switchStance,
    cutAtTakeoff: cut,
    edgeLoadAtTakeoff: load,
    tensionAtTakeoff: r.ropeTension,
    popSpeed,
    popQuality,
    peakHeight: r.pos.y,
    passedPeak: false,
    spinAngle: 0,
    spinStarted: false,
    spunBeforePeak: false,
    flipDir: sign(input.flip) as -1 | 0 | 1,
    flipAngle: 0,
    axis: Math.abs(cut) > cfg.air.rollAxisCut ? 'roll' : 'flip',
    grab: null,
    grabTime: 0,
    grabbed: null,
    raleyEligible: load >= cfg.raley.minEdgeLoad && r.ropeTension >= cfg.raley.minTension,
    raleyExtension: 0,
    raleyPeak: 0,
  };
}

/** Rotation speed multiplier: handle in spins fast, handle out spins slow. */
export const rotationFactor = (r: RiderState, cfg: SimConfig): number =>
  lerp(1, cfg.air.handleOutRotation, handleNorm(r, cfg.posture)) * (r.air?.grab ? 0.9 : 1);

/** Air drag on the rider. */
const airDrag = (vel: Vec3, cfg: SimConfig): Vec3 => scale(vel, -cfg.air.dragCoef * length(vel));

/**
 * Integrate one airborne tick: gravity, rope, drag, then rotation, grabs and
 * raley. `ropeForce` is computed by the caller (step.ts) this tick.
 */
export function stepAir(r: RiderState, air: AirState, ropeForce: Vec3, input: InputFrame, cfg: SimConfig): void {
  const m = cfg.rider.mass;
  const force = add(add(vec3(0, -GRAVITY * m, 0), ropeForce), airDrag(r.vel, cfg));
  r.vel = addScaled(r.vel, force, DT / m);
  r.pos = addScaled(r.pos, r.vel, DT);
  if (horizontalLength(r.vel) > 0.5) r.heading = headingOf(r.vel);

  air.time += DT;
  air.peakHeight = Math.max(air.peakHeight, r.pos.y);
  if (!air.passedPeak && r.vel.y <= 0) air.passedPeak = true;

  const rot = rotationFactor(r, cfg);

  // Spins: rotate while held. Starting before the peak costs height.
  if (input.spin !== 0) {
    if (!air.spinStarted) {
      air.spinStarted = true;
      if (!air.passedPeak && r.vel.y > 0.5) {
        air.spunBeforePeak = true;
        r.vel = vec3(r.vel.x, r.vel.y * (1 - cfg.air.earlySpinPenalty), r.vel.z);
      }
    }
    // +spin is frontside: chest opens toward travel, which is -toeSign in yaw.
    const frontside = -toeSign({ stance: r.stance, switchStance: air.takeoffSwitch });
    air.spinAngle += Math.sign(input.spin) * frontside * cfg.air.spinRate * rot * DT;
  }

  // Inverts: committed at takeoff, auto-rotate one full turn. Holding the
  // flip input past a full turn keeps rotating (over-rotation).
  if (air.flipDir !== 0) {
    const keepGoing = sign(input.flip) === air.flipDir;
    if (air.flipAngle < TAU || keepGoing) air.flipAngle += cfg.air.invertRate * rot * DT;
  }

  // Grabs: must be held long enough to count.
  if (input.grab) {
    if (air.grab === input.grab) air.grabTime += DT;
    else {
      air.grab = input.grab;
      air.grabTime = 0;
    }
    if (air.grabTime >= cfg.air.minGrabTime) air.grabbed = air.grab;
  } else {
    air.grab = null;
    air.grabTime = 0;
  }

  // Raley: swing the body up using the rope; must come back before landing.
  const raleyTarget = air.raleyEligible && input.raley && r.hasHandle ? 1 : 0;
  air.raleyExtension = approach(air.raleyExtension, raleyTarget, cfg.air.raleyRate * DT);
  air.raleyPeak = Math.max(air.raleyPeak, air.raleyExtension);
}
