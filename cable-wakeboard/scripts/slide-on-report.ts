/**
 * Prints the side approaches spec's scenario table (section 8): every
 * scripted line, what it should do and what it did.
 *   npx vite-node scripts/slide-on-report.ts
 */
import { judgeSlideOnLine, runSlideOnLine, SLIDE_ON_LINES } from '../tests/scenarios/slideOnScenarios';

console.log('| # | Line | Result | OK |');
console.log('| --- | --- | --- | --- |');
for (const l of SLIDE_ON_LINES) {
  const r = runSlideOnLine(l);
  const bad = judgeSlideOnLine(l, r);
  const did = r.crash ? `crash: ${r.crash}` : r.trick ? `${r.trick}${r.sketchy ? ' (sketchy)' : ''}, ${r.points} pts` : r.entry ? `${r.entry}${r.sketchy ? ' (sketchy)' : ''} ${r.name}` : r.tried ? 'tried, flew off' : 'no slide-on';
  const lift = r.maxPitch > 0 ? `, nose ${Math.round((r.maxPitch * 180) / Math.PI)} deg` : '';
  console.log(`| ${l.id} | ${l.what} | ${did}${lift} | ${bad ? `NO (${bad})` : 'yes'} |`);
}
