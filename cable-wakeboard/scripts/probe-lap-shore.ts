// Print the lap test for the wake park and the beginner line (docs/LAYOUT.md, milestone 4).
import { BEGINNER_PARK, WAKE_PARK } from '../src/sim/parkLayout';
import { lapTest } from './lapTest';
for (const park of [WAKE_PARK, BEGINNER_PARK]) {
  console.log(park.name);
  for (const r of lapTest(park)) {
    console.log(`  ${r.policy.padEnd(12)} min shore ${r.minShore.toFixed(1)} m   per tower ${r.perTower.map((d) => d.toFixed(1)).join(' / ')}   rider to base ${r.perBase.map((d) => d.toFixed(1)).join(' / ')}   crashes ${r.crashes}`);
  }
}
