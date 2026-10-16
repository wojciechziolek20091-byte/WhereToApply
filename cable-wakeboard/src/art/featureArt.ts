import type { CatalogFeatureDef, ResolvedFeature } from '../sim/park';
import { buildMesh, type MeshData, type PartRow } from './mesh';
import featureParts from './featureParts.json';
import { artKey, type ArtInputs } from './featureArtSpecs';

export { artKey, featureArtSpecs, type FeatureArtSpec } from './featureArtSpecs';

/**
 * Feature art exported from roblox/src/shared/Park/FeatureBuilder.luau (see
 * scripts/export-feature-art.ts), so the web game shows the Roblox models.
 * Each entry is keyed by the feature's catalogue name and parameters; rows
 * are Root-relative studs: X right of the feature, Y up, -Z along it.
 */
export const STUDS_PER_METRE = 3.57;

const PARTS = featureParts as unknown as Record<string, { count: number; parts: PartRow[] }>;

/** Exported art rows for a def, or null if the export is stale. */
export const featureArtRows = (d: CatalogFeatureDef): readonly PartRow[] | null => PARTS[artKey(d)]?.parts ?? null;

/** Part count of the built Roblox model (Visual, Ride, Crash, ...). */
export const featurePartCount = (d: ArtInputs): number | null =>
  PARTS[artKey(d)]?.count ?? null;

/**
 * World-space mesh (metres) of a placed catalogue feature: Root-relative
 * studs to the feature's frame (origin, heading).
 */
export function featureMesh(f: ResolvedFeature): MeshData | null {
  if (f.def.kind !== 'feature') return null;
  const rows = featureArtRows(f.def);
  if (!rows) return null;
  const k = 1 / STUDS_PER_METRE;
  const fx = Math.cos(f.heading), fz = Math.sin(f.heading);
  const rx = -Math.sin(f.heading), rz = Math.cos(f.heading);
  // Root-local (X, Y, Z) -> world: X along right, Y up, -Z along forward.
  const dir = (x: number, y: number, z: number): [number, number, number] => [rx * x - fx * z, y, rz * x - fz * z];
  const placed = rows.map((p) => {
    const pos = dir(p[4]! * k, p[5]! * k, p[6]! * k);
    return [
      p[0]!, p[1]! * k, p[2]! * k, p[3]! * k,
      f.origin.x + pos[0], pos[1], f.origin.z + pos[2],
      ...dir(p[7]!, p[8]!, p[9]!), ...dir(p[10]!, p[11]!, p[12]!), ...dir(p[13]!, p[14]!, p[15]!),
      p[16]!, p[17]!, p[18]!,
    ];
  });
  return buildMesh(placed);
}
