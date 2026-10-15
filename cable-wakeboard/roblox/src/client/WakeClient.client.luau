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
	  - moves the RiderBuilder model (RiderPose), the rope Beam (white to red with
	    tension) and the carrier, and a chase camera,
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
local RiderPose = require(shared:WaitForChild("RiderPose"))

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

-- Rope: a Beam between the carrier and the handle, white to red as tension rises.
local ropeFrom = Instance.new("Attachment")
ropeFrom.Parent = carrier
local ropeAnchor = part("RopeEnd", Vector3.new(0.2, 0.2, 0.2), CFrame.new(), Color3.new(1, 1, 1))
ropeAnchor.Transparency = 1
local ropeTo = Instance.new("Attachment")
ropeTo.Parent = ropeAnchor
local beam = Instance.new("Beam")
beam.Attachment0 = ropeFrom
beam.Attachment1 = ropeTo
beam.Width0 = 0.12
beam.Width1 = 0.12
beam.FaceCamera = true
beam.Parent = carrier

local rider = RiderBuilder.build({ palette = "Sheet", name = "Rider" })
rider.Parent = folder

-- Seconds since the crash, for the tumble.
local crashSpin = 0

-- Pose (RiderPose, twin of src/render/pose.ts): yaw, then invert, then lean.
local function riderCFrame(r, pos)
	local pose = RiderPose.of(r)
	local cf = CFrame.new(stud(pos)) * yaw(pose.yaw)
	if pose.invert then
		local a = pose.invert.axis
		-- Board frame z points to the toes; the model's +Z is the toe side for a regular rider.
		cf *= CFrame.fromAxisAngle(Vector3.new(a[1], a[2], a[3] * pose.toes).Unit, pose.invert.angle)
	end
	cf *= CFrame.fromAxisAngle(Vector3.xAxis, pose.lean)
	if r.mode == "crashed" then
		-- Tumble into the water while waiting for the respawn.
		local t = crashSpin
		cf *= CFrame.Angles(math.pi / 2 + 0.3 * math.sin(t * 3), t * 2, 0) + Vector3.new(0, -0.4 * S, 0)
	end
	-- The web mirrors the model for goofy/switch; Roblox models cannot be mirrored, so it is not.
	return cf
end

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

-- Remote events to the server (it validates and keeps the leaderboard).
local remotes = ReplicatedStorage:WaitForChild("WakeRemotes")
local TrickLanded = remotes:WaitForChild("TrickLanded")
local ComboEnded = remotes:WaitForChild("ComboEnded")
local Crashed = remotes:WaitForChild("Crashed")

-- Input: ContextActionService actions (WakeInput.ACTIONS), so keys can be rebound and gamepads work.
local held = {}
local analogSteer = 0
local debugOpen = false
local function onAction(name, state)
	held[name] = state == Enum.UserInputState.Begin or state == Enum.UserInputState.Change
	if name == "Restart" and state == Enum.UserInputState.Begin then
		run = Sim.Session.createRun()
	elseif name == "Debug" and state == Enum.UserInputState.Begin then
		debugOpen = not debugOpen
		debugLabel.Visible = debugOpen
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

local function tick()
	prevRider = run.sim.rider.pos
	prevCarrier = run.sim.carrier.pos
	Sim.Session.stepRun(run, WakeInput.frame(held, analogSteer))
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

RunService.RenderStepped:Connect(function(dt)
	local _, alpha = Sim.Stepper.advanceStepper(stepper, math.min(dt, 0.25), tick)
	local sim = run.sim
	local r = sim.rider
	crashSpin = if r.mode == "crashed" then crashSpin + dt else 0
	local pos = Sim.Vec.lerpVec(prevRider, r.pos, alpha)
	local cpos = Sim.Vec.lerpVec(prevCarrier, sim.carrier.pos, alpha)

	local cf = riderCFrame(r, pos)
	rider:PivotTo(cf)
	carrier.CFrame = CFrame.new(stud(cpos)) * yaw(sim.carrier.heading)
	local handle = rider:FindFirstChild("RopeAttachment", true)
	beam.Enabled = r.handle ~= "dropped" and handle ~= nil
	if handle then
		-- Blind: the handle is behind the back, so the rope runs to the heel side.
		local offset = if r.handle == "behind" then cf.LookVector * 0.6 else Vector3.zero
		ropeAnchor.CFrame = CFrame.new(handle.WorldPosition + offset)
	end
	local tFrac = math.clamp(r.tensionSmooth / 2000, 0, 1)
	beam.Color = ColorSequence.new(Color3.new(1, 1, 1):Lerp(Color3.fromRGB(230, 40, 30), tFrac))

	-- Chase camera: behind and above the rider along the travel heading, FOV widening with speed.
	local speed = Sim.Vec.horizontalLength(r.vel)
	local target = stud(pos) + Vector3.new(0, 1.2 * S, 0)
	local back = Vector3.new(math.cos(r.heading), 0, math.sin(r.heading)) * (-7 * S)
	camera.CFrame = camera.CFrame:Lerp(CFrame.lookAt(target + back + Vector3.new(0, 3 * S, 0), target), math.min(1, dt * 6))
	camera.FieldOfView = 70 + math.clamp((speed - 8) * 1.5, 0, 12)

	-- HUD.
	meterFill.Size = UDim2.new(tFrac, 0, 1, 0)
	loadedTag.Visible = r.mode == "waterTrickLoad"
	local live = Sim.Session.liveCombo(run)
	local total = run.points + (if live then live.total else 0)
	local statusText = if run.finished then `Run over ({run.endReason}): judges {run.score and run.score.total or 0}. Enter to restart` else ""
	status.Text = `  {total} pts   best combo {run.bestCombo}   pass {run.pass + 1}/{sim.cfg.run.passesPerRun}   crashes {#run.crashes}/{sim.cfg.run.maxFalls}\n  {math.floor(speed * 3.6)} km/h   {r.mode}   {statusText}`
	if run.combo and live then
		feed.Text = `{Sim.ScoringCombo.comboName(run.combo.entries)}   x{string.format("%.2f", live.multiplier)} = {live.total}`
	elseif lastCrash ~= "" and r.mode == "crashed" then
		feed.Text = `Crash: {lastCrash}`
	else
		feed.Text = lastTrick
	end
	local rot = if r.air then r.air.rot elseif r.jib then r.jib.rot else nil
	if rot and rot.spinSide and r.handle == "inFront" and rot.passTimer == 0 then
		local w = Sim.Handle.passWindowOf(rot, { rate = sim.cfg.spin.rate, inAir = r.air ~= nil })
		local p = Sim.Handle.handleProgress(rot)
		prompt.Visible = w ~= nil and p > w.zone.start - 0.6
		prompt.Text = if w and math.abs(p - w.centre) <= w.half then "PASS NOW (Q)" else "Handle pass: Q"
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
			`Handle    {r.handle}`,
			`Last crash {r.lastCrash or "none"}`,
		}, "\n")
	end
end)
