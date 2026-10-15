import type { SpringParams } from './spring';

/**
 * AnimConfig: every timing, angle and spring constant of the rider
 * animation (spec rule 3). Keys follow the spec (`AnimConfig.Hand.ReachTime`).
 * Angles in degrees, lengths in metres, times in seconds, springs as
 * { freq (Hz), damping (ratio) }. The Luau copy (Anim/AnimConfig.luau) is
 * generated from this file by scripts/gen-luau-data.ts.
 *
 * The gameplay side of section 11 (tuck-driven rotation, pre-wind, rope at
 * the shoulders, landing speed cost) lives in the sim's config (`physics`),
 * because the sim must stay deterministic and the server replays nothing.
 */
export interface AnimConfig {
  Blend: {
    /** Cross-fade time for a state change (s). */
    Default: number;
    ToLanding: number;
    ToCrashed: number;
    ToAirborne: number;
    ToOnFeature: number;
    /** Inertialization: the old pose's offset decays with this spring. */
    Inertia: SpringParams;
  };
  Hand: {
    /** A hand changing grip travels along a curve for this long (s). */
    ReachTime: number;
    /** Sideways bulge of the reach path, as a fraction of its length. */
    ReachArc: number;
    /** Long reaches take at least their length over this speed (m/s). */
    ReachSpeed: number;
    /**
     * Elbow pole (rider frame, L arm; R is mirrored): out, a little down and
     * back, so it is never along the arm and the elbow never flips up. Blended
     * with last frame's bend so it stays coherent.
     */
    ElbowPole: [number, number, number];
    ElbowCoherence: number;
    /** The elbow's bend direction turns at most this fast (deg/s), so elbows never flip. */
    ElbowTurnRate: number;
    /** Grabs: the pelvis drops toward the board (board to the hand) by up to this much (m). */
    GrabAssistMax: number;
    /** Knee pole: forward over the toes. */
    KneePole: [number, number, number];
  };
  Handle: {
    /** The bar sits this far from the pelvis toward the rope (m)... */
    RopeRadius: number;
    /** ...moved this much to the front of the hips while the pull is ahead (m, rider frame). */
    FrontBias: [number, number, number];
    /** ...and this much behind the back while riding blind. */
    BlindBias: [number, number, number];
    /** Tension at which the arms are fully straight toward the cable (N). */
    FullPullTension: number;
    /** How far the bar can travel toward the cable from the hip (m). */
    MaxReach: number;
    /** How far the bar sags under the hip with a slack rope (m). */
    SlackSag: number;
    Follow: SpringParams;
    /** Dropped handle: drag (1/s) and how hard the rope pulls it back toward the carrier (1/s^2). */
    DropDrag: number;
    DropPull: number;
  };
  Head: {
    MaxYaw: number;
    MaxPitch: number;
    Aim: SpringParams;
    /** Riding: look this far toward the cut, per unit of edge. */
    CutLook: number;
  };
  Riding: {
    Lean: SpringParams;
    Knee: SpringParams;
    /** Edge transition: delay between links of the chain, ankles -> knees -> hips -> shoulders (s). */
    ChainDelay: number;
    /** Low tension blend: full slack pose below this tension (N), none above the second. */
    SlackBelow: number;
    SlackAbove: number;
    /** Extra knee bend at full pop charge (deg). */
    ChargeKnee: number;
    ChatterHz: number;
    ChatterDeg: number;
    /** Speed (m/s) at which chatter is full. */
    ChatterSpeed: number;
    BreathHz: number;
    BreathDeg: number;
    /** Torso pitch toward the cable per kN of tension (deg). */
    TensionPitch: number;
    /** A yank: spring kick of the torso (deg/s) per kN of sudden tension. */
    YankKick: number;
    Yank: SpringParams;
  };
  Spin: {
    /** Upper body counter-rotation while charging a pop with A/D held (deg). */
    PreWind: number;
    /** Head, shoulders and hips lead the board by spin rate times these (s): head first. */
    LeadHead: number;
    LeadShoulders: number;
    LeadHips: number;
    /** Lead caps (deg). */
    MaxLeadHead: number;
    MaxLeadShoulders: number;
    MaxLeadHips: number;
    /** The head spots the landing in the last this-many degrees of a spin. */
    SpotSpin: number;
    /** Knees come up a little mid-spin (deg of extra bend). */
    CompactKnee: number;
    Lead: SpringParams;
    /** Spin-rate bonus for A/D held in the 0.2 s before the pop (section 11.3); used by the sim. */
    PreWindBonus: number;
  };
  Flip: {
    /** The head spots the landing in the last this-many degrees of a flip. */
    SpotFlip: number;
  };
  Roll: {
    /** Rolls turn about an axis tilted from the board axis toward the travel direction (deg). */
    AxisTilt: number;
    /** S-bend axis tilt from the raley swing plane (deg). */
    SBendTilt: number;
  };
  Grab: {
    /** Knees pull up first; the hand reaches after this delay (s). */
    HandDelay: number;
    /** Held longer than this (s), the grab tweaks... */
    TweakAfter: number;
    /** ...over this long (s)... */
    TweakTime: number;
    /** ...tilting the board this far (deg). */
    TweakBoard: number;
    /** The legs extend for landing this long after the hand lets go (s). */
    LegsAfterRelease: number;
  };
  Feature: {
    /** Hip hop at the start of a 90-degree rotation (m). */
    HopHeight: number;
    /** Hip sway per unit of balance (deg) and free-arm counter (deg). */
    BalanceSway: number;
    BalanceArm: number;
    /** Windmill the free arm past this |balance|. */
    WindmillAbove: number;
    WindmillHz: number;
    /** Safety: knee bend per degree of slope. */
    SlopeKnee: number;
  };
  Landing: {
    /**
     * Pelvis drop per m/s of vertical impact (m), clamped. The pelvis keeps
     * the impact speed into the compression and a critically damped spring
     * brings it back, so the return time follows from this (about 3x it, s).
     */
    CompressPerMS: number;
    MaxCompress: number;
    /** Sketchy: torso wobble kick (deg/s) and the return spring. */
    SketchyKick: number;
    Sketchy: SpringParams;
    /** Torso pitch forward per metre of compression (deg). */
    PitchPerMetre: number;
  };
  Crash: {
    /** Lead-in length before the ragdoll takes over (s). */
    LeadIn: number;
  };
  Ragdoll: {
    Gravity: number;
    /** Water: drag (1/s), buoyancy (fraction of gravity when submerged), surface height of the body. */
    WaterDrag: number;
    Buoyancy: number;
    FloatDepth: number;
    AirDrag: number;
    Iterations: number;
    /** Knees and elbows: smallest angle between the bones (deg), so they hinge, not fold backward. */
    MinHinge: number;
  };
  Secondary: {
    FreeArm: SpringParams;
    /** Free arm swings this much against the rotation per 100 deg/s (deg). */
    CounterSwing: number;
    HeadBob: SpringParams;
  };
  Camera: {
    ShakePerMS: number;
    ShakeDecay: number;
    CarveRoll: number;
    PopFovKick: number;
    InvertPullOut: number;
  };
  Vfx: {
    SprayRate: number;
    RoosterEdge: number;
    SplashPerMS: number;
    /** Rope beam: sag of a slack rope (fraction of its length) and taut width scale. */
    RopeSag: number;
    RopeTautWidth: number;
  };
  Sound: Record<'Carve' | 'Pop' | 'Land' | 'GrindBox' | 'GrindRail' | 'HandlePass' | 'RopeSnap' | 'Splash', string>;
  Debug: {
    /** F4 cycles the local time scale through these. */
    TimeScales: number[];
  };
  /**
   * Section 11 switches on the animation side. The gameplay switches are
   * SimConfig.physics; `?physics=old` turns both off in the web game.
   */
  Physics: {
    /** Air rotations turn about the centre of mass, not the board. */
    ComPivot: boolean;
    /** The animated crouch follows popCharge 1:1. */
    CrouchFollowsCharge: boolean;
  };
}

