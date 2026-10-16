/**
 * Turns Roblox-style primitive parts (Block, Wedge, CornerWedge, Ball,
 * Cylinder) into one flat-shaded triangle mesh with per-vertex colours.
 * Pure TypeScript: no engine imports, so it is testable and any renderer
 * (Babylon, three.js) can upload the arrays as-is.
 *
 * Conventions match Roblox and the sim: right-handed, +Y up. A part's frame
 * is its position plus its right/up/back axis columns (Roblox CFrame).
 * Wedge: full bottom and back (+Z) faces, slope down toward -Z.
 */

export const enum Shape {
  Block = 0,
  Wedge = 1,
  CornerWedge = 2,
  Ball = 3,
  Cylinder = 4,
}

/** [shape, sx,sy,sz, px,py,pz, rx,ry,rz, ux,uy,uz, bx,by,bz, r,g,b] */
export type PartRow = readonly number[];

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  /** RGBA per vertex. */
  colors: Float32Array;
  indices: Uint32Array;
}

type V3 = [number, number, number];
interface Hull {
  verts: V3[];
  /** Faces as vertex index lists, any winding; oriented outward on build. */
  faces: number[][];
}

const h = 0.5;
const BOX: Hull = {
  verts: [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ],
  faces: [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]],
};
const WEDGE: Hull = {
  verts: [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h], [-h, h, h], [h, h, h]],
  faces: [[0, 1, 2, 3], [3, 2, 5, 4], [0, 1, 5, 4], [0, 3, 4], [1, 2, 5]],
};
// Peak above the (+X, -Z) corner. Roblox's exact corner may differ; it only
// matters if a builder uses CornerWedge, which the current riders do not.
const CORNER_WEDGE: Hull = {
  verts: [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h], [h, h, -h]],
  faces: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
};

/** Icosahedron of radius 0.5: a chunky, faceted ball. */
function icosahedron(): Hull {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: V3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const s = 0.5 / Math.hypot(1, t);
  return {
    verts: raw.map(([x, y, z]) => [x * s, y * s, z * s]),
    faces: [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ],
  };
}

/** Cylinder along X, radius 0.5, length 1, with `sides` flat sides. */
function cylinder(sides: number): Hull {
  const verts: V3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    verts.push([-h, Math.cos(a) * h, Math.sin(a) * h], [h, Math.cos(a) * h, Math.sin(a) * h]);
  }
  const faces: number[][] = [];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    faces.push([2 * i, 2 * i + 1, 2 * j + 1, 2 * j]);
  }
  faces.push(Array.from({ length: sides }, (_, i) => 2 * i));
  faces.push(Array.from({ length: sides }, (_, i) => 2 * i + 1));
  return { verts, faces };
}

const HULLS: Record<Shape, Hull> = {
  [Shape.Block]: BOX,
  [Shape.Wedge]: WEDGE,
  [Shape.CornerWedge]: CORNER_WEDGE,
  [Shape.Ball]: icosahedron(),
  [Shape.Cylinder]: cylinder(8),
};

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Triangles of a hull, each wound counter-clockwise seen from outside. */
function orientedTriangles(hull: Hull): [number, number, number][] {
  const c: V3 = [0, 0, 0];
  for (const v of hull.verts) for (let k = 0; k < 3; k++) c[k]! += v[k]! / hull.verts.length;
  const tris: [number, number, number][] = [];
  for (const face of hull.faces) {
    for (let i = 1; i + 1 < face.length; i++) {
      const a = face[0]!, b = face[i]!, d = face[i + 1]!;
      const va = hull.verts[a]!, vb = hull.verts[b]!, vd = hull.verts[d]!;
      const n = cross(sub(vb, va), sub(vd, va));
      tris.push(dot(n, sub(va, c)) >= 0 ? [a, b, d] : [a, d, b]);
    }
  }
  return tris;
}
const TRIS: Record<Shape, [number, number, number][]> = {
  [Shape.Block]: orientedTriangles(BOX),
  [Shape.Wedge]: orientedTriangles(WEDGE),
  [Shape.CornerWedge]: orientedTriangles(CORNER_WEDGE),
  [Shape.Ball]: orientedTriangles(HULLS[Shape.Ball]),
  [Shape.Cylinder]: orientedTriangles(HULLS[Shape.Cylinder]),
};

