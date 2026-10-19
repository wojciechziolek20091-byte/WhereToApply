import { type Animator, type AnimFrame, stepAnimator } from './animator';
import { DEG, type V3, vadd } from './quat';
import { composeBoardRotation, type GrabName, type RiderAnimState, type SlideName, type TrickId } from './state';

/**
 * AnimTestDriver (spec section 0.2): plays any trick on demand along a
 * scripted arc, so each animation can be checked in isolation, frozen at any
 * phase (the pose scrubber) or captured. Each scenario maps u in [0, 1] to
 * the RiderAnimState gameplay would send. Twin: Anim/AnimTestDriver.luau.
 */
export interface Scenario {
  /** Real-time length of the scenario (s). */
  duration: number;
  at(u: number, prevU: number, origin: V3): RiderAnimState;
}

const SPEED = 8.3;
const s01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number): number => {
  const t = s01(x);
  return t * t * (3 - 2 * t);
};

/** A rider cruising behind the carrier at `origin` (the template every scenario edits). */
export function baseAnimState(origin: V3): RiderAnimState {
  return {
    state: 'Riding',
    stance: 'Regular',
    isSwitch: false,
    speed: SPEED,
    velocity: { x: SPEED, y: 0, z: 0 },
    edge: 0,
    tension: 420,
    popCharge: 0,
    boardCFrame: { pos: { ...origin }, rot: composeBoardRotation(0, null, 0, 0) },
    handlePosition: vadd(origin, { x: 0.4, y: 1, z: 0 }),
    trick: { id: null, phase: 0, spinDegrees: 0, spinDirection: null, flipDegrees: 0, grab: null, grabTime: 0 },
    handle: 'InFront',
    passProgress: null,
    feature: null,
    landing: null,
    crashReason: null,
    ext: {
      toes: 1,
      carrier: vadd(origin, { x: 16, y: 6.5, z: 1.5 }),
      airTime: 0,
      airDuration: 0,
      spinRate: 0,
      spinRemaining: 0,
      flipRemaining: 0,
      preWind: 0,
      extension: 0,
      rollDegrees: 0,
      sBend: 0,
      rollKind: null,
      edgeDegrees: 0,
      slope: 0,
      rail: false,
      featureTurn: -1,
      lipPop: false,
      modeTime: 0,
      justLanded: false,
      justTookOff: false,
      ropeSnap: false,
      spinOut: 0,
      slideOn: null,
    },
  };
}

/** Air arc: height and vertical speed at phase u for a peak of `h` metres over `T` seconds. */
function air(s: RiderAnimState, u: number, h: number, T: number, id: TrickId): void {
  s.state = id === 'Raley' || id === 'Backroll' || id === 'Frontroll' || id === 'SBendL' || id === 'SBendR' || id === 'Mobe' ? 'WaterTrickAir' : 'Airborne';
  s.boardCFrame.pos.y += 4 * h * u * (1 - u);
  s.velocity = { x: SPEED, y: ((4 * h) / T) * (1 - 2 * u), z: 0 };
  s.trick.id = id;
  s.trick.phase = u;
  s.ext.airTime = u * T;
  s.ext.airDuration = T;
  s.tension = 150;
}

function flip(dir: number, h: number, T: number): Scenario {
  return {
    duration: T,
    at(u, _p, o) {
      const s = baseAnimState(o);
      air(s, u, h, T, dir > 0 ? 'FrontFlip' : 'Tantrum');
      const prog = smooth((u - 0.08) / 0.7);
      const deg = 360 * prog * dir;
      s.trick.flipDegrees = deg;
      s.ext.flipRemaining = prog >= 1 ? 0 : (360 - Math.abs(deg)) * dir;
      s.boardCFrame.rot = composeBoardRotation(0, { x: 1, y: 0, z: 0 }, deg * DEG, 0);
      return s;
    },
  };
}