const sp = (freq: number, damping: number): SpringParams => ({ freq, damping });

export const DEFAULT_ANIM_CONFIG: AnimConfig = {
  Blend: { Default: 0.12, ToLanding: 0.08, ToCrashed: 0.05, ToAirborne: 0.1, ToOnFeature: 0.1, Inertia: sp(5, 1) },
  Hand: {
    ReachTime: 0.1,
    ReachArc: 0.15,
    ReachSpeed: 3.2,
    ElbowPole: [0.6, -0.4, -0.8],
    ElbowCoherence: 1.5,
    ElbowTurnRate: 420,
    GrabAssistMax: 0.3,
    KneePole: [0.25, 0, 1],
  },
  Handle: {
    RopeRadius: 0.28,
    FrontBias: [0, -0.08, 0.32],
    BlindBias: [0.06, 0.12, -0.26],
    FullPullTension: 1600,
    MaxReach: 0.38,
    SlackSag: 0.22,
    Follow: sp(4.5, 0.75),
    DropDrag: 1.2,
    DropPull: 40,
  },
  Head: { MaxYaw: 80, MaxPitch: 45, Aim: sp(3, 0.9), CutLook: 22 },
  Riding: {
    Lean: sp(2.6, 0.8),
    Knee: sp(3.2, 0.85),
    ChainDelay: 0.05,
    SlackBelow: 80,
    SlackAbove: 320,
    ChargeKnee: 15,
    ChatterHz: 8,
    ChatterDeg: 2,
    ChatterSpeed: 9,
    BreathHz: 0.3,
    BreathDeg: 1.5,
    TensionPitch: 7,
    YankKick: 260,
    Yank: sp(2.2, 0.45),
  },
  Spin: {
    PreWind: 28,
    LeadHead: 0.12,
    LeadShoulders: 0.08,
    LeadHips: 0.035,
    MaxLeadHead: 55,
    MaxLeadShoulders: 32,
    MaxLeadHips: 12,
    SpotSpin: 90,
    CompactKnee: 18,
    Lead: sp(6, 0.85),
    PreWindBonus: 0.12,
  },
  Flip: { SpotFlip: 120 },
  Roll: { AxisTilt: 30, SBendTilt: 45 },
  Grab: { HandDelay: 0.06, TweakAfter: 0.3, TweakTime: 0.2, TweakBoard: 15, LegsAfterRelease: 0.1 },
  Feature: { HopHeight: 0.06, BalanceSway: 12, BalanceArm: 35, WindmillAbove: 0.7, WindmillHz: 2.2, SlopeKnee: 0.9 },
  Landing: {
    CompressPerMS: 0.045,
    MaxCompress: 0.35,
    SketchyKick: 160,
    Sketchy: sp(2.4, 0.35),
    PitchPerMetre: 60,
  },
  Crash: { LeadIn: 0.22 },
  Ragdoll: { Gravity: 9.81, WaterDrag: 6, Buoyancy: 1.7, FloatDepth: 0.15, AirDrag: 0.05, Iterations: 6, MinHinge: 25 },
  Secondary: { FreeArm: sp(2.2, 0.55), CounterSwing: 6, HeadBob: sp(3.5, 0.6) },
  Camera: { ShakePerMS: 0.05, ShakeDecay: 6, CarveRoll: 4, PopFovKick: 6, InvertPullOut: 2.5 },
  Vfx: { SprayRate: 1400, RoosterEdge: 0.75, SplashPerMS: 40, RopeSag: 0.06, RopeTautWidth: 0.8 },
  Sound: { Carve: '', Pop: '', Land: '', GrindBox: '', GrindRail: '', HandlePass: '', RopeSnap: '', Splash: '' },
  Debug: { TimeScales: [1, 0.25, 0.1] },
  Physics: { ComPivot: true, CrouchFollowsCharge: true },
};
