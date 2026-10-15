// Per-module Babylon imports keep the bundle and the build small. The bare
// side-effect imports register scene components the classes rely on.
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import '@babylonjs/core/Layers/effectLayerSceneComponent';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TrailMesh } from '@babylonjs/core/Meshes/trailMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import { Scene } from '@babylonjs/core/scene';
import { boxHull, buildHullMesh, extrudeProfile, placeHulls, rockHull, type HullPart, type MeshData, type V3 } from '../../art/mesh';
import {
  centroid,
  distanceToOutline,
  distanceToPolyline,
  growRadially,
  pointInPolygon,
  TriangleBuilder,
} from '../../art/site';
import type { RiderPalette } from '../../art/riders';
import { cablePointAt } from '../../sim/cable';
import { toeSign } from '../../sim/edge';
import { kickerHeightAt } from '../../sim/features';
import { createRng, nextFloat, nextRange } from '../../sim/math/rng';
import { clamp01 } from '../../sim/math/scalar';
import { horizontalLength, lerpVec, type Vec3 } from '../../sim/math/vec';
import { type BuildingDef, DEFAULT_PARK, type DockDef, type GroundPoint, type ResolvedFeature, type SiteDef } from '../../sim/park';
import type { SimState } from '../../sim/world';
import type { RenderSnapshot } from '../graybox';
import { DAY, type Look } from './looks';
import { buildCharacter, characterMaterial, type CharacterRig } from './character';
import { applyBasis, axisAngle, basisToQuaternion, col, mulBasis, yawBasis } from './rot';

const v3 = (p: Vec3): Vector3 => new Vector3(p.x, p.y, p.z);
const c3 = (c: readonly [number, number, number]): Color3 => new Color3(c[0], c[1], c[2]);

/** Upload pure mesh arrays as a Babylon mesh with vertex colours. */
function meshFromData(name: string, data: MeshData, scene: Scene, material: StandardMaterial): Mesh {
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = data.positions;
  vd.normals = data.normals;
  vd.colors = data.colors;
  vd.indices = data.indices;
  vd.applyToMesh(mesh);
  mesh.material = material;
  return mesh;
}

/**
 * Tileable ripple texture: a sum of sine waves with whole-number wave counts
 * across the tile (so it wraps without seams), shaded as if lit from above.
 * Baked into the colour rather than a normal map, so the ripples read the
 * same on every GPU. Crests are lighter, troughs darker than `base`.
 */
function rippleTexture(scene: Scene, base: readonly [number, number, number], size = 256): DynamicTexture {
  const tex = new DynamicTexture('ripples', { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  const waves = [
    { kx: 3, ky: 1, a: 1.0, p: 0.3 },
    { kx: -2, ky: 4, a: 0.8, p: 1.7 },
    { kx: 5, ky: -3, a: 0.5, p: 2.4 },
    { kx: 1, ky: 7, a: 0.35, p: 0.9 },
    { kx: -8, ky: 5, a: 0.25, p: 4.1 },
    { kx: 11, ky: 2, a: 0.18, p: 5.3 },
  ];
  const norm = waves.reduce((acc, w) => acc + w.a * Math.hypot(w.kx, w.ky), 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Slope along a light direction gives the lit/shadowed side of each ripple.
      let slope = 0;
      let height = 0;
      for (const w of waves) {
        const ph = (2 * Math.PI * (w.kx * x + w.ky * y)) / size + w.p;
        slope += Math.cos(ph) * w.a * (0.8 * w.kx + 0.6 * w.ky);
        height += Math.sin(ph) * w.a;
      }
      const lit = slope / norm; // about -1..1
      const crest = Math.max(0, height / 2.4 - 0.55); // thin bright crest lines
      const k = 1 + 0.28 * lit + 0.9 * crest * crest;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, base[0] * k * 255);
      img.data[i + 1] = Math.min(255, base[1] * k * 255);
      img.data[i + 2] = Math.min(255, base[2] * k * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update();
  return tex;
}

/** Height of the land around the lake (m above the water). */
const LAND_Y = 0.6;

/** Upload a TriangleBuilder (vertex colours, world-metre UVs). */
function siteMesh(name: string, tb: TriangleBuilder, scene: Scene, material: StandardMaterial | null): Mesh {
  const data = tb.build();
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = data.positions;
  vd.normals = data.normals;
  vd.colors = data.colors;
  vd.uvs = data.uvs;
  vd.indices = data.indices;
  vd.applyToMesh(mesh);
  mesh.material = material;
  return mesh;
}

/** A thin square beam from a to b (convex hull of two squares). */
function beamHull(a: V3, b: V3, r: number, color: readonly [number, number, number]): HullPart {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const u: V3 = [d[0] / len, d[1] / len, d[2] / len];
  const ref: V3 = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const n1 = norm3([u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2], u[0] * ref[1] - u[1] * ref[0]]);
  const n2: V3 = [u[1] * n1[2] - u[2] * n1[1], u[2] * n1[0] - u[0] * n1[2], u[0] * n1[1] - u[1] * n1[0]];
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]] as const;
  const verts: V3[] = [];
  for (const end of [a, b]) {
    for (const [i, j] of corners) {
      verts.push([end[0] + (n1[0] * i + n2[0] * j) * r, end[1] + (n1[1] * i + n2[1] * j) * r, end[2] + (n1[2] * i + n2[2] * j) * r]);
    }
  }
  const faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return { verts, faces, color };
}