function spin(deg: number, h: number, T: number, pass: boolean): Scenario {
  return {
    duration: T,
    at(u, p, o) {
      const s = baseAnimState(o);
      air(s, u, h, T, 'Spin');
      const k = smooth((u - 0.05) / 0.8);
      const k0 = smooth((p - 0.05) / 0.8);
      const a = deg * k;
      s.trick.spinDegrees = a;
      s.trick.spinDirection = 'Backside';
      s.ext.spinRate = u > 0 ? ((deg * (k - k0)) / Math.max(1e-6, u - p)) / T : 0;
      s.ext.spinRemaining = deg - a;
      s.boardCFrame.rot = composeBoardRotation(a * DEG, null, 0, 0);
      if (pass && Math.abs(a) > 150 && Math.abs(a) < 250) {
        s.handle = 'Passing';
        s.passProgress = (Math.abs(a) - 150) / 100;
      }
      return s;
    },
  };
}

function raleyExtension(u: number): number {
  if (u < 0.15) return (u / 0.15) * 25;
  if (u < 0.55) return 25 + ((u - 0.15) / 0.4) * 65;
  if (u < 0.85) return 90 - ((u - 0.55) / 0.3) * 80;
  return 10 * (1 - (u - 0.85) / 0.15);
}

function waterTrick(id: TrickId): Scenario {
  const T = 1.5;
  return {
    duration: T,
    at(u, _p, o) {
      const s = baseAnimState(o);
      air(s, u, 2.5, T, id);
      s.tension = 1300 * (1 - u);
      // Out of a heelside cut the rope comes from ahead and the toe side.
      s.ext.carrier = vadd(o, { x: 11, y: 6.5, z: 10 });
      s.ext.edgeDegrees = 30 * (1 - smooth(u / 0.3));
      if (id === 'Raley' || id === 'SBendL' || id === 'SBendR') {
        s.ext.extension = raleyExtension(u);
        if (id !== 'Raley') {
          if (u < 0.3) s.trick.id = 'Raley';
          else {
            const side = id === 'SBendL' ? -1 : 1;
            s.ext.sBend = side;
            const roll = 360 * smooth((u - 0.3) / 0.5);
            s.ext.rollDegrees = roll;
            s.boardCFrame.rot = composeBoardRotation(0, { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 }, side * roll * DEG, 0);
          }
        }
        return s;
      }
      const back = id === 'Backroll' || id === 'Mobe';
      s.ext.rollKind = back ? 'back' : 'front';
      const roll = 360 * smooth((u - 0.08) / 0.72);
      s.ext.rollDegrees = roll;
      let yaw = 0;
      if (id === 'Mobe') {
        const k = smooth((u - 0.1) / 0.7);
        yaw = 360 * k * DEG;
        s.trick.spinDegrees = 360 * k;
        s.ext.spinRate = u > 0.1 && u < 0.8 ? 360 / (0.7 * T) : 0;
        s.ext.spinRemaining = 360 * (1 - k);
      }
      s.boardCFrame.rot = composeBoardRotation(yaw, { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 }, (back ? -1 : 1) * roll * DEG, 0);
      return s;
    },
  };
}

function grab(g: GrabName): Scenario {
  const T = 1.4;
  return {
    duration: T,
    at(u, _p, o) {
      const s = baseAnimState(o);
      air(s, u, 1.6, T, 'Ollie');
      if (u > 0.18 && u < 0.78) {
        s.trick.grab = g;
        s.trick.grabTime = (u - 0.18) * T;
      }
      return s;
    },
  };
}

function riding(edge: number, tension: number, extra?: (s: RiderAnimState, u: number) => void): Scenario {
  return {
    duration: 1.5,
    at(u, _p, o) {
      const s = baseAnimState(o);
      s.edge = edge;
      s.ext.edgeDegrees = edge * 40;
      s.tension = tension;
      s.boardCFrame.rot = composeBoardRotation(0, null, 0, -edge * 40 * DEG);
      s.velocity = { x: SPEED, y: 0, z: -edge * 3 };
      extra?.(s, u);
      return s;
    },
  };
}

