# Cable Wakeboarding Mechanics

This document explains how the sport works and where each mechanic lives in the
simulation (`src/sim`). It is the source of truth for *why* the sim behaves the
way it does. When you change a mechanic, update this file in the same commit.

All quantities are SI: metres, seconds, kilograms, newtons, radians. Speeds are
converted to km/h only for display.

---

## 1. The setup: a cable park, not a boat

A cable park tows riders with an **overhead cable** strung between towers around
a lake. Small **carriers** clamp onto the moving cable; each rider holds a rope
hooked to a carrier. There is no boat and no wake: the water is flat, and air
comes from **features** (kickers, sliders, boxes) and from **line tension**.

| Real world | Sim | Notes |
|---|---|---|
| Full-size cable: 4 to 6 towers in a closed loop, usually run counter-clockwise | `CableConfig.towers`, `buildCablePath()` in `cable.ts` | Default layout is a 4-tower rectangle run counter-clockwise viewed from above. |
| The cable turns around a wheel at each tower | `CableConfig.cornerRadius`; the path is straight segments joined by arcs | |
| Cable height above the water, roughly 8 to 12 m | `CableConfig.cableHeight` (default 9 m) | Gives the rope an **upward** angle that a boat rope never has. |
| Carrier speed is set by the operator, roughly 20 to 36 km/h; park riding is often around 30 km/h | `CableConfig.carrierSpeed` (default 8.3 m/s, about 30 km/h) | Constant: the carrier does not slow down for you. |
| Rope from carrier to handle, a fixed length | `RopeConfig.length` (default 18 m) | Defaults are starting points to tune, not measured values. |
| 2-tower systems run back and forth on a straight line | Not modelled yet (see PLAN.md backlog) | The path code takes any tower list, so a 2-tower shuttle is a later add. |

**Carrier kinematics.** The carrier's arc-length position `carrier.s` advances at
`carrierSpeed` every tick (`stepCarrier()`), and `cablePointAt(path, s)` turns it
into a 3D point at `cableHeight`. Because the carrier speed is constant, the rider
can only go faster than the cable by **swinging out** to the side on the rope.

**Corners.** At a tower the carrier swings around the wheel. The rider, 15 m or so
behind and below, does not turn at the same moment: the rope first goes slack
(the carrier is coming back toward the rider) and then snaps tight again as the
carrier pulls away on the new straight. Riders take corners wide and keep an edge
to avoid the jerk. In the sim this is **emergent**: nothing special happens at a
corner; the rope model (`computeRopeTension()`) produces slack and the snap.
`rider.slackTime` counts time spent slack and the `ropeSnap` event fires when the
rope goes tight with high relative speed.

## 2. The rope is the engine

The rope does not stretch in any useful way. The sim models it as a **one-sided
stiff spring-damper** between the carrier and the rider's handle
(`computeRopeTension()` in `rope.ts`):

- Effective length = `rope.length + rider.handleDist` (handle-to-hips distance).
- If the distance carrier-to-hips is shorter than that, tension is zero (slack).
- If longer, tension = `stiffness * stretch + damping * stretchRate`, never negative.

The stiffness stands in for the rider's body and arms, not for rope stretch.
`rider.ropeTension` is the result, in newtons.

**The elevated tow point.** With a 9 m high cable and an 18 m rope the rope
climbs at roughly 30 degrees. So tension has an **upward component**
(`ropeForce.y`): it unweights the rider while riding, helps hold the rider up in
the air, and is the source of lift for flat-water **air tricks**. If the upward
pull exceeds `hydro.liftOffFactor` times body weight while the rider is not
loading, the line lifts the rider off the water (`'lineLift'` takeoff).

**The cut.** The rhythm the physics produces, and the one riders use: edge out
away from the line, switch edges, and the rope goes slack for a moment while
the rider swings back; then it loads up hard as the rider cuts back in. The
peak of that second load is where a flat-water pop belongs. Popping in the
slack gets about half the height.

