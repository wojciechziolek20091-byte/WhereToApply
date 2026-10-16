import { riderPose } from '../render/pose';
import { inAir } from '../sim/fsm';
import type { LandingResult } from '../sim/landing';
import { GRAVITY } from '../sim/config';
import type { SimEvent } from '../sim/events';
import { slideIdAt } from '../sim/onFeature';
import { wallHeightAt } from '../sim/featureShapes';
import type { RiderState } from '../sim/rider';
import type { SimState } from '../sim/world';
import { type Quat, type V3, DEG, qaxis, qmul, qnorm, vlen, vnorm, vsub } from './quat';

/**
 * The integration contract (spec section 0.2): the animation system reads
 * one RiderAnimState per frame and nothing else from gameplay. Field names
 * follow the spec; `ext` carries the few extra values the animation needs
 * that the spec's table does not list (all derived from the sim, see
 * animStateFromSim). Twin: Anim/RiderAnimStateAdapter.luau.
 */
export type AnimRiderMode =
  | 'Riding'
  | 'RidingBlind'
  | 'WaterTrickLoad'
  | 'WaterTrickAir'
  | 'Airborne'
  | 'OnSafety'
  | 'OnFeature'
  | 'Landing'
  | 'Crashed';
export type TrickId = 'Ollie' | 'Spin' | 'FrontFlip' | 'Tantrum' | 'Raley' | 'Backroll' | 'Frontroll' | 'SBendL' | 'SBendR' | 'Mobe';
export type GrabName = 'Indy' | 'Stalefish' | 'Nose' | 'Tail';
export type SlideName = 'FiftyFifty' | 'Backboard' | 'Frontboard' | 'SwitchFiftyFifty' | 'WallRide';

export interface RiderAnimState {
  state: AnimRiderMode;
  stance: 'Regular' | 'Goofy';
  isSwitch: boolean;
  speed: number;
  velocity: V3;
  /** -1 toeside .. +1 heelside. */
  edge: number;
  tension: number;
  popCharge: number;
  /** The board as the sim has it: position and rotation (yaw, inverts, edge tilt). */
  boardCFrame: { pos: V3; rot: Quat };
  /** Where the rope would put the handle: the hips plus the handle distance toward the carrier. */
  handlePosition: V3;
  trick: {
    id: TrickId | null;
    phase: number;
    spinDegrees: number;
    spinDirection: 'Frontside' | 'Backside' | null;
    flipDegrees: number;
    grab: GrabName | null;
    grabTime: number;
  };
  handle: 'InFront' | 'Behind' | 'Passing' | 'Dropped';
  passProgress: number | null;
  feature: { slide: SlideName | null; balance: number } | null;
  landing: { impactSpeed: number; quality: 'Clean' | 'Sketchy' | null } | null;
  crashReason: string | null;
  ext: {
    /** +1 when the toes point right of the travel direction (regular forward, goofy switch). */
    toes: number;
    carrier: V3;
    /** Seconds in the air and the predicted total airtime. */
    airTime: number;
    airDuration: number;
    /** Spin rate (deg/s, + clockwise from above) and how far the spin still goes (deg, signed). */
    spinRate: number;
    spinRemaining: number;
    /** Flip still to go to the next whole turn (deg, signed like flipDegrees). */
    flipRemaining: number;
    /** A/D held while charging a pop: -1, 0 or 1, in spin direction terms (+1 clockwise). */
    preWind: number;
    /** Water trick: raley extension (deg), roll angle (deg) and the S-bend side. */
    extension: number;
    rollDegrees: number;
    sBend: number;
    rollKind: 'back' | 'front' | null;
    /** Edge angle (deg, + heelside). */
    edgeDegrees: number;
    /** Slope of the ramp or safety under the board (deg), 0 elsewhere. */
    slope: number;
    /** On a feature: rail (true) or box. Rotating to a new 90-degree step: 0..1, else -1. */
    rail: boolean;
    featureTurn: number;
    lipPop: boolean;
    /** Seconds in the current state. */
    modeTime: number;
    /** A landing this tick (true once), a pop this tick, a rope snap this tick. */
    justLanded: boolean;
    justTookOff: boolean;
    ropeSnap: boolean;
    /** Blind riding: seconds and the spin-out direction in progress (0 when none). */
    spinOut: number;
  };
}

