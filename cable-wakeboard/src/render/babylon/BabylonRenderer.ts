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
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
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
import { boxHull, buildHullMesh, extrudeProfile, placeHulls, rockHull, type HullPart, type MeshData } from '../../art/mesh';
import { riderMesh, STUD, type RiderPalette } from '../../art/riders';
import { cablePointAt } from '../../sim/cable';
import { toeSign } from '../../sim/edge';
import { kickerHeightAt } from '../../sim/features';
import { createRng, nextFloat, nextRange, type RngState } from '../../sim/math/rng';
import { clamp01 } from '../../sim/math/scalar';
import { horizontalLength, lerpVec, type Vec3 } from '../../sim/math/vec';
import type { ResolvedFeature } from '../../sim/park';
import { hipPosition } from '../../sim/step';
import type { SimState } from '../../sim/world';
import type { RenderSnapshot } from '../graybox';
import { DAY, type Look } from './looks';

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

/** 3x3 rotation as world-space images of the local axes (columns). */
type Basis = [Vec3, Vec3, Vec3];
const col = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const mulBasis = (a: Basis, b: Basis): Basis =>
  b.map((v) => col(
    a[0].x * v.x + a[1].x * v.y + a[2].x * v.z,
    a[0].y * v.x + a[1].y * v.y + a[2].y * v.z,
    a[0].z * v.x + a[1].z * v.y + a[2].z * v.z,
  )) as Basis;
/** Right-handed rotation by `angle` about unit axis `k` (Rodrigues). */
function axisAngle(k: Vec3, angle: number): Basis {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const rot = (v: Vec3): Vec3 => {
    const d = k.x * v.x + k.y * v.y + k.z * v.z;
    const cx = k.y * v.z - k.z * v.y, cy = k.z * v.x - k.x * v.z, cz = k.x * v.y - k.y * v.x;
    return col(v.x * c + cx * s + k.x * d * t, v.y * c + cy * s + k.y * d * t, v.z * c + cz * s + k.z * d * t);
  };
  return [rot(col(1, 0, 0)), rot(col(0, 1, 0)), rot(col(0, 0, 1))];
}
/** Sim heading as a basis: local X along travel, Z to the right of travel. */
const yawBasis = (psi: number): Basis => [col(Math.cos(psi), 0, Math.sin(psi)), col(0, 1, 0), col(-Math.sin(psi), 0, Math.cos(psi))];
/** Babylon uses row vectors, so the basis vectors are the matrix rows. */
const basisToQuaternion = (b: Basis): Quaternion =>
  Quaternion.FromRotationMatrix(
    Matrix.FromValues(b[0].x, b[0].y, b[0].z, 0, b[1].x, b[1].y, b[1].z, 0, b[2].x, b[2].y, b[2].z, 0, 0, 0, 0, 1),
  );

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

/** Another rider on the cable, animated for scenery only (not simulated). */
interface GhostRider {
  mesh: Mesh;
  carrier: Mesh;
  rope: LinesMesh;
  offset: number;
  phase: number;
}

