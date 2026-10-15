# Rider animation

The rider is animated by a procedural, layered system written once in
TypeScript (`src/anim`) and once in Luau (`roblox/src/shared/Anim`). The two
are kept equal by `tests/animParity.test.ts`. The web game and the Roblox client
both run it; gameplay never reads from it.

## The contract: `RiderAnimState`

The animation reads one table per frame (spec 0.2), built from the sim by
`animStateFromSim` (TS, `state.ts`) / `RiderAnimStateAdapter.fromSim` (Luau).
Field names follow the spec. `ext` holds what the spec's table leaves out:

| Field | Source |
|---|---|
| state, stance, isSwitch, speed, velocity, edge, tension, popCharge | rider state |
| boardCFrame | sim position + `render/pose.ts` (yaw, inverts, edge tilt; the raley swing is the animator's) |
| handlePosition | hips moved toward the carrier by the posture's handle distance (the sim has no handle point) |
| trick.id | derived: Ollie, Spin, FrontFlip, Tantrum, Raley, Backroll, Frontroll, SBendL/R, Mobe |
| trick.phase | water tricks: the sim's `u`; other airs: air time / predicted airtime (from height and vertical speed) |
| spin/flip degrees, spin direction, grab, grab time | rotation tracker, grab chord |
| handle, passProgress | handle state, pass timer |
| feature.slide, feature.balance | `slideIdAt`, jib balance |
| landing | the tick's `landed` / `crash` event (kept through the landing state) |
| crashReason | `lastCrash` while crashed |
| ext | toes, carrier, airtime, spin rate and what is left of the spin or flip, pre-wind, raley extension, roll, S-bend side, slope, feature turn, one-shot flags |

## Layers (spec 1)

All in `animator.ts` / `Animator.luau`, on a channel pose (`channels.ts`): 15
joints x 3 Euler angles (degrees), pelvis offset, knee bends, handle offset,
tuck, board tweak and head-aim weight.

1. **Base pose**: cruise, heelside, toeside, loaded, blind, slack, charge,
   ramp, air and the four slides, from `poses.ts` (data). The edge reaches the
   knees, then the hips, then the shoulders, `Riding.ChainDelay` apart.
2. **Trick layer**: clips sampled with Hermite curves. The flip and roll clips
   follow rotation progress: the throw comes at the takeoff, the tuck while
   turning, opening and spotting at about 270 degrees. The raley follows the
   sim's phase. Grabs bring the knees up first and the hand after
   `Grab.HandDelay`, then tweak after `Grab.TweakAfter`. Each crash reason has
   a lead-in clip.
3. **Reactions** (springs): torso pitch with tension, yank kick, landing
   compression (the pelvis keeps the impact speed, peak depth
   `CompressPerMS` x impact), sketchy wobble, chatter, breathing.
4. **IK**:
   - Legs: hips to the bindings. Knee bend sets the pelvis height.
   - Arms: two-bone to the handle grips or a board grab point, reaching along
     a curve. The elbow pole lives in the chest frame and its turn speed is
     limited, so elbows never flip.
   - Head: aims with a spring, clamped to +-80 / +-45 degrees.
5. **Secondary**:
   - Spines in spins lead in order: head, then shoulders, then hips, the board
     last.
   - The head spots the landing in the last 90 degrees.
   - Pre-wind before the pop.
   - Free arms counter-swing, balance and windmill.

- **Blending:** every state change is inertialized (the old pose's offset decays
  with a critically damped spring over `Blend.*`), so nothing snaps.
- **Stances:** goofy and switch use `mirrorPose`. No clip is authored twice.
- **The handle is an object:**
  - It sits toward the rope from the pelvis, in front of the hips while the pull
    is ahead, and behind the back when blind.
  - It stays at the lead hip during inverts, and is kept within arm's reach.
  - It flies off on the rope when dropped.
  - The bar's ends never swap.
- **Inverts turn about the centre of mass:** at takeoff the centre of mass
  takes over the sim's trajectory, and the board is placed around it (spec 5.1).
- **Crashes:** a lead-in clip, then a shared verlet ragdoll (points on the joints,
  bones and braces, hinge limits, water buoyancy and drag). The board floats
  off on its own.

## Rigs

- **Web** (`render/babylon/character.ts`): one TransformNode per bone. The art is
  merged per bone, and `applyFrame` sets the nodes.
- **Roblox** (`RiderBuilder.luau`): one invisible `Bone<Joint>` part per joint,
  a Motor6D named after the joint, and the art welded to its bone.
  - `RiderBuilder.rigDef` gives the animator the rest pose in metres.
  - `RiderRig.apply` does PivotTo, writes `Motor6D.Transform` (in
    PreSimulation) and moves the handle model.
  - `RigMap` also maps the joints to R15 names (untested; the game uses the
    custom rig).

Both rigs rest upright and mirror-symmetric, with bone rest orientation
identity, so a joint's local rotation is its Transform.

## Section 11: physics that the animation needs

Gameplay flags in `SimConfig.physics`, animation flags in
`AnimConfig.Physics`. `?physics=old` turns them all off in the web game.

| Change | Where | Effect |
|---|---|---|
| Rotation about the centre of mass | anim | looks only; the sim is a point mass |
| Angular momentum + tuck | sim `bodyPhysics.ts` | flips: rate = L / I(tuck) along `flipTuck`, L set so a whole turn takes the old time. Spins slow while opening to spot. |
| Pre-wind | sim | A/D in the 0.2 s before the pop: that spin +12% |
| Rope at the shoulders | sim | the pull's direction comes from the shoulders; the stretch (tension) is still measured at the handle |
| Landing speed cost | sim | 1.2% per m/s of impact, twice that when sketchy |
| Pop strength from compression | already | the pop uses the charge; the crouch follows `popCharge` 1:1 |

How the feel changed: the trick play-test stayed at 98/110 (as before). A flip
throws slowly, whips through the tuck and slows to spot. A quick frontside tap
is a little more likely to stop short (4/5 instead of 5/5).

## Debugging (spec 13)

| | Web | Roblox |
|---|---|---|
| Slow motion 1 / 0.25 / 0.1 | F4 | F4 |
| Skeleton, COM, rotation axis, IK targets | F6 | F6 (adornments) |
| Pose scrubber | F7 (panel), `?scrub=Name&u=0.5` | F7, `[` `]` clip, `-` `=` phase |
| Captures | `?clean=1&cam=front\|back\|side` | - |

The scrubber plays an `AnimTestDriver` scenario (every trick, slide, landing
and crash) from its start up to `u`, so springs and blends are where they
would be in play.

## Replication (spec 12)

- **Sending:** clients send a 50-number packet (`AnimReplication`: state,
  trick, phase, spin, flip, edge, tension, handle, grab, board pose, carrier,
  one-shot flags) at 18 Hz over the `AnimState` UnreliableRemoteEvent.
- **Server:** checks the shape and rate, then relays it.
- **Receivers:** stamp packets with their arrival time, sample 0.15 s behind
  (interpolating, slerping the board), and run the same animator. Hand states
  and the tuck are rebuilt, not sent.

## Tests

- `tests/anim.test.ts`:
  - clips and mirroring;
  - springs;
  - feet in the bindings and hands on the grips in every scenario;
  - grabs reach the board;
  - no one-frame snaps;
  - the centre of mass rides the trajectory;
  - the ragdoll floats;
  - the crouch follows the charge.
- `tests/bodyPhysics.test.ts`: section 11 in the sim.
- `tests/animParity.test.ts`: TS and Luau give the same frames (seeded runs and
  every scenario, to 1e-6).
- `tests/robloxRig.test.ts`: under the Roblox mock, chaining the real rig's
  Motor6Ds lands every bone on the animated joints (both stances).
- `tests/character.test.ts`: the web rig's nodes match the animator.

## AnimConfig values changed in the polish pass

| Value | Spec / first value | Final | Why |
|---|---|---|---|
| Hand.ReachArc | 0.35 | 0.15 | big bulges made reaches whip |
| Hand.ReachSpeed | (new) | 3.2 m/s | long reaches (grab to tail) take their length over this, not a flat 0.1 s |
| Hand.ElbowPole | down, slightly out | out, a little down and back | "down" lies along a hanging arm, so elbows flipped |
| Hand.ElbowCoherence, ElbowTurnRate | (new) | 1.5, 420 deg/s | elbows kept coherent frame to frame |
| Hand.GrabAssistMax | (new) | 0.3 m | "board to the hand": the pelvis drops until the grab is reachable |
| Handle.LeadHipOffset | (first draft) | RopeRadius 0.28, FrontBias, BlindBias | the bar's place is now a continuous function of the rope's 3D direction (no jump in inverts) |
| Landing.Return spring | 2.2 Hz | derived from CompressPerMS | the pelvis carries the impact speed; return about 0.37 s |
| Ragdoll.WaterDrag / Buoyancy / FloatDepth | 2.6 / 1.25 / 0.12 | 6 / 1.7 / 0.15 | the body sank a metre before floating |
| physics.spinTuckIn / spinOpen (sim) | 0.12 s / 90 deg | 0.03 s / 45 deg | the slow tuck-in made handle passes miss (93 -> 98 of 110) |
| Poses: grab knees | 90 deg | 125-146 deg, torso fold 70-75 deg | the arms are short: the board has to come up to the hand |
| Poses: ollie tuck | 52 deg | 72 deg | read as stiff at 0.25x |
| Poses: slides | 30-40 deg knees | 38-46 deg | upright and stiff on features |

## Still stiff, or not done

- **Not seen in Studio.** The Roblox side is checked by the parity test and by
  the Motor6D chain test under a mock, not by eye. The camera, beam sag,
  particles and sounds need a look in Studio.
- **No sound assets:** `AnimConfig.Sound` ids are empty, so every hook is silent.
- **Raley swing plane:** the body swings about the board's long axis toward
  the toe side. When the rope comes mostly from ahead, the body does not point
  at the cable.
- **Crash lead-ins:** these move the body but not the board. The "board catches
  an edge" part is only the root's blend from its last orientation.
- **Re-gripping in fast spins:** when the hands swap ends of the bar mid-spin,
  the reach restarts from rest. It shows as a small hitch (about 5 cm in one
  frame at 540 deg/s).
- **Free-hand pose details:** fingers, palm-up on the receiving hand.
  The rig has no fingers.
- **R15:** mapped but untested.