export const triangleCount = (shape: Shape): number => TRIS[shape].length;

/** Scale applied to the unit hull, following Roblox's rules for balls and cylinders. */
function partScale(shape: Shape, sx: number, sy: number, sz: number): V3 {
  if (shape === Shape.Ball) {
    const d = Math.min(sx, sy, sz);
    return [d, d, d];
  }
  if (shape === Shape.Cylinder) {
    const d = Math.min(sy, sz);
    return [sx, d, d];
  }
  return [sx, sy, sz];
}

/** Merge parts into one flat-shaded mesh (three unshared vertices per triangle). */
export function buildMesh(parts: readonly PartRow[]): MeshData {
  let triTotal = 0;
  for (const p of parts) triTotal += TRIS[p[0] as Shape].length;
  const positions = new Float32Array(triTotal * 9);
  const normals = new Float32Array(triTotal * 9);
  const colors = new Float32Array(triTotal * 12);
  const indices = new Uint32Array(triTotal * 3);
  let t = 0;
  for (const p of parts) {
    const shape = p[0] as Shape;
    const [sx, sy, sz] = partScale(shape, p[1]!, p[2]!, p[3]!);
    const pos: V3 = [p[4]!, p[5]!, p[6]!];
    const r: V3 = [p[7]!, p[8]!, p[9]!];
    const u: V3 = [p[10]!, p[11]!, p[12]!];
    const b: V3 = [p[13]!, p[14]!, p[15]!];
    const world = (v: V3): V3 => {
      const x = v[0] * sx, y = v[1] * sy, z = v[2] * sz;
      return [
        pos[0] + r[0] * x + u[0] * y + b[0] * z,
        pos[1] + r[1] * x + u[1] * y + b[1] * z,
        pos[2] + r[2] * x + u[2] * y + b[2] * z,
      ];
    };
    const hull = HULLS[shape];
    const wv = hull.verts.map(world);
    for (const [ia, ib, ic] of TRIS[shape]) {
      const a = wv[ia]!, bb = wv[ib]!, c = wv[ic]!;
      const n = cross(sub(bb, a), sub(c, a));
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      let k = 0;
      for (const v of [a, bb, c]) {
        const o = t * 9 + k * 3;
        positions.set(v, o);
        normals.set([n[0] / len, n[1] / len, n[2] / len], o);
        colors.set([p[16]!, p[17]!, p[18]!, 1], t * 12 + k * 4);
        indices[t * 3 + k] = t * 3 + k;
        k++;
      }
      t++;
    }
  }
  return { positions, normals, colors, indices };
}

/** Axis-aligned bounds of a mesh, for tests and camera framing. */
export function meshBounds(m: MeshData): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, m.positions[i + k]!);
      max[k] = Math.max(max[k]!, m.positions[i + k]!);
    }
  }
  return { min, max };
}

/** A convex solid given by vertices and faces, with one colour. */
export interface HullPart {
  verts: V3[];
  faces: number[][];
  color: readonly [number, number, number];
}

/** Merge convex hulls (already in world space) into one flat-shaded mesh. */
export function buildHullMesh(hulls: readonly HullPart[]): MeshData {
  const tris = hulls.map((h) => orientedTriangles({ verts: h.verts, faces: h.faces }));
  const triTotal = tris.reduce((a, t) => a + t.length, 0);
  const positions = new Float32Array(triTotal * 9);
  const normals = new Float32Array(triTotal * 9);
  const colors = new Float32Array(triTotal * 12);
  const indices = new Uint32Array(triTotal * 3);
  let t = 0;
  hulls.forEach((hull, i) => {
    for (const [ia, ib, ic] of tris[i]!) {
      const a = hull.verts[ia]!, b = hull.verts[ib]!, c = hull.verts[ic]!;
      const n = cross(sub(b, a), sub(c, a));
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      [a, b, c].forEach((v, k) => {
        positions.set(v, t * 9 + k * 3);
        normals.set([n[0] / len, n[1] / len, n[2] / len], t * 9 + k * 3);
        colors.set([hull.color[0], hull.color[1], hull.color[2], 1], t * 12 + k * 4);
        indices[t * 3 + k] = t * 3 + k;
      });
      t++;
    }
  });
  return { positions, normals, colors, indices };
}

