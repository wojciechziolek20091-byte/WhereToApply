--!strict
-- Feature names on approach (spec section 11): a small floating name and
-- difficulty tag over each feature's sign, shown when a rider is within
-- FeatureConfig.Approach.NameTagDistance (25 m) before the feature and
-- hidden after it. FeatureTags.enabled is the settings toggle.
local FeatureConfig = require(script.Parent.FeatureConfig)
local FeatureRegistry = require(script.Parent.FeatureRegistry)

local FeatureTags = {}

local S = FeatureConfig.StudsPerMetre

FeatureTags.enabled = true

local tags: { [Model]: BillboardGui } = {}

local function make(model: Model): BillboardGui?
	local signage = model:FindFirstChild("Signage")
	local board = signage and signage:FindFirstChild("SignBoard")
	if not board then
		return nil
	end
	local d = (model:GetAttribute("Difficulty") :: number?) or 1
	local gui = Instance.new("BillboardGui")
	gui.Name = "NameTag"
	gui.Size = UDim2.fromOffset(180, 44)
	gui.StudsOffset = Vector3.new(0, 4, 0)
	gui.AlwaysOnTop = true
	gui.Enabled = false
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundColor3 = FeatureConfig.difficultyColor(d)
	label.BackgroundTransparency = 0.1
	label.TextColor3 = Color3.new(1, 1, 1)
	label.TextScaled = true
	label.Text = `{(model:GetAttribute("FeatureName") :: string?) or model.Name}  {FeatureConfig.Difficulty[d].name}`
	label.Parent = gui
	gui.Parent = board
	return gui
end

-- Show tags for features the rider is approaching. `rider` in studs, `heading` the rider's travel (rad, sim convention).
function FeatureTags.step(rider: Vector3)
	for _, m in FeatureRegistry.all() do
		local tag = tags[m]
		if not tag then
			local made = make(m)
			if not made then
				continue
			end
			tags[m] = made
			tag = made
		end
		local root = (m.PrimaryPart :: BasePart).CFrame
		local o = root:PointToObjectSpace(rider)
		-- Root frame: -Z is along the feature, X across it.
		local before = o.Z / S
		local across = math.abs(o.X) / S
		local show = FeatureTags.enabled and before > 0 and before <= FeatureConfig.Approach.NameTagDistance and across < 15
		;(tag :: BillboardGui).Enabled = show
	end
end

function FeatureTags.isShown(model: Model): boolean
	local t = tags[model]
	return t ~= nil and t.Enabled
end

function FeatureTags.clear()
	for _, t in tags do
		t:Destroy()
	end
	table.clear(tags)
end

return FeatureTags
