// The slide-on reachable-height table (side approaches spec 4.3, 8.1):
//   npx vite-node scripts/slide-on-table.ts
import { DEFAULT_CONFIG } from '../src/sim/config';
import { maxReachableHeight } from '../src/sim/featureRide/slideOnConfig';

const d = (x: number) => (x * Math.PI) / 180;
const f = (x: number) => `${x.toFixed(2)} m`;
console.log('Top height above the water a side entry reaches, at 8.3 m/s with a 20 degree turn-in:\n');
console.log('| Charge | Plain side ollie (0 deg) | Slide-on, auto lift 18 deg | Slide-on, W 30 deg | Thin rail | Pipe (18 deg) |');
console.log('|---|---|---|---|---|---|');
for (const c of [0, 0.25, 0.5, 0.75, 1]) {
  const row = [0, 18, 30].map((l) => f(maxReachableHeight(DEFAULT_CONFIG, c, d(l))));
  console.log(`| ${c} | ${row.join(' | ')} | ${f(maxReachableHeight(DEFAULT_CONFIG, c, d(18), 'Rail'))} | ${f(maxReachableHeight(DEFAULT_CONFIG, c, d(18), 'Round'))} |`);
}
console.log('\nFull charge, 18 degree lift, by turn-in angle:');
console.log([6, 10, 15, 20, 25, 32].map((a) => `${a} deg: ${f(maxReachableHeight(DEFAULT_CONFIG, 1, d(18), 'Rounded', 8.3, d(a)))}`).join(', '));
