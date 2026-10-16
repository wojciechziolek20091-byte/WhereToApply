--!strict
-- The structure every generated feature shares (features spec section 3):
--
--   Park/Features/<FeatureId>  Model, PrimaryPart = Root, ModelStreamingMode Atomic
--     Root      invisible anchored part: the feature's origin and facing
--     Visual/   art; CanCollide / CanQuery off, group FeatureVisual
--     Ride/     ride surfaces; CanCollide / CanQuery on, group FeatureRide
--     Crash/    crash volumes; CanCollide off, CanQuery / CanTouch on, group FeatureCrash
--     Approach/ approach attachments
--     Signage/  sign post
--     FX/       effect attachments
--
-- plus the tags (ParkFeature and the category tag Kicker / Obstacle) and the
-- model attributes of spec 4.1. The riding itself is the sim's (Sim/
-- FeatureShapes): Ride/ parts are built from the same pieces, so they are
-- what the sim rides, for queries, the registry and the art to line up with.
--
-- Frames: a feature's local (u, v, h) in metres is u along its axis, v to
-- its right, h above the water. The Root's LookVector is +u, RightVector +v.
local CollectionService = game:GetService("CollectionService")
local PhysicsService = game:GetService("PhysicsService")

local FeatureConfig = require(script.Parent.FeatureConfig)

local FeatureModel = {}

local S = FeatureConfig.StudsPerMetre
local G = FeatureConfig.CollisionGroups

export type FolderName = "Visual" | "Ride" | "Crash" | "Approach" | "Signage" | "FX"

export type FeatureInfo = {
	id: string,
	name: string,
	catalog: string,
	featureType: string,
	difficulty: number,
	safetyMode: string,
	lipHeight: number?,
	lipAngle: number?,
	material: string,
	friction: number,
	allowedSlides: string,
	bidirectional: boolean,
	tag: string,
	-- World position of the feature's origin on the water (metres) and its heading (rad, sim convention).
	origin: Vector3,
	heading: number,
}

-- Collision groups: the rider only collides with ride surfaces; crash volumes are queried.
function FeatureModel.setupCollisionGroups()
	local groups = { G.Ride, G.Visual, G.Crash, G.Rider }
	for _, g in groups do
		if not PhysicsService:IsCollisionGroupRegistered(g) then
			PhysicsService:RegisterCollisionGroup(g)
		end
	end
	local all = table.clone(groups)
	table.insert(all, "Default")
	for _, a in all do
		for _, b in groups do
			PhysicsService:CollisionGroupSetCollidable(a, b, false)
		end
	end
	for _, pair in FeatureConfig.Collidable do
		PhysicsService:CollisionGroupSetCollidable(pair[1], pair[2], true)
	end
end

-- Root CFrame (studs) for a feature at `origin` (metres) with sim heading `psi`:
-- LookVector along the feature, RightVector to its right, Y up.
function FeatureModel.rootCFrame(origin: Vector3, psi: number): CFrame
	local fwd = Vector3.new(math.cos(psi), 0, math.sin(psi))
	local right = Vector3.new(-math.sin(psi), 0, math.cos(psi))
	return CFrame.fromMatrix(origin * S, right, Vector3.new(0, 1, 0), -fwd)
end

-- Feature-local metres (u along, v right, h up) to a Root-relative offset in studs.
function FeatureModel.offset(u: number, v: number, h: number): Vector3
	return Vector3.new(v * S, h * S, -u * S)
end

-- Root-relative CFrame (studs) at local (u, v, h) whose LookVector points along `dir`
-- (a local direction in metres: du, dv, dh) with `up` roughly up.
function FeatureModel.localFrame(u: number, v: number, h: number, du: number, dv: number, dh: number, up: Vector3?): CFrame
	local look = Vector3.new(dv, dh, -du).Unit
	local upHint = up or Vector3.new(0, 1, 0)
	local right = look:Cross(upHint).Unit
	local newUp = right:Cross(look).Unit
	return CFrame.fromMatrix(FeatureModel.offset(u, v, h), right, newUp, -look)
end

local FOLDER_RULES: { [string]: { group: string, collide: boolean, query: boolean, touch: boolean } } = {
	Visual = { group = G.Visual, collide = false, query = false, touch = false },
	Ride = { group = G.Ride, collide = true, query = true, touch = false },
	Crash = { group = G.Crash, collide = false, query = true, touch = true },
	Approach = { group = G.Visual, collide = false, query = false, touch = false },
	Signage = { group = G.Visual, collide = false, query = false, touch = false },
	FX = { group = G.Visual, collide = false, query = false, touch = false },
}

