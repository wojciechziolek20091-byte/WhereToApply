import { type AnimConfig, DEFAULT_ANIM_CONFIG } from './config';
import { addInto, blendInto, CH, type ChannelPose, jointCh, mirrorPose, NCH, neutralPose } from './channels';
import { type CompiledClip, compileClip, sampleClip } from './clip';
import { chainRotations, solveMiddle } from './ik';
import { ALL_CLIPS, CRASH_LEAD_IN } from './poses';
import {
  DEG,
  type Quat,
  type V3,
  qaxis,
  qconj,
  qeuler,
  qfromTo,
  qid,
  qmul,
  qnorm,
  qrot,
  qslerp,
  v3,
  vadd,
  vcross,
  vdot,
  vlen,
  vlerp,
  vnorm,
  vscale,
  vsub,
} from './quat';
import { createRagdoll, type Ragdoll, ragdollPose, stepRagdoll } from './ragdoll';
import {
  centreOfMass,
  chainLengths,
  forwardKinematics,
  handPos,
  headPos,
  identityLocals,
  JOINTS,
  type JointName,
  type RigDef,
  type Skeleton,
} from './skeleton';
import { impulse, type Spring, spring, stepSpring } from './spring';
import type { GrabName, RiderAnimState } from './state';

/**
 * The rider animation system (spec section 1): layers evaluated in order,
 *   1 base pose (riding stance from state, edge, tension, charge),
 *   2 trick layer (clips sampled by phase or rotation progress, grabs),
 *   3 physical reactions (springs: tension, yank, landing, chatter, breathing),
 *   4 IK (handle in the hands, feet in the bindings, head aim),
 *   5 secondary motion (lead and lag of the spine in rotations, free arms),
 * on a channel pose (channels.ts) that is inertialized on every state change.
 * Engine-free; the web renderer and the Roblox client apply the AnimFrame.
 * Twin: Anim/Animator.luau.
 */

export type HandKind = 'Handle' | 'Free' | 'Grab' | 'Passing' | 'Reaching';
type Side = 'L' | 'R';

interface HandState {
  kind: HandKind;
  /** What the hand is going for: 'handle', 'grip0', 'grip1', a grab name, or 'free'. */
  goal: string;
  /** Reach in progress: start point (root frame) and progress 0..1. */
  from: V3;
  reach: number;
  /** IK weight: 1 holding or grabbing, 0 free (arm from the clip). */
  ik: Spring;
  /** Last hand position (root frame). */
  pos: V3;
  counter: Spring;
  /** Length of the current reach (s) and last frame's elbow bend direction (root frame). */
  reachTime: number;
  bend: V3 | null;
}

export interface AnimFrame {
  /** The board (root) in the world. */
  root: { pos: V3; rot: Quat };
  /** Pelvis offset from rest, in the root frame (m). */
  hipsOffset: V3;
  /** Joint rotations relative to the rest pose (Motor6D.Transform). */
  local: Record<JointName, Quat>;
  /** Joint positions in the world (skeleton overlay). */
  world: Record<JointName, V3>;
  head: V3;
  hands: { L: V3; R: V3 };
  handKinds: { L: HandKind; R: HandKind };
  com: V3;
  /** Axis of the root's rotation this frame (world, unit) or null when still. */
  rotationAxis: V3 | null;
  handle: { pos: V3; rot: Quat; visible: boolean; grips: [V3, V3] };
  ikTargets: V3[];
  tuck: number;
  mirrored: boolean;
  /** One-shot events for VFX, camera and sound: pop, land, pass, snap, crash, splash. */
  events: string[];
  impact: number;
  ragdoll: boolean;
}

export interface Animator {
  rig: RigDef;
  cfg: AnimConfig;
  clips: Record<string, CompiledClip>;
  time: number;
  key: string;
  last: ChannelPose | null;
  lastVel: ChannelPose;
  inertia: Spring[];
  inertiaFreq: number;
  rootOff: Quat;
  rootOffT: number;
  rootOffDur: number;
  e1: number;
  e2: number;
  e3: number;
  loadW: Spring;
  blindW: Spring;
  slackW: Spring;
  chargeW: Spring;
  tensionPitch: Spring;
  yank: Spring;
  landDrop: Spring;
  wobble: Spring;
  bob: Spring;
  leadHips: Spring;
  leadShoulders: Spring;
  leadHead: Spring;
  preWind: Spring;
  aimYaw: Spring;
  aimPitch: Spring;
  grabW: Spring;
  tweakW: Spring;
  grab: GrabName | null;
  grabStart: number;
  releaseTimer: number;
  lastGrab: GrabName | null;
  flipDoneU: number;
  sBendStartU: number;
  hands: Record<Side, HandState>;
  gripSwap: boolean;
  handleOff: { x: Spring; y: Spring; z: Spring };
  grabAssist: { x: Spring; y: Spring; z: Spring };
  invertW: Spring;
  handleWorld: V3;
  handleVel: V3;
  barWorld: V3 | null;
  dropped: boolean;
  lastTension: number;
  lastRootRot: Quat | null;
  lastBoardFwd: V3 | null;
  comOffset: V3 | null;
  prevWorld: Record<JointName, V3> | null;
  prevHead: V3 | null;
  elbows: [V3, V3] | null;
  ragdoll: Ragdoll | null;
  frame: AnimFrame | null;
}

const EASE = (s: number): number => s * s * (3 - 2 * s);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const UPV: V3 = { x: 0, y: 1, z: 0 };

function newHand(): HandState {
  return { kind: 'Handle', goal: 'handle', from: v3(), reach: 1, ik: spring(1), pos: v3(), counter: spring(0), reachTime: 0.1, bend: null };
}

