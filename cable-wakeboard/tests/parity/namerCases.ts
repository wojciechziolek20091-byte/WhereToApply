/**
 * Feature trick names (feature riding spec 8): the spec's examples and more,
 * shared by tests/featureNames.test.ts and the Luau parity check.
 */
import type { NamerJib, NamerOut } from '../../src/sim/featureRide/featureTrickNamer';
import type { SlideId } from '../../src/sim/tricks/data';

export type NameCase = [string, NamerJib[], NamerOut | null, string];

export const deg = (d: number) => (d * Math.PI) / 180;
export const ZERO: Record<SlideId, number> = { fiftyFifty: 0, switchFiftyFifty: 0, backboard: 0, frontboard: 0, backLip: 0, frontLip: 0, wallRide: 0 };

/** A jib: slides in order (1 s each unless given), rotations on the feature as [deg, to, hardWay?]. */
export function jib(o: {
  entry?: NamerJib['entry'];
  inDeg?: number;
  slides: SlideId[];
  rotations?: [number, SlideId, boolean?][];
  press?: { nose?: number; tail?: number };
  switchStance?: boolean;
}): NamerJib {
  const slideTimes = { ...ZERO };
  for (const s of o.slides) slideTimes[s] += 1;
  for (const [, to] of o.rotations ?? []) slideTimes[to] += 1;
  return {
    entry: o.entry ?? 'rideOn',
    inRotation: deg(o.inDeg ?? 0),
    slideOrder: [...o.slides],
    slideTimes,
    pressTimes: { nose: o.press?.nose ?? 0, tail: o.press?.tail ?? 0 },
    switchStance: o.switchStance ?? false,
    rotations: (o.rotations ?? []).map(([d, to, hard]) => ({ deg: d, dir: 1, hardWay: !!hard, to })),
  };
}
export const out = (spinDeg: number, landedSwitch = false): NamerOut => ({ spin: deg(spinDeg), landedSwitch });


/** Section 8's table: these must come out exactly so. */
export const SPEC_EXAMPLES: NameCase[] = [
    ['ride up the safety, 50-50 the box', [jib({ slides: ['fiftyFifty'] })], null, '50-50'],
    ['side ollie from the heelside, nose over, slide', [jib({ entry: 'sideOllieOn', inDeg: 90, slides: ['backboard'] })], null, 'Side Ollie-on Backside Boardslide'],
    ['ollie onto the safety, pop at the end, 180 in, land switch', [jib({ entry: 'popOn', inDeg: 180, slides: ['switchFiftyFifty'] })], null, 'Pop-on 180-in Switch 50-50'],
    ['50-50, 180 on the box, switch 50-50, pop off with a 180', [jib({ slides: ['fiftyFifty'], rotations: [[180, 'switchFiftyFifty']] })], out(180, true), '50-50 180 Switch 50-50 180-out'],
    ['frontside boardslide, 270 out', [jib({ entry: 'pop', inDeg: 90, slides: ['frontboard'] })], out(270), 'Frontside Boardslide 270-out'],
    ['270 in to a backside boardslide, 270 out the other way', [jib({ entry: 'pop', inDeg: 270, slides: ['backboard'] })], out(-270), '270-in Backside Boardslide 270-out Pretzel'],
    ['backside boardslide, ride off and turn to fakie', [jib({ entry: 'pop', inDeg: -90, slides: ['backboard'] })], out(-90, true), 'Backside Boardslide to Fakie'],
    ['pop off box A, land on box B in a 50-50', [jib({ slides: ['fiftyFifty'] }), jib({ entry: 'transfer', slides: ['fiftyFifty'] })], null, '50-50 Transfer 50-50'],
    ['nose press the whole flat rail', [jib({ slides: ['fiftyFifty'], press: { nose: 0.95 } })], null, 'Nose Press'],
  ];

