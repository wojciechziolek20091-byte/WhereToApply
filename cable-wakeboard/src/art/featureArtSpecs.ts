import type { CatalogFeatureDef } from '../sim/park';
import { BEGINNER_PARK, CATALOG_TEST_PARK, WAKE_PARK } from '../sim/parkLayout';
import { FEATURE_CATALOG } from '../sim/featureCatalog';

/**
 * Which feature builds the web game needs art for (scripts/export-feature-art.ts
 * builds them with the Luau FeatureBuilder), and the key each is stored under.
 * Kept apart from featureArt.ts so the export never imports its own output.
 */
export interface FeatureArtSpec {
  key: string;
  catalog: string;
  params?: CatalogFeatureDef['params'];
  side?: number;
  accent?: string;
}

export type ArtInputs = Pick<CatalogFeatureDef, 'catalog' | 'params' | 'side' | 'accent'>;

/** The art key of a catalogue feature def: same build inputs, same art. */
export const artKey = (d: ArtInputs): string => `${d.catalog}|${JSON.stringify(d.params ?? {})}|${d.side ?? 1}|${d.accent ?? 'Orange'}`;

/** Every catalogue feature the parks use, plus each catalogue default (previews, tests). */
export function featureArtSpecs(): FeatureArtSpec[] {
  const defs: ArtInputs[] = [
    ...Object.keys(FEATURE_CATALOG).map((catalog) => ({ catalog })),
    ...[CATALOG_TEST_PARK, WAKE_PARK, BEGINNER_PARK].flatMap((p) => p.features.filter((d): d is CatalogFeatureDef => d.kind === 'feature')),
  ];
  const seen = new Map<string, FeatureArtSpec>();
  for (const d of defs) {
    const key = artKey(d);
    if (!seen.has(key)) seen.set(key, { key, catalog: d.catalog, params: d.params, side: d.side, accent: d.accent });
  }
  return [...seen.values()];
}

