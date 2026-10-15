-- A competition run: `passesPerRun` laps of the cable, ended early by
-- `maxFalls` falls. Owns the sim, the trick log and the final score.
-- Mirrors src/sim/session.ts.
local Cable = require(script.Parent.Cable)
local Config = require(script.Parent.Config)
local Park = require(script.Parent.Park)
local ScoringJudges = require(script.Parent.ScoringJudges)
local ScoringMetrics = require(script.Parent.ScoringMetrics)
local Scalar = require(script.Parent.Scalar)
local Step = require(script.Parent.Step)
local TricksClassify = require(script.Parent.TricksClassify)
local Vec = require(script.Parent.Vec)
local World = require(script.Parent.World)

local DT = Config.DT

local Session = {}

-- Arcade points for one trick, for the HUD: difficulty scaled by how clean
-- the landing was and how big the air was. Judges score the run separately.
function Session.trickPoints(rec)
	local size = 1 + math.min(rec.height, 4) / 4 + math.min(rec.airTime, 2) / 4
	return math.max(5, Scalar.round(10 * rec.trick.difficulty * (0.5 + 0.5 * rec.landingQuality) * size))
end

function Session.createRun(cfg, park)
	cfg = cfg or Config.DEFAULT_CONFIG
	park = park or Park.DEFAULT_PARK
	local sim = World.createSim(cfg, park)
	return {
		sim = sim,
		startS = sim.carrier.s,
		pass = 0,
		tricks = {},
		falls = {},
		sinceAction = 0,
		deadWater = 0,
		finished = false,
		endReason = nil,
		score = nil,
		latest = {},
		points = 0,
	}
end

local function finish(run, reason)
	run.finished = true
	run.endReason = reason
	local metrics =
		ScoringMetrics.computeRunMetrics(run.tricks, run.falls, #run.sim.features, run.deadWater, run.sim.time)
	run.score = ScoringJudges.scoreRun(metrics, run.sim.cfg.scoring)
end

local function record(run, rec)
	table.insert(run.tricks, rec)
	table.insert(run.latest, rec)
	run.points += Session.trickPoints(rec)
	run.sinceAction = 0
end

-- One fixed tick of the run. Does nothing once finished.
function Session.stepRun(run, input)
	run.latest = {}
	if run.finished then
		return
	end
	local s = run.sim
	Step.stepSim(s, input)

	for _, e in s.events do
		if e.type == "landed" then
			local trick = TricksClassify.classifyAir(e.air, e.landing, s.rider.stance, s.cfg.air.minAirTime)
			if trick then
				record(run, {
					tick = e.tick,
					pass = run.pass,
					trick = trick,
					airTime = e.air.time,
					height = e.air.peakHeight,
					distance = Vec.distance(Vec.horizontal(e.air.takeoffPos), Vec.horizontal(s.rider.pos)),
					landingQuality = e.landing.quality,
					popQuality = e.air.popQuality,
					spunBeforePeak = e.air.spunBeforePeak,
					featureId = e.air.featureId,
				})
			end
		elseif e.type == "jibDone" and s.rider.mode ~= "fallen" then
			local trick = TricksClassify.classifyJib(e.time, e.alignedTime, e.crossedTime)
			if trick then
				local balance = if s.rider.jib then s.rider.jib.balance else 0
				record(run, {
					tick = e.tick,
					pass = run.pass,
					trick = trick,
					airTime = 0,
					height = 0,
					distance = 0,
					landingQuality = 1 - math.min(1, math.abs(balance)),
					popQuality = 0,
					spunBeforePeak = false,
					featureId = e.featureId,
				})
			end
		elseif e.type == "featureEnter" then
			run.sinceAction = 0
		elseif e.type == "fall" then
			table.insert(run.falls, { tick = e.tick, pass = run.pass, kind = e.kind })
		end
	end

	run.sinceAction += DT
	if run.sinceAction > s.cfg.run.deadWaterTime then
		run.deadWater += DT
	end

	if #run.falls >= s.cfg.run.maxFalls then
		finish(run, "falls")
		return
	end
	if s.rider.mode == "fallen" and s.rider.fallTimer <= 0 then
		s.rider = World.spawnRiderBehindCarrier(s)
		run.sinceAction = 0
	end
	local pass = Cable.lapsAt(s.path, s.carrier.s - run.startS)
	if pass ~= run.pass then
		run.pass = pass
		if pass >= s.cfg.run.passesPerRun then
			finish(run, "passes")
		end
	end
end

return Session
