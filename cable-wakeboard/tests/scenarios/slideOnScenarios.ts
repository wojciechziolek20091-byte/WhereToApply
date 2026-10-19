/**
 * The side approaches spec's scenario table (section 8): scripted side
 * approaches onto six features that must slide on, and failures that must
 * crash with their reason. Each line: the feature set `off` m to the side of
 * the cable line and turned `yaw` degrees in across it, the pop held from
 * `g0` m off its side and released at `g1`, W held the first 0.2 s of the
 * air, A/D as given. Used by tests/slideOnScenarios.test.ts and
 * scripts/slide-on-report.ts.
 */
import { DEFAULT_CONFIG } from '../../src/sim/config';
import { scoreFeatureLine } from '../../src/sim/featureRide/featureScoring';
import type { FeatureDef } from '../../src/sim/park';
import type { CrashReason, JibEntry } from '../../src/sim/rider';
import { ride } from './featureScenarios';

const deg = (d: number): number => (d * Math.PI) / 180;

const box = (height: number, width = 1, o: Partial<Extract<FeatureDef, { kind: 'slider' }>> = {}): FeatureDef => ({
  kind: 'slider', id: 'f', name: 'Box', style: 'box', s: 135, offset: 0, length: 8, width, height, entryLength: 3, safety: 'flush', ...o,
});

export interface SlideOnLine {
  id: string;
  kind: 'pass' | 'fail';
  what: string;
  def: FeatureDef;
  off: number;
  yaw: number;
  g0: number;
  g1: number;
  w?: boolean;
  /** A/D: held toward the feature while charging ('in'), for the first 0.5 m on the main ('counter', away from it), or the first `spinTime` s of the air ('spin', a turn to 90). */
  steer?: 'in' | 'counter' | 'spin';
  /** Pass: the entries that count. Fail: the crash. */
  entries?: JibEntry[];
  spinTime?: number;
  /** A/D (+1 away from the feature) for the first 0.12 s of the exit air: out of a 90 to fakie or forward. */
  exitTurn?: number;
  crash?: CrashReason;
  /** Fail without a crash: no slide-on was tried (the cue was off and the board flew as a plain side ollie). */
  noSlideOn?: boolean;
}

export const SLIDE_ON_LINES: SlideOnLine[] = [
  { id: 'P1', kind: 'pass', what: '0.3 m table (Slider), 15 degrees in', def: { kind: 'feature', id: 'f', name: 'Slider', catalog: 'Slider', s: 135, offset: 0 } as FeatureDef, off: -2, yaw: 15, g0: 2.4, g1: 1.0, entries: ['slideOn'] },
  { id: 'P2', kind: 'pass', what: '0.5 m box, 15 degrees in', def: box(0.5), off: -2, yaw: 15, g0: 2.4, g1: 1.0, entries: ['slideOn'] },
  { id: 'P3', kind: 'pass', what: '0.8 m ledge, 18 degrees in, W lifts the nose to 30', def: box(0.8), off: -2, yaw: 18, g0: 5, g1: 1.2, w: true, entries: ['slideOn'] },
  { id: 'P4', kind: 'pass', what: '0.63 m pipe, 12 degrees in', def: box(0.63, 0.4, { name: 'Pipe', style: 'tube', length: 10, entryLength: 2.5 }), off: -2, yaw: 12, g0: 2.4, g1: 1.0, entries: ['slideOn'] },
  { id: 'P5', kind: 'pass', what: '0.6 m thin rail: the board\'s middle over it (a side ollie-on)', def: box(0.6, 0.12, { name: 'Rail', style: 'rail' }), off: -2, yaw: 18, g0: 2.4, g1: 1.0, entries: ['sideOllieOn', 'slideOn'] },
  {
    id: 'P6', kind: 'pass', what: 'bank pyramid (0.5 m, 1 m banks): up the bank onto the top, 20 degrees in',
    def: { kind: 'feature', id: 'f', name: 'Pyramid', catalog: 'Pyramid', s: 135, offset: 0, params: { shape: 'pyramid', base: 8, top: 6, height: 0.5 } } as FeatureDef,
    off: -5, yaw: 20, g0: 2.4, g1: 1.0, entries: ['slideOn'],
  },
  { id: 'P7', kind: 'pass', what: '0.5 m box, 25 degrees in, counter-steer saves the overshoot', def: box(0.5), off: -2, yaw: 25, g0: 2.4, g1: 1.0, steer: 'counter', entries: ['slideOn'] },
  { id: 'P8', kind: 'pass', what: '0.5 m box, 20 degrees in, a 90 in the air: Edge Slide-on (90 out to ride off)', def: box(0.5), off: -2, yaw: 20, g0: 5, g1: 1.0, w: true, steer: 'spin', spinTime: 0.3, exitTurn: 1, entries: ['edgeSlideOn'] },
  { id: 'F1', kind: 'fail', what: '0.8 m ledge without W: NoseDig', def: box(0.8), off: -2, yaw: 18, g0: 5, g1: 1.2, crash: 'noseDig' },
  { id: 'F2', kind: 'fail', what: 'shallow (6.5 degrees): too little inward speed to climb, HangUp', def: box(0.5), off: -1.5, yaw: 6.5, g0: 1.6, g1: 0.6, crash: 'hangUp' },
  { id: 'F3', kind: 'fail', what: '40 degrees in: the nose meets the side face, NoseDig', def: box(0.5), off: -3, yaw: 40, g0: 2.4, g1: 1.0, crash: 'noseDig' },
  { id: 'F4', kind: 'fail', what: '25 degrees in, no counter-steer: Overshoot', def: box(0.5), off: -2, yaw: 25, g0: 2.4, g1: 1.0, crash: 'overshoot' },
  { id: 'F5', kind: 'fail', what: 'a hard heelside edge held into the pop: SlippedOut', def: box(0.5), off: -2.5, yaw: 12, g0: 2.4, g1: 1.0, steer: 'in', crash: 'slippedOut' },
  { id: 'F6', kind: 'fail', what: 'a wall above the top blocks it: no slide-on', def: box(0.5, 1, { sideWall: 0.5 }), off: -2, yaw: 15, g0: 2.4, g1: 1.0, noSlideOn: true },
  { id: 'F7', kind: 'fail', what: 'popped too close, 20 degrees: NoseDig', def: box(0.5), off: -2, yaw: 20, g0: 1.6, g1: 0.4, crash: 'noseDig' },
];

