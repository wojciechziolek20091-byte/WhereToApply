/**
 * SideApproachSweep report (side approach v2 spec 6.1): the grid on every
 * reference feature, outcomes A-F per feature and per angle band, the crash
 * reasons, and the slide-on availability blocks at the pop.
 *   npx vite-node scripts/side-approach-sweep.ts [--both] [--fails] [--json out.json]
 */
import { writeFileSync } from 'node:fs';
import { runSideApproach, runSweep, SWEEP_FEATURES, type SweepResult, type SweepRow } from '../tests/scenarios/sideApproachSweep';

const args = process.argv.slice(2);
const t0 = Date.now();
const rows = runSweep(undefined, args.includes('--both'));
const pct = (n: number, d: number): string => (d ? `${Math.round((100 * n) / d)}%` : '-');
const count = (rs: SweepRow[], f: (r: SweepRow) => boolean): number => rs.filter(f).length;
const ok = (r: SweepRow): boolean => r.result.outcome === 'A' || r.result.outcome === 'B';
const noCrash = (r: SweepRow): boolean => r.result.outcome !== 'F' && r.result.outcome !== 'N';

console.log(`${rows.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
const features = [...new Set(rows.map((r) => r.feature))];
const outcomes = ['A', 'B', 'C', 'D', 'E', 'F', 'N'] as const;
console.log(`| Feature | ${outcomes.join(' | ')} | A+B | no crash (A-E) |`);
console.log(`| --- |${outcomes.map(() => ' --- |').join('')} --- | --- |`);
for (const f of [...features, 'all']) {
  const rs = f === 'all' ? rows : rows.filter((r) => r.feature === f);
  console.log(`| ${f} | ${outcomes.map((o) => count(rs, (r) => r.result.outcome === o)).join(' | ')} | ${pct(count(rs, ok), rs.length)} | ${pct(count(rs, noCrash), rs.length)} |`);
}

console.log('\nA+B by angle band (all features):\n');
const bands: [string, (a: number) => boolean][] = [['0-5', (a) => a <= 5], ['10-45', (a) => a >= 10 && a <= 45], ['60-75', (a) => a >= 60]];
console.log(`| Feature | ${bands.map((b) => b[0]).join(' | ')} |`);
console.log(`| --- |${bands.map(() => ' --- |').join('')}`);
for (const f of [...features, 'all']) {
  const rs = f === 'all' ? rows : rows.filter((r) => r.feature === f);
  console.log(`| ${f} | ${bands.map(([, b]) => { const x = rs.filter((r) => b(r.angle)); return pct(count(x, ok), x.length); }).join(' | ')} |`);
}

// The section 5 "roughly right" band: 10-45 degrees, 0.3-2.5 m, charge >= 0.5, timing 0.
const right = (r: SweepRow): boolean => r.angle >= 10 && r.angle <= 45 && r.lateral <= 2.5 && r.charge >= 0.5 && r.timing === 0;
console.log('\nRoughly-right inputs (10-45 deg, 0.3-2.5 m, charge >= 0.5, on time), A+B (W held for the ledge):\n');
for (const f of features) {
  const rs = rows.filter((r) => r.feature === f && right(r) && (f.startsWith('ledge') ? r.w : true));
  console.log(`- ${f}: ${pct(count(rs, ok), rs.length)} of ${rs.length}`);
}

// Section 5 targets.
console.log('\nSection 5 targets:\n');
const low65 = (f: string): boolean => !f.startsWith('ledge');
const band = rows.filter((r) => right(r));
const rate = (rs: SweepRow[]): number => (rs.length ? count(rs, ok) / rs.length : 0);
const tally = (rs: SweepRow[], key: (r: SweepRow) => string): [string, number][] => {
  const m = new Map<string, number>();
  for (const r of rs) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const check = (what: string, value: number, target: number, more = true): void =>
  console.log(`- ${what}: ${Math.round(value * 100)}% (target ${more ? '>=' : '<='} ${Math.round(target * 100)}%) ${(more ? value >= target : value <= target) ? 'PASS' : 'FAIL'}`);
check('roughly right, features <= 0.65 m, A+B', rate(band.filter((r) => low65(r.feature))), 0.9);
check('roughly right, ledge 0.80 with W, A+B', rate(band.filter((r) => r.feature.startsWith('ledge') && r.w)), 0.8);
const steep = rows.filter((r) => r.angle >= 45);
console.log(`- steep (45-75 deg): F ${count(steep, (r) => r.result.outcome === 'F')} of ${steep.length}; B/C/D ${pct(count(steep, (r) => 'BCD'.includes(r.result.outcome)), steep.length)}`);
const lowEffort = rows.filter((r) => r.feature.startsWith('table') && r.charge === 0.25 && r.angle >= 10 && r.angle <= 45 && r.lateral <= 2.5 && r.timing === 0);
check('low effort (charge 0.25, table), A', lowEffort.length ? count(lowEffort, (r) => r.result.outcome === 'A') / lowEffort.length : 0, 0.85);
const lateBand = rows.filter((r) => r.angle >= 10 && r.angle <= 45 && r.lateral <= 2.5 && r.charge >= 0.5 && r.timing === 0.15 && (r.feature.startsWith('ledge') ? r.w : true));
const onTime = rows.filter((r) => right(r) && (r.feature.startsWith('ledge') ? r.w : true));
check('sloppy timing (+0.15 s), drop in A+B', rate(onTime) - rate(lateBand), 0.1, false);
// Clearly bad (outside the grid): charge 0.1 on the 0.80 m ledge, no nose lift; crashes should dominate here.
const ledge = SWEEP_FEATURES.find((f) => f.name.startsWith('ledge'))!;
const bad: SweepResult[] = [];
for (const angle of [10, 20, 30, 45]) for (const lateral of [0.3, 1, 2]) for (const edge of [0, 0.5, 1]) bad.push(runSideApproach(ledge.def, { angle, lateral, charge: 0.1, edge, w: false, timing: 0, side: -1 }));
const badF = bad.filter((r) => r.outcome === 'F').length / bad.length;
console.log(`- clearly bad (charge 0.1, ledge 0.80, no W, 10-45 deg): F ${Math.round(badF * 100)}% (target: mostly F) ${badF > 0.5 ? 'PASS' : 'FAIL'}; ${tally(bad.map((r) => ({ result: r }) as SweepRow), (r) => r.result.outcome).map(([k, n]) => `${k} ${n}`).join(', ')}`);

console.log('\nCrash reasons (F):\n');
for (const [k, n] of tally(rows.filter((r) => r.result.outcome === 'F'), (r) => r.result.note)) console.log(`- ${k}: ${n}`);
console.log('\nNo contact (N):\n');
for (const [k, n] of tally(rows.filter((r) => r.result.outcome === 'N'), (r) => r.result.note)) console.log(`- ${k}: ${n}`);
console.log('\nSlide-on availability block at the pop:\n');
for (const [k, n] of tally(rows, (r) => r.result.block || 'available')) console.log(`- ${k}: ${n} (${pct(n, rows.length)})`);
console.log('\nOutcome by availability block:\n');
for (const [k, n] of tally(rows, (r) => `${r.result.block || 'available'} -> ${r.result.outcome}`).slice(0, 25)) console.log(`- ${k}: ${n}`);

if (args.includes('--fails')) {
  console.log('\n| Feature | angle | lateral | charge | edge | W | late | reason |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows.filter((x) => x.result.outcome === 'F'))
    console.log(`| ${r.feature} | ${r.angle} | ${r.lateral} | ${r.charge} | ${r.edge} | ${r.w ? 'W' : '-'} | ${r.timing} | ${r.result.note} |`);
}
const j = args.indexOf('--json');
if (j >= 0) writeFileSync(args[j + 1]!, JSON.stringify(rows.map(({ result, ...inp }) => ({ ...inp, outcome: result.outcome, note: result.note, block: result.block }))));