const MODE: Record<RiderState['mode'], AnimRiderMode> = {
  riding: 'Riding',
  ridingBlind: 'RidingBlind',
  waterTrickLoad: 'WaterTrickLoad',
  waterTrickAir: 'WaterTrickAir',
  airborne: 'Airborne',
  onKicker: 'OnSafety',
  onSafety: 'OnSafety',
  onFeature: 'OnFeature',
  landing: 'Landing',
  crashed: 'Crashed',
};

const GRAB: Record<string, GrabName> = { indy: 'Indy', stalefish: 'Stalefish', nose: 'Nose', tail: 'Tail' };
const SLIDE: Record<string, SlideName> = {
  fiftyFifty: 'FiftyFifty',
  backboard: 'Backboard',
  frontboard: 'Frontboard',
  switchFiftyFifty: 'SwitchFiftyFifty',
  wallRide: 'WallRide',
};
const HANDLE: Record<RiderState['handle'], RiderAnimState['handle']> = {
  inFront: 'InFront',
  behind: 'Behind',
  passing: 'Passing',
  dropped: 'Dropped',
};

/**
 * Board rotation from a yaw, an optional invert (axis in the board frame,
 * angle) and the edge tilt. rot.ts conventions: heading psi is a turn of
 * -psi about +y.
 */
export function composeBoardRotation(yaw: number, invertAxis: V3 | null, invertAngle: number, lean: number): Quat {
  let q = qaxis({ x: 0, y: 1, z: 0 }, -yaw);
  if (invertAxis) q = qmul(q, qaxis(vnorm(invertAxis), invertAngle));
  q = qmul(q, qaxis({ x: 1, y: 0, z: 0 }, lean));
  return qnorm(q);
}

/** The sim board's rotation (render/pose.ts). */
export function boardRotation(r: RiderState): Quat {
  const p = riderPose(r);
  const ax = p.invert ? { x: p.invert.axis[0], y: p.invert.axis[1], z: p.invert.axis[2] } : null;
  return composeBoardRotation(p.yaw, ax, p.invert ? p.invert.angle : 0, p.lean);
}

const PI = Math.PI;
const nextMultiple = (angle: number, step: number, dir: number): number =>
  dir > 0 ? Math.ceil(angle / step - 1e-9) * step : Math.floor(angle / step + 1e-9) * step;

function trickId(r: RiderState): TrickId | null {
  const air = r.air;
  if (!air) return null;
  const t = air.trick;
  if (t) {
    if (t.sBend !== 0) return t.sBend < 0 ? 'SBendL' : 'SBendR';
    if (t.kind !== 'raley' && Math.abs(air.rot.spinAngle - air.spinStart) > 2.5) return 'Mobe';
    return t.kind === 'raley' ? 'Raley' : t.kind === 'backroll' ? 'Backroll' : 'Frontroll';
  }
  if (air.rot.flipAngle > 0.05 || (air.rot.flipRate > 0 && air.rot.flipAngle >= 0 && air.rot.flipTarget !== null)) return 'FrontFlip';
  if (air.rot.flipAngle < -0.05) return 'Tantrum';
  if (Math.abs(air.rot.spinAngle - air.spinStart) > 0.2 || air.rot.spinRate !== 0) return 'Spin';
  return 'Ollie';
}

function landingFrom(l: LandingResult): RiderAnimState['landing'] {
  return { impactSpeed: l.impact, quality: l.clean ? 'Clean' : l.quality < 0.75 ? 'Sketchy' : null };
}

