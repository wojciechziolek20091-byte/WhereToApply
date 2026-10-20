/**
 * Scripted feature entries for the TypeScript <-> Luau parity check
 * (EntryResolver: side hops, clearance, scrape-ups, jump-overs, safety pops). The
 * Luau twin is roblox/tests/entry_trace.luau; the scenarios reach it as data.
 */
import { makeConfig } from '../../src/sim/config';
import { neutralInput } from '../../src/sim/input';
import type { ParkDef } from '../../src/sim/park';
import { stepSim } from '../../src/sim/step';
import { createSim } from '../../src/sim/world';
import type { TraceRow } from './trace';

export interface EntryScenario {
  name: string;
  /** Slider def fields over a 1 m box, 8 m long, 0.5 m high, 3 m flush safety, at s 135 on the line. */
  def: { offset?: number; yaw?: number; entryLength?: number; safety?: 'flush' | 'gap' };
  stance: 'regular' | 'goofy';
  /** [from, to) seconds: pop held (0/1) and steer (-1, 0, 1; the last non-zero one wins); optional W/S (+1 / -1). */
  steps: ([number, number, number, number] | [number, number, number, number, number])[];
}

const T = 1 / 60;
export const ENTRY_SCENARIOS: EntryScenario[] = [
  { name: 'front ollie-on', def: {}, stance: 'regular', steps: [[2.6, 2.9, 1, 0]] },
  { name: 'side heelside', def: { offset: -1.6 }, stance: 'regular', steps: [[3.2, 3.4, 1, 0], [3.4 - T, 3.4 + T, 0, -1]] },
  { name: 'side toeside goofy', def: { offset: -1.6 }, stance: 'goofy', steps: [[3.2, 3.4, 1, 0], [3.4 - T, 3.4 + T, 0, -1]] },
  { name: 'side, a little low: scrape-up (was clipped side)', def: { offset: 1.6 }, stance: 'regular', steps: [[3.3, 3.4, 1, 0], [3.4 - T, 3.4 + T, 0, 1]] },
  { name: '40 degrees: slide-on (was nose hit side)', def: { offset: -3, yaw: 0.7 }, stance: 'regular', steps: [[3.0, 3.3, 1, 0], [3.3 - T, 3.3 + T, 0, -1]] },
  { name: 'over the box into the water (was overshoot)', def: { offset: 1.0 }, stance: 'regular', steps: [[3.2, 3.4, 1, 0], [3.4 - T, 3.4 + T, 0, 1]] },
  { name: 'sketchy recovery', def: { offset: 1.1 }, stance: 'regular', steps: [[3.2, 3.4, 1, 0], [3.4 - T, 3.4 + T, 0, 1]] },
  { name: 'edge into a short pop: nose dig, never a slip-out', def: { offset: -2.2 }, stance: 'regular', steps: [[3.0, 3.39, 0, -1], [3.2, 3.4, 1, 0], [3.4 - T, 3.4 + T, 0, -1]] },
  { name: '180-in pop-on', def: {}, stance: 'regular', steps: [[3.2, 3.5, 1, 0], [3.5, 3.8, 0, 1]] },
  { name: 'ollie onto the safety', def: { offset: 1.3, entryLength: 6, safety: 'gap' }, stance: 'regular', steps: [[3.0, 3.1, 1, 0], [3.1 - T, 3.1 + T, 0, 1], [3.65, 3.9, 1, 0]] },
  { name: 'early hop, gap', def: { safety: 'gap' }, stance: 'regular', steps: [[3.15, 3.2, 1, 0]] },
  { name: 'early pop, flush tail clip', def: {}, stance: 'regular', steps: [[2.9, 3.25, 1, 0]] },
  { name: 'heelside 90-in boardslide', def: { offset: -1.6 }, stance: 'regular', steps: [[3.2, 3.4, 1, 0], [3.4 - T, 3.6, 0, -1]] },
  { name: 'toeside 90-in lipslide', def: { offset: 1.6 }, stance: 'regular', steps: [[3.2, 3.4, 1, 0], [3.4 - T, 3.4 + T, 0, 1], [3.4 + T, 3.6, 0, -1]] },
  { name: '50-50 180 on the box', def: {}, stance: 'goofy', steps: [[3.6, 3.95, 0, -1]] },
  { name: 'rotation into the end', def: {}, stance: 'regular', steps: [[4.3, 4.6, 0, -1]] },
  { name: 'nose press', def: {}, stance: 'regular', steps: [[3.6, 4.4, 0, 0, 1]] },
  { name: 'tail press, end tap', def: {}, stance: 'goofy', steps: [[3.6, 4.2, 0, 0, -1], [4.45, 4.5, 0, 0, 1]] },
  // Slide-ons (side approaches spec): turned 15-20 degrees in toward the box.
  { name: 'slide-on', def: { offset: -2, yaw: 0.2618 }, stance: 'regular', steps: [[2.9, 3.3, 1, 0]] },
  { name: 'slide-on, W nose lift', def: { offset: -2, yaw: 0.2618 }, stance: 'regular', steps: [[3.0, 3.3, 1, 0], [3.3, 3.9, 0, 0, 1]] },
  { name: 'slide-on, A held (was a nose dig)', def: { offset: -2, yaw: 0.2618 }, stance: 'regular', steps: [[2.9, 3.3, 1, 0], [3.3, 3.9, 0, -1]] },
  // A quarter turn in the air: across the board at the edge (v2 alignment: 60-120 degrees).
  { name: 'edge slide-on', def: { offset: -2, yaw: 0.35 }, stance: 'regular', steps: [[2.6, 3.0, 1, 0], [3.0, 3.15, 0, -1]] },
  // Space held into the side, never released: it pops on its own and turns the board sideways (a boardslide).
  { name: 'auto pop, sideways', def: { offset: -2 }, stance: 'regular', steps: [[2.8, 6, 1, 0], [2.5, 3.1, 0, -1]] },
];

