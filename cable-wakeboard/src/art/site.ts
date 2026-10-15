/**
 * Engine-free geometry for the park site (shore, island, terrace, roads):
 * polygon tests, ear-clipping triangulation and a flat-shaded triangle builder
 * that outputs the same MeshData as mesh.ts. Pure functions of plain data.
 */
import type { GroundPoint } from '../sim/park';
import type { MeshData } from './mesh';

type RGB = readonly [number, number, number];

export const polygonArea = (poly: readonly GroundPoint[]): number => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
};

export function centroid(poly: readonly GroundPoint[]): GroundPoint {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p.x;
    z += p.z;
  }
  return { x: x / poly.length, z: z / poly.length };
}

export function pointInPolygon(p: GroundPoint, poly: readonly GroundPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(p: GroundPoint, a: GroundPoint, b: GroundPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}

/** Distance from a point to a closed polygon's outline. */
export function distanceToOutline(p: GroundPoint, poly: readonly GroundPoint[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distanceToSegment(p, poly[i]!, poly[(i + 1) % poly.length]!));
  return d;
}

/** Distance from a point to an open polyline. */
export function distanceToPolyline(p: GroundPoint, line: readonly GroundPoint[]): number {
  let d = Infinity;
  for (let i = 0; i + 1 < line.length; i++) d = Math.min(d, distanceToSegment(p, line[i]!, line[i + 1]!));
  return d;
}

/** True when every outline vertex can see the centroid (so a radial fan or ring is valid). */
export function isStarShaped(poly: readonly GroundPoint[]): boolean {
  const c = centroid(poly);
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    // The triangle (c, a, b) must keep the polygon's winding.
    const cross = (a.x - c.x) * (b.z - c.z) - (a.z - c.z) * (b.x - c.x);
    if (Math.sign(cross) !== Math.sign(polygonArea(poly)) || cross === 0) return false;
  }
  return true;
}

/** Ear-clipping triangulation of a simple polygon. Returns index triples. */
export function triangulate(poly: readonly GroundPoint[]): [number, number, number][] {
  const sign = Math.sign(polygonArea(poly)) || 1;
  const idx = poly.map((_, i) => i);
  const out: [number, number, number][] = [];
  const cross = (a: GroundPoint, b: GroundPoint, c: GroundPoint) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length]!;
      const i1 = idx[k]!;
      const i2 = idx[(k + 1) % idx.length]!;
      const a = poly[i0]!, b = poly[i1]!, c = poly[i2]!;
      if (cross(a, b, c) * sign <= 0) continue; // reflex corner
      const tri = [a, c, b];
      const blocked = idx.some((j) => j !== i0 && j !== i1 && j !== i2 && pointInPolygon(poly[j]!, tri));
      if (blocked) continue;
      out.push([i0, i1, i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate input: stop rather than loop
  }
  if (idx.length === 3) out.push([idx[0]!, idx[1]!, idx[2]!]);
  return out;
}

/** Push each vertex away from the centroid by `d` metres (for star-shaped outlines). */
export function growRadially(poly: readonly GroundPoint[], d: number): GroundPoint[] {
  const c = centroid(poly);
  return poly.map((p) => {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: p.x + (dx / len) * d, z: p.z + (dz / len) * d };
  });
}

type P3 = readonly [number, number, number];

/** Collects flat-shaded, vertex-coloured triangles (double-sided material expected). */
export class TriangleBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly col: number[] = [];
  private readonly uv: number[] = [];

  /** One triangle. The normal is flipped to point up when `up` is set. */
  tri(a: P3, b: P3, c: P3, color: RGB, up = false): void {
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const len = Math.hypot(nx, ny, nz) || 1;
    const flip = up && ny < 0 ? -1 : 1;
    nx = (nx / len) * flip;
    ny = (ny / len) * flip;
    nz = (nz / len) * flip;
    for (const v of [a, b, c]) {
      this.pos.push(v[0], v[1], v[2]);
      this.nrm.push(nx, ny, nz);
      this.col.push(color[0], color[1], color[2], 1);
      this.uv.push(v[0], v[2]);
    }
  }

  quad(a: P3, b: P3, c: P3, d: P3, color: RGB, up = false): void {
    this.tri(a, b, c, color, up);
    this.tri(a, c, d, color, up);
  }

  /** A flat polygon at height y. */
  polygon(poly: readonly GroundPoint[], y: number, color: RGB | ((i: number) => RGB)): void {
    triangulate(poly).forEach(([i, j, k], n) => {
      const c = typeof color === 'function' ? color(n) : color;
      this.tri([poly[i]!.x, y, poly[i]!.z], [poly[j]!.x, y, poly[j]!.z], [poly[k]!.x, y, poly[k]!.z], c, true);
    });
  }

  /** Vertical wall along a closed outline from y0 up to y1. */
  skirt(poly: readonly GroundPoint[], y0: number, y1: number, color: RGB): void {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      this.quad([a.x, y0, a.z], [b.x, y0, b.z], [b.x, y1, b.z], [a.x, y1, a.z], color);
    }
  }

  /** Band between two outlines with matching vertices (inner at y0, outer at y1). */
  band(inner: readonly GroundPoint[], outer: readonly GroundPoint[], y0: number, y1: number, color: RGB): void {
    for (let i = 0; i < inner.length; i++) {
      const j = (i + 1) % inner.length;
      const a = inner[i]!, b = inner[j]!, c = outer[j]!, d = outer[i]!;
      this.quad([a.x, y0, a.z], [b.x, y0, b.z], [c.x, y1, c.z], [d.x, y1, d.z], color, true);
    }
  }

  /** A strip of `width` along a polyline at height y. */
  strip(line: readonly GroundPoint[], width: number, y: number, color: RGB): void {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!;
      const b = line[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      // Extend each piece by half a width so the joints overlap.
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      const nx = (-uz * width) / 2, nz = (ux * width) / 2;
      const e = width / 2;
      const ax = a.x - ux * e, az = a.z - uz * e, bx = b.x + ux * e, bz = b.z + uz * e;
      this.quad([ax + nx, y, az + nz], [bx + nx, y, bz + nz], [bx - nx, y, bz - nz], [ax - nx, y, az - nz], color, true);
    }
  }

  get triangleCount(): number {
    return this.pos.length / 9;
  }

  /** MeshData plus world-space x/z as UVs (for tiled textures). */
  build(): MeshData & { uvs: Float32Array } {
    const n = this.pos.length / 3;
    const indices = new Uint32Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      colors: new Float32Array(this.col),
      indices,
      uvs: new Float32Array(this.uv),
    };
  }
}
