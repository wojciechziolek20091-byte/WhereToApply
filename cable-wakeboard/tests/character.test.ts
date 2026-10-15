import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { createAnimator, stepAnimator } from '../src/anim/animator';
import { MIRROR } from '../src/anim/skeleton';
import { baseAnimState, playTo, SCENARIOS } from '../src/anim/testDriver';
import { RIDER_PALETTES } from '../src/art/riders';
import { distance, vec3 } from '../src/sim/math/vec';
import { applyFrame, buildCharacter, characterMaterial, characterRig, solveJoint } from '../src/render/babylon/character';

describe('two-bone IK', () => {
  it('keeps both bone lengths and bends toward the pole', () => {
    const a = vec3(0, 1, 0);
    const c = vec3(0, 0.2, 0.1);
    const j = solveJoint(a, c, 0.45, 0.44, vec3(0, 0, 1));
    expect(distance(a, j)).toBeCloseTo(0.45, 6);
    expect(distance(j, c)).toBeCloseTo(0.44, 6);
    expect(j.z).toBeGreaterThan(0.1);
  });

  it('straightens toward an out-of-reach target', () => {
    const j = solveJoint(vec3(0, 0, 0), vec3(0, 5, 0), 1, 1, vec3(1, 0, 0));
    expect(j.y).toBeCloseTo(1, 3);
    expect(Math.abs(j.x)).toBeLessThan(0.01);
  });
});

describe('character', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const material = characterMaterial(scene);

  it('has a mirror-symmetric rest skeleton', () => {
    const rig = characterRig();
    for (const [j, m] of Object.entries(MIRROR)) {
      const a = rig.rest[j as keyof typeof MIRROR];
      const b = rig.rest[m];
      expect(a.x).toBeCloseTo(-b.x, 9);
      expect(a.y).toBeCloseTo(b.y, 9);
      expect(a.z).toBeCloseTo(b.z, 9);
    }
  });

  it.each(RIDER_PALETTES)('palette %s builds a jointed rider of rider size', (palette) => {
    const model = buildCharacter(scene, palette, material);
    let min = new Vector3(Infinity, Infinity, Infinity);
    let max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const m of model.meshes) {
      if (m.parent === model.handle) continue;
      m.computeWorldMatrix(true);
      m.refreshBoundingInfo();
      const bb = m.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, bb.minimumWorld);
      max = Vector3.Maximize(max, bb.maximumWorld);
      const pos = m.getVerticesData('position')!;
      expect(pos.every((v) => Number.isFinite(v))).toBe(true);
      expect(m.getVerticesData('color')!.length / 4).toBe(pos.length / 3);
    }
    // Standing at rest, helmet included; the board dominates the X extent.
    expect(max.y - min.y).toBeGreaterThan(1.55);
    expect(max.y - min.y).toBeLessThan(1.85);
    expect(max.x - min.x).toBeGreaterThan(1.3);
    expect(max.x - min.x).toBeLessThan(1.5);
    // One mesh per bone that has parts, plus the board root and the handle.
    expect(model.meshes.length).toBeGreaterThanOrEqual(14);
    model.handle.dispose();
    model.root.dispose();
  });

  it('places nodes where the animator says joints are (Babylon quaternions match anim/quat)', () => {
    const model = buildCharacter(scene, 'Sheet', material);
    const a = createAnimator(model.rig);
    const origin = { x: 3, y: 0, z: -2 };
    for (const [name, u] of [['Heelside', 0.8], ['FrontFlip', 0.4], ['Indy', 0.5], ['Backboard', 0.3]] as const) {
      const f = playTo(a, SCENARIOS[name]!, u, origin);
      applyFrame(model, f);
      for (const j of ['LWrist', 'RAnkle', 'Neck', 'LKnee'] as const) {
        const n = model.bones[j];
        n.computeWorldMatrix(true);
        const p = n.getAbsolutePosition();
        expect(Math.hypot(p.x - f.world[j].x, p.y - f.world[j].y, p.z - f.world[j].z)).toBeLessThan(1e-4);
      }
    }
    const f = stepAnimator(a, baseAnimState(origin), 1 / 60);
    applyFrame(model, f);
    model.handle.dispose();
    model.root.dispose();
  });
});