function slide(name: SlideName): Scenario {
  const yaw = name === 'Backboard' ? -90 : name === 'Frontboard' ? 90 : name === 'SwitchFiftyFifty' ? 180 : 0;
  return {
    duration: 2,
    at(u, _p, o) {
      const s = baseAnimState(o);
      s.state = 'OnFeature';
      s.boardCFrame.pos.y += 0.6;
      s.boardCFrame.rot = composeBoardRotation(yaw * DEG, null, 0, 0);
      s.feature = { slide: name, balance: 0.75 * Math.sin(2 * Math.PI * u) };
      s.ext.rail = true;
      s.tension = 300;
      return s;
    },
  };
}

/** A slide-on (side approaches spec 5): the nose lifts, climbs over the edge, settles on top. `side` +1 the feature on the toes' side. */
function slideOn(side: number): Scenario {
  const T = 1.2;
  return {
    duration: T,
    at(u, _p, o) {
      const s = baseAnimState(o);
      let pitch = 0;
      if (u < 0.6) {
        const air = u < 0.45;
        const lift = smooth(u / 0.2);
        const climb = air ? 0 : (u - 0.45) / 0.15;
        s.state = 'Airborne';
        s.trick.id = 'Ollie';
        s.trick.phase = u / 0.6;
        s.ext.airTime = u * T;
        s.ext.airDuration = 0.6 * T;
        s.boardCFrame.pos.y += air ? 0.7 * Math.sin((Math.PI * u) / 0.9) : 0.62 + 0.18 * climb;
        s.ext.slideOn = air ? { phase: 'Lift', progress: lift * 0.6, side } : { phase: 'Contact', progress: climb, side };
        pitch = 18 * lift * (1 - climb);
      } else {
        s.state = 'OnFeature';
        s.boardCFrame.pos.y += 0.8;
        s.feature = { slide: 'FiftyFifty', balance: 0.2 * side, entry: 'slideOn' };
        s.ext.slideOn = { phase: 'Settle', progress: (u - 0.6) * T, side };
      }
      s.boardCFrame.rot = composeBoardRotation(0, { x: 0, y: 0, z: 1 }, pitch * DEG, 0);
      s.tension = 350;
      return s;
    },
  };
}

function crash(reason: string): Scenario {
  return {
    duration: 2.2,
    at(u, _p, o) {
      const s = baseAnimState(o);
      s.state = 'Crashed';
      s.crashReason = reason;
      s.handle = 'Dropped';
      s.tension = 0;
      s.speed = SPEED * (1 - u);
      s.velocity = { x: SPEED * (1 - u), y: 0, z: 0 };
      s.ext.modeTime = u * 2.2;
      return s;
    },
  };
}

