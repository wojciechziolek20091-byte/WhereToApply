import * as THREE from 'three';
import { cablePointAt } from '../sim/cable';
import { riderPose } from './pose';
import { kickerHeightAt } from '../sim/features';
import { pieceHeightAt } from '../sim/featureShapes';
import { shapeOfDef } from '../sim/park';
import { headingOf, lerpVec, sub, type Vec3 } from '../sim/math/vec';
import type { FeatureDef, ResolvedFeature } from '../sim/park';
import { hipPosition } from '../sim/step';
import type { SimState } from '../sim/world';

/** What the renderer interpolates between ticks. */
export interface RenderSnapshot {
  riderPos: Vec3;
  carrierPos: Vec3;
}

export const snapshotOf = (s: SimState): RenderSnapshot => ({ riderPos: s.rider.pos, carrierPos: s.carrier.pos });

const v3 = (p: Vec3): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);

const COLORS = {
  water: 0x5f7f99,
  tower: 0x666666,
  cable: 0x222222,
  carrier: 0xdddd55,
  rope: 0x111111,
  board: 0x303030,
  body: 0xe0e0e0,
  head: 0xc05030,
  feature: 0xb8b0a0,
  rail: 0x888888,
};

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

/** Extruded side profile along local x (u) and y (height), centred across z. */
function profileMesh(points: [number, number][], width: number, color: number): THREE.Mesh {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.translate(0, 0, -width / 2);
  return new THREE.Mesh(geo, lambert(color));
}

function featureObject(def: FeatureDef): THREE.Object3D {
  const g = new THREE.Group();
  if (def.kind === 'kicker') {
    const pts: [number, number][] = [[0, 0]];
    for (let i = 1; i <= 24; i++) {
      const u = (def.length * i) / 24;
      pts.push([u, kickerHeightAt(def, u).height]);
    }
    pts.push([def.length, 0]);
    g.add(profileMesh(pts, def.width, COLORS.feature));
    return g;
  }
  if (def.kind === 'feature') {
    // Catalogue features: each ride piece as a profile, sampled along its length.
    for (const p of shapeOfDef(def).pieces) {
      if (p.axis !== 'u') continue;
      const pts: [number, number][] = [[p.u0, -0.3]];
      for (let i = 0; i <= 12; i++) {
        const u = p.u0 + ((p.u1 - p.u0) * i) / 12;
        pts.push([u, pieceHeightAt(p, u).height]);
      }
      pts.push([p.u1, -0.3]);
      const m = profileMesh(pts, p.width, p.slide ? COLORS.rail : COLORS.feature);
      m.position.z = (p.v0 + p.v1) / 2;
      g.add(m);
    }
    return g;
  }
  const ramp: [number, number][] = [
    [0, 0],
    [def.entryLength, def.height],
    [def.entryLength, 0],
  ];
  g.add(profileMesh(ramp, def.width, COLORS.feature));
  if (def.style === 'box') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(def.length, def.height, def.width), lambert(COLORS.feature));
    box.position.set(def.entryLength + def.length / 2, def.height / 2, 0);
    g.add(box);
  } else {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(def.length, 0.08, def.width), lambert(COLORS.rail));
    rail.position.set(def.entryLength + def.length / 2, def.height - 0.04, 0);
    g.add(rail);
    for (const u of [0.3, def.length - 0.3]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, def.height, 0.08), lambert(COLORS.rail));
      post.position.set(def.entryLength + u, def.height / 2, 0);
      g.add(post);
    }
  }
  return g;
}

/**
 * Gray-box view of a SimState. Reads the sim, never writes it. Rider meshes
 * are nested groups: yaw, then invert, then edge tilt, so rotations compose
 * without Euler-order surprises. Meshes face +x, so rotation.y = -heading.
 */
