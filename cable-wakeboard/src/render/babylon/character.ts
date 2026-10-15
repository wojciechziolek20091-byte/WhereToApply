import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { buildBoardGeometry, WAKEBOARD } from '../../art/board';
import type { RiderPalette } from '../../art/riders';
import { add, dot, length, normalize, scale, sub, vec3, type Vec3 } from '../../sim/math/vec';
import { applyBasis, axisAngle, basisFromUp, basisToQuaternion, col, IDENTITY, mulBasis, type Basis } from './rot';

/**
 * Smooth-shaded rider for the Babylon game, modelled on the user's character
 * sheet: red vented helmet, shaggy blond hair, two-tone sage-and-navy hoodie
 * with hood, drawstrings and chest patch, navy long sleeves under short sage
 * sleeves, baggy navy cargo pants, black sneakers with cream soles, on a sage
 * board with black bindings.
 *
 * Built in rider space (metres): +X travel (board nose), +Y up, +Z toe side,
 * board base at y = 0. The pose is solved with two-bone IK so the hands meet
 * the handle and the feet sit in the bindings. All parts carry vertex colours
 * and are merged into one mesh (one draw call).
 */

type RGB = [number, number, number];
const rgb = (r: number, g: number, b: number): RGB => [r / 255, g / 255, b / 255];
const shade = (c: RGB, k: number): RGB => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

export interface CharacterColors {
  hoodieTop: RGB; // upper hoodie, hood and short sleeves
  hoodieBottom: RGB; // lower hoodie band
  sleeves: RGB; // long undersleeves
  pants: RGB;
  shoes: RGB; // sneaker uppers
  soles: RGB; // soles, toe caps, heel tabs, pant tag
  skin: RGB;
  hair: RGB;
  eyes: RGB;
  helmet: RGB;
  helmetDetail: RGB; // vents, centre stripe, back band
  trim: RGB; // drawstrings, chest patch
  deck: RGB;
  rail: RGB;
  base: RGB;
  binding: RGB;
  buckle: RGB;
  handle: RGB;
}

/** Colourways. "Sheet" follows the character sheet exactly. */
export const CHARACTER_PALETTES: Record<RiderPalette, CharacterColors> = {
  Sheet: {
    hoodieTop: rgb(104, 148, 110),
    hoodieBottom: rgb(30, 35, 58),
    sleeves: rgb(28, 32, 54),
    pants: rgb(27, 31, 50),
    shoes: rgb(26, 26, 30),
    soles: rgb(236, 228, 208),
    skin: rgb(240, 194, 152),
    hair: rgb(222, 184, 100),
    eyes: rgb(46, 56, 70),
    helmet: rgb(170, 58, 66),
    helmetDetail: rgb(30, 26, 30),
    trim: rgb(24, 24, 28),
    deck: rgb(106, 140, 110),
    rail: rgb(56, 78, 62),
    base: rgb(92, 122, 96),
    binding: rgb(30, 32, 32),
    buckle: rgb(178, 116, 74),
    handle: rgb(28, 28, 32),
  },
  A: {
    hoodieTop: rgb(46, 92, 210),
    hoodieBottom: rgb(26, 50, 132),
    sleeves: rgb(30, 36, 66),
    pants: rgb(74, 64, 94),
    shoes: rgb(150, 214, 44),
    soles: rgb(240, 240, 236),
    skin: rgb(236, 182, 140),
    hair: rgb(96, 64, 42),
    eyes: rgb(46, 40, 36),
    helmet: rgb(54, 108, 226),
    helmetDetail: rgb(24, 34, 80),
    trim: rgb(255, 178, 46),
    deck: rgb(106, 140, 110),
    rail: rgb(56, 78, 62),
    base: rgb(92, 122, 96),
    binding: rgb(30, 32, 32),
    buckle: rgb(178, 116, 74),
    handle: rgb(28, 28, 32),
  },
  B: {
    hoodieTop: rgb(52, 152, 86),
    hoodieBottom: rgb(28, 96, 58),
    sleeves: rgb(36, 40, 46),
    pants: rgb(158, 60, 46),
    shoes: rgb(40, 34, 36),
    soles: rgb(248, 172, 38),
    skin: rgb(226, 166, 124),
    hair: rgb(132, 66, 32),
    eyes: rgb(50, 40, 32),
    helmet: rgb(248, 172, 38),
    helmetDetail: rgb(110, 50, 28),
    trim: rgb(255, 196, 60),
    deck: rgb(106, 140, 110),
    rail: rgb(56, 78, 62),
    base: rgb(92, 122, 96),
    binding: rgb(30, 32, 32),
    buckle: rgb(178, 116, 74),
    handle: rgb(28, 28, 32),
  },
};

