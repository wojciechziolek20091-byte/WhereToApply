--!strict
--[[
	Showcase: builds the dusk scene and one rider per palette on a flat lake,
	so the style can be judged in Studio. Delete this script once the game
	places riders itself.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local shared = ReplicatedStorage:WaitForChild("WakeShared")
local RiderBuilder = require(shared:WaitForChild("RiderBuilder"))
local DuskLighting = require(shared:WaitForChild("DuskLighting"))
local WaterSpray = require(shared:WaitForChild("WaterSpray"))

local rgb = Color3.fromRGB

DuskLighting.apply()

local old = workspace:FindFirstChild("WakeShowcase")
if old then
	old:Destroy()
end
local folder = Instance.new("Folder")
folder.Name = "WakeShowcase"
folder.Parent = workspace

-- Flat-shaded lake: one big slab, plus a few faceted shoreline rocks.
local lake = Instance.new("Part")
lake.Name = "Lake"
lake.Anchored = true
lake.Size = Vector3.new(600, 1, 600)
lake.CFrame = CFrame.new(0, -0.5, 0)
lake.Color = rgb(108, 120, 196) -- dusk water: blue with a violet cast
lake.Material = Enum.Material.SmoothPlastic
lake.Reflectance = 0.08
lake.Parent = folder

local rng = Random.new(3)
for i = 1, 14 do
	local rock = Instance.new(if i % 2 == 0 then "WedgePart" else "Part")
	rock.Name = `Rock{i}`
	rock.Anchored = true
	rock.Size = Vector3.new(rng:NextNumber(4, 10), rng:NextNumber(2, 7), rng:NextNumber(4, 10))
	local a = (i / 14) * math.pi * 2
	rock.CFrame = CFrame.new(math.cos(a) * 70, 0.5, math.sin(a) * 70 - 20)
		* CFrame.Angles(rng:NextNumber(-0.3, 0.3), rng:NextNumber(0, math.pi * 2), rng:NextNumber(-0.3, 0.3))
	rock.Color = rgb(96, 74, 120):Lerp(rgb(150, 110, 150), rng:NextNumber())
	rock.Material = Enum.Material.SmoothPlastic
	rock.Parent = folder
end

-- One rider per palette, side by side, angled to show the faceting.
for i, name in RiderBuilder.paletteNames() do
	local rider = RiderBuilder.build({ palette = name, name = `Rider{name}`, seed = 10 + i })
	rider:PivotTo(CFrame.new((i - 2) * 8, 0.02, 0) * CFrame.Angles(0, math.rad(-35), 0))
	rider.Parent = folder
	local spray = WaterSpray.attach(rider)
	WaterSpray.setIntensity(spray, 0.6)
end

-- Point the camera at the line-up when testing in Studio (Play mode).
local camPart = Instance.new("Part")
camPart.Name = "CameraTarget"
camPart.Anchored = true
camPart.Transparency = 1
camPart.CanCollide = false
camPart.Size = Vector3.new(1, 1, 1)
camPart.CFrame = CFrame.lookAt(Vector3.new(4, 5, 18), Vector3.new(0, 2.5, 0))
camPart.Parent = folder
