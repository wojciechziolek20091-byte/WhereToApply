import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { AnimFrame } from '../../anim/animator';
import { JOINTS, type JointName, PARENT, type RigDef } from '../../anim/skeleton';
import { buildBoardGeometry, WAKEBOARD } from '../../art/board';
import type { RiderPalette } from '../../art/riders';
import { add, dot, length, normalize, scale, sub, vec3, type Vec3 } from '../../sim/math/vec';
import { axisAngle, basisFromUp, basisToQuaternion, col, IDENTITY, type Basis } from './rot';

/**
 * Smooth-shaded rider for the Babylon game, modelled on the user's character
 * sheet: red vented helmet, shaggy blond hair, two-tone sage-and-navy hoodie
 * with hood, drawstrings and chest patch, navy long sleeves under short sage
 * sleeves, baggy navy cargo pants, black sneakers with cream soles, on a sage
 * board with black bindings.
 *
 * Built in rider space (metres): +X travel (board nose, the lead side), +Y
 * up, +Z toe side (the chest), board base at y = 0, in a neutral rest pose
 * (upright, arms hanging in front, mirror-symmetric). Every part belongs to
 * one bone of the animation skeleton (anim/skeleton.ts); the parts of a bone
 * are merged into one mesh under that bone's TransformNode, so the animator
 * poses the rider by turning nodes. The handle is a separate object.
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


/** Body measurements (metres) of the rest pose. */
const BODY = {
  stance: 0.58, // distance between the bindings
  pelvisHeight: 0.92, // hip centre above the board at rest
  hipHalf: 0.1, // hip joint offset from the centre
  thigh: 0.45,
  shin: 0.44,
  upperArm: 0.29,
  forearm: 0.27, // elbow to the middle of the fist
  fist: 0.045, // wrist to the middle of the fist
  shoulderHalf: 0.2,
  shoulderHeight: 0.42, // above the pelvis along the spine
  /** Rest fists: in front of the hips, mirror-symmetric. */
  restGrip: vec3(0.16, 0.03, 0.3),
  handleLength: 0.32,
  gripSpacing: 0.15,
};

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

type Bone = JointName | 'Root';

/** Collects coloured primitives per bone, then merges each bone's parts into one mesh. */
class Kit {
  readonly parts: { mesh: Mesh; bone: Bone }[] = [];
  bone: Bone = 'Root';
  constructor(private readonly scene: Scene) {}

  private finish(mesh: Mesh, color: RGB, pos: Vec3, basis: Basis): Mesh {
    const count = mesh.getTotalVertices();
    const colors = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) colors.set([color[0], color[1], color[2], 1], i * 4);
    mesh.setVerticesData('color', colors);
    mesh.position = new Vector3(pos.x, pos.y, pos.z);
    mesh.rotationQuaternion = basisToQuaternion(basis);
    this.parts.push({ mesh, bone: this.bone });
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
    this.parts.push({ mesh, bone: this.bone });
  }

  /** Merge each bone's parts, moved into that bone's space (pivot at `pivots[bone]`). */
  mergeByBone(name: string, pivots: Record<Bone, Vec3>): Map<Bone, Mesh> {
    const out = new Map<Bone, Mesh>();
    const groups = new Map<Bone, Mesh[]>();
    for (const p of this.parts) {
      const g = groups.get(p.bone) ?? [];
      g.push(p.mesh);
      groups.set(p.bone, g);
    }
    for (const [bone, meshes] of groups) {
      const merged = Mesh.MergeMeshes(meshes, true, true);
      if (!merged) throw new Error(`character merge failed for ${bone}`);
      const pv = pivots[bone];
      merged.position = new Vector3(-pv.x, -pv.y, -pv.z);
      merged.bakeCurrentTransformIntoVertices();
      merged.name = `${name}-${bone}`;
      out.set(bone, merged);
    }
    return out;
  }
}

const rad = (d: number) => (d * Math.PI) / 180;

/** A built rider: the root node (the board), one node per joint, the separate handle, and its rig for the animator. */
export interface CharacterModel {
  root: TransformNode;
  bones: Record<JointName, TransformNode>;
  meshes: Mesh[];
  handle: TransformNode;
  rig: RigDef;
}