/** Body measurements and pose (metres and degrees). */
const BODY = {
  stance: 0.58, // distance between the bindings
  pelvisHeight: 0.84, // hip centre above the board when riding
  pelvisBack: -0.03,
  hipHalf: 0.1, // hip joint offset from the centre
  thigh: 0.45,
  shin: 0.44,
  upperArm: 0.29,
  forearm: 0.27,
  shoulderHalf: 0.2,
  shoulderHeight: 0.42, // above the pelvis along the spine
  lean: 12, // forward toward the toes
  twist: 18, // chest turned toward the rope
  headTurn: 34, // looking where the rider is going
  /** Handle in front of the lead hip; bar across the body. */
  handle: vec3(0.3, 0.8, 0.34),
  handleDir: normalize(vec3(-0.45, 0, 0.9)),
  handleLength: 0.32,
};

/** Joint positions solved for the pose, exposed for tests and the rope. */
export interface CharacterRig {
  pelvis: Vec3;
  head: Vec3;
  grips: [Vec3, Vec3];
  ankles: [Vec3, Vec3];
  knees: [Vec3, Vec3];
  elbows: [Vec3, Vec3];
  /** Middle of the handle bar. */
  handle: Vec3;
}

/**
 * Two-bone IK: the middle joint for a chain from `a` to `c` with bone lengths
 * l1 and l2, bending toward `pole`. Out-of-reach targets straighten the chain.
 */
export function solveJoint(a: Vec3, c: Vec3, l1: number, l2: number, pole: Vec3): Vec3 {
  const ac = sub(c, a);
  const d = Math.min(Math.max(length(ac), 1e-6), l1 + l2 - 1e-6);
  const dir = normalize(ac);
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const p = normalize(sub(pole, scale(dir, dot(pole, dir))));
  return add(add(a, scale(dir, along)), scale(p, h));
}

/** Collects coloured primitives, then merges them into one mesh. */
class Kit {
  readonly parts: Mesh[] = [];
  constructor(private readonly scene: Scene) {}

