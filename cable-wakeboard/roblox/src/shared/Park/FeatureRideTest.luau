--!strict
-- FeatureRideTest (features spec section 10): proves every feature is
-- rideable with the game's own rider: the Luau sim (Sim/), which is the
-- same code the server runs and bit-identical to the web game. For each
-- feature def it rides the approach at cable speed and:
--   kickers, pyramid, spine  launch with the ideal lip pop; lip speed, launch
--                            angle, max height, airtime, landing distance
--   boxes and rails          (a) up the safety (a pop in the window if it is a
--                            gap), slide, exit cleanly; (b) ollie on from the
--                            water (searched); step-ups and transfers: pop
--                            from the first main onto the second (searched)
--   kinks                    no speed spike or catch at the joints
--   wall ride                up the transition, onto the wall, back out
-- and checks along the way that FeatureRegistry.getSurfaceAt (the Roblox
-- parts) finds the role the sim is riding. Prints a pass / fail table.
--
-- Studio: require(ReplicatedStorage.WakeShared.Park.FeatureRideTest).runAll(defs)
local FeatureBuilder = require(script.Parent.FeatureBuilder)
local FeatureConfig = require(script.Parent.FeatureConfig)
local FeatureModel = require(script.Parent.FeatureModel)
local FeatureRegistry = require(script.Parent.FeatureRegistry)
local Sim = require(script.Parent.Parent.Sim)

local FeatureRideTest = {}

local S = FeatureConfig.StudsPerMetre

-- Expected airtime with cable pull (spec 10.3), by catalogue name.
FeatureRideTest.EXPECTED_AIR = {
	BeginnerKicker = { 0.6, 0.9 },
	MediumKicker = { 1.0, 1.4 },
	ProKicker = { 1.4, 2.0 },
}

export type Row = { id: string, test: string, pass: boolean, detail: string, numbers: { [string]: number } }

local function makeSim(def: any)
	-- The balance meter is the player's job; the ride test checks the geometry.
	local cfg = Sim.Config.makeConfig({ feature = { balanceEnabled = false } })
	local s = Sim.World.createSim(cfg, { name = "ride test", features = { def } }, def.s - 10)
	return s, s.features[1]
end

local function input(over: { [string]: any }?): any
	local i = Sim.Input.neutralInput()
	for k, v in over or {} do
		i[k] = v
	end
	return i
end

local function with(def: any, over: { [string]: any }): any
	local d = table.clone(def)
	for k, v in over do
		d[k] = v
	end
	return d
end

local function hspeed(v: any): number
	return math.sqrt(v.x * v.x + v.z * v.z)
end

-- Sideways speed in the feature's frame.
local function lateral(sim: any, f: any): number
	local v = sim.rider.vel
	return v.x * -math.sin(f.heading) + v.z * math.cos(f.heading)
end

-- Steer onto the line v = target before the feature (a rider lining up on the
-- approach): carve toward where the rider will be in 0.8 s, aiming a little
-- outside the line in proportion to the feature's offset from the cable,
-- against the rope's pull back toward it. Water only.
local function lineUp(sim: any, f: any, l: any, target: number, from: number, to: number, offset: number): number
	local m = sim.rider.mode
	if (m ~= "riding" and m ~= "waterTrickLoad") or l.u < from or l.u > to then
		return 0
	end
	local pred = l.v - target - 0.14 * offset + lateral(sim, f) * 0.8
	return if pred < -0.1 then 1 elseif pred > 0.1 then -1 else 0
end

local function inWater(sim: any): boolean
	return sim.rider.mode == "riding" or sim.rider.mode == "waterTrickLoad"
end

-- Ride one scripted run. `script(t, s, f, l)` returns input overrides; `onTick`
-- sees every tick; stops `after` seconds after leaving the feature, or on a crash.
local function ride(def: any, seconds: number, script: (number, any, any, any) -> { [string]: any }?, onTick: ((any, any, any) -> ())?)
	local s, f = makeSim(def)
	local events = {}
	local leftAt = -1
	for i = 1, math.floor(seconds * 60) do
		local l = Sim.Features.toLocal(f, s.rider.pos)
		Sim.Step.stepSim(s, input(script(i / 60, s, f, l)))
		for _, e in s.events do
			table.insert(events, e)
			if e.type == "featureExit" then
				leftAt = i
			end
		end
		if onTick then
			onTick(s, f, Sim.Features.toLocal(f, s.rider.pos))
		end
		if s.rider.mode == "crashed" or (leftAt > 0 and i - leftAt > 90 and s.rider.mode ~= "airborne") then
			break
		end
	end
	return s, f, events
