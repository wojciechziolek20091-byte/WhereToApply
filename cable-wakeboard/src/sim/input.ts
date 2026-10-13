import type { GrabId } from './tricks/data';

/** Everything the player asks for in one tick. Device-agnostic. */
export interface InputFrame {
  /** Edge request: +1 full heelside, -1 full toeside. See carveToEdge(). */
  edge: number;
  /** Hold to bend the knees and load; release to extend (pop). */
  load: boolean;
  /** 1 = handle pulled to the hips, 0 = arms fully out. */
  handleIn: number;
  /** In the air: spin request, +1 frontside, -1 backside. */
  spin: number;
  /** At takeoff: invert request, +1 front, -1 back. */
  flip: number;
  /** Hold for a raley. */
  raley: boolean;
  /** Held grab, if any. */
  grab: GrabId | null;
  /** Let go of the handle. */
  release: boolean;
}

export const neutralInput = (): InputFrame => ({
  edge: 0,
  load: false,
  handleIn: 1,
  spin: 0,
  flip: 0,
  raley: false,
  grab: null,
  release: false,
});