  private finish(mesh: Mesh, color: RGB, pos: Vec3, basis: Basis): Mesh {
    const count = mesh.getTotalVertices();
    const colors = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) colors.set([color[0], color[1], color[2], 1], i * 4);
    mesh.setVerticesData('color', colors);
    mesh.position = new Vector3(pos.x, pos.y, pos.z);
    mesh.rotationQuaternion = basisToQuaternion(basis);
    this.parts.push(mesh);
    return mesh;
  }

  ellipsoid(pos: Vec3, d: [number, number, number], color: RGB, basis: Basis = IDENTITY, segments = 14): Mesh {
    const m = CreateSphere('p', { diameterX: d[0], diameterY: d[1], diameterZ: d[2], segments }, this.scene);
    return this.finish(m, color, pos, basis);
  }

  dome(pos: Vec3, d: [number, number, number], color: RGB, basis: Basis, slice: number): Mesh {
    const m = CreateSphere('p', { diameterX: d[0], diameterY: d[1], diameterZ: d[2], segments: 18, slice, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    return this.finish(m, color, pos, basis);
  }

  box(pos: Vec3, size: [number, number, number], color: RGB, basis: Basis = IDENTITY): Mesh {
    const m = CreateBox('p', { width: size[0], height: size[1], depth: size[2] }, this.scene);
    return this.finish(m, color, pos, basis);
  }

  /** Cylinder whose axis runs along `up` in `basis`; `scaleZ` flattens it into an oval. */
  cylinder(pos: Vec3, height: number, dBottom: number, dTop: number, color: RGB, basis: Basis = IDENTITY, scaleZ = 1, tess = 20): Mesh {
    const m = CreateCylinder('p', { height, diameterBottom: dBottom, diameterTop: dTop, tessellation: tess }, this.scene);
    m.scaling = new Vector3(1, 1, scaleZ);
    return this.finish(m, color, pos, basis);
  }

  torus(pos: Vec3, diameter: number, thickness: number, color: RGB, basis: Basis, scaleZ = 1): Mesh {
    const m = CreateTorus('p', { diameter, thickness, tessellation: 24 }, this.scene);
    m.scaling = new Vector3(1, 1, scaleZ);
    return this.finish(m, color, pos, basis);
  }

  /** Tapered tube from a to b, capped, radius r0 at a to r1 at b. */
  tube(a: Vec3, b: Vec3, r0: number, r1: number, color: RGB, tess = 16): Mesh {
    const path = [0, 0.5, 1].map((t) => new Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t));
    const m = CreateTube('p', { path, radiusFunction: (i: number) => r0 + ((r1 - r0) * i) / 2, tessellation: tess, cap: Mesh.CAP_ALL }, this.scene);
    return this.finish(m, color, vec3(), IDENTITY);
  }

  /** Cone from `base` along `dir` (unit), for hair tufts. */
  cone(base: Vec3, dir: Vec3, len: number, radius: number, color: RGB): Mesh {
    const m = CreateCylinder('p', { height: len, diameterBottom: radius * 2, diameterTop: 0, tessellation: 7 }, this.scene);
    return this.finish(m, color, add(base, scale(dir, len / 2)), basisFromUp(dir));
  }

  raw(mesh: Mesh): void {
    this.parts.push(mesh);
  }

  merge(name: string): Mesh {
    const merged = Mesh.MergeMeshes(this.parts, true, true);
    if (!merged) throw new Error('character merge failed');
    merged.name = name;
    return merged;
  }
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Build the rider and board as one mesh, plus the solved rig. */
export function buildCharacter(scene: Scene, palette: RiderPalette, material: StandardMaterial): { mesh: Mesh; rig: CharacterRig } {
  const c = CHARACTER_PALETTES[palette];
  const k = new Kit(scene);

  // ---- Board and bindings -------------------------------------------------
  const board = buildBoardGeometry(WAKEBOARD, { deck: c.deck, rail: c.rail, base: c.base });
  const boardMesh = new Mesh('board', scene);
  const vd = new VertexData();
  vd.positions = board.positions;
  vd.indices = board.indices;
  vd.colors = board.colors;
  // Built-in shapes carry UVs; merging needs every part to have the same attributes.
  vd.uvs = new Array((board.positions.length / 3) * 2).fill(0);
  const normals: number[] = [];
  VertexData.ComputeNormals(board.positions, board.indices, normals, { useRightHandedSystem: true });
  vd.normals = normals;
  vd.applyToMesh(boardMesh);
  k.raw(boardMesh);
  // Pale slash graphic on the base.
  [
    [-0.16, 0.04, 0.38, 52],
    [0.02, -0.02, 0.44, 58],
    [0.18, 0.05, 0.26, 48],
  ].forEach(([x, z, len, ang]) => k.box(vec3(x!, -0.002, z!), [len!, 0.004, 0.028], rgb(206, 216, 198), axisAngle(col(0, 1, 0), rad(ang!))));

  const deckTop = board.deckTop;
  const plate = 0.014;
  const soleTop = deckTop + plate + 0.032;
  const half = BODY.stance / 2;
  const ankles: [Vec3, Vec3] = [vec3(half, soleTop + 0.075, 0.0), vec3(-half, soleTop + 0.075, 0.0)];

  for (const [i, side] of [[0, 1], [1, -1]] as const) {
    const x = ankles[i].x;
    // Binding: plate, heel cup, side walls, two straps, copper buckle.
    k.box(vec3(x, deckTop + plate / 2, 0.02), [0.15, plate, 0.32], c.binding);
    k.box(vec3(x, deckTop + 0.06, -0.135), [0.135, 0.09, 0.03], shade(c.binding, 1.15));
    for (const s of [-1, 1]) k.box(vec3(x + s * 0.068, deckTop + 0.045, -0.02), [0.012, 0.05, 0.2], shade(c.binding, 1.1));
    // Sneaker: cream sole, black upper, rounded toe, cream toe cap and heel tab.
    k.box(vec3(x, deckTop + plate + 0.016, 0.03), [0.106, 0.032, 0.285], c.soles);
    k.box(vec3(x, soleTop + 0.034, -0.015), [0.098, 0.068, 0.2], c.shoes);
    k.ellipsoid(vec3(x, soleTop + 0.03, 0.09), [0.098, 0.066, 0.12], c.shoes);
    k.ellipsoid(vec3(x, soleTop + 0.012, 0.13), [0.1, 0.04, 0.07], c.soles);
    k.box(vec3(x, soleTop + 0.04, -0.118), [0.05, 0.06, 0.012], c.soles);
    k.cylinder(vec3(x, soleTop + 0.075, -0.03), 0.04, 0.108, 0.104, c.shoes);
    k.box(vec3(x, soleTop + 0.072, 0.045), [0.12, 0.022, 0.06], c.binding);
    k.box(vec3(x, soleTop + 0.095, -0.05), [0.12, 0.022, 0.05], c.binding);
    k.box(vec3(x + side * 0.064, soleTop + 0.07, 0.04), [0.012, 0.026, 0.024], c.buckle);
  }

  // ---- Torso frame -------------------------------------------------------
  const pelvis = vec3(0, BODY.pelvisHeight, BODY.pelvisBack);
  const T = mulBasis(axisAngle(col(0, 1, 0), rad(BODY.twist)), axisAngle(col(1, 0, 0), rad(BODY.lean)));
  const at = (x: number, y: number, z: number) => add(pelvis, applyBasis(T, vec3(x, y, z)));

  // ---- Legs: baggy cargo pants ------------------------------------------
  const knees: Vec3[] = [];
  ([1, -1] as const).forEach((side, i) => {
    const hip = at(side * BODY.hipHalf, 0, 0);
    const ankle = ankles[i]!;
    const knee = solveJoint(hip, ankle, BODY.thigh, BODY.shin, vec3(side * 0.3, 0, 1));
    knees.push(knee);
    const cuff = add(ankle, vec3(0, 0.02, 0.01));
    k.ellipsoid(hip, [0.19, 0.19, 0.19], c.pants);
    k.tube(hip, knee, 0.094, 0.084, c.pants);
    k.ellipsoid(knee, [0.172, 0.172, 0.172], shade(c.pants, 1.05));
    k.tube(knee, cuff, 0.084, 0.094, c.pants);
    k.torus(add(cuff, vec3(0, 0.005, 0)), 0.18, 0.022, shade(c.pants, 0.85), IDENTITY, 0.95);
    // Cargo pocket on the outside of the thigh, and the cream tag on the front of the right leg.
    const thighDir = normalize(sub(knee, hip));
    const mid = add(hip, scale(sub(knee, hip), 0.55));
    const pocketBasis = basisFromUp(thighDir, applyBasis(T, vec3(0, 0, 1)));
    k.box(add(mid, scale(applyBasis(T, vec3(side, 0, 0)), 0.088)), [0.02, 0.13, 0.11], shade(c.pants, 1.12), pocketBasis);
    k.box(add(add(mid, scale(applyBasis(T, vec3(side, 0, 0)), 0.09)), scale(thighDir, -0.065)), [0.024, 0.02, 0.115], shade(c.pants, 0.9), pocketBasis);
    // Wearer's right is -X (rider faces +Z), so the tag sits on the back leg.
    if (side < 0) k.box(add(mid, scale(applyBasis(T, vec3(0, 0, 1)), 0.09)), [0.03, 0.06, 0.008], c.soles, pocketBasis);
  });
  // Seat of the pants.
  k.ellipsoid(at(0, 0.03, -0.01), [0.34, 0.2, 0.25], c.pants, T);

  // ---- Hoodie --------------------------------------------------------------
  const oval = 0.66;
  k.cylinder(at(0, 0.14, 0), 0.2, 0.36, 0.372, c.hoodieBottom, T, oval);
  k.torus(at(0, 0.05, 0), 0.37, 0.04, shade(c.hoodieBottom, 0.85), T, oval);
  k.cylinder(at(0, 0.345, 0), 0.21, 0.374, 0.405, c.hoodieTop, T, oval);
  k.ellipsoid(at(0, 0.45, 0), [0.46, 0.13, 0.27], c.hoodieTop, T);
  // Hood resting on the shoulders, collar opening with the undershirt showing.
  k.ellipsoid(at(0, 0.48, -0.1), [0.27, 0.14, 0.15], shade(c.hoodieTop, 0.9), T);
  k.ellipsoid(at(0, 0.5, -0.06), [0.2, 0.08, 0.12], shade(c.hoodieTop, 0.85), T);
  k.ellipsoid(at(0, 0.49, 0.04), [0.13, 0.04, 0.09], c.sleeves, T);
  // Drawstrings with aglets.
  for (const sx of [-0.035, 0.035]) {
    const top = at(sx, 0.47, 0.115);
    const end = at(sx * 1.15, 0.33, 0.132);
    k.tube(top, end, 0.0055, 0.0055, c.trim, 8);
    k.cylinder(end, 0.022, 0.012, 0.012, c.trim, T, 1, 8);
  }
  // Chest patch on the wearer's left (+X), and a tab on the back.
  k.box(at(0.095, 0.4, 0.134), [0.075, 0.022, 0.006], c.trim, T);
  k.box(at(0, 0.37, -0.134), [0.06, 0.03, 0.006], c.trim, T);

  // ---- Arms --------------------------------------------------------------
  const grips: [Vec3, Vec3] = [
    sub(BODY.handle, scale(BODY.handleDir, 0.075)),
    add(BODY.handle, scale(BODY.handleDir, 0.075)),
  ];
  const elbows: Vec3[] = [];
  ([1, -1] as const).forEach((side, i) => {
    const shoulder = at(side * BODY.shoulderHalf, BODY.shoulderHeight, 0);
    const grip = grips[i]!;
    const elbow = solveJoint(shoulder, grip, BODY.upperArm, BODY.forearm, vec3(side * 0.6, -1, -0.25));
    elbows.push(elbow);
    const fore = normalize(sub(grip, elbow));
    const wrist = sub(grip, scale(fore, 0.045));
    // Short sage sleeve over a navy long sleeve.
    k.ellipsoid(shoulder, [0.135, 0.135, 0.135], c.hoodieTop);
    // The sage sleeve reaches nearly to the elbow, as on the sheet.
    const sleeveEnd = add(shoulder, scale(sub(elbow, shoulder), 0.88));
    k.tube(shoulder, sleeveEnd, 0.072, 0.066, c.hoodieTop);
    k.torus(sleeveEnd, 0.13, 0.014, shade(c.hoodieTop, 0.88), basisFromUp(normalize(sub(elbow, shoulder))));
    k.tube(add(shoulder, scale(sub(elbow, shoulder), 0.6)), elbow, 0.047, 0.044, c.sleeves);
    k.ellipsoid(elbow, [0.088, 0.088, 0.088], c.sleeves);
    k.tube(elbow, wrist, 0.044, 0.038, c.sleeves);
    k.ellipsoid(wrist, [0.085, 0.05, 0.085], shade(c.sleeves, 0.85), basisFromUp(fore));
    // Fist around the bar.
    k.ellipsoid(grip, [0.08, 0.095, 0.085], c.skin, basisFromUp(fore));
    k.ellipsoid(add(grip, scale(applyBasis(T, vec3(0, 0, 1)), 0.03)), [0.03, 0.05, 0.03], shade(c.skin, 0.95), basisFromUp(fore));
  });
  // Handle bar with end caps.
  const barA = sub(BODY.handle, scale(BODY.handleDir, BODY.handleLength / 2));
  const barB = add(BODY.handle, scale(BODY.handleDir, BODY.handleLength / 2));
  k.tube(barA, barB, 0.016, 0.016, c.handle, 10);
  for (const e of [barA, barB]) k.ellipsoid(e, [0.04, 0.04, 0.04], c.trim);

  // ---- Head ----------------------------------------------------------------
  const neckBase = at(0, 0.47, 0.01);
  const neckTop = at(0, 0.55, 0.02);
  k.tube(neckBase, neckTop, 0.046, 0.043, c.skin);
  const H = at(0, 0.65, 0.03);
  const Hb = mulBasis(T, mulBasis(axisAngle(col(0, 1, 0), rad(BODY.headTurn)), axisAngle(col(1, 0, 0), rad(-BODY.lean * 0.6))));
  const hp = (x: number, y: number, z: number) => add(H, applyBasis(Hb, vec3(x, y, z)));
  k.ellipsoid(H, [0.18, 0.22, 0.2], c.skin, Hb);
  k.ellipsoid(hp(0, -0.06, 0.03), [0.145, 0.1, 0.15], c.skin, Hb);
  k.ellipsoid(hp(0, -0.008, 0.1), [0.024, 0.04, 0.03], shade(c.skin, 0.96), Hb);
  for (const s of [-1, 1]) {
    k.ellipsoid(hp(s * 0.09, -0.005, -0.005), [0.024, 0.05, 0.036], shade(c.skin, 0.95), Hb);
    k.ellipsoid(hp(s * 0.036, 0.012, 0.09), [0.024, 0.028, 0.012], c.eyes, Hb);
    k.box(hp(s * 0.036, 0.04, 0.094), [0.04, 0.008, 0.01], shade(c.hair, 0.8), Hb);
  }
  k.box(hp(0, -0.052, 0.095), [0.028, 0.004, 0.006], shade(c.skin, 0.75), Hb);

  // Shaggy hair: a back mass plus tufts poking out from under the helmet.
  k.ellipsoid(hp(0, -0.005, -0.065), [0.2, 0.15, 0.12], c.hair, Hb);
  for (let a = 55; a <= 305; a += 22) {
    const ar = rad(a);
    const base = hp(Math.sin(ar) * 0.092, 0.03, Math.cos(ar) * 0.092);
    const dir = normalize(applyBasis(Hb, vec3(Math.sin(ar) * 0.55, -0.8, Math.cos(ar) * 0.45)));
    k.cone(base, dir, 0.075 + 0.02 * Math.abs(Math.sin(ar * 3)), 0.024, shade(c.hair, 0.95 + 0.1 * Math.cos(ar * 2)));
  }
  // Fringe swept to one side across the forehead.
  for (const [x, len] of [[-0.05, 0.07], [-0.015, 0.075], [0.025, 0.065]] as const) {
    k.cone(hp(x, 0.06, 0.088), normalize(applyBasis(Hb, vec3(0.55, -0.75, 0.35))), len, 0.022, shade(c.hair, 1.05));
  }

  // Helmet: a red dome with a rim, vents, a centre stripe and a back band.
  const hc = hp(0, 0.035, -0.005);
  const R = 0.13;
  k.dome(hc, [0.26, 0.25, 0.275], c.helmet, Hb, 0.56);
  k.torus(hp(0, 0.03, -0.005), 0.262, 0.016, shade(c.helmet, 0.8), Hb, 1.05);
  const onShell = (elev: number, azim: number, size: [number, number, number], color: RGB) => {
    const e = rad(elev), az = rad(azim);
    const n = applyBasis(Hb, vec3(Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e)));
    const pos = add(hc, scale(n, R * 0.99));
    k.box(pos, size, color, basisFromUp(n, applyBasis(Hb, vec3(Math.cos(az), 0, -Math.sin(az)))));
  };
  for (const az of [-39, -13, 13, 39]) onShell(28, az, [0.03, 0.008, 0.014], c.helmetDetail);
  for (const az of [-55, -18, 18, 55]) onShell(52, az, [0.026, 0.008, 0.013], c.helmetDetail);
  for (const az of [-90, 90, -125, 125]) onShell(30, az, [0.026, 0.008, 0.013], c.helmetDetail);
  for (const az of [150, 210]) onShell(40, az, [0.024, 0.008, 0.014], c.helmetDetail);
  for (let el = 20; el <= 84; el += 8) onShell(el, 180, [0.026, 0.008, 0.024], c.helmetDetail);
  k.box(hp(0, 0.0, -0.13), [0.13, 0.032, 0.02], c.helmetDetail, Hb);

  const mesh = k.merge(`character-${palette}`);
  mesh.material = material;
  return {
    mesh,
    rig: {
      pelvis,
      head: H,
      grips,
      ankles,
      knees: knees as [Vec3, Vec3],
      elbows: elbows as [Vec3, Vec3],
      handle: BODY.handle,
    },
  };
}

/** Material for characters: smooth shading, vertex colours, a little sheen. */
export function characterMaterial(scene: Scene): StandardMaterial {
  const m = new StandardMaterial('character', scene);
  m.diffuseColor = Color3.White();
  m.specularColor = new Color3(0.12, 0.12, 0.12);
  m.specularPower = 24;
  m.backFaceCulling = false;
  return m;
}