end

local function find(events: { any }, pred: (any) -> boolean): any
	for _, e in events do
		if pred(e) then
			return e
		end
	end
	return nil
end

local function crashOf(events: { any }): string?
	local e = find(events, function(e)
		return e.type == "crash"
	end)
	return if e then e.reason else nil
end

local function firstPiece(shape: any, pred: (any) -> boolean): any
	for _, p in shape.pieces do
		if pred(p) then
			return p
		end
	end
	return nil
end

-- Build the def's Roblox model where the sim put it, for the registry checks.
local function buildModel(def: any, f: any): Model
	local m = FeatureBuilder.build({
		id = def.id, catalog = def.catalog, params = def.params, side = def.side, accent = def.accent, name = def.name,
		origin = Vector3.new(f.origin.x, 0, f.origin.z), heading = f.heading, offsetFromCable = def.offset, yaw = def.yaw,
	})
	m.Parent = FeatureModel.featuresFolder()
	FeatureRegistry.refresh(m)
	return m
end

-- Registry agreement: each tick on the feature, the Roblox parts under the rider have the sim's role.
local function registryCheck()
	local hits, total, worst = 0, 0, 0
	local function onTick(s: any, f: any, l: any)
		local r = s.rider
		if not r.ramp or (r.mode ~= "onKicker" and r.mode ~= "onSafety" and r.mode ~= "onFeature") then
			return
		end
		local surf = Sim.Features.surfaceAt(f, { u = r.ramp.u, v = r.ramp.v })
		if not surf then
			return
		end
		total += 1
		local n = surf.normal
		local pos = Vector3.new(r.pos.x * S, r.pos.y * S, r.pos.z * S)
		local nw = Vector3.new(n.x, n.y, n.z)
		local hit = FeatureRegistry.getSurfaceAt(pos + nw * 0.3 * S, -nw)
		local want = surf.piece.role
		if hit and (hit.role == want or (want == "Ramp" and hit.role == "Lip")) then
			hits += 1
			worst = math.max(worst, math.abs((hit.point - pos).Magnitude / S))
		end
	end
	return onTick, function()
		return hits, total, worst
	end
end

local function row(rows: { Row }, id: string, test: string, pass: boolean, detail: string, numbers: { [string]: number }?)
	table.insert(rows, { id = id, test = test, pass = pass, detail = detail, numbers = numbers or {} })
end