/** One row per tick until a crash or 6 s: state, approach, entry. */
export function entryTrace(sc: EntryScenario): TraceRow[] {
  const park: ParkDef = {
    name: 'entry',
    features: [{ kind: 'slider', id: 'b', name: 'B', style: 'box', s: 135, offset: 0, length: 8, width: 1, height: 0.5, entryLength: 3, safety: 'flush', ...sc.def }],
  };
  const s = createSim(makeConfig({ feature: { balanceEnabled: false } }), park, 125);
  s.rider.stance = sc.stance;
  const rows: TraceRow[] = [];
  for (let i = 0; i < 360; i++) {
    const t = i / 60;
    const input = neutralInput();
    for (const [from, to, pop, steer, fore] of sc.steps) {
      if (t >= from && t < to) {
        if (pop === 1) input.pop = true;
        if (steer !== 0) input.steer = steer;
        if (fore === 1) input.forward = true;
        if (fore === -1) input.back = true;
      }
    }
    stepSim(s, input);
    const r = s.rider;
    const a = r.approach;
    const e = r.air?.entry;
    const crash = s.events.find((x) => x.type === 'crash');
    rows.push([
      s.tick,
      r.mode,
      r.pos.x,
      r.pos.y,
      r.pos.z,
      r.vel.x,
      r.vel.y,
      r.vel.z,
      a ? a.side : '-',
      a ? a.featureSide : 0,
      a ? a.edgeAge : 0,
      a ? a.slideOnBlock || 'ok' : '-',
      a ? a.turnIn : 0,
      a ? a.inwardSpeed : 0,
      a ? a.topHeight : 0,
      a ? a.maxHeight : 0,
      e ? e.side : '-',
      e ? e.hop : 0,
      e ? e.roll : 0,
      r.air?.crossing ? r.air.crossing.part : '-',
      r.air?.crossing ? r.air.crossing.side : 0,
      r.air?.tailClip ? 1 : 0,
      r.jib ? r.jib.entry : '-',
      r.jib?.sketchy ? 1 : 0,
      r.jib ? r.jib.balance : 0,
      r.jib ? r.jib.inRotation : 0,
      r.jib ? r.jib.slideOrder.join('/') : '-',
      r.jib ? r.jib.rotations.map((x) => `${x.deg}${x.hardWay ? 'h' : ''}`).join('/') : '-',
      r.jib ? r.jib.pressAmount : 0,
      r.jib ? r.jib.fore : 0,
      r.jib?.endTap ?? '-',
      crash?.type === 'crash' ? crash.reason : '-',
    ]);
    if (crash) break;
  }
  return rows;
}
