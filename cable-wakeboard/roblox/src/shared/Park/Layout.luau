--!strict
-- GENERATED from src/sim/parkLayout.ts by scripts/gen-luau-data.ts. Do not edit:
-- edit the TypeScript file and rerun the script.
-- Park/Layout (features spec section 9): every feature of the wake park and
-- the beginner 2-tower system, in the spec's terms: catalogue type, params,
-- segmentOfCable (1-based straight in order of travel), distanceAlong (m),
-- sideOffset (m, + right of the cable line), facing ("WithCable",
-- "AgainstCable" or an angle in radians). The sim's park defs
-- (Sim.ParkLayout.WAKE_PARK / BEGINNER_PARK) are made from these.
-- ParkBuilder.buildPark() builds them into Workspace.Park.Features.
local Layout = {}

Layout.MAIN = {
	{
		id = "L1_MediumKicker_01",
		catalog = "MediumKicker",
		segmentOfCable = 2,
		distanceAlong = 18,
		sideOffset = 4,
		facing = "WithCable",
		line = "Line 1",
		accent = "Orange",
	},
	{
		id = "L1_PipeRail_01",
		catalog = "PipeRail",
		segmentOfCable = 2,
		distanceAlong = 48,
		sideOffset = 3,
		facing = "WithCable",
		line = "Line 1",
		accent = "Orange",
	},
	{ id = "L1_Funbox_01", catalog = "Funbox", segmentOfCable = 2, distanceAlong = 83, sideOffset = 3, facing = "WithCable", line = "Line 1", accent = "Orange" },
	{
		id = "L4_Pyramid_01",
		catalog = "Pyramid",
		segmentOfCable = 3,
		distanceAlong = 14,
		sideOffset = 4,
		facing = "WithCable",
		line = "Line 4",
		accent = "Magenta",
	},
	{
		id = "L4_WallRide_01",
		catalog = "WallRide",
		segmentOfCable = 3,
		distanceAlong = 41,
		sideOffset = 2,
		facing = -0.6,
		line = "Line 4",
		accent = "Magenta",
		side = 1,
	},
	{ id = "L4_Spine_01", catalog = "Spine", segmentOfCable = 4, distanceAlong = 14, sideOffset = 3, facing = "WithCable", line = "Line 4", accent = "Magenta" },
	{ id = "L2_GapBox_01", catalog = "GapBox", segmentOfCable = 5, distanceAlong = 16, sideOffset = 3, facing = "WithCable", line = "Line 2", accent = "Teal" },
	{ id = "L2_KinkRail_01", catalog = "KinkRail", segmentOfCable = 5, distanceAlong = 49, sideOffset = 3, facing = "WithCable", line = "Line 2", accent = "Teal" },
	{
		id = "L2_Transfer_01",
		catalog = "Transfer",
		segmentOfCable = 5,
		distanceAlong = 85,
		sideOffset = 4,
		facing = "WithCable",
		line = "Line 2",
		accent = "Teal",
		side = -1,
	},
	{
		id = "L3_ProKicker_01",
		catalog = "ProKicker",
		segmentOfCable = 5,
		distanceAlong = 116,
		sideOffset = 4,
		facing = "WithCable",
		line = "Line 3",
		accent = "Yellow",
	},
	{
		id = "L3_Rooftop_01",
		catalog = "Rooftop",
		segmentOfCable = 5,
		distanceAlong = 148,
		sideOffset = 3,
		facing = "WithCable",
		line = "Line 3",
		accent = "Yellow",
	},
	{ id = "L3_StepUp_01", catalog = "StepUp", segmentOfCable = 1, distanceAlong = 15, sideOffset = 3, facing = "WithCable", line = "Line 3", accent = "Yellow" },
}

Layout.BEGINNER = {
	{ id = "B_Slider_01", catalog = "Slider", segmentOfCable = 1, distanceAlong = 28, sideOffset = 3, facing = "WithCable", line = "Beginner", accent = "Teal" },
	{
		id = "B_BeginnerKicker_01",
		catalog = "BeginnerKicker",
		segmentOfCable = 1,
		distanceAlong = 62,
		sideOffset = 3,
		facing = "WithCable",
		line = "Beginner",
		accent = "Teal",
	},
	{
		id = "B_Funbox_01",
		catalog = "Funbox",
		segmentOfCable = 1,
		distanceAlong = 96,
		sideOffset = 3,
		facing = "WithCable",
		line = "Beginner",
		accent = "Teal",
		params = { mains = { { height = 0.6, gapBefore = 0, kinks = { { length = 6, angle = 0 } } } }, safetyLength = 2.2, exitLength = 2.2 },
	},
}

return Layout
