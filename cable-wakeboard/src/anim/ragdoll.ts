import type { AnimFrame } from './animator';
import type { AnimConfig } from './config';
import { chainRotations } from './ik';
import {
  type Quat,
  type V3,
  qaxis,
  qconj,
  qfromBasis,
  qid,
  qmul,
  qnorm,
  qrot,
  qslerp,
  vadd,
  vcross,
  vdot,
  vlen,
  vnorm,
  vscale,
  vsub,
} from './quat';
import { identityLocals, JOINTS, type JointName, type RigDef } from './skeleton';

/**
 * The crash ragdoll (spec section 9), shared by both games: point masses on
 * the joints, held together by distance constraints (bones plus braces that
 * keep the torso solid), knees and elbows limited to a smallest hinge angle,
 * with water buoyancy and drag. It starts from the last animated pose and its
 * joint velocities, so the crash lead-in flows into it. The board floats off
 * on its own. Twin: Anim/Ragdoll.luau.
 */
const POINTS = [...JOINTS, 'Head', 'LHand', 'RHand'] as const;
type PointName = (typeof POINTS)[number];

export interface Ragdoll {
  pos: Record<PointName, V3>;
  prev: Record<PointName, V3>;
  links: { a: PointName; b: PointName; len: number }[];
  hinges: { a: PointName; c: PointName; min: number }[];
  board: { pos: V3; vel: V3; rot: Quat; spin: V3 };
  time: number;
}

const BONES: [PointName, PointName][] = [
  ['Hips', 'Waist'],
  ['Waist', 'Neck'],
  ['Neck', 'Head'],
  ['Waist', 'LShoulder'],
  ['Waist', 'RShoulder'],
  ['LShoulder', 'LElbow'],
  ['LElbow', 'LWrist'],
  ['LWrist', 'LHand'],
  ['RShoulder', 'RElbow'],
  ['RElbow', 'RWrist'],
  ['RWrist', 'RHand'],
  ['Hips', 'LHip'],
  ['Hips', 'RHip'],
  ['LHip', 'LKnee'],
  ['LKnee', 'LAnkle'],
  ['RHip', 'RKnee'],
  ['RKnee', 'RAnkle'],
];
const BRACES: [PointName, PointName][] = [
  ['LShoulder', 'RShoulder'],
  ['LHip', 'RHip'],
  ['LShoulder', 'Hips'],
  ['RShoulder', 'Hips'],
  ['LHip', 'Waist'],
  ['RHip', 'Waist'],
  ['Neck', 'LShoulder'],
  ['Neck', 'RShoulder'],
  ['Head', 'Waist'],
  ['LShoulder', 'LHip'],
  ['RShoulder', 'RHip'],
];

const dist = (a: V3, b: V3): number => vlen(vsub(a, b));

export function createRagdoll(
  frame: AnimFrame,
  prevWorld: Record<JointName, V3> | null,
  prevHead: V3 | null,
  dt: number,
  cfg: AnimConfig,
): Ragdoll {
  const pos = {} as Record<PointName, V3>;
  const prev = {} as Record<PointName, V3>;
  for (const j of JOINTS) {
    pos[j] = { ...frame.world[j] };
    prev[j] = prevWorld ? { ...prevWorld[j] } : { ...frame.world[j] };
  }
  pos.Head = { ...frame.head };
  prev.Head = prevHead ? { ...prevHead } : { ...frame.head };
  pos.LHand = { ...frame.hands.L };
  pos.RHand = { ...frame.hands.R };
  // Hands: carry their wrist's motion.
  prev.LHand = vsub(pos.LHand, vsub(pos.LWrist, prev.LWrist));
  prev.RHand = vsub(pos.RHand, vsub(pos.RWrist, prev.RWrist));
  const links = [...BONES, ...BRACES].map(([a, b]) => ({ a, b, len: dist(pos[a], pos[b]) }));
  const minHinge = (cfg.Ragdoll.MinHinge * Math.PI) / 180;
  const hinge = (a: PointName, b: PointName, c: PointName) => {
    const l1 = dist(pos[a], pos[b]);
    const l2 = dist(pos[b], pos[c]);
    return { a, c, min: Math.sqrt(Math.max(0, l1 * l1 + l2 * l2 - 2 * l1 * l2 * Math.cos(minHinge))) };
  };
  const hinges = [
    hinge('LShoulder', 'LElbow', 'LWrist'),
    hinge('RShoulder', 'RElbow', 'RWrist'),
    hinge('LHip', 'LKnee', 'LAnkle'),
    hinge('RHip', 'RKnee', 'RAnkle'),
  ];
  const v = prevWorld && dt > 0 ? vscale(vsub(frame.world.Hips, prevWorld.Hips), 1 / dt) : { x: 0, y: 0, z: 0 };
  return { pos, prev, links, hinges, board: { pos: { ...frame.root.pos }, vel: v, rot: frame.root.rot, spin: { x: 0, y: 0, z: 0 } }, time: 0 };
}

