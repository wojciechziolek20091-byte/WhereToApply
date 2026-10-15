-- Run aggregates the judges look at. Mirrors src/sim/scoring/metrics.ts.
local ScoringMetrics = {}

local function mean(xs)
	if #xs == 0 then
		return 0
	end
	local sum = 0
	for _, x in xs do
		sum += x
	end
	return sum / #xs
end

local function countDistinct(xs)
	local seen, n = {}, 0
	for _, x in xs do
		if not seen[x] then
			seen[x] = true
			n += 1
		end
	end
	return n
end

local function map(list, f)
	local out = {}
	for _, v in list do
		table.insert(out, f(v))
	end
	return out
end

function ScoringMetrics.computeRunMetrics(tricks, falls, featureCount, deadWater, runTime)
	local airs = {}
	for _, t in tricks do
		if t.trick.family ~= "jib" then
			table.insert(airs, t)
		end
	end
	local all = map(tricks, function(t)
		return t.trick.difficulty
	end)
	table.sort(all, function(a, b)
		return a > b
	end)
	local best = {}
	for i = 1, math.min(5, #all) do
		best[i] = all[i]
	end
	local featureIds = {}
	for _, t in tricks do
		if t.featureId ~= nil then
			table.insert(featureIds, t.featureId)
		end
	end
	local early = 0
	for _, t in airs do
		if t.spunBeforePeak then
			early += 1
		end
	end
	return {
		trickCount = #tricks,
		falls = #falls,
		avgLandingQuality = mean(map(tricks, function(t)
			return t.landingQuality
		end)),
		avgPopQuality = mean(map(airs, function(t)
			return t.popQuality
		end)),
		earlySpinFraction = if #airs > 0 then early / #airs else 0,
		avgHeight = mean(map(airs, function(t)
			return t.height
		end)),
		avgAirTime = mean(map(airs, function(t)
			return t.airTime
		end)),
		topDifficulty = mean(best),
		uniqueTricks = countDistinct(map(tricks, function(t)
			return t.trick.key
		end)),
		uniqueFamilies = countDistinct(map(tricks, function(t)
			return t.trick.family
		end)),
		featureUse = if featureCount ~= 0 then countDistinct(featureIds) / featureCount else 1,
		deadWater = deadWater,
		runTime = runTime,
	}
end

return ScoringMetrics