/** Rest skeleton of this character (metres, rider frame). */
export function characterRig(): RigDef {
  const board = buildBoardGeometryCached();
  const deckTop = board.deckTop;
  const soleTop = deckTop + 0.014 + 0.032;
  const P = BODY.pelvisHeight;
  const half = BODY.stance / 2;
  const rest = {} as Record<JointName, Vec3>;
  rest.Hips = vec3(0, P, 0);
  rest.Waist = vec3(0, P + 0.12, 0);
  rest.Neck = vec3(0, P + 0.48, 0.01);
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const shoulder = vec3(s * BODY.shoulderHalf, P + BODY.shoulderHeight, 0);
    const grip = vec3(s * BODY.restGrip.x, P + BODY.restGrip.y, BODY.restGrip.z);
    const elbow = solveJoint(shoulder, grip, BODY.upperArm, BODY.forearm, vec3(s * 0.6, -1, -0.25));
    const fore = normalize(sub(grip, elbow));
    rest[`${side}Shoulder`] = shoulder;
    rest[`${side}Elbow`] = elbow;
    rest[`${side}Wrist`] = sub(grip, scale(fore, BODY.fist));
    const hip = vec3(s * BODY.hipHalf, P, 0);
    const ankle = vec3(s * half, soleTop + 0.075, 0);
    rest[`${side}Hip`] = hip;
    rest[`${side}Knee`] = solveJoint(hip, ankle, BODY.thigh, BODY.shin, vec3(s * 0.3, 0, 1));
    rest[`${side}Ankle`] = ankle;
  }
  return {
    name: 'web',
    rest,
    headCentre: vec3(0, P + 0.65, 0.03),
    handLength: BODY.fist,
    boardLength: WAKEBOARD.length,
    boardWidth: WAKEBOARD.width,
    deckTop,
    barLength: BODY.handleLength,
    gripSpacing: BODY.gripSpacing,
  };
}

let boardCache: ReturnType<typeof buildBoardGeometry> | null = null;
function buildBoardGeometryCached(): ReturnType<typeof buildBoardGeometry> {
  if (!boardCache) boardCache = buildBoardGeometry(WAKEBOARD, { deck: [0, 0, 0], rail: [0, 0, 0], base: [0, 0, 0] });
  return boardCache;
}

