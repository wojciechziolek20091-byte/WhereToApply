// Prints load, tension, peak during a toeside-out / heelside-in cut.
import { createSim } from '../src/sim/world';
import { stepSim } from '../src/sim/step';
import { neutralInput } from '../src/sim/input';
const s = createSim();
const inp = neutralInput();
for (let t = 0; t < 60 * 8; t++) {
  const c = t / 60 - 4;
  inp.edge = c > 0 && c < 1.6 ? -1 : c >= 1.6 ? 1 : 0;
  stepSim(s, inp);
  const r = s.rider;
  if (c > 1.4 && t % 6 === 0) console.log(c.toFixed(2), 'load', r.edgeLoad.toFixed(0), 'peak', r.load.peakEdgeLoad.toFixed(0), 'T', r.ropeTension.toFixed(0), 'Ty', r.ropeForce.y.toFixed(0), 'edge', r.edgeAngle.toFixed(2));
}
