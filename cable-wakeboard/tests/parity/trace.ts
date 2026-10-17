/**
 * Scripted run for the TypeScript <-> Luau parity check. The Luau twin is
 * roblox/tests/sim_trace.luau: keep the two in lockstep (same RNG draws in the
 * same order, same fields in the same order).
 */
import { makeConfig } from '../../src/sim/config';
import { neutralInput, type InputFrame } from '../../src/sim/input';
import { createRng, nextFloat } from '../../src/sim/math/rng';
import { DEFAULT_PARK } from '../../src/sim/park';
import { CATALOG_TEST_PARK, TEST_PARK } from '../../src/sim/parkLayout';
import { createRun, stepRun } from '../../src/sim/session';

const STEER = [-1, -1, 0, 1, 1];
const MODS: InputFrame['grabMod'][] = ['stalefish', 'nose', 'tail', null, null, null];

/** One trace row: strings and numbers, compared field by field. */
export type TraceRow = (string | number)[];

/** `park`: 'default', or 'test' (features on the line, steering mostly straight so they get ridden). */
export function traceRun(seed: number, ticks: number, park: 'default' | 'test' | 'catalog' = 'default'): TraceRow[] {
  const run = createRun(makeConfig({ run: { maxFalls: 99 } }), park === 'test' ? TEST_PARK : park === 'catalog' ? CATALOG_TEST_PARK : DEFAULT_PARK);
  const straight = park === 'default' ? 0 : 0.6;
  const rng = createRng(seed);
  let input: InputFrame = neutralInput();
  let hold = 0;
  const rows: TraceRow[] = [];
  for (let i = 0; i < ticks && !run.finished; i++) {
    if (hold <= 0) {
      hold = 10 + Math.floor(nextFloat(rng) * 50);
      input = {
        steer: nextFloat(rng) < straight ? 0 : STEER[Math.floor(nextFloat(rng) * 5)]!,
        pop: nextFloat(rng) < 0.35,
        forward: nextFloat(rng) < 0.15,
        back: nextFloat(rng) < 0.15,
        pass: nextFloat(rng) < 0.2,
        grab: nextFloat(rng) < 0.2,
        grabMod: MODS[Math.floor(nextFloat(rng) * 6)]!,
        armsOut: nextFloat(rng) < 0.05,
        letGo: false,
      };
    }
    hold--;
    stepRun(run, input);
    const s = run.sim;
    const r = s.rider;
    rows.push([
      s.tick,
      r.mode,
      s.carrier.s,
      r.pos.x,
      r.pos.y,
      r.pos.z,
      r.vel.x,
      r.vel.y,
      r.vel.z,
      r.heading,
      r.edgeAngle,
      r.edgeLoad,
      r.ropeTension,
      r.tensionSmooth,
      r.connection,
      r.handle,
      r.air ? r.air.rot.spinAngle : 0,
      r.air ? r.air.rot.flipAngle : 0,
      r.air && r.air.trick ? r.air.trick.rollAngle : 0,
      r.air ? r.air.preWind : 0,
      r.air ? r.air.rot.spinTime : 0,
      s.inputs.steerAge,
      r.jib ? r.jib.boardAngle : 0,
      r.jib ? r.jib.balance : 0,
      r.approach ? `${r.approach.featureId}:${r.approach.side}` : '-',
      r.approach ? r.approach.toStart : 0,
      r.approach ? r.approach.lateral : 0,
      r.approach ? r.approach.angle : 0,
      r.approach ? r.approach.edgeTime : 0,
      run.pass,
      run.tricks.length,
      run.crashes.length,
      run.points,
      s.events.map((e) => e.type).join(',') || '-',
    ]);
    for (const rec of run.latest) rows.push(['trick', rec.tick, rec.trick.key, rec.trick.points, rec.trick.difficulty]);
  }
  if (run.score) {
    for (const j of run.score.judges) rows.push(['judge', j.execution, j.intensity, j.composition, j.total]);
    rows.push(['score', run.score.total, run.endReason ?? '-', run.bestCombo]);
  }
  return rows;
}
