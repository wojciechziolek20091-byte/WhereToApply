--[[
	WakeClient: plays the Luau sim in Studio (StarterPlayerScripts).

	A thin, deliberately simple client. All game logic is in
	ReplicatedStorage.WakeShared.Sim, which is the same code as the web game
	(checked tick for tick by tests/parity.test.ts). This script only:
	  - reads the keyboard into an InputFrame (WakeInput, same keys as the web),
	  - runs Sim.Session.stepRun at a fixed 60 Hz,
	  - builds a gray-box park from the sim's cable and features,
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

-- Park: water, cable loop, towers, kickers and sliders, from the sim's own data.
local function buildPark(sim)
	part("Water", Vector3.new(2048, 1, 2048), CFrame.new(0, -0.5, 0), Color3.fromRGB(54, 120, 168))
	local path = sim.path
	local step = 3
	local prev = Sim.Cable.cablePointAt(path, 0).pos
	for s = step, path.length + step, step do
		local p = Sim.Cable.cablePointAt(path, math.min(s, path.length)).pos
		local a, c = stud(prev) + Vector3.new(0, path.height * S, 0), stud(p) + Vector3.new(0, path.height * S, 0)
		part("Cable", Vector3.new(0.15, 0.15, (c - a).Magnitude), CFrame.lookAt((a + c) / 2, c), Color3.fromRGB(30, 30, 34))
		prev = p
	end
	for i, t in sim.cfg.cable.towers do
		local h = (path.height + 1) * S
		part(`Tower{i}`, Vector3.new(2, h, 2), CFrame.new(t.x * S, h / 2, t.z * S), Color3.fromRGB(70, 70, 78))
	end
	for _, f in sim.features do
		local d = f.def
		local length = Sim.Park.featureLength(d)
		local mid = Sim.Vec.addScaled(f.origin, Sim.Vec.forwardOf(f.heading), length / 2)
		if d.kind == "kicker" then
			-- A wedge rises toward its +Z face; turn +Z onto the sim heading so it rises along travel.
			local cf = CFrame.new(stud(mid) + Vector3.new(0, d.height * S / 2, 0)) * yaw(f.heading) * CFrame.Angles(0, math.pi / 2, 0)
			part(d.id, Vector3.new(d.width * S, d.height * S, length * S), cf, Color3.fromRGB(230, 230, 222), "WedgePart")
		else
			local cf = CFrame.new(stud(mid) + Vector3.new(0, d.height * S / 2, 0)) * yaw(f.heading)
			part(d.id, Vector3.new(length * S, d.height * S, d.width * S), cf, Color3.fromRGB(200, 205, 215))
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
