// Ad-hoc tuning probe: prints rider state over a scripted input sequence.
// Run with: npx vite-node scripts/probe.ts
import { createSim } from '../src/sim/world';
import { stepSim } from '../src/sim/step';
import { neutralInput } from '../src/sim/input';
import { distance, horizontal, horizontalLength, dot, rightOf, sub } from '../src/sim/math/vec';

const s = createSim();
const inp = neutralInput();
for (let t = 0; t < 60 * 12; t++) {
  const sec = t / 60;
  inp.edge = sec > 5 && sec < 8 ? 1 : sec >= 8 && sec < 10 ? -1 : 0;
  stepSim(s, inp);
  if (t % 30 === 0) {
    const r = s.rider;
    const rel = sub(horizontal(r.pos), horizontal(s.carrier.pos));
    const lat = dot(rel, rightOf(s.carrier.heading));
    console.log(
      sec.toFixed(1),
      r.mode,
      'v', horizontalLength(r.vel).toFixed(2),
      'T', r.ropeTension.toFixed(0),
      'edge', r.edgeAngle.toFixed(2),
      'load', r.edgeLoad.toFixed(0),
      'lat', lat.toFixed(2),
      'dist', distance(horizontal(r.pos), horizontal(s.carrier.pos)).toFixed(2),
      'conn', r.connection.toFixed(2),
    );
  }
}
