import { RIDER_PALETTES, type RiderPalette } from '../art/riders';
import { BabylonRenderer } from '../render/babylon/BabylonRenderer';
import { LOOKS } from '../render/babylon/looks';
import { GrayboxRenderer, snapshotOf, type RenderSnapshot } from '../render/graybox';
import { DEFAULT_CONFIG } from '../sim/config';
import { DEFAULT_PARK, type ParkDef } from '../sim/park';
import { BEGINNER_PARK, CATALOG_TEST_PARK, LAKESIDE_PARK, TEST_PARK } from '../sim/parkLayout';
import { createRun, stepRun, type RunState } from '../sim/session';
import { advanceStepper, createStepper } from '../sim/stepper';
import type { SimEvent } from '../sim/events';
import type { SimState } from '../sim/world';
import { DEFAULT_ANIM_CONFIG } from '../anim/config';
import { PoseScrubber } from './animDebug';
import hudCss from './hud.css?inline';
import { Hud } from './hud';
import { Keyboard } from './keyboard';
import { mountStartScreen, mountTouchControls } from './touch';

interface GameRenderer {
  render(sim: SimState, prev: RenderSnapshot, alpha: number, frameSeconds: number, events?: SimEvent[]): void;
  setPalette?(palette: RiderPalette): void;
  scrub?: { name: string; u: number } | null;
  showSkeleton?: boolean;
}

// The UI stylesheet ships inside the bundle so every host gets the same look.
const style = document.createElement('style');
style.textContent = hudCss;
document.head.appendChild(style);

const view = document.getElementById('view')!;
const hudEl = document.getElementById('hud')!;
const params = new URLSearchParams(location.search);
/**
 * The wake park (default). `?park=beginner`: the 2-tower beginner system.
 * `?park=sketch`: the user's sketch layout. `?park=test`: the mechanics spec's
 * test map. `?park=catalog`: every catalogue feature on the line.
 */
const PARKS: Record<string, ParkDef> = { test: TEST_PARK, catalog: CATALOG_TEST_PARK, beginner: BEGINNER_PARK, sketch: LAKESIDE_PARK };
const PARK = PARKS[params.get('park') ?? ''] ?? DEFAULT_PARK;

/** `?physics=old`: section 11 of the animation spec off (no tuck-driven rotation, pre-wind, shoulder rope, landing cost, COM pivot). */
const OLD_PHYSICS = params.get('physics') === 'old';
const CONFIG = OLD_PHYSICS ? oldPhysics(DEFAULT_CONFIG) : DEFAULT_CONFIG;
if (OLD_PHYSICS) DEFAULT_ANIM_CONFIG.Physics.ComPivot = false;

let run: RunState = createRun(CONFIG, PARK);
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
  const r = new BabylonRenderer(canvas, run.sim, initialPalette, look, PARK.site);
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
/** Events of every tick since the last frame, for the animation (landings, pops...). */
let pending: SimEvent[] = [];
/** F4: local time scale for checking motion in slow motion. */
let timeScaleIndex = 0;
const scrubParam = params.get('scrub');
const scrubber = new PoseScrubber(document.body, scrubParam ? { name: scrubParam, u: Number(params.get('u') ?? '0.5') } : null);
if (params.get('skeleton') === '1') renderer.showSkeleton = true;
/** `?clean=1`: no HUD or panels, for captures. */
if (params.get('clean') === '1') {
  hudEl.style.display = 'none';
  scrubber.el.style.visibility = 'hidden';
}
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
  parkBlurb(PARK),
);

/** The start screen's one-line description of the park. */
function parkBlurb(park: ParkDef): string {
  const towers = park.cable?.towers?.length ?? DEFAULT_CONFIG.cable.towers.length;
  const lines = new Set(park.features.flatMap((f) => (f.kind === 'feature' && f.line ? [f.line] : [])));
  const what = lines.size > 0 ? `${lines.size === 1 ? 'one line' : `${lines.size} lines`}, ${park.features.length} features` : `${park.features.length} features`;
  return `${park.name}: ${towers === 2 ? '2-tower system' : `${towers}-tower cable`}, 30 km/h, ${what}`;
}

function frame(now: number): void {
  const scales = DEFAULT_ANIM_CONFIG.Debug.TimeScales;
  if (keys.consume('F4')) timeScaleIndex = (timeScaleIndex + 1) % scales.length;
  if (keys.consume('F6')) renderer.showSkeleton = !renderer.showSkeleton;
  if (keys.consume('F7')) scrubber.toggle();
  const frameSeconds = Math.min(0.25, (now - last) / 1000) * scales[timeScaleIndex]!;
  last = now;

  if (keys.consume('KeyP')) paused = !paused;
  if (keys.consume('KeyH')) hud.toggleHelp();
  if (keys.consume('F3')) hud.toggleDebug();
  if (keys.consume('Enter')) {
    run = createRun(CONFIG, PARK);
    prev = snapshotOf(run.sim);
  }

  let alpha = 1;
  const scrub = scrubber.current(frameSeconds);
  renderer.scrub = scrub;
  if (!paused && !scrub) {
    ({ alpha } = advanceStepper(stepper, frameSeconds, () => {
      prev = snapshotOf(run.sim);
      stepRun(run, keys.frame());
      pending.push(...run.sim.events);
    }));
  }
  renderer.render(run.sim, prev, alpha, frameSeconds, pending);
  pending = [];
  hud.render(run, paused, scales[timeScaleIndex]!);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

/** Section 11 of the animation spec switched off, for comparing old and new. */
function oldPhysics(c: typeof DEFAULT_CONFIG): typeof DEFAULT_CONFIG {
  return { ...c, physics: { ...c.physics, tuckRotation: false, preWind: false, ropeAtShoulders: false, landingSpeedCost: false } };
}

// Handy in the browser console while tuning.
(window as unknown as { cable: () => RunState }).cable = () => run;
(window as unknown as { renderer: GameRenderer }).renderer = renderer;
