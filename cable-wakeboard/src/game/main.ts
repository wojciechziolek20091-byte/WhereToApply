import { RIDER_PALETTES, type RiderPalette } from '../art/riders';
import { BabylonRenderer } from '../render/babylon/BabylonRenderer';
import { LOOKS } from '../render/babylon/looks';
import { GrayboxRenderer, snapshotOf, type RenderSnapshot } from '../render/graybox';
import { DEFAULT_CONFIG } from '../sim/config';
import { DEFAULT_PARK } from '../sim/park';
import { TEST_PARK } from '../sim/parkLayout';
import { createRun, stepRun, type RunState } from '../sim/session';
import { advanceStepper, createStepper } from '../sim/stepper';
import type { SimState } from '../sim/world';
import hudCss from './hud.css?inline';
import { Hud } from './hud';
import { Keyboard } from './keyboard';
import { mountStartScreen, mountTouchControls } from './touch';

interface GameRenderer {
  render(sim: SimState, prev: RenderSnapshot, alpha: number, frameSeconds: number): void;
  setPalette?(palette: RiderPalette): void;
}

// The UI stylesheet ships inside the bundle so every host gets the same look.
const style = document.createElement('style');
style.textContent = hudCss;
document.head.appendChild(style);

const view = document.getElementById('view')!;
const hudEl = document.getElementById('hud')!;
const params = new URLSearchParams(location.search);
/** `?park=test`: the spec's test map (kicker, flush funbox, gap box, 8 m rail on the line). */
const PARK = params.get('park') === 'test' ? TEST_PARK : DEFAULT_PARK;

let run: RunState = createRun(DEFAULT_CONFIG, PARK);
const initialPalette = (RIDER_PALETTES as string[]).includes(params.get('rider') ?? '')
  ? (params.get('rider') as RiderPalette)
  : 'Sheet';

/** Babylon.js is the game engine; `?renderer=graybox` keeps the old three.js view for debugging. */
function createRenderer(): GameRenderer {
  if (params.get('renderer') === 'graybox') return new GrayboxRenderer(view, run.sim);
  const canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.touchAction = 'none';
  view.appendChild(canvas);
  const look = params.get('look') === 'dusk' ? LOOKS.dusk : LOOKS.day;
  const r = new BabylonRenderer(canvas, run.sim, initialPalette, look);
  const cam = params.get('cam');
  if (cam === 'front' || cam === 'back' || cam === 'side' || cam === 'aerial' || cam === 'map') r.debugCam = cam;
  return r;
}

const renderer = createRenderer();
const hud = new Hud(hudEl);
const keys = new Keyboard(window);
const stepper = createStepper();
let prev: RenderSnapshot = snapshotOf(run.sim);
let paused = true;
let last = performance.now();

mountTouchControls(document.body, keys);
mountStartScreen(
  document.body,
  () => {
    paused = false;
    last = performance.now();
  },
  (rider) => renderer.setPalette?.(rider as RiderPalette),
  initialPalette,
);

function frame(now: number): void {
  const frameSeconds = Math.min(0.25, (now - last) / 1000);
  last = now;

  if (keys.consume('KeyP')) paused = !paused;
  if (keys.consume('KeyH')) hud.toggleHelp();
  if (keys.consume('F3')) hud.toggleDebug();
  if (keys.consume('Enter')) {
    run = createRun(DEFAULT_CONFIG, PARK);
    prev = snapshotOf(run.sim);
  }

  let alpha = 1;
  if (!paused) {
    ({ alpha } = advanceStepper(stepper, frameSeconds, () => {
      prev = snapshotOf(run.sim);
      stepRun(run, keys.frame());
    }));
  }
  renderer.render(run.sim, prev, alpha, frameSeconds);
  hud.render(run, paused);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Handy in the browser console while tuning.
(window as unknown as { cable: () => RunState }).cable = () => run;
(window as unknown as { renderer: GameRenderer }).renderer = renderer;