/**
 * Extrude a side profile (points along x with heights y, from x0 to x1) into
 * convex slices of width `width` centred on z = 0. Each slice is its own
 * hull, so a curved ramp becomes a run of flat facets.
 */
export function extrudeProfile(
  profile: readonly (readonly [number, number])[],
  width: number,
  color: (slice: number) => readonly [number, number, number],
): HullPart[] {
  const w = width / 2;
  const out: HullPart[] = [];
  for (let i = 0; i + 1 < profile.length; i++) {
    const [x0, y0] = profile[i]!;
    const [x1, y1] = profile[i + 1]!;
    const verts: V3[] = [
      [x0, 0, -w], [x1, 0, -w], [x1, y1, -w], [x0, y0, -w],
      [x0, 0, w], [x1, 0, w], [x1, y1, w], [x0, y0, w],
    ];
    // Drop the degenerate top-left edge when a slice starts at zero height.
    const faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]];
    out.push({ verts, faces, color: color(i) });
  }
  return out;
}

/** Move and turn hulls: local x along `heading`, local z to its right, then offset. */
export function placeHulls(hulls: HullPart[], origin: V3, heading: number): HullPart[] {
  const c = Math.cos(heading), s = Math.sin(heading);
  return hulls.map((h) => ({
    ...h,
    verts: h.verts.map(([x, y, z]): V3 => [origin[0] + x * c - z * s, origin[1] + y, origin[2] + x * s + z * c]),
  }));
}

/** Box hull from a centre and half extents, axis aligned. */
export function boxHull(centre: V3, half: V3, color: readonly [number, number, number]): HullPart {
  const [cx, cy, cz] = centre;
  const [hx, hy, hz] = half;
  return {
    verts: BOX.verts.map(([x, y, z]): V3 => [cx + x * 2 * hx, cy + y * 2 * hy, cz + z * 2 * hz]),
    faces: BOX.faces,
    color,
  };
}

/** Low-poly rock: an icosahedron, squashed and scaled, in world space. */
export function rockHull(centre: V3, size: V3, color: readonly [number, number, number]): HullPart {
  const ico = HULLS[Shape.Ball];
  return {
    verts: ico.verts.map(([x, y, z]): V3 => [centre[0] + x * size[0], centre[1] + y * size[1], centre[2] + z * size[2]]),
    faces: ico.faces,
    color,
  };
}

/**
 * A round ball (latitude / longitude, `rings` bands, `segments` round): the
 * buoys' shape (layout spec section 5), smooth enough to read as a sphere.
 */
export function sphereHull(centre: V3, radius: number, color: readonly [number, number, number], rings = 7, segments = 12): HullPart {
  const verts: V3[] = [[centre[0], centre[1] + radius, centre[2]]];
  for (let i = 1; i < rings; i++) {
    const phi = (Math.PI * i) / rings;
    for (let j = 0; j < segments; j++) {
      const th = (2 * Math.PI * j) / segments;
      verts.push([centre[0] + radius * Math.sin(phi) * Math.cos(th), centre[1] + radius * Math.cos(phi), centre[2] + radius * Math.sin(phi) * Math.sin(th)]);
    }
  }
  verts.push([centre[0], centre[1] - radius, centre[2]]);
  const bottom = verts.length - 1;
  const at = (i: number, j: number) => 1 + (i - 1) * segments + (j % segments);
  const faces: number[][] = [];
  for (let j = 0; j < segments; j++) faces.push([0, at(1, j + 1), at(1, j)]);
  for (let i = 1; i < rings - 1; i++) for (let j = 0; j < segments; j++) faces.push([at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)]);
  for (let j = 0; j < segments; j++) faces.push([bottom, at(rings - 1, j), at(rings - 1, j + 1)]);
  return { verts, faces, color };
}

export type { V3 };
