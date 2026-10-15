-- Combo scoring, pure functions shared by the client and the server's
-- validation. Mirrors src/sim/scoring/combo.ts.
local Scalar = require(script.Parent.Scalar)

local ScoringCombo = {}

function ScoringCombo.scoreCombo(entries, cfg)
	local seen = {}
	local perTrick = {}
	local sum = 0
	local factor = 1
	for _, e in entries do
		local repeatFactor = if table.find(seen, e.name) then cfg.repeatPenalty else 1
		table.insert(seen, e.name)
		local p = e.points * e.quality * repeatFactor
		table.insert(perTrick, p)
		sum += p
		factor *= e.comboFactor
	end
	local n = #entries
	local multiplier = if n > 0 then math.min(cfg.maxMultiplier, 1 + cfg.perTrick * (n - 1)) * factor else 0
	return { perTrick = perTrick, multiplier = multiplier, total = Scalar.round(sum * multiplier) }
end

function ScoringCombo.comboName(entries)
	local names = {}
	for i, e in entries do
		names[i] = e.name
	end
	return table.concat(names, " + ")
end

return ScoringCombo
