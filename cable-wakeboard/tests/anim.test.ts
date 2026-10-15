import { createAnimator, stepAnimator } from '../src/anim/animator';
import { mirrorPose, NCH, neutralPose, CH } from '../src/anim/channels';
import { compileClip, sampleClip, sampleTrack } from '../src/anim/clip';
import { DEFAULT_ANIM_CONFIG } from '../src/anim/config';
import { ALL_CLIPS, CRASH_LEAD_IN } from '../src/anim/poses';
import { qeuler, qmirrorX, qmul, qrot, vlen, vsub } from '../src/anim/quat';
import { JOINTS } from '../src/anim/skeleton';
import { spring, stepSpring } from '../src/anim/spring';
import { asGoofy, playTo, SCENARIOS } from '../src/anim/testDriver';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { characterRig } from '../src/render/babylon/character';

const rig = characterRig();
const origin = { x: 0, y: 0, z: 0 };
const toRoot = (f: ReturnType<typeof playTo>, p: { x: number; y: number; z: number }) =>
  qrot({ x: -f.root.rot.x, y: -f.root.rot.y, z: -f.root.rot.z, w: f.root.rot.w }, vsub(p, f.root.pos));

describe('clips', () => {
  it('pass through their keys with flat ends (Hermite, not linear)', () => {
    const t = [0, 0.5, 1];
    const v = [0, 10, 30];
    const e = ['smooth', 'smooth', 'smooth'] as const;
    expect(sampleTrack(t, v, [...e], 0)).toBe(0);
    expect(sampleTrack(t, v, [...e], 0.5)).toBe(10);
    expect(sampleTrack(t, v, [...e], 1)).toBe(30);
    // Curved, not a straight line between keys.
    expect(sampleTrack(t, v, [...e], 0.25)).not.toBeCloseTo(5, 2);
  });

  it('every clip compiles and samples finite values, and only drives its own channels', () => {
    for (const c of ALL_CLIPS) {
      const cc = compileClip(c);
      for (const u of [0, 0.13, 0.5, 0.77, 1]) {
        const p = neutralPose();
        sampleClip(cc, u, p);
        expect(p.every(Number.isFinite)).toBe(true);
      }
      expect(cc.mask.filter((m) => m > 0).length).toBe(cc.tracks.length);
    }
  });

  it('has a lead-in for every crash reason the sim has', () => {
    const reasons = ['shortOllie', 'missedSafetyPop', 'handleDropped', 'underRotated', 'overRotated', 'grabHeldOnLanding', 'raleyExtendedOnLanding', 'caughtEdgeBlind', 'fellOffFeature', 'ropeYank'];
    for (const r of reasons) expect(CRASH_LEAD_IN[r]).toBeDefined();
  });
});

describe('mirrorPose', () => {
  it('is its own inverse', () => {
    const p = neutralPose().map((v, i) => v + Math.sin(i * 1.7) * 30);
    const back = mirrorPose(mirrorPose(p));
    for (let i = 0; i < NCH; i++) expect(back[i]).toBeCloseTo(p[i]!, 12);
  });

  it('mirrors joint rotations across the x = 0 plane', () => {
    const q = qeuler(20, 35, -15);
    const m = qeuler(20, -35, 15);
    const mq = qmirrorX(q);
    expect(Math.abs(mq.x * m.x + mq.y * m.y + mq.z * m.z + mq.w * m.w)).toBeCloseTo(1, 9);
    // And it is a homomorphism: mirror(a b) = mirror(a) mirror(b).
    const a = qeuler(10, 20, 30), b = qeuler(-40, 5, 12);
    const l = qmirrorX(qmul(a, b)), r = qmul(qmirrorX(a), qmirrorX(b));
    expect(Math.abs(l.x * r.x + l.y * r.y + l.z * r.z + l.w * r.w)).toBeCloseTo(1, 9);
  });

  it('a goofy rider is the mirror image of a regular one', () => {
    // Heading 0 scenarios: the goofy board is the regular one reflected through z = 0.
    for (const name of ['Cruise', 'Heelside', 'Indy', 'FrontFlip']) {
      const reg = playTo(createAnimator(rig), SCENARIOS[name]!, 0.5, origin);
      const goo = playTo(createAnimator(rig), asGoofy(SCENARIOS[name]!), 0.5, origin);
      expect(goo.mirrored).toBe(true);
      // The lead side swaps: regular L joints match goofy R joints, reflected.
      for (const [j, m] of [['Neck', 'Neck'], ['Hips', 'Hips'], ['LKnee', 'RKnee'], ['LWrist', 'RWrist'], ['RAnkle', 'LAnkle']] as const) {
        const a = reg.world[j];
        const b = goo.world[m];
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z + b.z)).toBeLessThan(0.02);
      }
    }
  });
});

describe('springs', () => {
  it('settle on the target and stay stable at long frame times', () => {
    const s = spring(0);
    for (let i = 0; i < 300; i++) stepSpring(s, 1, { freq: 3, damping: 1 }, 1 / 60);
    expect(s.x).toBeCloseTo(1, 4);
    const t = spring(0);
    for (let i = 0; i < 20; i++) stepSpring(t, 1, { freq: 10, damping: 0.5 }, 0.25);
    expect(Math.abs(t.x - 1)).toBeLessThan(0.05);
  });
});