function norm3(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Walls plus a gable, flat or tent roof, turned to the building's heading. */
function buildingHulls(b: BuildingDef, look: Look): HullPart[] {
  const hw = b.width / 2;
  const hd = b.depth / 2;
  const wall = b.roof === 'tent' ? look.tent : look.walls[b.color];
  const parts: HullPart[] = [boxHull([0, b.height / 2, 0], [hw, b.height / 2, hd], wall)];
  if (b.roof === 'gable') {
    const rise = Math.min(hd, 3.2);
    const o = 0.4;
    parts.push({
      verts: [
        [-hw - o, b.height, -hd - o], [hw + o, b.height, -hd - o], [hw + o, b.height, hd + o], [-hw - o, b.height, hd + o],
        [-hw - o, b.height + rise, 0], [hw + o, b.height + rise, 0],
      ],
      faces: [[0, 1, 5, 4], [3, 2, 5, 4], [0, 4, 3], [1, 5, 2], [0, 1, 2, 3]],
      color: look.roof,
    });
  } else if (b.roof === 'tent') {
    const rise = Math.min(hw, hd) * 0.9;
    parts.push({
      verts: [[-hw - 0.2, b.height, -hd - 0.2], [hw + 0.2, b.height, -hd - 0.2], [hw + 0.2, b.height, hd + 0.2], [-hw - 0.2, b.height, hd + 0.2], [0, b.height + rise, 0]],
      faces: [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], [0, 1, 2, 3]],
      color: look.tent,
    });
  } else {
    parts.push(boxHull([0, b.height + 0.15, 0], [hw + 0.2, 0.15, hd + 0.2], look.walls.grey));
  }
  // Dark band of windows on the long sides of real buildings.
  if (b.roof !== 'tent') {
    parts.push(boxHull([0, b.height * 0.55, hd + 0.02], [hw * 0.8, b.height * 0.15, 0.03], look.roof));
    parts.push(boxHull([0, b.height * 0.55, -hd - 0.02], [hw * 0.8, b.height * 0.15, 0.03], look.roof));
  }
  return placeHulls(parts, [b.x, LAND_Y, b.z], b.heading);
}

/** The starting dock on the cable line, with a walkway out to the shore. */
function dockHulls(dock: DockDef, sim: SimState, site: SiteDef, look: Look): HullPart[] {
  const mid = cablePointAt(sim.path, dock.s + dock.length / 2);
  const right = { x: -Math.sin(mid.heading), z: Math.cos(mid.heading) };
  const cx = mid.pos.x + right.x * dock.offset;
  const cz = mid.pos.z + right.z * dock.offset;
  const parts: HullPart[] = [boxHull([0, 0.3, 0], [dock.length / 2, 0.1, dock.width / 2], look.deck)];
  // Pontoon floats under the deck.
  for (let x = -dock.length / 2 + 1; x < dock.length / 2; x += 2.5) {
    parts.push(boxHull([x, 0.02, 0], [0.4, 0.17, dock.width / 2 - 0.2], look.walls.grey));
  }
  // Walkway: from the dock's outer edge away from the line until it reaches land.
  const side = dock.offset < 0 ? -1 : 1;
  let len = 0;
  while (len < 60 && pointInPolygon({ x: cx + right.x * side * (dock.width / 2 + len), z: cz + right.z * side * (dock.width / 2 + len) }, site.lake)) len += 1;
  len += 4;
  parts.push(boxHull([0, 0.3, side * (dock.width / 2 + len / 2)], [0.8, 0.08, len / 2], look.deck));
  // A rider's bench and a flag at the start.
  parts.push(boxHull([dock.length / 2 - 2, 0.6, side * (dock.width / 2 - 0.6)], [1.4, 0.25, 0.3], look.walls.white));
  parts.push(boxHull([-dock.length / 2 + 0.5, 1.8, side * (dock.width / 2 - 0.3)], [0.05, 1.6, 0.05], look.walls.grey));
  parts.push(boxHull([-dock.length / 2 + 1.1, 3.0, side * (dock.width / 2 - 0.3)], [0.55, 0.35, 0.02], look.towerTop));
  return placeHulls(parts, [cx, 0, cz], mid.heading);
}

/** Fallback site when a park has none: a rectangle of water around the towers. */
function rectangleSite(sim: SimState): SiteDef {
  const xs = sim.cfg.cable.towers.map((t) => t.x);
  const zs = sim.cfg.cable.towers.map((t) => t.z);
  const m = 45;
  const x0 = Math.min(...xs) - m, x1 = Math.max(...xs) + m, z0 = Math.min(...zs) - m, z1 = Math.max(...zs) + m;
  return {
    lake: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }],
    islands: [],
    docks: [],
    buildings: [],
    areas: [],
    roads: [],
  };
}

/** Another rider on the cable, animated for scenery only (not simulated). */
interface GhostRider {
  mesh: Mesh;
  carrier: Mesh;
  rope: LinesMesh;
  offset: number;
  phase: number;
}


/**
 * The game in Babylon.js: faceted low-poly art (shared with the Roblox
 * builder), a lighting look (day by default), rippled water, shoreline
 * forest, spray, wake trails, other riders and a chase camera. Reads
 * SimState; never writes it.
 */
