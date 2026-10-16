-- FeatureModel under the Roblox mock: structure, attributes, tags, collision
-- groups (features spec sections 3 and 4.1). Appended to a shared bundle with
-- Park/ and Sim/; prints FEATURE MODEL OK.
local FeatureConfig = require(__root.Park.FeatureConfig)
local FeatureModel = require(__root.Park.FeatureModel)
local CollectionService = game:GetService("CollectionService")
local PhysicsService = game:GetService("PhysicsService")

local function check(cond, msg)
	if not cond then error("FAIL: " .. msg, 2) end
end

FeatureModel.setupCollisionGroups()
local G = FeatureConfig.CollisionGroups
check(PhysicsService:CollisionGroupsAreCollidable(G.Rider, G.Ride), "rider collides with ride surfaces")
check(not PhysicsService:CollisionGroupsAreCollidable(G.Rider, G.Visual), "rider passes through visuals")
check(not PhysicsService:CollisionGroupsAreCollidable(G.Rider, G.Crash), "crash volumes are query-only")
check(not PhysicsService:CollisionGroupsAreCollidable(G.Visual, G.Ride), "visual / ride do not collide")

local folder = FeatureModel.featuresFolder()
check(folder.Name == "Features" and folder.Parent.Name == "Park" and folder.Parent.Parent == workspace, "Workspace.Park.Features")
check(FeatureModel.featuresFolder() == folder, "featuresFolder is idempotent")

local n = 0
for name, entry in FeatureConfig.Catalog do
	n += 1
	local meta = entry.meta
	local m = FeatureModel.new({
		id = "T_" .. name, name = meta.label, catalog = name, featureType = meta.type, difficulty = meta.difficulty,
		safetyMode = "Flush", lipHeight = entry.params.lipHeight, lipAngle = entry.params.lipAngle,
		material = meta.material, friction = FeatureConfig.Common.friction[meta.material], allowedSlides = meta.allowedSlides,
		bidirectional = meta.bidirectional, tag = meta.tag, origin = Vector3.new(10, 0, -4), heading = 0.7,
	})
	m.Parent = folder
	check(m.PrimaryPart and m.PrimaryPart.Name == "Root", name .. ": PrimaryPart = Root")
	check(m.ModelStreamingMode == Enum.ModelStreamingMode.Atomic, name .. ": atomic streaming")
	for _, f in FeatureConfig.Folders do
		check(m:FindFirstChild(f) and m:FindFirstChild(f).ClassName == "Folder", name .. ": folder " .. f)
	end
	for _, a in { "FeatureId", "FeatureType", "Difficulty", "SafetyMode", "SurfaceMaterial", "Friction", "ScoreMultiplier", "AllowedSlides", "Bidirectional" } do
		check(m:GetAttribute(a) ~= nil, name .. ": attribute " .. a)
	end
	check(m:GetAttribute("ScoreMultiplier") == FeatureConfig.Common.scoreMultiplier[meta.difficulty], name .. ": multiplier")
	if meta.type == "Kicker" and entry.params.lipHeight then
		check(math.abs(m:GetAttribute("LipHeight") - entry.params.lipHeight * 3.57) < 1e-9, name .. ": LipHeight in studs")
	end
	check(CollectionService:HasTag(m, "ParkFeature"), name .. ": ParkFeature tag")
	check(CollectionService:HasTag(m, meta.tag), name .. ": category tag")
	-- Root faces along the feature: LookVector = forwardOf(heading).
	local look = m.PrimaryPart.CFrame.LookVector
	check(math.abs(look.X - math.cos(0.7)) < 1e-9 and math.abs(look.Z - math.sin(0.7)) < 1e-9, name .. ": Root faces +u")
	-- Folder rules on parts.
	local ride = FeatureModel.part(m, "Ride", "Seg", Vector3.new(1, 1, 1), CFrame.new(FeatureModel.offset(2, 0, 0.5)))
	check(ride.CanCollide and ride.CanQuery and ride.CollisionGroup == G.Ride and ride.Anchored, name .. ": ride part rules")
	local vis = FeatureModel.part(m, "Visual", "Art", Vector3.new(1, 1, 1), CFrame.new())
	check(not vis.CanCollide and not vis.CanQuery and vis.CollisionGroup == G.Visual, name .. ": visual part rules")
	local crash = FeatureModel.part(m, "Crash", "Vol", Vector3.new(1, 1, 1), CFrame.new())
	check(not crash.CanCollide and crash.CanQuery and crash.CanTouch and crash.CollisionGroup == G.Crash, name .. ": crash part rules")
	-- offset(u, v, h): +u is along LookVector, +v along RightVector.
	local p = m.PrimaryPart.CFrame:PointToWorldSpace(FeatureModel.offset(1, 2, 3))
	local o = Vector3.new(10, 0, -4) * 3.57
	local want = o + look * 3.57 + m.PrimaryPart.CFrame.RightVector * 2 * 3.57 + Vector3.new(0, 3 * 3.57, 0)
	check((p - want).Magnitude < 1e-9, name .. ": local offsets")
end
check(n == 15, "15 catalogue features")
check(#CollectionService:GetTagged("ParkFeature") == 15, "15 tagged features")
print("FEATURE MODEL OK")
