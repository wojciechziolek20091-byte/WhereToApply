--!strict
-- FeatureRegistry (features spec 4.2): indexes every ParkFeature model and
-- answers "what surface is under this point" from the models' Ride/ parts,
-- on the client and the server alike. The rider's physics is the sim's
-- (Sim/OnFeature over Sim/FeatureShapes); the Ride/ parts are built from the
-- same pieces, so this answers the same question for anything else that
-- needs it: tutorials, AI riders, effects, the crash UI, tools. It needs no
-- raycasts: each Ride part is a straight segment (Start -> End) with a
-- width and a profile, so a hit is a projection.
local CollectionService = game:GetService("CollectionService")

local FeatureConfig = require(script.Parent.FeatureConfig)

local FeatureRegistry = {}

export type SurfaceHit = {
	feature: Model,
	role: string,
	segment: BasePart,
	-- 0..1 along the segment, Start to End.
	progress: number,
	normal: Vector3,
	tangent: Vector3,
	-- Signed distance across the segment from its centre line (studs, + to its right).
	distanceToCentre: number,
	profile: string,
	-- The surface point, and the distance to it along `down` (studs).
	point: Vector3,
	distance: number,
}

type Segment = {
	part: BasePart,
	role: string,
	s: Vector3,
	e: Vector3,
	halfWidth: number,
	profile: string,
	radius: number,
	right: Vector3,
	up: Vector3,
}

type Entry = {
	model: Model,
	centre: Vector3,
	radius: number,
	segments: { Segment },
	crash: { BasePart },
}

local entries: { [Model]: Entry } = {}
local byId: { [string]: Model } = {}
local initialised = false

-- How far along `down` a surface may be from the query point (studs).
FeatureRegistry.MaxDistance = 6 * FeatureConfig.StudsPerMetre

local function index(model: Model)
	local ride = model:FindFirstChild("Ride")
	if not ride then
		return
	end
	local segments: { Segment } = {}
	local lo, hi = Vector3.new(math.huge, math.huge, math.huge), Vector3.new(-math.huge, -math.huge, -math.huge)
	local function grow(p: Vector3)
		lo = Vector3.new(math.min(lo.X, p.X), math.min(lo.Y, p.Y), math.min(lo.Z, p.Z))
		hi = Vector3.new(math.max(hi.X, p.X), math.max(hi.Y, p.Y), math.max(hi.Z, p.Z))
	end
	for _, d in ride:GetChildren() do
		if d:IsA("BasePart") then
			local part = d :: BasePart
			local a = part:FindFirstChild("Start") :: Attachment?
			local b = part:FindFirstChild("End") :: Attachment?
			if a and b then
				local s = part.CFrame:PointToWorldSpace(a.CFrame.Position)
				local e = part.CFrame:PointToWorldSpace(b.CFrame.Position)
				local dir = (e - s).Unit
				-- For slabs the part's RightVector is across the surface; pipes are cylinders along X.
				local profile = (part:GetAttribute("Profile") :: string?) or "Flat"
				local across = if profile == "Round" then dir:Cross(Vector3.new(0, 1, 0)).Unit else part.CFrame.RightVector
				if across:Dot(dir:Cross(Vector3.new(0, 1, 0))) < 0 then
					across = -across
				end
				local up = across:Cross(dir).Unit
				if up.Y < 0 then
					up = -up
				end
				table.insert(segments, {
					part = part,
					role = (part:GetAttribute("SurfaceRole") :: string?) or "Main",
					s = s,
					e = e,
					halfWidth = ((part:GetAttribute("Width") :: number?) or part.Size.X) / 2,
					profile = profile,
					radius = (part:GetAttribute("Radius") :: number?) or 0,
					right = across,
					up = up,
				})
				grow(s)
				grow(e)
			end
		end
	end
	local crash: { BasePart } = {}
	local crashFolder = model:FindFirstChild("Crash")
	if crashFolder then
		for _, d in crashFolder:GetChildren() do
			if d:IsA("BasePart") then
				table.insert(crash, d :: BasePart)
				grow((d :: BasePart).CFrame.Position)
			end
		end
	end
	local centre = (lo + hi) / 2
	entries[model] = { model = model, centre = centre, radius = (hi - lo).Magnitude / 2 + 2 * FeatureConfig.StudsPerMetre, segments = segments, crash = crash }
	local id = model:GetAttribute("FeatureId") :: string?
	if id then
		byId[id] = model
	end
end

-- Index every ParkFeature model now and as they come and go. Safe to call again.
function FeatureRegistry.init()
	for _, m in CollectionService:GetTagged(FeatureConfig.Tags.All) do
		if m:IsA("Model") then
			index(m :: Model)
		end
	end
	if not initialised then
		initialised = true
		CollectionService:GetInstanceAddedSignal(FeatureConfig.Tags.All):Connect(function(m: Instance)
			-- Parts arrive after the model on the client (streaming is atomic per feature).
			task.defer(function()
				if m:IsA("Model") then
					index(m :: Model)
				end
			end)
		end)
		CollectionService:GetInstanceRemovedSignal(FeatureConfig.Tags.All):Connect(function(m: Instance)
			if m:IsA("Model") then
				entries[m :: Model] = nil
			end
		end)
	end
