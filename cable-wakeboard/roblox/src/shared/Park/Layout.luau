--!strict
-- GENERATED from src/sim/parkLayout.ts by scripts/gen-luau-data.ts. Do not edit:
-- edit the TypeScript file and rerun the script.
-- Park/Layout (layout spec section 1): the wake park and the beginner line in
-- the spec's format: featureId, type (catalogue), straight (1-based in order
-- of travel), alongFraction (the centre along the straight), side ("L" / "R"
-- of travel), sideOffset (m, to the centre), angleIn (degrees toward the
-- cable at the exit), params. Park/PlaceFeatures turns them into the sim's
-- feature defs from the cable path (Sim.ParkLayout.WAKE_PARK /
-- BEGINNER_PARK hold the result); Park/LayoutValidator checks them against
-- RULES. FEATURES_SPEC_MAIN / FEATURES_SPEC_BEGINNER: the features spec's
-- earlier lines (segmentOfCable / distanceAlong), kept for reference.
local Layout = {}

Layout.MAIN = {
	{ featureId = "S1_Slider", type = "Slider", straight = 1, alongFraction = 0.2333, side = "L", sideOffset = 3.5, angleIn = 8, accent = "Orange" },
	{ featureId = "S1_Funbox", type = "Funbox", straight = 1, alongFraction = 0.5082, side = "R", sideOffset = 3.5, angleIn = 8, accent = "Orange" },
	{ featureId = "S1_MediumKicker", type = "MediumKicker", straight = 1, alongFraction = 0.7746, side = "L", sideOffset = 5.5, angleIn = 8, accent = "Orange" },
	{ featureId = "S2_PipeRail", type = "PipeRail", straight = 2, alongFraction = 0.2405, side = "R", sideOffset = 3.5, angleIn = 8, accent = "Teal" },
	{ featureId = "S2_GapBox", type = "GapBox", straight = 2, alongFraction = 0.4962, side = "L", sideOffset = 3.5, angleIn = 8, accent = "Teal" },
	{ featureId = "S2_FlatDownRail", type = "KinkRail", straight = 2, alongFraction = 0.7554, side = "R", sideOffset = 3.5, angleIn = 8, accent = "Teal" },
	{ featureId = "S3_ProKicker", type = "ProKicker", straight = 3, alongFraction = 0.2275, side = "L", sideOffset = 6, angleIn = 8, accent = "Yellow" },
	{ featureId = "S3_Rooftop", type = "Rooftop", straight = 3, alongFraction = 0.5233, side = "R", sideOffset = 3.5, angleIn = 8, accent = "Yellow" },
	{
		featureId = "S3_Transfer",
		type = "Transfer",
		straight = 3,
		alongFraction = 0.7677,
		side = "L",
		sideOffset = 3,
		angleIn = 5,
		partSide = 1,
		accent = "Yellow",
	},
	{ featureId = "S4_StepUp", type = "StepUp", straight = 4, alongFraction = 0.2346, side = "R", sideOffset = 3.5, angleIn = 8, accent = "Magenta" },
	{ featureId = "S4_Pyramid", type = "Pyramid", straight = 4, alongFraction = 0.4607, side = "L", sideOffset = 8, angleIn = 8, accent = "Magenta" },
	{ featureId = "S4_Spine", type = "Spine", straight = 4, alongFraction = 0.7518, side = "R", sideOffset = 7, angleIn = 8, accent = "Magenta" },
	{ featureId = "S5_FlatRail", type = "FlatRail", straight = 5, alongFraction = 0.271, side = "L", sideOffset = 3.5, angleIn = 8, accent = "Orange" },
	{
		featureId = "S5_WallRide",
		type = "WallRide",
		straight = 5,
		alongFraction = 0.5648,
		side = "R",
		sideOffset = 7.8,
		angleIn = 12,
		partSide = 1,
		accent = "Orange",
	},
}

Layout.BEGINNER = {
	{ featureId = "B_BeginnerKicker", type = "BeginnerKicker", straight = 1, alongFraction = 0.448, side = "L", sideOffset = 2.5, angleIn = 6, accent = "Teal" },
	{ featureId = "B_Slider", type = "Slider", straight = 1, alongFraction = 0.766, side = "R", sideOffset = 2.5, angleIn = 6, accent = "Teal" },
}

Layout.RULES = {
	direction = "CounterClockwise",
	cornerBefore = 30,
	cornerAfter = 25,
	startClear = 55,
	band = { 0.2, 0.8 },
	spacing = { 30, 60 },
	offsets = { Rail = { 2, 5 }, Box = { 2, 5 }, Kicker = { 4, 7 }, Big = { 6, 9 }, Beginner = { 2, 3 } },
	angleIn = { 5, 12 },
	runOut = { Kicker = 25, Other = 15 },
	approach = 15,
	shore = 12,
	towerBase = 20,
	buoyClear = 6,
}

Layout.FEATURES_SPEC_MAIN = {
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

Layout.FEATURES_SPEC_BEGINNER = {
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