export class GrayboxRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  private readonly carrier: THREE.Mesh;
  private readonly rope: THREE.Line;
  private readonly riderYaw = new THREE.Group();
  private readonly riderInvert = new THREE.Group();
  private readonly riderEdge = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private camHeading = 0;
  private camPos = new THREE.Vector3();

  constructor(container: HTMLElement, sim: SimState) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0xa9b4bd);
    this.scene.fog = new THREE.Fog(0xa9b4bd, 120, 600);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(80, 120, 40);
    this.scene.add(sun);

    this.buildPark(sim);

    this.carrier = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.4), lambert(COLORS.carrier));
    this.scene.add(this.carrier);
    const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: COLORS.rope }));
    this.scene.add(this.rope);

    const board = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.42), lambert(COLORS.board));
    board.position.y = 0.03;
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 4, 8), lambert(COLORS.body));
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), lambert(COLORS.head));
    this.riderEdge.add(board, this.body, this.head);
    this.riderInvert.add(this.riderEdge);
    this.riderYaw.add(this.riderInvert);
    this.scene.add(this.riderYaw);

    this.camHeading = sim.carrier.heading;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private buildPark(sim: SimState): void {
    const { cfg, path } = sim;
    const towers = cfg.cable.towers;
    const cx = towers.reduce((a, t) => a + t.x, 0) / towers.length;
    const cz = towers.reduce((a, t) => a + t.z, 0) / towers.length;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 700), lambert(COLORS.water));
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, 0, cz);
    this.scene.add(water);
    const grid = new THREE.GridHelper(900, 90, 0x7090a8, 0x7090a8);
    grid.position.set(cx, 0.01, cz);
    this.scene.add(grid);

    for (const t of towers) {
      const h = cfg.cable.cableHeight + 1.5;
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, h, 8), lambert(COLORS.tower));
      tower.position.set(t.x, h / 2, t.z);
      this.scene.add(tower);
    }
    const pts: THREE.Vector3[] = [];
    for (let s = 0; s <= path.length; s += 2) pts.push(v3(cablePointAt(path, s).pos));
    const cable = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: COLORS.cable }),
    );
    this.scene.add(cable);
    for (const f of sim.features) this.scene.add(this.placeFeature(f));
  }

  private placeFeature(f: ResolvedFeature): THREE.Object3D {
    const obj = featureObject(f.def);
    obj.position.copy(v3(f.origin));
    obj.rotation.y = -f.heading;
    return obj;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Draw the sim, interpolated `alpha` of the way from `prev` to the current state. */
  render(sim: SimState, prev: RenderSnapshot, alpha: number, frameSeconds: number): void {
    const r = sim.rider;
    const riderPos = lerpVec(prev.riderPos, r.pos, alpha);
    const carrierPos = lerpVec(prev.carrierPos, sim.carrier.pos, alpha);

    this.carrier.position.copy(v3(carrierPos));
    this.carrier.rotation.y = -sim.carrier.heading;

    // Board yaw, invert and lean: see pose.ts.
    const pose = riderPose(r);
    const toes = pose.toes;
    this.riderYaw.position.copy(v3(riderPos));
    this.riderYaw.rotation.y = -pose.yaw;
    this.riderInvert.quaternion.identity();
    if (pose.invert) this.riderInvert.quaternion.setFromAxisAngle(new THREE.Vector3(...pose.invert.axis).normalize(), pose.invert.angle);
    this.riderEdge.rotation.x = pose.lean - pose.toes * pose.raley * 1.6;
    this.riderInvert.position.y = 0;

    const squat = 1 - 0.3 * r.legCompression;
    this.body.scale.set(1, squat, 1);
    this.body.position.set(0, 0.06 + 0.65 * squat, 0);
    // The head leans toward the toes (the way the rider faces) and forward when hinged.
    this.head.position.set(r.waistHinge * 0.25, 0.06 + 1.35 * squat, toes * 0.12);

    if (r.handle !== 'dropped') {
      const hip = hipPosition(sim);
      const hipLerped = { x: hip.x + riderPos.x - r.pos.x, y: hip.y + riderPos.y - r.pos.y, z: hip.z + riderPos.z - r.pos.z };
      this.rope.visible = true;
      const attr = this.rope.geometry.getAttribute('position') as THREE.BufferAttribute;
      attr.setXYZ(0, carrierPos.x, carrierPos.y, carrierPos.z);
      attr.setXYZ(1, hipLerped.x, hipLerped.y, hipLerped.z);
      attr.needsUpdate = true;
      this.rope.geometry.computeBoundingSphere();
    } else {
      this.rope.visible = false;
    }

    this.updateCamera(riderPos, carrierPos, frameSeconds);
    this.renderer.render(this.scene, this.camera);
  }

  /** Chase camera behind the rider, looking toward the carrier. */
  private updateCamera(riderPos: Vec3, carrierPos: Vec3, dt: number): void {
    const target = headingOf(sub(carrierPos, riderPos));
    let d = target - this.camHeading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.camHeading += d * Math.min(1, dt * 2.5);
    const back = new THREE.Vector3(Math.cos(this.camHeading), 0, Math.sin(this.camHeading)).multiplyScalar(-11);
    const want = v3(riderPos).add(back).add(new THREE.Vector3(0, 4.5, 0));
    want.y = Math.max(want.y, 2);
    if (this.camPos.lengthSq() === 0) this.camPos.copy(want);
    this.camPos.lerp(want, Math.min(1, dt * 6));
    this.camera.position.copy(this.camPos);
    const look = v3(riderPos).add(new THREE.Vector3(Math.cos(this.camHeading) * 6, 1, Math.sin(this.camHeading) * 6));
    this.camera.lookAt(look);
  }
}
