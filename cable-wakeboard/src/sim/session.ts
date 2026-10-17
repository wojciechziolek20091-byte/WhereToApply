import { lapsAt } from './cable';
import type { SimConfig } from './config';
import { DEFAULT_CONFIG, DT } from './config';
import { onWater } from './fsm';
import type { InputFrame } from './input';
import { distance, horizontal } from './math/vec';
import { DEFAULT_PARK, type ParkDef } from './park';
import { type ComboEntry, comboName, scoreCombo } from './scoring/combo';
import { computeRunMetrics, type CrashRecord, type TrickRecord } from './scoring/metrics';
import { type RunScore, scoreRun } from './scoring/judges';
import { stepSim } from './step';
import { classifyAir } from './tricks/classify';
import { scoreFeatureLine } from './featureRide/featureScoring';
import { createSim, type SimState, spawnRiderBehindCarrier } from './world';

/** The combo being built: tricks chained within the link window. */
export interface ComboState {
  entries: ComboEntry[];
  /** Riding time since the last landing (s); the combo banks when it passes `combo.linkWindow`. */
  sinceLanding: number;
}

/** The last combo that ended, for the HUD feed. */
export interface ComboResult {
  name: string;
  total: number;
  multiplier: number;
  tricks: number;
  voided: boolean;
  tick: number;
}

/**
 * A competition run: `passesPerRun` laps of the cable, ended early by
 * `maxFalls` crashes. Owns the sim, the trick log, combos and the final score.
 */
export interface RunState {
  sim: SimState;
  /** Carrier arc length when the run started. */
  startS: number;
  pass: number;
  tricks: TrickRecord[];
  crashes: CrashRecord[];
  /** Seconds since the last trick or feature. */
  sinceAction: number;
  deadWater: number;
  finished: boolean;
  endReason: 'passes' | 'falls' | null;
  /** Judges' panel, at the end of the run. */
  score: RunScore | null;
  /** Tricks landed on the most recent tick, for the HUD. */
  latest: TrickRecord[];
  /** Banked combo points (the arcade score). */
  points: number;
  combo: ComboState | null;
  bestCombo: number;
  lastCombo: ComboResult | null;
}

export function createRun(cfg: SimConfig = DEFAULT_CONFIG, park: ParkDef = DEFAULT_PARK): RunState {
  const sim = createSim(cfg, park);
  return {
    sim,
    startS: sim.carrier.s,
    pass: 0,
    tricks: [],
    crashes: [],
    sinceAction: 0,
    deadWater: 0,
    finished: false,
    endReason: null,
    score: null,
    latest: [],
    points: 0,
    combo: null,
    bestCombo: 0,
    lastCombo: null,
  };
}

/** The combo's live score, for the HUD. */
export const liveCombo = (run: RunState) => (run.combo ? scoreCombo(run.combo.entries, run.sim.cfg.combo) : null);

function endCombo(run: RunState, voided: boolean): void {
  const c = run.combo;
  if (!c) return;
  const score = scoreCombo(c.entries, run.sim.cfg.combo);
  run.lastCombo = {
    name: comboName(c.entries),
    total: voided ? 0 : score.total,
    multiplier: score.multiplier,
    tricks: c.entries.length,
    voided,
    tick: run.sim.tick,
  };
  if (!voided) {
    run.points += score.total;
    run.bestCombo = Math.max(run.bestCombo, score.total);
  }
  run.combo = null;
}

function finish(run: RunState, reason: 'passes' | 'falls'): void {
  endCombo(run, false);
  run.finished = true;
  run.endReason = reason;
  const metrics = computeRunMetrics(run.tricks, run.crashes, run.sim.features.length, run.deadWater, run.sim.time);
  run.score = scoreRun(metrics, run.sim.cfg.scoring);
}

function addTrick(run: RunState, rec: TrickRecord): void {
  run.tricks.push(rec);
  run.latest.push(rec);
  const t = rec.trick;
  if (!run.combo) run.combo = { entries: [], sinceLanding: 0 };
  run.combo.entries.push({ name: t.name, points: t.points, quality: t.quality, comboFactor: t.comboFactor });
  run.combo.sinceLanding = 0;
  run.sinceAction = 0;
}

/** One fixed tick of the run. Does nothing once finished. */
export function stepRun(run: RunState, input: InputFrame): void {
  run.latest = [];
  if (run.finished) return;
  const s = run.sim;
  stepSim(s, input);

  for (const e of s.events) {
    if (e.type === 'landed') {
      // Airs onto a feature or off one belong to its feature line (scored on the water).
      if (e.onFeature || e.air.exit) continue;
      const trick = classifyAir(e.air, e.landing, s.cfg);
      if (!trick) continue;
      addTrick(run, {
        tick: e.tick,
        pass: run.pass,
        trick,
        airTime: e.air.time,
        height: e.air.peakHeight,
        distance: distance(horizontal(e.air.takeoffPos), horizontal(s.rider.pos)),
        landingQuality: e.landing.quality,
        popQuality: e.air.popQuality,
        clean: e.landing.clean,
        featureId: e.air.featureId,
      });
    } else if (e.type === 'featureLine') {
      // A whole feature line: entry, slides, rotations, transfers, exit (feature riding spec 8, 9).
      const trick = scoreFeatureLine(e.exit, e.air, e.landing, s.cfg);
      const last = e.exit.jibs[e.exit.jibs.length - 1]!;
      addTrick(run, {
        tick: e.tick,
        pass: run.pass,
        trick,
        airTime: e.air ? e.air.time : 0,
        height: e.air ? e.air.peakHeight : 0,
        distance: 0,
        landingQuality: e.landing ? e.landing.quality : 1 - Math.min(1, Math.abs(last.balance)),
        popQuality: e.exit.jibs[0]!.entry === 'popOn' ? 1 : 0,
        clean: trick.quality > 1,
        featureId: last.featureId,
      });
    } else if (e.type === 'featureEnter' || e.type === 'takeoff') {
      run.sinceAction = 0;
    } else if (e.type === 'crash') {
      run.crashes.push({ tick: e.tick, pass: run.pass, reason: e.reason });
      endCombo(run, true);
    }
  }

  // The link window only runs while riding on the water.
  if (run.combo && onWater(s.rider.mode)) {
    run.combo.sinceLanding += DT;
    if (run.combo.sinceLanding > s.cfg.combo.linkWindow) endCombo(run, false);
  }

  run.sinceAction += DT;
  if (run.sinceAction > s.cfg.run.deadWaterTime) run.deadWater += DT;

  if (run.crashes.length >= s.cfg.run.maxFalls) {
    finish(run, 'falls');
    return;
  }
  if (s.rider.mode === 'crashed' && s.rider.crashTimer <= 0) {
    s.rider = spawnRiderBehindCarrier(s);
    run.sinceAction = 0;
  }
  const pass = lapsAt(s.path, s.carrier.s - run.startS);
  if (pass !== run.pass) {
    run.pass = pass;
    if (pass >= s.cfg.run.passesPerRun) finish(run, 'passes');
  }
}
