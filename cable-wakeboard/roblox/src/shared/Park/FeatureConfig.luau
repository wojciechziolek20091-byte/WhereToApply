--!strict
-- GENERATED from src/park/featureConfig.ts by scripts/gen-luau-data.ts. Do not edit:
-- edit the TypeScript file (it documents every entry) and rerun the script.
-- FeatureConfig: units, collision groups, tags, colours, materials, validator
-- thresholds, approach, bobbing and sounds for the wake park features. The
-- ride dimensions are the sim's catalogue, included as Catalog / Common.
local FeatureCatalog = require(script.Parent.Parent.Sim.FeatureCatalog)

local FeatureConfig = {
	StudsPerMetre = 3.57,
	CollisionGroups = { Ride = "FeatureRide", Visual = "FeatureVisual", Crash = "FeatureCrash", Rider = "Rider" },
	Collidable = { { "Rider", "FeatureRide" }, { "Default", "FeatureRide" } },
	Tags = { All = "ParkFeature", Kicker = "Kicker", Obstacle = "Obstacle", RideSurface = "FeatureRideSurface", CrashVolume = "FeatureCrashVolume" },
	Folders = { "Visual", "Ride", "Crash", "Approach", "Signage", "FX" },
	ParkFolder = "Park",
	FeaturesFolder = "Features",
	Difficulty = {
		{ name = "Beginner", color = { 46, 160, 67 }, stripes = 1 },
		{ name = "Intermediate", color = { 33, 110, 210 }, stripes = 1 },
		{ name = "Advanced", color = { 24, 24, 28 }, stripes = 1 },
		{ name = "Pro", color = { 24, 24, 28 }, stripes = 2 },
	},
	Colors = {
		TopBlack = { 32, 34, 38 },
		TopWhite = { 236, 238, 240 },
		Frame = { 150, 156, 162 },
		PontoonWhite = { 232, 232, 226 },
		PontoonYellow = { 240, 196, 40 },
		Coping = { 196, 200, 204 },
		Pipe = { 178, 184, 190 },
		Chain = { 70, 72, 76 },
		BuoyOrange = { 244, 112, 28 },
		BuoyWhite = { 244, 244, 240 },
		WetBand = { 40, 52, 58 },
		Algae = { 64, 96, 70 },
		Foam = { 250, 252, 252 },
		Wall = { 236, 238, 240 },
		Sign = { 250, 250, 246 },
		Dock = { 150, 112, 74 },
	},
	Accents = { Orange = { 244, 120, 32 }, Teal = { 20, 160, 160 }, Yellow = { 246, 200, 30 }, Magenta = { 210, 40, 140 } },
	Materials = { HDPE = "SmoothPlastic", Frame = "DiamondPlate", Pipe = "Metal", Pontoon = "Plastic", Chain = "Metal", Skatelite = "SmoothPlastic", Dock = "Wood" },
	HDPEReflectance = 0.07,
	CopingRadius = 0.04,
	TopSheet = 0.05,
	BoltSpacing = 0.6,
	KickerSubsegments = 10,
	Decals = { ParkName = "LAKESIDE WAKE", Tagline = "CABLE PARK", Designs = { "Wordmark", "LineTag", "Chevrons", "Dots" }, Font = "GothamBlack" },
	Chain = { Reach = 1.4, Thickness = 0.05 },
	BuoyRadius = 0.22,
	WetBand = 0.12,
	Foam = 0.35,
	MaxBoltsPerSide = 12,
	Bob = { Amplitude = 0.03, Frequency = 0.2, FreezeRadius = 6 },
	Approach = { EntryDistance = 12, IdealSpeed = 8.3, IdealPopOffset = 0.06, NameTagDistance = 25 },
	PopZoneLength = 1,
	Validator = {
		SafetySlope = { 12, 22 },
		SafetyDepth = { 0.15, 0.35 },
		KickerWidthMin = 2.5,
		BoxWidthMin = 0.8,
		SliderWidthMin = 1,
		RailHeight = { 0.4, 1.4 },
		MaxOllieHeight = 2.153414882772681,
		KinkJoinTolerance = 0.01,
		KinkMaxAngle = 20,
		VisualTolerance = 0.02,
		RopeLength = 18,
		MinOffLine = 2,
		ApproachClearance = 8,
		ExitClearance = 12,
		CopingMin = 0.03,
		KickerMinSubsegments = 6,
		MaxParts = 120,
	},
	CrashMessages = {
		shortOllie = "Clipped the edge: ollie higher",
		missedSafetyPop = "Into the gap: pop at the end of the safety",
		hitFeature = "Hit the frame",
		fellOffFeature = "Over the top",
	},
	CrashBelowTop = 0.06,
	Sounds = {
		HDPE = { Slide = "", Enter = "" },
		Pipe = { Slide = "", Enter = "" },
		Skatelite = { Slide = "", Enter = "" },
		KickerRoll = "",
		WallSlap = "",
		Splash = "",
		Impact = "",
	},
}

FeatureConfig.Common = FeatureCatalog.CATALOG_COMMON
FeatureConfig.Catalog = FeatureCatalog.FEATURE_CATALOG

-- Metres to studs.
function FeatureConfig.studs(m: number): number
	return m * FeatureConfig.StudsPerMetre
end

-- Difficulty colour (1-4).
function FeatureConfig.difficultyColor(d: number): Color3
	local c = FeatureConfig.Difficulty[d].color
	return Color3.fromRGB(c[1], c[2], c[3])
end

-- A named colour from Colors or Accents.
function FeatureConfig.color(name: string): Color3
	local c = (FeatureConfig.Colors :: any)[name] or (FeatureConfig.Accents :: any)[name]
	assert(c, "unknown colour " .. name)
	return Color3.fromRGB(c[1], c[2], c[3])
end

export type FeatureConfig = typeof(FeatureConfig)

return FeatureConfig
