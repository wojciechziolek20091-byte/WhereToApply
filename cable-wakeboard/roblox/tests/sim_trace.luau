-- Scripted run for the TypeScript <-> Luau parity check. The TypeScript twin is
-- tests/parity/trace.ts: keep the two in lockstep (same RNG draws in the same
-- order, same fields in the same order). Appended to the Sim bundle, which
-- defines `Sim`; prints one tab-separated row per line.
local STEER = { -1, -1, 0, 1, 1 }
local MODS = { "stalefish", "nose", "tail", false, false, false }

local function fmt(v)
	if type(v) == "number" then
		return string.format("%.17g", v)
	end
	return tostring(v)
end

local function emit(row)
	local out = table.create(#row)
	for i, v in row do
		out[i] = fmt(v)
	end
	print(table.concat(out, "\t"))
end

local function traceRun(seed, ticks, park)
	local Rng = Sim.Rng
	local parkDef = if park == "test"
		then Sim.ParkLayout.TEST_PARK
		elseif park == "catalog" then Sim.ParkLayout.CATALOG_TEST_PARK
		else Sim.Park.DEFAULT_PARK
	local run = Sim.Session.createRun(Sim.Config.makeConfig({ run = { maxFalls = 99 } }), parkDef)
	local straight = if park == "default" or park == nil then 0 else 0.6
	local rng = Rng.createRng(seed)
	local input = Sim.Input.neutralInput()
	local hold = 0
	local i = 0
	while i < ticks and not run.finished do
		if hold <= 0 then
			hold = 10 + math.floor(Rng.nextFloat(rng) * 50)
			input = {
				steer = if Rng.nextFloat(rng) < straight then 0 else STEER[math.floor(Rng.nextFloat(rng) * 5) + 1],
				pop = Rng.nextFloat(rng) < 0.35,
				forward = Rng.nextFloat(rng) < 0.15,
				back = Rng.nextFloat(rng) < 0.15,
				pass = Rng.nextFloat(rng) < 0.2,
				grab = Rng.nextFloat(rng) < 0.2,
				grabMod = MODS[math.floor(Rng.nextFloat(rng) * 6) + 1] or nil,
				armsOut = Rng.nextFloat(rng) < 0.05,
				letGo = false,
			}
		end
		hold -= 1
		Sim.Session.stepRun(run, input)
		local s = run.sim
		local r = s.rider
		local types = {}
		for _, e in s.events do
			table.insert(types, e.type)
		end
		emit({
			s.tick,
			r.mode,
			s.carrier.s,
			r.pos.x,
			r.pos.y,
			r.pos.z,
			r.vel.x,
			r.vel.y,
			r.vel.z,
			r.heading,
			r.edgeAngle,
			r.edgeLoad,
			r.ropeTension,
			r.tensionSmooth,
			r.connection,
			r.handle,
			if r.air then r.air.rot.spinAngle else 0,
			if r.air then r.air.rot.flipAngle else 0,
			if r.air and r.air.trick then r.air.trick.rollAngle else 0,
			if r.air then r.air.preWind else 0,
			if r.air then r.air.rot.spinTime else 0,
			s.inputs.steerAge,
			if r.jib then r.jib.boardAngle else 0,
			if r.jib then r.jib.balance else 0,
			run.pass,
			#run.tricks,
			#run.crashes,
			run.points,
			if #types > 0 then table.concat(types, ",") else "-",
		})
		for _, rec in run.latest do
			emit({ "trick", rec.tick, rec.trick.key, rec.trick.points, rec.trick.difficulty })
		end
		i += 1
	end
	if run.score then
		for _, j in run.score.judges do
			emit({ "judge", j.execution, j.intensity, j.composition, j.total })
		end
		emit({ "score", run.score.total, run.endReason or "-", run.bestCombo })
	end
end

return traceRun