export function createAnimator(rig: RigDef, cfg: AnimConfig = DEFAULT_ANIM_CONFIG): Animator {
  const clips: Record<string, CompiledClip> = {};
  for (const c of ALL_CLIPS) clips[c.name] = compileClip(c);
  const inertia: Spring[] = [];
  for (let i = 0; i < NCH; i++) inertia.push(spring(0));
  return {
    rig,
    cfg,
    clips,
    time: 0,
    key: '',
    last: null,
    lastVel: new Array<number>(NCH).fill(0),
    inertia,
    inertiaFreq: 6,
    rootOff: qid(),
    rootOffT: 1,
    rootOffDur: 0.12,
    e1: 0,
    e2: 0,
    e3: 0,
    loadW: spring(0),
    blindW: spring(0),
    slackW: spring(0),
    chargeW: spring(0),
    tensionPitch: spring(0),
    yank: spring(0),
    landDrop: spring(0),
    wobble: spring(0),
    bob: spring(0),
    leadHips: spring(0),
    leadShoulders: spring(0),
    leadHead: spring(0),
    preWind: spring(0),
    aimYaw: spring(70),
    aimPitch: spring(0),
    grabW: spring(0),
    tweakW: spring(0),
    grab: null,
    grabStart: 0,
    releaseTimer: 0,
    lastGrab: null,
    flipDoneU: -1,
    sBendStartU: -1,
    hands: { L: newHand(), R: newHand() },
    gripSwap: false,
    handleOff: { x: spring(0), y: spring(0), z: spring(0) },
    grabAssist: { x: spring(0), y: spring(0), z: spring(0) },
    invertW: spring(0),
    handleWorld: v3(),
    handleVel: v3(),
    barWorld: null,
    dropped: false,
    lastTension: 0,
    lastRootRot: null,
    lastBoardFwd: null,
    comOffset: null,
    prevWorld: null,
    prevHead: null,
    elbows: null,
    ragdoll: null,
    frame: null,
  };
}

/** Which inertialization a state change is: same key, same continuous blend family. */
function modeKey(s: RiderAnimState): string {
  const st = s.state;
  if (st === 'Riding' || st === 'RidingBlind' || st === 'WaterTrickLoad' || st === 'Landing') return 'Water';
  if (st === 'Airborne' || st === 'WaterTrickAir') {
    const id = s.trick.id;
    return `Air|${id === 'Ollie' || id === 'Spin' || id === null ? 'Basic' : id}`;
  }
  if (st === 'OnFeature') return `Feature|${s.feature?.slide ?? ''}`;
  if (st === 'Crashed') return `Crashed|${s.crashReason ?? ''}`;
  return st;
}

function blendTime(cfg: AnimConfig, key: string): number {
  if (key.startsWith('Crashed')) return cfg.Blend.ToCrashed;
  if (key === 'Water') return cfg.Blend.ToLanding;
  if (key.startsWith('Air')) return cfg.Blend.ToAirborne;
  if (key.startsWith('Feature')) return cfg.Blend.ToOnFeature;
  return cfg.Blend.Default;
}

/** p[name] += v. */
function bump(p: ChannelPose, name: string, v: number): void {
  const i = CH[name]!;
  p[i] = p[i]! + v;
}

const lag = (x: number, target: number, tau: number, dt: number): number => x + (target - x) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));

/** Deterministic chatter: two incommensurate sines. */
const chatter = (t: number, hz: number): number => 0.6 * Math.sin(2 * Math.PI * hz * t) + 0.4 * Math.sin(2 * Math.PI * hz * 1.71 * t + 1.3);

function sample(a: Animator, name: string, u: number): ChannelPose {
  const p = neutralPose();
  sampleClip(a.clips[name]!, u, p);
  return p;
}

/** Riding stance for edge value e (layer 1). */
function ridingPose(a: Animator, e: number): ChannelPose {
  const p = sample(a, 'cruise', 0);
  const c = a.clips;
  if (e > 0) blendInto(p, sample(a, 'heelside', 0), e, c.heelside!.mask);
  else if (e < 0) blendInto(p, sample(a, 'toeside', 0), -e, c.toeside!.mask);
  blendInto(p, sample(a, 'loaded', 0), clamp01(a.loadW.x), c.loaded!.mask);
  blendInto(p, sample(a, 'blind', 0), clamp01(a.blindW.x), c.blind!.mask);
  blendInto(p, sample(a, 'slack', 0), clamp01(a.slackW.x), c.slack!.mask);
  return p;
}

const LEG_CH = ['kneeL', 'kneeR'];
const HIP_CH = ['Hips.x', 'Hips.y', 'Hips.z', 'pelvis.x', 'pelvis.y', 'pelvis.z'];

/** Clip time of a flip or roll from its rotation progress (spec 5.2: the clip follows the rotation). */
function rotationClipTime(a: Animator, progress: number, done: boolean, phase: number): number {
  if (progress <= 0) return Math.min(0.08, phase);
  if (!done) {
    a.flipDoneU = -1;
    return 0.08 + 0.77 * Math.min(1, progress);
  }
  if (a.flipDoneU < 0) a.flipDoneU = phase;
  const span = Math.max(0.05, 1 - a.flipDoneU);
  return 0.85 + 0.15 * clamp01((phase - a.flipDoneU) / span);
}

