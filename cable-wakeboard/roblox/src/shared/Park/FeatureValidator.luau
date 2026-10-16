--!strict
-- FeatureValidator (features spec section 5): checks a built feature model
-- against the rideability rules and returns a report. A feature that fails
-- must not be placed: Layout.buildPark leaves failing features out (and
-- says why). Placement rules (cable reach, clearance) need the park: pass
-- `opts.cable` (sim cable path) and `opts.others` (other placed features'
-- footprints, buoys and docks).
local FeatureConfig = require(script.Parent.FeatureConfig)
local FeatureModel = require(script.Parent.FeatureModel)
local Sim = require(script.Parent.Parent.Sim)

local FeatureValidator = {}

local S = FeatureConfig.StudsPerMetre
local V = FeatureConfig.Validator

export type Check = { rule: string, pass: boolean, detail: string }
export type Report = { id: string, ok: boolean, checks: { Check }, parts: number }

-- A footprint on the water (metres): a centre line from a to b with a half width.
-- `clearance` (m): how far it must stay from the approach line, when not
-- `ApproachClearance` (buoys: the layout spec's 6 m).
export type Footprint = { name: string, a: Vector2, b: Vector2, half: number, clearance: number? }

export type Options = {
	-- Sim cable path (Sim.Cable.buildCablePath), for the reach rule.
	cable: any?,
	-- Footprints of everything else on the water, for the clearance rule.
	others: { Footprint }?,
	-- The feature's own footprint and approach line (from FeatureValidator.footprint).
	self: { foot: Footprint, entry: Vector2, exitEnd: Vector2 }?,
}

local function deg(r: number): number
	return r * 180 / math.pi
end

local function rideParts(model: Model): { BasePart }
	local out = {}
	for _, d in (model:FindFirstChild("Ride") :: Instance):GetChildren() do
		if d:IsA("BasePart") then
			table.insert(out, d :: BasePart)
		end
	end
	table.sort(out, function(a, b)
		return ((a:GetAttribute("SegmentIndex") :: number?) or 0) < ((b:GetAttribute("SegmentIndex") :: number?) or 0)
	end)
	return out
end

-- Root-local metres (u along, v right, h up) of a world point.
local function localOf(model: Model, p: Vector3): (number, number, number)
	local o = (model.PrimaryPart :: BasePart).CFrame:PointToObjectSpace(p)
	return -o.Z / S, o.X / S, o.Y / S
end

local function ends(part: BasePart): (Vector3, Vector3)
	local a = part:FindFirstChild("Start") :: Attachment
	local b = part:FindFirstChild("End") :: Attachment
	return part.CFrame:PointToWorldSpace(a.CFrame.Position), part.CFrame:PointToWorldSpace(b.CFrame.Position)
end

-- Distance from a point to a Visual surface part's top face (or a pipe's surface), or nil if not over it.
local function surfaceGap(part: BasePart, p: Vector3): number?
	local o = part.CFrame:PointToObjectSpace(p)
	local h = part.Size / 2
	if part.Shape == Enum.PartType.Cylinder then
		if math.abs(o.X) > h.X + 0.01 then
			return nil
		end
		return math.abs(math.sqrt(o.Y * o.Y + o.Z * o.Z) - h.Y)
	end
	if part.ClassName ~= "Part" then
		return nil
	end
	if math.abs(o.X) > h.X + 0.01 or math.abs(o.Z) > h.Z + 0.01 then
		return nil
	end
	return math.abs(o.Y - h.Y)
end

local SURFACE_ART = { TopSheet = true, Pipe = true, Face = true, SideFace = true }

