-- Scripted run for the TypeScript <-> Luau parity check. The TypeScript twin is
-- tests/parity/trace.ts: keep the two in lockstep (same RNG draws in the same
-- order, same fields in the same order). Appended to the Sim bundle, which
-- defines `Sim`; prints one tab-separated row per line.
local GRAB_CHOICES = { "indy", "melon", "mute", "stalefish", "nose", "tail", false, false }
local SPIN_CHOICES = { -1, 0, 0, 1 }
local FLIP_CHOICES = { -1, 0, 0, 0, 1 }

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

local function traceRun(seed, ticks)
	local Rng = Sim.Rng
	local run = Sim.Session.createRun(Sim.Config.makeConfig({ run = { maxFalls = 99 } }))
	local rng = Rng.createRng(seed)
	local input = Sim.Input.neutralInput()
	local hold = 0
	local i = 0
	while i < ticks and not run.finished do
		if hold <= 0 then
			hold = 20 + math.floor(Rng.nextFloat(rng) * 70)
			input = {
				edge = Rng.nextRange(rng, -1, 1),
				load = Rng.nextFloat(rng) < 0.4,
				handleIn = Rng.nextRange(rng, 0.3, 1),
				spin = SPIN_CHOICES[math.floor(Rng.nextFloat(rng) * 4) + 1],
				flip = FLIP_CHOICES[math.floor(Rng.nextFloat(rng) * 5) + 1],
				raley = Rng.nextFloat(rng) < 0.15,
				grab = GRAB_CHOICES[math.floor(Rng.nextFloat(rng) * 8) + 1] or nil,
				release = false,
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
			r.connection,
			if r.air then r.air.spinAngle else 0,
			if r.air then r.air.flipAngle else 0,
			run.pass,
			#run.tricks,
			#run.falls,
			run.points,
			if #types > 0 then table.concat(types, ",") else "-",
		})
		for _, rec in run.latest do
			emit({ "trick", rec.tick, rec.trick.key, rec.trick.name, rec.trick.difficulty })
		end
		i += 1
	end
	if run.score then
		for _, j in run.score.judges do
			emit({ "judge", j.execution, j.intensity, j.composition, j.total })
		end
		emit({ "score", run.score.total, run.endReason or "-" })
	end
end

return traceRun
