import { type Quat, type V3, qid, qmul, qrot, vadd, vlerp, vscale, vsub } from './quat';

/**
 * The rider skeleton (spec section 1.5, RigMap). One bone per joint; the
 * board is the root, so the feet stay in the bindings and the pelvis floats
 * above them. Every bone's rest orientation is the rider frame itself
 * (identity), so a joint's local rotation is its rotation away from the
 * builder's rest pose, and Motor6D.Transform / a TransformNode's rotation
 * can take it directly.
 *
 * Rider frame (metres): +x along the board toward the nose, which is the
 * rider's lead side; +y up; +z toward the toes, which is where the chest
 * faces. The canonical rider is regular (left foot forward), so "L" joints
 * are the lead side. Goofy and switch riders are mirrored poses (pose.ts).
 */
export const JOINTS = [
  'Hips',
  'Waist',
  'Neck',
  'LShoulder',
  'LElbow',
  'LWrist',
  'RShoulder',
  'RElbow',
  'RWrist',
  'LHip',
  'LKnee',
  'LAnkle',
  'RHip',
  'RKnee',
  'RAnkle',
] as const;
export type JointName = (typeof JOINTS)[number];

export const PARENT: Record<JointName, JointName | 'Root'> = {
  Hips: 'Root',
  Waist: 'Hips',
  Neck: 'Waist',
  LShoulder: 'Waist',
  LElbow: 'LShoulder',
  LWrist: 'LElbow',
  RShoulder: 'Waist',
  RElbow: 'RShoulder',
  RWrist: 'RElbow',
  LHip: 'Hips',
  LKnee: 'LHip',
  LAnkle: 'LKnee',
  RHip: 'Hips',
  RKnee: 'RHip',
  RAnkle: 'RKnee',
};

/** The joint on the other side (itself for the spine). */
export const MIRROR: Record<JointName, JointName> = {
  Hips: 'Hips',
  Waist: 'Waist',
  Neck: 'Neck',
  LShoulder: 'RShoulder',
  LElbow: 'RElbow',
  LWrist: 'RWrist',
  RShoulder: 'LShoulder',
  RElbow: 'LElbow',
  RWrist: 'LWrist',
  LHip: 'RHip',
  LKnee: 'RKnee',
  LAnkle: 'RAnkle',
  RHip: 'LHip',
  RKnee: 'LKnee',
  RAnkle: 'LAnkle',
};

/** A rig's rest pose and measurements, in metres in the rider frame. */
export interface RigDef {
  name: string;
  /** Joint pivots at rest. Must be mirror-symmetric across x = 0 (L <-> R). */
  rest: Record<JointName, V3>;
  /** Centre of the head at rest (for the centre of mass and head aim). */
  headCentre: V3;
  /** Wrist pivot to the middle of the fist (m). */
  handLength: number;
  /** Board: length, width and the deck's height above the base. */
  boardLength: number;
  boardWidth: number;
  deckTop: number;
  /** Handle bar length and the distance between the two grips. */
  barLength: number;
  gripSpacing: number;
}

export interface Bone {
  /** Position in the root (board) frame. */
  pos: V3;
  /** Rotation in the root frame. */
  rot: Quat;
}

export type Skeleton = Record<JointName, Bone>;

/**
 * Forward kinematics in the root frame: the pelvis moves by `hipsOffset`,
 * every joint turns by its local rotation.
 */
export function forwardKinematics(rig: RigDef, hipsOffset: V3, local: Record<JointName, Quat>): Skeleton {
  const out = {} as Skeleton;
  for (const j of JOINTS) {
    const p = PARENT[j];
    if (p === 'Root') {
      out[j] = { pos: vadd(rig.rest[j], hipsOffset), rot: local[j] };
    } else {
      const pb = out[p];
      out[j] = {
        pos: vadd(pb.pos, qrot(pb.rot, vsub(rig.rest[j], rig.rest[p]))),
        rot: qmul(pb.rot, local[j]),
      };
    }
  }
  return out;
}

/** Where a rest-pose point carried by joint `j` is now. */
export const carried = (rig: RigDef, sk: Skeleton, j: JointName, restPoint: V3): V3 =>
  vadd(sk[j].pos, qrot(sk[j].rot, vsub(restPoint, rig.rest[j])));

export const headPos = (rig: RigDef, sk: Skeleton): V3 => carried(rig, sk, 'Neck', rig.headCentre);

/** Middle of the fist. */
export function handPos(rig: RigDef, sk: Skeleton, side: 'L' | 'R'): V3 {
  const wrist = side === 'L' ? 'LWrist' : 'RWrist';
  const elbow = side === 'L' ? 'LElbow' : 'RElbow';
  const restDir = vsub(rig.rest[wrist], rig.rest[elbow]);
  const len = Math.sqrt(restDir.x * restDir.x + restDir.y * restDir.y + restDir.z * restDir.z);
  return carried(rig, sk, wrist, vadd(rig.rest[wrist], vscale(restDir, rig.handLength / len)));
}

/**
 * Centre of mass (spec section 5.1): torso 0.5, head 0.08, each arm 0.05,
 * each leg 0.16, at the segment centres.
 */
export function centreOfMass(rig: RigDef, sk: Skeleton): V3 {
  const torso = vlerp(sk.Hips.pos, sk.Neck.pos, 0.4);
  const head = headPos(rig, sk);
  let c = vadd(vscale(torso, 0.5), vscale(head, 0.08));
  c = vadd(c, vscale(vadd(sk.LElbow.pos, sk.RElbow.pos), 0.05));
  c = vadd(c, vscale(vadd(sk.LKnee.pos, sk.RKnee.pos), 0.16));
  return c;
}

export function identityLocals(): Record<JointName, Quat> {
  const l = {} as Record<JointName, Quat>;
  for (const j of JOINTS) l[j] = qid();
  return l;
}

/** Bone lengths of a two-bone chain. */
export function chainLengths(rig: RigDef, a: JointName, b: JointName, c: JointName): [number, number] {
  const d = (p: V3, q: V3) => Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2);
  return [d(rig.rest[a], rig.rest[b]), d(rig.rest[b], rig.rest[c])];
}
