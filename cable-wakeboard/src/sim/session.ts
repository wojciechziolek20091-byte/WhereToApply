import { lapsAt } from './cable';
import type { SimConfig } from './config';
import { DEFAULT_CONFIG, DT } from './config';
import type { InputFrame } from './input';
import { distance, horizontal } from './math/vec';
import { DEFAULT_PARK, type ParkDef } from './park';
import { computeRunMetrics, type FallRecord, type TrickRecord } from './scoring/metrics';
import { type RunScore, scoreRun } from './scoring/judges';
import { stepSim } from './step';
import { classifyAir, classifyJib } from './tricks/classify';
import { createSim, type SimState, spawnRiderBehindCarrier } from './world';

/**
 * A competition run: `passesPerRun` laps of the cable, ended early by
 * `maxFalls` falls. Owns the sim, the trick log and the final score.
 */
export interface RunState {
  sim: SimState;
  /** Carrier arc length when the run started. */
  startS: number;
  pass: number;
  tricks: TrickRecord[];
  falls: FallRecord[];
  /** Seconds since the last trick or feature. */
  sinceAction: number;
  deadWater: number;
  finished: boolean;
  endReason: 'passes' | 'falls' | null;
  score: RunScore | null;
  /** Tricks landed on the most recent tick, for the HUD. */
  latest: TrickRecord[];
  /** Running points total shown in the HUD (not the judges' score). */
  points: number;
}

/**
 * Arcade points for one trick, for the HUD: difficulty scaled by how clean
 * the landing was and how big the air was. Judges score the run separately.
 */
export function trickPoints(rec: Pick<TrickRecord, 'trick' | 'landingQuality' | 'height' | 'airTime'>): number {
  const size = 1 + Math.min(rec.height, 4) / 4 + Math.min(rec.airTime, 2) / 4;
  return Math.max(5, Math.round(10 * rec.trick.difficulty * (0.5 + 0.5 * rec.landingQuality) * size));
}

export function createRun(cfg: SimConfig = DEFAULT_CONFIG, park: ParkDef = DEFAULT_PARK): RunState {
  const sim = createSim(cfg, park);
  return {
    sim,
    startS: sim.carrier.s,
    pass: 0,
    tricks: [],
    falls: [],
    sinceAction: 0,
    deadWater: 0,
    finished: false,
    endReason: null,
    score: null,
    latest: [],
    points: 0,
  };
}

function finish(run: RunState, reason: 'passes' | 'falls'): void {
  run.finished = true;
  run.endReason = reason;
  const metrics = computeRunMetrics(
    run.tricks,
    run.falls,
    run.sim.features.length,
    run.deadWater,
    run.sim.time,
  );
  run.score = scoreRun(metrics, run.sim.cfg.scoring);
}

/** One fixed tick of the run. Does nothing once finished. */
export function stepRun(run: RunState, input: InputFrame): void {
  run.latest = [];
  if (run.finished) return;
  const s = run.sim;
  stepSim(s, input);

  for (const e of s.events) {
    if (e.type === 'landed') {
      const trick = classifyAir(e.air, e.landing, s.rider.stance, s.cfg.air.minAirTime);
      if (!trick) continue;
      const rec: TrickRecord = {
        tick: e.tick,
        pass: run.pass,
        trick,
        airTime: e.air.time,
        height: e.air.peakHeight,
        distance: distance(horizontal(e.air.takeoffPos), horizontal(s.rider.pos)),
        landingQuality: e.landing.quality,
        popQuality: e.air.popQuality,
        spunBeforePeak: e.air.spunBeforePeak,
        featureId: e.air.featureId,
      };
      run.tricks.push(rec);
      run.latest.push(rec);
      run.points += trickPoints(rec);
      run.sinceAction = 0;
    } else if (e.type === 'jibDone' && s.rider.mode !== 'fallen') {
      const trick = classifyJib(e.time, e.alignedTime, e.crossedTime);
      if (!trick) continue;
      const rec: TrickRecord = {
        tick: e.tick,
        pass: run.pass,
        trick,
        airTime: 0,
        height: 0,
        distance: 0,
        landingQuality: 1 - Math.min(1, Math.abs(s.rider.jib?.balance ?? 0)),
        popQuality: 0,
        spunBeforePeak: false,
        featureId: e.featureId,
      };
      run.tricks.push(rec);
      run.latest.push(rec);
      run.points += trickPoints(rec);
      run.sinceAction = 0;
    } else if (e.type === 'featureEnter') {
      run.sinceAction = 0;
    } else if (e.type === 'fall') {
      run.falls.push({ tick: e.tick, pass: run.pass, kind: e.kind });
    }
  }

  run.sinceAction += DT;
  if (run.sinceAction > s.cfg.run.deadWaterTime) run.deadWater += DT;

  if (run.falls.length >= s.cfg.run.maxFalls) {
    finish(run, 'falls');
    return;
  }
  if (s.rider.mode === 'fallen' && s.rider.fallTimer <= 0) {
    s.rider = spawnRiderBehindCarrier(s);
    run.sinceAction = 0;
  }
  const pass = lapsAt(s.path, s.carrier.s - run.startS);
  if (pass !== run.pass) {
    run.pass = pass;
    if (pass >= s.cfg.run.passesPerRun) finish(run, 'passes');
  }
}
