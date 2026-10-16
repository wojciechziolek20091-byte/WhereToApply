--!strict
-- LayoutValidator (layout spec section 1.5): checks a park's layout against
-- the real-park rules (Park/Layout.RULES) and prints a pass / fail table, one
-- row per feature and rule. Twin of src/park/layoutValidator.ts (same rules,
-- rows and values; tests/layout.test.ts compares them), plus "Ride data":
-- after a build, every placed model still has its tags, attributes, ride
-- parts, attachments and crash volumes, and stands where the layout says.
--
--   local rows = LayoutValidator.validate(Sim.ParkLayout.WAKE_PARK, Layout.MAIN)
--   LayoutValidator.print(rows)
local CollectionService = game:GetService("CollectionService")

local FeatureConfig = require(script.Parent.FeatureConfig)
local Layout = require(script.Parent.Layout)
local PlaceFeatures = require(script.Parent.PlaceFeatures)
local Sim = require(script.Parent.Parent.Sim)

local LayoutValidator = {}

export type Row = { feature: string, rule: string, pass: boolean, value: string, limit: string }

type P = { x: number, z: number }

local function f1(v: number): string
	return string.format("%.1f", math.floor(v * 10 + 0.5) / 10)
end

local function num(v: number): string
	-- As JavaScript prints a number: no trailing ".0".
	if v == math.floor(v) then
		return tostring(math.floor(v))
	end
	return tostring(v)
end

local function area(poly: { P }): number
	local a = 0
	for i = 1, #poly do
		local p, q = poly[i], poly[i % #poly + 1]
		a += p.x * q.z - q.x * p.z
	end
	return a / 2
end

local function inside(p: P, poly: { P }): boolean
	local c = false
	local j = #poly
	for i = 1, #poly do
		local a, b = poly[i], poly[j]
		if (a.z > p.z) ~= (b.z > p.z) and p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x then
			c = not c
		end
		j = i
	end
	return c
end

local function segDist(p: P, a: P, b: P): number
	local dx, dz = b.x - a.x, b.z - a.z
	local l2 = dx * dx + dz * dz
	local t = if l2 > 0 then math.clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0, 1) else 0
	local x, z = a.x + dx * t - p.x, a.z + dz * t - p.z
	return math.sqrt(x * x + z * z)
end

