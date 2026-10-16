-- Prints every catalogue shape's pieces and a grid of surface samples, one
-- tab-separated row per line, for tests/featureModel.test.ts to compare with
-- the TypeScript twin (src/sim/featureShapes.ts). Appended to the Sim bundle.
local function fmt(v)
	if type(v) == "number" then
		return string.format("%.17g", v)
	end
	return tostring(v)
end
local function emit(row)
	local out = {}
	for i, v in row do
		out[i] = fmt(v)
	end
	print(table.concat(out, "\t"))
end
local names = {}
for name in Sim.FeatureCatalog.FEATURE_CATALOG do
	table.insert(names, name)
end
table.sort(names)
for _, name in names do
	for _, side in { 1, -1 } do
		local shape = Sim.FeatureShapes.buildShape(name, nil, side)
		emit({ name, side, shape.type, shape.uMin, shape.uMax, shape.vMin, shape.vMax, shape.safetyMode, shape.friction })
		for _, p in shape.pieces do
			emit({ "piece", p.index, p.role, p.part, p.axis, p.u0, p.u1, p.h0, p.h1, p.power, p.v0, p.v1, p.width, p.profile, p.radius, p.slide, p.lip, p.closed })
		end
		for i = 0, 40 do
			for j = 0, 12 do
				local u = shape.uMin + (shape.uMax - shape.uMin) * i / 40
				local v = shape.vMin + (shape.vMax - shape.vMin) * j / 12
				local s = Sim.FeatureShapes.shapeSurfaceAt(shape, u, v)
				if s then
					emit({ "s", i, j, s.piece.index, s.height, s.slope, s.crossSlope, s.normal.x, s.normal.y, s.normal.z, s.tangent.x, s.tangent.y, s.tangent.z })
				end
			end
		end
	end
end