-- Apply a folder's collision rules to a part (anchored, group, collide / query / touch).
function FeatureModel.applyRules(p: BasePart, folder: string)
	local r = FOLDER_RULES[folder]
	assert(r, "unknown feature folder " .. folder)
	p.Anchored = true
	p.CollisionGroup = r.group
	p.CanCollide = r.collide
	p.CanQuery = r.query
	p.CanTouch = r.touch
	p.CastShadow = folder == "Visual" or folder == "Signage"
	if folder == "Ride" or folder == "Crash" then
		p.Transparency = 1
	end
end

-- Empty feature model with its Root, folders, attributes and tags.
function FeatureModel.new(info: FeatureInfo): Model
	local model = Instance.new("Model")
	model.Name = info.id
	model.ModelStreamingMode = Enum.ModelStreamingMode.Atomic

	local root = Instance.new("Part")
	root.Name = "Root"
	root.Size = Vector3.new(1, 1, 1)
	root.Transparency = 1
	root.Anchored = true
	root.CanCollide = false
	root.CanQuery = false
	root.CanTouch = false
	root.CollisionGroup = G.Visual
	root.CFrame = FeatureModel.rootCFrame(info.origin, info.heading)
	root.Parent = model
	model.PrimaryPart = root

	for _, name in FeatureConfig.Folders do
		local f = Instance.new("Folder")
		f.Name = name
		f.Parent = model
	end

	local scoreMultiplier = FeatureConfig.Common.scoreMultiplier[info.difficulty]
	model:SetAttribute("FeatureId", info.id)
	model:SetAttribute("FeatureName", info.name)
	model:SetAttribute("CatalogName", info.catalog)
	model:SetAttribute("FeatureType", info.featureType)
	model:SetAttribute("Difficulty", info.difficulty)
	model:SetAttribute("SafetyMode", info.safetyMode)
	if info.lipHeight then
		model:SetAttribute("LipHeight", info.lipHeight * S)
	end
	if info.lipAngle then
		model:SetAttribute("LipAngle", info.lipAngle)
	end
	model:SetAttribute("SurfaceMaterial", info.material)
	model:SetAttribute("Friction", info.friction)
	model:SetAttribute("ScoreMultiplier", scoreMultiplier)
	model:SetAttribute("AllowedSlides", info.allowedSlides)
	model:SetAttribute("Bidirectional", info.bidirectional)
	model:SetAttribute("Heading", info.heading)

	CollectionService:AddTag(model, FeatureConfig.Tags.All)
	CollectionService:AddTag(model, info.tag)
	return model
end

-- A child folder of a feature model.
function FeatureModel.folder(model: Model, name: FolderName): Folder
	local f = model:FindFirstChild(name)
	assert(f and f:IsA("Folder"), "feature model has no folder " .. name)
	return f :: Folder
end

-- An anchored part in one of a model's folders, placed Root-relative (studs).
function FeatureModel.part(model: Model, folderName: FolderName, name: string, size: Vector3, rel: CFrame, className: string?): BasePart
	local p = Instance.new((className or "Part") :: any) :: BasePart
	p.Name = name
	p.Size = size
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	FeatureModel.applyRules(p, folderName)
	local root = model.PrimaryPart :: BasePart
	p.CFrame = root.CFrame * rel
	p.Parent = FeatureModel.folder(model, folderName)
	return p
end

-- An attachment on the Root, in a folder-like grouping: attachments must live
-- under a part, so Approach / FX attachments sit on small invisible anchors in
-- their folder.
function FeatureModel.anchorFor(model: Model, folderName: FolderName): BasePart
	local folder = FeatureModel.folder(model, folderName)
	local existing = folder:FindFirstChild("Anchor")
	if existing then
		return existing :: BasePart
	end
	local root = model.PrimaryPart :: BasePart
	local a = Instance.new("Part")
	a.Name = "Anchor"
	a.Size = Vector3.new(0.2, 0.2, 0.2)
	a.Transparency = 1
	FeatureModel.applyRules(a, folderName)
	a.CFrame = root.CFrame
	a.Parent = folder
	return a
end

function FeatureModel.attachment(parent: Instance, name: string, cf: CFrame): Attachment
	local a = Instance.new("Attachment")
	a.Name = name
	a.CFrame = cf
	a.Parent = parent
	return a
end

-- Count of BaseParts under a model (spec target: under FeatureConfig.Validator.MaxParts).
function FeatureModel.partCount(model: Model): number
	local n = 0
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") then
			n += 1
		end
	end
	return n
end

-- Workspace.Park.Features, created if missing.
function FeatureModel.featuresFolder(): Folder
	local park = workspace:FindFirstChild(FeatureConfig.ParkFolder)
	if not park then
		park = Instance.new("Folder")
		park.Name = FeatureConfig.ParkFolder
		park.Parent = workspace
	end
	local features = (park :: Instance):FindFirstChild(FeatureConfig.FeaturesFolder)
	if not features then
		features = Instance.new("Folder")
		features.Name = FeatureConfig.FeaturesFolder
		features.Parent = park
	end
	return features :: Folder
end

return FeatureModel
