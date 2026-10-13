import { GrayboxRenderer, snapshotOf, type RenderSnapshot } from '../render/graybox';
import { DEFAULT_CONFIG } from '../sim/config';
import { DEFAULT_PARK } from '../sim/park';
import { createRun, stepRun, type RunState } from '../sim/session';
import { advanceStepper, createStepper } from '../sim/stepper';
import { Hud } from './hud';
import { Keyboard } from './keyboard';

const view = document.getElementById('view')!;
const hudEl = document.getElementById('hud')!;

let run: RunState = createRun(DEFAULT_CONFIG, DEFAULT_PARK);
const renderer = new GrayboxRenderer(view, run.sim);
const hud = new Hud(hudEl);
const keys = new Keyboard(window);
const stepper = createStepper();
let prev: RenderSnapshot = snapshotOf(run.sim);
let paused = false;
let last = performance.now();

function frame(now: number): void {
  const frameSeconds = Math.min(0.25, (now - last) / 1000);
  last = now;

  if (keys.consume('KeyP')) paused = !paused;
  if (keys.consume('Enter')) {
    run = createRun(DEFAULT_CONFIG, DEFAULT_PARK);
    prev = snapshotOf(run.sim);
  }

  let alpha = 1;
  if (!paused) {
    ({ alpha } = advanceStepper(stepper, frameSeconds, () => {
      prev = snapshotOf(run.sim);
      stepRun(run, keys.frame(run.sim.rider));
    }));
  }
  renderer.render(run.sim, prev, alpha, frameSeconds);
  hud.render(run, paused);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Handy in the browser console while tuning.
(window as unknown as { cable: () => RunState }).cable = () => run;
