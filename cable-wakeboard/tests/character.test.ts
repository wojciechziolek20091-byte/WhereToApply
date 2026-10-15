import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { RIDER_PALETTES } from '../src/art/riders';
import { distance, vec3 } from '../src/sim/math/vec';
import { buildCharacter, characterMaterial, solveJoint } from '../src/render/babylon/character';

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

  it.each(RIDER_PALETTES)('palette %s builds a rider-sized, merged mesh', (palette) => {
    const { mesh, rig } = buildCharacter(scene, palette, material);
    mesh.computeWorldMatrix(true);
    mesh.refreshBoundingInfo();
    const { minimum, maximum } = mesh.getBoundingInfo().boundingBox;
    const height = maximum.y - minimum.y;
    // Crouched riding height, helmet included.
    expect(height).toBeGreaterThan(1.4);
    expect(height).toBeLessThan(1.75);
    // Board length dominates the X extent.
    expect(maximum.x - minimum.x).toBeGreaterThan(1.3);
    expect(maximum.x - minimum.x).toBeLessThan(1.5);
    // IK put the hands on the handle and the knees in front of the line of the legs.
    for (const g of rig.grips) expect(distance(g, rig.handle)).toBeLessThan(0.1);
    for (const kn of rig.knees) expect(kn.z).toBeGreaterThan(0.05);
    expect(rig.head.y).toBeGreaterThan(1.3);
    // One mesh, with vertex colours and no NaNs.
    const pos = mesh.getVerticesData('position')!;
    const col = mesh.getVerticesData('color')!;
    expect(col.length / 4).toBe(pos.length / 3);
    expect(pos.every((v) => Number.isFinite(v))).toBe(true);
    mesh.dispose();
  });
});
