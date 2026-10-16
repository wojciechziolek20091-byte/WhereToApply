/**
 * Regenerates src/art/featureParts.json from the Luau FeatureBuilder (see
 * scripts/featureArtExport.ts). Needs the `luau` CLI:
 *   LUAU=path/to/luau npx vite-node scripts/export-feature-art.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportFeatureArt } from './featureArtExport';

const json = exportFeatureArt(process.env.LUAU ?? 'luau');
writeFileSync(join(__dirname, '../src/art/featureParts.json'), json);
console.log(`wrote src/art/featureParts.json (${Object.keys(JSON.parse(json)).length} features)`);
