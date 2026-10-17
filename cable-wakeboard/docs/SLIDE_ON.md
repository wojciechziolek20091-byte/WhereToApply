# Side approaches: the slide-on

The "Side Approaches Re-imagined (Ollie + Nose-Lift Slide-On)" spec. A side
entry no longer needs the whole board to clear the top. The rider lifts the
nose over the side edge and the base slides up and over it. The numbers are
in `SlideOnConfig` (`src/sim/featureRide/slideOnConfig.ts`,
`DEFAULT_CONFIG.slideOn`; Luau twin `Sim/FeatureRideSlideOnConfig.luau`).

## Reachable heights (spec 4.3, 8.1)

`SlideOnConfig.maxReachableHeight(cfg, charge, noseLift, sideType?, speed?, angle?)`.
Print the table with `npx vite-node scripts/slide-on-table.ts`.

Top height above the water a side entry reaches, at 8.3 m/s with a 20 degree turn-in:

| Charge | Plain side ollie (0 deg) | Slide-on, auto lift 18 deg | Slide-on, W 30 deg | Thin rail | Pipe (18 deg) |
|---|---|---|---|---|---|
| 0 | 0.10 m | 0.37 m | 0.50 m | 0.20 m | 0.37 m |
| 0.25 | 0.19 m | 0.45 m | 0.59 m | 0.29 m | 0.45 m |
| 0.5 | 0.29 m | 0.55 m | 0.69 m | 0.39 m | 0.55 m |
| 0.75 | 0.41 m | 0.67 m | 0.81 m | 0.51 m | 0.67 m |
| 1 | 0.54 m | 0.81 m | 0.94 m | 0.64 m | 0.81 m |

Full charge, 18 degree lift, by turn-in angle:
6 deg: 0.64 m, 10 deg: 0.70 m, 15 deg: 0.81 m, 20 deg: 0.81 m, 25 deg: 0.81 m, 32 deg: 0.81 m

How the calculator works:
- *The pop*: a side-entry pop is the ollie at `SidePopScale` (0.537), so it
  peaks at 0.18 m with no charge and 0.62 m with full charge.
- *Plain side ollie*: the board has to clear the top by `Entry.Clearance`
  (0.08 m).
- *Slide-on*:
  - The nose has to clear the edge by `NoseClearance` (0.03 m, +0.02 m on
    coping). The nose sits half a board (0.7 m) x sin(lift) above the
    board's middle.
  - The rider then climbs from the board's middle up to the top. The budget
    is the inward kinetic energy x `ClimbEfficiency` (0.85) minus the
    edge's scrape (`EdgeFriction`), plus any upward speed left at contact.
- *Thin rails*: the board's middle has to pass over the rail.
- *Round sides*: they start the climb 0.15 m lower.

## Approach tracking and availability (spec 3)

`ApproachTracker` reads each approach, and `featureRide/slideOn.ts`
(`assessSlideOn`) decides whether a slide-on is possible. They give:
- the turn-in toward the feature (`approach.turnIn`, signed) and the
  inward speed;
- where the board will meet the side edge (`contactU`), with the top height,
  edge type and radius there, and the main left after it;
- the highest top this approach can reach (the calculator at the current
  speed and turn-in, full charge, full lift);
- `slideOnBlock`: '' when a slide-on is possible, otherwise why not.

| Check | Default | Block |
|---|---|---|
| Side approach | not dead ahead | `front` |
| Within `TrackRange` of the start | 20 m | `range` |
| Turn-in toward the feature | 6-32 deg | `angle` |
| Off the side | 0.2-2.8 m | `distance` |
| A top at the contact point | | `noTop` |
| No wall over 0.3 m above the top (`sideWall`, or a wall piece) | | `wall` |
| Top no higher than the reachable height | | `height` |
| Main left after contact | 2.0 m | `end` |

Edge types come from the ride data, or from the feature def's `sideType`:
- a round profile is `Round`;
- a flat top narrower than 0.35 m is a thin `Rail`;
- a feature with side faces (the pyramid) is `Bank`;
- wall pieces are `Wall`;
- any other flat top is `Rounded` (the validator's 0.04 m coping radius).

`Coping` and `Kanted` exist only by a def's `sideType` (the catalogue has no
metal-edged ledge).

**Approach cue.** While a slide-on is possible, the side edge on the rider's
side glows soft cyan for 3 m around the contact point, and a disc marks the
contact point. F9 toggles it in the web game, F9 in the Roblox client too.
There is no tutorial yet, so it is on by default.

| | |
|---|---|
| ![Approach](slide-on/cue-approach.jpg) Turned in toward the pipe rail: the near edge glows | ![Top](slide-on/cue-top.jpg) From above: the contact marker on the edge |

## Decisions (where the spec and the game differ)

1. **Side-entry pop height.**
   - The game's ollie is 3.5 to 6.5 m/s up, which clears 0.6 to 2.1 m. With
     that, side entries were never height-limited the way the spec assumes.
   - A pop with a side entry predicted uses `SidePopScale`, so the 4.3 table
     holds. Open-water airs and front ollie-ons keep their height.
   - The alternative is lowering `Ollie.MaxV` for everything.
2. **What the climb lifts.**
   - The spec's climb check measures Δh to the tail. But the more the nose
     lifts, the lower the tail, so more lift would reach lower, against the
     spec's own table.
   - The climb is measured to the board's middle (the rider's mass), and the
     upward speed left at contact counts as energy.
   - `ClimbEfficiency` is tuned from 0.75 to 0.85 so a 30-degree lift
     reaches about 0.95 m at a 20-degree turn-in.
3. **Steep approaches.** `NoseDig` (new) replaces `noseHitSide` for steep
   side approaches; the old reason id stays defined.
4. **The side hop.** A/D toward the feature at the pop still hops sideways.
   It adds to the inward speed of the turn-in.
5. **Sub-steps.** The contact phase runs 4 sub-steps per 60 Hz tick
   (1/240 s), deterministic in both sims.
