/**
 * Animation parity: src/anim and roblox/src/shared/Anim give the same frames
 * for the same sim run and for every test-driver scenario. Numbers agree to
 * 1e-6 (the animation uses Math.sin & co., which differ in the last bit
 * between V8 and C; the sim under it is bit-identical). Needs LUAU.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ANIM_CONFIG } from '../src/anim/config';
import { characterRig } from '../src/render/babylon/character';
import { bundleShared } from './parity/luauBundle';
import { animTrace } from './parity/animTrace';

const LUAU = process.env.LUAU;
const TRACE = join(__dirname, '../roblox/tests/anim_trace.luau');

function luaValue(v: unknown): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `{ ${v.map(luaValue).join(', ')} }`;
  return `{ ${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k} = ${luaValue(x)}`).join(', ')} }`;
}

function runLuau(tail: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'anim-parity-'));
  const file = join(dir, 'bundle.luau');
  writeFileSync(file, `${bundleShared()}\n${tail}\n`);
  return execFileSync(LUAU!, [file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function compare(ts: (string | number)[][], lu: string[][]): string | null {
  if (ts.length !== lu.length) return `row count: ts ${ts.length}, luau ${lu.length}`;
  for (let i = 0; i < ts.length; i++) {
    const a = ts[i]!;
    const b = lu[i]!;
    if (a.length !== b.length) return `row ${i} (${a[0]}): ${a.length} vs ${b.length} fields`;
    for (let k = 0; k < a.length; k++) {
      const x = a[k]!;
      const y = b[k]!;
      if (typeof x === 'number') {
        const yn = Number(y);
        if (!(Math.abs(x - yn) <= 1e-6 * Math.max(1, Math.abs(x)))) return `row ${i} (${a[0]}) field ${k}: ts ${x}, luau ${y}`;
      } else if (String(x) !== y) return `row ${i} (${a[0]}) field ${k}: ts ${x}, luau ${y}`;
    }
  }
  return null;
}

describe.skipIf(!LUAU)('TypeScript and Luau animation agree', () => {
  const rig = characterRig();
  const rigLua = luaValue(rig);
  const trace = readFileSync(TRACE, 'utf8');

  it('the generated AnimConfig matches the TypeScript defaults', () => {
    const out = runLuau(`
local function dump(v)
  if type(v) ~= "table" then return if type(v) == "string" then string.format("%q", v) else tostring(v) end
  local keys = {}
  for k in v do table.insert(keys, k) end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  local parts = {}
  for _, k in keys do table.insert(parts, tostring(k) .. "=" .. dump(v[k])) end
  return "{" .. table.concat(parts, ",") .. "}"
end
print(dump(Anim.AnimConfig.DEFAULT))`);
    const dump = (v: unknown): string => {
      if (typeof v !== 'object' || v === null) return typeof v === 'string' ? JSON.stringify(v) : String(v);
      const keys = Object.keys(v).map((k) => (Array.isArray(v) ? String(Number(k) + 1) : k)).sort();
      return `{${keys.map((k) => `${k}=${dump((v as Record<string, unknown>)[Array.isArray(v) ? String(Number(k) - 1) : k])}`).join(',')}}`;
    };
    expect(out.trim()).toBe(dump(DEFAULT_ANIM_CONFIG));
  });

  it.each([
    [3, 'default'],
    [11, 'test'],
  ] as const)('seed %i on the %s park, then every scenario: same frames', { timeout: 120000 }, (seed, park) => {
    const ticks = 2400;
    const ts = animTrace(rig, seed, ticks, park);
    const out = runLuau(`local animTrace = (function()\n${trace}\nend)()\nanimTrace(${rigLua}, ${seed}, ${ticks}, "${park}")`);
    const lu = out.trimEnd().split('\n').map((l) => l.split('\t'));
    expect(compare(ts, lu)).toBeNull();
    // The run exercised the interesting states.
    const tags = ts.map((r) => String(r[0])).join(' ');
    expect(tags).toMatch(/Airborne|WaterTrickAir/);
    expect(tags).toMatch(/Crashed/);
  });
});
