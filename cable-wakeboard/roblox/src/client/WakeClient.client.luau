--[[
	WakeClient: plays the Luau sim in Studio (StarterPlayerScripts).

	A thin, deliberately simple client. All game logic is in
	ReplicatedStorage.WakeShared.Sim, which is the same code as the web game
	(checked tick for tick by tests/parity.test.ts). This script only:
	  - reads the keyboard into an InputFrame (WakeInput, same keys as the web),
	  - runs Sim.Session.stepRun at a fixed 60 Hz,
	  - builds the park from the user's map (Sim.Park.DEFAULT_PARK: shore, island,
	    dock, terrace, buildings, roads) plus the sim's cable and features,
	  - moves the RiderBuilder model, rope and carrier, and a chase camera,
	  - shows points, passes, falls and the last trick.
	Not yet checked in Studio: expect to tune the camera and scale. Rendering is
	single-player and local; the sim does not use Roblox physics at all.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local shared = ReplicatedStorage:WaitForChild("WakeShared")
local Sim = require(shared:WaitForChild("Sim"))
local RiderBuilder = require(shared:WaitForChild("RiderBuilder"))
local WakeInput = require(shared:WaitForChild("WakeInput"))
local SiteGeometry = require(shared:WaitForChild("SiteGeometry"))

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
	for _, f in sim.features do
		local d = f.def
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

local carrier = part("Carrier", Vector3.new(2, 1, 1), CFrame.new(), Color3.fromRGB(240, 180, 40))
local rope = part("Rope", Vector3.new(0.08, 0.08, 1), CFrame.new(), Color3.fromRGB(250, 250, 250))
local rider = RiderBuilder.build({ palette = "Sheet", name = "Rider" })
rider.Parent = folder

-- Pose: yaw (travel + spin or rail angle), then invert, then edge tilt. As BabylonRenderer.
local function riderCFrame(r, pos)
	local switchStance = if r.air then r.air.takeoffSwitch else r.switchStance
	local toes = Sim.Edge.toeSign({ stance = r.stance, switchStance = switchStance })
	local heading = r.heading + (if r.air then r.air.spinAngle else 0) + (if r.jib then r.jib.boardAngle else 0)
	local cf = CFrame.new(stud(pos)) * yaw(heading)
	if r.air and r.air.flipDir ~= 0 then
		local axis = if r.air.axis == "flip" then Vector3.xAxis else Vector3.new(1, 1, 0).Unit
		local sign = if r.air.flipDir < 0 then -toes else toes
		cf *= CFrame.fromAxisAngle(axis, sign * r.air.flipAngle)
	end
	local raley = if r.air then r.air.raleyExtension else 0
	cf *= CFrame.fromAxisAngle(Vector3.xAxis, -toes * (r.edgeAngle + raley * 1.3))
	if r.mode == "fallen" then
		cf *= CFrame.Angles(math.pi / 2, 0, 0)
	end
	-- The web mirrors the model for goofy/switch; Roblox models cannot be mirrored, so it is not.
	return cf
end

-- HUD.
local gui = Instance.new("ScreenGui")
gui.Name = "WakeHud"
gui.ResetOnSpawn = false
local label = Instance.new("TextLabel")
label.BackgroundTransparency = 0.4
label.BackgroundColor3 = Color3.new(0, 0, 0)
label.TextColor3 = Color3.new(1, 1, 1)
label.Font = Enum.Font.GothamBold
label.TextSize = 18
label.TextXAlignment = Enum.TextXAlignment.Left
label.Size = UDim2.fromOffset(360, 120)
label.Position = UDim2.fromOffset(12, 12)
label.Parent = gui
gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

-- Keyboard: held keys by Enum.KeyCode name.
local held = {}
UserInputService.InputBegan:Connect(function(input, processed)
	if processed or input.UserInputType ~= Enum.UserInputType.Keyboard then
		return
	end
	held[input.KeyCode.Name] = true
	if input.KeyCode == Enum.KeyCode.Return then
		run = Sim.Session.createRun()
	end
end)
UserInputService.InputEnded:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.Keyboard then
		held[input.KeyCode.Name] = nil
	end
end)

local camera = workspace.CurrentCamera
camera.CameraType = Enum.CameraType.Scriptable

local stepper = Sim.Stepper.createStepper()
local prevRider = run.sim.rider.pos
local prevCarrier = run.sim.carrier.pos
local lastTrick = ""

local function tick()
	prevRider = run.sim.rider.pos
	prevCarrier = run.sim.carrier.pos
	Sim.Session.stepRun(run, WakeInput.frame(run.sim.rider, held))
	for _, rec in run.latest do
		lastTrick = `{rec.trick.name}  +{Sim.Session.trickPoints(rec)}`
	end
end

RunService.RenderStepped:Connect(function(dt)
	local _, alpha = Sim.Stepper.advanceStepper(stepper, math.min(dt, 0.25), tick)
	local sim = run.sim
	local r = sim.rider
	local pos = Sim.Vec.lerpVec(prevRider, r.pos, alpha)
	local cpos = Sim.Vec.lerpVec(prevCarrier, sim.carrier.pos, alpha)

	local cf = riderCFrame(r, pos)
	rider:PivotTo(cf)
	carrier.CFrame = CFrame.new(stud(cpos)) * yaw(sim.carrier.heading)
	local handle = rider:FindFirstChild("RopeAttachment", true)
	if r.hasHandle and handle then
		local a, c = stud(cpos), handle.WorldPosition
		rope.Transparency = 0
		rope.Size = Vector3.new(0.08, 0.08, (c - a).Magnitude)
		rope.CFrame = CFrame.lookAt((a + c) / 2, c)
	else
		rope.Transparency = 1
	end

	-- Chase camera: behind and above the rider along the travel heading.
	local target = stud(pos) + Vector3.new(0, 1.2 * S, 0)
	local back = Vector3.new(math.cos(r.heading), 0, math.sin(r.heading)) * (-7 * S)
	camera.CFrame = camera.CFrame:Lerp(CFrame.lookAt(target + back + Vector3.new(0, 3 * S, 0), target), math.min(1, dt * 6))

	local speed = Sim.Vec.horizontalLength(r.vel) * 3.6
	local status = if run.finished then `Run over ({run.endReason}): score {run.score and run.score.total or 0}. Enter to restart` else ""
	label.Text = `  {run.points} pts   pass {run.pass + 1}/{sim.cfg.run.passesPerRun}   falls {#run.falls}/{sim.cfg.run.maxFalls}\n  {math.floor(speed)} km/h   {r.mode}\n  {lastTrick}\n  {status}`
end)
