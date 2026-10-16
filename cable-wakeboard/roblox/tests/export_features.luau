-- Exports the visible parts of every feature in SPECS (defined before this
-- chunk by scripts/export-feature-art.ts) as compact JSON for the web game:
-- { [key]: { parts = rows, count = n } }. Rows are Root-relative, in studs:
-- [shape, sx,sy,sz, px,py,pz, rx,ry,rz, ux,uy,uz, bx,by,bz, r,g,b].
local FeatureBuilder = require(__root.Park.FeatureBuilder)
local FeatureModel = require(__root.Park.FeatureModel)
local SHAPES = { Block = 0, WedgePart = 1, CornerWedgePart = 2, Ball = 3, Cylinder = 4 }
local function n(x)
	return string.format("%.4f", x)
end
local out = {}
for _, spec in SPECS do
	local model = FeatureBuilder.build({
		id = spec.key, catalog = spec.catalog, params = spec.params, side = spec.side, accent = spec.accent,
		origin = Vector3.new(0, 0, 0), heading = 0,
	})
	local inv = model.PrimaryPart.CFrame:Inverse()
	local rows = {}
	for _, folderName in { "Visual", "Signage" } do
		for _, d in model:FindFirstChild(folderName):GetDescendants() do
			-- See-through parts (foam) are left out: the web mesh has no transparency.
			if d:IsA("BasePart") and (d.Transparency or 0) < 0.3 then
				local shape = if d.ClassName == "Part" then SHAPES[d.Shape.Name] else SHAPES[d.ClassName]
				local c = inv * d.CFrame
				table.insert(rows, "[" .. table.concat({
					tostring(shape), n(d.Size.X), n(d.Size.Y), n(d.Size.Z),
					n(c.p.X), n(c.p.Y), n(c.p.Z),
					n(c.r.X), n(c.r.Y), n(c.r.Z), n(c.u.X), n(c.u.Y), n(c.u.Z), n(c.b.X), n(c.b.Y), n(c.b.Z),
					n(d.Color.R), n(d.Color.G), n(d.Color.B),
				}, ",") .. "]")
			end
		end
	end
	table.insert(out, `"{spec.key}":\{"count":{FeatureModel.partCount(model)},"parts":[` .. table.concat(rows, ",") .. "]}")
end
print("{" .. table.concat(out, ",") .. "}")