-- Check a built feature model (FeatureBuilder output) against section 5.
function FeatureValidator.validate(model: Model, opts: Options?): Report
	local o: Options = opts or {}
	local checks: { Check } = {}
	local function add(rule: string, pass: boolean, detail: string)
		table.insert(checks, { rule = rule, pass = pass, detail = detail })
	end
	local ftype = model:GetAttribute("FeatureType") :: string
	local catalog = model:GetAttribute("CatalogName") :: string
	local entry = (FeatureConfig.Catalog :: any)[catalog]
	local params = entry.params
	local parts = rideParts(model)

	-- Safety slope and start depth.
	local safeties = {}
	for _, p in parts do
		if p:GetAttribute("SurfaceRole") == "Safety" then
			table.insert(safeties, p)
		end
	end
	if #safeties > 0 then
		local a, b = ends(safeties[1])
		local _, _, h0 = localOf(model, a)
		local u0 = select(1, localOf(model, a))
		local u1, _, h1 = localOf(model, b)
		local slope = deg(math.atan((h1 - h0) / (u1 - u0)))
		add("Safety slope", slope >= V.SafetySlope[1] and slope <= V.SafetySlope[2], string.format("%.1f deg", slope))
		add("Safety starts under water", -h0 >= V.SafetyDepth[1] and -h0 <= V.SafetyDepth[2], string.format("%.2f m under", -h0))
	end

	-- Kickers: lip angle, a curved transition, width.
	if ftype == "Kicker" then
		local n, lip = 0, nil
		local width = 0
		for _, p in parts do
			local role = p:GetAttribute("SurfaceRole")
			if role == "Ramp" or role == "Lip" then
				n += 1
				width = math.max(width, ((p:GetAttribute("Width") :: number?) or 0) / S)
			end
			if p:FindFirstChild("LipPoint") then
				lip = p
			end
		end
		add("Kicker transition is a curve", n >= V.KickerMinSubsegments, `{n} sub-segments`)
		if lip then
			local lp = (lip :: BasePart):FindFirstChild("LipPoint") :: Attachment
			local look = (lip :: BasePart).CFrame:VectorToWorldSpace(lp.CFrame.LookVector)
			local root = (model.PrimaryPart :: BasePart).CFrame
			local l = root:VectorToObjectSpace(look)
			local angle = deg(math.atan2(l.Y, math.sqrt(l.X * l.X + l.Z * l.Z)))
			add("Kicker lip angle", math.abs(angle - params.lipAngle) <= 0.5, string.format("%.1f deg (spec %d)", angle, params.lipAngle))
			local lu, _, lh = localOf(model, (lip :: BasePart).CFrame:PointToWorldSpace(lp.CFrame.Position))
			add("Kicker lip height", math.abs(lh - params.lipHeight) <= 0.02, string.format("%.2f m at u=%.2f", lh, lu))
		else
			add("Kicker lip point", false, "no LipPoint")
		end
		add("Kicker width", width >= V.KickerWidthMin, string.format("%.2f m", width))
	end

	-- Box tops and rail heights; kink joints.
	local mains = {}
	for _, p in parts do
		if p:GetAttribute("SurfaceRole") == "Main" and p:GetAttribute("Axis") == nil then
			table.insert(mains, p)
		end
	end
	if #mains > 0 then
		local style = if params.shape == "box" then params.style elseif params.shape == "transfer" then "Box" else "Box"
		if params.shape == "box" or params.shape == "transfer" then
			if style == "Box" then
				local minW = math.huge
				for _, p in mains do
					minW = math.min(minW, ((p:GetAttribute("Width") :: number?) or 0) / S)
				end
				local need = if ftype == "Slider" then V.SliderWidthMin else V.BoxWidthMin
				add("Box top width", minW >= need - 1e-9, string.format("%.2f m (min %.1f)", minW, need))
			end
			local top = 0
			for _, p in mains do
				local a, b = ends(p)
				top = math.max(top, select(3, localOf(model, a)), select(3, localOf(model, b)))
			end
			local hi = math.min(V.RailHeight[2], V.MaxOllieHeight)
			if style == "Box" then
				-- Boxes can be low (a slider is 0.3 m); they only have to be ollie-able.
				add("Top reachable by ollie", top <= hi, string.format("%.2f m (max %.1f)", top, hi))
			else
				add("Rail height from water", top >= V.RailHeight[1] - 0.005 and top <= hi, string.format("%.2f m (%.1f-%.1f)", top, V.RailHeight[1], hi))
			end
		end
		-- Consecutive pieces of one part meet within 1 cm, kinks at most 20 degrees.
		local worstGap, worstAngle = 0, 0
		for i = 2, #parts do
			local p, q = parts[i - 1], parts[i]
			if p:GetAttribute("Part") == q:GetAttribute("Part") and p:GetAttribute("Slide") and q:GetAttribute("Slide") and p:GetAttribute("Axis") == nil and q:GetAttribute("Axis") == nil then
				local a0, a1 = ends(p)
				local b0, b1 = ends(q)
				worstGap = math.max(worstGap, (a1 - b0).Magnitude / S)
				local cosA = math.clamp((a1 - a0).Unit:Dot((b1 - b0).Unit), -1, 1)
				worstAngle = math.max(worstAngle, deg(math.acos(cosA)))
			end
		end
		add("Kink joints meet", worstGap <= V.KinkJoinTolerance, string.format("%.1f mm", worstGap * 1000))
		add("Kink angle", worstAngle <= V.KinkMaxAngle + 1e-6, string.format("%.1f deg", worstAngle))
	end

	-- Visual top sheets on the ride surfaces.
	local art = {}
	for _, d in (model:FindFirstChild("Visual") :: Instance):GetChildren() do
		if d:IsA("BasePart") and SURFACE_ART[d.Name] then
			table.insert(art, d :: BasePart)
		end
	end
	local worst = 0
	for _, p in parts do
		local a, b = ends(p)
		for _, t in { 0.25, 0.5, 0.75 } do
			local pt = a:Lerp(b, t)
			local best = math.huge
			for _, v in art do
				local g = surfaceGap(v, pt)
				if g then
					best = math.min(best, g)
				end
			end
			worst = math.max(worst, best)
		end
	end
	add("Visual matches ride surface", worst / S <= V.VisualTolerance, if worst == math.huge then "no art over a ride part" else string.format("%.1f mm", worst / S * 1000))

	-- Coping on box edges.
	if params.shape == "box" and params.style == "Box" or params.shape == "transfer" or params.shape == "pyramid" then
		local minR, count = math.huge, 0
		for _, d in (model:FindFirstChild("Visual") :: Instance):GetChildren() do
			if d:IsA("BasePart") and d.Name == "Coping" then
				count += 1
				minR = math.min(minR, (d :: BasePart).Size.Y / 2 / S)
			end
		end
		add("Edges have coping", count >= 2 and minR >= V.CopingMin, string.format("%d coping bars, r %.0f mm", count, minR * 1000))
	end

	-- Part budget.
	local n = FeatureModel.partCount(model)
	add("Part count", n <= V.MaxParts, `{n} parts`)

	-- Placement: within rope reach of the cable, off its line; clearance.
	if o.cable then
		local root = (model.PrimaryPart :: BasePart).CFrame.Position / S
		local best = math.huge
		local path = o.cable
		local step = 0.5
		local sv = 0
		while sv < path.length do
			local cp = Sim.Cable.cablePointAt(path, sv).pos
			best = math.min(best, math.sqrt((cp.x - root.X) ^ 2 + (cp.z - root.Z) ^ 2))
			sv += step
		end
		-- The feature's centre, not its start: use the middle of its ride parts.
		local first, last = ends(parts[1])
		local _, lastEnd = ends(parts[#parts])
		local mid = (first + lastEnd) / 2 / S
		local _ = last
		local bestMid = math.huge
		sv = 0
		while sv < path.length do
			local cp = Sim.Cable.cablePointAt(path, sv).pos
			bestMid = math.min(bestMid, math.sqrt((cp.x - mid.X) ^ 2 + (cp.z - mid.Z) ^ 2))
			sv += step
		end
		add("Within rope reach of the cable", bestMid <= V.RopeLength, string.format("%.1f m from the line", bestMid))
		add("Off the cable line", bestMid >= V.MinOffLine, string.format("%.1f m from the line", bestMid))
	end
	if o.others and o.self then
		local me = o.self
		local worstApproach, worstExit = math.huge, math.huge
		local function segDist(p: Vector2, a: Vector2, b: Vector2): number
			local ab = b - a
			local t = math.clamp((p - a):Dot(ab) / math.max(ab:Dot(ab), 1e-9), 0, 1)
			return (p - (a + ab * t)).Magnitude
		end
		local function footDist(f: Footprint, a: Vector2, b: Vector2): number
			-- Closest approach between two segments, sampled, minus the footprint's half width.
			local best = math.huge
			for i = 0, 10 do
				local p = f.a:Lerp(f.b, i / 10)
				best = math.min(best, segDist(p, a, b))
				local q = a:Lerp(b, i / 10)
				best = math.min(best, segDist(q, f.a, f.b))
			end
			return best - f.half
		end
		local blockers = {}
		for _, f in o.others do
			local da = footDist(f, me.entry, me.foot.a)
			local de = footDist(f, me.foot.b, me.exitEnd)
			if da < worstApproach then
				worstApproach = da
			end
			if de < worstExit then
				worstExit = de
			end
			-- Nothing within 8 m of the approach line; nothing in the 12 m after the exit
			-- (a corridor `ExitCorridor` m either side of the line out).
			if da < (f.clearance or V.ApproachClearance) or de < V.ExitCorridor then
				table.insert(blockers, string.format("%s (%.1f m from the approach, %.1f m from the exit)", f.name, da, de))
			end
		end
		add("Clearance", #blockers == 0, if #blockers == 0
			then string.format("approach %.1f m, exit %.1f m", worstApproach, worstExit)
			else "too close: " .. table.concat(blockers, ", "))
	end

	local ok = true
	for _, c in checks do
		ok = ok and c.pass
	end
	return { id = model:GetAttribute("FeatureId") :: string, ok = ok, checks = checks, parts = n }
end

-- A feature's footprint on the water (metres), its approach start and the end of its exit zone.
function FeatureValidator.footprint(model: Model): { foot: Footprint, entry: Vector2, exitEnd: Vector2 }
	local root = (model.PrimaryPart :: BasePart).CFrame
	local parts = rideParts(model)
	local a = ends(parts[1])
	local _, b = ends(parts[#parts])
	local maxHalf = 0
	for _, p in parts do
		maxHalf = math.max(maxHalf, ((p:GetAttribute("Width") :: number?) or 0) / 2 / S)
	end
	local fa = Vector2.new(a.X / S, a.Z / S)
	local fb = Vector2.new(b.X / S, b.Z / S)
	local fwd = root.LookVector
	local f2 = Vector2.new(fwd.X, fwd.Z).Unit
	local approach = (model:FindFirstChild("Approach") :: Instance)
	local anchor = approach:FindFirstChild("Anchor") :: BasePart?
	local entry = fa - f2 * FeatureConfig.Approach.EntryDistance
	if anchor then
		local e = anchor:FindFirstChild("Entry") :: Attachment?
		if e then
			local w = anchor.CFrame:PointToWorldSpace(e.CFrame.Position) / S
			entry = Vector2.new(w.X, w.Z)
		end
	end
	return {
		foot = { name = model.Name, a = fa, b = fb, half = maxHalf },
		entry = entry,
		exitEnd = fb + f2 * V.ExitClearance,
	}
end

-- Print a report as a table.
function FeatureValidator.print(reports: { Report })
	for _, r in reports do
		print(string.format("%-24s %s  (%d parts)", r.id, if r.ok then "PASS" else "FAIL", r.parts))
		for _, c in r.checks do
			print(string.format("    %-4s %-32s %s", if c.pass then "ok" else "FAIL", c.rule, c.detail))
		end
	end
end

return FeatureValidator