/** Layers 1-3 on the canonical (regular) rider. */
function canonicalPose(a: Animator, s: RiderAnimState, dt: number): ChannelPose {
  const cfg = a.cfg;
  const R = cfg.Riding;
  const st = s.state;
  const water = st === 'Riding' || st === 'RidingBlind' || st === 'WaterTrickLoad' || st === 'Landing' || st === 'Crashed';
  const air = st === 'Airborne' || st === 'WaterTrickAir';

  // Edge chain: knees, then hips, then shoulders, each ChainDelay behind the last.
  a.e1 = lag(a.e1, s.edge, R.ChainDelay, dt);
  a.e2 = lag(a.e2, a.e1, R.ChainDelay, dt);
  a.e3 = lag(a.e3, a.e2, R.ChainDelay, dt);
  stepSpring(a.loadW, st === 'WaterTrickLoad' ? 1 : 0, R.Lean, dt);
  stepSpring(a.blindW, s.handle === 'Behind' ? 1 : 0, R.Lean, dt);
  const slack = water && st !== 'Crashed' ? 1 - clamp01((s.tension - R.SlackBelow) / (R.SlackAbove - R.SlackBelow)) : 0;
  stepSpring(a.slackW, slack, R.Lean, dt);
  const charge = water ? s.popCharge : 0;
  if (cfg.Physics.CrouchFollowsCharge) {
    a.chargeW.x = charge;
    a.chargeW.v = 0;
  } else stepSpring(a.chargeW, charge, R.Knee, dt);

  let p: ChannelPose;
  if (water) {
    const legs = ridingPose(a, a.e1);
    const hips = ridingPose(a, a.e2);
    p = ridingPose(a, a.e3);
    for (const c of LEG_CH) p[CH[c]!] = legs[CH[c]!]!;
    for (const c of HIP_CH) p[CH[c]!] = hips[CH[c]!]!;
    addInto(p, sample(a, 'charge', 0), a.chargeW.x, a.clips.charge!.mask);
    bump(p, 'kneeL', R.ChargeKnee * a.chargeW.x);
    bump(p, 'kneeR', R.ChargeKnee * a.chargeW.x);
  } else if (st === 'OnSafety') {
    p = sample(a, 'ramp', 0);
    bump(p, 'kneeL', cfg.Feature.SlopeKnee * s.ext.slope);
    bump(p, 'kneeR', cfg.Feature.SlopeKnee * s.ext.slope);
  } else if (st === 'OnFeature') {
    const slide = s.feature?.slide ?? 'FiftyFifty';
    const name = slide === 'Backboard' ? 'backboard' : slide === 'Frontboard' ? 'frontboard' : slide === 'SwitchFiftyFifty' ? 'switchFiftyFifty' : 'fiftyFifty';
    p = sample(a, name, 0);
    const bal = s.feature?.balance ?? 0;
    bump(p, 'Hips.z', cfg.Feature.BalanceSway * bal);
    bump(p, 'Waist.z', -(cfg.Feature.BalanceSway * 0.5 * bal));
    bump(p, 'handle.x', -(0.05 * bal));
    const turn = s.ext.featureTurn;
    if (turn >= 0 && turn < 0.5) bump(p, 'pelvis.y', cfg.Feature.HopHeight * Math.sin(Math.PI * turn * 2));
  } else {
    p = sample(a, 'air', 0);
  }

  // Layer 2: tricks.
  if (air) {
    const id = s.trick.id;
    const phase = s.trick.phase;
    let clip: string | null = null;
    let t = phase;
    if (id === 'FrontFlip' || id === 'Tantrum') {
      const deg = Math.abs(s.trick.flipDegrees);
      const total = Math.max(360, deg + Math.abs(s.ext.flipRemaining));
      clip = id === 'FrontFlip' ? 'frontFlip' : 'tantrum';
      t = rotationClipTime(a, deg / total, s.ext.flipRemaining === 0 && deg > 300, phase);
    } else if (id === 'Backroll' || id === 'Frontroll' || id === 'Mobe') {
      const deg = Math.abs(s.ext.rollDegrees);
      clip = id === 'Frontroll' || (id === 'Mobe' && s.ext.rollKind === 'front') ? 'frontroll' : 'backroll';
      t = rotationClipTime(a, deg / 360, deg >= 359, phase);
    } else if (id === 'Raley') clip = 'raley';
    else if (id === 'SBendL' || id === 'SBendR') {
      if (a.sBendStartU < 0) a.sBendStartU = phase;
      clip = id === 'SBendL' ? 'sBendL' : 'sBendR';
      t = clamp01((phase - a.sBendStartU) / Math.max(0.05, 1 - a.sBendStartU));
    } else clip = 'ollie';
    if (id !== 'SBendL' && id !== 'SBendR') a.sBendStartU = -1;
    if (id !== 'FrontFlip' && id !== 'Tantrum' && id !== 'Backroll' && id !== 'Frontroll' && id !== 'Mobe') a.flipDoneU = -1;
    blendInto(p, sample(a, clip, t), 1, a.clips[clip]!.mask);

    const w = clamp01(Math.abs(s.ext.spinRate) / 540);
    if (w > 0) {
      addInto(p, sample(a, 'spinCompact', 0), w, a.clips.spinCompact!.mask);
      bump(p, 'kneeL', cfg.Spin.CompactKnee * w);
      bump(p, 'kneeR', cfg.Spin.CompactKnee * w);
    }
  } else {
    a.flipDoneU = -1;
    a.sBendStartU = -1;
  }

  // Grabs: the knees come up first; the legs stay up LegsAfterRelease after the hand lets go.
  const G = cfg.Grab;
  const grab = air ? s.trick.grab : null;
  if (grab && grab !== a.grab) a.grabStart = a.time;
  if (!grab && a.grab) a.releaseTimer = G.LegsAfterRelease;
  a.grab = grab;
  if (grab) a.lastGrab = grab;
  a.releaseTimer = Math.max(0, a.releaseTimer - dt);
  const holdLegs = !!grab || a.releaseTimer > 0;
  stepSpring(a.grabW, holdLegs ? 1 : 0, { freq: 1 / (G.TweakTime * 3), damping: 1 }, dt);
  stepSpring(a.tweakW, grab && s.trick.grabTime > G.TweakAfter ? 1 : 0, { freq: 0.755 / G.TweakTime, damping: 1 }, dt);
  if (a.lastGrab && a.grabW.x > 0.001) {
    const name = a.lastGrab.charAt(0).toLowerCase() + a.lastGrab.slice(1);
    blendInto(p, sample(a, name, 0), clamp01(a.grabW.x), a.clips[name]!.mask);
    blendInto(p, sample(a, `${name}Tweak`, 0), clamp01(a.tweakW.x) * clamp01(a.grabW.x), a.clips[`${name}Tweak`]!.mask);
  }

  // Crash lead-in.
  if (st === 'Crashed') {
    const clip = CRASH_LEAD_IN[s.crashReason ?? ''] ?? 'crashSide';
    blendInto(p, sample(a, clip, clamp01(s.ext.modeTime / cfg.Crash.LeadIn)), 1, a.clips[clip]!.mask);
  }

  // Layer 3: reactions.
  const kN = s.tension / 1000;
  stepSpring(a.tensionPitch, water || st === 'OnFeature' ? R.TensionPitch * kN : 0, R.Lean, dt);
  bump(p, 'Waist.x', a.tensionPitch.x);
  bump(p, 'Waist.z', -(0.5 * a.tensionPitch.x));
  const jump = s.tension - a.lastTension;
  if (s.ext.ropeSnap || (jump > 600 * dt * 10 && s.tension > 900 && water)) impulse(a.yank, R.YankKick * kN);
  a.lastTension = s.tension;
  stepSpring(a.yank, 0, R.Yank, dt);
  bump(p, 'Waist.x', a.yank.x);

  const L = cfg.Landing;
  // The pelvis carries the impact speed into the compression; peak depth = speed / (w e).
  const landW = 1 / (L.CompressPerMS * Math.E);
  const landSpring = { freq: landW / (2 * Math.PI), damping: 1 };
  if (s.ext.justLanded && s.landing) {
    const v = Math.min(s.landing.impactSpeed, L.MaxCompress * landW * Math.E);
    impulse(a.landDrop, -v);
    impulse(a.bob, 6 * v);
    if (s.landing.quality === 'Sketchy') impulse(a.wobble, L.SketchyKick * (a.time % 2 < 1 ? 1 : -1));
  }
  stepSpring(a.landDrop, 0, landSpring, dt);
  stepSpring(a.wobble, 0, L.Sketchy, dt);
  stepSpring(a.bob, 0, cfg.Secondary.HeadBob, dt);
  bump(p, 'pelvis.y', a.landDrop.x);
  bump(p, 'Waist.x', -(a.landDrop.x * L.PitchPerMetre));
  bump(p, 'Waist.z', a.wobble.x);
  bump(p, 'Neck.x', a.bob.x);

  if (water && st !== 'Crashed') {
    const amp = R.ChatterDeg * clamp01(s.speed / R.ChatterSpeed) * (0.3 + 0.7 * Math.abs(s.edge));
    bump(p, 'kneeL', amp * chatter(a.time, R.ChatterHz));
    bump(p, 'kneeR', amp * chatter(a.time + 0.37, R.ChatterHz));
  }
  if (st !== 'Crashed') bump(p, 'Waist.x', R.BreathDeg * Math.max(0.25, 1 - s.speed / 6) * Math.sin(2 * Math.PI * R.BreathHz * a.time));
  return p;
}

