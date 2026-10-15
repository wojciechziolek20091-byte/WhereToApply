-- Server-side sanity checks on a combo a client reports, then the score
-- recomputed with the shared Sim.ScoringCombo. Pure (no Roblox APIs), so it is
-- tested outside Studio (tests/parity.test.ts runs it on real tricks).
local Sim = require(script.Parent.Sim)

local ComboValidator = {}

local MAX_TRICKS = 40

local function limits(cfg)
	-- Longest air the sim can produce: a capped water trick plus the biggest kicker, with margin (s).
	local maxAir = Sim.WaterTrick.airtimeFor(cfg.waterTrick.maxHeight + 2.5) + 0.5
	return maxAir, math.deg(cfg.spin.rate) * maxAir + 180
end

-- One trick record. Returns an error message, or nil if it is plausible.
function ComboValidator.checkTrick(t, prevTick, cfg)
	local POINTS = Sim.TricksData.POINTS
	local maxAir, maxSpin = limits(cfg)
	if type(t) ~= "table" or type(t.name) ~= "string" or type(t.points) ~= "number" then
		return "malformed trick"
	end
	if t.points < 0 or t.points ~= t.points then
		return "bad points"
	end
	if t.quality ~= 1 and math.abs(t.quality - (1 + cfg.landing.cleanBonus)) > 1e-9 then
		return "bad quality"
	end
	if type(t.comboFactor) ~= "number" or t.comboFactor <= 0 or t.comboFactor > 1 then
		return "bad combo factor"
	end
	if type(t.airTime) ~= "number" or t.airTime < 0 or t.airTime > maxAir then
		return "airtime longer than any pop can give"
	end
	if type(t.spinDegrees) ~= "number" or t.spinDegrees > maxSpin then
		return "more rotation than the airtime allows"
	end
	if t.airTime > 0 and t.spinDegrees > math.deg(cfg.spin.rate) * t.airTime + 180 then
		return "spin faster than the spin rate"
	end
	if type(t.tick) ~= "number" or t.tick < prevTick then
		return "timestamps out of order"
	end
	if type(t.tokens) ~= "table" then
		return "no tokens"
	end
	local sum = 0
	for _, tok in t.tokens do
		if type(tok) ~= "table" or type(tok.points) ~= "number" then
			return "malformed token"
		end
		if tok.kind == "Spin" and type(tok.degrees) == "number" then
			local factor = if tok.direction == "backside" then POINTS.backsideSpinFactor else 1
			if math.abs(tok.points - POINTS.spinPer180 * (tok.degrees / 180) * factor) > 1e-6 then
				return "spin points do not match the registry"
			end
		elseif tok.kind == "Grab" and tok.points > POINTS.grabPerInterval * POINTS.grabMaxIntervals then
			return "grab points over the cap"
		elseif tok.kind == "HandlePass" and math.fmod(tok.points, POINTS.handlePass) ~= 0 then
			return "handle pass points do not match"
		end
		sum += tok.points
	end
	if math.abs(sum - t.points) > 1e-6 then
		return "points do not add up"
	end
	return nil
end

-- The whole combo: the recomputed score, or nil and the reason it was rejected.
function ComboValidator.validate(tricks, cfg)
	if type(tricks) ~= "table" or #tricks == 0 or #tricks > MAX_TRICKS then
		return nil, "size"
	end
	local prevTick = -1
	local entries = {}
	for _, t in tricks do
		local err = ComboValidator.checkTrick(t, prevTick, cfg)
		if err then
			return nil, err
		end
		prevTick = t.tick
		table.insert(entries, { name = t.name, points = t.points, quality = t.quality, comboFactor = t.comboFactor })
	end
	return Sim.ScoringCombo.scoreCombo(entries, cfg.combo), nil
end

return ComboValidator
