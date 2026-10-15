/**
 * Scripted run for the TypeScript <-> Luau parity check. The Luau twin is
 * roblox/tests/sim_trace.luau: keep the two in lockstep (same RNG draws in the
 * same order, same fields in the same order).
 */
import { makeConfig } from '../../src/sim/config';
import { neutralInput, type InputFrame } from '../../src/sim/input';
import { createRng, nextFloat, nextRange } from '../../src/sim/math/rng';
import { createRun, stepRun } from '../../src/sim/session';
import type { GrabId } from '../../src/sim/tricks/data';

const GRAB_CHOICES: (GrabId | null)[] = ['indy', 'melon', 'mute', 'stalefish', 'nose', 'tail', null, null];
const SPIN_CHOICES = [-1, 0, 0, 1];
const FLIP_CHOICES = [-1, 0, 0, 0, 1];

/** One trace row: strings and numbers, compared field by field. */
export type TraceRow = (string | number)[];

export function traceRun(seed: number, ticks: number): TraceRow[] {
  const run = createRun(makeConfig({ run: { maxFalls: 99 } }));
  const rng = createRng(seed);
  let input: InputFrame = neutralInput();
  let hold = 0;
  const rows: TraceRow[] = [];
  for (let i = 0; i < ticks && !run.finished; i++) {
    if (hold <= 0) {
      hold = 20 + Math.floor(nextFloat(rng) * 70);
      input = {
        edge: nextRange(rng, -1, 1),
        load: nextFloat(rng) < 0.4,
        handleIn: nextRange(rng, 0.3, 1),
        spin: SPIN_CHOICES[Math.floor(nextFloat(rng) * 4)]!,
        flip: FLIP_CHOICES[Math.floor(nextFloat(rng) * 5)]!,
        raley: nextFloat(rng) < 0.15,
        grab: GRAB_CHOICES[Math.floor(nextFloat(rng) * 8)]!,
        release: false,
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
      r.connection,
      r.air ? r.air.spinAngle : 0,
      r.air ? r.air.flipAngle : 0,
      run.pass,
      run.tricks.length,
      run.falls.length,
      run.points,
      s.events.map((e) => e.type).join(',') || '-',
    ]);
    for (const rec of run.latest) rows.push(['trick', rec.tick, rec.trick.key, rec.trick.name, rec.trick.difficulty]);
  }
  if (run.score) {
    for (const j of run.score.judges) rows.push(['judge', j.execution, j.intensity, j.composition, j.total]);
    rows.push(['score', run.score.total, run.endReason ?? '-']);
  }
  return rows;
}
