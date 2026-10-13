import { toeSign } from '../edge';
import type { LandingResult } from '../landing';
import type { AirState } from '../rider';
import {
  COMBOS,
  GRABS,
  INVERTS,
  type InvertAxis,
  type InvertDirection,
  JIBS,
  JUMPS,
  MODIFIERS,
  RALEYS,
  SPINS,
} from './data';

export type TrickFamily = 'jump' | 'spin' | 'invert' | 'raley' | 'combo' | 'jib';

export interface TrickResult {
  /** Stable key for variety scoring, e.g. "tantrum+bs180+indy+switch". */
  key: string;
  name: string;
  family: TrickFamily;
  difficulty: number;
  spinDegrees: number;
  spinDirection: 'frontside' | 'backside' | null;
  invert: string | null;
  grab: string | null;
  switchStance: boolean;
  modifiers: string[];
}

/** Raley must reach this extension to count. */
const RALEY_MIN = 0.8;

/** Frontside = chest opens toward travel first; backside (blind) = back first. */
export function spinDirectionOf(air: AirState, stance: 'regular' | 'goofy'): 'frontside' | 'backside' | null {
  if (Math.abs(air.spinAngle) < Math.PI / 2) return null;
  const frontside = -toeSign({ stance, switchStance: air.takeoffSwitch });
  return Math.sign(air.spinAngle) === frontside ? 'frontside' : 'backside';
}

function invertOf(air: AirState): { id: string; name: string; difficulty: number } | null {
  if (air.flipDir === 0) return null;
  const direction: InvertDirection = air.flipDir < 0 ? 'back' : 'front';
  const axis: InvertAxis = air.axis;
  // A straight approach counts as heelside for back inverts and toeside for front.
  const approach = air.approach === 'neutral' ? (direction === 'back' ? 'heelside' : 'toeside') : air.approach;
  const def = INVERTS.find((d) => d.approach === approach && d.direction === direction && d.axis === axis);
  if (def) return def;
  const side = approach === 'heelside' ? 'Heelside' : 'Toeside';
  const name = `${side} ${direction === 'back' ? 'Back' : 'Front'}${axis}`;
  return { id: `${approach}-${direction}-${axis}`, name, difficulty: 3.8 };
}

/**
 * Name and rate what happened in the air. Returns null for a hop too small
 * to count. `stance` is the rider's natural stance.
 */
export function classifyAir(
  air: AirState,
  landing: LandingResult,
  stance: 'regular' | 'goofy',
  minAirTime: number,
): TrickResult | null {
  const spinDegrees = Math.abs(landing.halfTurns) * 180;
  const spinDirection = spinDegrees > 0 ? spinDirectionOf(air, stance) : null;
  const invert = landing.flips > 0 ? invertOf(air) : null;
  const raley =
    !invert && air.raleyPeak >= RALEY_MIN
      ? RALEYS.find((r) => r.approach === (air.approach === 'toeside' ? 'toeside' : 'heelside')) ?? null
      : null;
  if (air.time < minAirTime && !invert && spinDegrees === 0) return null;
  // Rolling off a slider or being lifted by the line without popping is not a trick.
  const unpopped = air.source !== 'kicker' && air.popSpeed < 0.5;
  if (unpopped && !invert && !raley && spinDegrees === 0 && !air.grabbed) return null;

  const modifiers: string[] = [];
  const grab = air.grabbed ? GRABS[air.grabbed] : null;
  const base =
    invert ?? raley ?? JUMPS.find((j) => j.source === air.source && j.approach === air.approach) ?? JUMPS[0]!;
  const spin = SPINS.find((s) => s.degrees === spinDegrees);
  const combo =
    (invert || raley) && spinDirection
      ? COMBOS.find((c) => c.base === base.id && c.spinDegrees === spinDegrees && c.spinDirection === spinDirection)
      : undefined;

  let difficulty = combo ? combo.difficulty : base.difficulty + (spin?.difficulty ?? spinDegrees / 120);
  let name: string;
  let family: TrickFamily;
  if (combo) {
    name = combo.name;
    family = 'combo';
    difficulty *= 1 + MODIFIERS.combo;
    modifiers.push('combo');
  } else if (invert || raley) {
    family = invert ? 'invert' : 'raley';
    name = base.name;
    if (spinDegrees > 0) {
      name += ` to ${spinDirection === 'backside' ? 'Blind' : 'Frontside'} ${spinDegrees}`;
      difficulty *= 1 + MODIFIERS.combo;
      modifiers.push('combo');
    }
  } else if (spinDegrees > 0) {
    family = 'spin';
    name = `${spinDirection === 'backside' ? 'Backside' : 'Frontside'} ${spinDegrees}`;
  } else {
    family = 'jump';
    name = base.name;
  }

  if (spinDirection === 'backside') {
    difficulty *= 1 + MODIFIERS.blind;
    modifiers.push('blind');
  }
  if (grab) {
    name += ` ${grab.name}`;
    difficulty += grab.difficulty;
    modifiers.push('grab');
  }
  if (air.takeoffSwitch) {
    name = `Switch ${name}`;
    difficulty *= 1 + MODIFIERS.switch;
    modifiers.push('switch');
  }

  const key = [
    combo?.id ?? base.id,
    spinDegrees && !combo ? `${spinDirection === 'backside' ? 'bs' : 'fs'}${spinDegrees}` : '',
    grab?.id ?? '',
    air.takeoffSwitch ? 'switch' : '',
  ]
    .filter(Boolean)
    .join('+');

  return {
    key,
    name,
    family,
    difficulty,
    spinDegrees,
    spinDirection,
    invert: invert?.id ?? null,
    grab: grab?.id ?? null,
    switchStance: air.takeoffSwitch,
    modifiers,
  };
}

/** Name a finished jib from how long the board spent aligned vs across. */
export function classifyJib(time: number, alignedTime: number, crossedTime: number): TrickResult | null {
  if (time < 0.3) return null;
  const def = crossedTime > alignedTime ? JIBS.boardslide : JIBS.fiftyFifty;
  return {
    key: def.id,
    name: def.name,
    family: 'jib',
    difficulty: def.difficulty * Math.min(2, 0.5 + time),
    spinDegrees: 0,
    spinDirection: null,
    invert: null,
    grab: null,
    switchStance: false,
    modifiers: [],
  };
}
