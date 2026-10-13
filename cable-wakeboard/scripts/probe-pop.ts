// Flat-water pop probe. Run with: npx vite-node scripts/probe-pop.ts
import { createSim } from '../src/sim/world';
import { stepSim } from '../src/sim/step';
import { neutralInput } from '../src/sim/input';

function trial(label: string, releaseAt: number, flattenAt: number, edgeSign = 1, cutFor = 1.6) {
  const s = createSim();
  const inp = neutralInput();
  let air = 0, peak = 0, pop = 0, landed = '';
  for (let t = 0; t < 60 * 12; t++) {
    const sec = t / 60;
    const c = sec - 4; // cut starts at 4 s
    inp.edge = c > 0 && c < cutFor ? -edgeSign : c >= cutFor && c < flattenAt ? edgeSign : 0;
    inp.load = c > releaseAt - 0.4 && c < releaseAt;
    stepSim(s, inp);
    for (const e of s.events) {
      if (e.type === 'takeoff') pop = e.popSpeed;
      if (e.type === 'landed') { air = e.air.time; peak = e.air.peakHeight; landed = 'clean'; }
      if (e.type === 'fall') landed = e.kind;
    }
    if (landed) break;
  }
  console.log(label, 'pop', pop.toFixed(2), 'air', air.toFixed(2), 'peak', peak.toFixed(2), landed);
}
trial('cut out then in, held edge   ', 3.8, 9);
trial('released in the slack        ', 2.4, 9);
trial('cut in, flattened before pop ', 3.8, 3.5);
trial('unloaded ollie               ', -2.0, 9);
