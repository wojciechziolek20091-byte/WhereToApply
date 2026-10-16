--!strict
-- Floating features bob (features spec 7): +-3 cm at 0.2 Hz, each with its
-- own phase. Only the Visual folder moves; Ride/ and Crash/ stay put so the
-- physics (and the registry) never see it. Within 6 m of a rider the bob
-- eases to rest, so the art lines up with the ride surface at contact.
-- Client only: call FeatureBob.attachAll() once the park is built, then
-- FeatureBob.step(time, riderPositions) every frame.
local CollectionService = game:GetService("CollectionService")

local FeatureConfig = require(script.Parent.FeatureConfig)

local FeatureBob = {}

local S = FeatureConfig.StudsPerMetre
local B = FeatureConfig.Bob

type State = {
	model: Model,
	parts: { BasePart },
	base: { CFrame },
	-- Footprint in the Root's frame (studs), for the freeze distance.
	lo: Vector3,
	hi: Vector3,
	phase: number,
	-- 0..1: how much of the bob is on (eases to 0 near riders).
	amount: number,
	offset: number,
}

local states: { [Model]: State } = {}

local function hashPhase(s: string): number
	local h = 0
	for i = 1, #s do
		h = (h * 31 + string.byte(s, i)) % 100003
	end
	return (h / 100003) * 2 * math.pi
end

-- Remember a feature's Visual parts at rest.
function FeatureBob.attach(model: Model)
	local visual = model:FindFirstChild("Visual")
	local root = model.PrimaryPart
	if not visual or not root then
		return
	end
	local parts, base = {}, {}
	for _, d in visual:GetDescendants() do
		if d:IsA("BasePart") then
			table.insert(parts, d :: BasePart)
			table.insert(base, (d :: BasePart).CFrame)
		end
	end
	local lo, hi = Vector3.new(math.huge, math.huge, math.huge), Vector3.new(-math.huge, -math.huge, -math.huge)
	local ride = model:FindFirstChild("Ride")
	for _, d in (if ride then ride:GetChildren() else {}) do
		if d:IsA("BasePart") then
			local o = root.CFrame:PointToObjectSpace((d :: BasePart).CFrame.Position)
			lo = Vector3.new(math.min(lo.X, o.X), math.min(lo.Y, o.Y), math.min(lo.Z, o.Z))
			hi = Vector3.new(math.max(hi.X, o.X), math.max(hi.Y, o.Y), math.max(hi.Z, o.Z))
		end
	end
	states[model] = {
		model = model, parts = parts, base = base, lo = lo, hi = hi,
		phase = hashPhase(model.Name), amount = 1, offset = 0,
	}
end

function FeatureBob.attachAll()
	for _, m in CollectionService:GetTagged(FeatureConfig.Tags.All) do
		if m:IsA("Model") then
			FeatureBob.attach(m :: Model)
		end
	end
end

-- Distance (m) from a world position (studs) to a feature's footprint.
local function distanceTo(st: State, p: Vector3): number
	local root = (st.model.PrimaryPart :: BasePart).CFrame
	local o = root:PointToObjectSpace(p)
	local dx = math.max(st.lo.X - o.X, 0, o.X - st.hi.X)
	local dz = math.max(st.lo.Z - o.Z, 0, o.Z - st.hi.Z)
	return math.sqrt(dx * dx + dz * dz) / S
end

-- Move every feature's Visual folder. `riders` are world positions in studs.
function FeatureBob.step(t: number, riders: { Vector3 }, dt: number?)
	local rate = (dt or 1 / 60) * 2.5
	for _, st in states do
		local near = false
		for _, p in riders do
			if distanceTo(st, p) <= B.FreezeRadius then
				near = true
				break
			end
		end
		local target = if near then 0 else 1
		st.amount += math.clamp(target - st.amount, -rate, rate)
		local offset = st.amount * B.Amplitude * math.sin(2 * math.pi * B.Frequency * t + st.phase)
		if math.abs(offset - st.offset) > 1e-5 then
			st.offset = offset
			local dy = Vector3.new(0, offset * S, 0)
			for i, part in st.parts do
				part.CFrame = st.base[i] + dy
			end
		end
	end
end

-- Current bob of a feature (m), for tests and debugging.
function FeatureBob.offsetOf(model: Model): number
	local st = states[model]
	return if st then st.offset else 0
end

function FeatureBob.clear()
	for _, st in states do
		for i, part in st.parts do
			part.CFrame = st.base[i]
		end
	end
	table.clear(states)
end

return FeatureBob
