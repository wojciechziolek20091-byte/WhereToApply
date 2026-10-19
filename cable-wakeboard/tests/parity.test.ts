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
import { ENTRY_SCENARIOS, entryTrace } from './parity/entryTrace';
import { MORE_NAMES, SPEC_EXAMPLES } from './parity/namerCases';
import { maxReachableHeight } from '../src/sim/featureRide/slideOnConfig';

const LUAU = process.env.LUAU;
const TRACE_LUAU = join(__dirname, '../roblox/tests/sim_trace.luau');
const DUMP_LUAU = join(__dirname, '../roblox/tests/sim_dump.luau');
const ENTRY_LUAU = join(__dirname, '../roblox/tests/entry_trace.luau');

/** A JSON value as a Luau literal (arrays 1-based, numbers round-trip exactly). */
const luauLiteral = (v: unknown): string =>
  Array.isArray(v)
    ? `{ ${v.map(luauLiteral).join(', ')} }`
    : v && typeof v === 'object'
      ? `{ ${Object.entries(v).map(([k, x]) => `${k} = ${luauLiteral(x)}`).join(', ')} }`
      : typeof v === 'string'
        ? JSON.stringify(v)
        : String(v);
/** Run to the end of both passes (about 2.5 min of game time). */
const TICKS = 20000;
const SEEDS = [1, 7, 2026];

