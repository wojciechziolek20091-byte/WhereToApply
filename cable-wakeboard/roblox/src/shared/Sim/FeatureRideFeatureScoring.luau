-- Twin of src/sim/featureRide/featureScoring.ts (FeatureScoring, feature
-- riding spec 9): one trick for a whole feature line. Slides per metre,
-- coverage, rotations per 90 (hard way, pretzel), switch, entry bonus, end
-- taps, handle passes, the feature's difficulty; sketchy cuts the quality.
local Namer = require(script.Parent.FeatureRideFeatureTrickNamer)
local TricksData = require(script.Parent.TricksData)

local POINTS, SLIDES = TricksData.POINTS, TricksData.SLIDES
local FeatureScoring = {}

-- Fixed order (the TypeScript twin sums in the same order).
local SLIDE_ORDER = { "fiftyFifty", "switchFiftyFifty", "backboard", "frontboard", "backLip", "frontLip", "wallRide" }

local function token(kind, name, points, extra)
	local t = { kind = kind, name = name, degrees = nil, direction = nil, duration = nil, quality = 1, domain = "Feature", points = points }
	if extra then
		for k, v in extra do
			t[k] = v
		end
	end
	return t
end

local function quarterTurns(rad)
	return math.floor(math.abs(rad) / (math.pi / 2) + 0.5)
end

local function sign(v)
	return if v > 0 then 1 elseif v < 0 then -1 else 0
end

function FeatureScoring.lineOut(exit, air)
	if not air then
		return nil
	end
	local spin = air.rot.spinAngle - air.spinStart
	local half = math.abs(math.floor(air.rot.spinAngle / math.pi + 0.5))
	local flips = half % 2 == 1
	return { spin = spin, landedSwitch = exit.switchStance ~= flips }
end

-- The line being ridden, named so far, or nil when not on a feature line.
function FeatureScoring.liveLineName(r)
	local name = nil
	if r.jib then
		local jibs = table.clone(r.jib.chain)
		table.insert(jibs, r.jib)
		name = Namer.featureTrickName(jibs, nil)
	elseif r.air and r.air.exit then
		name = Namer.featureTrickName(r.air.exit.jibs, FeatureScoring.lineOut(r.air.exit, r.air))
	end
	return if name and name ~= "" then name else nil
end

function FeatureScoring.scoreFeatureLine(exit, air, landing, cfg)
	local S = cfg.featureRide.Scoring
	local tokens = {}
	local jibs = exit.jibs
	local first = jibs[1]
	local out = FeatureScoring.lineOut(exit, air)
	local name = Namer.featureTrickName(jibs, out)

	local entryPts = S.EntryBonus[first.entry] or 0
	if entryPts > 0 then
		table.insert(tokens, token("Entry", first.entry, entryPts))
	end
	local passes = if air then air.rot.passes else 0
	local sketchy = false
	local anySwitch = false
	for _, j in jibs do
		local k = j.difficulty
		sketchy = sketchy or j.sketchy
		local fiftyTime = j.slideTimes.fiftyFifty + j.slideTimes.switchFiftyFifty
		local pressTime = math.max(j.pressTimes.nose, j.pressTimes.tail)
		local pressShare = if fiftyTime > 0 then math.min(1, pressTime / fiftyTime) else 0
		for _, id in SLIDE_ORDER do
			local m = j.slideMetres[id]
			if m > 0 then
				local sw = id == "switchFiftyFifty" or (j.switchStance and id ~= "fiftyFifty" and id ~= "wallRide")
				anySwitch = anySwitch or sw
				local swK = if sw then S.SwitchFactor else 1
				if (id == "fiftyFifty" or id == "switchFiftyFifty") and pressShare > Namer.PRESS_SHARE then
					table.insert(tokens, token("Slide", "Press", m * pressShare * S.PerMetre.press * swK * k, { duration = pressTime }))
					table.insert(tokens, token("Slide", SLIDES[id].name, m * (1 - pressShare) * S.PerMetre[id] * swK * k, { duration = j.slideTimes[id] }))
				else
					table.insert(tokens, token("Slide", SLIDES[id].name, m * S.PerMetre[id] * swK * k, { duration = j.slideTimes[id] }))
				end
			end
		end
		if j.partLength > 0 and (j.uMax - j.uMin) / j.partLength >= S.FullCoverage then
			table.insert(tokens, token("Bonus", "Full Feature", S.FullFeatureBonus * k))
		end
		local inQ = quarterTurns(j.inRotation)
		if inQ > 0 then
			table.insert(tokens, token("Rotation", `{inQ * 90}-in`, inQ * S.PerQuarter * k, { degrees = inQ * 90 }))
		end
		for _, r in j.rotations do
			local f = if r.hardWay then S.HardWayFactor else 1
			table.insert(tokens, token("Rotation", tostring(r.deg), (r.deg / 90) * S.PerQuarter * f * k, { degrees = r.deg, direction = r.side }))
		end
		if j.endTap then
			table.insert(tokens, token("Bonus", if j.endTap == "nose" then "Nose Tap" else "Tail Tap", S.EndTapBonus * k))
		end
		passes += j.rot.passes
	end
	if out then
		local q = quarterTurns(out.spin)
		if q > 0 then
			local pretzel = quarterTurns(first.inRotation) > 0 and sign(first.inRotation) ~= sign(out.spin)
			local f = if pretzel then S.PretzelFactor else 1
			table.insert(tokens, token("Rotation", `{q * 90}-out`, q * S.PerQuarter * f, { degrees = q * 90, direction = if air then air.rot.spinSide else nil }))
		end
	end
	if passes > 0 then
		table.insert(tokens, token("HandlePass", "Handle Pass", POINTS.handlePass * passes))
	end
	local points = 0
	for _, t in tokens do
		points += t.points
	end
	local clean = landing ~= nil and landing.clean and not sketchy and exit.kind ~= "sketchy"
	local quality = (if clean then 1 + cfg.landing.cleanBonus else 1) * (if sketchy or exit.kind == "sketchy" then cfg.safety.sketchyMultiplier else 1)
	return {
		name = name,
		key = name,
		family = "jib",
		tokens = tokens,
		points = points,
		quality = quality,
		comboFactor = 1,
		difficulty = points / 250,
		spinDegrees = if out then quarterTurns(out.spin) * 90 else 0,
		spinSide = if air then air.rot.spinSide else nil,
		invert = nil,
		grab = nil,
		switchStance = anySwitch,
	}
end

return FeatureScoring