describe('animator', () => {
  const names = Object.keys(SCENARIOS);

  it.each(names)('%s: feet stay in the bindings and nothing is NaN', (name) => {
    const a = createAnimator(rig);
    for (const u of [0.1, 0.35, 0.6, 0.9]) {
      const f = playTo(a, SCENARIOS[name]!, u, origin);
      for (const j of JOINTS) expect(Number.isFinite(f.world[j].x + f.world[j].y + f.world[j].z)).toBe(true);
      if (f.ragdoll) continue;
      for (const side of ['L', 'R'] as const) {
        const ank = toRoot(f, f.world[`${side}Ankle`]);
        expect(vlen(vsub(ank, rig.rest[`${side}Ankle`]))).toBeLessThan(0.01);
      }
    }
  });

  it.each(names.filter((n) => !n.startsWith('Crash')))('%s: hands holding the handle are on its grips', (name) => {
    const a = createAnimator(rig);
    for (const u of [0.2, 0.5, 0.8]) {
      const f = playTo(a, SCENARIOS[name]!, u, origin);
      for (const side of ['L', 'R'] as const) {
        if (f.handKinds[side] !== 'Handle' && f.handKinds[side] !== 'Passing') continue;
        const h = f.hands[side];
        const d = Math.min(vlen(vsub(h, f.handle.grips[0])), vlen(vsub(h, f.handle.grips[1])), vlen(vsub(h, f.handle.pos)));
        expect(d).toBeLessThan(0.03);
      }
    }
  });

  it.each(['Indy', 'Stalefish', 'Nose', 'Tail'])('%s: the grabbing hand reaches the board', (name) => {
    const a = createAnimator(rig);
    const f = playTo(a, SCENARIOS[name]!, 0.65, origin);
    const kinds = Object.values(f.handKinds);
    expect(kinds).toContain('Grab');
    const side = f.handKinds.L === 'Grab' ? 'L' : 'R';
    expect(vlen(vsub(f.hands[side], f.ikTargets[side === 'L' ? 0 : f.ikTargets.length - 1]!))).toBeLessThan(0.04);
  });

  it.each(names.filter((n) => !n.startsWith('Crash')))('%s never snaps: joints move smoothly frame to frame', (name) => {
    const a = createAnimator(rig);
    const sc = SCENARIOS[name]!;
    const steps = Math.round(sc.duration * 60);
    const tracks: Record<string, { x: number; y: number; z: number }[]> = {};
    let pu = 0;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const f = stepAnimator(a, sc.at(u, pu, origin), 1 / 60);
      pu = u;
      // Relative to the board, so the board's own flight and spin do not count.
      for (const j of JOINTS) (tracks[j] ??= []).push(toRoot(f, f.world[j]));
      (tracks.handL ??= []).push(toRoot(f, f.hands.L));
      (tracks.handR ??= []).push(toRoot(f, f.hands.R));
    }
    let speed = 0;
    let jerk = 0;
    for (const t of Object.values(tracks)) {
      for (let i = 1; i < t.length; i++) speed = Math.max(speed, vlen(vsub(t[i]!, t[i - 1]!)));
      for (let i = 1; i + 1 < t.length; i++) {
        const mid = { x: (t[i - 1]!.x + t[i + 1]!.x) / 2, y: (t[i - 1]!.y + t[i + 1]!.y) / 2, z: (t[i - 1]!.z + t[i + 1]!.z) / 2 };
        jerk = Math.max(jerk, vlen(vsub(t[i]!, mid)));
      }
    }
    // A snap is a one-frame jump: a big step that its neighbours do not share.
    // Landings start with the impact speed, so their first step is sudden by design.
    // Grabs: a hand going from the handle to the board end and back is quick (up to ~9 m/s).
    const landing = name.includes('Landing');
    const grab = ['Indy', 'Stalefish', 'Nose', 'Tail'].includes(name);
    expect(speed).toBeLessThan(landing || grab ? 0.17 : 0.13);
    // Spins: re-gripping mid-spin restarts a reach, a 5 cm hitch (docs/ANIMATION.md).
    expect(jerk).toBeLessThan(landing ? 0.08 : grab ? 0.06 : 0.05);
  });

  it('turns inverts about the centre of mass, not the board', () => {
    const a = createAnimator(rig);
    const sc = SCENARIOS.FrontFlip!;
    const offsets: number[] = [];
    let pu = 0;
    for (let i = 0; i <= 90; i++) {
      const u = i / 90;
      const st = sc.at(u, pu, origin);
      pu = u;
      const f = stepAnimator(a, st, sc.duration / 90);
      if (u > 0.05 && u < 0.8) offsets.push(vlen(vsub(f.com, st.boardCFrame.pos)));
    }
    // The COM keeps its takeoff offset from the sim's trajectory point.
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThan(0.05);
  });

  it('crashes hand over to a floating ragdoll', () => {
    const a = createAnimator(rig);
    const f = playTo(a, SCENARIOS.CrashUnderRotated!, 1, origin);
    expect(f.ragdoll).toBe(true);
    // Floating at the surface, not sinking or flying off.
    expect(f.world.Hips.y).toBeGreaterThan(-0.5);
    expect(f.world.Hips.y).toBeLessThan(0.6);
  });

  it('uses the same pre-wind bonus as the sim', () => {
    expect(DEFAULT_ANIM_CONFIG.Spin.PreWindBonus).toBe(DEFAULT_CONFIG.physics.preWindBonus);
  });

  it('crouches with the pop charge 1:1', () => {
    const a = createAnimator(rig);
    const half = playTo(a, SCENARIOS.Charge!, 0.33, origin);
    const full = playTo(createAnimator(rig), SCENARIOS.Charge!, 1, origin);
    expect(full.world.Hips.y).toBeLessThan(half.world.Hips.y - 0.02);
    void CH;
  });
});