export interface SlideOnRun {
  crash: CrashReason | null;
  entry: JibEntry | null;
  sketchy: boolean;
  tried: boolean;
  maxPitch: number;
  /** Slides held, and the line's trick name and points (when it got as far as a feature line). */
  name: string;
  trick: string;
  points: number;
}

export function runSlideOnLine(l: SlideOnLine): SlideOnRun {
  const def = { ...l.def, offset: l.off, yaw: deg(l.yaw) * (l.off < 0 ? 1 : -1) } as FeatureDef;
  // + steer is away from a feature on the left (off < 0).
  const away = l.off < 0 ? 1 : -1;
  let held = false;
  let released = false;
  let tried = false;
  let maxPitch = 0;
  const run = ride(def, (c) => {
    const a = c.s.rider.approach;
    const so = c.s.rider.air?.slideOn;
    if (so) {
      tried = true;
      maxPitch = Math.max(maxPitch, so.pitch);
    }
    if (c.mode === 'riding' && a && !released && a.slideOnBlock !== 'front' && a.sideGap < l.g0) held = true;
    if (held && a && a.sideGap < l.g1) {
      held = false;
      released = true;
    }
    const steer =
      l.steer === 'in' && held && c.mode === 'riding' ? -away
      : l.steer === 'counter' && c.mode === 'onFeature' && c.mainU < 0.5 ? away
      : l.steer === 'spin' && c.entryAir >= 0 && c.entryAir < (l.spinTime ?? 0.3) ? away
      : l.exitTurn && c.exitAir >= 0 && c.exitAir < 0.12 ? l.exitTurn * away
      : 0;
    return { pop: held, forward: !!l.w && c.entryAir >= 0 && c.entryAir < 0.2, steer };
  });
  const j = run.jibs[0] ?? null;
  const line = run.events.find((e) => e.type === 'featureLine');
  const scored = line && line.type === 'featureLine' ? scoreFeatureLine(line.exit, line.air, line.landing, DEFAULT_CONFIG) : null;
  return {
    crash: run.crash,
    entry: j ? j.entry : null,
    sketchy: !!j?.sketchy,
    tried,
    maxPitch,
    name: j ? j.slideOrder.join(',') : '',
    trick: scored ? scored.name : '',
    points: scored ? Math.round(scored.points * scored.quality) : 0,
  };
}

/** '' when the line does what it should, else what it did. */
export function judgeSlideOnLine(l: SlideOnLine, r: SlideOnRun): string {
  if (l.kind === 'pass') return !r.crash && r.entry && l.entries!.includes(r.entry) ? '' : `${r.crash ?? r.entry ?? 'no entry'}`;
  if (l.noSlideOn) return r.tried ? 'a slide-on was tried' : '';
  return r.crash === l.crash ? '' : `${r.crash ?? r.entry ?? 'no crash'}`;
}