end

-- Re-index one feature (after a rebuild).
function FeatureRegistry.refresh(model: Model)
	index(model)
end

function FeatureRegistry.clear()
	table.clear(entries)
	table.clear(byId)
end

function FeatureRegistry.byId(id: string): Model?
	return byId[id]
end

function FeatureRegistry.all(): { Model }
	local out = {}
	for m in entries do
		table.insert(out, m)
	end
	table.sort(out, function(a, b)
		return a.Name < b.Name
	end)
	return out
end

-- Features whose bounds come within `radius` (studs) of a position.
function FeatureRegistry.getNearby(position: Vector3, radius: number): { Model }
	local out = {}
	for m, e in entries do
		if (e.centre - position).Magnitude <= e.radius + radius then
			table.insert(out, m)
		end
	end
	table.sort(out, function(a, b)
		return (entries[a].centre - position).Magnitude < (entries[b].centre - position).Magnitude
	end)
	return out
end

local function hitSegment(model: Model, g: Segment, position: Vector3, down: Vector3): SurfaceHit?
	local d = g.e - g.s
	local len2 = d:Dot(d)
	if len2 < 1e-9 then
		return nil
	end
	local tangent = d.Unit
	-- Where the ray from `position` along `down` meets the segment's surface.
	local t = (position - g.s):Dot(d) / len2
	if g.profile == "Round" then
		-- Round pipe: the axis is the top line lowered by the radius; the normal points from it to the contact.
		local axisS = g.s - g.up * g.radius
		local onAxis = axisS + d * math.clamp(t, 0, 1)
		local off = position - onAxis
		local radial = off - tangent * off:Dot(tangent)
		if radial.Magnitude < 1e-6 then
			return nil
		end
		local n = radial.Unit
		if n:Dot(-down) <= 0 then
			return nil
		end
		local point = onAxis + n * g.radius
		local across = (point - onAxis):Dot(g.right)
		if t < -1e-4 or t > 1 + 1e-4 then
			return nil
		end
		t = math.clamp(t, 0, 1)
		local dist = (position - point):Dot(-down.Unit)
		if dist < -0.5 or dist > FeatureRegistry.MaxDistance then
			return nil
		end
		return {
			feature = model, role = g.role, segment = g.part, progress = t, normal = n, tangent = tangent,
			distanceToCentre = across, profile = "Round", point = point, distance = dist,
		}
	end
	local n = g.up
	local denom = down:Dot(n)
	if math.abs(denom) < 1e-6 then
		return nil
	end
	local k = (g.s - position):Dot(n) / denom
	if k < -0.5 or k > FeatureRegistry.MaxDistance then
		return nil
	end
	local point = position + down * k
	local tp = (point - g.s):Dot(d) / len2
	-- A little slack so a ray down a joint between two segments finds one of them.
	if tp < -1e-4 or tp > 1 + 1e-4 then
		return nil
	end
	tp = math.clamp(tp, 0, 1)
	local across = (point - (g.s + d * tp)):Dot(g.right)
	if math.abs(across) > g.halfWidth then
		return nil
	end
	return {
		feature = model, role = g.role, segment = g.part, progress = tp, normal = n, tangent = tangent,
		distanceToCentre = across, profile = "Flat", point = point, distance = k,
	}
end

-- The ride surface under `position` along `down` (a unit vector, usually -Y),
-- or nil. The nearest surface along `down` wins.
function FeatureRegistry.getSurfaceAt(position: Vector3, down: Vector3): SurfaceHit?
	local best: SurfaceHit? = nil
	for m, e in entries do
		if (e.centre - position).Magnitude <= e.radius + FeatureRegistry.MaxDistance then
			for _, g in e.segments do
				local h = hitSegment(m, g, position, down)
				if h and (not best or h.distance < (best :: SurfaceHit).distance) then
					best = h
				end
			end
		end
	end
	return best
end

-- The crash volume containing `position`, if any: the part and its CrashReason.
function FeatureRegistry.getCrashAt(position: Vector3): (BasePart?, string?)
	for _, e in entries do
		if (e.centre - position).Magnitude <= e.radius then
			for _, p in e.crash do
				local o = p.CFrame:PointToObjectSpace(position)
				local h = p.Size / 2
				if math.abs(o.X) <= h.X and math.abs(o.Y) <= h.Y and math.abs(o.Z) <= h.Z then
					return p, p:GetAttribute("CrashReason") :: string?
				end
			end
		end
	end
	return nil, nil
end

return FeatureRegistry
