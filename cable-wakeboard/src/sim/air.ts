import type { SimConfig } from './config';
import { DT, GRAVITY } from './config';
import { toeSign } from './edge';
import { updateHandle } from './handle';
import type { InputFrame, InputMemory } from './input';
import { type Vec3, add, addScaled, headingOf, horizontalLength, length, scale, vec3 } from './math/vec';
import type { AirState, RiderState, TakeoffSource } from './rider';
import { createRotation, rotationSide, stepFlip, stepSpin } from './rotation';
import { stepWaterTrick } from './waterTrick';

/** Handle-pass window for a takeoff (spec section 8.3). */
export function passWindowFor(source: TakeoffSource, cfg: SimConfig): number {
  const hp = cfg.handlePass;
  if (source === 'kicker') return hp.kickerWindow;
  if (source === 'feature') return hp.obstacleAirWindow;
  if (source === 'waterTrick') return hp.waterTrickWindow;
  return hp.flatAirWindow;
}

/** Snapshot the takeoff. `spinStart` is the board's yaw off the travel direction (e.g. leaving a feature in a boardslide). */
export function createAirState(
  r: RiderState,
  source: TakeoffSource,
  featureId: string | null,
  popSpeed: number,
  popQuality: number,
  cfg: SimConfig,
  spinStart = 0,
): AirState {
  const rot = createRotation(passWindowFor(source, cfg));
  rot.spinAngle = spinStart;
  const fromBlind = source === 'blindPop';
  if (fromBlind) {
    // Already turned 180 against the rope with the handle behind the back.
    rot.spinSide = 'backside';
    rot.startDir = r.blindDir;
    rot.spinDir = r.blindDir;
    rot.progressOffset = Math.PI;
    rot.zonesResolved = 1;
    rot.stoppedByRope = true;
    rot.blindDir = r.blindDir;
  }
  return {
    source,
    featureId,
    time: 0,
    takeoffPos: r.pos,
    takeoffHeading: headingOf(r.vel),
    takeoffSwitch: r.switchStance,
    tensionAtTakeoff: r.ropeTension,
    popSpeed,
    popQuality,
    peakHeight: r.pos.y,
    passedPeak: false,
    spinStart,
    rot,
    grab: null,
    grabTimes: { indy: 0, stalefish: 0, nose: 0, tail: 0 },
    trick: null,
    fromBlind,
    lipPop: false,
    overFeature: null,
  };
}

/** Air drag on the rider. */
const airDrag = (vel: Vec3, cfg: SimConfig): Vec3 => scale(vel, -cfg.air.dragCoef * length(vel));

/**
 * Integrate one airborne tick: gravity, rope, drag; then spins (A/D), flips
 * (W/S, not during a water trick), grabs, handle passes and the water trick.
 * `ropeForce` is computed by the caller (step.ts) this tick. Returns true if
 * a pass was made this tick.
 */
export function stepAir(r: RiderState, air: AirState, ropeForce: Vec3, input: InputFrame, mem: InputMemory, cfg: SimConfig): boolean {
  const m = cfg.rider.mass;
  const force = add(add(vec3(0, -GRAVITY * m, 0), ropeForce), airDrag(r.vel, cfg));
  r.vel = addScaled(r.vel, force, DT / m);
  r.pos = addScaled(r.pos, r.vel, DT);
  if (horizontalLength(r.vel) > 0.5) r.heading = headingOf(r.vel);

  air.time += DT;
  air.peakHeight = Math.max(air.peakHeight, r.pos.y);
  if (!air.passedPeak && r.vel.y <= 0) air.passedPeak = true;

  // A water trick may take the A/D press for an S-bend.
  const steerForSpin = air.trick ? stepWaterTrick(air.trick, input, mem, cfg) : mem.steerDir;
  const toes = toeSign({ stance: r.stance, switchStance: air.takeoffSwitch });
  const boardYaw = r.heading + air.rot.spinAngle;
  stepSpin(air.rot, steerForSpin, () => rotationSide(steerForSpin, boardYaw, toes, r.ropeHeading), cfg, DT, cfg.spin.rate);
  if (!air.trick) stepFlip(air.rot, input.forward ? 1 : input.back ? -1 : 0, cfg, DT, 1);

  air.grab = mem.grabChoice;
  if (air.grab) air.grabTimes[air.grab] += DT;

  const h = updateHandle(r.handle, air.rot, mem.passPressed, { rate: cfg.spin.rate, inAir: true }, cfg, DT);
  r.handle = h.handle;
  return h.result.passed;
}