-- Kickers, pyramid, spine: launch with the ideal pop.
local function testLaunch(def: any, rows: { Row })
	local shape = Sim.Park.shapeOfDef(def)
	local lip = firstPiece(shape, function(p)
		return p.lip
	end)
	local offset = FeatureConfig.Approach.IdealPopOffset
	local function run(pop: boolean)
		local takeoff, landTick, peak, take = nil, nil, 0, nil
		local tick = 0
		local reg, regResult = registryCheck()
		local s, _, events = ride(def, 9, function(_, sim, f, l)
			if inWater(sim) then
				return { steer = lineUp(sim, f, l, 0, -26, 0, def.offset or 0) }
			end
			if not pop or sim.rider.mode ~= "onKicker" or not sim.rider.ramp then
				return nil
			end
			local toLip = (lip.u1 - l.u) / math.max(hspeed(sim.rider.vel), 0.5)
			return { pop = toLip > offset }
		end, function(sim, f, l)
			tick += 1
			reg(sim, f, l)
			local r = sim.rider
			if r.air then
				peak = math.max(peak, r.pos.y)
			end
			for _, e in sim.events do
				if e.type == "takeoff" and not takeoff then
					takeoff = tick
					take = { speed = math.sqrt(r.vel.x ^ 2 + r.vel.y ^ 2 + r.vel.z ^ 2), angle = math.deg(math.atan2(r.vel.y, hspeed(r.vel))), x = r.pos.x, z = r.pos.z }
				elseif e.type == "landed" and takeoff and not landTick then
					landTick = tick
					take.dist = math.sqrt((r.pos.x - take.x) ^ 2 + (r.pos.z - take.z) ^ 2)
				end
			end
		end)
		local landedOnRamp = find(events, function(e)
			return e.type == "transition" and e.reason == "landedOnRamp"
		end) ~= nil
		local _ = s
		return {
			air = if takeoff and landTick then (landTick - takeoff) / 60 else 0,
			peak = peak,
			take = take,
			crash = crashOf(events),
			onRamp = landedOnRamp,
			lipPop = find(events, function(e)
				return e.type == "landed" and e.air.lipPop
			end) ~= nil,
			reg = { regResult() },
		}
	end
	local plain = run(false)
	local popped = run(true)
	local exp = FeatureRideTest.EXPECTED_AIR[def.catalog]
	local nums = {
		lipSpeed = if popped.take then popped.take.speed else 0,
		launchAngle = if popped.take then popped.take.angle else 0,
		maxHeight = popped.peak,
		airtime = popped.air,
		airtimePlain = plain.air,
		distance = if popped.take and popped.take.dist then popped.take.dist else 0,
	}
	local detail = string.format("lip %.1f m/s at %.0f deg, peak %.2f m, air %.2f s (plain %.2f), %.1f m", nums.lipSpeed, nums.launchAngle, nums.maxHeight, nums.airtime, nums.airtimePlain, nums.distance)
	if exp then
		row(rows, def.id, "Launch (ideal pop)", popped.crash == nil and popped.lipPop and popped.air >= exp[1] and popped.air <= exp[2], detail .. string.format(" [want %.1f-%.1f s]", exp[1], exp[2]), nums)
	elseif def.catalog == "Spine" then
		row(rows, def.id, "Launch, land on the down slope", popped.crash == nil and popped.onRamp, detail .. (if popped.onRamp then ", on the landing ramp" else ", missed the landing ramp"), nums)
	else
		row(rows, def.id, "Launch and land", popped.crash == nil and popped.air > 0.3, detail, nums)
	end
	local h, t, w = table.unpack(popped.reg)
	row(rows, def.id, "Registry along the ramp", t > 0 and h / t >= 0.95, string.format("%d/%d ticks, %.1f cm", h, t, w * 100))
end

