-- A competition run: laps, crashes, the trick log, combos and the judges.
-- Mirrors src/sim/session.ts.
local Cable = require(script.Parent.Cable)
local Config = require(script.Parent.Config)
local FeatureScoring = require(script.Parent.FeatureRideFeatureScoring)
local Fsm = require(script.Parent.Fsm)
local Park = require(script.Parent.Park)
local ScoringCombo = require(script.Parent.ScoringCombo)
local ScoringJudges = require(script.Parent.ScoringJudges)
local ScoringMetrics = require(script.Parent.ScoringMetrics)
local Step = require(script.Parent.Step)
local TricksClassify = require(script.Parent.TricksClassify)
local Vec = require(script.Parent.Vec)
local World = require(script.Parent.World)

local DT = Config.DT
local Session = {}

function Session.createRun(cfg, park)
	cfg = cfg or Config.DEFAULT_CONFIG
	park = park or Park.DEFAULT_PARK
	local sim = World.createSim(cfg, park)
	return {
		sim = sim,
		startS = sim.carrier.s,
		pass = 0,
		tricks = {},
		crashes = {},
		sinceAction = 0,
		deadWater = 0,
		finished = false,
		endReason = nil,
		score = nil,
		latest = {},
		points = 0,
		combo = nil,
		bestCombo = 0,
		lastCombo = nil,
	}
end

function Session.liveCombo(run)
	if not run.combo then
		return nil
	end
	return ScoringCombo.scoreCombo(run.combo.entries, run.sim.cfg.combo)
end

local function endCombo(run, voided)
	local c = run.combo
	if not c then
		return
	end
	local score = ScoringCombo.scoreCombo(c.entries, run.sim.cfg.combo)
	run.lastCombo = {
		name = ScoringCombo.comboName(c.entries),
		total = if voided then 0 else score.total,
		multiplier = score.multiplier,
		tricks = #c.entries,
		voided = voided,
		tick = run.sim.tick,
	}
	if not voided then
		run.points += score.total
		run.bestCombo = math.max(run.bestCombo, score.total)
	end
	run.combo = nil
end

local function finish(run, reason)
	endCombo(run, false)
	run.finished = true
	run.endReason = reason
	local metrics = ScoringMetrics.computeRunMetrics(run.tricks, run.crashes, #run.sim.features, run.deadWater, run.sim.time)
	run.score = ScoringJudges.scoreRun(metrics, run.sim.cfg.scoring)
end

local function addTrick(run, rec)
	table.insert(run.tricks, rec)
	table.insert(run.latest, rec)
	local t = rec.trick
	if not run.combo then
		run.combo = { entries = {}, sinceLanding = 0 }
	end
	table.insert(run.combo.entries, { name = t.name, points = t.points, quality = t.quality, comboFactor = t.comboFactor })
	run.combo.sinceLanding = 0
	run.sinceAction = 0
end

function Session.stepRun(run, input)
	run.latest = {}
	if run.finished then
		return
	end
	local s = run.sim
	Step.stepSim(s, input)

	for _, e in s.events do
		if e.type == "landed" then
			-- Airs onto a feature or off one belong to its feature line (scored on the water).
			local trick = if e.onFeature or e.air.exit then nil else TricksClassify.classifyAir(e.air, e.landing, s.cfg)
			if trick then
				addTrick(run, {
					tick = e.tick,
					pass = run.pass,
					trick = trick,
					airTime = e.air.time,
					height = e.air.peakHeight,
					distance = Vec.distance(Vec.horizontal(e.air.takeoffPos), Vec.horizontal(s.rider.pos)),
					landingQuality = e.landing.quality,
					popQuality = e.air.popQuality,
					clean = e.landing.clean,
					featureId = e.air.featureId,
				})
			end
		elseif e.type == "featureLine" then
			-- A whole feature line: entry, slides, rotations, transfers, exit (feature riding spec 8, 9).
			local trick = FeatureScoring.scoreFeatureLine(e.exit, e.air, e.landing, s.cfg)
			local last = e.exit.jibs[#e.exit.jibs]
			addTrick(run, {
				tick = e.tick,
				pass = run.pass,
				trick = trick,
				airTime = if e.air then e.air.time else 0,
				height = if e.air then e.air.peakHeight else 0,
				distance = 0,
				landingQuality = if e.landing then e.landing.quality else 1 - math.min(1, math.abs(last.balance)),
				popQuality = if e.exit.jibs[1].entry == "popOn" then 1 else 0,
				clean = trick.quality > 1,
				featureId = last.featureId,
			})
		elseif e.type == "featureEnter" or e.type == "takeoff" then
			run.sinceAction = 0
		elseif e.type == "crash" then
			table.insert(run.crashes, { tick = e.tick, pass = run.pass, reason = e.reason })
			endCombo(run, true)
		end
	end

	if run.combo and Fsm.onWater(s.rider.mode) then
		run.combo.sinceLanding += DT
		if run.combo.sinceLanding > s.cfg.combo.linkWindow then
			endCombo(run, false)
		end
	end

	run.sinceAction += DT
	if run.sinceAction > s.cfg.run.deadWaterTime then
		run.deadWater += DT
	end

	if #run.crashes >= s.cfg.run.maxFalls then
		finish(run, "falls")
		return
	end
	if s.rider.mode == "crashed" and s.rider.crashTimer <= 0 then
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