/** Build the jointed rider and board in its rest pose. */
export function buildCharacter(scene: Scene, palette: RiderPalette, material: StandardMaterial, name = `character-${palette}`): CharacterModel {
  const c = CHARACTER_PALETTES[palette];
  const k = new Kit(scene);
  const rig = characterRig();
  const R = rig.rest;

  // ---- Board and bindings (root) -------------------------------------------------
  k.bone = 'Root';
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

  const deckTop = rig.deckTop;
  const plate = 0.014;
  const soleTop = deckTop + plate + 0.032;
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const x = R[`${side}Ankle`].x;
    k.bone = 'Root';
    // Binding: plate, heel cup, side walls, two straps, copper buckle.
    k.box(vec3(x, deckTop + plate / 2, 0.02), [0.15, plate, 0.32], c.binding);
    k.box(vec3(x, deckTop + 0.06, -0.135), [0.135, 0.09, 0.03], shade(c.binding, 1.15));
    for (const sx of [-1, 1]) k.box(vec3(x + sx * 0.068, deckTop + 0.045, -0.02), [0.012, 0.05, 0.2], shade(c.binding, 1.1));
    // Sneaker (on the foot): cream sole, black upper, rounded toe, cream toe cap and heel tab.
    k.bone = `${side}Ankle`;
    k.box(vec3(x, deckTop + plate + 0.016, 0.03), [0.106, 0.032, 0.285], c.soles);
    k.box(vec3(x, soleTop + 0.034, -0.015), [0.098, 0.068, 0.2], c.shoes);
    k.ellipsoid(vec3(x, soleTop + 0.03, 0.09), [0.098, 0.066, 0.12], c.shoes);
    k.ellipsoid(vec3(x, soleTop + 0.012, 0.13), [0.1, 0.04, 0.07], c.soles);
    k.box(vec3(x, soleTop + 0.04, -0.118), [0.05, 0.06, 0.012], c.soles);
    k.cylinder(vec3(x, soleTop + 0.075, -0.03), 0.04, 0.108, 0.104, c.shoes);
    k.bone = 'Root';
    k.box(vec3(x, soleTop + 0.072, 0.045), [0.12, 0.022, 0.06], c.binding);
    k.box(vec3(x, soleTop + 0.095, -0.05), [0.12, 0.022, 0.05], c.binding);
    k.box(vec3(x + s * 0.064, soleTop + 0.07, 0.04), [0.012, 0.026, 0.024], c.buckle);
  }

  const pelvis = R.Hips;
  const at = (x: number, y: number, z: number) => add(pelvis, vec3(x, y, z));

  // ---- Legs: baggy cargo pants ------------------------------------------
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const hip = R[`${side}Hip`];
    const knee = R[`${side}Knee`];
    const ankle = R[`${side}Ankle`];
    const cuff = add(ankle, vec3(0, 0.02, 0.01));
    k.bone = `${side}Hip`;
    k.ellipsoid(hip, [0.19, 0.19, 0.19], c.pants);
    k.tube(hip, knee, 0.094, 0.084, c.pants);
    // Cargo pocket on the outside of the thigh, and the cream tag on the front of the right leg.
    const thighDir = normalize(sub(knee, hip));
    const mid = add(hip, scale(sub(knee, hip), 0.55));
    const pocketBasis = basisFromUp(thighDir, vec3(0, 0, 1));
    k.box(add(mid, vec3(s * 0.088, 0, 0)), [0.02, 0.13, 0.11], shade(c.pants, 1.12), pocketBasis);
    k.box(add(add(mid, vec3(s * 0.09, 0, 0)), scale(thighDir, -0.065)), [0.024, 0.02, 0.115], shade(c.pants, 0.9), pocketBasis);
    if (s < 0) k.box(add(mid, vec3(0, 0, 0.09)), [0.03, 0.06, 0.008], c.soles, pocketBasis);
    k.bone = `${side}Knee`;
    k.ellipsoid(knee, [0.172, 0.172, 0.172], shade(c.pants, 1.05));
    k.tube(knee, cuff, 0.084, 0.094, c.pants);
    k.torus(add(cuff, vec3(0, 0.005, 0)), 0.18, 0.022, shade(c.pants, 0.85), IDENTITY, 0.95);
  }
  // Seat of the pants and the hoodie's hem.
  k.bone = 'Hips';
  k.ellipsoid(at(0, 0.03, -0.01), [0.34, 0.2, 0.25], c.pants);
  const oval = 0.66;
  k.torus(at(0, 0.05, 0), 0.37, 0.04, shade(c.hoodieBottom, 0.85), IDENTITY, oval);

  // ---- Hoodie --------------------------------------------------------------
  k.bone = 'Waist';
  k.cylinder(at(0, 0.14, 0), 0.2, 0.36, 0.372, c.hoodieBottom, IDENTITY, oval);
  k.cylinder(at(0, 0.345, 0), 0.21, 0.374, 0.405, c.hoodieTop, IDENTITY, oval);
  k.ellipsoid(at(0, 0.45, 0), [0.46, 0.13, 0.27], c.hoodieTop);
  // Hood resting on the shoulders, collar opening with the undershirt showing.
  k.ellipsoid(at(0, 0.48, -0.1), [0.27, 0.14, 0.15], shade(c.hoodieTop, 0.9));
  k.ellipsoid(at(0, 0.5, -0.06), [0.2, 0.08, 0.12], shade(c.hoodieTop, 0.85));
  k.ellipsoid(at(0, 0.49, 0.04), [0.13, 0.04, 0.09], c.sleeves);
  // Drawstrings with aglets.
  for (const sx of [-0.035, 0.035]) {
    const top = at(sx, 0.47, 0.115);
    const end = at(sx * 1.15, 0.33, 0.132);
    k.tube(top, end, 0.0055, 0.0055, c.trim, 8);
    k.cylinder(end, 0.022, 0.012, 0.012, c.trim, IDENTITY, 1, 8);
  }
  // Chest patch on the wearer's left (+X), and a tab on the back.
  k.box(at(0.095, 0.4, 0.134), [0.075, 0.022, 0.006], c.trim);
  k.box(at(0, 0.37, -0.134), [0.06, 0.03, 0.006], c.trim);

  // ---- Arms --------------------------------------------------------------
  for (const side of ['L', 'R'] as const) {
    const shoulder = R[`${side}Shoulder`];
    const elbow = R[`${side}Elbow`];
    const wrist = R[`${side}Wrist`];
    const fore = normalize(sub(wrist, elbow));
    const grip = add(wrist, scale(fore, BODY.fist));
    // Short sage sleeve over a navy long sleeve.
    k.bone = `${side}Shoulder`;
    k.ellipsoid(shoulder, [0.135, 0.135, 0.135], c.hoodieTop);
    const sleeveEnd = add(shoulder, scale(sub(elbow, shoulder), 0.88));
    k.tube(shoulder, sleeveEnd, 0.072, 0.066, c.hoodieTop);
    k.torus(sleeveEnd, 0.13, 0.014, shade(c.hoodieTop, 0.88), basisFromUp(normalize(sub(elbow, shoulder))));
    k.tube(add(shoulder, scale(sub(elbow, shoulder), 0.6)), elbow, 0.047, 0.044, c.sleeves);
    k.bone = `${side}Elbow`;
    k.ellipsoid(elbow, [0.088, 0.088, 0.088], c.sleeves);
    k.tube(elbow, wrist, 0.044, 0.038, c.sleeves);
    k.bone = `${side}Wrist`;
    k.ellipsoid(wrist, [0.085, 0.05, 0.085], shade(c.sleeves, 0.85), basisFromUp(fore));
    // Fist.
    k.ellipsoid(grip, [0.08, 0.095, 0.085], c.skin, basisFromUp(fore));
    k.ellipsoid(add(grip, vec3(0, 0, 0.03)), [0.03, 0.05, 0.03], shade(c.skin, 0.95), basisFromUp(fore));
  }

  // ---- Head ----------------------------------------------------------------
  k.bone = 'Neck';
  k.tube(at(0, 0.47, 0.01), at(0, 0.55, 0.02), 0.046, 0.043, c.skin);
  const H = rig.headCentre;
  const hp = (x: number, y: number, z: number) => add(H, vec3(x, y, z));
  k.ellipsoid(H, [0.18, 0.22, 0.2], c.skin);
  k.ellipsoid(hp(0, -0.06, 0.03), [0.145, 0.1, 0.15], c.skin);
  k.ellipsoid(hp(0, -0.008, 0.1), [0.024, 0.04, 0.03], shade(c.skin, 0.96));
  for (const s of [-1, 1]) {
    k.ellipsoid(hp(s * 0.09, -0.005, -0.005), [0.024, 0.05, 0.036], shade(c.skin, 0.95));
    k.ellipsoid(hp(s * 0.036, 0.012, 0.09), [0.024, 0.028, 0.012], c.eyes);
    k.box(hp(s * 0.036, 0.04, 0.094), [0.04, 0.008, 0.01], shade(c.hair, 0.8));
  }
  k.box(hp(0, -0.052, 0.095), [0.028, 0.004, 0.006], shade(c.skin, 0.75));
  // Shaggy hair: a back mass plus tufts poking out from under the helmet.
  k.ellipsoid(hp(0, -0.005, -0.065), [0.2, 0.15, 0.12], c.hair);
  for (let a = 55; a <= 305; a += 22) {
    const ar = rad(a);
    const base = hp(Math.sin(ar) * 0.092, 0.03, Math.cos(ar) * 0.092);
    const dir = normalize(vec3(Math.sin(ar) * 0.55, -0.8, Math.cos(ar) * 0.45));
    k.cone(base, dir, 0.075 + 0.02 * Math.abs(Math.sin(ar * 3)), 0.024, shade(c.hair, 0.95 + 0.1 * Math.cos(ar * 2)));
  }
  // Fringe swept to one side across the forehead.
  for (const [x, len] of [[-0.05, 0.07], [-0.015, 0.075], [0.025, 0.065]] as const) {
    k.cone(hp(x, 0.06, 0.088), normalize(vec3(0.55, -0.75, 0.35)), len, 0.022, shade(c.hair, 1.05));
  }
  // Helmet: a red dome with a rim, vents, a centre stripe and a back band.
  const hc = hp(0, 0.035, -0.005);
  const RR = 0.13;
  k.dome(hc, [0.26, 0.25, 0.275], c.helmet, IDENTITY, 0.56);
  k.torus(hp(0, 0.03, -0.005), 0.262, 0.016, shade(c.helmet, 0.8), IDENTITY, 1.05);
  const onShell = (elev: number, azim: number, size: [number, number, number], color: RGB) => {
    const e = rad(elev), az = rad(azim);
    const n = vec3(Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e));
    const pos = add(hc, scale(n, RR * 0.99));
    k.box(pos, size, color, basisFromUp(n, vec3(Math.cos(az), 0, -Math.sin(az))));
  };
  for (const az of [-39, -13, 13, 39]) onShell(28, az, [0.03, 0.008, 0.014], c.helmetDetail);
  for (const az of [-55, -18, 18, 55]) onShell(52, az, [0.026, 0.008, 0.013], c.helmetDetail);
  for (const az of [-90, 90, -125, 125]) onShell(30, az, [0.026, 0.008, 0.013], c.helmetDetail);
  for (const az of [150, 210]) onShell(40, az, [0.024, 0.008, 0.014], c.helmetDetail);
  for (let el = 20; el <= 84; el += 8) onShell(el, 180, [0.026, 0.008, 0.024], c.helmetDetail);
  k.box(hp(0, 0.0, -0.13), [0.13, 0.032, 0.02], c.helmetDetail);

  // ---- Nodes: one per bone, at the joint, rest orientation identity ----------
  const pivots = { Root: vec3() } as Record<Bone, Vec3>;
  for (const j of JOINTS) pivots[j] = R[j];
  const merged = k.mergeByBone(name, pivots);
  const root = new TransformNode(`${name}-root`, scene);
  root.rotationQuaternion = Quaternion.Identity();
  const bones = {} as Record<JointName, TransformNode>;
  for (const j of JOINTS) {
    const node = new TransformNode(`${name}-${j}`, scene);
    const parent = PARENT[j];
    node.parent = parent === 'Root' ? root : bones[parent];
    const off = parent === 'Root' ? R[j] : sub(R[j], R[parent]);
    node.position = new Vector3(off.x, off.y, off.z);
    node.rotationQuaternion = Quaternion.Identity();
    bones[j] = node;
  }
  const meshes: Mesh[] = [];
  for (const [bone, mesh] of merged) {
    mesh.parent = bone === 'Root' ? root : bones[bone];
    mesh.material = material;
    meshes.push(mesh);
  }

  // ---- Handle: its own object, bar along local X ----------------------------
  const hk = new Kit(scene);
  const hl = BODY.handleLength;
  hk.tube(vec3(-hl / 2, 0, 0), vec3(hl / 2, 0, 0), 0.016, 0.016, c.handle, 10);
  for (const e of [-hl / 2, hl / 2]) hk.ellipsoid(vec3(e, 0, 0), [0.04, 0.04, 0.04], c.trim);
  const handleMesh = hk.mergeByBone(`${name}-handle`, { Root: vec3() } as Record<Bone, Vec3>).get('Root')!;
  handleMesh.material = material;
  const handle = new TransformNode(`${name}-handleNode`, scene);
  handle.rotationQuaternion = Quaternion.Identity();
  handleMesh.parent = handle;
  meshes.push(handleMesh);
  return { root, bones, meshes, handle, rig };
}

const bq = (q: { x: number; y: number; z: number; w: number }, out: Quaternion): void => {
  out.set(q.x, q.y, q.z, q.w);
};

/** Pose the rider from an animation frame. */
export function applyFrame(model: CharacterModel, f: AnimFrame): void {
  model.root.position.set(f.root.pos.x, f.root.pos.y, f.root.pos.z);
  bq(f.root.rot, model.root.rotationQuaternion!);
  const R = model.rig.rest;
  for (const j of JOINTS) {
    const node = model.bones[j];
    bq(f.local[j], node.rotationQuaternion!);
    if (j === 'Hips') node.position.set(R.Hips.x + f.hipsOffset.x, R.Hips.y + f.hipsOffset.y, R.Hips.z + f.hipsOffset.z);
  }
  model.handle.position.set(f.handle.pos.x, f.handle.pos.y, f.handle.pos.z);
  bq(f.handle.rot, model.handle.rotationQuaternion!);
  model.handle.setEnabled(f.handle.visible);
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
