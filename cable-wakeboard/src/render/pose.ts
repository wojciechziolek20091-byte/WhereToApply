import { toeSign } from '../sim/edge';
import type { RiderState } from '../sim/rider';

/**
 * How to orient the rider model, shared by both renderers. Engine-free.
 *
 * - yaw: travel heading, plus the spin in the air, the board angle on a
 *   feature, or the blind spin-out on the water.
 * - invert: rotation in the board's frame (x along the board, z toward the
 *   toes): tantrum and front flip turn about the board's long axis, rolls
 *   about a tilted axis, S-bends about an axis between the board and the toes.
 * - lean: tilt about the board's long axis for the edge.
 * - raley: the raley's body extension; the animator turns it into the swing.
 */
export interface RiderPose {
  yaw: number;
  toes: 1 | -1;
  invert: { axis: [number, number, number]; angle: number } | null;
  lean: number;
  /** Raley body extension (rad, from the sim). The animator swings the rider with it; it is not in `lean`. */
  raley: number;
  /** The handle is behind the back (blind): the rope attaches on the heel side. */
  handleBehind: boolean;
}

export function riderPose(r: RiderState): RiderPose {
  const toes = toeSign({ stance: r.stance, switchStance: r.air?.takeoffSwitch ?? r.switchStance });
  let yaw = r.heading;
  if (r.air) yaw += r.air.rot.spinAngle;
  if (r.jib) yaw += r.jib.boardAngle;
  if (r.spinOut) yaw += r.spinOut.dir * Math.PI * (r.spinOut.time / 0.4 - 1);
  let invert: RiderPose['invert'] = null;
  let raley = 0;
  const air = r.air;
  if (air) {
    const t = air.trick;
    if (t && t.sBend !== 0) {
      invert = { axis: [Math.SQRT1_2, 0, Math.SQRT1_2], angle: t.sBend * t.rollAngle };
      raley = t.extension;
    } else if (t && t.kind !== 'raley') {
      const sign = t.kind === 'backroll' ? -toes : toes;
      invert = { axis: [Math.SQRT1_2, Math.SQRT1_2, 0], angle: sign * t.rollAngle };
    } else if (t) {
      raley = t.extension;
    } else if (air.rot.flipAngle !== 0) {
      // + front flip, - tantrum (back flip): the head goes toward the toes or the heels.
      invert = { axis: [1, 0, 0], angle: toes * air.rot.flipAngle };
    } else if (air.slideOn && air.slideOn.pitch > 0) {
      // Slide-on: the leading end lifts. The nose (the end along the travel) about the
      // board's z; the edge facing the feature about its long axis.
      const so = air.slideOn;
      if (so.lead === 'nose') invert = { axis: [0, 0, 1], angle: (Math.cos(air.rot.spinAngle) >= 0 ? 1 : -1) * so.pitch };
      else {
        const side = -Math.sin(yaw) * -Math.sin(so.featureHeading) + Math.cos(yaw) * Math.cos(so.featureHeading);
        invert = { axis: [1, 0, 0], angle: -(side * so.toward >= 0 ? 1 : -1) * so.pitch };
      }
    }
  }
  // Rotating +a about x lifts the -z side. The heel is on -toes, so a heelside
  // edge (positive) dips the heel with -toes * edge.
  const lean = -toes * r.edgeAngle;
  return { yaw, toes, invert, lean, raley, handleBehind: r.handle === 'behind' };
}
