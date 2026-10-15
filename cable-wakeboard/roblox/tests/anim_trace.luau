-- Animation parity, Luau half: twin of tests/parity/animTrace.ts (same sim
-- run with the animator on it, then every test-driver scenario). Appended to
-- the shared bundle, which defines `Sim` and `Anim`; `RIG` is set by the test.
local STEER = { -1, -1, 0, 1, 1 }
local MODS = { "stalefish", "nose", "tail", false, false, false }
local JOINTS = Anim.Skeleton.JOINTS

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

local function frameRow(tag, f)
	local row = { tag, f.root.pos.x, f.root.pos.y, f.root.pos.z, f.root.rot.x, f.root.rot.y, f.root.rot.z, f.root.rot.w }
	table.insert(row, f.hipsOffset.x)
	table.insert(row, f.hipsOffset.y)
	table.insert(row, f.hipsOffset.z)
	for _, j in JOINTS do
		local q = f["local"][j]
		local s = if q.w < 0 then -1 else 1
		table.insert(row, q.x * s)
		table.insert(row, q.y * s)
		table.insert(row, q.z * s)
		table.insert(row, q.w * s)
	end
	for _, v in { f.handle.pos, f.hands.L, f.hands.R, f.com } do
		table.insert(row, v.x)
		table.insert(row, v.y)
		table.insert(row, v.z)
	end
	table.insert(row, f.handKinds.L)
	table.insert(row, f.handKinds.R)
	table.insert(row, if #f.events > 0 then table.concat(f.events, ",") else "-")
	table.insert(row, if f.ragdoll then 1 else 0)
	return row
end

local SCENARIO_US = { 0.3, 0.7 }

local function animTrace(rig, seed, ticks, park)
	local Rng = Sim.Rng
	local parkDef = if park == "test" then Sim.ParkLayout.TEST_PARK else Sim.Park.DEFAULT_PARK
	local run = Sim.Session.createRun(Sim.Config.makeConfig({ run = { maxFalls = 99 } }), parkDef)
	local straight = if park == "test" then 0.6 else 0
	local rng = Rng.createRng(seed)
	local a = Anim.Animator.create(rig)
	local input = Sim.Input.neutralInput()
	local hold = 0
	local prev = nil
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
		local st = Anim.Adapter.fromSim(run.sim, run.sim.events, prev)
		prev = st
		local f = Anim.Animator.step(a, st, 1 / 60)
		if i % 5 == 0 or #f.events > 0 then
			emit(frameRow(string.format("%d|%s|%s", i, st.state, st.trick.id or "-"), f))
		end
		i += 1
	end
	for _, name in Anim.TestDriver.ORDER do
		for _, u in SCENARIO_US do
			local f = Anim.TestDriver.playTo(Anim.Animator.create(rig), Anim.TestDriver.SCENARIOS[name], u, { x = 3, y = 0, z = -2 })
			emit(frameRow(name .. "@" .. tostring(u), f))
		end
	end
end

return animTrace
