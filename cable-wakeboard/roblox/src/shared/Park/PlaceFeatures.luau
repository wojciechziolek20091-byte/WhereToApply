--!strict
-- placeFeatures (layout spec section 1.4): Park/Layout entries to the sim's
-- feature defs, from the cable path: each feature's centre at
-- `alongFraction` of its straight and `sideOffset` off the line, turned
-- `angleIn` degrees toward the cable at the exit. Move the towers and the
-- layout follows. Twin of placeFeatures in src/sim/parkLayout.ts (bit-exact:
-- DetMath; tests/layout.test.ts compares them).
--
--   local defs = PlaceFeatures.place(Layout.MAIN, cable)
--   ParkBuilder.buildPark(PlaceFeatures.withLayout(Sim.ParkLayout.WAKE_PARK, Layout.MAIN))
local Sim = require(script.Parent.Parent.Sim)
local Layout = require(script.Parent.Layout)

local PlaceFeatures = {}

local function round(v: number, k: number): number
	-- Math.round: halves up.
	return math.floor(v * k + 0.5) / k
end

-- The cable in the configured direction of travel: clockwise reverses the towers (tower 1 stays first).
function PlaceFeatures.travelCable(cable: any, direction: string?): any
	local dir = direction or Layout.RULES.direction
	if dir == "CounterClockwise" or cable.mode == "twoTower" then
		return cable
	end
	local c = table.clone(cable)
	local t = { cable.towers[1] }
	for i = #cable.towers, 2, -1 do
		table.insert(t, cable.towers[i])
	end
	c.towers = t
	return c
end

-- Start and length of each straight, in order of travel.
function PlaceFeatures.straights(cable: any): { { s0: number, length: number } }
	local path = Sim.Cable.buildCablePath(cable)
	if path.shuttle then
		return { { s0 = 0, length = path.segments[1].length } }
	end
	local out = {}
	for _, g in path.segments do
		if g.kind == "line" then
			table.insert(out, { s0 = g.s0, length = g.length })
		end
	end
	return out
end

-- The full cable config (the config's, with the park's own over it).
function PlaceFeatures.cableOf(park: any): any
	local c = table.clone(Sim.Config.DEFAULT_CONFIG.cable)
	for k, v in park.cable or {} do
		c[k] = v
	end
	return c
end

function PlaceFeatures.place(entries: { any }, cable: any, rules: any?): { any }
	local r = rules or Layout.RULES
	local straights = PlaceFeatures.straights(PlaceFeatures.travelCable(cable, r.direction))
	local defs = {}
	for _, e in entries do
		local st = straights[e.straight]
		assert(st, `{e.featureId}: no straight {e.straight}`)
		local shape = Sim.FeatureShapes.buildShape(e.type, e.params, e.partSide or 1)
		local half = (shape.uMax - shape.uMin) / 2
		local vMid = (shape.vMin + shape.vMax) / 2
		local sideSign = if e.side == "R" then 1 else -1
		local a = e.angleIn * math.pi / 180
		local yaw = -sideSign * a
		local centreS = st.s0 + e.alongFraction * st.length
		local centreLat = sideSign * e.sideOffset - vMid
		local def: any = {
			kind = "feature",
			id = e.featureId,
			name = e.name or Sim.FeatureCatalog.FEATURE_CATALOG[e.type].meta.label,
			catalog = e.type,
			params = e.params,
			s = round(centreS - half * Sim.DetMath.cos(a), 100),
			offset = round(centreLat + sideSign * half * Sim.DetMath.sin(a), 100),
			yaw = round(yaw, 10000),
			side = e.partSide,
			accent = e.accent or "Orange",
			line = `S{e.straight}`,
		}
		table.insert(defs, def)
	end
	return defs
end

-- A park with its features re-placed from layout entries (e.g. after editing Park/Layout in Studio).
function PlaceFeatures.withLayout(park: any, entries: { any }): any
	local p = table.clone(park)
	p.features = PlaceFeatures.place(entries, PlaceFeatures.cableOf(park))
	return p
end

return PlaceFeatures
