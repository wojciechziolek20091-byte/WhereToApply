/**
 * Builds the art for src/art/featureParts.json from the Luau FeatureBuilder (the
 * single source of feature art, shared with Roblox): every catalogue feature
 * placed in a park is built under the Roblox mock and its visible parts
 * (Visual/ and Signage/) are written Root-relative, in studs, as mesh rows
 * (src/art/mesh.ts). Needs the `luau` CLI:
 *   LUAU=path/to/luau npx vite-node scripts/export-feature-art.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { featureArtSpecs } from '../src/art/featureArtSpecs';
import { bundleShared } from '../tests/parity/luauBundle';
import { lua } from './luaLiteral';

export function exportFeatureArt(luau: string): string {
  const root = join(__dirname, '..');
  const mock = readFileSync(join(root, 'roblox/tests/mock_roblox.luau'), 'utf8');
  const exporter = readFileSync(join(root, 'roblox/tests/export_features.luau'), 'utf8');
  const specs = featureArtSpecs();
  const src = [mock, bundleShared([], ['Sim', 'Park']), `local SPECS = ${lua(specs, '')}`, exporter].join('\n');
  const dir = mkdtempSync(join(tmpdir(), 'feature-art-'));
  const file = join(dir, 'export.luau');
  writeFileSync(file, src);
  return execFileSync(luau, [file], { encoding: 'utf8', maxBuffer: 1 << 28 });
}

