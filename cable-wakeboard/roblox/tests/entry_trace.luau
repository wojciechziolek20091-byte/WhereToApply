-- Scripted feature entries for the TypeScript <-> Luau parity check. The
-- TypeScript twin is tests/parity/entryTrace.ts: same fields in the same
-- order. Appended to the Sim bundle; `entryTrace(sc)` prints one row per tick.
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

local function rotationsOf(j)
	local out = {}
	for _, x in j.rotations do
		table.insert(out, tostring(x.deg) .. (if x.hardWay then "h" else ""))
	end
	return table.concat(out, "/")
end

local function entryTrace(sc)
	local def = {
		kind = "slider",
		id = "b",
		name = "B",
		style = "box",
		s = 135,
		offset = 0,
		length = 8,
		width = 1,
		height = 0.5,
		entryLength = 3,
		safety = "flush",
	}
	for k, v in sc.def do
		def[k] = v
	end
	local park = { name = "entry", features = { def } }
	local s = Sim.World.createSim(Sim.Config.makeConfig({ feature = { balanceEnabled = false } }), park, 125)
	s.rider.stance = sc.stance
	for i = 0, 359 do
		local t = i / 60
		local input = Sim.Input.neutralInput()
		for _, st in sc.steps do
			if t >= st[1] and t < st[2] then
				if st[3] == 1 then
					input.pop = true
				end
				if st[4] ~= 0 then
					input.steer = st[4]
				end
				if st[5] == 1 then
					input.forward = true
				elseif st[5] == -1 then
					input.back = true
				end
			end
		end
		Sim.Step.stepSim(s, input)
		local r = s.rider
		local a = r.approach
		local e = if r.air then r.air.entry else nil
		local crash = nil
		for _, x in s.events do
			if x.type == "crash" then
				crash = x
				break
			end
		end
		emit({
			s.tick,
			r.mode,
			r.pos.x,
			r.pos.y,
			r.pos.z,
			r.vel.x,
			r.vel.y,
			r.vel.z,
			if a then a.side else "-",
			if a then a.featureSide else 0,
			if a then a.edgeAge else 0,
			if e then e.side else "-",
			if e then e.hop else 0,
			if e then e.roll else 0,
			if r.air and r.air.crossing then r.air.crossing.part else "-",
			if r.air and r.air.crossing then r.air.crossing.side else 0,
			if r.air and r.air.tailClip then 1 else 0,
			if r.jib then r.jib.entry else "-",
			if r.jib and r.jib.sketchy then 1 else 0,
			if r.jib then r.jib.balance else 0,
			if r.jib then r.jib.inRotation else 0,
			if r.jib then table.concat(r.jib.slideOrder, "/") else "-",
			if r.jib then rotationsOf(r.jib) else "-",
			if r.jib then r.jib.pressAmount else 0,
			if r.jib then r.jib.fore else 0,
			if r.jib and r.jib.endTap then r.jib.endTap else "-",
			if crash then crash.reason else "-",
		})
		if crash then
			break
		end
	end
end

return entryTrace
