/**
 * TypeScript <-> Luau parity: the same scripted run through src/sim and
 * roblox/src/shared/Sim must give the same state every tick. Needs the plain
 * `luau` CLI (https://github.com/luau-lang/luau/releases): set LUAU to its
 * path, or run `npm run test:parity -- <path>`. Skipped when LUAU is unset.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { triangulate } from '../src/art/site';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { DEFAULT_PARK } from '../src/sim/park';
import { bundleSim } from './parity/luauBundle';
import { type TraceRow, traceRun } from './parity/trace';

const LUAU = process.env.LUAU;
const TRACE_LUAU = join(__dirname, '../roblox/tests/sim_trace.luau');
const DUMP_LUAU = join(__dirname, '../roblox/tests/sim_dump.luau');
/** Run to the end of both passes (about 2.5 min of game time). */
const TICKS = 12000;
const SEEDS = [1, 7, 2026];

function runLuau(tail: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sim-parity-'));
  const file = join(dir, 'bundle.luau');
  writeFileSync(file, `${bundleSim()}\n${tail}\n`);
  return execFileSync(LUAU!, [file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function luauTrace(seed: number): string[][] {
  const trace = readFileSync(TRACE_LUAU, 'utf8');
  const out = runLuau(`local traceRun = (function()\n${trace}\nend)()\ntraceRun(${seed}, ${TICKS})`);
  return out.trimEnd().split('\n').map((line) => line.split('\t'));
}

/** Plain JSON with keys sorted, as the Luau dump writes it. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined && (v as Record<string, unknown>)[k] !== null)
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** First field that differs, or null. Numbers must match to the last bit. */
function firstDivergence(ts: TraceRow[], lu: string[][]): string | null {
  const n = Math.max(ts.length, lu.length);
  for (let i = 0; i < n; i++) {
    const a = ts[i];
    const b = lu[i];
    if (!a || !b) return `row ${i}: length differs (ts ${ts.length} rows, luau ${lu.length} rows)`;
    for (let k = 0; k < Math.max(a.length, b.length); k++) {
      const x = a[k];
      const y = b[k];
      const same = typeof x === 'number' ? y !== undefined && Number(y) === x : x === y;
      if (!same && !(typeof x === 'number' && Number.isNaN(x) && y === 'nan')) {
        return `row ${i} field ${k}: ts ${String(x)} vs luau ${String(y)}\n  ts:   ${a.join(' ')}\n  luau: ${b.join(' ')}`;
      }
    }
  }
  return null;
}

describe.skipIf(!LUAU)('TypeScript and Luau site geometry agree', () => {
  it('triangulate every site polygon the same way (Roblox client vs web renderer)', () => {
    const geometry = readFileSync(join(__dirname, '../roblox/src/shared/SiteGeometry.luau'), 'utf8');
    const lu = runLuau(`local SiteGeometry = (function()\n${geometry}\nend)()
local site = Sim.Park.DEFAULT_PARK.site
local polys = { site.lake }
for _, i in site.islands do table.insert(polys, i.outline) end
for _, a in site.areas do table.insert(polys, a.outline) end
local rows = {}
for _, poly in polys do
	local tris = {}
	for _, t in SiteGeometry.triangulate(poly) do
		table.insert(tris, string.format("%d,%d,%d", t[1] - 1, t[2] - 1, t[3] - 1))
	end
	table.insert(rows, table.concat(tris, ";"))
end
print(table.concat(rows, "\\n"))`);
    const site = DEFAULT_PARK.site!;
    const polys = [site.lake, ...site.islands.map((i) => i.outline), ...site.areas.map((a) => a.outline)];
    const ts = polys.map((poly) => triangulate(poly).map((t) => t.join(',')).join(';'));
    expect(lu.trimEnd().split('\n')).toEqual(ts);
  });
});

describe.skipIf(!LUAU)('TypeScript and Luau sims agree', () => {
  it('have the same default config and park (towers, features, site)', () => {
    const lu = JSON.parse(runLuau(readFileSync(DUMP_LUAU, 'utf8')));
    expect(lu).toEqual(canonical({ config: DEFAULT_CONFIG, park: DEFAULT_PARK }));
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: identical trace every tick`, () => {
      const ts = traceRun(seed, TICKS);
      const lu = luauTrace(seed);
      expect(firstDivergence(ts, lu)).toBeNull();
      // The script must actually exercise the game: tricks, falls and a final score.
      expect(ts.some((r) => r[0] === 'trick')).toBe(true);
      expect(ts.at(-1)?.[0]).toBe('score');
    });
  }
});