/** Leg length (hip to ankle) for a knee bend. */
function legSpan(l1: number, l2: number, bendDeg: number): number {
  const b = clamp(bendDeg, 2, 150) * DEG;
  return Math.sqrt(l1 * l1 + l2 * l2 + 2 * l1 * l2 * Math.cos(b));
}

function chanQ(p: ChannelPose, j: JointName): Quat {
  const i = jointCh(j);
  return qeuler(p[i]!, p[i + 1]!, p[i + 2]!);
}

/** Rotate v about world up by `deg` (+ counter-clockwise from above). */
function aboutUp(v: V3, deg: number): V3 {
  return qrot(qaxis(UPV, deg * DEG), v);
}

/** World position of a root-frame point. */
const toWorld = (root: { pos: V3; rot: Quat }, p: V3): V3 => vadd(root.pos, qrot(root.rot, p));

export function stepAnimator(a: Animator, s: RiderAnimState, dt: number): AnimFrame {
  const cfg = a.cfg;
  const rig = a.rig;
  a.time += dt;
  const events: string[] = [];
  const mirrored = s.ext.toes < 0;
  const lead: Side = mirrored ? 'R' : 'L';
  const back: Side = mirrored ? 'L' : 'R';
  const leadSign = mirrored ? -1 : 1;

  // State key and inertialization.
  const key = modeKey(s);
  const respawn = a.key.startsWith('Crashed') && !key.startsWith('Crashed');
  if (respawn || !a.last) resetForRespawn(a);
  const keyChanged = key !== a.key && a.last !== null && !respawn;
  if (key.startsWith('Crashed') && !a.key.startsWith('Crashed')) events.push('crash');
  if (s.ext.justTookOff) events.push('pop');
  if (s.ext.justLanded) events.push('land');
  if (s.ext.ropeSnap) events.push('snap');
  if (s.handle === 'Passing' && a.frame && a.frame.handKinds.L !== 'Passing' && a.frame.handKinds.R !== 'Passing') events.push('pass');

  const raw = canonicalPose(a, s, dt);
  const bt = blendTime(cfg, key);
  if (keyChanged && a.last) {
    a.inertiaFreq = 0.755 / bt;
    for (let i = 0; i < NCH; i++) {
      a.inertia[i]!.x = a.last[i]! - raw[i]!;
      a.inertia[i]!.v = a.lastVel[i]!;
    }
  }
  const out = new Array<number>(NCH);
  for (let i = 0; i < NCH; i++) {
    const off = a.inertia[i]!;
    stepSpring(off, 0, { freq: a.inertiaFreq, damping: 1 }, dt);
    out[i] = raw[i]! + off.x;
  }
  if (a.last) for (let i = 0; i < NCH; i++) a.lastVel[i] = dt > 0 ? (out[i]! - a.last[i]!) / dt : 0;
  a.last = out;
  a.key = key;

  // Rig frame: mirror for goofy and switch.
  const P = mirrored ? mirrorPose(out) : out.slice();

  // Board rotation: the sim's, turned round for a mirrored rig, plus the raley swing and tweaks.
  let rot = s.boardCFrame.rot;
  if (mirrored) rot = qmul(rot, qaxis(UPV, Math.PI));
  const st = s.state;
  const airborne = st === 'Airborne' || st === 'WaterTrickAir';
  if (st === 'WaterTrickAir' && (s.trick.id === 'Raley' || s.trick.id === 'SBendL' || s.trick.id === 'SBendR')) {
    const e = clamp01(s.ext.extension / 90);
    rot = qmul(rot, qaxis({ x: 1, y: 0, z: 0 }, e * (105 + s.ext.edgeDegrees) * DEG));
  }
  const tweak = qeuler(P[CH['board.x']!]!, P[CH['board.y']!]!, P[CH['board.z']!]!);
  rot = qmul(rot, tweak);
  if (keyChanged && a.lastRootRot) {
    a.rootOff = qmul(a.lastRootRot, qconj(rot));
    a.rootOffT = 0;
    a.rootOffDur = key.startsWith('Crashed') ? cfg.Crash.LeadIn : bt * 1.5;
  }
  if (a.rootOffT < 1) {
    a.rootOffT = Math.min(1, a.rootOffT + dt / a.rootOffDur);
    rot = qmul(qslerp(a.rootOff, qid(), EASE(a.rootOffT)), rot);
  }
  rot = qnorm(rot);
  const up = qrot(rot, UPV).y;

  // Board yaw rate (deg/s, + clockwise from above) for the spine's lead and lag.
  const fwd = qrot(rot, { x: leadSign, y: 0, z: 0 });
  let yawRate = 0;
  if (airborne) yawRate = s.ext.spinRate;
  else if (a.lastBoardFwd && dt > 0) {
    const c = vcross(a.lastBoardFwd, fwd).y;
    yawRate = (-Math.asin(clamp(c / Math.max(1e-6, vlen(a.lastBoardFwd) * vlen(fwd)), -1, 1)) / DEG) / dt;
  }
  a.lastBoardFwd = fwd;

  // Layer 5 (on the spine): head first, shoulders, hips, board last; spotting.
  const S = cfg.Spin;
  const rem = s.ext.spinRemaining;
  const spotting = airborne && rem !== 0 && Math.abs(rem) < S.SpotSpin;
  const turning = airborne || st === 'OnFeature' || s.ext.spinOut !== 0;
  const leadOf = (k: number, max: number) => (turning ? clamp(spotting ? rem : yawRate * k, -max, max) : 0);
  stepSpring(a.leadHips, spotting ? clamp(rem * 0.3, -S.MaxLeadHips, S.MaxLeadHips) : leadOf(S.LeadHips, S.MaxLeadHips), S.Lead, dt);
  stepSpring(a.leadShoulders, leadOf(S.LeadShoulders, S.MaxLeadShoulders), S.Lead, dt);
  stepSpring(a.leadHead, leadOf(S.LeadHead, S.MaxLeadHead), S.Lead, dt);
  stepSpring(a.preWind, S.PreWind * s.ext.preWind, S.Lead, dt);
  bump(P, 'Hips.y', -a.leadHips.x * up);
  bump(P, 'Waist.y', (-(a.leadShoulders.x - a.leadHips.x) + a.preWind.x) * up);

  // ---- Pelvis from the knees -------------------------------------------------
  const [lt, ls] = chainLengths(rig, 'LHip', 'LKnee', 'LAnkle');
  const restHips = rig.rest.Hips;
  const px = P[CH['pelvis.x']!]!, py = P[CH['pelvis.y']!]!, pz = P[CH['pelvis.z']!]!;
  let ySum = 0;
  for (const side of ['L', 'R'] as const) {
    const hip = rig.rest[`${side}Hip`];
    const ankle = rig.rest[`${side}Ankle`];
    const d = legSpan(lt, ls, P[CH[`knee${side}`]!]!);
    const hx = hip.x + px - ankle.x;
    const hz = hip.z + pz - ankle.z;
    ySum += ankle.y + Math.sqrt(Math.max(1e-4, d * d - hx * hx - hz * hz)) - (hip.y - restHips.y);
  }
  // Board to the hand: while grabbing, the pelvis drops toward the board until the hand reaches.
  const GA = a.grabAssist;
  let assist = v3();
  if (a.grab && a.frame && !mirroredChanged(a, mirrored)) {
    const gh: Side = a.grab === 'Nose' ? lead : back;
    const tgt = grabTarget(rig, a.grab, leadSign);
    const sh = toRootFrame(a.frame, a.frame.world[`${gh}Shoulder`]);
    const [ua, ub] = chainLengths(rig, 'LShoulder', 'LElbow', 'LWrist');
    const d = vsub(tgt, sh);
    const deficit = vlen(d) - (ua + ub + rig.handLength) * 0.95;
    if (deficit > 0) assist = vscale(vnorm(d), deficit);
  }
  const am = cfg.Hand.GrabAssistMax;
  const aimA = { x: clamp(GA.x.x + assist.x, -am, am), y: clamp(GA.y.x + assist.y, -am, 0), z: clamp(GA.z.x + assist.z * 0.5, -am, am) };
  const assistSp = { freq: 2.5, damping: 1 };
  stepSpring(GA.x, a.grab ? aimA.x : 0, assistSp, dt);
  stepSpring(GA.y, a.grab ? aimA.y : 0, assistSp, dt);
  stepSpring(GA.z, a.grab ? aimA.z : 0, assistSp, dt);
  const minY = rig.rest.LAnkle.y + 0.26 - (rig.rest.LHip.y - restHips.y);
  const bodyPelvis = { x: restHips.x + px + GA.x.x, y: Math.max(minY, ySum / 2 + py + GA.y.x), z: restHips.z + pz + GA.z.x };
  // Tweaks turn the board, not the body: put the pelvis back where it was.
  const tweakInv = qconj(tweak);
  const pelvis = qrot(tweakInv, bodyPelvis);
  const hipsOffset = vsub(pelvis, restHips);

  const local = identityLocals();
  local.Hips = qmul(tweakInv, chanQ(P, 'Hips'));
  local.Waist = chanQ(P, 'Waist');
  for (const j of ['LShoulder', 'LElbow', 'LWrist', 'RShoulder', 'RElbow', 'RWrist'] as const) local[j] = chanQ(P, j);

  // Free arms: counter-swing against the rotation, balance on features, windmill near the edge.
  for (const side of ['L', 'R'] as const) {
    const h = a.hands[side];
    const own = side === 'L' ? 1 : -1;
    let target = -cfg.Secondary.CounterSwing * (yawRate / 100);
    const bal = s.feature?.balance ?? 0;
    let zAdd = 0;
    let xAdd = 0;
    if (st === 'OnFeature') {
      zAdd = cfg.Feature.BalanceArm * bal * own;
      if (Math.abs(bal) > cfg.Feature.WindmillAbove) xAdd = 60 * Math.sin(2 * Math.PI * cfg.Feature.WindmillHz * a.time);
    }
    target = clamp(target, -60, 60);
    stepSpring(h.counter, target, cfg.Secondary.FreeArm, dt);
    if (h.ik.x < 0.999) {
      const sh = `${side}Shoulder` as JointName;
      const i = jointCh(sh);
      local[sh] = qeuler(P[i]! + xAdd, P[i + 1]! + h.counter.x, P[i + 2]! + zAdd);
    }
  }

  // FK of the torso and arms as posed, for the shoulders and head aim.
  let sk = forwardKinematics(rig, hipsOffset, local);

  // ---- Legs: hips to the bindings ------------------------------------------------
  const kp = cfg.Hand.KneePole;
  for (const side of ['L', 'R'] as const) {
    const own = side === 'L' ? 1 : -1;
    const hipJ = `${side}Hip` as JointName, kneeJ = `${side}Knee` as JointName, ankJ = `${side}Ankle` as JointName;
    const H = sk[hipJ].pos;
    const A = rig.rest[ankJ];
    const pole = vnorm({ x: kp[0] * own, y: kp[1], z: kp[2] });
    const K = solveMiddle(H, A, lt, ls, pole);
    const rr = chainRotations(rig.rest[hipJ], rig.rest[kneeJ], A, H, K, A, pole, pole);
    local[hipJ] = qmul(qconj(sk.Hips.rot), rr.upper);
    local[kneeJ] = qmul(qconj(rr.upper), rr.lower);
    local[ankJ] = qconj(rr.lower);
  }

  // ---- Root placement (centre-of-mass pivot in the air) ---------------------------
  sk = forwardKinematics(rig, hipsOffset, local);
  const com0 = centreOfMass(rig, sk);
  let rootPos = s.boardCFrame.pos;
  if (airborne && cfg.Physics.ComPivot) {
    // At takeoff: the centre of mass's offset from the board; from then on it rides the sim's trajectory.
    if (!a.comOffset) a.comOffset = a.frame ? vsub(a.frame.com, a.frame.root.pos) : qrot(rot, com0);
    const w = 1 - EASE(clamp01((s.trick.phase - 0.82) / 0.18));
    rootPos = vadd(rootPos, vscale(vsub(a.comOffset, qrot(rot, com0)), w));
  } else a.comOffset = null;
  const root = { pos: rootPos, rot };
  const rootInv = qconj(rot);

  // ---- Head aim -------------------------------------------------------------------
  const vel = s.velocity;
  const hv = { x: vel.x, y: 0, z: vel.z };
  let look = vlen(hv) > 1 ? vnorm(hv) : vnorm({ x: fwd.x, y: 0, z: fwd.z });
  const heel = qrot(rot, { x: 0, y: 0, z: -1 });
  const ropeDirW = vnorm(vsub(s.ext.carrier, toWorld(root, pelvis)));
  if (st === 'Riding' || st === 'WaterTrickLoad' || st === 'Landing') {
    const th = cfg.Head.CutLook * s.edge * DEG;
    look = vnorm(vadd(vscale(look, Math.cos(th)), vscale(heel, Math.sin(th))));
  } else if (st === 'RidingBlind' || s.trick.id === 'Raley') {
    look = ropeDirW;
  }
  if (airborne && Math.abs(s.ext.spinRate) > 1 && !spotting) {
    look = aboutUp(vnorm({ x: fwd.x, y: 0, z: fwd.z }), -a.leadHead.x);
  }
  if (airborne && (s.trick.id === 'FrontFlip' || s.trick.id === 'Tantrum')) {
    // Spot the water ahead in the last part of the flip.
    look = vnorm(vadd(look, { x: 0, y: -0.6, z: 0 }));
  }
  const waistRot = sk.Waist.rot;
  const lookLocal = qrot(qconj(waistRot), qrot(rootInv, look));
  const yawT = clamp(Math.atan2(lookLocal.x, lookLocal.z) / DEG, -cfg.Head.MaxYaw, cfg.Head.MaxYaw);
  const pitchT = clamp(Math.atan2(-lookLocal.y, Math.sqrt(lookLocal.x * lookLocal.x + lookLocal.z * lookLocal.z)) / DEG, -cfg.Head.MaxPitch, cfg.Head.MaxPitch);
  stepSpring(a.aimYaw, yawT, cfg.Head.Aim, dt);
  stepSpring(a.aimPitch, pitchT, cfg.Head.Aim, dt);
  const aimW = clamp01(P[CH.aim!]!);
  {
    const i = jointCh('Neck');
    local.Neck = qeuler(P[i]! + aimW * a.aimPitch.x, P[i + 1]! + aimW * a.aimYaw.x, P[i + 2]!);
  }
  sk = forwardKinematics(rig, hipsOffset, local);

  // ---- Hands: grip states ---------------------------------------------------------------
  const dropped = s.handle === 'Dropped' || st === 'Crashed';
  const grabHand: Side | null = a.grab && a.time - a.grabStart >= cfg.Grab.HandDelay ? (a.grab === 'Nose' ? lead : back) : null;
  const goals: Record<Side, string> = { L: 'handle', R: 'handle' };
  if (dropped) {
    goals.L = 'free';
    goals.R = 'free';
  } else if (grabHand) {
    goals[grabHand] = a.grab!;
  } else if (s.handle === 'Behind') {
    goals[back] = 'free';
  }

  // ---- The handle: a real object on the rope ------------------------------------------
  const H = cfg.Handle;
  let handleRoot: V3;
  if (dropped) {
    a.dropped = true;
    const toC = vsub(s.ext.carrier, a.handleWorld);
    const acc = vsub(vscale(vnorm(toC), H.DropPull * clamp01(vlen(toC) / 20)), vscale(a.handleVel, H.DropDrag));
    a.handleVel = vadd(a.handleVel, vscale(vadd(acc, { x: 0, y: -9.81 * 0.3, z: 0 }), dt));
    a.handleWorld = vadd(a.handleWorld, vscale(a.handleVel, dt));
    if (a.handleWorld.y < 0.02) {
      a.handleWorld.y = 0.02;
      a.handleVel.y = Math.max(0, a.handleVel.y);
    }
    handleRoot = qrot(rootInv, vsub(a.handleWorld, root.pos));
  } else {
    a.dropped = false;
    const rd = qrot(rootInv, ropeDirW);
    // The bar sits toward the rope from the pelvis (a continuous function of the
    // rope's 3D direction, so it never jumps when the rope passes overhead in an
    // invert), in front of the hips while the pull is ahead, behind the back blind.
    const wf = clamp01(rd.x * leadSign * 1.4);
    const fb = H.FrontBias;
    const bb = H.BlindBias;
    const bw = clamp01(a.blindW.x);
    let pull = clamp01(s.tension / H.FullPullTension);
    // Raley: arms straight toward the cable through the extension.
    if (s.trick.id === 'Raley' || s.trick.id === 'SBendL' || s.trick.id === 'SBendR') pull = Math.max(pull, clamp01(s.ext.extension / 60));
    const slackSag = st === 'Riding' || st === 'WaterTrickLoad' ? a.slackW.x : 0;
    let target = vadd(sk.Hips.pos, vscale(rd, H.RopeRadius + H.MaxReach * pull));
    // Inverts: the handle stays tight at the lead hip and the rope wraps round the rider (spec 5.1).
    const inv = s.trick.id === 'FrontFlip' || s.trick.id === 'Tantrum' || s.trick.id === 'Backroll' || s.trick.id === 'Frontroll' || s.trick.id === 'Mobe' || s.trick.id === 'SBendL' || s.trick.id === 'SBendR';
    stepSpring(a.invertW, airborne && inv ? 1 : 0, { freq: 3, damping: 1 }, dt);
    const iw = clamp01(a.invertW.x);
    if (iw > 0) {
      const hipSpot = vadd(sk.Hips.pos, qrot(sk.Hips.rot, { x: 0.14 * leadSign, y: -0.04, z: 0.3 }));
      target = vlerp(target, hipSpot, iw);
    }
    target = vadd(target, vscale({ x: fb[0] * leadSign, y: fb[1], z: fb[2] }, wf * (1 - bw) * (1 - iw)));
    target = vadd(target, vscale({ x: bb[0] * leadSign, y: bb[1], z: bb[2] }, bw));
    target = vadd(target, { x: P[CH['handle.x']!]!, y: P[CH['handle.y']!]! - H.SlackSag * slackSag, z: P[CH['handle.z']!]! });
    const offW = qrot(rot, vsub(target, sk.Hips.pos));
    if (!a.frame || respawn) {
      a.handleOff.x.x = offW.x;
      a.handleOff.y.x = offW.y;
      a.handleOff.z.x = offW.z;
    }
    const o = {
      x: stepSpring(a.handleOff.x, offW.x, H.Follow, dt),
      y: stepSpring(a.handleOff.y, offW.y, H.Follow, dt),
      z: stepSpring(a.handleOff.z, offW.z, H.Follow, dt),
    };
    handleRoot = vadd(sk.Hips.pos, qrot(rootInv, o));
  }

  // Bar across the rope, horizontal; grips either side of the middle.
  const rdRoot = qrot(rootInv, dropped ? vnorm(vsub(s.ext.carrier, a.handleWorld)) : ropeDirW);
  // (Times leadSign: a cross product flips under the goofy mirror.)
  let bar = vscale(vcross(rdRoot, qrot(rootInv, UPV)), leadSign);
  if (vlen(bar) < 1e-4) bar = a.barWorld ? qrot(rootInv, a.barWorld) : { x: 0, y: 0, z: 1 };
  bar = vnorm(bar);
  // Keep the bar's ends where they were (no flip when the rope passes overhead).
  const prevBar = a.barWorld ? qrot(rootInv, a.barWorld) : vcross(rdRoot, { x: 0, y: leadSign, z: 0 });
  if (vdot(bar, prevBar) < 0) bar = vscale(bar, -1);
  a.barWorld = qrot(rot, bar);
  const half = rig.gripSpacing / 2;
  const holders = (['L', 'R'] as const).filter((sd) => goals[sd] === 'handle');
  const grip = (k: number): V3 => vadd(handleRoot, vscale(bar, k * half));
  const [la, lb] = chainLengths(rig, 'LShoulder', 'LElbow', 'LWrist');
  const armReach = (la + lb + rig.handLength) * 0.985;
  // Keep the bar within reach of the hands holding it.
  for (let pass = 0; pass < 2; pass++) {
    for (const sd of holders) {
      const shoulder = sk[`${sd}Shoulder`].pos;
      const g = holders.length === 2 ? grip(gripSign(a, sd, lead)) : handleRoot;
      const d = vsub(g, shoulder);
      const len = vlen(d);
      if (len > armReach) handleRoot = vsub(handleRoot, vscale(d, (len - armReach) / len));
    }
  }
  if (!dropped) {
    const o = qrot(rot, vsub(handleRoot, sk.Hips.pos));
    a.handleOff.x.x = o.x;
    a.handleOff.y.x = o.y;
    a.handleOff.z.x = o.z;
    const hw = toWorld(root, handleRoot);
    a.handleVel = a.frame && dt > 0 ? vscale(vsub(hw, a.handleWorld), 1 / dt) : v3();
    a.handleWorld = hw;
  }
  // Which hand takes which grip: the closer pairing, with some stickiness.
  if (holders.length === 2) {
    const ls = sk[`${lead}Shoulder`].pos, bs = sk[`${back}Shoulder`].pos;
    const dl0 = vlen(vsub(grip(1), ls)) + vlen(vsub(grip(-1), bs));
    const dl1 = vlen(vsub(grip(-1), ls)) + vlen(vsub(grip(1), bs));
    if (!a.gripSwap && dl1 < dl0 - 0.06) a.gripSwap = true;
    else if (a.gripSwap && dl0 < dl1 - 0.06) a.gripSwap = false;
  }

  // ---- Arms: IK to the goals, reaching along a curve -----------------------------------
  const ikTargets: V3[] = [];
  const ep = cfg.Hand.ElbowPole;
  const passing = s.handle === 'Passing';
  for (const side of ['L', 'R'] as const) {
    const h = a.hands[side];
    const own = side === 'L' ? 1 : -1;
    const goal = goals[side];
    let target: V3 | null = null;
    if (goal === 'handle') target = holders.length === 2 ? grip(gripSign(a, side, lead)) : handleRoot;
    else if (goal !== 'free') target = grabTarget(rig, goal as GrabName, leadSign);
    const goalKey = goal === 'handle' ? `handle${holders.length}${holders.length === 2 ? gripSign(a, side, lead) : ''}` : goal;
    if (goalKey !== h.goal) {
      h.from = a.frame ? h.pos : target ?? h.pos;
      h.reach = a.frame ? 0 : 1;
      h.goal = goalKey;
      h.reachTime = target ? Math.max(cfg.Hand.ReachTime, vlen(vsub(target, h.from)) / cfg.Hand.ReachSpeed) : cfg.Hand.ReachTime;
    }
    stepSpring(h.ik, target ? 1 : 0, cfg.Secondary.FreeArm, dt);
    h.reach = Math.min(1, h.reach + dt / h.reachTime);
    const shJ = `${side}Shoulder` as JointName, elJ = `${side}Elbow` as JointName, wrJ = `${side}Wrist` as JointName;
    if (target) {
      let T = target;
      if (h.reach < 1) {
        const e = EASE(h.reach);
        const mid = vlerp(h.from, target, e);
        const outDir = vnorm(vsub(mid, sk.Hips.pos));
        T = vadd(mid, vscale(outDir, cfg.Hand.ReachArc * vlen(vsub(target, h.from)) * 4 * e * (1 - e)));
      }
      ikTargets.push(toWorld(root, T));
      const Sp = sk[shJ].pos;
      // Pole in the chest's frame (elbows go with the torso), kept coherent with last frame.
      let pole = qrot(sk.Waist.rot, vnorm({ x: ep[0] * own, y: ep[1], z: ep[2] }));
      if (h.bend) {
        // Turn last frame's bend toward the wanted one, at most ElbowTurnRate.
        const want = vnorm(vadd(pole, vscale(h.bend, cfg.Hand.ElbowCoherence)));
        const ang = Math.acos(clamp(vdot(h.bend, want), -1, 1));
        const maxA = cfg.Hand.ElbowTurnRate * DEG * dt;
        if (ang > maxA && ang > 1e-6) {
          const axis = vcross(h.bend, want);
          pole = vlen(axis) > 1e-9 ? qrot(qaxis(vnorm(axis), maxA), h.bend) : h.bend;
        } else pole = want;
      }
      const restHand = vadd(rig.rest[wrJ], vscale(vnorm(vsub(rig.rest[wrJ], rig.rest[elJ])), rig.handLength));
      const E = solveMiddle(Sp, T, la, lb + rig.handLength, pole);
      {
        const mid = vlerp(Sp, T, la / (la + lb + rig.handLength));
        const bd = vsub(E, mid);
        h.bend = vlen(bd) > 1e-3 ? vnorm(bd) : h.bend;
      }
      const toT = vsub(T, E);
      const Tc = vadd(E, vscale(vnorm(toT), lb + rig.handLength));
      const rr = chainRotations(rig.rest[shJ], rig.rest[elJ], restHand, Sp, E, Tc, pole, pole);
      const ikShoulder = qmul(qconj(sk.Waist.rot), rr.upper);
      const ikElbow = qmul(qconj(rr.upper), rr.lower);
      const w = clamp01(h.ik.x);
      local[shJ] = qslerp(local[shJ], ikShoulder, w);
      local[elJ] = qslerp(local[elJ], ikElbow, w);
    }
    h.kind = !target ? 'Free' : h.reach < 1 ? 'Reaching' : goal === 'handle' ? (passing ? 'Passing' : 'Handle') : 'Grab';
  }

  // ---- Final skeleton ----------------------------------------------------------------
  sk = forwardKinematics(rig, hipsOffset, local);
  for (const side of ['L', 'R'] as const) a.hands[side].pos = handPos(rig, sk, side);
  const com = centreOfMass(rig, sk);

  let frame = buildFrame(a, s, root, hipsOffset, local, sk, com, handleRoot, bar, half, ikTargets, P, mirrored, events);

  // ---- Crash: lead-in, then the ragdoll ------------------------------------------------
  if (st === 'Crashed' && s.ext.modeTime >= cfg.Crash.LeadIn) {
    if (!a.ragdoll) {
      a.ragdoll = createRagdoll(frame, a.prevWorld, a.prevHead, dt, cfg);
      events.push('splash');
    }
    stepRagdoll(a.ragdoll, cfg, dt);
    const rp = ragdollPose(rig, a.ragdoll);
    const rsk = forwardKinematics(rig, rp.hipsOffset, rp.local);
    frame = buildFrame(a, s, rp.root, rp.hipsOffset, rp.local, rsk, centreOfMass(rig, rsk), qrot(qconj(rp.root.rot), vsub(a.handleWorld, rp.root.pos)), bar, half, [], P, mirrored, events);
    frame.ragdoll = true;
  }

  a.prevWorld = frame.world;
  a.prevHead = frame.head;
  a.lastRootRot = frame.root.rot;
  a.frame = frame;
  return frame;
}

