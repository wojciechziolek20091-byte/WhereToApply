import type { SimConfig } from './config';
import { DT, GRAVITY } from './config';
import { edgeNorm, toeSign, updateEdge } from './edge';
import { featureUnder, surfaceAt, toWorld } from './features';
import type { InputFrame } from './input';
import { approach, clamp01, sign, wrapAngle, wrapHalfTurn } from './math/scalar';
import { add, dot, forwardOf, horizontal, horizontalLength, rightOf, scale } from './math/vec';
import type { ResolvedFeature } from './park';
import { computePop, flatPopInputs, popTimingFactor } from './pop';
import { updatePosture } from './posture';
import type { AirState, JibState, RiderState } from './rider';
import type { SimState } from './world';
import { applyRope, fallRider, popReleased, setMode, takeOff } from './actions';
import { evaluateLanding } from './landing';

const featureById = (s: SimState, id: string): ResolvedFeature => {
  const f = s.features.find((x) => x.def.id === id);
  if (!f) throw new Error(`unknown feature ${id}`);
  return f;
};

/**
 * Called from the riding step after moving. If the rider is now over a
 * feature, either ride onto it (from the start, roughly aligned, at a low
 * surface) or crash into it. Returns true if the rider left the water mode.
 */
export function tryEnterFeature(s: SimState): boolean {
  const r = s.rider;
  const hit = featureUnder(s.features, r.pos);
  if (!hit) return false;
  const { feature, local, surface } = hit;
  const speed = horizontalLength(r.vel);
  const along = speed > 0.1 ? dot(horizontal(r.vel), forwardOf(feature.heading)) / speed : 0;
  if (surface.height > s.cfg.feature.mountHeight || along < Math.cos(s.cfg.feature.mountAngle)) {
    fallRider(s, 'featureCrash');
    return true;
  }
  r.ramp = {
    featureId: feature.def.id,
    u: local.u,
    v: local.v,
    edgeAngleAtBase: r.edgeAngle,
    releaseTick: -1,
    pendingPop: null,
  };
  // Snapshot the edge load at the base: this is what the pop draws on.
  r.load.edgeLoadAtBase = Math.max(r.edgeLoad, r.load.peakEdgeLoad);
  setMode(s, 'feature');
  s.events.push({ type: 'featureEnter', tick: s.tick, featureId: feature.def.id });
  return true;
}

function startJib(feature: ResolvedFeature, boardYaw: number): JibState {
  return {
    featureId: feature.def.id,
    balance: 0,
    boardAngle: wrapHalfTurn(boardYaw - feature.heading),
    time: 0,
    alignedTime: 0,
    crossedTime: 0,
  };
}

function endJib(s: SimState): void {
  const j = s.rider.jib;
  if (!j) return;
  s.events.push({
    type: 'jibDone',
    tick: s.tick,
    featureId: j.featureId,
    time: j.time,
    alignedTime: j.alignedTime,
    crossedTime: j.crossedTime,
  });
  s.rider.jib = null;
}

/**
 * Balance on a box or rail. Being off-centre, holding the board between the
 * two stable angles (0 and 90 degrees) and the rope's sideways pull all tip
 * the rider; leaning with the edge input corrects. Returns false on a fall.
 */
export function updateJib(r: RiderState, j: JibState, input: InputFrame, ropeLat: number, halfWidth: number, cfg: SimConfig): boolean {
  const jc = cfg.jib;
  const target = input.spin !== 0 ? sign(input.spin) * (Math.PI / 2) : 0;
  j.boardAngle = approach(j.boardAngle, target, jc.boardRotateRate * DT);
  const lateral = (r.ramp?.v ?? 0) / (halfWidth + 0.15);
  const offStable = Math.sin(2 * j.boardAngle);
  const lean = -toeSign(r) * input.edge;
  const dBalance = jc.drift * lateral + jc.angleDrift * offStable + ropeLat / jc.ropeTip - jc.correction * lean;
  j.balance += dBalance * DT;
  j.time += DT;
  if (Math.abs(j.boardAngle) < 0.35) j.alignedTime += DT;
  else if (Math.abs(j.boardAngle) > 1.2) j.crossedTime += DT;
  return Math.abs(j.balance) <= 1;
}

/** Leave the feature into the air with whatever pop is pending. */
function leaveFeature(s: SimState, f: ResolvedFeature, input: InputFrame): void {
  const r = s.rider;
  const pop = r.ramp?.pendingPop;
  endJib(s);
  s.events.push({ type: 'featureExit', tick: s.tick, featureId: f.def.id });
  takeOff(
    s,
    f.def.kind === 'kicker' ? 'kicker' : 'slider',
    f.def.id,
    pop?.speed ?? 0,
    pop?.quality ?? 0,
    r.load.edgeLoadAtBase,
    input,
  );
}

