/**
 * Wake park features, Roblox side, without Studio (features spec milestone
 * 1): the Luau FeatureShapes gives the same pieces and surfaces as the
 * TypeScript sim, bit for bit, and FeatureModel builds the spec's model
 * structure under the Roblox mock. Needs LUAU.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEATURE_CATALOG } from '../src/sim/featureCatalog';
import { buildShape, shapeSurfaceAt } from '../src/sim/featureShapes';
import { bundleShared, bundleSim } from './parity/luauBundle';

const LUAU = process.env.LUAU;
const ROBLOX = join(__dirname, '../roblox');
const fmt = (v: unknown) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : String(v));

function runLuau(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'feat-'));
  const file = join(dir, 'f.luau');
  writeFileSync(file, src);
  return execFileSync(LUAU!, [file], { encoding: 'utf8', maxBuffer: 1 << 28 });
}

function tsDump(): string[][] {
  const rows: unknown[][] = [];
  for (const name of Object.keys(FEATURE_CATALOG).sort()) {
    for (const side of [1, -1]) {
      const shape = buildShape(name, {}, side);
      rows.push([name, side, shape.type, shape.uMin, shape.uMax, shape.vMin, shape.vMax, shape.safetyMode, shape.friction]);
      for (const p of shape.pieces) {
        rows.push(['piece', p.index, p.role, p.part, p.axis, p.u0, p.u1, p.h0, p.h1, p.power, p.v0, p.v1, p.width, p.profile, p.radius, p.slide, p.lip, p.closed]);
      }
      for (let i = 0; i <= 40; i++) {
        for (let j = 0; j <= 12; j++) {
          const u = shape.uMin + ((shape.uMax - shape.uMin) * i) / 40;
          const v = shape.vMin + ((shape.vMax - shape.vMin) * j) / 12;
          const s = shapeSurfaceAt(shape, u, v);
          if (s) rows.push(['s', i, j, s.piece.index, s.height, s.slope, s.crossSlope, s.normal.x, s.normal.y, s.normal.z, s.tangent.x, s.tangent.y, s.tangent.z]);
        }
      }
    }
  }
  return rows.map((r) => r.map(fmt));
}

describe.skipIf(!LUAU)('wake park features in Luau', () => {
  it('FeatureShapes.luau matches featureShapes.ts exactly', { timeout: 60000 }, () => {
    const out = runLuau(`${bundleSim()}\n${readFileSync(join(ROBLOX, 'tests/feature_shapes_dump.luau'), 'utf8')}`);
    const lu = out.trim().split('\n').map((l) => l.split('\t').map((x) => (/^-?[\d.]+(e[-+]?\d+)?$|^-?inf$|^nan$/i.test(x) ? String(Number(x)) : x)));
    const ts = tsDump();
    expect(lu.length).toBe(ts.length);
    for (let i = 0; i < ts.length; i++) expect(lu[i]).toEqual(ts[i]);
  });

  it('FeatureModel builds the spec structure, tags, attributes and collision groups', { timeout: 60000 }, () => {
    const mock = readFileSync(join(ROBLOX, 'tests/mock_roblox.luau'), 'utf8');
    const spec = readFileSync(join(ROBLOX, 'tests/feature_model_spec.luau'), 'utf8');
    const out = runLuau([mock, bundleShared([], ['Sim', 'Park']), spec].join('\n'));
    expect(out).toContain('FEATURE MODEL OK');
  });
});
