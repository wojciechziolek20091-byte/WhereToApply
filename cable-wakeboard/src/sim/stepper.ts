import { DT } from './config';

/**
 * Fixed-timestep accumulator. The browser loop feeds variable frame times;
 * the sim always advances in whole DT ticks. `alpha` is how far the render
 * time sits between the last two ticks, for interpolation.
 */
export interface FixedStepper {
  accumulator: number;
  /** Cap on ticks per frame so a stalled tab does not spiral. */
  maxTicksPerFrame: number;
  dt: number;
}

export const createStepper = (maxTicksPerFrame = 8, dt = DT): FixedStepper => ({
  accumulator: 0,
  maxTicksPerFrame,
  dt,
});

export function advanceStepper(
  stepper: FixedStepper,
  frameSeconds: number,
  tick: () => void,
): { ticks: number; alpha: number } {
  stepper.accumulator += Math.max(0, frameSeconds);
  let ticks = 0;
  while (stepper.accumulator >= stepper.dt && ticks < stepper.maxTicksPerFrame) {
    tick();
    stepper.accumulator -= stepper.dt;
    ticks++;
  }
  if (ticks === stepper.maxTicksPerFrame && stepper.accumulator >= stepper.dt) {
    // Drop the backlog rather than trying to catch up forever.
    stepper.accumulator = 0;
  }
  return { ticks, alpha: stepper.accumulator / stepper.dt };
}
