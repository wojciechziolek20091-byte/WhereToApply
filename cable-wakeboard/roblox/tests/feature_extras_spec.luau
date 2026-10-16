-- Milestone 10 under the mock: FX attachments and hooks, map data, approach
-- name tags, per-feature stats and challenges (against real Luau sim rides),
-- and the preview tool. Prints FEATURE EXTRAS OK.
local ParkBuilder = require(__root.Park.ParkBuilder)
local FeatureBuilder = require(__root.Park.FeatureBuilder)
local FeatureChallenges = require(__root.Park.FeatureChallenges)
local FeatureFX = require(__root.Park.FeatureFX)
local FeatureMap = require(__root.Park.FeatureMap)
local FeatureModel = require(__root.Park.FeatureModel)
local FeatureRegistry = require(__root.Park.FeatureRegistry)
local FeatureStats = require(__root.Park.FeatureStats)
local FeatureTags = require(__root.Park.FeatureTags)
local Sim = require(__root.Sim)
local S = 3.57
local function check(cond, msg) if not cond then error("FAIL: " .. msg, 2) end end

ParkBuilder.buildPark(Sim.ParkLayout.WAKE_PARK, true)
-- FX attachments on every feature.
for _, m in FeatureRegistry.all() do
	local anchor = m:FindFirstChild("FX"):FindFirstChild("Anchor")
	check(anchor and anchor:FindFirstChild("SplashEntry") and anchor:FindFirstChild("SplashExit"), m.Name .. ": FX attachments")
end
FeatureFX.prepareAll()
-- Map data: 12 features in 4 lines.
local groups = FeatureMap.byLine()
check(#groups == 4, "4 lines on the map, got " .. #groups)
check(#FeatureMap.entries() == 12, "12 features on the map")
FeatureMap.mount(Instance.new("Folder"), Sim.ParkLayout.WAKE_PARK.site)

-- Ride the wake park with the Luau sim on a scripted line: steer onto each
-- feature's line, pop at kicker lips; feed the events to FX, stats, tags and
-- challenges.
local cfg = Sim.Config.makeConfig({ feature = { balanceEnabled = false } })
local all = {}
local tagSeen = {}
for _, def in Sim.ParkLayout.WAKE_PARK.features do
	if def.catalog == "MediumKicker" or def.catalog == "GapBox" or def.catalog == "PipeRail" then
		local s = Sim.World.createSim(cfg, { name = "x", features = { def } }, def.s - 10)
		local f = s.features[1]
		local shape = f.shape
		local safety = shape.pieces[1]
		local w = Sim.OnFeature.safetyWindow(safety, cfg)
		for i = 1, 60 * 9 do
			local l = Sim.Features.toLocal(f, s.rider.pos)
			local v = s.rider.vel
			local lat = v.x * -math.sin(f.heading) + v.z * math.cos(f.heading)
			local inp = Sim.Input.neutralInput()
			if s.rider.mode == "riding" and l.u > -26 and l.u < 0.3 then
				local pred = l.v - 0.14 * def.offset + lat * 0.8
				inp.steer = if pred < -0.1 then 1 elseif pred > 0.1 then -1 else 0
			end
			if s.rider.mode == "onKicker" then
				inp.pop = (safety.u1 - l.u) / math.max(math.sqrt(v.x * v.x + v.z * v.z), 0.5) > 0.06
			elseif s.rider.mode == "onSafety" and shape.safetyMode == "Gap" then
				inp.pop = l.u < (w.start + w["end"]) / 2 and l.u > (w.start + w["end"]) / 2 - 0.6
			end
			Sim.Step.stepSim(s, inp)
			for _, e in s.events do table.insert(all, e) end
			FeatureFX.onEvents(s, s.events)
			FeatureStats.record("tester", s.events)
			FeatureTags.step(Vector3.new(s.rider.pos.x * S, s.rider.pos.y * S, s.rider.pos.z * S))
			local m = FeatureRegistry.byId(def.id)
			if m and FeatureTags.isShown(m) then tagSeen[def.id] = true end
			if s.rider.mode == "crashed" then break end
		end
	end
end
check(tagSeen.L1_MediumKicker_01 and tagSeen.L2_GapBox_01, "name tags shown on approach")
local splashes = 0
for _, x in FeatureFX.log do if x.kind == "Splash" then splashes += 1 end end
check(splashes >= 3, "splashes fired: " .. splashes)
check(FeatureStats.get("tester", "L1_MediumKicker_01").hits >= 1, "kicker hit counted")
check(FeatureStats.get("tester", "L1_MediumKicker_01").cleanLandings >= 1, "clean landing counted")
local done = FeatureChallenges.completed(all, { L1_PipeRail_01 = 1.2 })
local has = {}
for _, id in done do has[id] = true end
check(has.C_MediumAir, "medium kicker air challenge")
check(has.C_GapPopOn, "gap box pop-on challenge")
check(has.C_PipeBackboard == nil, "a 50-50 is not a backboard")
print("challenges done: " .. table.concat(done, ", "))

-- Preview tool.
workspace.CurrentCamera = { CFrame = CFrame.new(0, 10, 0) }
local p = FeatureBuilder.preview("Funbox", { exitLength = 3.5 })
check(p.Parent and p.Parent.Name == "Preview", "preview in Park/Preview")
FeatureBuilder.preview("Slider")
check(p.Parent == nil and #workspace:FindFirstChild("Park"):FindFirstChild("Preview"):GetChildren() == 1, "preview replaces the last one")
print("FEATURE EXTRAS OK")
