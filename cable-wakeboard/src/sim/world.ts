import { type CablePath, type CarrierState, buildCablePath, cablePointAt, createCarrier } from './cable';
import type { SimConfig } from './config';
import { DEFAULT_CONFIG } from './config';
import type { SimEvent } from './events';
import { type Vec3, addScaled, forwardOf, vec3 } from './math/vec';
import { DEFAULT_PARK, type ParkDef, type ResolvedFeature, resolvePark } from './park';
import type { RiderState } from './rider';

export interface SimState {
  tick: number;
  time: number;
  readonly cfg: SimConfig;
  readonly path: CablePath;
  readonly features: ResolvedFeature[];
  carrier: CarrierState;
  rider: RiderState;
  /** Events from the most recent tick only. */
  events: SimEvent[];
}

/** A rider on the water at `pos`, moving at `vel`, with the handle in. */
export function createRider(cfg: SimConfig, pos: Vec3, vel: Vec3, heading: number): RiderState {
  return {
    mode: 'riding',
    pos,
    vel,
    heading,
    stance: cfg.rider.stance,
    switchStance: false,
    edgeAngle: 0,
    edgeLoad: 0,
    ropeTension: 0,
    ropeForce: vec3(),
    ropeHeading: heading,
    slackTime: 0,
    overGripTime: 0,
    hasHandle: true,
    handleDist: cfg.posture.handleInDist,
    waistHinge: 0,
    connection: 1,
    legCompression: 0,
    loadHeld: false,
    extendTimer: 0,
    load: { edgeLoadAtBase: 0, peakEdgeLoad: 0, peakAge: 0 },
    air: null,
    ramp: null,
    jib: null,
    fallTimer: 0,
    lastFall: null,
    modeTime: 0,
  };
}

/**
 * Place the rider on the water straight behind the carrier, rope almost tight,
 * moving at carrier speed. Used at start and after a fall.
 */
export function spawnRiderBehindCarrier(state: Pick<SimState, 'cfg' | 'path' | 'carrier'>): RiderState {
  const { cfg, path, carrier } = state;
  const effective = (cfg.rope.length + cfg.posture.handleInDist) * cfg.run.respawnSlack;
  const drop = cfg.cable.cableHeight - cfg.rider.hipHeight;
  const back = Math.sqrt(Math.max(1, effective * effective - drop * drop));
  // Follow the cable backwards so a spawn just after a corner stays on the line.
  const behind = cablePointAt(path, carrier.s - back);
  const heading = carrier.heading;
  const pos = vec3(behind.pos.x, 0, behind.pos.z);
  const vel = addScaled(vec3(), forwardOf(heading), cfg.cable.carrierSpeed);
  return createRider(cfg, pos, vel, heading);
}

export function createSim(
  cfg: SimConfig = DEFAULT_CONFIG,
  park: ParkDef = DEFAULT_PARK,
  carrierStartS = park.startS ?? 30,
): SimState {
  const path = buildCablePath(cfg.cable);
  const carrier = createCarrier(path, carrierStartS, cfg.cable.carrierSpeed);
  const base = { cfg, path, carrier };
  return {
    tick: 0,
    time: 0,
    cfg,
    path,
    features: resolvePark(park, path),
    carrier,
    rider: spawnRiderBehindCarrier(base),
    events: [],
  };
}
