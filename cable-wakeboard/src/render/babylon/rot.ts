import { Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Vec3 } from '../../sim/math/vec';

/**
 * Rotations as bases: the world-space images of the local X, Y and Z axes.
 * Right-handed, matching the sim and `scene.useRightHandedSystem = true`.
 */
export type Basis = [Vec3, Vec3, Vec3];

export const col = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const IDENTITY: Basis = [col(1, 0, 0), col(0, 1, 0), col(0, 0, 1)];

/** Apply basis `a` to vector `v`. */
export const applyBasis = (a: Basis, v: Vec3): Vec3 =>
  col(a[0].x * v.x + a[1].x * v.y + a[2].x * v.z, a[0].y * v.x + a[1].y * v.y + a[2].y * v.z, a[0].z * v.x + a[1].z * v.y + a[2].z * v.z);

/** Compose: rotate by `b`, then by `a`. */
export const mulBasis = (a: Basis, b: Basis): Basis => b.map((v) => applyBasis(a, v)) as Basis;

/** Right-handed rotation by `angle` about unit axis `k` (Rodrigues). */
export function axisAngle(k: Vec3, angle: number): Basis {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const rot = (v: Vec3): Vec3 => {
    const d = k.x * v.x + k.y * v.y + k.z * v.z;
    const cx = k.y * v.z - k.z * v.y, cy = k.z * v.x - k.x * v.z, cz = k.x * v.y - k.y * v.x;
    return col(v.x * c + cx * s + k.x * d * t, v.y * c + cy * s + k.y * d * t, v.z * c + cz * s + k.z * d * t);
  };
  return [rot(col(1, 0, 0)), rot(col(0, 1, 0)), rot(col(0, 0, 1))];
}

/** Sim heading as a basis: local X along travel, Z to the right of travel. */
export const yawBasis = (psi: number): Basis => [col(Math.cos(psi), 0, Math.sin(psi)), col(0, 1, 0), col(-Math.sin(psi), 0, Math.cos(psi))];

/** A basis whose Y axis points along `up` (unit), with X kept near `hint`. */
export function basisFromUp(up: Vec3, hint: Vec3 = col(1, 0, 0)): Basis {
  const dotHU = hint.x * up.x + hint.y * up.y + hint.z * up.z;
  let x = col(hint.x - up.x * dotHU, hint.y - up.y * dotHU, hint.z - up.z * dotHU);
  let len = Math.hypot(x.x, x.y, x.z);
  if (len < 1e-6) {
    x = Math.abs(up.y) < 0.9 ? col(-up.z, 0, up.x) : col(1, 0, 0);
    len = Math.hypot(x.x, x.y, x.z);
  }
  x = col(x.x / len, x.y / len, x.z / len);
  const z = col(x.y * up.z - x.z * up.y, x.z * up.x - x.x * up.z, x.x * up.y - x.y * up.x);
  return [x, up, z];
}

/** Babylon uses row vectors, so the basis vectors are the matrix rows. */
export const basisToQuaternion = (b: Basis): Quaternion =>
  Quaternion.FromRotationMatrix(
    Matrix.FromValues(b[0].x, b[0].y, b[0].z, 0, b[1].x, b[1].y, b[1].z, 0, b[2].x, b[2].y, b[2].z, 0, 0, 0, 0, 1),
  );
