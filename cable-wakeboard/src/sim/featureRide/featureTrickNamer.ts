import type { JibEntry, JibState } from '../rider';
import { SLIDES, type SlideId } from '../tricks/data';

/**
 * FeatureTrickNamer (feature riding spec 8): pure functions from a feature
 * line to its name.
 *
 *   [Entry] [<deg>-in] <Slide> [[Hard Way] <deg> <Slide>]... [<deg>-out] [Pretzel] [to Fakie/Forward]
 *
 * with `Transfer` between the slides of two features (and after a line that
 * started from another feature's air). Slide names carry their side
 * ("Backside Boardslide"); a 90-in is implied by a boardslide, a 90-out is
 * "to Fakie" / "to Forward". `Switch` prefixes slides ridden switch;
 * `Nose Press` / `Tail Press` replace 50-50 when pressed over 40% of it.
 * Entry words: Ollie-on, Side Ollie-on, Slide-on, Edge Slide-on, Pop-on
 * (a clean pop off the safety); none for ride-ons and other safety pops.
 * An Edge Slide-on goes after its slide's side: "Backside Edge Slide-on
 * Boardslide".
 */

/** What the namer needs of one slide (a JibState has all of it). */
export type NamerJib = Pick<JibState, 'entry' | 'inRotation' | 'slideOrder' | 'slideTimes' | 'pressTimes' | 'switchStance'> & {
  rotations: { deg: number; dir: number; hardWay: boolean; to: SlideId | null }[];
};

/** The out-part: the air's spin from the board's angle on the feature (rad, signed) and the stance landed in. */
export interface NamerOut {
  spin: number;
  landedSwitch: boolean;
}

/** A press replaces 50-50 when held over this fraction of the 50-50 time. */
export const PRESS_SHARE = 0.4;

const quarters = (rad: number): number => Math.round(Math.abs(rad) / (Math.PI / 2)) * 90;

export function entryWord(entry: JibEntry): string {
  switch (entry) {
    case 'ollieOn':
      return 'Ollie-on';
    case 'sideOllieOn':
      return 'Side Ollie-on';
    case 'slideOn':
      return 'Slide-on';
    case 'edgeSlideOn':
      return 'Edge Slide-on';
    case 'popOn':
      return 'Pop-on';
    default:
      return '';
  }
}

/** One slide's name on this jib: switch, presses. */
export function slideName(id: SlideId, j: NamerJib): string {
  const base = SLIDES[id].name;
  if (id === 'fiftyFifty' || id === 'switchFiftyFifty') {
    const fifty = j.slideTimes.fiftyFifty + j.slideTimes.switchFiftyFifty;
    const press = j.pressTimes.nose >= j.pressTimes.tail ? 'Nose Press' : 'Tail Press';
    const held = Math.max(j.pressTimes.nose, j.pressTimes.tail);
    return fifty > 0 && held > PRESS_SHARE * fifty ? base.replace('50-50', press) : base;
  }
  if (id === 'wallRide') return base;
  return j.switchStance ? `Switch ${base}` : base;
}

/** The parts of one jib's name: in-rotation, the first slide, each rotation on it. */
function jibParts(j: NamerJib, first: boolean): string[] {
  const parts: string[] = [];
  const start = j.slideOrder[0];
  const w = first ? entryWord(j.entry) : '';
  let startName = start ? slideName(start, j) : '';
  const sided = /^(Switch )?(Backside|Frontside) (.+)$/.exec(startName);
  if (w && j.entry === 'edgeSlideOn' && sided) {
    // The side leads: Backside Edge Slide-on (Switch) Boardslide.
    parts.push(sided[2]!, w);
    startName = `${sided[1] ?? ''}${sided[3]!}`;
  } else if (w) parts.push(w);
  const inDeg = quarters(j.inRotation);
  if (inDeg >= 180) parts.push(`${inDeg}-in`);
  if (startName) parts.push(startName);
  for (const r of j.rotations) {
    if (r.hardWay) parts.push('Hard Way');
    parts.push(`${r.deg}`);
    if (r.to) parts.push(slideName(r.to, j));
  }
  return parts;
}

/** The out-part: 180-out and up, a 90 to fakie / forward, a pretzel against the in-rotation. */
export function outParts(out: NamerOut | null, inRotation: number): string[] {
  if (!out) return [];
  const deg = quarters(out.spin);
  if (deg === 0) return [];
  const parts: string[] = [];
  if (deg >= 180) parts.push(`${deg}-out`);
  if (quarters(inRotation) >= 90 && Math.sign(inRotation) !== Math.sign(out.spin) && Math.sign(out.spin) !== 0) parts.push('Pretzel');
  if (deg === 90) parts.push(out.landedSwitch ? 'to Fakie' : 'to Forward');
  return parts;
}

/** The whole name of a line of slides (oldest first) and its out-part (null while still on the feature). */
export function featureTrickName(jibs: NamerJib[], out: NamerOut | null): string {
  const parts: string[] = [];
  jibs.forEach((j, i) => {
    if (i > 0) parts.push('Transfer');
    parts.push(...jibParts(j, i === 0));
  });
  const first = jibs[0];
  parts.push(...outParts(out, first ? first.inRotation : 0));
  // From a kicker or another feature's air straight onto this one.
  if (first && first.entry === 'transfer' && jibs.length === 1) parts.push('Transfer');
  return parts.join(' ');
}
