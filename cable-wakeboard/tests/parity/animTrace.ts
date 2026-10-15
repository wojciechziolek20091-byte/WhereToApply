/**
 * Animation parity: the same sim run and every test-driver scenario through
 * src/anim and roblox/src/shared/Anim. The Luau twin is
 * roblox/tests/anim_trace.luau: same rows, same fields, same order.
 */
import { type AnimFrame, createAnimator, stepAnimator } from '../../src/anim/animator';
import type { RigDef } from '../../src/anim/skeleton';
import { JOINTS } from '../../src/anim/skeleton';
import { animStateFromSim, type RiderAnimState } from '../../src/anim/state';
import { playTo, SCENARIOS } from '../../src/anim/testDriver';
import { makeConfig } from '../../src/sim/config';
import { neutralInput, type InputFrame } from '../../src/sim/input';
import { createRng, nextFloat } from '../../src/sim/math/rng';
import { TEST_PARK } from '../../src/sim/parkLayout';
import { DEFAULT_PARK } from '../../src/sim/park';
import { createRun, stepRun } from '../../src/sim/session';
import type { TraceRow } from './trace';

const STEER = [-1, -1, 0, 1, 1];
const MODS: InputFrame['grabMod'][] = ['stalefish', 'nose', 'tail', null, null, null];

export function frameRow(tag: string, f: AnimFrame): TraceRow {
  const row: TraceRow = [tag, f.root.pos.x, f.root.pos.y, f.root.pos.z, f.root.rot.x, f.root.rot.y, f.root.rot.z, f.root.rot.w];
  row.push(f.hipsOffset.x, f.hipsOffset.y, f.hipsOffset.z);
  for (const j of JOINTS) {
    const q = f.local[j];
    // Same rotation either sign: compare with w >= 0.
    const s = q.w < 0 ? -1 : 1;
    row.push(q.x * s, q.y * s, q.z * s, q.w * s);
  }
  row.push(f.handle.pos.x, f.handle.pos.y, f.handle.pos.z, f.hands.L.x, f.hands.L.y, f.hands.L.z, f.hands.R.x, f.hands.R.y, f.hands.R.z);
  row.push(f.com.x, f.com.y, f.com.z, f.handKinds.L, f.handKinds.R, f.events.join(',') || '-', f.ragdoll ? 1 : 0);
  return row;
}

export const SCENARIO_US = [0.3, 0.7];

export function animTrace(rig: RigDef, seed: number, ticks: number, park: 'default' | 'test'): TraceRow[] {
  const rows: TraceRow[] = [];
  const run = createRun(makeConfig({ run: { maxFalls: 99 } }), park === 'test' ? TEST_PARK : DEFAULT_PARK);
  const straight = park === 'test' ? 0.6 : 0;
  const rng = createRng(seed);
  const a = createAnimator(rig);
  let input: InputFrame = neutralInput();
  let hold = 0;
  let prev: RiderAnimState | null = null;
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
    const st = animStateFromSim(run.sim, run.sim.events, prev);
    prev = st;
    const f = stepAnimator(a, st, 1 / 60);
    if (i % 5 === 0 || f.events.length > 0) rows.push(frameRow(`${i}|${st.state}|${st.trick.id ?? '-'}`, f));
  }
  for (const name of Object.keys(SCENARIOS)) {
    for (const u of SCENARIO_US) {
      rows.push(frameRow(`${name}@${u}`, playTo(createAnimator(rig), SCENARIOS[name]!, u, { x: 3, y: 0, z: -2 })));
    }
  }
  return rows;
}
