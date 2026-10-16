--!strict
-- TowerBuilder (layout spec section 2): the cable towers as low-poly grey
-- steel masts on land: a concrete foundation, the mast, a boom out to the
-- carrier wheel over the cable corner, a tie from the mast top to the boom
-- tip, and three guy wires to ground anchors. Twin of src/art/tower.ts
-- (tests/tower.test.ts checks the part lists match).
--
-- Towers are scenery: CanCollide, CanQuery and CanTouch are off (the rider's
-- physics is the sim, which keeps riders 10 m from the shore they stand on).
--
--   TowerBuilder.buildSite(site, cableHeight, groundAt)  -- Workspace.Park.Towers
local CollectionService = game:GetService("CollectionService")

local FeatureConfig = require(script.Parent.FeatureConfig)
local FeatureStyle = require(script.Parent.FeatureStyle)

local TowerBuilder = {}

local S = FeatureConfig.StudsPerMetre

TowerBuilder.TOWER = {
	foundationHalf = 1.5,
	foundationTop = 0.5,
	foundationDepth = 0.3,
	mastHalf = 0.3,
	mastAbove = 1.2,
	mastPerArm = 0.12,
	boomHalf = 0.18,
	tieHalf = 0.05,
	wheelRadius = 1.0,
	wheelHalfThickness = 0.12,
	wireHalf = 0.03,
	anchorHalf = 0.3,
	wireReach = 0.6,
	wireAngles = { -40, 0, 40 },
}

export type TowerPart = { name: string, kind: string, a: { number }, b: { number }, r: number, role: string }

local function round(v: number, k: number): number
	return math.floor(v * k + 0.5) / k
end

-- One tower's parts (metres). `t`: { wheel, apex, base, out, arm } (site.cables[i].towers[j]);
-- the boom and the wheel reach `apex`, where the cable passes.
function TowerBuilder.towerParts(t: any, cableHeight: number, ground: number): { TowerPart }
	local T = TowerBuilder.TOWER
	local top = cableHeight + T.mastAbove + T.mastPerArm * t.arm
	local boomY = cableHeight + 0.35
	local bx, bz, wx, wz = t.base.x, t.base.z, t.apex.x, t.apex.z
	local parts: { TowerPart } = {
		{ name = "Foundation", kind = "box", a = { bx, ground + (T.foundationTop - T.foundationDepth) / 2, bz }, b = { T.foundationHalf, (T.foundationTop + T.foundationDepth) / 2, T.foundationHalf }, r = 0, role = "Foundation" },
		{ name = "Mast", kind = "beam", a = { bx, ground + T.foundationTop, bz }, b = { bx, top, bz }, r = T.mastHalf, role = "Tower" },
		{ name = "Boom", kind = "beam", a = { bx, boomY, bz }, b = { wx, boomY, wz }, r = T.boomHalf, role = "Tower" },
		{ name = "Tie", kind = "beam", a = { bx, top, bz }, b = { wx, boomY, wz }, r = T.tieHalf, role = "Tower" },
		{ name = "Wheel", kind = "disc", a = { wx, cableHeight + 0.1, wz }, b = { 0, T.wheelHalfThickness, 0 }, r = T.wheelRadius, role = "Tower" },
	}
	local reach = T.wireReach * (top - ground)
	for _, deg in T.wireAngles do
		local r = deg * math.pi / 180
		local dx = t.out.x * math.cos(r) - t.out.z * math.sin(r)
		local dz = t.out.x * math.sin(r) + t.out.z * math.cos(r)
		local ax = round(bx + dx * reach, 100)
		local az = round(bz + dz * reach, 100)
		table.insert(parts, { name = "GuyWire", kind = "beam", a = { bx, top - 0.3, bz }, b = { ax, ground + T.anchorHalf, az }, r = T.wireHalf, role = "GuyWire" })
		table.insert(parts, { name = "Anchor", kind = "box", a = { ax, ground + T.anchorHalf / 2, az }, b = { T.anchorHalf, T.anchorHalf, T.anchorHalf }, r = 0, role = "Foundation" })
	end
	return parts
end

local function v3(p: { number }): Vector3
	return Vector3.new(p[1] * S, p[2] * S, p[3] * S)
end

-- A part for one TowerPart: anchored, styled, not collidable or queryable.
local function makePart(p: TowerPart, parent: Instance): BasePart
	local part = Instance.new("Part")
	part.Name = p.name
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	if p.kind == "box" then
		part.Size = Vector3.new(p.b[1] * 2 * S, p.b[2] * 2 * S, p.b[3] * 2 * S)
		part.CFrame = CFrame.new(v3(p.a))
	elseif p.kind == "beam" then
		local a, b = v3(p.a), v3(p.b)
		local len = (b - a).Magnitude
		local up = if math.abs((b - a).Unit.Y) > 0.99 then Vector3.new(1, 0, 0) else Vector3.new(0, 1, 0)
		part.Size = Vector3.new(p.r * 2 * S, p.r * 2 * S, len)
		part.CFrame = CFrame.lookAt((a + b) / 2, b, up)
	else
		-- A cylinder's axis is its X: turn it upright.
		part.Shape = Enum.PartType.Cylinder
		part.Size = Vector3.new(p.b[2] * 2 * S, p.r * 2 * S, p.r * 2 * S)
		part.CFrame = CFrame.new(v3(p.a)) * CFrame.Angles(0, 0, math.pi / 2)
	end
	FeatureStyle.apply(part, p.role)
	part.Parent = parent
	return part
end

-- Build one tower as a Model (PrimaryPart: the foundation), tagged CableTower.
function TowerBuilder.build(t: any, cableHeight: number, ground: number, name: string): Model
	local model = Instance.new("Model")
	model.Name = name
	for _, p in TowerBuilder.towerParts(t, cableHeight, ground) do
		local part = makePart(p, model)
		if p.name == "Foundation" then
			model.PrimaryPart = part
		end
	end
	CollectionService:AddTag(model, "CableTower")
	model:SetAttribute("Arm", t.arm)
	return model
end

-- Every tower of every cable system on a site, into Workspace.Park.Towers
-- (cleared first). `groundAt(x, z)`: land height at a base (m).
function TowerBuilder.buildSite(site: any, cableHeight: number, groundAt: (number, number) -> number): Folder
	local park = workspace:FindFirstChild(FeatureConfig.ParkFolder)
	if not park then
		park = Instance.new("Folder")
		park.Name = FeatureConfig.ParkFolder
		park.Parent = workspace
	end
	local folder = (park :: Instance):FindFirstChild("Towers")
	if not folder then
		folder = Instance.new("Folder")
		folder.Name = "Towers"
		folder.Parent = park
	end
	(folder :: Instance):ClearAllChildren()
	for _, system in site.cables or {} do
		for i, t in system.towers do
			TowerBuilder.build(t, cableHeight, groundAt(t.base.x, t.base.z), `{system.name} tower {i}`).Parent = folder
		end
	end
	return folder :: Folder
end

return TowerBuilder