function runLuau(tail: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sim-parity-'));
  const file = join(dir, 'bundle.luau');
  writeFileSync(file, `${bundleSim()}\n${tail}\n`);
  return execFileSync(LUAU!, [file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function luauTrace(seed: number, park: 'default' | 'test' | 'catalog' = 'default'): string[][] {
  const trace = readFileSync(TRACE_LUAU, 'utf8');
  const out = runLuau(`local traceRun = (function()\n${trace}\nend)()\ntraceRun(${seed}, ${TICKS}, "${park}")`);
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

describe.skipIf(!LUAU)('Roblox server validation (ComboValidator.luau)', () => {
  it('accepts every combo a real run banks and rejects tampered ones', () => {
    const validator = readFileSync(join(__dirname, '../roblox/src/shared/ComboValidator.luau'), 'utf8');
    const out = runLuau(`local ComboValidator = (function()
local script = { Parent = { Sim = { __module = "init" } } }
${validator}
end)()
local cfg = Sim.Config.makeConfig({ run = { maxFalls = 99 } })
local run = Sim.Session.createRun(cfg, Sim.ParkLayout.TEST_PARK)
local rng = Sim.Rng.createRng(5)
local input = Sim.Input.neutralInput()
local hold, seen, ok, bad, tamperedCaught = 0, nil, 0, 0, 0
for i = 1, 60 * 140 do
	if hold <= 0 then
		hold = 10 + math.floor(Sim.Rng.nextFloat(rng) * 50)
		input = Sim.Input.neutralInput()
		input.steer = ({ -1, 0, 0, 1 })[math.floor(Sim.Rng.nextFloat(rng) * 4) + 1]
		input.pop = Sim.Rng.nextFloat(rng) < 0.4
		input.pass = Sim.Rng.nextFloat(rng) < 0.3
		input.grab = Sim.Rng.nextFloat(rng) < 0.2
	end
	hold -= 1
	Sim.Session.stepRun(run, input)
	local c = run.lastCombo
	if c and c ~= seen then
		seen = c
		if not c.voided then
			local tricks = {}
			for k = #run.tricks - c.tricks + 1, #run.tricks do
				local rec = run.tricks[k]
				table.insert(tricks, { name = rec.trick.name, points = rec.trick.points, quality = rec.trick.quality,
					comboFactor = rec.trick.comboFactor, tokens = rec.trick.tokens, airTime = rec.airTime,
					spinDegrees = rec.trick.spinDegrees, tick = rec.tick })
			end
			local score, err = ComboValidator.validate(tricks, cfg)
			if score and score.total == c.total then ok += 1 else bad += 1 print("REJECTED " .. tostring(err)) end
			tricks[1].points *= 2
			if not ComboValidator.validate(tricks, cfg) then tamperedCaught += 1 end
		end
	end
end
print(string.format("ok=%d bad=%d tampered=%d", ok, bad, tamperedCaught))`);
    const m = /ok=(\d+) bad=(\d+) tampered=(\d+)/.exec(out);
    expect(out).not.toContain('REJECTED');
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(Number(m![2])).toBe(0);
    expect(Number(m![3])).toBe(Number(m![1]));
  });
});

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

  it('test map (features on the line): identical trace, with kickers and slides ridden', () => {
    const ts = traceRun(11, TICKS, 'test');
    const lu = luauTrace(11, 'test');
    expect(firstDivergence(ts, lu)).toBeNull();
    const events = ts.map((r) => String(r[33] ?? '')).join(',');
    expect(events).toContain('featureEnter');
    expect(events).toContain('slideDone');
  });

  it('feature entries (EntryResolver): side hops, clearance, scrape-ups, jump-overs and safety pops trace the same', () => {
    const trace = readFileSync(ENTRY_LUAU, 'utf8');
    const calls = ENTRY_SCENARIOS.map((sc) => `print("#")\nentryTrace(${luauLiteral(sc)})`).join('\n');
    const out = runLuau(`local entryTrace = (function()\n${trace}\nend)()\n${calls}`);
    const blocks = out.trimEnd().split('#\n').slice(1);
    expect(blocks).toHaveLength(ENTRY_SCENARIOS.length);
    const reasons: string[] = [];
    ENTRY_SCENARIOS.forEach((sc, i) => {
      const ts = entryTrace(sc);
      const lu = blocks[i]!.trimEnd().split('\n').map((l) => l.split('\t'));
      const d = firstDivergence(ts, lu);
      expect(d, sc.name).toBeNull();
      const last = ts.at(-1)!;
      reasons.push(`${String(last[last.length - 1])}/${String(ts.find((r) => r[22] !== '-')?.[22] ?? '-')}`);
    });
    // The scenarios cover the entry outcomes they are named for.
    // Side approach v2: no ClippedSide, Overshoot or SlippedOut; a jump over is no entry and no crash.
    expect(reasons).toEqual(expect.arrayContaining(['noseDig/-', 'missedSafetyPop/-', '-/-']));
    for (const gone of ['clippedSide', 'overshoot', 'slippedOut', 'hangUp']) expect(reasons.some((x) => x.startsWith(`${gone}/`))).toBe(false);
    expect(reasons.filter((x) => x.endsWith('sideOllieOn'))).toHaveLength(6);
    expect(reasons.some((x) => x.startsWith('ranOutMidRotation/'))).toBe(true);
    expect(reasons.filter((x) => x === '-/slideOn').length).toBeGreaterThanOrEqual(3);
    expect(reasons.some((x) => x.endsWith('/edgeSlideOn'))).toBe(true);
  });

  it('SlideOnConfig.maxReachableHeight gives the same heights (charge x nose lift x edge)', () => {
    const grid: [number, number, string][] = [];
    for (const c of [0, 0.25, 0.5, 0.75, 1]) for (const l of [0, 0.31, 0.52]) for (const t of ['Rounded', 'Coping', 'Round', 'Rail']) grid.push([c, l, t]);
    const lu = runLuau(grid.map(([c, l, t]) => `print(string.format("%.17g", Sim.FeatureRideSlideOnConfig.maxReachableHeight(Sim.Config.DEFAULT_CONFIG, ${c}, ${l}, "${t}")))`).join('\n'))
      .trimEnd()
      .split('\n')
      .map(Number);
    expect(lu).toEqual(grid.map(([c, l, t]) => maxReachableHeight(DEFAULT_CONFIG, c, l, t as 'Rounded')));
    // With the edge loaded at the pop (v2 spec 1.1).
    const edged = runLuau(grid.map(([c, l, t]) => `print(string.format("%.17g", Sim.FeatureRideSlideOnConfig.maxReachableHeight(Sim.Config.DEFAULT_CONFIG, ${c}, ${l}, "${t}", nil, nil, 0.8)))`).join('\n'))
      .trimEnd()
      .split('\n')
      .map(Number);
    expect(edged).toEqual(grid.map(([c, l, t]) => maxReachableHeight(DEFAULT_CONFIG, c, l, t as 'Rounded', undefined, undefined, 0.8)));
  });

  it('FeatureTrickNamer names every line the same as the TypeScript one (spec 8 examples and more)', () => {
    const cases = [...SPEC_EXAMPLES, ...MORE_NAMES];
    const calls = cases.map(([, jibs, out]) => `print(Sim.FeatureRideFeatureTrickNamer.featureTrickName(${luauLiteral(jibs)}, ${out ? luauLiteral(out) : 'nil'}))`).join('\n');
    const lu = runLuau(calls).trimEnd().split('\n');
    expect(lu).toEqual(cases.map((c) => c[3]));
  });

  it.each([11, 23, 37])('catalogue map seed %i (all 15 wake park features): identical trace', (seed) => {
    const ts = traceRun(seed, TICKS, 'catalog');
    const lu = luauTrace(seed, 'catalog');
    expect(firstDivergence(ts, lu)).toBeNull();
    const events = ts.map((r) => String(r[33] ?? '')).join(',');
    expect(events).toContain('featureEnter');
  });
});
