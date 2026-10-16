--!strict
-- Buoys (layout spec section 5): round floats from the site's BuoyLayout
-- (src/sim/parkLayout.ts buoyLayout, in Sim.ParkLayout.*.site.buoyLayout):
-- orange 1.2 m boundary buoys (tower zones, shore hazards) and white 0.8 m
-- lane markers out of the start docks. Each is a Ball part 40 % under the
-- water with a thin dark band round its middle and an anchor line straight
-- down; nothing else attached. CanCollide / CanQuery / CanTouch off, tag
-- "Buoy". One client loop bobs them all (+-5 cm at 0.25 Hz, a random phase
-- each) and splashes when a rider goes through one.
--
--   local folder = Buoys.build(site)        -- Workspace.Park.Buoys
--   RunService.RenderStepped:Connect(function() Buoys.step(os.clock(), riderPosStuds) end)
local CollectionService = game:GetService("CollectionService")

local FeatureConfig = require(script.Parent.FeatureConfig)
local FeatureStyle = require(script.Parent.FeatureStyle)

local Buoys = {}

local S = FeatureConfig.StudsPerMetre
local B = FeatureConfig.Buoy

type Entry = { model: Model, parts: { { part: BasePart, base: CFrame } }, phase: number, x: number, z: number, radius: number, emitter: ParticleEmitter, lastSplash: number }
local entries: { Entry } = {}

-- Centre height above the water (m) for a ball `d` across, `Submerged` of its height under.
function Buoys.centreHeight(d: number): number
	return d * (0.5 - B.Submerged)
end

local function part(name: string, size: Vector3, cf: CFrame, role: string, parent: Instance, shape: Enum.PartType?): BasePart
	local p = Instance.new("Part")
	p.Name = name
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	if shape then
		p.Shape = shape
	end
	p.Size = size
	p.CFrame = cf
	FeatureStyle.apply(p, role)
	p.Parent = parent
	return p
end

-- A deterministic phase per buoy from its id (no shared random state).
local function phaseOf(id: string): number
	local h = 0
	for i = 1, #id do
		h = (h * 31 + string.byte(id, i)) % 100003
	end
	return (h / 100003) * 2 * math.pi
end

-- One buoy model (not parented).
function Buoys.buildOne(b: any): Model
	local model = Instance.new("Model")
	model.Name = b.id
	local d = b.diameter
	local y = Buoys.centreHeight(d)
	local centre = Vector3.new(b.x * S, y * S, b.z * S)
	local role = if b.kind == "Lane" then "BuoyLane" else "BuoyBoundary"
	local ball = part("Ball", Vector3.new(d, d, d) * S, CFrame.new(centre), role, model, Enum.PartType.Ball)
	-- The band: a short upright cylinder 2 % wider than the ball, so only its rim shows.
	part("Band", Vector3.new(d * B.Band * S, d * 1.02 * S, d * 1.02 * S), CFrame.new(centre) * CFrame.Angles(0, 0, math.pi / 2), "BuoyBand", model, Enum.PartType.Cylinder)
	local r = B.AnchorRadius
	part("AnchorLine", Vector3.new(r * 2 * S, B.AnchorLength * S, r * 2 * S), CFrame.new(centre - Vector3.new(0, (d / 2 + B.AnchorLength / 2) * S, 0)), "AnchorLine", model)
	model.PrimaryPart = ball
	local emitter = Instance.new("ParticleEmitter")
	emitter.Name = "Splash"
	emitter.Rate = 0
	emitter.Parent = ball
	model:SetAttribute("Kind", b.kind)
	model:SetAttribute("Marks", b.marks)
	model:SetAttribute("Diameter", d)
	model:SetAttribute("Phase", phaseOf(b.id))
	CollectionService:AddTag(model, B.Tag)
	return model
end

-- Every buoy of a site, into Workspace.Park.Buoys (cleared first).
function Buoys.build(site: any): Folder
	local park = workspace:FindFirstChild(FeatureConfig.ParkFolder)
	if not park then
		park = Instance.new("Folder")
		park.Name = FeatureConfig.ParkFolder
		park.Parent = workspace
	end
	local folder = (park :: Instance):FindFirstChild("Buoys")
	if not folder then
		folder = Instance.new("Folder")
		folder.Name = "Buoys"
		folder.Parent = park
	end
	(folder :: Instance):ClearAllChildren()
	entries = {}
	for _, b in site.buoyLayout or {} do
		local m = Buoys.buildOne(b)
		m.Parent = folder
		local parts = {}
		for _, p in m:GetChildren() do
			if p:IsA("BasePart") then
				table.insert(parts, { part = p, base = p.CFrame })
			end
		end
		local ball = m.PrimaryPart :: BasePart
		table.insert(entries, { model = m, parts = parts, phase = m:GetAttribute("Phase") :: number, x = b.x, z = b.z, radius = b.diameter / 2, emitter = ball:FindFirstChild("Splash") :: ParticleEmitter, lastSplash = -math.huge })
	end
	return folder :: Folder
end

-- Bob every buoy at time `t` (s); `rider` (studs, optional): splash any buoy it is passing through.
-- Returns the ids that splashed this step.
function Buoys.step(t: number, rider: Vector3?): { string }
	local splashed = {}
	for _, e in entries do
		local dy = B.BobAmplitude * math.sin(2 * math.pi * B.BobFrequency * t + e.phase) * S
		for _, p in e.parts do
			p.part.CFrame = p.base + Vector3.new(0, dy, 0)
		end
		if rider then
			local dx, dz = rider.X / S - e.x, rider.Z / S - e.z
			if math.sqrt(dx * dx + dz * dz) < e.radius + B.SplashRadius and t - e.lastSplash > B.SplashCooldown then
				e.lastSplash = t
				e.emitter:Emit(14)
				table.insert(splashed, e.model.Name)
			end
		end
	end
	return splashed
end

return Buoys
