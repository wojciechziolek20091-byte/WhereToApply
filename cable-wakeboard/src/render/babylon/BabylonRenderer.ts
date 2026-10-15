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
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import { Scene } from '@babylonjs/core/scene';
import { boxHull, buildHullMesh, extrudeProfile, placeHulls, rockHull, type HullPart, type MeshData } from '../../art/mesh';
import { riderMesh, STUD, type RiderPalette } from '../../art/riders';
import { cablePointAt } from '../../sim/cable';
import { toeSign } from '../../sim/edge';
import { kickerHeightAt } from '../../sim/features';
import { createRng, nextFloat, nextRange } from '../../sim/math/rng';
import { clamp01 } from '../../sim/math/scalar';
import { horizontalLength, lerpVec, type Vec3 } from '../../sim/math/vec';
import type { ResolvedFeature } from '../../sim/park';
import { hipPosition } from '../../sim/step';
import type { SimState } from '../../sim/world';
import type { RenderSnapshot } from '../graybox';
import { DUSK } from './dusk';

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
 * The game in Babylon.js: faceted low-poly art (shared with the Roblox
 * builder), dusk lighting, spray, chase camera. Reads SimState; never writes it.
 */
export class BabylonRenderer {
  readonly engine: Engine;
  readonly scene: Scene;
  private readonly camera: FreeCamera;
  private readonly flat: StandardMaterial;
  private readonly sun: DirectionalLight;
  private readonly shadows: ShadowGenerator;
  private rider: Mesh;
  private readonly carrier: Mesh;
  private rope: LinesMesh;
  private readonly spray: ParticleSystem;
  private readonly sprayEmitter = new Vector3();
  private camHeading = 0;
  private camPos: Vector3 | null = null;
  private palette: RiderPalette;

