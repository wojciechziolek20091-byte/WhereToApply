import { buildMesh, meshBounds, Shape, triangleCount, type PartRow } from '../src/art/mesh';
import { RIDER_PALETTES, riderMesh, riderPartRows, STUD } from '../src/art/riders';

const identity = (shape: Shape, size: [number, number, number], color = [1, 0, 0]): PartRow => [
  shape, ...size, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, ...color,
];

describe('primitive meshes', () => {
  it.each([
    [Shape.Block, 12],
    [Shape.Wedge, 8],
    [Shape.CornerWedge, 6],
    [Shape.Ball, 20],
    [Shape.Cylinder, 8 * 2 + 2 * 6],
  ])('shape %i has %i triangles', (shape, count) => {
    expect(triangleCount(shape)).toBe(count);
  });

  it('normals point outward for every primitive', () => {
    for (const shape of [Shape.Block, Shape.Wedge, Shape.CornerWedge, Shape.Ball, Shape.Cylinder]) {
      const m = buildMesh([identity(shape, [2, 1, 3])]);
      // Centroid of all vertices is inside a convex hull.
      const c = [0, 0, 0];
      const n = m.positions.length / 3;
      for (let i = 0; i < m.positions.length; i++) c[i % 3]! += m.positions[i]! / n;
      for (let t = 0; t < m.indices.length / 3; t++) {
        const o = t * 9;
        const centre = [0, 1, 2].map((k) => (m.positions[o + k]! + m.positions[o + 3 + k]! + m.positions[o + 6 + k]!) / 3);
        const out = centre.map((v, k) => v - c[k]!);
        const d = out[0]! * m.normals[o]! + out[1]! * m.normals[o + 1]! + out[2]! * m.normals[o + 2]!;
        expect(d).toBeGreaterThan(0);
      }
    }
  });

  it('a wedge slopes down toward -Z', () => {
    const m = buildMesh([identity(Shape.Wedge, [1, 1, 1])]);
    const { max } = meshBounds(m);
    let topZ = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) if (m.positions[i + 1]! > 0.49) topZ = Math.max(topZ, m.positions[i + 2]!);
    expect(max[1]).toBeCloseTo(0.5, 9);
    // Only the back (+Z) edge reaches the top.
    for (let i = 0; i < m.positions.length; i += 3) if (m.positions[i + 1]! > 0.49) expect(m.positions[i + 2]).toBeCloseTo(0.5, 9);
    expect(topZ).toBeCloseTo(0.5, 9);
  });

  it('applies position, rotation and scale', () => {
    // Rotated 90 degrees about Y: right = (0,0,-1), back = (1,0,0).
    const row: PartRow = [Shape.Block, 2, 1, 1, 10, 0, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0, 0, 1, 0];
    const { min, max } = meshBounds(buildMesh([row]));
    expect(max[0] - min[0]).toBeCloseTo(1, 6);
    expect(max[2] - min[2]).toBeCloseTo(2, 6);
    expect((max[0] + min[0]) / 2).toBeCloseTo(10, 6);
  });
});

describe('exported rider art', () => {
  it.each(RIDER_PALETTES)('palette %s builds a rider of sensible size', (palette) => {
    expect(riderPartRows(palette).length).toBeGreaterThan(100);
    const m = riderMesh(palette);
    const { min, max } = meshBounds(m);
    const heightM = (max[1] - min[1]) * STUD;
    expect(heightM).toBeGreaterThan(1.5);
    expect(heightM).toBeLessThan(2.1);
    // The tail half of the board (the rope stub only extends toward +X).
    const halfBoardM = -min[0] * STUD;
    expect(halfBoardM).toBeGreaterThan(0.6);
    expect(halfBoardM).toBeLessThan(0.8);
    for (const c of m.colors) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});