## 3. Edging

A wakeboard has two edges. For a rider standing sideways on the board:

- **Toeside** edge: the side the toes point at.
- **Heelside** edge: the side the heels are on.

Which world side that is depends on stance (regular = left foot forward, goofy =
right foot forward) and whether the rider is **switch** (riding with the other
foot forward). `toeSign(rider)` in `edge.ts` returns +1 when the toes point to
the right of the board's direction of travel.

**Edge angle.** `rider.edgeAngle` is signed: positive heelside, negative toeside,
limited to `EdgeConfig.maxEdgeAngle`. The player sets a *target* edge through
`InputFrame.edge` in [-1, 1]; `updateEdge()` moves the actual angle toward it at
`edgeBuildRate` (slow) when loading and `edgeReleaseRate` (fast) when flattening.
That rate limit is how the sim enforces a **progressive** edge: you cannot spike
to full load instantly, you have to build it.

**Cut angle.** When the rope is tight, an edge lets the rider hold the board at an
angle to the rope instead of being dragged straight behind the carrier.
`updateHeading()` steers the board heading toward
`ropeHeading + side * maxCutAngle * |edgeAngle| / maxEdgeAngle`. When the rope is
slack the edge instead carves the board around in a turn. The result is the real
pattern: flat board, you trail the carrier; hard edge, you swing wide and go
faster than the cable.

**Edge load.** `computeHydroForces()` in `hydro.ts` resists sideways slip with a
grip that grows with edge angle (a flat board slides, an edged board bites).
The magnitude of that sideways force is `rider.edgeLoad`. It is highest when the
rider leans hard against a tight rope, which is exactly the moment riders call
"loading the line".

## 4. Pop: where air comes from

Air is **energy transfer**, not just rolling off the top of something. Even off a
kicker, a rider who hits it flat and stiff gets a fraction of the height of one
who loads the edge and extends at the lip.

The pop is a vertical velocity impulse computed by `computePop(inputs, config)` in
`pop.ts` from a `PopInputs` record:

| Input | Meaning | Where it comes from |
|---|---|---|
| `edgeLoadAtBase` | Edge load as the rider hits the base of the feature (or the peak load of a flat-water cut) | `rider.load.edgeLoadAtBase` (`LoadTracker` in `pop.ts`) |
| `holdRatio` | Edge load at release divided by load at base; 1 means the edge was held all the way up | `rider.edgeLoad / edgeLoadAtBase` |
| `tensionAtRelease` | Rope tension at the moment of leg extension | `rider.ropeTension` |
| `timing` | 0..1, how well the extension lines up with the lip (or with the peak of the cut) | `popTimingFactor()` |
| `connection` | 0..1 posture quality, see section 5 | `rider.connection` |
| `compression` | How far the legs were bent before extending | `rider.legCompression` |

**How the rider pops.** Holding `InputFrame.load` bends the knees
(`legCompression` rises). Releasing it extends the legs over `pop.extendTime`.
The impulse is applied at release. So the *release* is the timing input:

- Off a **kicker**: the ideal release is just before the board leaves the lip.
  Releasing too early, low on the ramp, lets the ramp absorb it; releasing after
  leaving the lip does nothing (you cannot push off air).
- On **flat water** (air trick): the ideal release is while the edge load is
  still at its peak. Flattening the board first (low `holdRatio`) kills the pop.

## 5. Posture and connection

Good riders keep the handle low and close to the hips, the chest up, and the
arms soft but in. Common faults all **bleed tension**:

- Hinging at the waist (`rider.waistHinge`).
- Letting the handle drift away from the hips (`rider.handleDist` grows).
- Extending the arms early, before the lip (also `handleDist`).
- Letting go (`InputFrame.release`, or grip overload: `RopeConfig.gripLimit`).