  constructor(canvas: HTMLCanvasElement, sim: SimState, palette: RiderPalette) {
    this.palette = palette;
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true });
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));
    const scene = new Scene(this.engine);
    this.scene = scene;
    scene.useRightHandedSystem = true;
    scene.clearColor = Color4.FromColor3(c3(DUSK.skyTop));
    scene.ambientColor = c3(DUSK.ambient);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = DUSK.fogDensity;
    scene.fogColor = c3(DUSK.fog);

    // One flat-shaded, vertex-coloured material for all low-poly art.
    this.flat = new StandardMaterial('flat', scene);
    this.flat.diffuseColor = Color3.White();
    this.flat.specularColor = Color3.Black();
    this.flat.ambientColor = new Color3(0.35, 0.3, 0.45);

    const hemi = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
    hemi.diffuse = c3(DUSK.skyLight);
    hemi.groundColor = c3(DUSK.groundLight);
    hemi.intensity = DUSK.skyIntensity;
    const sunDir = new Vector3(...DUSK.sunDirection).normalize();
    this.sun = new DirectionalLight('sun', sunDir.scale(-1), scene);
    this.sun.diffuse = c3(DUSK.sunColor);
    this.sun.intensity = DUSK.sunIntensity;
    this.sun.position = sunDir.scale(60);
    this.shadows = new ShadowGenerator(2048, this.sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.bias = 0.002;

    this.buildSky(sunDir);
    this.buildWater(sim);
    this.buildPark(sim);

    this.rider = this.buildRider(palette);
    this.carrier = CreateBox('carrier', { width: 0.7, height: 0.35, depth: 0.4 }, scene);
    const carrierMat = new StandardMaterial('carrierMat', scene);
    carrierMat.diffuseColor = c3(DUSK.carrier);
    carrierMat.specularColor = Color3.Black();
    this.carrier.material = carrierMat;
    this.rope = CreateLines('rope', { points: [Vector3.Zero(), Vector3.Zero()], updatable: true }, scene);
    this.rope.color = c3(DUSK.rope);

    this.spray = this.buildSpray();

    this.camera = new FreeCamera('chase', new Vector3(0, 5, -10), scene);
    this.camera.fov = 0.95;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 2000;
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

  /** Gradient sky dome and a glowing low sun. */
  private buildSky(sunDir: Vector3): void {
    const sky = CreateSphere('skyDome', { diameter: 1600, segments: 24, sideOrientation: Mesh.BACKSIDE }, this.scene);
    const pos = sky.getVerticesData('position')!;
    const colors: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      const t = clamp01(pos[i + 1]! / 800);
      const c = DUSK.skyGradient(t);
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

    const sunDisc = CreateDisc('sunDisc', { radius: 28, tessellation: 10 }, this.scene);
    sunDisc.position = sunDir.scale(700);
    sunDisc.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const sunMat = new StandardMaterial('sunMat', this.scene);
    sunMat.disableLighting = true;
    sunMat.emissiveColor = c3(DUSK.sunDisc);
    sunMat.fogEnabled = false;
    sunDisc.material = sunMat;
    sunDisc.infiniteDistance = true;
    const glow = new GlowLayer('glow', this.scene, { blurKernelSize: 64 });
    glow.intensity = 0.9;
    glow.addIncludedOnlyMesh(sunDisc);
  }

  /** Faceted lake: a low-poly grid with small height jitter and colour bands. */
  private buildWater(sim: SimState): void {
    const towers = sim.cfg.cable.towers;
    const cx = towers.reduce((a, t) => a + t.x, 0) / towers.length;
    const cz = towers.reduce((a, t) => a + t.z, 0) / towers.length;
    const ground = CreateGround('lake', { width: 900, height: 700, subdivisions: 70, updatable: true }, this.scene);
    const pos = ground.getVerticesData('position')!;
    const rng = createRng(77);
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] = nextRange(rng, -0.12, 0.12);
    ground.setVerticesData('position', pos);
    ground.convertToFlatShadedMesh();
    const flatPos = ground.getVerticesData('position')!;
    const colors: number[] = [];
    for (let i = 0; i < flatPos.length; i += 9) {
      // One colour per triangle, varied a little, so the facets read.
      const k = nextRange(rng, -0.035, 0.035);
      const c = DUSK.water;
      for (let v = 0; v < 3; v++) colors.push(c[0] + k, c[1] + k, c[2] + k * 1.4, 1);
    }
    ground.setVerticesData('color', colors);
    const mat = new StandardMaterial('waterMat', this.scene);
    mat.diffuseColor = Color3.White();
    mat.specularColor = c3(DUSK.waterSpecular);
    mat.specularPower = 48;
    ground.material = mat;
    ground.position = new Vector3(cx, -0.05, cz);
    ground.receiveShadows = true;
  }

  /** Towers, cable line, features and shoreline rocks. */
  private buildPark(sim: SimState): void {
    const { cfg, path } = sim;
    const hulls: HullPart[] = [];
    const towerColor = DUSK.tower;
    for (const t of cfg.cable.towers) {
      const h = cfg.cable.cableHeight;
      hulls.push(boxHull([t.x, h / 2, t.z], [0.35, h / 2 + 0.6, 0.35], towerColor));
      hulls.push(boxHull([t.x, h + 0.5, t.z], [1.0, 0.15, 0.25], DUSK.towerTop));
      hulls.push(rockHull([t.x, 0, t.z], [2.2, 0.8, 2.2], DUSK.rock(0.3)));
    }
    for (const f of sim.features) hulls.push(...this.featureHulls(f));

    // Shoreline: a ring of faceted rocks well outside the cable loop.
    const towers = cfg.cable.towers;
    const cx = towers.reduce((a, t) => a + t.x, 0) / towers.length;
    const cz = towers.reduce((a, t) => a + t.z, 0) / towers.length;
    const rng = createRng(19);
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2 + nextRange(rng, -0.03, 0.03);
      const rx = 190 + nextRange(rng, -10, 25);
      const rz = 120 + nextRange(rng, -10, 25);
      const s = nextRange(rng, 4, 14);
      hulls.push(rockHull([cx + Math.cos(a) * rx, s * 0.15, cz + Math.sin(a) * rz], [s * nextRange(rng, 1, 2), s * nextRange(rng, 0.6, 1.4), s], DUSK.rock(nextFloat(rng))));
    }
    const park = meshFromData('park', buildHullMesh(hulls), this.scene, this.flat);
    park.receiveShadows = true;

    const pts: Vector3[] = [];
    for (let s = 0; s <= path.length + 1; s += 2) pts.push(v3(cablePointAt(path, s).pos));
    const cable = CreateLines('cable', { points: pts }, this.scene);
    cable.color = c3(DUSK.cable);
  }

  private featureHulls(f: ResolvedFeature): HullPart[] {
    const d = f.def;
    const origin: [number, number, number] = [f.origin.x, 0, f.origin.z];
    if (d.kind === 'kicker') {
      const profile: [number, number][] = [];
      for (let i = 0; i <= 10; i++) {
        const u = (d.length * i) / 10;
        profile.push([u, Math.max(0.02, kickerHeightAt(d, u).height)]);
      }
      const slices = extrudeProfile(profile, d.width, (i) => DUSK.ramp(i / 10));
      return placeHulls(slices, origin, f.heading);
    }
    const entry = extrudeProfile([[0, 0.02], [d.entryLength, d.height]], d.width, () => DUSK.ramp(0.3));
    const top = d.style === 'box'
      ? [boxHull([d.entryLength + d.length / 2, d.height / 2, 0], [d.length / 2, d.height / 2, d.width / 2], DUSK.box)]
      : [
          boxHull([d.entryLength + d.length / 2, d.height - 0.04, 0], [d.length / 2, 0.04, d.width / 2], DUSK.rail),
          boxHull([d.entryLength + 0.3, d.height / 2, 0], [0.04, d.height / 2, 0.04], DUSK.rail),
          boxHull([d.entryLength + d.length - 0.3, d.height / 2, 0], [0.04, d.height / 2, 0.04], DUSK.rail),
        ];
    return placeHulls([...entry, ...top], origin, f.heading);
  }

  /** Pastel spray off the board's tail. */
  private buildSpray(): ParticleSystem {
    const tex = new DynamicTexture('dropTex', { width: 64, height: 64 }, this.scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    tex.update();
    tex.hasAlpha = true;
    const ps = new ParticleSystem('spray', 3000, this.scene);
    ps.particleTexture = tex;
    ps.emitter = this.sprayEmitter;
    ps.minEmitBox = new Vector3(-0.15, 0, -0.15);
    ps.maxEmitBox = new Vector3(0.15, 0.05, 0.15);
    ps.color1 = new Color4(...DUSK.sprayA, 0.95);
    ps.color2 = new Color4(...DUSK.sprayB, 0.85);
    ps.colorDead = new Color4(...DUSK.sprayDead, 0);
    ps.minSize = 0.16;
    ps.maxSize = 0.46;
    // Babylon counts particle life in update steps; one step per 60 Hz frame
    // makes the lifetimes below read as seconds.
    ps.updateSpeed = 1 / 60;
    ps.minLifeTime = 0.35;
    ps.maxLifeTime = 0.9;
    ps.gravity = new Vector3(0, -9.8, 0);
    ps.minEmitPower = 2.5;
    ps.maxEmitPower = 5.5;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitRate = 0;
    ps.start();
    return ps;
  }

  /** Draw the sim, interpolated `alpha` of the way from `prev` to the current state. */
  render(sim: SimState, prev: RenderSnapshot, alpha: number, frameSeconds: number): void {
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
    this.rider.isVisible = true;

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
    const tail = { x: Math.cos(r.heading), z: Math.sin(r.heading) };
    const heel = { x: Math.sin(r.heading) * toes, z: -Math.cos(r.heading) * toes };
    const side = r.edgeAngle >= 0 ? heel : { x: -heel.x, z: -heel.z };
    this.sprayEmitter.set(riderPos.x - tail.x * 0.6 + side.x * 0.25, 0.05, riderPos.z - tail.z * 0.6 + side.z * 0.25);
    this.spray.emitRate = 1400 * intensity;
    this.spray.direction1 = new Vector3(-tail.x * 0.6 + side.x * 0.5, 1.2, -tail.z * 0.6 + side.z * 0.5);
    this.spray.direction2 = new Vector3(-tail.x * 1.2 + side.x * 1.4, 2.2, -tail.z * 1.2 + side.z * 1.4);

    // Keep the shadow camera on the rider.
    this.sun.position = v3(riderPos).add(new Vector3(...DUSK.sunDirection).normalize().scale(40));

    this.updateCamera(riderPos, carrierPos, frameSeconds);
    this.scene.render();
  }

  /** Chase camera behind the rider, looking toward the carrier. */
  private updateCamera(riderPos: Vec3, carrierPos: Vec3, dt: number): void {
    const target = Math.atan2(carrierPos.z - riderPos.z, carrierPos.x - riderPos.x);
    let d = target - this.camHeading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.camHeading += d * Math.min(1, dt * 2.5);
    const fwd = new Vector3(Math.cos(this.camHeading), 0, Math.sin(this.camHeading));
    const want = v3(riderPos).subtract(fwd.scale(8)).add(new Vector3(0, 3.2, 0));
    want.y = Math.max(want.y, 1.6);
    if (!this.camPos) this.camPos = want.clone();
    this.camPos = Vector3.Lerp(this.camPos, want, Math.min(1, dt * 6));
    this.camera.position = this.camPos;
    this.camera.setTarget(v3(riderPos).add(fwd.scale(5)).add(new Vector3(0, 1, 0)));
  }
}