const toRootFrame = (f: AnimFrame, p: V3): V3 => qrot(qconj(f.root.rot), vsub(p, f.root.pos));
const mirroredChanged = (a: Animator, mirrored: boolean): boolean => !!a.frame && a.frame.mirrored !== mirrored;

/** The lead hand takes the +1 end of the bar unless the hands have swapped. */
function gripSign(a: Animator, side: Side, lead: Side): number {
  const s = side === lead ? 1 : -1;
  return a.gripSwap ? -s : s;
}

/** Board attachment a grabbing hand goes to (root frame). */
function grabTarget(rig: RigDef, g: GrabName, leadSign: number): V3 {
  const top = rig.deckTop + 0.04;
  const hw = rig.boardWidth / 2;
  const hl = rig.boardLength / 2;
  if (g === 'Indy') return { x: 0, y: top, z: hw * 0.95 };
  if (g === 'Stalefish') return { x: -leadSign * 0.12, y: top, z: -hw * 0.95 };
  if (g === 'Nose') return { x: leadSign * (hl - 0.16), y: top, z: 0.04 };
  return { x: -leadSign * (hl - 0.16), y: top, z: 0.04 };
}

function buildFrame(
  a: Animator,
  s: RiderAnimState,
  root: { pos: V3; rot: Quat },
  hipsOffset: V3,
  local: Record<JointName, Quat>,
  sk: Skeleton,
  com: V3,
  handleRoot: V3,
  bar: V3,
  half: number,
  ikTargets: V3[],
  P: ChannelPose,
  mirrored: boolean,
  events: string[],
): AnimFrame {
  const rig = a.rig;
  const world = {} as Record<JointName, V3>;
  for (const j of JOINTS) world[j] = toWorld(root, sk[j].pos);
  let axis: V3 | null = null;
  if (a.lastRootRot) {
    const d = qmul(root.rot, qconj(a.lastRootRot));
    const sn = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    if (sn > 1e-4) axis = vscale({ x: d.x, y: d.y, z: d.z }, (d.w < 0 ? -1 : 1) / sn);
  }
  const barW = qrot(root.rot, bar);
  return {
    root: { pos: root.pos, rot: root.rot },
    hipsOffset,
    local,
    world,
    head: toWorld(root, headPos(rig, sk)),
    hands: { L: toWorld(root, handPos(rig, sk, 'L')), R: toWorld(root, handPos(rig, sk, 'R')) },
    handKinds: { L: a.hands.L.kind, R: a.hands.R.kind },
    com: toWorld(root, com),
    rotationAxis: axis,
    handle: {
      pos: a.dropped ? a.handleWorld : toWorld(root, handleRoot),
      rot: qfromTo({ x: 1, y: 0, z: 0 }, barW),
      visible: true,
      grips: [toWorld(root, vadd(handleRoot, vscale(bar, half))), toWorld(root, vsub(handleRoot, vscale(bar, half)))],
    },
    ikTargets,
    tuck: clamp01(P[CH.tuck!]!),
    mirrored,
    events,
    impact: s.ext.justLanded && s.landing ? s.landing.impactSpeed : 0,
    ragdoll: false,
  };
}

function resetForRespawn(a: Animator): void {
  for (const sp of a.inertia) {
    sp.x = 0;
    sp.v = 0;
  }
  a.last = null;
  a.rootOffT = 1;
  a.ragdoll = null;
  a.dropped = false;
  a.comOffset = null;
  a.frame = null;
  a.barWorld = null;
  a.lastRootRot = null;
  a.lastBoardFwd = null;
  a.prevWorld = null;
  a.prevHead = null;
  a.grab = null;
  a.lastGrab = null;
  a.grabW.x = 0;
  a.tweakW.x = 0;
  for (const s of [a.landDrop, a.wobble, a.yank, a.bob, a.leadHips, a.leadShoulders, a.leadHead, a.preWind]) {
    s.x = 0;
    s.v = 0;
  }
  for (const side of ['L', 'R'] as const) {
    const h = a.hands[side];
    h.goal = '';
    h.reach = 1;
    h.ik.x = 1;
    h.ik.v = 0;
    h.bend = null;
  }
  for (const sp of [a.grabAssist.x, a.grabAssist.y, a.grabAssist.z]) {
    sp.x = 0;
    sp.v = 0;
  }
}
