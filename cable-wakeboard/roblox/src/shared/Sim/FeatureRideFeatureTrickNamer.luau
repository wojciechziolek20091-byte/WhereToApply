-- Twin of src/sim/featureRide/featureTrickNamer.ts (FeatureTrickNamer,
-- feature riding spec 8): pure functions from a feature line to its name.
--   [Entry] [<deg>-in] <Slide> [[Hard Way] <deg> <Slide>]... [<deg>-out] [Pretzel] [to Fakie/Forward]
local TricksData = require(script.Parent.TricksData)

local SLIDES = TricksData.SLIDES
local Namer = {}

Namer.PRESS_SHARE = 0.4

local function quarters(rad)
	return math.floor(math.abs(rad) / (math.pi / 2) + 0.5) * 90
end

local function sign(v)
	return if v > 0 then 1 elseif v < 0 then -1 else 0
end

function Namer.entryWord(entry)
	if entry == "ollieOn" then
		return "Ollie-on"
	elseif entry == "sideOllieOn" then
		return "Side Ollie-on"
	elseif entry == "popOn" then
		return "Pop-on"
	end
	return ""
end

function Namer.slideName(id, j)
	local base = SLIDES[id].name
	if id == "fiftyFifty" or id == "switchFiftyFifty" then
		local fifty = j.slideTimes.fiftyFifty + j.slideTimes.switchFiftyFifty
		local press = if j.pressTimes.nose >= j.pressTimes.tail then "Nose Press" else "Tail Press"
		local held = math.max(j.pressTimes.nose, j.pressTimes.tail)
		if fifty > 0 and held > Namer.PRESS_SHARE * fifty then
			return (string.gsub(base, "50%-50", press))
		end
		return base
	end
	if id == "wallRide" then
		return base
	end
	return if j.switchStance then "Switch " .. base else base
end

local function jibParts(j, first, parts)
	if first then
		local w = Namer.entryWord(j.entry)
		if w ~= "" then
			table.insert(parts, w)
		end
	end
	local inDeg = quarters(j.inRotation)
	if inDeg >= 180 then
		table.insert(parts, `{inDeg}-in`)
	end
	local start = j.slideOrder[1]
	if start then
		table.insert(parts, Namer.slideName(start, j))
	end
	for _, r in j.rotations do
		if r.hardWay then
			table.insert(parts, "Hard Way")
		end
		table.insert(parts, tostring(r.deg))
		if r.to then
			table.insert(parts, Namer.slideName(r.to, j))
		end
	end
end

function Namer.outParts(out, inRotation, parts)
	if not out then
		return
	end
	local deg = quarters(out.spin)
	if deg == 0 then
		return
	end
	if deg >= 180 then
		table.insert(parts, `{deg}-out`)
	end
	if quarters(inRotation) >= 90 and sign(inRotation) ~= sign(out.spin) and sign(out.spin) ~= 0 then
		table.insert(parts, "Pretzel")
	end
	if deg == 90 then
		table.insert(parts, if out.landedSwitch then "to Fakie" else "to Forward")
	end
end

function Namer.featureTrickName(jibs, out)
	local parts = {}
	for i, j in jibs do
		if i > 1 then
			table.insert(parts, "Transfer")
		end
		jibParts(j, i == 1, parts)
	end
	local first = jibs[1]
	Namer.outParts(out, if first then first.inRotation else 0, parts)
	if first and first.entry == "transfer" and #jibs == 1 then
		table.insert(parts, "Transfer")
	end
	return table.concat(parts, " ")
end

return Namer