export const MORE_NAMES: NameCase[] = [
    // Side approaches spec 6: slide-ons.
    ['slide-on, 50-50', [jib({ entry: 'slideOn', slides: ['fiftyFifty'] })], null, 'Slide-on 50-50'],
    ['edge slide-on from the heelside into a boardslide', [jib({ entry: 'edgeSlideOn', inDeg: 90, slides: ['backboard'] })], null, 'Backside Edge Slide-on Boardslide'],
    ['edge slide-on, switch, frontside lipslide', [jib({ entry: 'edgeSlideOn', inDeg: -90, slides: ['frontLip'], switchStance: true })], null, 'Frontside Edge Slide-on Switch Lipslide'],
    ['slide-on, switch 50-50, 180 out', [jib({ entry: 'slideOn', slides: ['switchFiftyFifty'] })], out(180, false), 'Slide-on Switch 50-50 180-out'],
    ['slide-on, nose press', [jib({ entry: 'slideOn', slides: ['fiftyFifty'], press: { nose: 0.95 } })], null, 'Slide-on Nose Press'],
    ['front ollie-on, 50-50', [jib({ entry: 'ollieOn', slides: ['fiftyFifty'] })], null, 'Ollie-on 50-50'],
    ['front ollie-on, 90 to a frontside boardslide', [jib({ entry: 'ollieOn', inDeg: -90, slides: ['frontboard'] })], null, 'Ollie-on Frontside Boardslide'],
    ['side ollie-on from the toeside, tail first', [jib({ entry: 'sideOllieOn', inDeg: -90, slides: ['frontLip'] })], null, 'Side Ollie-on Frontside Lipslide'],
    ['side ollie-on, backside lipslide, 90 out to forward', [jib({ entry: 'sideOllieOn', inDeg: 90, slides: ['backLip'] })], out(90, false), 'Side Ollie-on Backside Lipslide to Forward'],
    ['pop-on 270 to a backside boardslide', [jib({ entry: 'popOn', inDeg: 270, slides: ['backboard'] })], null, 'Pop-on 270-in Backside Boardslide'],
    ['50-50, 90 to a backside boardslide, 90 back', [jib({ slides: ['fiftyFifty'], rotations: [[90, 'backboard'], [90, 'fiftyFifty']] })], null, '50-50 90 Backside Boardslide 90 50-50'],
    ['frontside boardslide, hard way 180 to backside', [jib({ entry: 'pop', inDeg: 90, slides: ['frontboard'], rotations: [[180, 'backboard', true]] })], null, 'Frontside Boardslide Hard Way 180 Backside Boardslide'],
    ['50-50 with a 360-out', [jib({ slides: ['fiftyFifty'] })], out(360), '50-50 360-out'],
    ['switch 50-50 with a 540-out', [jib({ slides: ['switchFiftyFifty'] })], out(-540, true), 'Switch 50-50 540-out'],
    ['boardslide 450-out', [jib({ entry: 'pop', inDeg: 90, slides: ['backboard'] })], out(450, true), 'Backside Boardslide 450-out'],
    ['tail press', [jib({ slides: ['fiftyFifty'], press: { tail: 0.6 } })], null, 'Tail Press'],
    ['a short press is still a 50-50', [jib({ slides: ['fiftyFifty'], press: { nose: 0.3 } })], null, '50-50'],
    ['switch nose press', [jib({ slides: ['switchFiftyFifty'], press: { nose: 0.8 } })], null, 'Switch Nose Press'],
    ['riding switch into a boardslide', [jib({ entry: 'pop', inDeg: 90, slides: ['backboard'], switchStance: true })], null, 'Switch Backside Boardslide'],
    ['kicker air onto a box', [jib({ entry: 'transfer', inDeg: 180, slides: ['switchFiftyFifty'] })], null, '180-in Switch 50-50 Transfer'],
    ['wall ride 180 out', [jib({ slides: ['wallRide'] })], out(180, true), 'Wall Ride 180-out'],
    ['pop-on 50-50, transfer to a backside boardslide, to fakie', [jib({ entry: 'popOn', slides: ['fiftyFifty'] }), jib({ entry: 'transfer', inDeg: 90, slides: ['backboard'] })], out(-90, true), 'Pop-on 50-50 Transfer Backside Boardslide to Fakie'],
  ];