export function stepRagdoll(r: Ragdoll, cfg: AnimConfig, dt: number): void {
  if (dt <= 0) return;
  const c = cfg.Ragdoll;
  r.time += dt;
  for (const p of POINTS) {
    const x = r.pos[p];
    const o = r.prev[p];
    const under = x.y < 0;
    const depth = under ? Math.min(1, -x.y / c.FloatDepth) : 0;
    const drag = under ? c.WaterDrag : c.AirDrag;
    const ay = -c.Gravity + c.Gravity * c.Buoyancy * depth;
    const k = Math.max(0, 1 - drag * dt);
    const nx = { x: x.x + (x.x - o.x) * k, y: x.y + (x.y - o.y) * k + ay * dt * dt, z: x.z + (x.z - o.z) * k };
    r.prev[p] = x;
    r.pos[p] = nx;
  }
  for (let it = 0; it < c.Iterations; it++) {
    for (const l of r.links) {
      const a = r.pos[l.a];
      const b = r.pos[l.b];
      const d = vsub(b, a);
      const len = vlen(d);
      if (len < 1e-9) continue;
      const corr = vscale(d, ((len - l.len) / len) * 0.5);
      r.pos[l.a] = vadd(a, corr);
      r.pos[l.b] = vsub(b, corr);
    }
    for (const h of r.hinges) {
      const a = r.pos[h.a];
      const b = r.pos[h.c];
      const d = vsub(b, a);
      const len = vlen(d);
      if (len >= h.min || len < 1e-9) continue;
      const corr = vscale(d, ((len - h.min) / len) * 0.5);
      r.pos[h.a] = vadd(a, corr);
      r.pos[h.c] = vsub(b, corr);
    }
  }
  // Board: floats flat at the surface and drifts to a stop.
  const b = r.board;
  const under = b.pos.y < 0.02;
  const lift = under ? c.Gravity * c.Buoyancy * 1.6 * Math.min(1, (0.02 - b.pos.y) / 0.05) : 0;
  b.vel = vadd(b.vel, { x: 0, y: (lift - c.Gravity) * dt, z: 0 });
  b.vel = vscale(b.vel, Math.max(0, 1 - (under ? c.WaterDrag : c.AirDrag) * dt));
  b.pos = vadd(b.pos, vscale(b.vel, dt));
  if (b.pos.y < -0.05) {
    b.pos.y = -0.05;
    b.vel.y = Math.max(0, b.vel.y);
  }
  // Settle the board flat (keep its heading).
  const fwd = qrot(b.rot, { x: 1, y: 0, z: 0 });
  const flat = qaxis({ x: 0, y: 1, z: 0 }, -Math.atan2(fwd.z, fwd.x));
  b.rot = qnorm(qslerp(b.rot, flat, Math.min(1, dt * 2.5)));
}

