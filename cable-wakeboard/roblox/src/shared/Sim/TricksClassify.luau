-- Names and points for what physics reported. Mirrors src/sim/tricks/classify.ts.
local Landing = require(script.Parent.Landing)
local Scalar = require(script.Parent.Scalar)
local TricksData = require(script.Parent.TricksData)

local GRABS, INVERTS, POINTS, SLIDES = TricksData.GRABS, TricksData.INVERTS, TricksData.POINTS, TricksData.SLIDES
local TricksClassify = {}

local function token(kind, name, points, domain, extra)
	extra = extra or {}
	return {
		kind = kind,
		name = name,
		degrees = extra.degrees,
		direction = extra.direction,
		duration = extra.duration,
		quality = if extra.quality ~= nil then extra.quality else 1,
		domain = domain,
		points = points,
	}
end

local function bestGrab(air)
	local best = nil
	for _, id in { "indy", "stalefish", "nose", "tail" } do
		local t = air.grabTimes[id]
		if t >= POINTS.grabInterval and (best == nil or t > best.time) then
			best = { id = id, time = t }
		end
	end
	return best
end

local function capitalise(side)
	return if side == "frontside" then "Frontside" else "Backside"
end

local function trim(s)
	-- Leading and trailing spaces off. (No anchor: %s* already starts at the first character.)
	return string.match(s, "%s*(.-)%s*$")
end

local function sumPoints(tokens)
	local total = 0
	for _, t in tokens do
		total += t.points
	end
	return total
end

function TricksClassify.classifyAir(air, landing, cfg)
	local tokens = {}
	local domain = if air.trick then "Water" else "Air"
	local fromFeature = air.source == "feature"
	local spin = Landing.airSpin(air)
	local step = if fromFeature then math.pi / 2 else math.pi
	local degrees = math.abs(Scalar.round(spin / step)) * (if fromFeature then 90 else 180)
	local side = air.rot.spinSide

	local invert = nil
	if air.trick then
		invert = if air.trick.sBend ~= 0 then "sBend" else air.trick.kind
	elseif landing.flips > 0 then
		invert = if air.rot.flipAngle > 0 then "frontFlip" else "tantrum"
	end
	local invertDef = if invert then INVERTS[invert] else nil
	local flips = if air.trick then 1 else landing.flips

	if invertDef then
		table.insert(tokens, token(if invertDef.invert then "Invert" else "Pop", invertDef.name, invertDef.points * flips, domain, { quality = air.popQuality }))
	end
	if degrees > 0 then
		local sideFactor = if side == "backside" then POINTS.backsideSpinFactor else 1
		table.insert(tokens, token("Spin", `{degrees}`, POINTS.spinPer180 * (degrees / 180) * sideFactor, domain, { degrees = degrees, direction = side }))
	end
	if air.rot.passes > 0 then
		table.insert(tokens, token("HandlePass", "Handle Pass", POINTS.handlePass * air.rot.passes, domain))
	end
	local grab = bestGrab(air)
	if grab then
		local intervals = math.min(POINTS.grabMaxIntervals, math.floor(grab.time / POINTS.grabInterval))
		table.insert(tokens, token("Grab", GRABS[grab.id].name, POINTS.grabPerInterval * intervals, domain, { duration = grab.time }))
	end
	if landing.toBlind then
		table.insert(tokens, token("Blind", "to Blind", POINTS.toBlind, domain))
	end
	local blindOut = air.fromBlind and degrees > 0 and not landing.toBlind
	if blindOut then
		table.insert(tokens, token("Exit", "Blind Out", POINTS.blindOut, domain))
	end

	local mobe = invertDef ~= nil and invertDef.invert and degrees >= 360
	if mobe then
		table.insert(tokens, token("Invert", "Mobe", POINTS.mobeBonus, domain))
	end

	local name = ""
	if mobe then
		name = if degrees > 360 then `Mobe {degrees}` else "Mobe"
	elseif invertDef then
		name = (if flips > 1 then "Double " else "") .. invertDef.name .. (if degrees > 0 then ` {degrees}` else "")
	elseif degrees > 0 then
		if blindOut then
			name = `Blind {degrees} Out`
		elseif fromFeature then
			name = `{degrees} Off`
		else
			name = trim((if side then capitalise(side) else "") .. " " .. `{degrees}`)
		end
	end
	if grab then
		name = if name ~= "" then name .. " " .. GRABS[grab.id].name else GRABS[grab.id].name
	end
	if landing.toBlind then
		local base = if name ~= "" then name elseif side then capitalise(side) else ""
		name = trim(base .. " to Blind")
	end

	if name == "" then
		if air.time < cfg.air.minAirTime then
			return nil
		end
		if air.source == "flat" or air.source == "blindPop" then
			name = "Ollie"
		elseif air.source == "kicker" then
			name = if air.lipPop then "Kicker Air Pop" else "Kicker Air"
		else
			return nil
		end
		table.insert(tokens, token("Pop", name, POINTS.ollie, domain, { quality = air.popQuality }))
	end
	-- Over a feature from its side (side approach v2): "Ollie Over", "Frontside 360 Over".
	if air.over then
		name = name .. " Over"
		table.insert(tokens, token("Bonus", "Over", POINTS.overBonus, domain))
	end

	local points = sumPoints(tokens)
	local family = if invertDef then (if invertDef.invert then "invert" else "raley") elseif degrees > 0 then "spin" else "jump"
	return {
		name = name,
		key = name,
		family = family,
		tokens = tokens,
		points = points,
		quality = if landing.clean then 1 + cfg.landing.cleanBonus else 1,
		comboFactor = if air.grab and not cfg.landing.grabHeldCrashes then 0.5 else 1,
		difficulty = points / 250,
		spinDegrees = degrees,
		spinSide = side,
		invert = invert,
		grab = if grab then grab.id else nil,
		switchStance = air.takeoffSwitch,
	}
