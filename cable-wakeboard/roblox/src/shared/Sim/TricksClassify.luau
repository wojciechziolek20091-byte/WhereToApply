-- Names and rates tricks from what physics reported. Mirrors src/sim/tricks/classify.ts.
-- TypeScript `null` is `nil` here.
local Edge = require(script.Parent.Edge)
local Scalar = require(script.Parent.Scalar)
local TricksData = require(script.Parent.TricksData)

local GRABS = TricksData.GRABS
local JUMPS = TricksData.JUMPS
local SPINS = TricksData.SPINS
local INVERTS = TricksData.INVERTS
local RALEYS = TricksData.RALEYS
local COMBOS = TricksData.COMBOS
local JIBS = TricksData.JIBS
local MODIFIERS = TricksData.MODIFIERS

local TricksClassify = {}

-- Raley must reach this extension to count.
local RALEY_MIN = 0.8

local function find(list, pred)
	for _, v in list do
		if pred(v) then
			return v
		end
	end
	return nil
end

-- Frontside = chest opens toward travel first; backside (blind) = back first.
function TricksClassify.spinDirectionOf(air, stance)
	if math.abs(air.spinAngle) < math.pi / 2 then
		return nil
	end
	local frontside = -Edge.toeSign({ stance = stance, switchStance = air.takeoffSwitch })
	return if Scalar.sign(air.spinAngle) == frontside then "frontside" else "backside"
end

local function invertOf(air)
	if air.flipDir == 0 then
		return nil
	end
	local direction = if air.flipDir < 0 then "back" else "front"
	local axis = air.axis
	-- A straight approach counts as heelside for back inverts and toeside for front.
	local approach = air.approach
	if approach == "neutral" then
		approach = if direction == "back" then "heelside" else "toeside"
	end
	local def = find(INVERTS, function(d)
		return d.approach == approach and d.direction == direction and d.axis == axis
	end)
	if def then
		return def
	end
	local side = if approach == "heelside" then "Heelside" else "Toeside"
	local name = side .. " " .. (if direction == "back" then "Back" else "Front") .. axis
	return { id = approach .. "-" .. direction .. "-" .. axis, name = name, difficulty = 3.8 }
end

-- Name and rate what happened in the air. Returns nil for a hop too small
-- to count. `stance` is the rider's natural stance.
function TricksClassify.classifyAir(air, landing, stance, minAirTime)
	local spinDegrees = math.abs(landing.halfTurns) * 180
	local spinDirection = if spinDegrees > 0 then TricksClassify.spinDirectionOf(air, stance) else nil
	local invert = if landing.flips > 0 then invertOf(air) else nil
	local raley = nil
	if not invert and air.raleyPeak >= RALEY_MIN then
		local want = if air.approach == "toeside" then "toeside" else "heelside"
		raley = find(RALEYS, function(r)
			return r.approach == want
		end)
	end
	if air.time < minAirTime and not invert and spinDegrees == 0 then
		return nil
	end
	-- Rolling off a slider or being lifted by the line without popping is not a trick.
	local unpopped = air.source ~= "kicker" and air.popSpeed < 0.5
	if unpopped and not invert and not raley and spinDegrees == 0 and not air.grabbed then
		return nil
	end

	local modifiers = {}
	local grab = if air.grabbed then GRABS[air.grabbed] else nil
	local base = invert
		or raley
		or find(JUMPS, function(j)
			return j.source == air.source and j.approach == air.approach
		end)
		or JUMPS[1]
	local spin = find(SPINS, function(s)
		return s.degrees == spinDegrees
	end)
	local combo = nil
	if (invert or raley) and spinDirection then
		combo = find(COMBOS, function(c)
			return c.base == base.id and c.spinDegrees == spinDegrees and c.spinDirection == spinDirection
		end)
	end

	local difficulty
	if combo then
		difficulty = combo.difficulty
	else
		difficulty = base.difficulty + (if spin then spin.difficulty else spinDegrees / 120)
	end
	local name
	local family
	if combo then
		name = combo.name
		family = "combo"
		difficulty *= 1 + MODIFIERS.combo
		table.insert(modifiers, "combo")
	elseif invert or raley then
		family = if invert then "invert" else "raley"
		name = base.name
		if spinDegrees > 0 then
			name ..= " to " .. (if spinDirection == "backside" then "Blind" else "Frontside") .. " " .. spinDegrees
			difficulty *= 1 + MODIFIERS.combo
			table.insert(modifiers, "combo")
		end
	elseif spinDegrees > 0 then
		family = "spin"
		name = (if spinDirection == "backside" then "Backside" else "Frontside") .. " " .. spinDegrees
	else
		family = "jump"
		name = base.name
	end

	if spinDirection == "backside" then
		difficulty *= 1 + MODIFIERS.blind
		table.insert(modifiers, "blind")
	end
	if grab then
		name ..= " " .. grab.name
		difficulty += grab.difficulty
		table.insert(modifiers, "grab")
	end
	if air.takeoffSwitch then
		name = "Switch " .. name
		difficulty *= 1 + MODIFIERS.switch
		table.insert(modifiers, "switch")
	end

	local parts = {}
	table.insert(parts, if combo then combo.id else base.id)
	if spinDegrees ~= 0 and not combo then
		table.insert(parts, (if spinDirection == "backside" then "bs" else "fs") .. spinDegrees)
	end
	if grab then
		table.insert(parts, grab.id)
	end
	if air.takeoffSwitch then
		table.insert(parts, "switch")
	end

	return {
		key = table.concat(parts, "+"),
		name = name,
		family = family,
		difficulty = difficulty,
		spinDegrees = spinDegrees,
		spinDirection = spinDirection,
		invert = if invert then invert.id else nil,
		grab = if grab then grab.id else nil,
		switchStance = air.takeoffSwitch,
		modifiers = modifiers,
	}
end

-- Name a finished jib from how long the board spent aligned vs across.
function TricksClassify.classifyJib(time, alignedTime, crossedTime)
	if time < 0.3 then
		return nil
	end
	local def = if crossedTime > alignedTime then JIBS.boardslide else JIBS.fiftyFifty
	return {
		key = def.id,
		name = def.name,
		family = "jib",
		difficulty = def.difficulty * math.min(2, 0.5 + time),
		spinDegrees = 0,
		spinDirection = nil,
		invert = nil,
		grab = nil,
		switchStance = false,
		modifiers = {},
	}
end

return TricksClassify