/** Rotation that carries the rest frame (primary y, secondary x) onto the current one. */
function frameRot(restY: V3, restX: V3, curY: V3, curX: V3): Quat {
  const basis = (y0: V3, x0: V3): Quat => {
    const y = vnorm(y0);
    let x = vsub(x0, vscale(y, vdot(x0, y)));
    if (vlen(x) < 1e-6) x = vcross(y, { x: 0, y: 0, z: 1 });
    x = vnorm(x);
    return qfromBasis(x, y, vcross(x, y));
  };
  return qmul(basis(curY, curX), qconj(basis(restY, restX)));
}

/** The ragdoll as a pose: board root, pelvis offset, joint rotations (for the same FK as the animator). */
export function ragdollPose(rig: RigDef, r: Ragdoll): { root: { pos: V3; rot: Quat }; hipsOffset: V3; local: Record<JointName, Quat> } {
  const rs = rig.rest;
  const root = { pos: r.board.pos, rot: r.board.rot };
  const inv = qconj(root.rot);
  const P = {} as Record<PointName, V3>;
  for (const p of POINTS) P[p] = qrot(inv, vsub(r.pos[p], root.pos));
  const world = {} as Record<JointName, Quat>;
  world.Hips = frameRot(vsub(rs.Waist, rs.Hips), vsub(rs.LHip, rs.RHip), vsub(P.Waist, P.Hips), vsub(P.LHip, P.RHip));
  world.Waist = frameRot(vsub(rs.Neck, rs.Waist), vsub(rs.LShoulder, rs.RShoulder), vsub(P.Neck, P.Waist), vsub(P.LShoulder, P.RShoulder));
  world.Neck = frameRot(vsub(rig.headCentre, rs.Neck), vsub(rs.LShoulder, rs.RShoulder), vsub(P.Head, P.Neck), vsub(P.LShoulder, P.RShoulder));
  const restHand = (w: JointName, e: JointName) => vadd(rs[w], vscale(vnorm(vsub(rs[w], rs[e])), rig.handLength));
  for (const side of ['L', 'R'] as const) {
    const sh = `${side}Shoulder` as JointName, el = `${side}Elbow` as JointName, wr = `${side}Wrist` as JointName;
    const pole = { x: side === 'L' ? 0.3 : -0.3, y: -1, z: 0 };
    const arm = chainRotations(rs[sh], rs[el], restHand(wr, el), P[sh], P[el], P[`${side}Hand`], pole, pole);
    world[sh] = arm.upper;
    world[el] = arm.lower;
    world[wr] = arm.lower;
    const hp = `${side}Hip` as JointName, kn = `${side}Knee` as JointName, an = `${side}Ankle` as JointName;
    const kp = { x: 0, y: 0, z: 1 };
    const leg = chainRotations(rs[hp], rs[kn], rs[an], P[hp], P[kn], P[an], kp, kp);
    world[hp] = leg.upper;
    world[kn] = leg.lower;
    world[an] = leg.lower;
  }
  const local = identityLocals();
  for (const j of JOINTS) {
    const parent = j === 'Hips' ? null : j === 'Waist' || j === 'LHip' || j === 'RHip' ? 'Hips' : j === 'Neck' || j === 'LShoulder' || j === 'RShoulder' ? 'Waist' : null;
    if (j === 'Hips') local[j] = world.Hips;
    else if (parent) local[j] = qmul(qconj(world[parent]), world[j]);
  }
  for (const side of ['L', 'R'] as const) {
    local[`${side}Elbow`] = qmul(qconj(world[`${side}Shoulder`]), world[`${side}Elbow`]);
    local[`${side}Wrist`] = qid();
    local[`${side}Knee`] = qmul(qconj(world[`${side}Hip`]), world[`${side}Knee`]);
    local[`${side}Ankle`] = qid();
  }
  return { root, hipsOffset: vsub(P.Hips, rs.Hips), local };
}
