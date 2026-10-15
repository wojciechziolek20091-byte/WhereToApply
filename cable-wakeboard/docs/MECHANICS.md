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
| Full-size cable: 4 to 6 towers in a closed loop, usually run counter-clockwise | `CableConfig.towers`, `buildCablePath()` in `cable.ts` | Default layout is the user's sketch: 5 towers in a "house" shape, about 586 m a lap, run counter-clockwise viewed from above (see section 7). |
| The cable turns around a wheel at each tower | `CableConfig.cornerRadius`; the path is straight segments joined by arcs | |
| Cable height above the water, roughly 8 to 12 m | `CableConfig.cableHeight` (default 9 m) | Gives the rope an **upward** angle that a boat rope never has. |
| Carrier speed is set by the operator, roughly 20 to 36 km/h; park riding is often around 30 km/h | `CableConfig.carrierSpeed` (default 8.3 m/s, about 30 km/h) | Constant: the carrier does not slow down for you. |
| Rope from carrier to handle, a fixed length | `RopeConfig.length` (default 18 m) | Defaults are starting points to tune, not measured values. |
| 2-tower systems run back and forth on a straight line | `CableConfig.mode = 'twoTower'` (`buildShuttlePath()`), for testing | The carrier reverses instantly at each end; one lap is there and back. |

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
- If longer, tension = `stiffness * stretch + damping * stretchRate`, never negative,
  capped at `rope.maxTension` (2500 N; 900 N while riding blind).

