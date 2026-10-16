--!strict
-- Park map data and a simple top-down map (spec section 11): every feature's
-- icon, difficulty, line and position, listed by line; FeatureMap.mount
-- draws it as a ScreenGui (toggle with FeatureMap.toggle).
local FeatureConfig = require(script.Parent.FeatureConfig)
local FeatureRegistry = require(script.Parent.FeatureRegistry)

local FeatureMap = {}

local S = FeatureConfig.StudsPerMetre

export type MapEntry = { id: string, name: string, line: string, icon: string, difficulty: number, x: number, z: number }

-- Map entries (metres) for the indexed features, sorted by line then position along it.
function FeatureMap.entries(): { MapEntry }
	local out: { MapEntry } = {}
	for _, m in FeatureRegistry.all() do
		local catalog = m:GetAttribute("CatalogName") :: string
		local entry = (FeatureConfig.Catalog :: any)[catalog]
		local root = (m.PrimaryPart :: BasePart).CFrame.Position / S
		table.insert(out, {
			id = m:GetAttribute("FeatureId") :: string,
			name = (m:GetAttribute("FeatureName") :: string?) or catalog,
			line = (m:GetAttribute("Line") :: string?) or "",
			icon = if entry then entry.meta.icon else "box",
			difficulty = (m:GetAttribute("Difficulty") :: number?) or 1,
			x = root.X,
			z = root.Z,
		})
	end
	table.sort(out, function(a, b)
		if a.line ~= b.line then
			return a.line < b.line
		end
		return a.id < b.id
	end)
	return out
end

-- Features grouped by line: { { line = "Line 1", features = {...} }, ... }.
function FeatureMap.byLine(): { { line: string, features: { MapEntry } } }
	local groups, order = {}, {}
	for _, e in FeatureMap.entries() do
		if not groups[e.line] then
			groups[e.line] = {}
			table.insert(order, e.line)
		end
		table.insert(groups[e.line], e)
	end
	local out = {}
	for _, line in order do
		table.insert(out, { line = line, features = groups[line] })
	end
	return out
end

local ICON_TEXT = { kicker = "^", box = "#", rail = "=", kink = "/", wall = "|", air = "A" }

-- A top-down map: dots coloured by difficulty, a list by line. Returns the ScreenGui.
function FeatureMap.mount(parent: Instance, site: any?): ScreenGui
	local gui = Instance.new("ScreenGui")
	gui.Name = "ParkMap"
	gui.Enabled = false
	gui.ResetOnSpawn = false
	local frame = Instance.new("Frame")
	frame.Name = "Map"
	frame.Size = UDim2.fromOffset(300, 420)
	frame.Position = UDim2.new(1, -320, 0, 20)
	frame.BackgroundColor3 = Color3.fromRGB(20, 40, 52)
	frame.BackgroundTransparency = 0.15
	frame.Parent = gui
	local entries = FeatureMap.entries()
	-- Bounds of the lake (or the features) to fit the map.
	local xs, zs = {}, {}
	for _, p in (if site then site.lake else {}) do
		table.insert(xs, p.x)
		table.insert(zs, p.z)
	end
	for _, e in entries do
		table.insert(xs, e.x)
		table.insert(zs, e.z)
	end
	local x0, x1 = math.min(table.unpack(xs)), math.max(table.unpack(xs))
	local z0, z1 = math.min(table.unpack(zs)), math.max(table.unpack(zs))
	local scale = math.min(280 / math.max(x1 - x0, 1), 280 / math.max(z1 - z0, 1))
	for _, e in entries do
		local dot = Instance.new("TextLabel")
		dot.Name = e.id
		dot.Size = UDim2.fromOffset(14, 14)
		dot.Position = UDim2.fromOffset(10 + (e.x - x0) * scale - 7, 10 + (e.z - z0) * scale - 7)
		dot.BackgroundColor3 = FeatureConfig.difficultyColor(e.difficulty)
		dot.Text = (ICON_TEXT :: any)[e.icon] or "?"
		dot.TextColor3 = Color3.new(1, 1, 1)
		dot.TextScaled = true
		dot.Parent = frame
	end
	local list = Instance.new("TextLabel")
	list.Name = "List"
	list.BackgroundTransparency = 1
	list.Position = UDim2.fromOffset(10, 300)
	list.Size = UDim2.fromOffset(280, 110)
	list.TextXAlignment = Enum.TextXAlignment.Left
	list.TextYAlignment = Enum.TextYAlignment.Top
	list.TextColor3 = Color3.new(1, 1, 1)
	list.TextSize = 12
	local lines = {}
	for _, g in FeatureMap.byLine() do
		local names = {}
		for _, f in g.features do
			table.insert(names, f.name)
		end
		table.insert(lines, `{g.line}: {table.concat(names, ", ")}`)
	end
	list.Text = table.concat(lines, "\n")
	list.Parent = frame
	gui.Parent = parent
	return gui
end

function FeatureMap.toggle(gui: ScreenGui)
	gui.Enabled = not gui.Enabled
end

return FeatureMap