Riders call the result being **disconnected**. `updatePosture()` in
`posture.ts` moves `handleDist` and `waistHinge` from inputs and load, and
`connectionFactor()` combines them into `rider.connection` in [0, 1]. A larger
`handleDist` also lengthens the effective rope, so slack and tension loss are
physical, not just a score penalty.

## 6. In the air

`stepAir()` in `air.ts` integrates gravity, rope force and light air drag.
Rotation is tracked separately from the board's ballistic motion in
`rider.air` (`AirState`):

- **Handle position controls rotation and tension.** Handle in (`handleIn` near 1)
  gives faster rotation (smaller moment of inertia) and keeps the rope working;
  handle out slows rotation and bleeds tension.
- **Spins** (`spinAngle`) are driven by `InputFrame.spin`. Spins should start
  *after* the peak. Starting one while still rising sets `air.spunBeforePeak`,
  costs height (`air.earlySpinPenalty`) and is penalised in execution scoring.
- **Inverts** (`flipAngle`) must be committed at takeoff: `InputFrame.flip` held
  when the pop fires sets `air.flipDir` (-1 back, +1 front). The rotation then
  runs by itself for one full turn at `air.invertRate` (faster with the handle
  in); not enough air time means under-rotation, and holding the flip input past
  a full turn keeps rotating (over-rotation). The axis is decided by how hard the
  rider was cutting across the line at takeoff (`air.axis`: `"flip"` when nearly
  straight, `"roll"` when the cut angle exceeds `air.rollAxisCut`).
- **Board direction in the air.** Without a spin the board follows the direction
  of travel, since the rope steers the rider in the air too. Only
  `air.spinAngle` counts toward landing alignment.
- **Raleys** (`air.raley`): with a very hard edge and high tension at takeoff,
  holding `InputFrame.raley` swings the body up above the board using the rope.
  The body must come back down (`air.raleyExtension` back near 0) before landing.
- **Grabs** (`air.grab`): holding a grab input for at least `air.minGrabTime`
  registers it.
- **Air tricks** use the elevated rope for lift instead of a feature: hard cut,
  edge in, pop on flat water.

## 7. Features

Defined as data in `park.ts` (`FeatureDef`) and queried in `features.ts`:

- **Kicker**: a curved ramp described by length, width, height and lip angle.
  `kickerHeightAt(u)` is a power curve whose slope at the lip equals the lip angle.
  On the ramp the board follows the surface (`stepFeature()` in `onFeature.ts`);
  at the lip it launches with the surface's velocity direction plus the pop.
  Riding onto the ramp snapshots `load.edgeLoadAtBase`. On the ramp the hold
  ratio is the edge angle still held relative to the edge angle at the base
  (`ramp.edgeAngleAtBase`): flattening on the way up costs pop. A release on
  the ramp is stored as `ramp.pendingPop` and applied when the board leaves
  the lip; a release on the water before the ramp pops on flat water, which
  usually means landing on the ramp (`featureCrash`).
- **Slider / box / rail**: a flat top at a fixed height, entered by a short entry
  ramp. On it the rider slides with low friction and must keep `rider.jib.balance`
  inside [-1, 1] (`updateJib()`). Being off-centre, holding the board between
  0 and 90 degrees, and the rope's sideways pull tip the balance; leaning with
  the edge input corrects. Board angle relative to the rail (`jib.boardAngle`,
  driven by the spin input) picks the jib trick (`50-50` aligned, `boardslide`
  across). Releasing the load on a slider ollies off it.
- Hitting a feature from the wrong side is a `featureCrash` fall.

**Soft landings.** Landing impact is measured along the surface normal
(`evaluateLanding()`), so landing on a down-ramp or transition is softer than
dropping to flat water from the same height. Absorbing with bent knees
(`legCompression` on touchdown) also softens it.

## 8. Falls

`evaluateLanding()` in `landing.ts` returns `null` (clean) or a `FallKind`:

| Fall | Cause in the sim |
|---|---|
| `buttCheck` | Heavy normal impact without absorbing (legs straight, hinged, raley not returned) |
| `caughtEdge` | Touching down on a big edge angle (`landing.maxEdgeFraction`) |
| `overRotation` / `underRotation` | Invert residual beyond `maxFlipError`, or spin more than `maxYawError` from a whole half turn |
| `droppedHandle` | Player let go, or tension over `gripLimit` for longer than `gripTime` |
| `featureCrash` | Hit a feature from the side or back, or lost balance on a slider |

After a fall the rider is `fallen`; the run session (`session.ts`) counts it and
respawns or ends the run.

## 9. Tricks are data

`tricks/data.ts` holds the catalogue; `tricks/classify.ts` maps what happened in
the air (`AirRecord`) to a name and a difficulty. Nothing about trick names is
hard-coded in the physics.

- **Jumps**: off a kicker, a slider or flat water. `Backside` = heelside approach,
  `Frontside` = toeside approach, `Straight` = no edge, regular or switch
  ("Backside Kicker Air", "Frontside Air Trick"). Boat wakeboarding's one-wake
  and two-wake jumps have no cable equivalent; kicker size plays that role.
  Rolling off a slider or being lifted by the line without popping is not a
  trick.
- **Spins**: 180, 360, 540, 720. Direction: **frontside** (chest opens to the
  direction of travel) or **backside / blind** (back turns first). Frontside sign is
  `-toeSign` in the sim's yaw convention.
- **Inverts** (head becomes the lowest point), the six basics:

  | Trick | Approach | Direction | Axis |
  |---|---|---|---|
  | Tantrum | heelside | back | flip |
  | Heelside backroll | heelside | back | roll |
  | Heelside frontflip | heelside | front | flip |
  | Toeside backroll | toeside | back | roll |
  | Toeside frontflip | toeside | front | flip |
  | Frontroll | toeside | front | roll |

- **Raley**: heelside or toeside, requires `raley.minEdgeLoad` and tension.
- **Grabs**: indy, melon, mute, stalefish, nose, tail.
- **Combos**: named combinations, for example the **scarecrow** = toeside
  frontroll + frontside 180.
- **Jibs**: 50-50, boardslide on sliders.

## 10. Scoring

Competition judging (IWWF style) uses three judges, each scoring 1 to 10 on:

- **Execution** (weight 3.3): clean landings, completed tricks, no falls.
- **Intensity** (weight 3.4): size (height, distance, air time) and difficulty.
- **Composition** (weight 3.3): variety, use of the features, flow, no dead water.

Difficulty modifiers raise a trick's intensity: number of rotations (`SPINS`),
switch, grabbed, blind spins, combos (`MODIFIERS` in `tricks/data.ts`). A run is
two passes (in the sim, two laps of the cable) and two falls end a run. Both are
config (`RunConfig.passesPerRun`, `RunConfig.maxFalls`).

`session.ts` turns sim events into `TrickRecord`s and `FallRecord`s;
`scoring/metrics.ts` aggregates them (`computeRunMetrics()`), and
`scoring/judges.ts` maps metrics to the three criteria (`criteriaFromMetrics()`)
and runs the panel (`scoreRun()`). Each judge has a small deterministic bias from
a seeded RNG so a panel is reproducible. Dead water is time beyond
`run.deadWaterTime` without a trick or a feature.

## Two implementations

Every mechanic above exists twice: in TypeScript (`src/sim`, the web game) and
in Luau (`roblox/src/shared/Sim`, Roblox), with the same function and field
names (`edge.ts` `updateEdge()` is `Edge.luau` `Edge.updateEdge()`, and so on).
Both use `detmath` for trigonometry and powers, so the same inputs give the same
bits; `tests/parity.test.ts` checks it tick by tick. A change to a mechanic is
made in both, in the same commit.
