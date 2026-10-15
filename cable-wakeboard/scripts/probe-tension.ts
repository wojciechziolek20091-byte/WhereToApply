/**
 * Milestone 2 check: cruising tension, and how fast a hard edge away from the
 * line builds tension past the 1000 N water-trick threshold. Prints a 10 s log.
 *   npx vite-node scripts/probe-tension.ts
 */
import { DEFAULT_CONFIG } from '../src/sim/config';
import { edgeNorm } from '../src/sim/edge';
import { neutralInput } from '../src/sim/input';
import { horizontalLength } from '../src/sim/math/vec';
import { FLAT_PARK } from '../src/sim/park';
import { stepSim } from '../src/sim/step';
import { isSideways } from '../src/sim/waterTrick';
import { createSim } from '../src/sim/world';

const s = createSim(DEFAULT_CONFIG, FLAT_PARK, 125);
const log: string[] = [];
let crossed = -1;
let cutStart = 4;
for (let i = 0; i < 600; i++) {
  const t = i / 60;
  // 0-4 s cruise; 4-7 s hard heelside cut away from the line (A for a regular rider); 7-10 s flat.
  const steer = t >= cutStart && t < 7 ? -1 : 0;
  stepSim(s, { ...neutralInput(), steer });
  const r = s.rider;
  if (steer !== 0 && crossed < 0 && r.tensionSmooth > 1000) crossed = t - cutStart;
  if (i % 30 === 0) {
    log.push(
      `${t.toFixed(1).padStart(4)} s  raw ${r.ropeTension.toFixed(0).padStart(5)} N  smooth ${r.tensionSmooth.toFixed(0).padStart(5)} N  edge ${edgeNorm(r, DEFAULT_CONFIG.edge).toFixed(2)}  ${(horizontalLength(r.vel) * 3.6).toFixed(0)} km/h  ${isSideways(r, DEFAULT_CONFIG) ? 'sideways' : '        '}  ${r.mode}`,
    );
  }
}
console.log(log.join('\n'));
console.log(`smoothed tension crossed 1000 N ${crossed >= 0 ? `${crossed.toFixed(2)} s` : 'never'} after the cut started`);
