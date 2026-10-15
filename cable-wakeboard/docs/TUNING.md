# Tuning (milestone 10)

Every value lives in `src/sim/config.ts` (generated into `roblox/src/shared/Sim/Config.luau`
by `scripts/gen-luau-data.ts`). Angles are stored in radians and are shown here in degrees.

## How it was play-tested

There is no Studio connection from this environment, so the play-test is scripted:
`npx vite-node scripts/probe-tuning.ts` plays every trick 5 times through the real sim,
with the input timing shifted on each attempt (early, late, short and long holds) the way
a player's would be. Last run: **98 of 110 attempts landed the intended trick.**

| Trick | Landed | What the misses were |
|---|---|---|
| Ollie, BS/FS 180, BS 180 to Blind, BS/FS 360 (pass) | 5/5 (FS 180 4/5) | FS 180 tapped too briefly stops short: under-rotated |
| Front Flip, Tantrum | 5/5 | |
| Indy, Stalefish, Nose, Tail | 5/5 each | |
| Blind 180 Out | 5/5 | |
| Kicker lip pop | 5/5 | |
| Kicker BS 360 (pass) | 2/5 | pass outside the 0.18 s kicker window: handle dropped |
| Pop-on (gap box) | 3/5 | popped late: rode on as a plain 50-50 |
| 50-50 to Backboard + 90 Off, 180 on | 5/5 | |
| Raley, Backroll, Frontroll, S-Bend, Mobe, Raley Indy | 4/5 each | released before LOADED: plain ollie or spin |

The remaining misses are the spec's intended difficulty (tight kicker window, LOADED gate),
not bugs.

## Final values

| Group | Value | Final | Notes |
|---|---|---|---|
| rope | length | 18 m | |
| | stiffness / damping | **4000 / 600** | was 8000 / 900 |
| | maxTension | 2500 N | blind cap 900 N |
| | yankCrashImpulse | 1800 N·s | |
| | smoothTau | 0.08 s | meter and trick detection |
| edge | maxEdgeAngle | 40° | |
| | maxCutAngle | **47° (0.82 rad)** | was 0.9 rad |
| | yawResponse / maxYawRate | 3.5 / 143°/s | |
| ollie | chargeTime | 0.5 s | |
| | minV / maxV | 3.5 / 6.5 m/s | |
| | clearance | 0.1 m | short ollie over a gap = crash |
| kicker | lipPopWindow / lipPopBonus | 0.12 s / +20% | |
| safety | popWindowFraction | 8% of length | |
| | popWindowMinMetres | **1.0 m** | was 0.5 m (0.024 s window at speed) |
| | perfectFraction / sketchyMultiplier | 0.4 / 0.8 | |
| spin | rate / accelTime / maxCarry | 540°/s / 0.1 s / 90° | |
| flip | rate / maxCarry | 400°/s / 60° | |
| handlePass | feature / kicker / obstacle air / water trick / flat | 0.35 / 0.18 / 0.25 / 0.25 / 0.25 s | |
| | passTime | 0.15 s | |
| blind | maxRideTime | 3 s | then caughtEdgeBlind |
| | steerFactor / maxEdge / maxTension | 0.4 / 0.5 / 900 N | |
| | spinOutTime | 0.4 s | |
| waterTrick | tensionThreshold / hysteresis | 1000 / 100 N | LOADED |
| | minEdge / sidewaysAngle | 0.7 / 35° | |
| | peakWindow / historyTime | 0.15 / 0.4 s | |
| | baseHeight / maxHeight / minRollHeight | 1.8 / 4.5 / 1.4 m | |
| | maxLandingExtension | 30° | |
| | raley phases (pop / extend / swing) | u 0.15 / 0.55 / 0.85 | |
| sBend | window | u 0.25–0.45 | |
| grab | chordWindow | 0.08 s | |
| air | dragCoef / minAirTime | 0.4 / 0.25 s | |
| landing | maxYawError / maxFlipError | 35° / 40° | |
| | cleanThreshold / cleanBonus | **12° / +10%** | new |
| | stiffImpact / absorbImpact | **9.0 / 2.0 m/s** | was 6.5 / 4.0 |
| | graceTime | 0.15 s | |
| feature | rotateTimePer90 / tapTime | 0.18 / 0.15 s | |
| | balanceDrift box / rail | 0.9 / 1.6 | |
| | balanceNoiseRate / tapStrength | 1.3 / 0.35 | |
| | ropeTip | 1400 N | |
| combo | linkWindow | 2 s on water | |
| | repeatPenalty | 0.5 | |
| | perTrick / maxMultiplier | +0.25 / ×4 | |
| crash | respawnDelay | 2.5 s | behind the carrier |

## What changed and why

- **Rope 8000/900 → 4000/600, maxCutAngle 0.9 → 0.82:** a hard cut hit 1.9 kN and
  every water trick landed as a hard-landing crash. Now: cruising ≈ 380 N, a full cut
  reaches 1000 N in ≈ 0.87 s and peaks ≈ 1.43 kN.
- **Landing impact 6.5/4 → 9/2 m/s:** a 2.5–3 m raley comes down at ≈ 7.5 m/s; with the old
  limits only a perfectly absorbed landing survived.
- **Safety pop window min 0.5 → 1.0 m:** at feature speed 0.5 m was 0.024 s, under two ticks.
  1.0 m is ≈ 0.12 s, matching the kicker lip window.

## What still feels off

1. **Kicker 360 pass (0.18 s window) is strict.** 2/5 in the probe. Intended by the spec, but
   it may feel unfair with network or frame-rate jitter in Roblox; 0.22 s is a gentle option.
2. **Frontside spins stop short on a quick tap.** The 90° carry plus the rope stopping the
   frontside at 180 means a tap under ≈ 0.22 s under-rotates. Correct, but it reads as "the
   game ate my spin".
3. **LOADED takes ≈ 1.2 s of hard cutting.** Fine for a cable, but popping early silently
   gives an ollie. The meter's 1000 N mark and the LOADED label help; a sound cue would help more.
4. **DECISION: frontside with no pass pulls back to 180** (`handlePass` behaviour). The other
   reading (frontside to blind) is not implemented as a switch yet.
5. **DECISION: blind spin-out uses A/D the way you came.** Some players will expect the
   opposite key.
6. **No ragdoll.** Crashes play a tumble and respawn after 2.5 s.
7. **Not run in Studio.** All numbers were tuned in the TypeScript sim (bit-identical to the
   Luau one). Studio may still need camera, rope visual and HUD tweaks.