local function outlineDist(p: P, poly: { P }): number
	local d = math.huge
	for i = 1, #poly do
		d = math.min(d, segDist(p, poly[i], poly[i % #poly + 1]))
	end
	return d
end

local function polyDist(p: P, poly: { P }): number
	return if inside(p, poly) then 0 else outlineDist(p, poly)
end

local function overlaps(a: { P }, b: { P }): boolean
	for _, poly in { a, b } do
		for i = 1, #poly do
			local p, q = poly[i], poly[i % #poly + 1]
			local nx, nz = -(q.z - p.z), q.x - p.x
			local amin, amax, bmin, bmax = math.huge, -math.huge, math.huge, -math.huge
			for _, r in a do
				local v = r.x * nx + r.z * nz
				amin, amax = math.min(amin, v), math.max(amax, v)
			end
			for _, r in b do
				local v = r.x * nx + r.z * nz
				bmin, bmax = math.min(bmin, v), math.max(bmax, v)
			end
			if amax <= bmin or bmax <= amin then
				return false
			end
		end
	end
	return true
end

-- Island shore edges: every island edge except the seams two islands share.
local function islandShore(site: any): { { P } }
	local function key(a: P, b: P): string
		local s1, s2 = `{num(a.x)},{num(a.z)}`, `{num(b.x)},{num(b.z)}`
		return if s1 < s2 then s1 .. "|" .. s2 else s2 .. "|" .. s1
	end
	local edges, seen = {}, {}
	for _, island in site.islands or {} do
		local o = island.outline
		for i = 1, #o do
			local a, b = o[i], o[i % #o + 1]
			table.insert(edges, { a, b })
			seen[key(a, b)] = (seen[key(a, b)] or 0) + 1
		end
	end
	local out = {}
	for _, e in edges do
		if seen[key(e[1], e[2])] == 1 then
			table.insert(out, e)
		end
	end
	return out
end

-- Signed distance to the nearest shore (lake or island): + over water.
function LayoutValidator.shoreDistance(site: any, p: P, shoreEdges: { { P } }?): number
	local lake = (if inside(p, site.lake) then 1 else -1) * outlineDist(p, site.lake)
	local onIsland = false
	for _, island in site.islands or {} do
		if inside(p, island.outline) or outlineDist(p, island.outline) < 1e-6 then
			onIsland = true
		end
	end
	local di = math.huge
	for _, e in shoreEdges or islandShore(site) do
		di = math.min(di, segDist(p, e[1], e[2]))
	end
	return if onIsland then math.min(lake, -di) else math.min(lake, di)
end

local function category(t: string, beginner: boolean): string
	if beginner then
		return "Beginner"
	end
	if t == "Pyramid" or t == "Spine" or t == "WallRide" then
		return "Big"
	end
	if string.sub(t, -6) == "Kicker" then
		return "Kicker"
	end
	local style = Sim.FeatureCatalog.FEATURE_CATALOG[t].params.style
	return if style == "Pipe" or style == "Rail" then "Rail" else "Box"
end

function LayoutValidator.validate(park: any, entries: { any }, rules: any?, beginner: boolean?): { Row }
	local R = rules or Layout.RULES
	local cable = PlaceFeatures.travelCable(PlaceFeatures.cableOf(park), R.direction)
	local path = Sim.Cable.buildCablePath(cable)
	local straights = PlaceFeatures.straights(cable)
	local resolved = Sim.Park.resolvePark(park, path)
	local rows: { Row } = {}
	local function row(feature: string, rule: string, pass: boolean, value: string, limit: string)
		table.insert(rows, { feature = feature, rule = rule, pass = pass, value = value, limit = limit })
	end
	if cable.mode ~= "twoTower" then
		local ccw = area(cable.towers) < 0
		row("park", "Direction", ccw == (R.direction == "CounterClockwise"), if ccw then "CounterClockwise" else "Clockwise", R.direction)
	end
	local placed = {}
	for _, e in entries do
		local f
		for _, r in resolved do
			if r.def.id == e.featureId then
				f = r
			end
		end
		assert(f, `{e.featureId} is not in {park.name}`)
		local st = straights[e.straight]
		local sh = f.shape
		local fx, fz = math.cos(f.heading), math.sin(f.heading)
		local function at(u: number, v: number): P
			return { x = f.origin.x + fx * u - fz * v, z = f.origin.z + fz * u + fx * v }
		end
		local kicker = Sim.FeatureCatalog.FEATURE_CATALOG[e.type].meta.tag == "Kicker"
		local ro = if kicker then R.runOut.Kicker else R.runOut.Other
		local w = 1
		local foot = { at(sh.uMin, sh.vMin), at(sh.uMax, sh.vMin), at(sh.uMax, sh.vMax), at(sh.uMin, sh.vMax) }
		local seg
		for _, g in path.segments do
			if g.kind == "line" and math.abs(g.s0 - st.s0) < 1e-6 then
				seg = g
				break
			end
		end
		local hx, hz = math.cos(seg.heading), math.sin(seg.heading)
		local amin, amax, lmin, lmax = math.huge, -math.huge, math.huge, -math.huge
		for _, q in foot do
			local along = (q.x - seg.start.x) * hx + (q.z - seg.start.z) * hz
			local lat = -(q.x - seg.start.x) * hz + (q.z - seg.start.z) * hx
			amin, amax, lmin, lmax = math.min(amin, along), math.max(amax, along), math.min(lmin, lat), math.max(lmax, lat)
		end
		table.insert(placed, {
			entry = e,
			foot = foot,
			approach = { at(sh.uMin - R.approach, sh.vMin - w), at(sh.uMin, sh.vMin - w), at(sh.uMin, sh.vMax + w), at(sh.uMin - R.approach, sh.vMax + w) },
			runOut = { at(sh.uMax, sh.vMin - w), at(sh.uMax + ro, sh.vMin - w), at(sh.uMax + ro, sh.vMax + w), at(sh.uMax, sh.vMax + w) },
			startAlong = amin,
			endAlong = amax,
			centreLat = (lmin + lmax) / 2,
			s0 = st.s0,
			yaw = f.def.yaw or 0,
			kicker = kicker,
		})
	end
	local site = park.site or {}
	local docks = site.docks or {}
	local towerBases = {}
	for _, c in site.cables or {} do
		for _, t in c.towers do
			table.insert(towerBases, t.base)
		end
	end
	local buoys = site.buoys or {}
	local dockFeet = {}
	for _, d in docks do
		local a = Sim.Cable.cablePointAt(path, d.s)
		local b = Sim.Cable.cablePointAt(path, d.s + d.length)
		local function r(p: any, off: number): P
			return { x = p.pos.x - math.sin(p.heading) * off, z = p.pos.z + math.cos(p.heading) * off }
		end
		table.insert(dockFeet, { r(a, d.offset - d.width / 2), r(b, d.offset - d.width / 2), r(b, d.offset + d.width / 2), r(a, d.offset + d.width / 2) })
	end
	local shoreEdges = if park.site then islandShore(site) else {}
	local rope = Sim.Config.DEFAULT_CONFIG.rope.length
	for _, p in placed do
		local e = p.entry
		local id = e.featureId
		local L = straights[e.straight].length
		local lo, hi = R.band[1] * L, R.band[2] * L
		row(id, "Band 20-80 %", p.startAlong >= lo - 1e-6 and p.endAlong <= hi + 1e-6, `{f1(p.startAlong)}-{f1(p.endAlong)}`, `{f1(lo)}-{f1(hi)}`)
		local cornerOk = cable.mode == "twoTower" or (p.startAlong >= R.cornerAfter and p.endAlong <= L - R.cornerBefore)
		row(id, "Corner zones", cornerOk, `{f1(p.startAlong)} after / {f1(L - p.endAlong)} before`, `{num(R.cornerAfter)} / {num(R.cornerBefore)}`)
		for _, d in docks do
			local dist = p.s0 + p.startAlong - (d.s + d.length)
			if not path.shuttle then
				dist = math.fmod(math.fmod(dist, path.length) + path.length, path.length)
			end
			row(id, "Start clear", dist >= R.startClear, `{f1(dist)} after {d.name}`, num(R.startClear))
		end
		local same = {}
		for _, q in placed do
			if q.entry.straight == e.straight then
				table.insert(same, q)
			end
		end
		table.sort(same, function(a, b)
			return a.startAlong < b.startAlong
		end)
		local nextP
		for k, q in same do
			if q == p then
				nextP = same[k + 1]
			end
		end
		if nextP then
			local gap = nextP.startAlong - p.endAlong
			local need = math.max(R.spacing[1], (if p.kicker then R.runOut.Kicker else R.runOut.Other) + R.approach)
			row(id, "Spacing", gap >= need and gap <= R.spacing[2], `{f1(gap)} to {nextP.entry.featureId}`, `{num(need)}-{num(R.spacing[2])}`)
			row(id, "Alternating sides", nextP.entry.side ~= e.side, `{e.side} then {nextP.entry.side}`, "L/R")
		end
		local cat = category(e.type, beginner == true)
		local o0, o1 = R.offsets[cat][1], R.offsets[cat][2]
		local lat = math.abs(p.centreLat)
		local sgn = if e.side == "R" then 1 else -1
		row(id, "Offset", lat >= o0 - 0.3 and lat <= o1 + 0.3 and e.sideOffset >= o0 and e.sideOffset <= o1 and math.sign(p.centreLat) == sgn, `{f1(lat)} ({e.side}, {cat})`, `{num(o0)}-{num(o1)}`)
		local deg = math.abs(p.yaw) * 180 / math.pi
		local toward = math.sign(p.yaw) == -sgn
		row(id, "Angle in", deg >= R.angleIn[1] - 1e-6 and deg <= R.angleIn[2] + 1e-6 and toward, `{f1(deg)} deg{if toward then "" else " (outward)"}`, `{num(R.angleIn[1])}-{num(R.angleIn[2])}`)
		row(id, "Reach", lat <= rope, f1(lat), num(rope))
		local function blocker(zone: { P }): string
			for _, q in placed do
				if q ~= p and overlaps(zone, q.foot) then
					return q.entry.featureId
				end
			end
			for _, b in buoys do
				if inside(b, zone) then
					return "buoy"
				end
			end
			for _, d in dockFeet do
				if overlaps(zone, d) then
					return "dock"
				end
			end
			for _, b in towerBases do
				if inside(b, zone) then
					return "tower"
				end
			end
			return "clear"
		end
		local run = blocker(p.runOut)
		row(id, "Run-out clear", run == "clear", run, `{num(if p.kicker then R.runOut.Kicker else R.runOut.Other)} m`)
		local app = blocker(p.approach)
		row(id, "Approach clear", app == "clear", app, `{num(R.approach)} m`)
		if park.site then
			local shore = math.huge
			for _, q in p.foot do
				shore = math.min(shore, LayoutValidator.shoreDistance(site, q, shoreEdges))
			end
			row(id, "Shore", shore >= R.shore, f1(shore), num(R.shore))
		end
		if #towerBases > 0 then
			local tb = math.huge
			for _, b in towerBases do
				tb = math.min(tb, polyDist(b, p.foot))
			end
			row(id, "Tower bases", tb >= R.towerBase, f1(tb), num(R.towerBase))
		end
		if #buoys > 0 then
			local bd = math.huge
			for _, b in buoys do
				bd = math.min(bd, polyDist(b, p.foot))
			end
			row(id, "Buoys", bd >= R.buoyClear, f1(bd), num(R.buoyClear))
		end
	end
	return rows
end

-- Ride data intact after a build (Workspace.Park.Features): each layout
-- feature's model has its tags and attributes, ride parts with Start / End
-- attachments, a LipPoint on kicker-type features, a PopZoneStart on
-- safeties, crash volumes on anything slid or ridden up, and its Root where
-- the def puts it.
function LayoutValidator.rideData(park: any, entries: { any }, folder: Instance): { Row }
	local rows: { Row } = {}
	local path = Sim.Cable.buildCablePath(PlaceFeatures.cableOf(park))
	local resolved = Sim.Park.resolvePark(park, path)
	local S = FeatureConfig.StudsPerMetre
	for _, e in entries do
		local model = folder:FindFirstChild(e.featureId) :: Model?
		local problems = {}
		if not model then
			table.insert(problems, "no model")
		else
			if not CollectionService:HasTag(model, FeatureConfig.Tags.All) then
				table.insert(problems, "tag")
			end
			for _, a in { "FeatureType", "Difficulty", "SafetyMode" } do
				if model:GetAttribute(a) == nil then
					table.insert(problems, "attribute " .. a)
				end
			end
			local ride = model:FindFirstChild("Ride")
			local nRide, lips, pops = 0, 0, 0
			for _, p in if ride then ride:GetChildren() else {} do
				if p:IsA("BasePart") then
					nRide += 1
					if not (p:FindFirstChild("Start") and p:FindFirstChild("End")) or p:GetAttribute("SurfaceRole") == nil then
						table.insert(problems, "ride part " .. p.Name)
					end
					if p:FindFirstChild("LipPoint") then
						lips += 1
					end
					if p:FindFirstChild("PopZoneStart") then
						pops += 1
					end
				end
			end
			if nRide == 0 then
				table.insert(problems, "no ride parts")
			end
			local entry = Sim.FeatureCatalog.FEATURE_CATALOG[e.type]
			if entry.meta.tag == "Kicker" and lips == 0 then
				table.insert(problems, "no LipPoint")
			end
			local shape = Sim.FeatureShapes.buildShape(e.type, e.params, e.partSide or 1)
			local hasSafety, slides = false, false
			for _, piece in shape.pieces do
				if piece.role == "Safety" then
					hasSafety = true
				end
				if (piece.slide and not piece.cap) or piece.wall then
					slides = true
				end
			end
			if hasSafety and pops == 0 then
				table.insert(problems, "no PopZoneStart")
			end
			-- Crash volumes under slide tops, in gaps and along walls (kickers launch: none).
			local crash = model:FindFirstChild("Crash")
			if not crash then
				table.insert(problems, "no Crash folder")
			elseif slides and #crash:GetChildren() == 0 then
				table.insert(problems, "no crash volumes")
			end
			for _, r in resolved do
				if r.def.id == e.featureId and model.PrimaryPart then
					local pos = model.PrimaryPart.CFrame.Position
					local d = math.sqrt((pos.X / S - r.origin.x) ^ 2 + (pos.Z / S - r.origin.z) ^ 2)
					if d > 0.05 then
						table.insert(problems, string.format("Root %.2f m off", d))
					end
				end
			end
		end
		table.insert(rows, { feature = e.featureId, rule = "Ride data", pass = #problems == 0, value = if #problems == 0 then "intact" else table.concat(problems, ", "), limit = "tags, attributes, ride parts, attachments" })
	end
	return rows
end

function LayoutValidator.print(rows: { Row })
	local failed = 0
	for _, r in rows do
		if not r.pass then
			failed += 1
		end
		print(string.format("%s  %-18s %-17s  %-26s  %s", if r.pass then "PASS" else "FAIL", r.feature, r.rule, r.value, r.limit))
	end
	print(`{#rows - failed} passed, {failed} failed`)
end

return LayoutValidator