/**
 * Fill a RiderAnimState from the sim (this is RiderAnimStateAdapter). Every
 * field has a source in the sim except `phase` for plain airs (air time over
 * the predicted airtime) and `handlePosition` (the hips moved toward the
 * carrier by the posture's handle distance). `events` are the tick's events;
 * `prev` keeps the landing info alive through the landing state.
 */
export function animStateFromSim(sim: SimState, events: SimEvent[], prev: RiderAnimState | null): RiderAnimState {
  const r = sim.rider;
  const cfg = sim.cfg;
  const p = riderPose(r);
  const air = r.air;
  const g = GRAVITY;

  // Airtime: water tricks plan theirs; other airs are predicted from height and vertical speed.
  let airTime = 0;
  let airDuration = 0;
  if (air && inAir(r.mode)) {
    airTime = air.time;
    if (air.trick) airDuration = Math.max(air.trick.airtime, air.time + 1e-3);
    else {
      const vy = r.vel.y;
      const h = Math.max(0, r.pos.y);
      airDuration = air.time + (vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
    }
  }
  const phase = air && air.trick ? air.trick.u : airDuration > 0 ? Math.min(1, airTime / airDuration) : 0;

  let spinRemaining = 0;
  let flipRemaining = 0;
  let spinDeg = 0;
  if (air) {
    const rot = air.rot;
    spinDeg = (rot.spinAngle - air.spinStart) / DEG;
    const dir = rot.spinRate !== 0 ? Math.sign(rot.spinRate) : rot.spinDir;
    if (dir !== 0) {
      const target = rot.spinTarget ?? nextMultiple(rot.spinAngle - air.spinStart, PI, dir) + air.spinStart;
      spinRemaining = (target - rot.spinAngle) / DEG;
    }
    const fd = rot.flipRate !== 0 ? Math.sign(rot.flipRate) : Math.sign(rot.flipAngle);
    if (fd !== 0) {
      const target = rot.flipTarget ?? nextMultiple(rot.flipAngle, 2 * PI, fd);
      flipRemaining = (target - rot.flipAngle) / DEG;
    }
  }

  let landing: RiderAnimState['landing'] = null;
  let justLanded = false;
  let justTookOff = false;
  let ropeSnap = false;
  for (const e of events) {
    if (e.type === 'landed') {
      landing = landingFrom(e.landing);
      justLanded = true;
    } else if (e.type === 'crash' && e.landing) {
      landing = { impactSpeed: e.landing.impact, quality: null };
      justLanded = true;
    } else if (e.type === 'takeoff') justTookOff = true;
    else if (e.type === 'ropeSnap') ropeSnap = true;
  }
  if (!landing && prev?.landing && (r.mode === 'landing' || r.mode === 'riding' || r.mode === 'ridingBlind' || r.mode === 'onFeature') && r.modeTime < 0.5) {
    landing = prev.landing;
  }

  let feature: RiderAnimState['feature'] = null;
  let rail = false;
  let wallRoll = 0;
  let featureTurn = -1;
  let slope = 0;
  const jib = r.jib;
  if (jib) {
    const f = sim.features.find((x) => x.def.id === jib.featureId);
    if (f) {
      const slide = slideIdAt(jib.boardAngle, f.heading, r.heading, r);
      feature = { slide: SLIDE[slide] ?? null, balance: jib.balance };
      // Narrow mains (rails, pipes) look like rails; the old defs keep their style.
      rail = f.def.kind === 'slider' ? f.def.style !== 'box' : f.def.kind === 'feature' && f.shape.pieces.some((p) => p.slide && p.width < 0.6);
      const wall = f.shape.pieces[0]!.wall;
      if (wall && r.ramp) {
        // On a wall ride: the board lies on the wall, rolled by the profile's angle.
        const x = (r.ramp.v - wall.base) * wall.side;
        wallRoll = -wall.side * p.toes * Math.atan(wallHeightAt(wall, Math.max(x, 0)).slope);
        feature = { slide: 'WallRide', balance: 0 };
      }
    }
    if (jib.targetAngle !== jib.boardAngle) {
      const step = PI / 2;
      featureTurn = 1 - Math.min(1, Math.abs(jib.targetAngle - jib.boardAngle) / step);
    }
  }
  if (r.ramp) {
    const f = sim.features.find((x) => x.def.id === r.ramp!.featureId);
    if (f) slope = Math.atan2(Math.max(0, r.vel.y), Math.max(0.1, Math.sqrt(r.vel.x * r.vel.x + r.vel.z * r.vel.z))) / DEG;
  }

  // Handle: the sim's rope attaches at the hips; the bar sits handleDist toward the carrier.
  const hip = { x: r.pos.x, y: r.pos.y + cfg.rider.hipHeight * (1 - 0.35 * r.legCompression), z: r.pos.z };
  const toCarrier = vsub(sim.carrier.pos, hip);
  const dist = vlen(toCarrier);
  const dir = dist > 1e-6 ? vnorm(toCarrier) : { x: 1, y: 0, z: 0 };
  const handlePosition = { x: hip.x + dir.x * r.handleDist, y: hip.y + dir.y * r.handleDist, z: hip.z + dir.z * r.handleDist };

  const mem = sim.inputs;
  const charging = r.popCharge > 0 && (r.mode === 'riding' || r.mode === 'waterTrickLoad' || r.mode === 'ridingBlind');
  const t = air?.trick ?? null;
  const rotSide = air?.rot.spinSide ?? null;

  return {
    state: MODE[r.mode],
    stance: r.stance === 'regular' ? 'Regular' : 'Goofy',
    isSwitch: air ? air.takeoffSwitch : r.switchStance,
    speed: Math.sqrt(r.vel.x * r.vel.x + r.vel.z * r.vel.z),
    velocity: { ...r.vel },
    edge: Math.max(-1, Math.min(1, r.edgeAngle / cfg.edge.maxEdgeAngle)),
    tension: r.tensionSmooth,
    popCharge: r.popCharge,
    boardCFrame: {
      pos: { ...r.pos },
      rot: wallRoll === 0 ? boardRotation(r) : composeBoardRotation(p.yaw, null, 0, p.lean + wallRoll),
    },
    handlePosition,
    trick: {
      id: trickId(r),
      phase,
      spinDegrees: spinDeg,
      spinDirection: rotSide === 'frontside' ? 'Frontside' : rotSide === 'backside' ? 'Backside' : null,
      flipDegrees: air ? air.rot.flipAngle / DEG : 0,
      grab: air?.grab ? (GRAB[air.grab] ?? null) : null,
      grabTime: air?.grab ? air.grabTimes[air.grab] : 0,
    },
    handle: HANDLE[r.handle],
    passProgress: air && air.rot.passTimer > 0 ? 1 - air.rot.passTimer / cfg.handlePass.passTime : null,
    feature,
    landing,
    crashReason: r.mode === 'crashed' ? r.lastCrash : null,
    ext: {
      toes: p.toes,
      carrier: { ...sim.carrier.pos },
      airTime,
      airDuration,
      spinRate: air ? air.rot.spinRate / DEG : 0,
      spinRemaining,
      flipRemaining,
      preWind: charging ? mem.steerDir : 0,
      extension: t ? t.extension / DEG : 0,
      rollDegrees: t ? t.rollAngle / DEG : 0,
      sBend: t ? t.sBend : 0,
      rollKind: t && t.kind === 'backroll' ? 'back' : t && t.kind === 'frontroll' ? 'front' : null,
      edgeDegrees: r.edgeAngle / DEG,
      slope,
      rail,
      featureTurn,
      lipPop: !!air?.lipPop,
      modeTime: r.modeTime,
      justLanded,
      justTookOff,
      ropeSnap,
      spinOut: r.spinOut ? r.spinOut.dir : 0,
    },
  };
}
