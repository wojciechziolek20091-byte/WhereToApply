-- GENERATED from src/anim/poses.ts by scripts/gen-luau-data.ts. Do not edit:
-- edit the TypeScript file (it explains the axes and every clip) and rerun.
-- RiderPoses: every base pose, trick clip, grab and crash lead-in as data,
-- for the canonical regular rider; mirrorPose makes goofy and switch.
local RiderPoses = {}

RiderPoses.ALL_CLIPS = {
	{
		name = "cruise",
		keys = { { t = 0, joints = { Hips = { x = 6, y = 10 }, Waist = { x = 8, y = 12, z = 2 }, Neck = { x = 4 } }, knee = 30, pelvis = { z = -0.02 } } },
	},
	{
		name = "heelside",
		keys = {
			{
				t = 0,
				joints = { Hips = { x = 14, y = 16, z = 4 }, Waist = { x = 12, y = 22, z = 8 }, Neck = { x = 2 } },
				knee = 50,
				pelvis = { x = 0.02, z = -0.12 },
				handle = { y = -0.08, z = -0.08 },
			},
		},
	},
	{
		name = "toeside",
		keys = {
			{
				t = 0,
				joints = { Hips = { x = -4, y = -6, z = -2 }, Waist = { x = -6, y = -14, z = -2 }, Neck = { x = 6 } },
				knee = 40,
				pelvis = { z = 0.07 },
				handle = { x = -0.04, z = -0.06 },
			},
		},
	},
	{
		name = "loaded",
		keys = {
			{
				t = 0,
				joints = { Hips = { x = 18, y = 20, z = 6 }, Waist = { x = 18, y = 26, z = 10 }, Neck = { x = -4 } },
				knee = 58,
				pelvis = { z = -0.16 },
				handle = { y = -0.1, z = -0.12 },
			},
		},
	},
	{
		name = "blind",
		keys = { { t = 0, joints = { Hips = { y = -22 }, Waist = { x = 6, y = -40 }, RShoulder = { x = -25, z = -70 }, RElbow = { x = -25 } }, knee = 35 } },
	},
	{ name = "slack", keys = { { t = 0, joints = { Waist = { x = 2, y = 8 }, Neck = { x = -4 } }, knee = 20, handle = { x = 0.08, y = -0.16, z = 0.06 } } } },
	{ name = "air", keys = { { t = 0, joints = { Hips = { x = 8, y = 8 }, Waist = { x = 10, y = 10 }, Neck = { x = 4 } }, knee = 38, handle = { z = -0.06 } } } },
	{ name = "ramp", keys = { { t = 0, joints = { Hips = { x = 8, y = 12 }, Waist = { x = 12, y = 14 }, Neck = { x = 2 } }, knee = 34, handle = { z = -0.08 } } } },
	{ name = "fiftyFifty", keys = { { t = 0, joints = { Hips = { x = 8, y = 10 }, Waist = { x = 10, y = 18 }, Neck = { x = 6 } }, knee = 38 } } },
	{ name = "switchFiftyFifty", keys = { { t = 0, joints = { Hips = { x = 8, y = 10 }, Waist = { x = 10, y = 18 }, Neck = { x = 6 } }, knee = 38 } } },
	{
		name = "backboard",
		keys = { { t = 0, joints = { Hips = { x = 10 }, Waist = { x = 10, y = 0 }, Neck = { x = 10 } }, knee = 42, handle = { x = 0.06, z = 0.04 } } },
	},
	{
		name = "frontboard",
		keys = { { t = 0, joints = { Hips = { x = 10, y = 14 }, Waist = { x = 12, y = 32 }, Neck = { x = 8 } }, knee = 46, handle = { z = -0.2 } } },
	},
	{ name = "charge", keys = { { t = 0, joints = { Waist = { x = 6 } }, handle = { z = -0.06 } } } },
	{ name = "spinCompact", keys = { { t = 0, joints = { Waist = { x = 6 } }, handle = { x = -0.04, z = -0.1 } } } },
	{
		name = "ollie",
		keys = {
			{ t = 0, knee = 16, joints = { Waist = { x = 4 } }, board = { z = 9 } },
			{ t = 0.15, knee = 52, joints = { Waist = { x = 14 } }, board = { z = 2 } },
			{ t = 0.45, knee = 46, joints = { Waist = { x = 12 } }, board = { z = 0 } },
			{ t = 0.85, knee = 32, joints = { Waist = { x = 8 } } },
			{ t = 1, knee = 30, joints = { Waist = { x = 8 } } },
		},
	},
	{
		name = "frontFlip",
		keys = {
			{ t = 0, knee = 18, pelvis = { z = 0.03 }, joints = { Waist = { x = 4 }, Neck = { x = 0 } }, handle = { y = -0.04, z = -0.1 }, aim = 1 },
			{ t = 0.08, knee = 22, joints = { Waist = { x = 10 }, Neck = { x = 6 } }, aim = 1 },
			{ t = 0.2, knee = 72, joints = { Hips = { x = 14 }, Waist = { x = 48 }, Neck = { x = 40 } }, aim = 0.2, handle = { x = -0.04, z = -0.15 } },
			{ t = 0.35, knee = 126, joints = { Hips = { x = 22 }, Waist = { x = 55 }, Neck = { x = 34 } }, aim = 0.1 },
			{ t = 0.6, knee = 120, joints = { Hips = { x = 20 }, Waist = { x = 52 }, Neck = { x = 30 } }, aim = 0.1 },
			{ t = 0.72, knee = 78, joints = { Hips = { x = 10 }, Waist = { x = 24 }, Neck = { x = -20 } }, aim = 0.8 },
			{ t = 0.85, knee = 32, joints = { Hips = { x = 6 }, Waist = { x = 10 }, Neck = { x = 0 } }, aim = 1, handle = { y = -0.04, z = -0.1 } },
			{ t = 1, knee = 30, joints = { Hips = { x = 6 }, Waist = { x = 8 }, Neck = { x = 0 } }, aim = 1 },
		},
	},
	{
		name = "tantrum",
		keys = {
			{ t = 0, knee = 14, pelvis = { z = 0.06 }, joints = { Waist = { x = -8 }, Neck = { x = -10 } }, aim = 1 },
			{ t = 0.1, knee = 18, pelvis = { z = 0.1 }, joints = { Hips = { x = -10 }, Waist = { x = -28 }, Neck = { x = -40 } }, aim = 0.2 },
			{ t = 0.35, knee = 62, pelvis = { z = 0.06 }, joints = { Hips = { x = -12 }, Waist = { x = -32 }, Neck = { x = -45 } }, aim = 0.1 },
			{
				t = 0.5,
				knee = 116,
				pelvis = { z = 0 },
				joints = { Hips = { x = 14 }, Waist = { x = 16 }, Neck = { x = -10 } },
				aim = 0.1,
				handle = { x = -0.04, z = -0.15 },
			},
			{ t = 0.65, knee = 110, joints = { Hips = { x = 16 }, Waist = { x = 18 }, Neck = { x = 0 } }, aim = 0.2 },
			{ t = 0.75, knee = 70, joints = { Hips = { x = 10 }, Waist = { x = 12 }, Neck = { x = 35 } }, aim = 0.6 },
			{ t = 0.85, knee = 32, joints = { Hips = { x = 6 }, Waist = { x = 8 }, Neck = { x = 0 } }, aim = 1 },
			{ t = 1, knee = 30, joints = { Hips = { x = 6 }, Waist = { x = 8 }, Neck = { x = 0 } }, aim = 1 },
		},
	},
	{
		name = "raley",
		keys = {
			{ t = 0, knee = 56, joints = { Hips = { x = 16 }, Waist = { x = 16 }, Neck = { x = -2 } }, handle = { y = -0.1, z = -0.12 } },
			{ t = 0.15, knee = 30, joints = { Hips = { x = 0 }, Waist = { x = 0 }, Neck = { x = -10 } }, handle = { z = -0.05 } },
			{ t = 0.4, knee = 8, joints = { Hips = { x = -12 }, Waist = { x = -22 }, Neck = { x = -35 } }, handle = { x = 0.1, z = 0.1 } },
			{ t = 0.55, knee = 6, joints = { Hips = { x = -14 }, Waist = { x = -25 }, Neck = { x = -38 } }, handle = { x = 0.12, z = 0.12 } },
			{ t = 0.72, knee = 58, joints = { Hips = { x = -4 }, Waist = { x = -8 }, Neck = { x = -18 } }, handle = { x = 0.04, z = 0 } },
			{ t = 0.85, knee = 46, joints = { Hips = { x = 6 }, Waist = { x = 6 }, Neck = { x = -2 } }, handle = { y = -0.05, z = -0.1 } },
			{ t = 1, knee = 32, joints = { Hips = { x = 6 }, Waist = { x = 8 }, Neck = { x = 2 } } },
		},
	},
	{
		name = "backroll",
		keys = {
			{ t = 0, knee = 52, joints = { Hips = { x = 10 }, Waist = { x = -6, z = 12 }, Neck = { x = 6 } }, aim = 1 },
			{ t = 0.08, knee = 46, joints = { Hips = { x = -6 }, Waist = { x = -14, z = 22 }, Neck = { x = 20, y = -42 } }, aim = 0.2 },
			{ t = 0.25, knee = 110, joints = { Hips = { x = 16 }, Waist = { x = 26, z = 12 }, Neck = { x = 24, y = -20 } }, aim = 0.1, handle = { x = -0.04, z = -0.14 } },
			{ t = 0.62, knee = 108, joints = { Hips = { x = 16 }, Waist = { x = 24, z = 8 }, Neck = { x = 20, y = -20 } }, aim = 0.1 },
			{ t = 0.75, knee = 62, joints = { Hips = { x = 8 }, Waist = { x = 12, z = 4 }, Neck = { x = 10, y = -30 } }, aim = 0.7 },
			{ t = 0.85, knee = 32, joints = { Hips = { x = 6 }, Waist = { x = 8, z = 0 }, Neck = { x = 2, y = 0 } }, aim = 1 },
			{ t = 1, knee = 30, joints = { Hips = { x = 6 }, Waist = { x = 8, z = 0 }, Neck = { x = 2, y = 0 } }, aim = 1 },
		},
	},
	{
		name = "frontroll",
		keys = {
			{ t = 0, knee = 50, joints = { Hips = { x = 10 }, Waist = { x = 10, z = -6 }, Neck = { x = 6 } }, aim = 1 },
			{ t = 0.08, knee = 50, joints = { Hips = { x = 14 }, Waist = { x = 28, z = -22 }, Neck = { x = 30, y = 30 } }, aim = 0.2 },
			{ t = 0.25, knee = 112, joints = { Hips = { x = 20 }, Waist = { x = 40, z = -12 }, Neck = { x = 30, y = 20 } }, aim = 0.1, handle = { x = -0.04, z = -0.14 } },
			{ t = 0.62, knee = 110, joints = { Hips = { x = 18 }, Waist = { x = 36, z = -8 }, Neck = { x = 26, y = 20 } }, aim = 0.1 },
			{ t = 0.75, knee = 62, joints = { Hips = { x = 8 }, Waist = { x = 14, z = -4 }, Neck = { x = 8, y = 26 } }, aim = 0.7 },
			{ t = 0.85, knee = 32, joints = { Hips = { x = 6 }, Waist = { x = 8, z = 0 }, Neck = { x = 2, y = 0 } }, aim = 1 },
			{ t = 1, knee = 30, joints = { Hips = { x = 6 }, Waist = { x = 8, z = 0 }, Neck = { x = 2, y = 0 } }, aim = 1 },
		},
	},
	{
		name = "sBendL",
		keys = {
			{ t = 0, knee = 8, joints = { Hips = { x = -12, y = 0 }, Waist = { x = -22, y = 0 }, Neck = { x = -35, y = 0 } }, handle = { x = 0.1, z = 0.1 } },
			{ t = 0.3, knee = 14, joints = { Hips = { x = -6, y = 14 }, Waist = { x = -12, y = 34 }, Neck = { x = -10, y = 40 } }, aim = 0.3 },
			{ t = 0.6, knee = 40, joints = { Hips = { x = 4, y = 12 }, Waist = { x = 6, y = 24 }, Neck = { x = 10, y = 45 } }, aim = 0.4 },
			{ t = 0.85, knee = 36, joints = { Hips = { x = 6, y = 4 }, Waist = { x = 8, y = 8 }, Neck = { x = 2, y = 10 } }, aim = 1 },
			{ t = 1, knee = 32, joints = { Hips = { x = 6, y = 0 }, Waist = { x = 8, y = 0 }, Neck = { x = 2, y = 0 } }, aim = 1 },
		},
	},
	{
		name = "sBendR",
		keys = {
			{ t = 0, knee = 8, joints = { Hips = { x = -12, y = 0 }, Waist = { x = -22, y = 0 }, Neck = { x = -35, y = 0 } }, handle = { x = 0.1, z = 0.1 } },
			{ t = 0.3, knee = 14, joints = { Hips = { x = -6, y = -14 }, Waist = { x = -12, y = -34 }, Neck = { x = -10, y = -40 } }, aim = 0.3 },
			{ t = 0.6, knee = 40, joints = { Hips = { x = 4, y = -12 }, Waist = { x = 6, y = -24 }, Neck = { x = 10, y = -45 } }, aim = 0.4 },
			{ t = 0.85, knee = 36, joints = { Hips = { x = 6, y = -4 }, Waist = { x = 8, y = -8 }, Neck = { x = 2, y = -10 } }, aim = 1 },
			{ t = 1, knee = 32, joints = { Hips = { x = 6, y = 0 }, Waist = { x = 8, y = 0 }, Neck = { x = 2, y = 0 } }, aim = 1 },
		},
	},
	{ name = "indy", keys = { { t = 0, joints = { Hips = { x = 26 }, Waist = { x = 50 }, Neck = { x = 24 } }, knee = { 134, 134 }, aim = 0.4 } } },
	{
		name = "indyTweak",
		keys = { { t = 0, joints = { Hips = { x = 26 }, Waist = { x = 52, y = 10 }, Neck = { x = 18 } }, knee = { 140, 118 }, board = { x = -15 } } },
	},
	{
		name = "stalefish",
		keys = { { t = 0, joints = { Hips = { x = 22, y = -16 }, Waist = { x = 44, y = -28 }, Neck = { x = 18, y = -20 } }, knee = { 124, 140 }, aim = 0.4 } },
	},
	{
		name = "stalefishTweak",
		keys = { { t = 0, joints = { Hips = { x = 22, y = -20 }, Waist = { x = 46, y = -32 } }, knee = { 116, 146 }, board = { x = 15 } } },
	},
	{ name = "nose", keys = { { t = 0, joints = { Hips = { x = 24 }, Waist = { x = 46, y = 18, z = -14 }, Neck = { x = 18 } }, knee = { 142, 96 }, aim = 0.4 } } },
	{ name = "noseTweak", keys = { { t = 0, joints = { Hips = { x = 24 }, Waist = { x = 48, y = 20, z = -16 } }, knee = { 146, 80 }, board = { z = 15 } } } },
	{ name = "tail", keys = { { t = 0, joints = { Hips = { x = 24 }, Waist = { x = 44, y = -14, z = 14 }, Neck = { x = 16 } }, knee = { 96, 142 }, aim = 0.4 } } },
	{ name = "tailTweak", keys = { { t = 0, joints = { Hips = { x = 24 }, Waist = { x = 46, y = -16, z = 16 } }, knee = { 80, 146 }, board = { z = -15 } } } },
	{
		name = "crashForward",
		keys = {
			{
				t = 0,
				knee = 40,
				joints = { Waist = { x = 12 }, LShoulder = { x = -20, y = 0, z = 15 }, RShoulder = { x = -20, y = 0, z = -15 }, LElbow = { x = -20 }, RElbow = { x = -20 } },
				aim = 0.5,
			},
			{
				t = 1,
				knee = 22,
				joints = {
					Hips = { x = 30 },
					Waist = { x = 60 },
					Neck = { x = -30 },
					LShoulder = { x = -100, y = 0, z = 25 },
					RShoulder = { x = -100, y = 0, z = -25 },
					LElbow = { x = -20 },
					RElbow = { x = -20 },
				},
				aim = 0,
			},
		},
	},
	{
		name = "crashSitBack",
		keys = {
			{
				t = 0,
				knee = 40,
				joints = { Waist = { x = 6 }, LShoulder = { x = -30, y = 0, z = 20 }, RShoulder = { x = -20, y = 0, z = -20 }, LElbow = { x = -20 }, RElbow = { x = -20 } },
				aim = 0.5,
			},
			{
				t = 1,
				knee = 95,
				pelvis = { z = -0.18 },
				joints = {
					Hips = { x = -20 },
					Waist = { x = -28 },
					Neck = { x = 10 },
					LShoulder = { x = 55, y = 0, z = 45 },
					RShoulder = { x = 55, y = 0, z = -45 },
					LElbow = { x = -20 },
					RElbow = { x = -20 },
				},
				aim = 0,
			},
		},
	},
	{
		name = "crashSide",
		keys = {
			{
				t = 0,
				knee = 45,
				joints = { Waist = { x = 8 }, LShoulder = { x = -20, y = 0, z = 30 }, RShoulder = { x = -20, y = 0, z = -30 }, LElbow = { x = -20 }, RElbow = { x = -20 } },
				aim = 0.5,
			},
			{
				t = 1,
				knee = 60,
				pelvis = { x = -0.1 },
				joints = {
					Hips = { z = 25 },
					Waist = { z = 40, x = 10 },
					Neck = { z = -20 },
					LShoulder = { x = -40, y = 0, z = 110 },
					RShoulder = { x = -30, y = 0, z = -80 },
					LElbow = { x = -20 },
					RElbow = { x = -20 },
				},
				aim = 0,
			},
		},
	},
	{
		name = "crashFacePlant",
		keys = {
			{
				t = 0,
				knee = 8,
				joints = {
					Waist = { x = -20 },
					Neck = { x = -30 },
					LShoulder = { x = -150, y = 0, z = 10 },
					RShoulder = { x = -150, y = 0, z = -10 },
					LElbow = { x = -20 },
					RElbow = { x = -20 },
				},
				aim = 0,
			},
			{
				t = 1,
				knee = 70,
				joints = {
					Hips = { x = -30 },
					Waist = { x = -35 },
					Neck = { x = -40 },
					LShoulder = { x = -120, y = 0, z = 50 },
					RShoulder = { x = -120, y = 0, z = -50 },
					LElbow = { x = -20 },
					RElbow = { x = -20 },
				},
				aim = 0,
			},
		},
	},
	{
		name = "crashFold",
		keys = {
			{
				t = 0,
				knee = 80,
				joints = { Waist = { x = 26 }, LShoulder = { x = -30, y = 0, z = 15 }, RShoulder = { x = 10, y = 0, z = -30 }, LElbow = { x = -20 }, RElbow = { x = -20 } },
				aim = 0.5,
			},
			{
				t = 1,
				knee = 125,
				joints = {
					Hips = { x = 30 },
					Waist = { x = 62 },
					Neck = { x = 20 },
					LShoulder = { x = -60, y = 0, z = 30 },
					RShoulder = { x = 40, y = 0, z = -50 },
					LElbow = { x = -20 },
					RElbow = { x = -20 },
				},
				aim = 0,
			},
		},
	},
	{
		name = "crashBack",
		keys = {
			{
				t = 0,
				knee = 40,
				joints = { Waist = { x = 0, y = -30 }, LShoulder = { x = -20, y = 0, z = 25 }, RShoulder = { x = -20, y = 0, z = -25 }, LElbow = { x = -20 }, RElbow = { x = -20 } },
				aim = 0.5,
			},
			{
				t = 1,
				knee = 70,
				pelvis = { z = -0.2 },
				joints = {
					Hips = { x = -30 },
					Waist = { x = -45 },
					Neck = { x = -20 },
					LShoulder = { x = -140, y = 0, z = 30 },
					RShoulder = { x = -140, y = 0, z = -30 },
					LElbow = { x = -20 },
					RElbow = { x = -20 },
				},
				aim = 0,
			},
		},
	},
	{
		name = "crashSlipOff",
		keys = {
			{
				t = 0,
				knee = 40,
				joints = { Hips = { z = 6 }, LShoulder = { x = -20, y = 0, z = 40 }, RShoulder = { x = -20, y = 0, z = -40 }, LElbow = { x = -20 }, RElbow = { x = -20 } },
				aim = 0.5,
			},
			{
				t = 1,
				knee = 75,
				pelvis = { z = -0.15, y = -0.1 },
				joints = {
					Hips = { z = 30, x = -10 },
					Waist = { z = -22, x = -10 },
					LShoulder = { x = -60, y = 0, z = 100 },
					RShoulder = { x = -80, y = 0, z = -70 },
					LElbow = { x = -20 },
					RElbow = { x = -20 },
				},
				aim = 0,
			},
		},
	},
	{
		name = "crashYank",
		keys = {
			{
				t = 0,
				knee = 40,
				joints = { Waist = { x = 20 }, LShoulder = { x = -80, y = 0, z = 10 }, RShoulder = { x = -80, y = 0, z = -10 }, LElbow = { x = -20 }, RElbow = { x = -20 } },
				aim = 0.5,
			},
			{
				t = 1,
				knee = 16,
				joints = {
					Hips = { x = 30 },
					Waist = { x = 72 },
					Neck = { x = 20 },
					LShoulder = { x = -150, y = 0, z = 10 },
					RShoulder = { x = -150, y = 0, z = -10 },
					LElbow = { x = -20 },
					RElbow = { x = -20 },
				},
				aim = 0,
			},
		},
	},
}

RiderPoses.CRASH_LEAD_IN = {
	shortOllie = "crashForward",
	missedSafetyPop = "crashForward",
	hitFeature = "crashForward",
	handleDropped = "crashSitBack",
	letGo = "crashSitBack",
	underRotated = "crashSide",
	overRotated = "crashSide",
	badLandingYaw = "crashSide",
	raleyExtendedOnLanding = "crashFacePlant",
	grabHeldOnLanding = "crashFold",
	hardLanding = "crashFold",
	caughtEdgeBlind = "crashBack",
	fellOffFeature = "crashSlipOff",
	ropeYank = "crashYank",
}

return RiderPoses
