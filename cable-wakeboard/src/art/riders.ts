import { buildMesh, type MeshData, type PartRow } from './mesh';
import riderParts from './riderParts.json';

/**
 * Rider art exported from roblox/src/shared/RiderBuilder.luau (see
 * scripts/export-rider-art.sh). Units are Roblox studs in rider space:
 * +X travel (board nose), +Y up, +Z toe side, board bottom at Y = 0.
 */
export type RiderPalette = 'A' | 'B' | 'Sheet';
export const RIDER_PALETTES: RiderPalette[] = ['A', 'B', 'Sheet'];

/** Metres per stud: the 4.6-stud board becomes about 1.4 m. */
export const STUD = 0.3;

const PARTS = riderParts as unknown as Record<RiderPalette, PartRow[]>;

export const riderPartRows = (palette: RiderPalette): readonly PartRow[] => PARTS[palette];

/** Flat-shaded mesh of the whole rider, in studs. Scale by STUD to place it in the sim. */
export const riderMesh = (palette: RiderPalette): MeshData => buildMesh(PARTS[palette]);