-- Boxes and rails: (a) up the safety; slide; exit cleanly. Kink joints. Registry.
local function testSafety(def: any, rows: { Row })
	local shape = Sim.Park.shapeOfDef(def)
	local safety = firstPiece(shape, function(p)
		return p.role == "Safety"
	end)
	local cfg = Sim.Config.DEFAULT_CONFIG
	local w = Sim.OnFeature.safetyWindow(safety, cfg)
	local popAt = (w.start + w["end"]) / 2
	local gap = shape.safetyMode == "Gap"
	local speeds, maxJump = {}, 0
	local reg, regResult = registryCheck()
	local _, _, events = ride(def, 10, function(_, sim, f, l)
		if inWater(sim) then
			return { steer = lineUp(sim, f, l, safety.v0, -26, 0.3, def.offset or 0) }
		end
		if gap and sim.rider.mode == "onSafety" then
			-- A quick tap that releases at the window's centre.
			return { pop = l.u < popAt and l.u > popAt - 0.6 }
		end
		return nil
	end, function(sim, f, l)
		reg(sim, f, l)
		if sim.rider.mode == "onFeature" then
			local v = sim.rider.vel
			local sp = math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
			if #speeds > 0 then
				maxJump = math.max(maxJump, math.abs(sp - speeds[#speeds]))
			end
			table.insert(speeds, sp)
		else
			speeds = {}
		end
	end)
	local mount = find(events, function(e)
		return e.type == "transition" and e.to == "onFeature"
	end)
	local slide = find(events, function(e)
		return e.type == "slideDone"
	end)
	local crash = crashOf(events)
	local entry = if slide then slide.jib.entry else "-"
	local time = if slide then slide.jib.time else 0
	-- A step-up's low rail runs into the high one: without the pop up, that is the short ollie.
	local stepUp = def.catalog == "StepUp"
	local clean = crash == nil or (stepUp and crash == "shortOllie")
	row(rows, def.id, if gap then "Up the safety, pop in the window" else "Up the safety", mount ~= nil and slide ~= nil and clean,
		string.format("%s, slid %.2f s%s", entry, time, if crash then ", " .. crash .. (if stepUp then " into the high rail (expected)" else "") else ", clean exit"), { slideTime = time })
	-- Kinks: several slide pieces in one part.
	local perPart: { [number]: number } = {}
	local kinks = 0
	for _, p in shape.pieces do
		if p.slide then
			perPart[p.part] = (perPart[p.part] or 0) + 1
			kinks = math.max(kinks, perPart[p.part])
		end
	end
	if kinks > 1 then
		row(rows, def.id, "Kink joints", maxJump <= 0.3 and clean, string.format("largest speed change in a tick %.2f m/s", maxJump), { maxJump = maxJump })
	end
	local h, t, wst = regResult()
	row(rows, def.id, "Registry along the feature", t > 0 and h / t >= 0.95, string.format("%d/%d ticks, %.1f cm", h, t, wst * 100))
end

-- Pop from the first main onto a later part: step-ups (straight up) and
-- transfers (A/D tapped toward the other box as the pop goes, which hops
-- sideways). A seeded random search over the release point and the charge.
local function testTransferPop(def: any, rows: { Row }, label: string, maxTries: number)
	local shape = Sim.Park.shapeOfDef(def)
	local mains = {}
	for _, p in shape.pieces do
		if p.slide and p.axis == "u" then
			mains[p.part] = mains[p.part] or p
		end
	end
	local first, second = mains[1], mains[2]
	if not first or not second then
		return
	end
	local safety = firstPiece(shape, function(p)
		return p.role == "Safety"
	end)
	local hopDir = if math.abs(second.v0 - first.v0) > 0.3 then (if second.v0 > first.v0 then 1 else -1) else 0
	local rng = Sim.Rng.createRng(17)
	local found, tries = nil, 0
	while not found and tries < maxTries do
		tries += 1
		local rel = Sim.Rng.nextFloat(rng)
		local hold = 0.05 + 0.4 * Sim.Rng.nextFloat(rng)
		local release = first.u0 + (first.u1 - first.u0) * rel
		local mounts = 0
		local _, _, events = ride(def, 9, function(_, sim, f, l)
			if inWater(sim) then
				return { steer = lineUp(sim, f, l, safety.v0, -26, 0.3, def.offset or 0) }
			end
			if sim.rider.mode == "onFeature" and sim.rider.ramp and sim.rider.ramp.u < first.u1 and l.u < second.u0 then
				local pop = l.u >= release - hold * 8 and l.u < release
				local hop = if hopDir ~= 0 and l.u > release - 0.4 and l.u < release + 0.4 then hopDir else 0
				return { pop = pop, steer = hop }
			end
			return nil
		end, function(sim)
			for _, e in sim.events do
				if e.type == "transition" and e.to == "onFeature" then
					mounts += 1
				end
			end
		end)
		if mounts >= 2 and not crashOf(events) then
			local second2 = find(events, function(e)
				return e.type == "transition" and e.to == "onFeature" and e.reason == "ollieOn"
			end)
			if second2 then
				found = { release = release, hold = hold }
			end
		end
	end
	row(rows, def.id, label, found ~= nil, if found then string.format("pop at u=%.1f m, charge %.2f s (%d tries)", found.release, found.hold, tries) else `no pop reached it ({tries} tries)`, { tries = tries })
end

-- (b) Ollie on from the water: ride in beside the safety, cut in, ollie onto
-- the main. A seeded random search over the line, the cut and the pop.
local function testOllieOn(def: any, rows: { Row }, maxTries: number)
	local shape = Sim.Park.shapeOfDef(def)
	local main = firstPiece(shape, function(p)
		return p.slide and p.axis == "u"
	end)
	local safety = firstPiece(shape, function(p)
		return p.role == "Safety"
	end)
	local rng = Sim.Rng.createRng(29)
	local found, tries = nil, 0
	while not found and tries < maxTries do
		tries += 1
		local side = if Sim.Rng.nextFloat(rng) < 0.5 then -1 else 1
		local beside = safety.v0 + side * (safety.width / 2 + 0.6 + 2.4 * Sim.Rng.nextFloat(rng))
		local a = -14 + 14 * Sim.Rng.nextFloat(rng)
		local b = a + 1 + 8 * Sim.Rng.nextFloat(rng)
		local rel = -2 + 8 * Sim.Rng.nextFloat(rng)
		local hold = 0.08 + 0.4 * Sim.Rng.nextFloat(rng)
		local _, _, events = ride(def, 9, function(_, sim, f, l)
			if not inWater(sim) then
				return nil
			end
			local steer = lineUp(sim, f, l, beside, -26, main.u0 + a, def.offset or 0)
			if l.u > main.u0 + a and l.u < main.u0 + b then
				steer = -side
			end
			return { steer = steer, pop = l.u > main.u0 + rel - hold * 8 and l.u < main.u0 + rel }
		end)
		local e = find(events, function(x)
			return x.type == "transition" and x.to == "onFeature" and x.reason == "ollieOn"
		end)
		if e and not crashOf(events) then
			found = { beside = beside, rel = rel }
		end
	end
	row(rows, def.id, "Ollie on from the water", found ~= nil, if found then string.format("from v=%.1f m, pop %.1f m along the main (%d tries)", found.beside, found.rel, tries) else `not found ({tries} tries)`, { tries = tries })
end

local function testWall(def: any, rows: { Row })
	local peak, onWall = 0, 0
	local reg, regResult = registryCheck()
	local _, _, events = ride(def, 9, function()
		return nil
	end, function(sim, f, l)
		reg(sim, f, l)
		if sim.rider.mode == "onFeature" then
			onWall += 1
			peak = math.max(peak, sim.rider.pos.y)
		end
	end)
	local slide = find(events, function(e)
		return e.type == "slideDone"
	end)
	local crash = crashOf(events)
	local name = if slide then table.concat(slide.jib.slideOrder, "/") else "-"
	row(rows, def.id, "Up the wall and out", slide ~= nil and name == "wallRide" and peak >= 0.5 and crash == nil,
		string.format("%s %.2f s, %.2f m up%s", name, onWall / 60, peak, if crash then ", crash " .. crash else ""), { wallTime = onWall / 60, wallHeight = peak })
	local h, t, wst = regResult()
	row(rows, def.id, "Registry on the wall", t > 0 and h / t >= 0.9, string.format("%d/%d ticks, %.1f cm", h, t, wst * 100))
end

-- Ride-test one catalogue feature def (as placed in a park: s, offset, yaw).
function FeatureRideTest.run(def: any): { Row }
	local rows: { Row } = {}
	local entry = (FeatureConfig.Catalog :: any)[def.catalog]
	local shape = Sim.Park.shapeOfDef(def)
	local _, f = makeSim(def)
	buildModel(def, f)
	local p = entry.params
	if p.shape == "wall" then
		testWall(def, rows)
	elseif p.shape == "kicker" or p.shape == "spine" or p.shape == "pyramid" then
		testLaunch(def, rows)
	else
		testSafety(def, rows)
		local parts = 0
		for _, piece in shape.pieces do
			parts = math.max(parts, piece.part)
		end
		if p.shape == "transfer" then
			testTransferPop(def, rows, "Transfer A to B", 600)
		elseif parts >= 2 and shape.pieces[#shape.pieces].role == "Main" and p.mains and #p.mains >= 2 then
			testTransferPop(def, rows, "Pop up to the second rail", 600)
		end
		testOllieOn(def, rows, 600)
	end
	return rows
end

function FeatureRideTest.runAll(defs: { any }, quiet: boolean?): ({ Row }, boolean)
	FeatureRegistry.init()
	local all: { Row } = {}
	local ok = true
	for _, def in defs do
		for _, r in FeatureRideTest.run(def) do
			table.insert(all, r)
			ok = ok and r.pass
		end
	end
	if not quiet then
		FeatureRideTest.print(all)
	end
	return all, ok
end

function FeatureRideTest.print(rows: { Row })
	for _, r in rows do
		print(string.format("%-4s %-22s %-34s %s", if r.pass then "PASS" else "FAIL", r.id, r.test, r.detail))
	end
end

return FeatureRideTest