export const SCENARIOS: Record<string, Scenario> = {
  Cruise: riding(0, 420),
  Heelside: riding(1, 950),
  Toeside: riding(-1, 750),
  Loaded: riding(1, 1350, (s) => {
    s.state = 'WaterTrickLoad';
  }),
  Charge: riding(0.4, 600, (s, u) => {
    s.popCharge = s01(u * 1.5);
  }),
  PreWind: riding(0.6, 700, (s, u) => {
    s.popCharge = s01(u * 1.5);
    s.ext.preWind = 1;
  }),
  Blind: riding(0, 500, (s) => {
    s.state = 'RidingBlind';
    s.handle = 'Behind';
    s.boardCFrame.rot = composeBoardRotation(Math.PI, null, 0, 0);
  }),
  Slack: riding(0, 0),
  Ollie: {
    duration: 1.1,
    at(u, _p, o) {
      const s = baseAnimState(o);
      air(s, u, 1, 1.1, 'Ollie');
      return s;
    },
  },
  Spin360: spin(360, 1.6, 1.4, false),
  Spin540: spin(540, 1.9, 1.5, false),
  HandlePass: spin(360, 1.6, 1.4, true),
  FrontFlip: flip(1, 2, 1.5),
  Tantrum: flip(-1, 2, 1.5),
  Raley: waterTrick('Raley'),
  Backroll: waterTrick('Backroll'),
  Frontroll: waterTrick('Frontroll'),
  SBendL: waterTrick('SBendL'),
  SBendR: waterTrick('SBendR'),
  Mobe: waterTrick('Mobe'),
  Indy: grab('Indy'),
  Stalefish: grab('Stalefish'),
  Nose: grab('Nose'),
  Tail: grab('Tail'),
  FiftyFifty: slide('FiftyFifty'),
  Backboard: slide('Backboard'),
  Frontboard: slide('Frontboard'),
  SwitchFiftyFifty: slide('SwitchFiftyFifty'),
  Landing: {
    duration: 0.8,
    at(u, p, o) {
      const s = baseAnimState(o);
      s.state = u < 0.25 ? 'Landing' : 'Riding';
      s.ext.justLanded = p <= 0 && u > 0;
      s.landing = { impactSpeed: 6, quality: 'Clean' };
      return s;
    },
  },
  SketchyLanding: {
    duration: 0.8,
    at(u, p, o) {
      const s = baseAnimState(o);
      s.state = u < 0.25 ? 'Landing' : 'Riding';
      s.ext.justLanded = p <= 0 && u > 0;
      s.landing = { impactSpeed: 7, quality: 'Sketchy' };
      return s;
    },
  },
  CrashShortOllie: crash('shortOllie'),
  CrashHandleDropped: crash('handleDropped'),
  CrashUnderRotated: crash('underRotated'),
  CrashRaleyExtended: crash('raleyExtendedOnLanding'),
  CrashGrabHeld: crash('grabHeldOnLanding'),
  CrashCaughtEdgeBlind: crash('caughtEdgeBlind'),
  CrashFellOffFeature: crash('fellOffFeature'),
  CrashRopeYank: crash('ropeYank'),
  SlideOnToeside: slideOn(1),
  SlideOnHeelside: slideOn(-1),
  CrashNoseDig: crash('noseDig'),
  CrashHangUp: crash('hangUp'),
};

/**
 * Goofy version of a scenario at heading 0: toes the other way, and the
 * board's tilt and inverts reflected through the z = 0 plane, as the sim's
 * pose would have them.
 */
export function asGoofy(sc: Scenario): Scenario {
  return {
    duration: sc.duration,
    at(u, p, o) {
      const s = sc.at(u, p, o);
      s.stance = 'Goofy';
      s.ext.toes = -1;
      const q = s.boardCFrame.rot;
      s.boardCFrame.rot = { x: -q.x, y: -q.y, z: q.z, w: q.w };
      s.ext.preWind = -s.ext.preWind;
      s.boardCFrame.pos = { x: s.boardCFrame.pos.x, y: s.boardCFrame.pos.y, z: -s.boardCFrame.pos.z };
      s.ext.carrier = { x: s.ext.carrier.x, y: s.ext.carrier.y, z: 2 * o.z - s.ext.carrier.z };
      s.velocity = { x: s.velocity.x, y: s.velocity.y, z: -s.velocity.z };
      return s;
    },
  };
}

/**
 * Play a scenario from its start up to phase `u` at `fps`, so springs and
 * blends are where they would be in play, and return the last frame.
 */
export function playTo(a: Animator, sc: Scenario, u: number, origin: V3, fps = 60): AnimFrame {
  const steps = Math.max(1, Math.round(sc.duration * s01(u) * fps));
  const dt = 1 / fps;
  // A few still frames first so the rider starts settled.
  let frame = stepAnimator(a, sc.at(0, 0, origin), dt);
  for (let i = 0; i < 20; i++) frame = stepAnimator(a, sc.at(0, 0, origin), dt);
  let prev = 0;
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * s01(u);
    frame = stepAnimator(a, sc.at(t, prev, origin), dt);
    prev = t;
  }
  return frame;
}
