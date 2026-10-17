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
		{ name = "Beginner", color = { 46, 160, 67 } },
		{ name = "Intermediate", color = { 33, 110, 210 } },
		{ name = "Advanced", color = { 24, 24, 28 } },
		{ name = "Pro", color = { 24, 24, 28 } },
	},
	Style = {
		Feature = { color = { 240, 240, 240 }, material = "SmoothPlastic", reflectance = 0.05 },
		Rail = { color = { 25, 25, 25 }, material = "SmoothPlastic", reflectance = 0 },
		RailSupport = { color = { 25, 25, 25 }, material = "Metal", reflectance = 0 },
		RailPontoon = { color = { 25, 25, 25 }, material = "SmoothPlastic", reflectance = 0 },
		Chain = { color = { 60, 60, 62 }, material = "Metal", reflectance = 0 },
		Tower = { color = { 150, 150, 150 }, material = "Metal", reflectance = 0 },
		GuyWire = { color = { 60, 60, 62 }, material = "Metal", reflectance = 0 },
		Foundation = { color = { 170, 168, 160 }, material = "Concrete", reflectance = 0 },
		SignPost = { color = { 150, 150, 150 }, material = "Metal", reflectance = 0 },
		SignBoard = { color = { 240, 240, 240 }, material = "SmoothPlastic", reflectance = 0 },
		BuoyBoundary = { color = { 255, 120, 20 }, material = "SmoothPlastic", reflectance = 0.1 },
		BuoyLane = { color = { 244, 244, 244 }, material = "SmoothPlastic", reflectance = 0.1 },
		BuoyBand = { color = { 30, 30, 32 }, material = "SmoothPlastic", reflectance = 0 },
		AnchorLine = { color = { 40, 40, 42 }, material = "SmoothPlastic", reflectance = 0 },
	},
	Accents = { Orange = { 244, 120, 32 }, Teal = { 20, 160, 160 }, Yellow = { 246, 200, 30 }, Magenta = { 210, 40, 140 } },
	CopingRadius = 0.04,
	TopSheet = 0.05,
	VisualDrop = 0.03,
	KickerSubsegments = 10,
	Chain = { Reach = 1.4, Thickness = 0.05 },
	Buoy = {
		Submerged = 0.4,
		Band = 0.05,
		AnchorLength = 1.5,
		AnchorRadius = 0.02,
		BobAmplitude = 0.05,
		BobFrequency = 0.25,
		SplashRadius = 0.4,
		SplashCooldown = 1,
		Tag = "Buoy",
	},
	Bob = { Amplitude = 0.03, Frequency = 0.2, FreezeRadius = 6 },
	Approach = { EntryDistance = 12, IdealSpeed = 8.3, IdealPopOffset = 0.06, NameTagDistance = 25 },
	PopZoneLength = 0.5,
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
		ExitCorridor = 3,
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

-- A named colour: a Style role's colour, or an accent.
function FeatureConfig.color(name: string): Color3
	local style = (FeatureConfig.Style :: any)[name]
	local c = if style then style.color else (FeatureConfig.Accents :: any)[name]
	assert(c, "unknown colour " .. name)
	return Color3.fromRGB(c[1], c[2], c[3])
end

export type FeatureConfig = typeof(FeatureConfig)

return FeatureConfig
