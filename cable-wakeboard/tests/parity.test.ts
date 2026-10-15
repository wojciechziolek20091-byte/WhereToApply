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
import { bundleSim } from './parity/luauBundle';
import { type TraceRow, traceRun } from './parity/trace';

const LUAU = process.env.LUAU;
const TRACE_LUAU = join(__dirname, '../roblox/tests/sim_trace.luau');
/** Run to the end of both passes (about 2.5 min of game time). */
const TICKS = 12000;
const SEEDS = [1, 7, 2026];

function luauTrace(seed: number): string[][] {
  const dir = mkdtempSync(join(tmpdir(), 'sim-parity-'));
  const file = join(dir, 'bundle.luau');
  const trace = readFileSync(TRACE_LUAU, 'utf8');
  writeFileSync(file, `${bundleSim()}\nlocal traceRun = (function()\n${trace}\nend)()\ntraceRun(${seed}, ${TICKS})\n`);
  const out = execFileSync(LUAU!, [file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return out.trimEnd().split('\n').map((line) => line.split('\t'));
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

describe.skipIf(!LUAU)('TypeScript and Luau sims agree', () => {
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