end

function TricksClassify.classifySlide(jib, cfg)
	if jib.time < 0.3 then
		return nil
	end
	local tokens = {}
	if jib.entry == "popOn" then
		table.insert(tokens, token("Entry", "Pop-on", POINTS.popOn, "Feature"))
	end
	local slides = {}
	for _, id in jib.slideOrder do
		if jib.slideTimes[id] >= 0.15 then
			table.insert(slides, id)
		end
	end
	for _, id in slides do
		local def = SLIDES[id]
		table.insert(tokens, token("Slide", def.name, def.pointsPerSecond * jib.slideTimes[id], "Feature", { duration = jib.slideTimes[id] }))
	end
	local quarter = Scalar.round(jib.rot.maxSpin / (math.pi / 2))
	local degrees = quarter * 90
	if degrees >= 180 then
		local sideFactor = if jib.rot.spinSide == "backside" then POINTS.backsideSpinFactor else 1
		table.insert(tokens, token("Spin", `{degrees} on`, POINTS.spinPer180 * (degrees / 180) * sideFactor, "Feature", { degrees = degrees, direction = jib.rot.spinSide }))
	end
	if jib.rot.passes > 0 then
		table.insert(tokens, token("HandlePass", "Handle Pass", POINTS.handlePass * jib.rot.passes, "Feature"))
	end
	if #slides == 0 then
		return nil
	end
	local names = {}
	for i, id in slides do
		names[i] = SLIDES[id].name
	end
	local name = (if jib.entry == "popOn" then "Pop-on " else "") .. table.concat(names, " to ")
	local points = sumPoints(tokens)
	return {
		name = name,
		key = name,
		family = "jib",
		tokens = tokens,
		points = points,
		quality = 1,
		comboFactor = if jib.sketchy then cfg.safety.sketchyMultiplier else 1,
		difficulty = points / 250,
		spinDegrees = degrees,
		spinSide = jib.rot.spinSide,
		invert = nil,
		grab = nil,
		switchStance = table.find(slides, "switchFiftyFifty") ~= nil,
	}
end

return TricksClassify
