-- FeatureBob under the mock: Visual parts bob within +-3 cm; Ride/ never moves;
-- near a rider the bob eases to rest. Prints FEATURE BOB OK.
local FeatureBuilder = require(__root.Park.FeatureBuilder)
local FeatureBob = require(__root.Park.FeatureBob)
local FeatureModel = require(__root.Park.FeatureModel)
local S = 3.57
local function check(cond, msg) if not cond then error("FAIL: " .. msg, 2) end end

local m = FeatureBuilder.build({ id = "bob", catalog = "Funbox", origin = Vector3.new(20, 0, 5), heading = 0.4 })
m.Parent = FeatureModel.featuresFolder()
local rideBefore = {}
for _, p in m:FindFirstChild("Ride"):GetChildren() do rideBefore[p] = p.CFrame.Position end
local top = m:FindFirstChild("Visual"):FindFirstChild("TopSheet")
local rest = top.CFrame.Position
FeatureBob.attach(m)
local far = { Vector3.new(1000, 0, 1000) }
local maxOff = 0
for i = 1, 600 do
	FeatureBob.step(i / 60, far)
	maxOff = math.max(maxOff, math.abs(FeatureBob.offsetOf(m)))
end
check(maxOff > 0.025 and maxOff <= 0.03 + 1e-9, string.format("bob amplitude %.4f m", maxOff))
check(math.abs((top.CFrame.Position - rest).Y / S - FeatureBob.offsetOf(m)) < 1e-6, "Visual parts follow the bob")
for p, pos in rideBefore do check((p.CFrame.Position - pos).Magnitude < 1e-9, "Ride parts never move") end
-- A rider standing on it: the bob eases to rest.
local onIt = { m.PrimaryPart.CFrame:PointToWorldSpace(FeatureModel.offset(5, 0, 1)) }
for i = 601, 760 do FeatureBob.step(i / 60, onIt) end
check(math.abs(FeatureBob.offsetOf(m)) < 1e-6, "frozen near a rider: " .. FeatureBob.offsetOf(m))
check((top.CFrame.Position - rest).Magnitude < 1e-6, "back at rest")
print("FEATURE BOB OK")
