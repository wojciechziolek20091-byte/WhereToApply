/**
 * Smooth wakeboard geometry: a rounded-rectangle outline with rocker. Pure
 * TypeScript (positions, indices, colours); the renderer computes normals.
 * Deck, rails and base are separate vertex sets so each shades smoothly
 * on its own while the edge between them stays crisp.
 * Board space: +X nose, +Y up, +Z toe side, base touching y = 0 at the middle.
 */
export interface BoardShape {
  /** Tip to tip (m). */
  length: number;
  /** Rail to rail (m). */
  width: number;
  /** Deck thickness (m). */
  thickness: number;
  /** Radius of the rounded tip corners (m). */
  cornerRadius: number;
  /** Rise of each tip above the middle (m). */
  rocker: number;
  /** Rocker curve exponent: higher keeps the middle flatter. */
  rockerPower: number;
}

export const WAKEBOARD: BoardShape = {
  length: 1.38,
  width: 0.42,
  thickness: 0.03,
  cornerRadius: 0.16,
  rocker: 0.055,
  rockerPower: 2.4,
};

export interface BoardColors {
  deck: readonly [number, number, number];
  rail: readonly [number, number, number];
  base: readonly [number, number, number];
}

export interface BoardGeometry {
  positions: number[];
  indices: number[];
  colors: number[];
  /** Height of the deck top at the middle of the board. */
  deckTop: number;
}

/** Height of the base above the middle at position x along the board. */
export const rockerAt = (s: BoardShape, x: number): number => s.rocker * Math.min(1, Math.abs(x) / (s.length / 2)) ** s.rockerPower;

/** Outline in x-z, counter-clockwise seen from above, starting at the nose. */
export function boardOutline(s: BoardShape, perCorner = 7): [number, number][] {
  const hx = s.length / 2 - s.cornerRadius;
  const hz = s.width / 2 - s.cornerRadius;
  const centres: [number, number, number][] = [
    [hx, -hz, -Math.PI / 2], // nose, -Z side
    [hx, hz, 0], // nose, +Z side
    [-hx, hz, Math.PI / 2], // tail, +Z side
    [-hx, -hz, Math.PI], // tail, -Z side
  ];
  const pts: [number, number][] = [];
  for (const [cx, cz, a0] of centres) {
    for (let i = 0; i <= perCorner; i++) {
      const a = a0 + (i / perCorner) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * s.cornerRadius, cz + Math.sin(a) * s.cornerRadius]);
    }
  }
  return pts;
}

export function buildBoardGeometry(s: BoardShape, c: BoardColors): BoardGeometry {
  const outline = boardOutline(s);
  const n = outline.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const push = (x: number, y: number, z: number, col: readonly [number, number, number]) => {
    positions.push(x, y, z);
    colors.push(col[0], col[1], col[2], 1);
    return positions.length / 3 - 1;
  };
  // Deck (top) and base (bottom) as fans around a centre vertex.
  const fan = (top: boolean, col: readonly [number, number, number]) => {
    const yOff = top ? s.thickness : 0;
    const centre = push(0, yOff, 0, col);
    const first = positions.length / 3;
    for (const [x, z] of outline) push(x, rockerAt(s, x) + yOff, z, col);
    for (let i = 0; i < n; i++) {
      const a = first + i;
      const b = first + ((i + 1) % n);
      // Right-handed, +Y up: counter-clockwise from above faces up.
      if (top) indices.push(centre, b, a);
      else indices.push(centre, a, b);
    }
  };
  fan(true, c.deck);
  fan(false, c.base);
  // Rails: a strip of quads around the outline.
  const first = positions.length / 3;
  for (const [x, z] of outline) {
    const y = rockerAt(s, x);
    push(x, y, z, c.rail);
    push(x, y + s.thickness, z, c.rail);
  }
  for (let i = 0; i < n; i++) {
    const a = first + 2 * i;
    const b = first + 2 * ((i + 1) % n);
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return { positions, indices, colors, deckTop: s.thickness };
}