export class BabylonRenderer {
  readonly engine: Engine;
  readonly scene: Scene;
  private readonly look: Look;
  private readonly camera: FreeCamera;
  private readonly flat: StandardMaterial;
  /** Same as `flat` but double-sided, for the site's hand-built triangles. */
  private readonly siteMat: StandardMaterial;
  private readonly site: SiteDef;
  private readonly sun: DirectionalLight;
  private readonly shadows: ShadowGenerator;
  private rider: Mesh;
  private rig: CharacterRig;
  private readonly charMat: StandardMaterial;
  private readonly carrier: Mesh;
  private rope: LinesMesh;
  readonly spray: ParticleSystem;
  private readonly sprayEmitter = new Vector3();
  private readonly wakeNodes: TransformNode[] = [];
  private readonly ghosts: GhostRider[] = [];
  private waterMat: StandardMaterial | null = null;
  private camHeading = 0;
  private camPos: Vector3 | null = null;
  private palette: RiderPalette;
  private clock = 0;

  /** Fixed close-up camera for checking the character (`?cam=front|back|side`). */
  debugCam: 'front' | 'back' | 'side' | 'aerial' | 'map' | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    sim: SimState,
    palette: RiderPalette,
    look: Look = DAY,
    site: SiteDef | undefined = DEFAULT_PARK.site,
  ) {
    this.palette = palette;
    this.look = look;
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true });
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));
    const scene = new Scene(this.engine);
    this.scene = scene;
    scene.useRightHandedSystem = true;
    scene.clearColor = Color4.FromColor3(c3(look.skyTop));
    scene.ambientColor = c3(look.ambient);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = look.fogDensity;
    scene.fogColor = c3(look.fog);

    // One flat-shaded, vertex-coloured material for all low-poly art.
    this.flat = new StandardMaterial('flat', scene);
    this.flat.diffuseColor = Color3.White();
    this.flat.specularColor = Color3.Black();
    this.flat.ambientColor = new Color3(0.3, 0.3, 0.35);

    const hemi = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
    hemi.diffuse = c3(look.skyLight);
    hemi.groundColor = c3(look.groundLight);
    hemi.intensity = look.skyIntensity;
    const sunDir = new Vector3(...look.sunDirection).normalize();
    this.sun = new DirectionalLight('sun', sunDir.scale(-1), scene);
    this.sun.diffuse = c3(look.sunColor);
    this.sun.specular = c3(look.sunColor);
    this.sun.intensity = look.sunIntensity;
    this.sun.position = sunDir.scale(60);
    this.shadows = new ShadowGenerator(2048, this.sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.bias = 0.002;

    this.buildSky(sunDir);
    this.siteMat = this.flat.clone('siteMat');
    this.siteMat.backFaceCulling = false;
    const s = site ?? rectangleSite(sim);
    this.site = s;
    this.buildWater(s);
    this.buildShore(s, sim);
    this.buildPark(sim);

    this.charMat = characterMaterial(scene);
    const built = this.buildRider(palette);
    this.rider = built.mesh;
    this.rig = built.rig;
    const carrierMat = new StandardMaterial('carrierMat', scene);
    carrierMat.diffuseColor = c3(look.carrier);
    carrierMat.specularColor = Color3.Black();
    this.carrier = CreateBox('carrier', { width: 0.7, height: 0.35, depth: 0.4 }, scene);
    this.carrier.material = carrierMat;
    this.rope = CreateLines('rope', { points: [Vector3.Zero(), Vector3.Zero()], updatable: true }, scene);
    this.rope.color = c3(look.rope);
    this.buildGhosts(carrierMat);

    this.spray = this.buildSpray();
    this.buildWake(sim);

    this.camera = new FreeCamera('chase', new Vector3(0, 5, -10), scene);
    this.camera.fov = 0.95;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 3000;
    this.camHeading = sim.carrier.heading;

    window.addEventListener('resize', () => this.engine.resize());
  }

  /** Swap the rider's palette (rebuilds one mesh). */
  setPalette(palette: RiderPalette): void {
    if (palette === this.palette) return;
    this.palette = palette;
    this.shadows.removeShadowCaster(this.rider);
    this.rider.dispose();
    const built = this.buildRider(palette);
    this.rider = built.mesh;
    this.rig = built.rig;
  }

  /** The smooth character from the user's sheet (see character.ts), in metres. */
  private buildRider(palette: RiderPalette): { mesh: Mesh; rig: CharacterRig } {
    const built = buildCharacter(this.scene, palette, this.charMat);
    built.mesh.rotationQuaternion = Quaternion.Identity();
    this.shadows.addShadowCaster(built.mesh);
    return built;
  }

  /** Gradient sky dome, plus a glowing sun disc when the look wants one. */
  private buildSky(sunDir: Vector3): void {
    const sky = CreateSphere('skyDome', { diameter: 2400, segments: 24, sideOrientation: Mesh.BACKSIDE }, this.scene);
    const pos = sky.getVerticesData('position')!;
    const colors: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      const c = this.look.skyGradient(clamp01(pos[i + 1]! / 1200));
      colors.push(c[0], c[1], c[2], 1);
    }
    sky.setVerticesData('color', colors);
    const skyMat = new StandardMaterial('skyMat', this.scene);
    skyMat.disableLighting = true;
    skyMat.emissiveColor = Color3.White();
    skyMat.fogEnabled = false;
    skyMat.backFaceCulling = false;
    sky.material = skyMat;
    sky.infiniteDistance = true;
    sky.applyFog = false;
    if (!this.look.showSun) return;
    const sunDisc = CreateDisc('sunDisc', { radius: 28, tessellation: 10 }, this.scene);
    sunDisc.position = sunDir.scale(1000);
    sunDisc.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const sunMat = new StandardMaterial('sunMat', this.scene);
    sunMat.disableLighting = true;
    sunMat.emissiveColor = c3(this.look.sunDisc);
    sunMat.fogEnabled = false;
    sunDisc.material = sunMat;
    sunDisc.infiniteDistance = true;
    const glow = new GlowLayer('glow', this.scene, { blurKernelSize: 64 });
    glow.intensity = 0.9;
    glow.addIncludedOnlyMesh(sunDisc);
  }

  /** The lake (and ponds): rippled and animated (day) or static faceted (dusk). */
  private buildWater(site: SiteDef): void {
    const look = this.look;
    const ponds = site.areas.filter((a) => a.kind === 'pond');
    if (look.rippleWater) {
      const tb = new TriangleBuilder();
      tb.polygon(site.lake, 0, look.water);
      for (const p of ponds) tb.polygon(p.outline, LAND_Y - 0.12, look.water);
      const water = siteMesh('lake', tb, this.scene, null);
      const mat = new StandardMaterial('waterMat', this.scene);
      // Sun plus sky light is close to 2x; halve the diffuse so the lit water lands on the look's colour.
      mat.diffuseColor = new Color3(0.55, 0.55, 0.55);
      mat.emissiveColor = c3(look.water).scale(0.08);
      mat.specularColor = c3(look.waterSpecular).scale(0.5);
      mat.specularPower = look.waterSpecularPower;
      mat.backFaceCulling = false;
      const ripples = rippleTexture(this.scene, look.water);
      // UVs are world metres: one ripple tile every 7 m.
      ripples.uScale = 1 / 7;
      ripples.vScale = 1 / 7;
      ripples.anisotropicFilteringLevel = 8;
      mat.diffuseTexture = ripples;
      water.material = mat;
      water.receiveShadows = true;
      this.waterMat = mat;
      return;
    }
    // Dusk: a flat base, then small jittered facets wherever they fit inside the shore.
    const tb = new TriangleBuilder();
    tb.polygon(site.lake, -0.08, look.water);
    for (const p of ponds) tb.polygon(p.outline, LAND_Y - 0.12, look.water);
    const rng = createRng(77);
    const xs = site.lake.map((p) => p.x);
    const zs = site.lake.map((p) => p.z);
    const cell = 6;
    const h = (x: number, z: number) => 0.12 * Math.sin(x * 1.7 + z * 0.9) * Math.cos(z * 1.3 - x * 0.4);
    for (let x = Math.min(...xs); x < Math.max(...xs); x += cell) {
      for (let z = Math.min(...zs); z < Math.max(...zs); z += cell) {
        const q = [{ x, z }, { x: x + cell, z }, { x: x + cell, z: z + cell }, { x, z: z + cell }];
        if (!q.every((p) => pointInPolygon(p, site.lake))) continue;
        const v = q.map((p): [number, number, number] => [p.x, h(p.x, p.z), p.z]);
        const k1 = nextRange(rng, -0.035, 0.035);
        const k2 = nextRange(rng, -0.035, 0.035);
        const w = look.water;
        tb.tri(v[0]!, v[1]!, v[2]!, [w[0] + k1, w[1] + k1, w[2] + k1 * 1.4], true);
        tb.tri(v[0]!, v[2]!, v[3]!, [w[0] + k2, w[1] + k2, w[2] + k2 * 1.4], true);
      }
    }
    const water = siteMesh('lake', tb, this.scene, null);
    const mat = new StandardMaterial('waterMat', this.scene);
    mat.diffuseColor = Color3.White();
    mat.specularColor = c3(look.waterSpecular);
    mat.specularPower = look.waterSpecularPower;
    mat.backFaceCulling = false;
    water.material = mat;
    water.receiveShadows = true;
  }

  /**
   * Everything on land, from the park map: banks and lawn, the island, the
   * watch terrace, parking, fields, roads, buildings and tents, the starting
   * dock, and a forest that keeps clear of all of them.
   */
  private buildShore(site: SiteDef, sim: SimState): void {
    const look = this.look;
    const tb = new TriangleBuilder();
    // Bank: a sandy slope from the waterline up to the lawn, then land out to the horizon.
    const beachOuter = growRadially(site.lake, 4);
    tb.skirt(site.lake, -0.8, 0.08, look.beach);
    tb.band(site.lake, beachOuter, 0.08, LAND_Y, look.beach);
    tb.band(beachOuter, growRadially(site.lake, 26), LAND_Y, LAND_Y, look.lawn);
    tb.band(growRadially(site.lake, 26), growRadially(site.lake, 1200), LAND_Y, LAND_Y, look.land);

    for (const island of site.islands) {
      tb.skirt(island.outline, -0.8, island.height, look.beach);
      tb.polygon(island.outline, island.height, look.lawn);
    }
    for (const area of site.areas) {
      if (area.kind === 'field') tb.polygon(area.outline, LAND_Y + 0.02, (i) => look.field((i * 0.37) % 1));
      else if (area.kind === 'parking') tb.polygon(area.outline, LAND_Y + 0.03, look.asphalt);
      else if (area.kind === 'watch') {
        tb.polygon(area.outline, LAND_Y + 0.25, look.deck);
        tb.skirt(area.outline, -0.6, LAND_Y + 0.25, look.deck);
      } else if (area.kind === 'pond') tb.skirt(area.outline, LAND_Y - 0.4, LAND_Y + 0.01, look.beach);
    }
    for (const road of site.roads) tb.strip(road.points, road.width, LAND_Y + 0.04, look.road);
    const ground = siteMesh('ground', tb, this.scene, this.siteMat);
    ground.receiveShadows = true;

    const hulls: HullPart[] = [];
    for (const b of site.buildings) hulls.push(...buildingHulls(b, look));
    for (const dock of site.docks) hulls.push(...dockHulls(dock, sim, site, look));
    // Benches and posts along the watch terrace's water side.
    for (const area of site.areas.filter((a) => a.kind === 'watch')) {
      const half = Math.floor(area.outline.length / 2);
      for (let i = 0; i + 1 < half; i++) {
        const a = area.outline[i]!, b = area.outline[i + 1]!;
        for (let t = 0.25; t < 1; t += 0.5) {
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          const heading = Math.atan2(b.z - a.z, b.x - a.x);
          hulls.push(...placeHulls([boxHull([0, 0.45, 2.5], [1.2, 0.08, 0.3], look.deck)], [x, LAND_Y + 0.25, z], heading));
          hulls.push(boxHull([x, LAND_Y + 0.75, z], [0.06, 0.5, 0.06], look.deck));
        }
      }
    }

    // Forest: everywhere off the water that is not built on, bigger further back.
    const rng = createRng(31);
    const tree = (x: number, z: number, scale: number, base = LAND_Y) => {
      const trunkH = 2.2 * scale;
      hulls.push(boxHull([x, base + trunkH / 2, z], [0.25 * scale, trunkH / 2, 0.25 * scale], look.treeTrunk));
      const blobs = 2 + Math.floor(nextFloat(rng) * 2);
      for (let k = 0; k < blobs; k++) {
        const r = scale * nextRange(rng, 2.2, 3.4);
        const ox = nextRange(rng, -1, 1) * scale;
        const oz = nextRange(rng, -1, 1) * scale;
        const y = base + trunkH + r * (0.55 + k * 0.5);
        hulls.push(rockHull([x + ox, y, z + oz], [r * 1.1, r * nextRange(rng, 0.9, 1.3), r * 1.1], look.treeLeaves(nextFloat(rng))));
      }
    };
    const clear = (p: GroundPoint, margin: number): boolean =>
      !pointInPolygon(p, site.lake) &&
      distanceToOutline(p, site.lake) > 7 &&
      site.areas.every((a) => !pointInPolygon(p, a.outline) && distanceToOutline(p, a.outline) > margin) &&
      site.roads.every((r) => distanceToPolyline(p, r.points) > r.width / 2 + margin) &&
      site.buildings.every((b) => Math.hypot(p.x - b.x, p.z - b.z) > Math.max(b.width, b.depth) / 2 + 9 + margin);
    const c = centroid(site.lake);
    const lakeR = (dir: number) => {
      // Shore distance from the lake's centre along a direction (star-shaped outline).
      let r = 0;
      for (let t = 0; t < 400; t += 2) {
        if (pointInPolygon({ x: c.x + Math.cos(dir) * t, z: c.z + Math.sin(dir) * t }, site.lake)) r = t;
      }
      return r;
    };
    const shoreR = Array.from({ length: 72 }, (_, i) => lakeR((i / 72) * Math.PI * 2));
    const ring = (inner: number, outer: number, count: number, minS: number, maxS: number, margin: number) => {
      for (let i = 0; i < count; i++) {
        const dir = nextFloat(rng) * Math.PI * 2;
        const r = shoreR[Math.floor((dir / (Math.PI * 2)) * 72) % 72]! + nextRange(rng, inner, outer);
        const p = { x: c.x + Math.cos(dir) * r, z: c.z + Math.sin(dir) * r };
        const scale = nextRange(rng, minS, maxS);
        if (clear(p, margin)) tree(p.x, p.z, scale);
      }
    };
    ring(8, 50, 700, 0.8, 1.4, 3);
    ring(50, 170, 650, 1.2, 2.0, 2);
    for (const island of site.islands) {
      const ic = centroid(island.outline);
      for (let i = 0; i < 90; i++) {
        const p = { x: ic.x + nextRange(rng, -16, 16), z: ic.z + nextRange(rng, -40, 40) };
        if (pointInPolygon(p, island.outline) && distanceToOutline(p, island.outline) > 1.8) {
          tree(p.x, p.z, nextRange(rng, 0.7, 1.15), island.height);
        }
      }
    }
    const built = meshFromData('shore', buildHullMesh(hulls), this.scene, this.flat);
    built.receiveShadows = true;
  }

  /** Towers, cable line, features and buoys. */
  private buildPark(sim: SimState): void {
    const { cfg, path } = sim;
    const look = this.look;
    const hulls: HullPart[] = [];
    // Lattice towers like the map's: four tapering legs, cross braces, a wheel arm on top.
    for (const t of cfg.cable.towers) {
      const h = cfg.cable.cableHeight + 1;
      const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
      const at = (k: number, y: number): V3 => {
        const w = 1.3 - (1.0 * y) / h;
        return [t.x + legs[k % 4]![0] * w, y, t.z + legs[k % 4]![1] * w];
      };
      for (let k = 0; k < 4; k++) {
        hulls.push(beamHull(at(k, 0), at(k, h), 0.09, look.tower));
        for (let y = 0; y + 2 < h; y += 2.5) hulls.push(beamHull(at(k, y), at(k + 1, y + 2.5), 0.05, look.tower));
      }
      hulls.push(boxHull([t.x, h + 0.2, t.z], [1.4, 0.16, 0.3], look.towerTop));
      hulls.push(rockHull([t.x, 0, t.z], [2.4, 0.6, 2.4], look.rock(0.4)));
    }
    for (const f of sim.features) hulls.push(...this.featureHulls(f));

    // Buoys: white domes with a short mast around the course, wherever there is open water.
    const site = this.site;
    const open = (x: number, z: number) =>
      pointInPolygon({ x, z }, site.lake) &&
      distanceToOutline({ x, z }, site.lake) > 4 &&
      site.islands.every((i) => !pointInPolygon({ x, z }, i.outline) && distanceToOutline({ x, z }, i.outline) > 4) &&
      sim.features.every((f) => Math.hypot(f.origin.x - x, f.origin.z - z) > 14);
    const rng = createRng(5);
    for (let i = 0; i < 20; i++) {
      const p = cablePointAt(path, (i / 20) * path.length + 20);
      const off = (i % 2 === 0 ? nextRange(rng, 14, 18) : -nextRange(rng, 8, 10));
      const x = p.pos.x - Math.sin(p.heading) * off;
      const z = p.pos.z + Math.cos(p.heading) * off;
      if (!open(x, z)) continue;
      hulls.push(rockHull([x, 0, z], [1.5, 0.75, 1.5], look.buoy));
      hulls.push(boxHull([x, 0.6, z], [0.05, 0.4, 0.05], look.buoy));
    }
    for (let i = 0; i < 10; i++) {
      const p = cablePointAt(path, (i / 10) * path.length + 45);
      hulls.push(rockHull([p.pos.x, 0, p.pos.z], [0.5, 0.45, 0.5], i % 2 === 0 ? [0.85, 0.15, 0.15] : [0.12, 0.2, 0.6]));
    }
    const park = meshFromData('park', buildHullMesh(hulls), this.scene, this.flat);
    park.receiveShadows = true;

    const pts: Vector3[] = [];
    for (let s = 0; s <= path.length + 1; s += 2) pts.push(v3(cablePointAt(path, s).pos));
    const cable = CreateLines('cable', { points: pts }, this.scene);
    cable.color = c3(look.cable);
  }

  private featureHulls(f: ResolvedFeature): HullPart[] {
    const d = f.def;
    const look = this.look;
    const origin: [number, number, number] = [f.origin.x, 0, f.origin.z];
    if (d.kind === 'kicker') {
      const profile: [number, number][] = [];
      for (let i = 0; i <= 10; i++) {
        const u = (d.length * i) / 10;
        profile.push([u, Math.max(0.02, kickerHeightAt(d, u).height)]);
      }
      // White riding surface, blue side panels (as in the park photo), a float under the lip.
      const ramp = extrudeProfile(profile, d.width, (i) => look.ramp(i / 10));
      const sides = [-1, 1].flatMap((side) =>
        extrudeProfile(profile, 0.08, () => look.kickerSide).map((h) => ({
          ...h,
          verts: h.verts.map(([x, y, z]): V3 => [x, y + 0.01, z + side * (d.width / 2 + 0.04)]),
        })),
      );
      const float = boxHull([d.length / 2, -0.1, 0], [d.length / 2 + 0.2, 0.18, d.width / 2 + 0.25], look.kickerSide);
      return placeHulls([...ramp, ...sides, float], origin, f.heading);
    }
    const entry = extrudeProfile([[0, 0.02], [d.entryLength, d.height]], Math.max(d.width, 0.6), () => look.ramp(0.3));
    const top = d.style === 'box'
      ? [boxHull([d.entryLength + d.length / 2, d.height / 2, 0], [d.length / 2, d.height / 2, d.width / 2], look.box)]
      : [
          boxHull([d.entryLength + d.length / 2, d.height - 0.06, 0], [d.length / 2, 0.06, d.width / 2 + 0.04], look.rail),
          boxHull([d.entryLength + 0.3, d.height / 2, 0], [0.05, d.height / 2, 0.05], look.rail),
          boxHull([d.entryLength + d.length - 0.3, d.height / 2, 0], [0.05, d.height / 2, 0.05], look.rail),
          // Floating pontoon under the rail.
          boxHull([d.entryLength + d.length / 2, 0, 0], [d.length / 2 + 0.3, 0.12, 0.7], look.kickerSide),
        ];
    return placeHulls([...entry, ...top], origin, f.heading);
  }

  /** Three other riders spaced around the loop, each on its own carrier. */
  private buildGhosts(carrierMat: StandardMaterial): void {
    const palettes: RiderPalette[] = ['A', 'B', 'A'];
    palettes.forEach((pal, k) => {
      const mesh = buildCharacter(this.scene, pal, this.charMat).mesh;
      mesh.name = `ghost${k}`;
      mesh.rotationQuaternion = Quaternion.Identity();
      const carrier = CreateBox(`ghostCarrier${k}`, { width: 0.7, height: 0.35, depth: 0.4 }, this.scene);
      carrier.material = carrierMat;
      const rope = CreateLines(`ghostRope${k}`, { points: [Vector3.Zero(), Vector3.Zero()], updatable: true }, this.scene);
      rope.color = c3(this.look.rope);
      this.ghosts.push({ mesh, carrier, rope, offset: (k + 1) / (palettes.length + 1), phase: k * 2.1 });
    });
  }

  private updateGhosts(sim: SimState): void {
    const { path } = sim;
    const back = 15.5;
    for (const g of this.ghosts) {
      const s = sim.carrier.s + g.offset * path.length;
      const cp = cablePointAt(path, s);
      g.carrier.position = v3(cp.pos);
      g.carrier.rotationQuaternion = basisToQuaternion(yawBasis(cp.heading));
      const rp = cablePointAt(path, s - back);
      // Sway out and back across the line, carving like a rider would.
      const t = this.clock * 0.32 + g.phase;
      const sway = Math.sin(t) * 7;
      const swayRate = Math.cos(t) * 7 * 0.32;
      const heading = rp.heading + Math.atan2(swayRate, sim.cfg.cable.carrierSpeed);
      const x = rp.pos.x - Math.sin(rp.heading) * sway;
      const z = rp.pos.z + Math.cos(rp.heading) * sway;
      g.mesh.position = new Vector3(x, 0, z);
      const edge = -Math.sign(swayRate) * 0.45 * Math.min(1, Math.abs(swayRate) / 1.5);
      g.mesh.rotationQuaternion = basisToQuaternion(mulBasis(yawBasis(heading), axisAngle(col(1, 0, 0), -edge)));
      g.rope = CreateLines(g.rope.name, { points: [v3(cp.pos), new Vector3(x, 0.8, z)], instance: g.rope });
    }
  }

  /** White droplets off the board's tail. */
  private buildSpray(): ParticleSystem {
    const tex = new DynamicTexture('dropTex', { width: 64, height: 64 }, this.scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(28, 26, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.75, 'rgba(232,242,246,1)');
    g.addColorStop(0.9, 'rgba(210,226,232,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    tex.update();
    tex.hasAlpha = true;
    const look = this.look;
    const ps = new ParticleSystem('spray', 3000, this.scene);
    ps.particleTexture = tex;
    ps.emitter = this.sprayEmitter;
    ps.minEmitBox = new Vector3(-0.15, 0, -0.15);
    ps.maxEmitBox = new Vector3(0.15, 0.05, 0.15);
    ps.color1 = new Color4(...look.sprayA, 1);
    ps.color2 = new Color4(...look.sprayB, 0.95);
    ps.colorDead = new Color4(...look.sprayDead, 0);
    ps.minSize = 0.12;
    ps.maxSize = 0.34;
    // Babylon counts particle life in update steps; one step per 60 Hz frame
    // makes the lifetimes below read as seconds.
    ps.updateSpeed = 1 / 60;
    ps.minLifeTime = 0.4;
    ps.maxLifeTime = 1.0;
    ps.gravity = new Vector3(0, -9.8, 0);
    ps.minEmitPower = 2.5;
    ps.maxEmitPower = 5.5;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitRate = 0;
    ps.start();
    return ps;
  }

  /** Two wake lines trailing from the board's rails. */
  private buildWake(sim: SimState): void {
    const mat = new StandardMaterial('wakeMat', this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = c3(this.look.wake);
    mat.alpha = 0.5;
    for (let i = 0; i < 2; i++) {
      const node = new TransformNode(`wakeNode${i}`, this.scene);
      // Start the trail under the rider, not at the origin (which would draw a line across the lake).
      node.position.set(sim.rider.pos.x, 0.02, sim.rider.pos.z);
      this.wakeNodes.push(node);
      const trail = new TrailMesh(`wake${i}`, node, this.scene, 0.09, 110, true);
      trail.material = mat;
    }
  }

  /** Draw the sim, interpolated `alpha` of the way from `prev` to the current state. */
  render(sim: SimState, prev: RenderSnapshot, alpha: number, frameSeconds: number): void {
    this.clock += frameSeconds;
    const r = sim.rider;
    const riderPos = lerpVec(prev.riderPos, r.pos, alpha);
    const carrierPos = lerpVec(prev.carrierPos, sim.carrier.pos, alpha);
    this.carrier.position = v3(carrierPos);
    this.carrier.rotationQuaternion = basisToQuaternion(yawBasis(sim.carrier.heading));

    // Rider orientation: yaw (travel + spin or rail angle), then invert, then edge tilt.
    const toes = toeSign({ stance: r.stance, switchStance: r.air?.takeoffSwitch ?? r.switchStance });
    let yaw = r.heading;
    if (r.air) yaw += r.air.spinAngle;
    if (r.jib) yaw += r.jib.boardAngle;
    let basis = yawBasis(yaw);
    if (r.air && r.air.flipDir !== 0) {
      const axis = r.air.axis === 'flip' ? col(1, 0, 0) : col(1 / Math.SQRT2, 1 / Math.SQRT2, 0);
      const sign = r.air.flipDir < 0 ? -toes : toes;
      basis = mulBasis(basis, axisAngle(axis, sign * r.air.flipAngle));
    }
    const raley = r.air ? r.air.raleyExtension : 0;
    // Rotating +a about X lifts the -Z side. The heel is on -toes, so a heelside
    // edge (positive) dips the heel with -toes * edge; a raley leans the same way.
    basis = mulBasis(basis, axisAngle(col(1, 0, 0), -toes * (r.edgeAngle + raley * 1.3)));
    this.rider.position = v3(riderPos);
    this.rider.rotationQuaternion = basisToQuaternion(basis);
    // Mirror across the travel axis when the toes point left (goofy or switch).
    const squat = 1 - 0.12 * r.legCompression;
    this.rider.scaling = new Vector3(1, squat, toes);

    // Rope from the carrier to the handle in the rider's hands.
    if (r.hasHandle) {
      const h = this.rig.handle;
      const local = applyBasis(basis, { x: h.x, y: h.y * squat, z: h.z * toes });
      const handle = new Vector3(riderPos.x + local.x, riderPos.y + local.y, riderPos.z + local.z);
      this.rope = CreateLines('rope', { points: [v3(carrierPos), handle], instance: this.rope });
      this.rope.isVisible = true;
    } else {
      this.rope.isVisible = false;
    }

    // Spray: strongest when carving hard at speed on the water.
    const onWater = r.mode === 'riding' || r.mode === 'fallen';
    const speed = horizontalLength(r.vel);
    const intensity = onWater ? clamp01((speed - 3) / 10) * (0.35 + 0.65 * clamp01(r.edgeLoad / 1400)) : 0;
    const fwd = { x: Math.cos(r.heading), z: Math.sin(r.heading) };
    const right = { x: -Math.sin(r.heading), z: Math.cos(r.heading) };
    const heel = { x: -right.x * toes, z: -right.z * toes };
    const side = r.edgeAngle >= 0 ? heel : { x: -heel.x, z: -heel.z };
    this.sprayEmitter.set(riderPos.x - fwd.x * 0.6 + side.x * 0.25, 0.05, riderPos.z - fwd.z * 0.6 + side.z * 0.25);
    this.spray.emitRate = 1400 * intensity;
    this.spray.direction1 = new Vector3(-fwd.x * 0.6 + side.x * 0.5, 1.2, -fwd.z * 0.6 + side.z * 0.5);
    this.spray.direction2 = new Vector3(-fwd.x * 1.2 + side.x * 1.4, 2.2, -fwd.z * 1.2 + side.z * 1.4);

    // Wake lines follow the board's rails at the waterline.
    this.wakeNodes.forEach((node, i) => {
      const s = i === 0 ? 1 : -1;
      node.position.set(riderPos.x - fwd.x * 0.55 + right.x * 0.3 * s, 0.02, riderPos.z - fwd.z * 0.55 + right.z * 0.3 * s);
    });

    // Ripples drift slowly.
    const ripples = this.waterMat?.diffuseTexture as DynamicTexture | null | undefined;
    if (ripples) {
      ripples.uOffset = (this.clock * 0.012) % 1;
      ripples.vOffset = (this.clock * 0.007) % 1;
    }

    this.updateGhosts(sim);

    // Keep the shadow camera on the rider.
    this.sun.position = v3(riderPos).add(new Vector3(...this.look.sunDirection).normalize().scale(40));

    if (this.debugCam === 'aerial' || this.debugCam === 'map') this.aerialCamera(this.debugCam === 'map');
    else if (this.debugCam) this.closeUpCamera(riderPos, r.heading, toes);
    else this.updateCamera(riderPos, carrierPos, frameSeconds);
    this.scene.render();
  }

  /**
   * Drone view of the whole park from the south, like the park photo
   * (`?cam=aerial`), or straight down with north up, like the map (`?cam=map`).
   */
  private aerialCamera(topDown: boolean): void {
    const c = centroid(this.site.lake);
    // Fog is tuned for the chase camera; from the air it would hide the park.
    this.scene.fogDensity = this.look.fogDensity * 0.3;
    if (topDown) {
      this.camera.position.set(c.x, 330, c.z + 0.01);
      this.camera.setTarget(new Vector3(c.x, 0, c.z));
      return;
    }
    this.camera.position.set(c.x - 10, 190, c.z + 230);
    this.camera.setTarget(new Vector3(c.x, 0, c.z - 10));
  }

  /** Close-up of the rider: front faces the rider's chest (toe side). */
  private closeUpCamera(riderPos: Vec3, heading: number, toes: number): void {
    const f = { x: Math.cos(heading), z: Math.sin(heading) };
    const toe = { x: -Math.sin(heading) * toes, z: Math.cos(heading) * toes };
    const dir = this.debugCam === 'front' ? toe : this.debugCam === 'back' ? { x: -toe.x, z: -toe.z } : f;
    this.camera.position = new Vector3(riderPos.x + dir.x * 3.2, riderPos.y + 1.0, riderPos.z + dir.z * 3.2);
    this.camera.setTarget(new Vector3(riderPos.x, riderPos.y + 0.85, riderPos.z));
  }

  /** Chase camera low behind the rider, looking toward the carrier. */
  private updateCamera(riderPos: Vec3, carrierPos: Vec3, dt: number): void {
    const target = Math.atan2(carrierPos.z - riderPos.z, carrierPos.x - riderPos.x);
    let d = target - this.camHeading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.camHeading += d * Math.min(1, dt * 2.5);
    const fwd = new Vector3(Math.cos(this.camHeading), 0, Math.sin(this.camHeading));
    const want = v3(riderPos).subtract(fwd.scale(9)).add(new Vector3(0, 3.4, 0));
    want.y = Math.max(want.y, 1.6);
    if (!this.camPos) this.camPos = want.clone();
    this.camPos = Vector3.Lerp(this.camPos, want, Math.min(1, dt * 6));
    this.camera.position = this.camPos;
    this.camera.setTarget(v3(riderPos).add(fwd.scale(8)).add(new Vector3(0, 1.2, 0)));
  }
}
