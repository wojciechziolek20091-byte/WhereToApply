-- GENERATED from src/sim/config.ts by scripts/gen-luau-data.ts. Do not edit:
-- edit the TypeScript file (it documents every entry) and rerun the script.
-- Every tunable in the sim, SI units, angles in radians.
local Config = {}

Config.DT = 1 / 60
Config.GRAVITY = 9.81

Config.DEFAULT_CONFIG = {
	cable = {
		towers = { { x = -56.2, z = 110.4 }, { x = 56.2, z = 102.5 }, { x = 54.7, z = -55.2 }, { x = 15.8, z = -110.4 }, { x = -56.2, z = -72 } },
		cornerRadius = 12,
		cableHeight = 9,
		carrierSpeed = 8.3,
		mode = "loop",
	},
	rope = { length = 18, stiffness = 4000, damping = 600, snapRate = 2.5, maxTension = 2500, yankCrashImpulse = 1800, smoothTau = 0.08 },
	rider = { mass = 80, hipHeight = 1, stance = "regular" },
	hydro = { dragCoef = 4, lateralGrip = 70, flatGripFraction = 0.25, gripMinSpeed = 2, linearDrag = 8, liftOffFactor = 1.6, fallenDrag = 300 },
	edge = {
		maxEdgeAngle = 0.7,
		edgeBuildRate = 1,
		edgeReleaseRate = 3,
		maxCutAngle = 0.82,
		yawResponse = 3.5,
		carveCurvature = 0.12,
		maxYawRate = 2.5,
		ropeControlTension = 250,
	},
	posture = {
		handleInDist = 0.2,
		handleOutDist = 0.7,
		handleRate = 1.6,
		hingeGain = 1.2,
		hingeRecovery = 1.5,
		hingeTensionRef = 1200,
		handleWeight = 0.55,
		hingeWeight = 0.5,
		compressRate = 3,
		standRate = 4,
	},
	ollie = { chargeTime = 0.5, minV = 3.5, maxV = 6.5, clearance = 0.1 },
	kicker = { lipPopWindow = 0.12, lipPopBonus = 0.3 },
	safety = { popWindowFraction = 0.08, popWindowMinMetres = 0.5, perfectFraction = 0.4, sketchyMultiplier = 0.8, gapPopScale = 0.25 },
	spin = { rate = 9.42477796076938, accelTime = 0.1, maxCarry = 1.5707963267948966 },
	flip = { rate = 6.981317007977318, maxCarry = 1.0471975511965976 },
	handlePass = { featureWindow = 0.35, kickerWindow = 0.18, obstacleAirWindow = 0.25, waterTrickWindow = 0.25, flatAirWindow = 0.25, passTime = 0.15 },
	blind = { maxRideTime = 3, steerFactor = 0.4, maxEdge = 0.5, maxTension = 900, spinOutTime = 0.4 },
	waterTrick = {
		tensionThreshold = 1000,
		hysteresis = 100,
		minEdge = 0.7,
		sidewaysAngle = 0.6108652381980153,
		peakWindow = 0.15,
		historyTime = 0.4,
		baseHeight = 1.8,
		maxHeight = 4.5,
		minRollHeight = 1.4,
		maxLandingExtension = 0.5235987755982988,
		popPhaseEnd = 0.15,
		extensionEnd = 0.55,
		swingDownEnd = 0.85,
		heldSwingFactor = 0.5,
	},
	sBend = { windowStart = 0.25, windowEnd = 0.45 },
	grab = { chordWindow = 0.08 },
	air = { dragCoef = 0.4, minAirTime = 0.25 },
	landing = {
		maxYawError = 0.6108652381980153,
		maxFlipError = 0.6981317007977318,
		cleanThreshold = 0.20943951023931953,
		cleanBonus = 0.1,
		grabHeldCrashes = true,
		stiffImpact = 9,
		absorbImpact = 2,
		graceTime = 0.15,
	},
	feature = {
		rampFriction = 0.06,
		mountHeight = 0.25,
		mountAngle = 1,
		stallSpeed = 0.8,
		friction = 0.08,
		rotateTimePer90 = 0.18,
		tapTime = 0.15,
		balanceEnabled = true,
		lateralDamping = 6,
		wallPopOut = 0.6,
		sideHop = 2.8,
	},
	combo = { linkWindow = 2, repeatPenalty = 0.5, perTrick = 0.25, maxMultiplier = 4 },
	crash = { respawnDelay = 2.5 },
	run = { passesPerRun = 2, maxFalls = 2, deadWaterTime = 8, respawnSlack = 0.98 },
	scoring = { judges = 3, weights = { execution = 3.3, intensity = 3.4, composition = 3.3 }, judgeBias = 0.4, seed = 20261013 },
	physics = {
		tuckRotation = true,
		flipInertiaOpen = 12,
		flipInertiaTucked = 4,
		spinInertiaOpen = 2.5,
		spinInertiaTucked = 1.2,
		flipTuck = { { 0, 0 }, { 0.12, 0.6 }, { 0.2, 1 }, { 0.72, 1 }, { 0.92, 0 }, { 1, 0 } },
		spinTuckIn = 0.03,
		spinOpen = 0.7853981633974483,
		preWind = true,
		preWindWindow = 0.2,
		preWindBonus = 0.12,
		ropeAtShoulders = true,
		shoulderHeight = 1.45,
		landingSpeedCost = true,
		landingCostPerMS = 0.012,
		sketchyCost = 2,
	},
	featureRide = {
		Approach = { Range = 25, LateralRange = 8, FrontMargin = 0.3, HardEdge = 0.5, FlattenDistance = 1.5 },
		Entry = { Clearance = 0.08, TailClipTolerance = 0.1, TailClipSpeedKeep = 0.75, TailClipHit = 0.5 },
		SideEntry = {
			MaxAngle = 0.4363323129985824,
			MaxLateral = 2.5,
			HopLateralVMin = 1.5,
			HopLateralVMax = 3,
			BoxEdgeMargin = 0.2,
			RailMaxWidth = 0.3,
			RailHalfWidth = 0.15,
			PipeHalfWidth = 0.1,
			OvershootRecover = 0.1,
			OvershootHit = 0.5,
			OvershootCatch = 0.3,
		},
		Landing = {
			MaxRoll = 0.20943951023931953,
			SketchyRoll = 0.13962634015954636,
			RollHit = 0.3,
			SlipWindow = 0.2,
			SlipRollHeelside = 0.2792526803190927,
			SlipRollToeside = 0.17453292519943295,
			SlipRollFront = 0.10471975511965977,
			SnapTolerance = 0.3490658503988659,
			SketchyAngle = 0.5235987755982988,
			AngleHit = 0.6,
			HardImpact = 5,
			CrashImpact = 8,
			ImpactHit = 0.6,
			SkidRate = 1.5707963267948966,
			SkidHit = 0.3,
			MaxHit = 0.85,
		},
		Slide = {
			MaterialFriction = { HDPE = 0.06, Pipe = 0.05, Skatelite = 0.12 },
			BoardslideFriction = 1.6,
			PressFriction = 0.8,
			StallSpeed = 1,
			KinkMinAngle = 0.03490658503988659,
			KinkLiftPerRadSpeed = 0.068,
			KinkLiftMin = 0.05,
			KinkLiftMax = 0.15,
			KinkHit = 0.25,
			KinkCheckAngle = 0.20943951023931953,
			KinkThrowSpeed = 12,
			KinkSketchyMargin = 0.15,
			KinkSketchyHit = 0.5,
		},
		Balance = {
			NoiseBox = 0.9,
			NoiseRail = 1.6,
			NoisePipe = 2,
			BoxMinWidth = 0.6,
			NoiseRate = 1.3,
			BoardslideFactor = 1.3,
			LipslideFactor = 1.5,
			PipeFiftyFactor = 1.25,
			PipeBoardslideFactor = 0.85,
			RopeTip = 1400,
			CrossSlopeGain = 1.5,
			TapStrength = 0.35,
			SpikeTension = 1600,
			SpikeImpulse = 0.35,
			ForeNoise = 0.6,
			ForeRopeTip = 4000,
			ForeSlopeGain = 2,
			ForeTapStrength = 0.35,
			ForeDecay = 2,
			LastMetre = 1,
		},
		Press = { Pitch = 0.17453292519943295, RampTime = 0.15, NarrowRate = 0.25, MinWindow = 0.2, Lean = 0.4, EndTapZone = 0.5 },
		Exit = { PopOffZone = 1, AssistAngle = 0.7853981633974483, AssistRate = 6.283185307179586 },
		Rotation = { HardWayHit = 0.3 },
		Safety = { LandingPitchTolerance = 0.2617993877991494, LandingPitchCrash = 0.5235987755982988 },
	},
	debug = { enabled = true },
}

local function deepCopy(t)
	if type(t) ~= "table" then
		return t
	end
	local out = {}
	for k, v in t do
		out[k] = deepCopy(v)
	end
	return out
end

-- Copy of the defaults with per-section overrides, e.g. { run = { maxFalls = 3 } }.
function Config.makeConfig(overrides)
	local out = deepCopy(Config.DEFAULT_CONFIG)
	for section, values in overrides or {} do
		for k, v in values do
			out[section][k] = v
		end
	end
	return out
end

Config.deepCopy = deepCopy

return Config
