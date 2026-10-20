import type { SimConfig } from './config';
import { DT, GRAVITY } from './config';
import { toeSign } from './edge';
import { updateHandle } from './handle';
import type { InputFrame, InputMemory } from './input';
import { type Vec3, add, addScaled, headingOf, horizontalLength, length, scale, vec3 } from './math/vec';
import type { AirState, RiderState, TakeoffSource } from './rider';
import { flipRateScale, preWindScale, spinRateScale } from './bodyPhysics';
import { createRotation, rotationSide, stepFlip, stepSpin } from './rotation';
import { stepWaterTrick } from './waterTrick';
import { approach, sign, wrapAngle } from './math/scalar';

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
    pendingEntry: null,
    entry: null,
    crossing: null,
    cleared: [],
    tailClip: false,
    exit: null,
    preWind: 0,
    slideOn: null,
    over: null,
    tap: false,
    sideTurn: null,
    sideTurned: false,
    sideTurnBack: false,
    noFlip: false,
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
  // Section 11: tuck sets the rate within a turn; a pre-wound spin is faster.
  const spinDir = steerForSpin !== 0 ? steerForSpin : air.rot.spinDir;
  const spinRate = cfg.spin.rate * spinRateScale(cfg, air.rot) * preWindScale(cfg, air.preWind, spinDir);
  if (air.sideTurn && (steerForSpin !== 0 || air.trick)) air.sideTurn = null;
  if (air.sideTurn) {
    // Turning the board sideways onto the feature (a boardslide), unless A/D spins it.
    const yaw = wrapAngle(air.takeoffHeading + air.rot.spinAngle - air.sideTurn.axis);
    const rem = air.sideTurn.target - yaw;
    const dir = sign(rem);
    if (dir !== 0 && air.rot.spinSide === null) {
      air.rot.spinSide = rotationSide(dir, boardYaw, toes, r.ropeHeading);
      air.rot.startDir = dir;
    }
    if (dir !== 0) air.rot.spinDir = dir;
    air.rot.spinAngle += approach(0, rem, cfg.slideOn.SideTurnRate * DT);
    air.rot.maxSpin = Math.max(air.rot.maxSpin, Math.abs(air.rot.spinAngle));
    if (Math.abs(rem) <= cfg.slideOn.SideTurnRate * DT) air.sideTurn = null;
  } else stepSpin(air.rot, steerForSpin, () => rotationSide(steerForSpin, boardYaw, toes, r.ropeHeading), cfg, DT, spinRate);
  // Beside a feature W lifts the nose (slide-on), it does not flip.
  const noseLift = air.noFlip || (air.slideOn !== null && air.slideOn.phase === 'air');
  if (!air.trick && !noseLift) stepFlip(air.rot, input.forward ? 1 : input.back ? -1 : 0, cfg, DT, flipRateScale(cfg, air.rot.flipAngle));

  air.grab = mem.grabChoice;
  if (air.grab) air.grabTimes[air.grab] += DT;

  const h = updateHandle(r.handle, air.rot, mem.passPressed, { rate: cfg.spin.rate, inAir: true }, cfg, DT);
  r.handle = h.handle;
  return h.result.passed;
}
