-- Judges panel. Mirrors src/sim/scoring/judges.ts, including the order the
-- seeded RNG is drawn in, so both versions give the same cards.
local Rng = require(script.Parent.Rng)
local Scalar = require(script.Parent.Scalar)

local clamp, clamp01 = Scalar.clamp, Scalar.clamp01

local ScoringJudges = {}

local function toScale(x)
	return clamp(1 + 9 * clamp01(x), 1, 10)
end

-- Execution: clean landings, completed tricks, good pops, no falls.
-- Intensity: size (height, air time) and difficulty.
-- Composition: variety, use of the park, flow without dead water.
function ScoringJudges.criteriaFromMetrics(m)
	if m.trickCount == 0 then
		return { execution = 1, intensity = 1, composition = 1 }
	end
	local exec = 0.7 * m.avgLandingQuality + 0.3 * m.avgPopQuality - 0.15 * m.earlySpinFraction
	local execution = clamp(toScale(exec) - 2.5 * m.falls, 1, 10)
	local intensity = toScale(0.55 * (m.topDifficulty / 6) + 0.3 * (m.avgHeight / 4) + 0.15 * (m.avgAirTime / 2))
	local variety = math.min(1, m.uniqueTricks / 6) * (m.uniqueTricks / m.trickCount)
	local flow = if m.runTime > 0 then 1 - math.min(1, (2 * m.deadWater) / m.runTime) else 0
	local composition =
		toScale(0.4 * variety + 0.25 * math.min(1, m.uniqueFamilies / 5) + 0.2 * m.featureUse + 0.15 * flow)
	return { execution = execution, intensity = intensity, composition = composition }
end

local function round1(x)
	return Scalar.round(x * 10) / 10
end

-- A panel of judges, each with a small deterministic bias per criterion.
function ScoringJudges.scoreRun(m, cfg)
	local base = ScoringJudges.criteriaFromMetrics(m)
	local rng = Rng.createRng(cfg.seed)
	local judges = {}
	local bias = cfg.judgeBias
	for _ = 1, cfg.judges do
		local execution = round1(clamp(base.execution + Rng.nextRange(rng, -bias, bias), 1, 10))
		local intensity = round1(clamp(base.intensity + Rng.nextRange(rng, -bias, bias), 1, 10))
		local composition = round1(clamp(base.composition + Rng.nextRange(rng, -bias, bias), 1, 10))
		local w = cfg.weights
		local total = execution * w.execution + intensity * w.intensity + composition * w.composition
		table.insert(judges, {
			execution = execution,
			intensity = intensity,
			composition = composition,
			total = round1(total),
		})
	end
	local sum = 0
	for _, j in judges do
		sum += j.total
	end
	return { base = base, judges = judges, total = round1(sum / math.max(1, #judges)) }
end

return ScoringJudges