Defaults k = 4000 N/m, c = 600 N s/m (the design spec's values). The stiffness
stands in for the rider's body and arms, not for rope stretch.
`rider.ropeTension` is the raw value, used by physics; `rider.tensionSmooth`
is an exponential filter (`rope.smoothTau`, 0.08 s) used by the HUD and the
trick logic (`updateTensionTracker()` in `pop.ts`). Cruising sits around 380 N;
a hard heelside cut away from the line passes 1000 N in about 0.9 s and peaks
around 1.4 kN (`scripts/probe-tension.ts` prints a 10 s log).

**Rope yank.** When the rope snaps back taut after being slack with more than
`rope.yankCrashImpulse` (1800 N) while the rider is off balance (poor
connection, landing, or riding blind), the rider crashes (`ropeYank`).

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
limited to `EdgeConfig.maxEdgeAngle`. The player steers with A/D
(`InputFrame.steer`, +1 = right of travel); the sim picks the edge from the
stance (`carveToEdge()`), so carving away from the line is heelside on one
side and toeside on the other. `updateEdge()` moves the actual angle toward it at `updateEdge()` moves the actual angle toward it at
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

## 4. The rider state machine

`rider.mode` is one of ten states (`rider.ts`), and every change goes through
`transition()` in `fsm.ts`, which knows the legal moves (`TRANSITIONS`). With
`debug.enabled` an illegal move throws (so tests catch it) and every move is
logged as a `transition` event with a reason.

| State | Meaning | Step |
|---|---|---|
| `riding` | On the water, handle in front | `stepWater()` |
| `ridingBlind` | On the water, handle behind the back | `stepWater()` |
| `waterTrickLoad` | Loaded: a water trick is armed | `stepWater()` |
| `waterTrickAir` | In the air from a raley, roll or S-bend | `stepAirborne()` |
| `airborne` | In the air from an ollie, kicker or feature exit | `stepAirborne()` |
| `onKicker` | On a kicker ramp | `stepRamp()` |
| `onSafety` | On the sloped entry of a box or rail | `stepRamp()` |
| `onFeature` | Sliding the main of a box or rail | `stepSlide()` |
| `landing` | 0.15 s grace after touching down on the water | `stepWater()` |
| `crashed` | In the water, waiting `crash.respawnDelay` (2.5 s) | `stepCrashed()` |

**Input.** `InputFrame` (`input.ts`) is the raw buttons: `steer` (A/D), `pop`
(Space), `forward` (W), `back` (S), `pass` (Q), `grab` (E), `grabMod` (R/N/T),
`armsOut` (Shift), `letGo` (X). `InputMemory` (`sim.inputs`) turns them into
presses, releases, hold times, A/D taps (shorter than `feature.tapTime`) and
grab chords, inside the sim, so every platform behaves the same.

## 5. Ollies, air and landings

**Ollie.** Holding Space charges `rider.popCharge` from 0 to 1 over
`ollie.chargeTime` (0.5 s); releasing pops with `lerp(ollie.minV, ollie.maxV,
charge)` upward (3.5 to 6.5 m/s: about 0.6 to 2 m of air). See `pop.ts`.

**Flight** (`stepAir()` in `air.ts`): gravity, air drag, and the rope, which
still pulls when taut and shortens big airs.

**Rotation tracker** (`rotation.ts`, state in `air.rot`):
- **Spin** (A/D): `spin.rate` 540 deg/s, reached in `spin.accelTime` 0.1 s. On
  release the spin carries on to the next half turn if that is within
  `spin.maxCarry` (90 deg); otherwise it stops there (under-rotated).
- **Flip** (W front flip, S tantrum) around the board's long axis:
  `flip.rate` 400 deg/s, carrying to the next whole turn within `flip.maxCarry`.
- **Frontside or backside** is decided when a spin starts
  (`rotationSide()`): frontside if the chest turns toward the pull (the rope
  direction) first, backside if the back does.

**Handle system** (`handle.ts`, `rider.handle`: `inFront`, `behind`,
`passing`, `dropped`). The handle stays on the rope, so past a point the
rotation would wrap the rope round the body:
- Backside: pass zone 90-180 deg (and every 360 after). Frontside: the first
  180 needs no pass; the zone is 180-270.
- Q inside the window (centred on the zone; `handlePass.*Window`: 0.18 s off
  kickers, 0.25 s from obstacle exits, water tricks and flat ollies, 0.35 s on
  features) passes the handle. Q at any other time during a rotation drops it.
- No pass, backside, in the air: the rope stops the spin at 180 with the handle
  behind the back: **to blind**. Spinning back the way you came brings it out.
  DECISION (the spec leaves it open): frontside without a pass, the rope pulls
  the rider back to the 180. On a feature a missed pass drops the handle.

**Riding blind** (`ridingBlind`): steering x0.4, edge at most 0.5, tension at
most 900 N, and `blind.maxRideTime` (3 s) before an edge catches. A/D the way
the rider came spins out in 0.4 s; the other way catches an edge. DECISION:
A/D presses in blind are spin-outs, so the reduced steering only applies while
spinning out. Space pops from blind; spinning out in the air is a
"Blind 180 Out".

**Grabs** (E): indy; E+R stalefish, E+N nose, E+T tail. A modifier pressed
within `grab.chordWindow` (0.08 s) of E still counts (`updateInputMemory()`).
Grab times accumulate in `air.grabTimes`.

**Landing** (`evaluateLanding()` in `landing.ts`), in order:
handle dropped; flip or roll off a whole turn by more than
`landing.maxFlipError` (40 deg; under/over-rotated); board more than
`landing.maxYawError` (35 deg) off forward or switch; a grab still held
(DECISION `landing.grabHeldCrashes`: crash, else the combo multiplier halves);
a raley still extended more than `waterTrick.maxLandingExtension` (30 deg);
impact beyond what the legs absorb. Both errors under `landing.cleanThreshold`
(12 deg) is a clean landing (+10% points). A landing after an odd number of
half turns flips the stance (switch). Landing with the handle behind goes to
`ridingBlind` after the grace.

## 6. Water tricks (tension based)

`waterTrick.ts`. **Arming** (`canArm()`): on the water, travelling more than
`waterTrick.sidewaysAngle` (35 deg) off the rope direction, smoothed tension
over `waterTrick.tensionThreshold` (1000 N), edge over 0.7 and the handle in
front: the rider is `waterTrickLoad` (LOADED on the HUD). Below the threshold
minus `hysteresis` (100 N) it disarms. A held heelside cut stays loaded for
about 1.2 s.

**Pop.** Releasing Space while loaded launches a water trick. Timing
(`waterTrickTiming()` in `pop.ts`) is how close the release is to the tension
peak of the last `historyTime` (0.4 s): after the peak, `1 - age / peakWindow`;
still rising, the time to the peak predicted from the first and second
differences. Height `h = baseHeight (T/1000)^1.2 (0.5 + 0.5 timing)`, capped at
`maxHeight` (`waterTrickHeight()`); the pop speed is `sqrt(2 g h)`.

**Which trick** (`planWaterTrick()`): Space alone a **raley**, S + Space a
**backroll**, W + Space a **frontroll**. Rolls turn one full roll at the rate
that fits the planned airtime, but never faster than the rate for
`minRollHeight` (1.4 m): a lower pop cannot finish the roll.

**Raley phases** over progress `u` (0..1 of the planned airtime,
`raleyExtension()`): pop to `popPhaseEnd`, extended (body horizontal, board
above the head) to `extensionEnd`, swing down to `swingDownEnd`, landing prep.
Spinning, grabbing or an S-bend during the swing-down slows it
(`heldSwingFactor`), so staying busy can land the rider still extended (crash).

**S-bend**: A/D in the raley position, inside `sBend.windowStart`-`windowEnd`
(0.25-0.45 of the airtime), rolls the raley sideways; outside the window A/D
just spins. **Mobe**: any invert with at least a 360 spin.

## 7. Features

Defined as data in `park.ts` (`FeatureDef`) and queried in `features.ts`;
ridden in `onFeature.ts`.

- **Kicker**: a curved ramp (length, width, height, lip angle;
  `kickerHeightAt(u)` is a power curve whose slope at the lip is the lip
  angle). On the ramp (`onKicker`) no tricks: the board follows the surface and
  launches with the ramp's exit velocity. A Space release within
  `kicker.lipPopWindow` (0.12 s) before the lip adds `kicker.lipPopBonus` (20%)
  of the vertical speed. The air off a kicker is the full air domain.
- **Box, rail, pipe** (`SliderDef`, `style` is the look): a **safety** (the
  entry ramp, `entryLength`) and a **main** (the slide surface).
  `safety: 'flush' | 'gap'`.
  - **Ollie on** from the water: coming in below the main's top plus
    `ollie.clearance` (0.1 m) clips the edge (`shortOllie`), checked per part as
    the board flies onto it (`airOverFeature()`).
  - **Safety pop**: only the last `safety.popWindowFraction` of the safety
    counts, at least `safety.popWindowMinMetres` (`safetyWindow()`). In the
    window: onto the main; its centre `perfectFraction` is a "Pop-on" (+150).
    Too early: gap crashes, flush makes the entry sketchy (combo x0.8). No
    pop: gap crashes (`missedSafetyPop`), flush rides on.
  - **On the main** (`onFeature`, `rider.jib`): A/D held past `feature.tapTime`
    turns the board in 90-degree steps (`rotateTimePer90`, 0.18 s); taps correct
    the balance instead. Board angle names the slide (`slideIdAt()`): parallel
    is a **50-50** (a **Switch 50-50** after a half turn), perpendicular with
    the chest toward the direction of travel a **Backboard**, with the back
    toward it a **Frontboard**. Rotations through a backside pass zone need Q in
    the 0.35 s window, or the handle drops. Balance drifts with smooth noise
    (`valueNoise()`, faster on rails) and the rope's sideways pull; past +-1 the
    rider falls off. `feature.balanceEnabled` turns it off.
  - **Exit**: Space pops off; riding off the end rolls off. The air starts with
    the board's angle on the feature (`air.spinStart`), so leaving a boardslide
    needs a "90 Off" or "270 Off" spin to land.

**The default park** (`parkLayout.ts`): the cable layout is the user's sketch
(`docs/park-sketch.jpg`), a five-tower "house" loop with tall sides and a
peaked roof to the north, about 586 m a lap, run counter-clockwise so the
inside of the loop is to the rider's left (`offset` < 0). Every feature faces
the direction of travel. Ten features where the sketch puts them: 5 kickers, 3
round pipes, a box and a kick rail. The kick rail and long pipe have gap
safeties, the rest flush. Runs start from the starting dock on the south line
(`ParkDef.startS`). The scenery follows the user's park map and photos
(`ParkDef.site`, renderers only). The sim does not collide with land; the
shoreline keeps at least 12 m from the cable and the island at least 18 m
(`tests/site.test.ts`).

**The test map** (`TEST_PARK`, `?park=test`, spec section 16): a 1.2 m kicker,
a flush funbox, a gap box and an 8 m rail, all on the line.

## 8. Crashes

Every crash goes through `crash(s, reason)` in `actions.ts`: the handle goes
(the rope slackens), the combo is voided, and the rider waits
`crash.respawnDelay` (2.5 s) before respawning on the cable behind the carrier.

| Reason | Cause |
|---|---|
| `shortOllie` | Flew into a main below its top plus the clearance |
| `missedSafetyPop` | Gap safety without a valid pop |
| `handleDropped` | Q at the wrong time, or a missed pass on a feature |
| `underRotated` / `overRotated` | Spin or flip off at touchdown |
| `grabHeldOnLanding` | Still grabbing at touchdown |
| `raleyExtendedOnLanding` | Raley not swung down in time |
| `caughtEdgeBlind` | Wrong spin-out direction, or blind too long |
| `fellOffFeature` | Balance out of range, stalled, or off the side |
| `ropeYank` | Hard snap back to taut while off balance |
| `badLandingYaw` | Board sideways without having spun |
| `hardLanding` | Impact beyond what the legs absorb |
| `hitFeature` | Rode or flew into a kicker or safety the wrong way |
| `letGo` | Let go of the handle (X) |

## 9. Tricks, names and points

`tricks/data.ts` is the registry (spec section 11.4): base points for the
raley (300), tantrum and front flip (400), rolls (450), S-bend (600), spins
(150 per 180, backside x1.2), handle passes (100), grabs (60 per 0.25 s held,
up to 4), landing to blind (+150), blind out (+200), Mobe (+350), pop-on (+150),
slides per second (50-50 80, boardslides 120), ollie 50.

`tricks/classify.ts` turns one air (`classifyAir()`) or one slide
(`classifySlide()`) into a `TrickResult` with **tokens** (`Entry`, `Slide`,
`Spin`, `Flip`, `Invert`, `Grab`, `HandlePass`, `Blind`, `Exit`, `Pop`) and a
name: "Backside 360 Indy", "Tantrum to Blind", "Mobe Stalefish", "Front Flip
Nose", "Blind 180 Out", "Pop-on 50-50 to Backboard", "270 Off".

## 10. Combos and scoring

**Combos** (`session.ts`, `scoring/combo.ts`): tricks chain while each new one
starts within `combo.linkWindow` (2 s of riding on the water after the last
landing; time in the air or on a feature does not count). Combo score =
`sum(points x quality x repeat) x min(4, 1 + 0.25 (n - 1)) x product(comboFactor)`,
where repeating a name in the same combo scores it x0.5. A crash voids the
whole combo. Banked combos add to `run.points` (the HUD and the leaderboard).

**Judges.** At the end of a run (two passes, or `run.maxFalls` crashes) a
panel of three judges also scores it IWWF-style from the trick log
(`scoring/metrics.ts`, `scoring/judges.ts`): execution (landing quality, pops,
sketchy landings, crashes), intensity (difficulty = points / 250, height, air
time) and composition (variety, use of the park, flow without dead water),
weighted 3.3 / 3.4 / 3.3. Each judge has a small seeded bias.

**Roblox server validation**: the client sends `ComboEnded` with the combo's
tricks and tokens; `roblox/src/shared/ComboValidator.luau` checks them
(airtime and rotation physically possible, token points follow the registry,
points add up, timestamps in order) and recomputes the score with the same
`ScoringCombo` before it reaches leaderstats.

## Two implementations

Every mechanic above exists twice: in TypeScript (`src/sim`, the web game) and
in Luau (`roblox/src/shared/Sim`, Roblox), with the same function and field
names (`edge.ts` `updateEdge()` is `Edge.luau` `Edge.updateEdge()`, and so on).
Both use `detmath` for trigonometry and powers, so the same inputs give the same
bits; `tests/parity.test.ts` checks it tick by tick. A change to a mechanic is
made in both, in the same commit.