type LakeBounds = { x0: number; x1: number; z0: number; z1: number };

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
  private readonly sun: DirectionalLight;
  private readonly shadows: ShadowGenerator;
  private rider: Mesh;
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

  constructor(canvas: HTMLCanvasElement, sim: SimState, palette: RiderPalette, look: Look = DAY) {
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
    const lake = this.lakeBounds(sim);
    this.buildWater(lake);
    this.buildShore(lake);
    this.buildPark(sim);

    this.rider = this.buildRider(palette);
    const carrierMat = new StandardMaterial('carrierMat', scene);
    carrierMat.diffuseColor = c3(look.carrier);
    carrierMat.specularColor = Color3.Black();
    this.carrier = CreateBox('carrier', { width: 0.7, height: 0.35, depth: 0.4 }, scene);
    this.carrier.material = carrierMat;
    this.rope = CreateLines('rope', { points: [Vector3.Zero(), Vector3.Zero()], updatable: true }, scene);
    this.rope.color = c3(look.rope);
    this.buildGhosts(carrierMat);

    this.spray = this.buildSpray();
    this.buildWake();

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
    this.rider = this.buildRider(palette);
  }

  private buildRider(palette: RiderPalette): Mesh {
    const mesh = meshFromData(`rider-${palette}`, riderMesh(palette), this.scene, this.flat);
    mesh.rotationQuaternion = Quaternion.Identity();
    this.shadows.addShadowCaster(mesh);
    return mesh;
  }

  /** Lake rectangle: the cable loop plus a margin of open water. */
  private lakeBounds(sim: SimState): LakeBounds {
    const xs = sim.cfg.cable.towers.map((t) => t.x);
    const zs = sim.cfg.cable.towers.map((t) => t.z);
    const m = 45;
    return { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, z0: Math.min(...zs) - m, z1: Math.max(...zs) + m };
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

  /** The lake: rippled and animated (day) or static faceted (dusk). */
  private buildWater(lake: LakeBounds): void {
    const w = lake.x1 - lake.x0;
    const h = lake.z1 - lake.z0;
    const look = this.look;
    if (look.rippleWater) {
      const water = CreateGround('lake', { width: w, height: h, subdivisions: 1 }, this.scene);
      water.position = new Vector3((lake.x0 + lake.x1) / 2, 0, (lake.z0 + lake.z1) / 2);
      const mat = new StandardMaterial('waterMat', this.scene);
      // Sun plus sky light is close to 2x; halve the diffuse so the lit water lands on the look's colour.
      mat.diffuseColor = new Color3(0.55, 0.55, 0.55);
      mat.emissiveColor = c3(look.water).scale(0.08);
      mat.specularColor = c3(look.waterSpecular).scale(0.5);
      mat.specularPower = look.waterSpecularPower;
      const ripples = rippleTexture(this.scene, look.water);
      ripples.uScale = w / 7;
      ripples.vScale = h / 7;
      ripples.anisotropicFilteringLevel = 8;
      mat.diffuseTexture = ripples;
      water.material = mat;
      water.receiveShadows = true;
      this.waterMat = mat;
      return;
    }
    const ground = CreateGround('lake', { width: w, height: h, subdivisions: 50, updatable: true }, this.scene);
    const pos = ground.getVerticesData('position')!;
    const rng = createRng(77);
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] = nextRange(rng, -0.12, 0.12);
    ground.setVerticesData('position', pos);
    ground.convertToFlatShadedMesh();
    const flatPos = ground.getVerticesData('position')!;
    const colors: number[] = [];
    for (let i = 0; i < flatPos.length; i += 9) {
      const k = nextRange(rng, -0.035, 0.035);
      for (let v = 0; v < 3; v++) colors.push(look.water[0] + k, look.water[1] + k, look.water[2] + k * 1.4, 1);
    }
    ground.setVerticesData('color', colors);
    const mat = new StandardMaterial('waterMat', this.scene);
    mat.diffuseColor = Color3.White();
    mat.specularColor = c3(look.waterSpecular);
    mat.specularPower = look.waterSpecularPower;
    ground.material = mat;
    ground.position = new Vector3((lake.x0 + lake.x1) / 2, -0.05, (lake.z0 + lake.z1) / 2);
    ground.receiveShadows = true;
  }

  /** Land around the lake, a beach strip and a dense low-poly forest. */
  private buildShore(lake: LakeBounds): void {
    const look = this.look;
    const hulls: HullPart[] = [];
    const far = 900;
    const top = 0.5;
    const cx = (lake.x0 + lake.x1) / 2;
    const cz = (lake.z0 + lake.z1) / 2;
    const halfW = (lake.x1 - lake.x0) / 2;
    const halfH = (lake.z1 - lake.z0) / 2;
    // Four land slabs framing the lake.
    hulls.push(boxHull([cx, top / 2 - 0.5, lake.z0 - far / 2], [far, top / 2 + 0.5, far / 2], look.land));
    hulls.push(boxHull([cx, top / 2 - 0.5, lake.z1 + far / 2], [far, top / 2 + 0.5, far / 2], look.land));
    hulls.push(boxHull([lake.x0 - far / 2, top / 2 - 0.5, cz], [far / 2, top / 2 + 0.5, halfH], look.land));
    hulls.push(boxHull([lake.x1 + far / 2, top / 2 - 0.5, cz], [far / 2, top / 2 + 0.5, halfH], look.land));
    // Beach strip along the water's edge.
    const b = 5;
    hulls.push(boxHull([cx, 0.12, lake.z0 - b / 2], [halfW + b, 0.32, b / 2], look.beach));
    hulls.push(boxHull([cx, 0.12, lake.z1 + b / 2], [halfW + b, 0.32, b / 2], look.beach));
    hulls.push(boxHull([lake.x0 - b / 2, 0.12, cz], [b / 2, 0.32, halfH], look.beach));
    hulls.push(boxHull([lake.x1 + b / 2, 0.12, cz], [b / 2, 0.32, halfH], look.beach));

    // Forest: trees in a band around the lake, bigger further back.
    const rng = createRng(31);
    const tree = (x: number, z: number, scale: number) => {
      const trunkH = 2.2 * scale;
      hulls.push(boxHull([x, top + trunkH / 2, z], [0.25 * scale, trunkH / 2, 0.25 * scale], look.treeTrunk));
      const blobs = 2 + Math.floor(nextFloat(rng) * 2);
      for (let k = 0; k < blobs; k++) {
        const r = scale * nextRange(rng, 2.2, 3.4);
        const ox = nextRange(rng, -1, 1) * scale;
        const oz = nextRange(rng, -1, 1) * scale;
        const y = top + trunkH + r * (0.55 + k * 0.5);
        hulls.push(rockHull([x + ox, y, z + oz], [r * 1.1, r * nextRange(rng, 0.9, 1.3), r * 1.1], look.treeLeaves(nextFloat(rng))));
      }
    };
    const ring = (inner: number, outer: number, count: number, minS: number, maxS: number, r: RngState) => {
      for (let i = 0; i < count; i++) {
        const side = Math.floor(nextFloat(r) * 4);
        const d = nextRange(r, inner, outer);
        let x: number, z: number;
        if (side === 0) { x = nextRange(r, lake.x0 - outer, lake.x1 + outer); z = lake.z0 - d; }
        else if (side === 1) { x = nextRange(r, lake.x0 - outer, lake.x1 + outer); z = lake.z1 + d; }
        else if (side === 2) { x = lake.x0 - d; z = nextRange(r, lake.z0, lake.z1); }
        else { x = lake.x1 + d; z = nextRange(r, lake.z0, lake.z1); }
        tree(x, z, nextRange(r, minS, maxS));
      }
    };
    ring(9, 45, 520, 0.8, 1.4, rng);
    ring(45, 140, 420, 1.2, 2.0, rng);
    const shore = meshFromData('shore', buildHullMesh(hulls), this.scene, this.flat);
    shore.receiveShadows = true;
  }

  /** Towers, cable line, features and buoys. */
  private buildPark(sim: SimState): void {
    const { cfg, path } = sim;
    const look = this.look;
    const hulls: HullPart[] = [];
    for (const t of cfg.cable.towers) {
      const h = cfg.cable.cableHeight;
      hulls.push(boxHull([t.x, h / 2, t.z], [0.3, h / 2 + 0.8, 0.3], look.tower));
      hulls.push(boxHull([t.x, h + 0.5, t.z], [1.1, 0.16, 0.26], look.towerTop));
      hulls.push(rockHull([t.x, 0, t.z], [2.0, 0.7, 2.0], look.rock(0.4)));
    }
    for (const f of sim.features) hulls.push(...this.featureHulls(f));

    // Buoys: white domes with a short mast around the course, red and blue markers on the line.
    const rng = createRng(5);
    for (let i = 0; i < 16; i++) {
      const p = cablePointAt(path, (i / 16) * path.length + 20);
      const off = nextRange(rng, 16, 28) * (i % 2 === 0 ? 1 : -1);
      const x = p.pos.x - Math.sin(p.heading) * off;
      const z = p.pos.z + Math.cos(p.heading) * off;
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
      return placeHulls(extrudeProfile(profile, d.width, (i) => look.ramp(i / 10)), origin, f.heading);
    }
    const entry = extrudeProfile([[0, 0.02], [d.entryLength, d.height]], d.width, () => look.ramp(0.3));
    const top = d.style === 'box'
      ? [boxHull([d.entryLength + d.length / 2, d.height / 2, 0], [d.length / 2, d.height / 2, d.width / 2], look.box)]
      : [
          boxHull([d.entryLength + d.length / 2, d.height - 0.04, 0], [d.length / 2, 0.04, d.width / 2], look.rail),
          boxHull([d.entryLength + 0.3, d.height / 2, 0], [0.04, d.height / 2, 0.04], look.rail),
          boxHull([d.entryLength + d.length - 0.3, d.height / 2, 0], [0.04, d.height / 2, 0.04], look.rail),
        ];
    return placeHulls([...entry, ...top], origin, f.heading);
  }

  /** Three other riders spaced around the loop, each on its own carrier. */
  private buildGhosts(carrierMat: StandardMaterial): void {
    const palettes: RiderPalette[] = ['A', 'B', 'A'];
    palettes.forEach((pal, k) => {
      const mesh = meshFromData(`ghost${k}`, riderMesh(pal), this.scene, this.flat);
      mesh.rotationQuaternion = Quaternion.Identity();
      mesh.scaling = new Vector3(STUD, STUD, STUD);
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
      g.rope = CreateLines(g.rope.name, { points: [v3(cp.pos), new Vector3(x, 1.0, z)], instance: g.rope });
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
  private buildWake(): void {
    const mat = new StandardMaterial('wakeMat', this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = c3(this.look.wake);
    mat.alpha = 0.5;
    for (let i = 0; i < 2; i++) {
      const node = new TransformNode(`wakeNode${i}`, this.scene);
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
    this.rider.scaling = new Vector3(STUD, STUD * squat, STUD * toes);

    // Rope from carrier to hips.
    if (r.hasHandle) {
      const hip = hipPosition(sim);
      const hipLerped = new Vector3(hip.x + riderPos.x - r.pos.x, hip.y + riderPos.y - r.pos.y, hip.z + riderPos.z - r.pos.z);
      this.rope = CreateLines('rope', { points: [v3(carrierPos), hipLerped], instance: this.rope });
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

    this.updateCamera(riderPos, carrierPos, frameSeconds);
    this.scene.render();
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
