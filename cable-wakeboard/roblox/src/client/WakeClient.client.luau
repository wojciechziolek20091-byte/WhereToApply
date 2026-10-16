--[[
	WakeClient: plays the Luau sim in Studio (StarterPlayerScripts).

	A thin, deliberately simple client. All game logic is in
	ReplicatedStorage.WakeShared.Sim, which is the same code as the web game
	(checked tick for tick by tests/parity.test.ts). This script only:
	  - binds WakeInput.ACTIONS with ContextActionService (keyboard and gamepad)
	    and turns held actions into the sim's raw InputFrame,
	  - runs Sim.Session.stepRun at a fixed 60 Hz (physics runs on the client),
	  - builds the park from the user's map (Sim.Park.DEFAULT_PARK: shore, island,
	    dock, terrace, buildings, roads) plus the sim's cable and features,
	  - animates the jointed RiderBuilder rig with the shared animation system
	    (ReplicatedStorage.WakeShared.Anim, the twin of the web game's src/anim):
	    RiderAnimStateAdapter -> Animator -> Motor6D.Transform, written in
	    RunService.PreSimulation; the handle is its own object on the rope Beam
	    (white to red with tension, sagging when slack),
	  - VFX and feel: spray and a rooster tail, wake trail, splashes, camera shake,
	    carve roll, FOV kick at the pop, pulled-out framing in inverts, sound hooks
	    (AnimConfig.Sound, empty ids until assets exist),
	  - debug: F4 slow motion (1, 0.25, 0.1), F6 skeleton overlay (joints, centre of
	    mass, rotation axis, IK targets), F7 pose scrubber ([ ] clip, - = phase),
	  - replication: sends its anim state at 18 Hz (UnreliableRemoteEvent
	    AnimState) and animates other players' riders from theirs,
	  - shows the tension meter, LOADED, the trick feed and combo, handle-pass and
	    balance prompts, and a debug overlay on F3,
	  - sends TrickLanded / ComboEnded / Crashed to the server, which recomputes
	    combo scores with Sim.ScoringCombo and keeps leaderstats.
	Not yet checked in Studio: expect to tune the camera and scale. Rendering is
	single-player and local; the sim does not use Roblox physics at all.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local ContextActionService = game:GetService("ContextActionService")

local shared = ReplicatedStorage:WaitForChild("WakeShared")
local Sim = require(shared:WaitForChild("Sim"))
local RiderBuilder = require(shared:WaitForChild("RiderBuilder"))
local WakeInput = require(shared:WaitForChild("WakeInput"))
local SiteGeometry = require(shared:WaitForChild("SiteGeometry"))
local Anim = require(shared:WaitForChild("Anim"))
local RiderRig = require(shared:WaitForChild("RiderRig"))
local WaterSpray = require(shared:WaitForChild("WaterSpray"))
local FeatureBuilder = require(shared:WaitForChild("Park"):WaitForChild("FeatureBuilder"))
local FeatureModel = require(shared:WaitForChild("Park"):WaitForChild("FeatureModel"))
local FeatureRegistry = require(shared:WaitForChild("Park"):WaitForChild("FeatureRegistry"))
local FeatureConfig = require(shared:WaitForChild("Park"):WaitForChild("FeatureConfig"))

-- Sim metres -> Roblox studs (1 stud = 0.28 m).
local S = 1 / 0.28

local function stud(p)
	return Vector3.new(p.x * S, p.y * S, p.z * S)
end

-- Sim heading psi -> Roblox yaw. Sim forward is (cos psi, 0, sin psi).
local function yaw(psi)
	return CFrame.Angles(0, -psi, 0)
end

local folder = workspace:FindFirstChild("WakePark")
if folder then
	folder:Destroy()
end
folder = Instance.new("Folder")
folder.Name = "WakePark"
folder.Parent = workspace

local function part(name, size, cf, color, shape)
	local p = Instance.new(shape or "Part")
	p.Name = name
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.Material = Enum.Material.SmoothPlastic
	p.Size = size
	p.CFrame = cf
	p.Color = color
	p.Parent = folder
	return p
end

local run = Sim.Session.createRun()

-- One flat triangle as two wedges (the usual Roblox technique). `thick` studs,
-- centred on the triangle's plane.
local function triangle(name, a, b, c, color, thick)
	local ab, ac, bc = b - a, c - a, c - b
	local abd, acd, bcd = ab:Dot(ab), ac:Dot(ac), bc:Dot(bc)
	if abd > acd and abd > bcd then
		c, a = a, c
	elseif acd > bcd and acd > abd then
		a, b = b, a
	end
	ab, ac, bc = b - a, c - a, c - b
	local right = ac:Cross(ab).Unit
	local up = bc:Cross(right).Unit
	local back = bc.Unit
	local height = math.abs(ab:Dot(up))
	if height < 1e-3 then
		return
	end
	local w1 = part(name, Vector3.new(thick, height, math.abs(ab:Dot(back))), CFrame.fromMatrix((a + b) / 2, right, up, back), color, "WedgePart")
	local w2 = part(name, Vector3.new(thick, height, math.abs(ac:Dot(back))), CFrame.fromMatrix((a + c) / 2, -right, up, -back), color, "WedgePart")
	w1.CanCollide, w2.CanCollide = false, false
end

-- A flat polygon (sim metres) at height y metres.
local function polygon(name, poly, y, color, thick)
	for _, t in SiteGeometry.triangulate(poly) do
		local function v(i)
			return Vector3.new(poly[i].x * S, y * S, poly[i].z * S)
		end
		triangle(name, v(t[1]), v(t[2]), v(t[3]), color, thick or 0.2)
	end
end

local LAND_Y = 0.6
local COLORS = {
	water = Color3.fromRGB(28, 150, 180),
	lawn = Color3.fromRGB(98, 142, 66),
	land = Color3.fromRGB(62, 98, 54),
	beach = Color3.fromRGB(196, 186, 150),
	deck = Color3.fromRGB(196, 156, 108),
	asphalt = Color3.fromRGB(92, 96, 100),
	road = Color3.fromRGB(170, 160, 140),
	field = Color3.fromRGB(140, 116, 84),
	roof = Color3.fromRGB(74, 78, 86),
	white = Color3.fromRGB(238, 238, 234),
	cream = Color3.fromRGB(232, 224, 204),
	grey = Color3.fromRGB(176, 180, 184),
	wood = Color3.fromRGB(168, 124, 88),
	kicker = Color3.fromRGB(240, 244, 246),
	kickerSide = Color3.fromRGB(36, 84, 176),
	rail = Color3.fromRGB(40, 118, 214),
	tower = Color3.fromRGB(150, 156, 162),
	trunk = Color3.fromRGB(92, 70, 52),
	leaves = Color3.fromRGB(52, 118, 50),
}

-- A box on the ground plane: centre (sim metres), size (metres), heading (sim).
local function block(name, x, y, z, w, h, d, heading, color)
	return part(name, Vector3.new(w * S, h * S, d * S), CFrame.new(x * S, y * S, z * S) * yaw(heading), color)
end

-- Park: the user's map. Water, banks, island, terrace, roads, buildings, dock,
-- towers, cable and features, all from Sim.Park.DEFAULT_PARK and the sim state.
local function buildPark(sim)
	local site = Sim.Park.DEFAULT_PARK.site
	local lake = site.lake
	local c = SiteGeometry.centroid(lake)

	-- Water: a fan from the lake's centre (the outline is star-shaped).
	for i, p in lake do
		local q = lake[i % #lake + 1]
		triangle("Water", Vector3.new(c.x * S, 0, c.z * S), Vector3.new(p.x * S, 0, p.z * S), Vector3.new(q.x * S, 0, q.z * S), COLORS.water, 0.2)
	end
	-- Land: solid bands out from the shore (beach, lawn, then fields of green).
	local function band(inner, outer, y, color)
		for i = 1, #inner do
			local j = i % #inner + 1
			local function v(p)
				return Vector3.new(p.x * S, y * S, p.z * S)
			end
			triangle("Land", v(inner[i]), v(inner[j]), v(outer[j]), color, 2 * y * S + 2)
			triangle("Land", v(inner[i]), v(outer[j]), v(outer[i]), color, 2 * y * S + 2)
		end
	end
	local beach = SiteGeometry.growRadially(lake, 4)
	local lawn = SiteGeometry.growRadially(lake, 26)
	band(lake, beach, LAND_Y * 0.5, COLORS.beach)
	band(beach, lawn, LAND_Y, COLORS.lawn)
	band(lawn, SiteGeometry.growRadially(lake, 600), LAND_Y, COLORS.land)

	for _, island in site.islands do
		polygon("Island", island.outline, island.height / 2, COLORS.lawn, island.height * S + 1)
		local ic = SiteGeometry.centroid(island.outline)
		for k = 1, 14 do
			local p = island.outline[k % #island.outline + 1]
			local x, z = ic.x + (p.x - ic.x) * 0.5, ic.z + (p.z - ic.z) * 0.5
			block("Trunk", x, island.height + 1.1, z, 0.5, 2.2, 0.5, 0, COLORS.trunk)
			part("Leaves", Vector3.new(5, 5, 5) * S * 0.6, CFrame.new(x * S, (island.height + 3.4) * S, z * S), COLORS.leaves, "Part").Shape = Enum.PartType.Ball
		end
	end
	for _, area in site.areas do
		if area.kind == "watch" then
			polygon("WatchArea", area.outline, LAND_Y + 0.25, COLORS.deck, 0.6 * S)
		elseif area.kind == "parking" then
			polygon("Parking", area.outline, LAND_Y + 0.03, COLORS.asphalt)
		elseif area.kind == "field" then
			polygon("Field", area.outline, LAND_Y + 0.02, COLORS.field)
		elseif area.kind == "pond" then
			polygon("Pond", area.outline, LAND_Y + 0.03, COLORS.water)
		end
	end
	for _, road in site.roads do
		for i = 1, #road.points - 1 do
			local a, b = road.points[i], road.points[i + 1]
			local len = math.sqrt((b.x - a.x) ^ 2 + (b.z - a.z) ^ 2) + road.width
			block(road.name, (a.x + b.x) / 2, LAND_Y + 0.02, (a.z + b.z) / 2, len, 0.1, road.width, math.atan2(b.z - a.z, b.x - a.x), COLORS.road)
		end
	end
	for _, b in site.buildings do
		local wall = if b.roof == "tent" then COLORS.white else COLORS[b.color]
		block(b.name, b.x, LAND_Y + b.height / 2, b.z, b.width, b.height, b.depth, b.heading, wall)
		if b.roof ~= "flat" then
			-- Gable (or tent) roof: two wedges meeting along the ridge.
			local rise = math.min(b.depth / 2, 3.2)
			local roofColor = if b.roof == "tent" then COLORS.white else COLORS.roof
			for _, side in { 1, -1 } do
				local cf = CFrame.new(b.x * S, (LAND_Y + b.height + rise / 2) * S, b.z * S)
					* yaw(b.heading)
					* CFrame.new(0, 0, side * b.depth / 4 * S)
					* CFrame.Angles(0, if side == 1 then math.pi else 0, 0)
				part(b.name .. "Roof", Vector3.new(b.width * S, rise * S, b.depth / 2 * S), cf, roofColor, "WedgePart")
			end
		end
	end
	for _, dock in site.docks do
		local mid = Sim.Cable.cablePointAt(sim.path, dock.s + dock.length / 2)
		local right = Sim.Vec.rightOf(mid.heading)
		local cx, cz = mid.pos.x + right.x * dock.offset, mid.pos.z + right.z * dock.offset
		block("Dock", cx, 0.3, cz, dock.length, 0.2, dock.width, mid.heading, COLORS.deck)
		-- Walkway from the dock's outer edge to the shore.
		local side = if dock.offset < 0 then -1 else 1
		local len = 0
		while len < 60 and SiteGeometry.pointInPolygon({ x = cx + right.x * side * (dock.width / 2 + len), z = cz + right.z * side * (dock.width / 2 + len) }, lake) do
			len += 1
		end
		len += 4
		local d = dock.width / 2 + len / 2
		block("DockWalkway", cx + right.x * side * d, 0.3, cz + right.z * side * d, 1.6, 0.16, len, mid.heading, COLORS.deck)
	end

	for i, b in site.buoys do
		local buoy = part(`Buoy{i}`, Vector3.new(1.6, 1.6, 1.6) * S, CFrame.new(b.x * S, 0, b.z * S), Color3.fromRGB(230, 196, 60))
		buoy.Shape = Enum.PartType.Ball
	end

	local path = sim.path
	local step = 3
	local prev = Sim.Cable.cablePointAt(path, 0).pos
	for s = step, path.length + step, step do
		local p = Sim.Cable.cablePointAt(path, math.min(s, path.length)).pos
		local a, b = stud(prev), stud(p)
		part("Cable", Vector3.new(0.15, 0.15, (b - a).Magnitude), CFrame.lookAt((a + b) / 2, b), Color3.fromRGB(30, 30, 34))
		prev = p
	end
	for i, t in sim.cfg.cable.towers do
		local h = (path.height + 1) * S
		part(`Tower{i}`, Vector3.new(2, h, 2), CFrame.new(t.x * S, h / 2, t.z * S), COLORS.tower)
	end
	FeatureModel.setupCollisionGroups()
	for _, f in sim.features do
		local d = f.def
		if d.kind == "feature" then
			-- Wake park catalogue features: built by FeatureBuilder from the sim's own ride pieces.
			local m = FeatureBuilder.build({
				id = d.id, catalog = d.catalog, params = d.params, side = d.side, accent = d.accent, name = d.name,
				origin = Vector3.new(f.origin.x, 0, f.origin.z), heading = f.heading,
				offsetFromCable = d.offset, yaw = d.yaw,
			})
			m.Parent = FeatureModel.featuresFolder()
			continue
		end
		local length = Sim.Park.featureLength(d)
		local mid = Sim.Vec.addScaled(f.origin, Sim.Vec.forwardOf(f.heading), length / 2)
		if d.kind == "kicker" then
			-- A wedge rises toward its +Z face; turn +Z onto the sim heading so it rises along travel.
			local cf = CFrame.new(stud(mid) + Vector3.new(0, d.height * S / 2, 0)) * yaw(f.heading) * CFrame.Angles(0, math.pi / 2, 0)
			part(d.id, Vector3.new(d.width * S, d.height * S, length * S), cf, COLORS.kicker, "WedgePart")
			part(d.id .. "Float", Vector3.new(length * S, 0.4 * S, (d.width + 0.5) * S), CFrame.new(stud(mid)) * yaw(f.heading), COLORS.kickerSide)
		else
			if d.style == "tube" then
				-- Round pipe: a cylinder's axis is its X, which yaw() turns onto the heading.
				local cf = CFrame.new(stud(mid) + Vector3.new(0, (d.height - d.width / 2) * S, 0)) * yaw(f.heading)
				local pipe = part(d.id, Vector3.new(length * S, d.width * S, d.width * S), cf, COLORS.rail)
				pipe.Shape = Enum.PartType.Cylinder
			else
				local cf = CFrame.new(stud(mid) + Vector3.new(0, d.height * S / 2, 0)) * yaw(f.heading)
				part(d.id, Vector3.new(length * S, d.height * S, math.max(d.width, 0.3) * S), cf, COLORS.rail)
			end
			part(d.id .. "Float", Vector3.new(length * S, 0.3 * S, 1.4 * S), CFrame.new(stud(mid)) * yaw(f.heading), COLORS.kickerSide)
		end
	end
end
buildPark(run.sim)
-- Index the park's features for queries (surface under a point, nearby features, crash volumes).
FeatureRegistry.init()

local carrier = part("Carrier", Vector3.new(2, 1, 1), CFrame.new(), Color3.fromRGB(240, 180, 40))
local AC = Anim.AnimConfig.DEFAULT
local METRES_PER_STUD = RiderBuilder.Config.Rig.MetresPerStud

-- Rope: a Beam from the carrier to the handle, white to red as tension rises.
-- Both ends' attachment X axes point down, so CurveSize sags it when slack.
local DOWN = CFrame.fromMatrix(Vector3.zero, Vector3.new(0, -1, 0), Vector3.new(1, 0, 0))
local ropeFrom = Instance.new("Attachment")
ropeFrom.CFrame = DOWN
ropeFrom.Parent = carrier
local ropeAnchor = part("RopeEnd", Vector3.new(0.2, 0.2, 0.2), CFrame.new(), Color3.new(1, 1, 1))
ropeAnchor.Transparency = 1
local ropeTo = Instance.new("Attachment")
ropeTo.CFrame = DOWN
ropeTo.Parent = ropeAnchor
local beam = Instance.new("Beam")
beam.Attachment0 = ropeFrom
beam.Attachment1 = ropeTo
beam.Width0 = 0.12
beam.Width1 = 0.12
beam.FaceCamera = true
beam.Segments = 12
beam.Parent = carrier

-- The rider: jointed RiderBuilder rig + the animator (both in metres; RiderRig converts).
local RIDER_OPTIONS = { palette = "Sheet", name = "Rider" }
local rider = RiderBuilder.build(RIDER_OPTIONS)
rider.Parent = folder
local rig = RiderRig.new(rider, METRES_PER_STUD)
local rigDef = RiderBuilder.rigDef(RIDER_OPTIONS)
local animator = Anim.Animator.create(rigDef)
local animState = nil
local frame = nil

-- VFX: spray (WaterSpray) with a rooster tail on hard heelside edges, a wake
-- trail off the tail, and splash bursts on landings and crashes.
local spray = WaterSpray.attach(rider)
local splashPart = part("Splash", Vector3.new(0.2, 0.2, 0.2), CFrame.new(), Color3.new(1, 1, 1))
splashPart.Transparency = 1
local splash = Instance.new("ParticleEmitter")
splash.Rate = 0
splash.Lifetime = NumberRange.new(0.5, 1.1)
splash.Speed = NumberRange.new(6, 16)
splash.SpreadAngle = Vector2.new(60, 60)
splash.Acceleration = Vector3.new(0, -60, 0)
splash.Size = NumberSequence.new(0.6, 0.1)
splash.Color = ColorSequence.new(Color3.fromRGB(236, 246, 250))
splash.Parent = splashPart
local wake0, wake1 = Instance.new("Attachment"), Instance.new("Attachment")
wake0.Position = Vector3.new(-2.2, -0.2, 0.55)
wake1.Position = Vector3.new(-2.2, -0.2, -0.55)
wake0.Parent = rider.PrimaryPart
wake1.Parent = rider.PrimaryPart
local wake = Instance.new("Trail")
wake.Attachment0 = wake0
wake.Attachment1 = wake1
wake.Lifetime = 1.8
wake.Transparency = NumberSequence.new(0.4, 1)
wake.Color = ColorSequence.new(Color3.fromRGB(230, 244, 248))
wake.Parent = rider.PrimaryPart

-- Sound hooks: one Sound per AnimConfig.Sound entry; silent until it has an id.
local sounds = {}
for name, id in AC.Sound do
	local snd = Instance.new("Sound")
	snd.Name = name
	snd.SoundId = id
	snd.Looped = name == "Carve" or name == "GrindBox" or name == "GrindRail"
	snd.Parent = rider.PrimaryPart
	sounds[name] = snd
end
local function play(name, volume)
	local snd = sounds[name]
	if snd and snd.SoundId ~= "" then
		snd.Volume = volume or 0.6
		snd:Play()
	end
end
local function loop(name, on, volume)
	local snd = sounds[name]
	if not snd or snd.SoundId == "" then
		return
	end
	snd.Volume = volume
	if on and not snd.IsPlaying then
		snd:Play()
	elseif not on and snd.IsPlaying then
		snd:Stop()
	end
end

-- F6 skeleton overlay: joints (green), centre of mass (yellow), rotation axis (red), IK targets (magenta).
local overlayOn = false
local overlay = { joints = {}, bones = {}, com = nil, axis = nil, targets = {} }
local function adorn(kind, color, size)
	local a = Instance.new(kind)
	a.Adornee = workspace.Terrain
	a.AlwaysOnTop = true
	a.ZIndex = 5
	a.Color3 = color
	if kind == "SphereHandleAdornment" then
		a.Radius = size
	else
		a.Thickness = size
	end
	a.Visible = false
	a.Parent = workspace.Terrain
	return a
end
for _, j in Anim.Skeleton.JOINTS do
	overlay.joints[j] = adorn("SphereHandleAdornment", Color3.fromRGB(60, 255, 110), 0.18)
	overlay.bones[j] = adorn("LineHandleAdornment", Color3.fromRGB(60, 255, 110), 3)
end
overlay.com = adorn("SphereHandleAdornment", Color3.fromRGB(255, 216, 30), 0.3)
overlay.axis = adorn("LineHandleAdornment", Color3.fromRGB(255, 60, 60), 4)
for i = 1, 4 do
	overlay.targets[i] = adorn("SphereHandleAdornment", Color3.fromRGB(255, 60, 230), 0.2)
end
local function drawOverlay(f)
	local function line(a, from, to)
		local d = to - from
		a.CFrame = CFrame.lookAt(from, to)
		a.Length = d.Magnitude
		a.Visible = overlayOn
	end
	for _, j in Anim.Skeleton.JOINTS do
		local p = RiderRig.stud(rig, f.world[j])
		overlay.joints[j].CFrame = CFrame.new(p)
		overlay.joints[j].Visible = overlayOn
		local parent = Anim.Skeleton.PARENT[j]
		if parent ~= "Root" then
			line(overlay.bones[j], RiderRig.stud(rig, f.world[parent]), p)
		else
			overlay.bones[j].Visible = false
		end
	end
	local com = RiderRig.stud(rig, f.com)
	overlay.com.CFrame = CFrame.new(com)
	overlay.com.Visible = overlayOn
	if f.rotationAxis then
		local ax = Vector3.new(f.rotationAxis.x, f.rotationAxis.y, f.rotationAxis.z) * 3
		line(overlay.axis, com - ax, com + ax)
	else
		overlay.axis.Visible = false
	end
	for i, a in overlay.targets do
		local t = f.ikTargets[i]
		a.Visible = overlayOn and t ~= nil
		if t then
			a.CFrame = CFrame.new(RiderRig.stud(rig, t))
		end
	end
end

-- F7 pose scrubber: a test-driver clip frozen at phase u instead of the sim.
local scrubOn = false
local scrubIndex = 1
local scrubU = 0.5
local scrubKey = ""
local scrubFrame = nil
local scrubOrigin = nil

-- F4 slow motion: scales the local sim and animation time (debug).
local timeScaleIndex = 1

-- HUD: tension meter (1000 N mark, LOADED), trick feed and combo, crash reason,
-- handle-pass prompt, balance meter, debug overlay (F3).
local gui = Instance.new("ScreenGui")
gui.Name = "WakeHud"
gui.ResetOnSpawn = false
local function textLabel(name, size, pos, textSize)
	local l = Instance.new("TextLabel")
	l.Name = name
	l.BackgroundTransparency = 0.35
	l.BackgroundColor3 = Color3.fromRGB(34, 44, 58)
	l.TextColor3 = Color3.new(1, 1, 1)
	l.Font = Enum.Font.GothamBold
	l.TextSize = textSize or 18
	l.Size = size
	l.Position = pos
	l.Parent = gui
	return l
end
local status = textLabel("Status", UDim2.fromOffset(420, 60), UDim2.fromOffset(12, 12), 16)
status.TextXAlignment = Enum.TextXAlignment.Left
local meter = Instance.new("Frame")
meter.Name = "Tension"
meter.Size = UDim2.fromOffset(300, 16)
meter.Position = UDim2.new(0.5, -150, 0, 14)
meter.BackgroundColor3 = Color3.fromRGB(34, 44, 58)
meter.Parent = gui
local meterFill = Instance.new("Frame")
meterFill.BorderSizePixel = 0
meterFill.BackgroundColor3 = Color3.fromRGB(143, 212, 60)
meterFill.Parent = meter
local meterMark = Instance.new("Frame")
meterMark.Size = UDim2.new(0, 2, 1, 6)
meterMark.Position = UDim2.new(1000 / 2000, -1, 0, -3)
meterMark.BackgroundColor3 = Color3.new(1, 1, 1)
meterMark.Parent = meter
local loadedTag = textLabel("Loaded", UDim2.fromOffset(90, 22), UDim2.new(0.5, 160, 0, 10), 14)
loadedTag.Text = "LOADED"
loadedTag.BackgroundColor3 = Color3.fromRGB(255, 212, 58)
loadedTag.TextColor3 = Color3.fromRGB(42, 31, 0)
local feed = textLabel("Feed", UDim2.new(0, 520, 0, 64), UDim2.new(0.5, -260, 1, -140), 18)
feed.TextWrapped = true
local prompt = textLabel("Prompt", UDim2.fromOffset(220, 34), UDim2.new(0.5, -110, 0.55, 0), 18)
local debugLabel = textLabel("Debug", UDim2.fromOffset(320, 200), UDim2.fromOffset(12, 84), 13)
debugLabel.TextXAlignment = Enum.TextXAlignment.Left
debugLabel.TextYAlignment = Enum.TextYAlignment.Top
debugLabel.Font = Enum.Font.Code
debugLabel.Visible = false
gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

local scrubLabel = textLabel("Scrub", UDim2.fromOffset(420, 30), UDim2.new(0.5, -210, 1, -64), 16)
scrubLabel.Visible = false

-- Remote events to the server (it validates and keeps the leaderboard, and relays anim state).
local remotes = ReplicatedStorage:WaitForChild("WakeRemotes")
local TrickLanded = remotes:WaitForChild("TrickLanded")
local ComboEnded = remotes:WaitForChild("ComboEnded")
local Crashed = remotes:WaitForChild("Crashed")
local AnimStateRemote = remotes:WaitForChild("AnimState")

-- Input: ContextActionService actions (WakeInput.ACTIONS), so keys can be rebound and gamepads work.
local held = {}
local analogSteer = 0
local debugOpen = false
local function onAction(name, state)
	held[name] = state == Enum.UserInputState.Begin or state == Enum.UserInputState.Change
	local began = state == Enum.UserInputState.Begin
	if name == "Restart" and began then
		run = Sim.Session.createRun()
	elseif name == "Debug" and began then
		debugOpen = not debugOpen
		debugLabel.Visible = debugOpen
	elseif name == "SlowMo" and began then
		timeScaleIndex = timeScaleIndex % #AC.Debug.TimeScales + 1
	elseif name == "Skeleton" and began then
		overlayOn = not overlayOn
	elseif name == "Scrub" and began then
		scrubOn = not scrubOn
	elseif scrubOn and began and (name == "ScrubPrev" or name == "ScrubNext") then
		local n = #Anim.TestDriver.ORDER
		scrubIndex = (scrubIndex - 1 + (if name == "ScrubNext" then 1 else -1)) % n + 1
	elseif scrubOn and began and (name == "ScrubBack" or name == "ScrubForward") then
		scrubU = math.clamp(scrubU + (if name == "ScrubForward" then 0.05 else -0.05), 0, 1)
	end
	return Enum.ContextActionResult.Sink
end
for name, keys in WakeInput.ACTIONS do
	local codes = {}
	for _, k in keys do
		table.insert(codes, Enum.KeyCode[k])
	end
	ContextActionService:BindAction(name, onAction, false, table.unpack(codes))
end
ContextActionService:BindAction("SteerStick", function(_, _, inputObject)
	analogSteer = inputObject.Position.X
	return Enum.ContextActionResult.Pass
end, false, Enum.KeyCode.Thumbstick1)

local camera = workspace.CurrentCamera
camera.CameraType = Enum.CameraType.Scriptable

local stepper = Sim.Stepper.createStepper()
local prevRider = run.sim.rider.pos
local prevCarrier = run.sim.carrier.pos
local lastTrick = ""
local lastCrash = ""
local seenCombo = nil
-- Events of every tick since the last frame, for the animation.
local pending = {}

local function tick()
	prevRider = run.sim.rider.pos
	prevCarrier = run.sim.carrier.pos
	Sim.Session.stepRun(run, WakeInput.frame(held, analogSteer))
	for _, e in run.sim.events do
		table.insert(pending, e)
	end
	for _, rec in run.latest do
		lastTrick = `{rec.trick.name}  +{math.floor(rec.trick.points * rec.trick.quality + 0.5)}`
		TrickLanded:FireServer({ name = rec.trick.name, points = rec.trick.points, tick = rec.tick })
	end
	for _, e in run.sim.events do
		if e.type == "crash" then
			lastCrash = e.reason
			Crashed:FireServer(e.reason)
		end
	end
	local c = run.lastCombo
	if c and c ~= seenCombo then
		seenCombo = c
		if not c.voided then
			-- Send the combo's tricks so the server can recompute the score with Sim.ScoringCombo.
			local tricks = {}
			for k = #run.tricks - c.tricks + 1, #run.tricks do
				local rec = run.tricks[k]
				if rec then
					table.insert(tricks, {
						name = rec.trick.name,
						points = rec.trick.points,
						quality = rec.trick.quality,
						comboFactor = rec.trick.comboFactor,
						tokens = rec.trick.tokens,
						airTime = rec.airTime,
						spinDegrees = rec.trick.spinDegrees,
						tick = rec.tick,
					})
				end
			end
			ComboEnded:FireServer(tricks, c.total)
		end
	end
end

-- Other players' riders, animated from their replicated anim state.
local remoteRiders = {}
local clock = 0
AnimStateRemote.OnClientEvent:Connect(function(userId, packet)
	if userId == Players.LocalPlayer.UserId or type(packet) ~= "table" then
		return
	end
	local rr = remoteRiders[userId]
	if not rr then
		local opts = { palette = if userId % 2 == 0 then "A" else "B", name = `Rider{userId}` }
		local model = RiderBuilder.build(opts)
		model.Parent = folder
		rr = {
			model = model,
			rig = RiderRig.new(model, METRES_PER_STUD),
			animator = Anim.Animator.create(RiderBuilder.rigDef(opts)),
			buffer = Anim.Replication.createBuffer(),
		}
		remoteRiders[userId] = rr
	end
	-- Interpolate on our own clock: stamp the packet with its arrival time.
	local p = table.clone(packet)
	p[1] = clock
	Anim.Replication.push(rr.buffer, p)
end)
Players.PlayerRemoving:Connect(function(player)
	local rr = remoteRiders[player.UserId]
	if rr then
		rr.model:Destroy()
		remoteRiders[player.UserId] = nil
	end
end)
local sendTimer = 0
local sendFlags = 0

-- Sim, animation and the rig: PreSimulation, so the Motor6D Transforms are not overwritten.
local renderPos = run.sim.rider.pos
local renderCarrier = run.sim.carrier.pos
RunService.PreSimulation:Connect(function(rawDt)
	local scale = AC.Debug.TimeScales[timeScaleIndex]
	local dt = math.min(rawDt, 0.25) * scale
	clock += dt
	local sim = run.sim
	if scrubOn then
		-- Pose scrubber: the chosen clip frozen at u, where the rider is.
		local name = Anim.TestDriver.ORDER[scrubIndex]
		if not scrubOrigin then
			scrubOrigin = { x = sim.rider.pos.x, y = 0, z = sim.rider.pos.z }
		end
		local key = `{name}|{scrubU}`
		if key ~= scrubKey or not scrubFrame then
			scrubKey = key
			scrubFrame = Anim.TestDriver.playTo(Anim.Animator.create(rigDef), Anim.TestDriver.SCENARIOS[name], scrubU, scrubOrigin)
		end
		frame = scrubFrame
		scrubLabel.Text = `Pose {name}  u = {string.format("%.2f", scrubU)}   [ ] clip   - = phase   F7 close`
	else
		scrubOrigin = nil
		local _, alpha = Sim.Stepper.advanceStepper(stepper, dt, tick)
		sim = run.sim
		renderPos = Sim.Vec.lerpVec(prevRider, sim.rider.pos, alpha)
		renderCarrier = Sim.Vec.lerpVec(prevCarrier, sim.carrier.pos, alpha)
		local st = Anim.Adapter.fromSim(sim, pending, animState)
		st.boardCFrame.pos = renderPos
		animState = st
		pending = {}
		frame = Anim.Animator.step(animator, st, dt)
		-- Replicate at Replication.SEND_RATE; one-shots wait for the next send.
		sendFlags = bit32.bor(sendFlags, Anim.Replication.flags(st))
		sendTimer += dt
		if sendTimer >= 1 / Anim.Replication.SEND_RATE then
			sendTimer = 0
			AnimStateRemote:FireServer(Anim.Replication.pack(st, clock, sendFlags))
			sendFlags = 0
		end
	end
	scrubLabel.Visible = scrubOn
	RiderRig.apply(rig, frame)
	drawOverlay(frame)
	for _, rr in remoteRiders do
		local st = Anim.Replication.sample(rr.buffer, clock - 0.15)
		if st then
			RiderRig.apply(rr.rig, Anim.Animator.step(rr.animator, st, dt))
		end
	end
end)

local shake = 0
local fovKick = 0
local camRoll = 0
local pullOut = 0
RunService.RenderStepped:Connect(function(rawDt)
	local dt = math.min(rawDt, 0.25)
	local sim = run.sim
	local r = sim.rider
	if not frame then
		return
	end
	carrier.CFrame = CFrame.new(stud(renderCarrier)) * yaw(sim.carrier.heading)

	-- Rope: to the handle, sagging when slack, thinner when taut.
	local handleW = RiderRig.stud(rig, frame.handle.pos)
	ropeAnchor.CFrame = CFrame.new(handleW)
	local len = (handleW - carrier.Position).Magnitude
	local taut = math.clamp(r.ropeTension / 400, 0, 1)
	local sag = AC.Vfx.RopeSag * len * (1 - taut)
	beam.CurveSize0 = sag
	beam.CurveSize1 = -sag
	local width = 0.12 * (1 - (1 - AC.Vfx.RopeTautWidth) * taut)
	beam.Width0, beam.Width1 = width, width
	local tFrac = math.clamp(r.tensionSmooth / 2000, 0, 1)
	beam.Color = ColorSequence.new(Color3.new(1, 1, 1):Lerp(Color3.fromRGB(230, 40, 30), tFrac))

	-- Spray (rooster tail on a hard heelside edge), wake, splash, sounds.
	local onWater = Sim.Fsm.onWater(r.mode) or r.mode == "landing"
	local speed = Sim.Vec.horizontalLength(r.vel)
	local edgeN = if animState then animState.edge else 0
	local intensity = if onWater and not scrubOn then math.clamp((speed - 3) / 10, 0, 1) * (0.35 + 0.65 * math.clamp(r.edgeLoad / 1400, 0, 1)) else 0
	local rooster = edgeN > AC.Vfx.RoosterEdge
	WaterSpray.setIntensity(spray, intensity * (if rooster then 1.6 else 1))
	wake.Enabled = onWater
	loop("Carve", onWater and speed > 2, math.clamp(speed / 12, 0, 1) * (0.3 + 0.7 * math.abs(edgeN)))
	local onRail = r.mode == "onFeature" and animState and animState.ext.rail
	loop("GrindRail", onRail == true, 0.6)
	loop("GrindBox", r.mode == "onFeature" and not onRail, 0.6)
	for _, e in frame.events do
		if e == "land" or e == "splash" or e == "crash" then
			local impact = if e == "land" then frame.impact else 6
			splashPart.CFrame = CFrame.new(RiderRig.stud(rig, frame.root.pos))
			splash:Emit(math.floor(AC.Vfx.SplashPerMS * math.max(1, impact) / 4))
			shake = math.max(shake, AC.Camera.ShakePerMS * impact * 3)
			play(if e == "land" then "Land" else "Splash", math.clamp(impact / 8, 0.2, 1))
		elseif e == "pop" then
			fovKick = AC.Camera.PopFovKick
			play("Pop")
		elseif e == "pass" then
			play("HandlePass")
		elseif e == "snap" then
			play("RopeSnap")
		end
	end
	frame.events = {}
	shake *= math.exp(-AC.Camera.ShakeDecay * dt)
	fovKick *= math.exp(-4 * dt)

	-- Chase camera: behind and above along the travel heading; pulls out for
	-- inverts, rolls a little with the carve, kicks the FOV at the pop.
	local focus = RiderRig.stud(rig, frame.com)
	local rootUp = RiderRig.rootCFrame(rig, frame).UpVector.Y
	local invert = math.clamp(math.max(frame.tuck, (0.5 - rootUp) / 1.2), 0, 1)
	pullOut += (invert - pullOut) * math.min(1, dt * 3)
	local back = Vector3.new(math.cos(r.heading), 0, math.sin(r.heading)) * (-(7 + AC.Camera.InvertPullOut * pullOut) * S)
	local wantRoll = math.rad(AC.Camera.CarveRoll * edgeN)
	camRoll += (wantRoll - camRoll) * math.min(1, dt * 3)
	local jitter = Vector3.new(math.sin(clock * 61), math.sin(clock * 47 + 1), math.sin(clock * 53 + 2)) * shake * S
	local look = CFrame.lookAt(focus + back + Vector3.new(0, (3 + pullOut) * S, 0) + jitter, focus)
	camera.CFrame = camera.CFrame:Lerp(look * CFrame.Angles(0, 0, camRoll), math.min(1, dt * 6))
	camera.FieldOfView = 70 + math.clamp((speed - 8) * 1.5, 0, 12) + fovKick

	-- HUD.
	meterFill.Size = UDim2.new(tFrac, 0, 1, 0)
	loadedTag.Visible = r.mode == "waterTrickLoad"
	local live = Sim.Session.liveCombo(run)
	local total = run.points + (if live then live.total else 0)
	local statusText = if run.finished then `Run over ({run.endReason}): judges {run.score and run.score.total or 0}. Enter to restart` else ""
	local slow = AC.Debug.TimeScales[timeScaleIndex]
	local slowText = if slow < 1 then `   SLOW x{slow}` else ""
	status.Text = `  {total} pts   best combo {run.bestCombo}   pass {run.pass + 1}/{sim.cfg.run.passesPerRun}   crashes {#run.crashes}/{sim.cfg.run.maxFalls}{slowText}\n  {math.floor(speed * 3.6)} km/h   {r.mode}   {statusText}`
	if run.combo and live then
		feed.Text = `{Sim.ScoringCombo.comboName(run.combo.entries)}   x{string.format("%.2f", live.multiplier)} = {live.total}`
	elseif lastCrash ~= "" and r.mode == "crashed" then
		-- Feature crash volumes carry a message per reason (FeatureConfig.CrashMessages).
		local message = (FeatureConfig.CrashMessages :: any)[lastCrash]
		feed.Text = if message then `Crash: {message}` else `Crash: {lastCrash}`
	else
		feed.Text = lastTrick
	end
	local rot = if r.air then r.air.rot elseif r.jib then r.jib.rot else nil
	if rot and rot.spinSide and r.handle == "inFront" and rot.passTimer == 0 then
		local w = Sim.Handle.passWindowOf(rot, { rate = sim.cfg.spin.rate, inAir = r.air ~= nil })
		local hp = Sim.Handle.handleProgress(rot)
		prompt.Visible = w ~= nil and hp > w.zone.start - 0.6
		prompt.Text = if w and math.abs(hp - w.centre) <= w.half then "PASS NOW (Q)" else "Handle pass: Q"
	elseif r.jib and sim.cfg.feature.balanceEnabled then
		prompt.Visible = true
		local cells = math.floor((r.jib.balance + 1) * 5 + 0.5)
		prompt.Text = "Balance " .. string.rep("-", math.clamp(cells, 0, 10)) .. "|" .. string.rep("-", math.clamp(10 - cells, 0, 10))
	else
		prompt.Visible = false
	end
	if debugOpen then
		debugLabel.Text = table.concat({
			`State     {r.mode}`,
			`Tension   {math.floor(r.ropeTension)} / {math.floor(r.tensionSmooth)} N`,
			`Edge      {string.format("%.2f", Sim.Edge.edgeNorm(r, sim.cfg.edge))}`,
			`Spin      {if rot then math.floor(math.deg(rot.spinAngle)) else "-"}`,
			`Flip      {if rot then math.floor(math.deg(rot.flipAngle)) else "-"}`,
			`Handle    {r.handle}   hands {frame.handKinds.L}/{frame.handKinds.R}`,
			`Anim      {animator.key}   tuck {string.format("%.2f", frame.tuck)}`,
			`Last crash {r.lastCrash or "none"}`,
		}, "\n")
	end
end)
