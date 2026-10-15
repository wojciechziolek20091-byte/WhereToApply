-- Every tunable in the sim. SI units. Mirrors src/sim/config.ts value for value;
-- see that file and docs/MECHANICS.md for what each entry models.
local Config = {}

Config.DT = 1 / 60
Config.GRAVITY = 9.81

Config.DEFAULT_CONFIG = {
	cable = {
		-- The lakeside park's five towers (ParkLayout.luau), map towers 4, 5, 1, 2, 3
		-- in order of travel: clockwise seen from above, starting on the south straight.
		towers = {
			{ x = 87.1, z = 40.4 },
			{ x = -124.3, z = 13.5 },
			{ x = -92, z = -78.9 },
			{ x = 54.8, z = -72.5 },
			{ x = 123, z = -4.7 },
		},
		cornerRadius = 12, -- arc around each tower wheel (m)
		cableHeight = 9, -- cable above the water (m)
		carrierSpeed = 8.3, -- constant carrier speed (m/s), about 30 km/h
	},
	rope = {
		length = 18, -- carrier to handle (m)
		stiffness = 8000, -- stand-in for body and arms (N/m)
		damping = 900, -- while taut (N per m/s)
		gripLimit = 3200, -- tension that rips the handle away (N)
		gripTime = 0.3, -- how long over the limit before it goes (s)
		snapRate = 2.5, -- stretch rate that counts as a rope snap (m/s)
	},
	rider = { mass = 80, hipHeight = 1.0, stance = "regular" },
	hydro = {
		dragCoef = 4.0,
		lateralGrip = 70,
		flatGripFraction = 0.25,
		gripMinSpeed = 2,
		linearDrag = 8,
		liftOffFactor = 1.6,
		fallenDrag = 300,
	},
	edge = {
		maxEdgeAngle = 0.7,
		edgeBuildRate = 1.0,
		edgeReleaseRate = 3.0,
		maxCutAngle = 0.9,
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
		compressRate = 3.0,
		standRate = 4.0,
	},
	pop = {
		base = 1.0,
		edgeGain = 2.2,
		edgeLoadRef = 1500,
		tensionGain = 1.6,
		tensionRef = 1500,
		maxPop = 4.5,
		extendTime = 0.15,
		lipLead = 0.06,
		lipWindow = 0.25,
		peakMemory = 0.6,
		flatMinLoad = 400,
	},
	air = {
		dragCoef = 0.4,
		spinRate = 8.0,
		invertRate = 7.0,
		handleOutRotation = 0.6,
		earlySpinPenalty = 0.35,
		rollAxisCut = 0.45,
		minGrabTime = 0.15,
		raleyRate = 3.0,
		minAirTime = 0.25,
	},
	landing = {
		maxYawError = 0.5,
		maxEdgeFraction = 0.75,
		maxFlipError = 0.7,
		stiffImpact = 6.5,
		absorbImpact = 4.0,
		fallRecovery = 2.0,
	},
	feature = { rampFriction = 0.06, mountHeight = 0.25, mountAngle = 1.0, stallSpeed = 0.8 },
	jib = {
		friction = 0.08,
		boardRotateRate = 7,
		lateralDamping = 6,
		ropeTip = 700,
		drift = 1.6,
		correction = 2.5,
		angleDrift = 1.2,
	},
	raley = { minEdgeLoad = 1400, minTension = 1200 },
	run = { passesPerRun = 2, maxFalls = 2, deadWaterTime = 8, respawnSlack = 0.98 },
	scoring = {
		judges = 3,
		weights = { execution = 3.3, intensity = 3.4, composition = 3.3 },
		judgeBias = 0.4,
		seed = 20261013,
	},
}

local function deepCopy(t)
	local out = {}
	for k, v in t do
		out[k] = if type(v) == "table" then deepCopy(v) else v
	end
	return out
end
Config.deepCopy = deepCopy

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

return Config