/** One tick on a kicker ramp or slider. */
export function stepFeature(s: SimState, input: InputFrame): void {
  const { rider: r, cfg } = s;
  const ramp = r.ramp;
  if (!ramp) throw new Error('feature mode without RampState');
  const f = featureById(s, ramp.featureId);
  const m = cfg.rider.mass;
  const released = popReleased(s, input);
  const compression = r.legCompression;
  updatePosture(r, input.handleIn, input.load, r.ropeTension, cfg.posture, DT);
  if (!r.jib) updateEdge(r, r.hasHandle ? input.edge : 0, cfg.edge, DT);
  const rope = applyRope(s);

  const surface = surfaceAt(f, { u: ramp.u, v: ramp.v });
  if (!surface) {
    leaveFeature(s, f, input);
    return;
  }
  const t = surface.tangent;
  const n = surface.normal;
  const right = rightOf(f.heading);
  let vt = dot(r.vel, t);
  let vl = dot(r.vel, right);
  const normalForce = Math.max(0, m * GRAVITY * n.y - dot(rope.force, n));
  const mu = f.def.kind === 'slider' && surface.onTop ? cfg.jib.friction : cfg.feature.rampFriction;
  const at = (dot(rope.force, t) - m * GRAVITY * t.y - mu * normalForce * sign(vt)) / m;
  vt += at * DT;
  const ropeLat = dot(rope.force, right);

  if (r.jib) {
    vl += (ropeLat / m - cfg.jib.lateralDamping * vl) * DT;
    r.edgeLoad = 0;
  } else {
    const grip = cfg.hydro.lateralGrip * (cfg.hydro.flatGripFraction + (1 - cfg.hydro.flatGripFraction) * edgeNorm(r, cfg.edge));
    const latForce = -grip * vl * Math.max(Math.abs(vt), cfg.hydro.gripMinSpeed);
    vl += ((ropeLat + latForce) / m) * DT;
    r.edgeLoad = Math.abs(latForce);
  }

  if (vt < cfg.feature.stallSpeed) {
    fallRider(s, 'featureCrash');
    return;
  }

  // Release on the feature: on a kicker the pop waits for the lip; on a
  // slider the rider ollies off straight away.
  if (released && ramp.releaseTick < 0) {
    ramp.releaseTick = s.tick;
    if (f.def.kind === 'kicker') {
      const horizontalSpeed = Math.max(vt * dot(t, forwardOf(f.heading)), 0.5);
      const timeToLip = (f.def.length - ramp.u) / horizontalSpeed;
      ramp.pendingPop = computePop(
        {
          edgeLoadAtBase: r.load.edgeLoadAtBase,
          holdRatio: clamp01(Math.abs(r.edgeAngle) / Math.max(Math.abs(ramp.edgeAngleAtBase), 0.05)),
          tensionAtRelease: rope.tension,
          timing: popTimingFactor(timeToLip, cfg.pop),
          connection: r.connection,
          compression,
        },
        cfg.pop,
      );
    } else {
      const pop = computePop(flatPopInputs(r.load, r.edgeLoad, rope.tension, r.connection, compression, cfg.pop), cfg.pop);
      ramp.pendingPop = { speed: pop.speed * 0.6, quality: pop.quality * 0.6 };
      leaveFeature(s, f, input);
      return;
    }
  }

  ramp.u += vt * dot(t, forwardOf(f.heading)) * DT;
  ramp.v += vl * DT;
  r.loadHeld = input.load;

  const next = surfaceAt(f, { u: ramp.u, v: ramp.v });
  if (!next) {
    // Off the lip, off the end, or off the side: momentum carries on.
    r.vel = add(scale(t, vt), scale(right, vl));
    r.pos = toWorld(f, ramp.u, ramp.v, surface.height);
    leaveFeature(s, f, input);
    return;
  }
  r.pos = toWorld(f, ramp.u, ramp.v, next.height);
  r.vel = add(scale(next.tangent, vt), scale(right, vl));
  r.heading = f.heading;

  if (f.def.kind === 'slider' && next.onTop) {
    if (!r.jib) r.jib = startJib(f, r.heading);
    if (!updateJib(r, r.jib, input, ropeLat, f.def.width / 2, cfg)) {
      endJib(s);
      fallRider(s, 'featureCrash');
    }
  }
}

/**
 * Airborne touchdown on a feature. Sliders can be landed on top if the board
 * is near 0 or 90 degrees to the axis; anything else is a crash.
 * Returns true if a feature handled the touchdown.
 */
export function touchDownOnFeature(s: SimState, air: AirState): boolean {
  const r = s.rider;
  const hit = featureUnder(s.features, r.pos);
  if (!hit || r.pos.y > hit.surface.height || r.vel.y >= 0) return false;
  const { feature, local, surface } = hit;
  if (feature.def.kind !== 'slider' || !surface.onTop) {
    fallRider(s, 'featureCrash');
    return true;
  }
  const yaw = wrapHalfTurn(r.heading + air.spinAngle - feature.heading);
  const nearStable = Math.min(Math.abs(yaw), Math.abs(Math.abs(yaw) - Math.PI / 2)) < 0.5;
  const landing = evaluateLanding(r, { ...air, spinAngle: 0 }, surface.normal, s.cfg);
  if (!nearStable || landing.fall) {
    fallRider(s, landing.fall ?? 'featureCrash', landing);
    return true;
  }
  if (Math.abs(Math.round(air.spinAngle / Math.PI)) % 2 === 1) r.switchStance = !r.switchStance;
  r.pos = toWorld(feature, local.u, local.v, surface.height);
  r.vel = scale(surface.tangent, Math.max(dot(r.vel, surface.tangent), s.cfg.feature.stallSpeed + 0.5));
  r.heading = feature.heading;
  r.air = null;
  r.ramp = {
    featureId: feature.def.id,
    u: local.u,
    v: local.v,
    edgeAngleAtBase: 0,
    releaseTick: -1,
    pendingPop: null,
  };
  r.jib = startJib(feature, feature.heading + wrapAngle(yaw));
  setMode(s, 'feature');
  s.events.push({ type: 'landed', tick: s.tick, air, landing });
  s.events.push({ type: 'featureEnter', tick: s.tick, featureId: feature.def.id });
  return true;
}
