--!strict
-- buildPark (features spec section 9): builds a park's features into
-- Workspace.Park.Features from the sim's park def (Sim.ParkLayout.WAKE_PARK,
-- BEGINNER_PARK; made from Park/Layout), validates each one against
-- section 5 (rules and placement: cable reach, clearance from the other
-- features, the start dock and the buoys) and leaves out any that fail.
-- Running it again clears the folder and rebuilds the same thing.
--
--   local report = ParkBuilder.buildPark()            -- the default park
--   local report = ParkBuilder.buildPark(Sim.ParkLayout.BEGINNER_PARK)
local FeatureBuilder = require(script.Parent.FeatureBuilder)
local FeatureConfig = require(script.Parent.FeatureConfig)
local FeatureModel = require(script.Parent.FeatureModel)
local FeatureRegistry = require(script.Parent.FeatureRegistry)
local FeatureValidator = require(script.Parent.FeatureValidator)
local Layout = require(script.Parent.Layout)
local LayoutValidator = require(script.Parent.LayoutValidator)
local Sim = require(script.Parent.Parent.Sim)

local ParkBuilder = {}

export type BuildReport = {
	placed: { string },
	refused: { { id: string, failed: { string } } },
	reports: { FeatureValidator.Report },
}

-- The cable a park rides on (its own, or the config's).
function ParkBuilder.cableOf(park: any): any
	local cfg = Sim.Config.DEFAULT_CONFIG
	local cable = table.clone(cfg.cable)
	for k, v in park.cable or {} do
		cable[k] = v
	end
	return Sim.Cable.buildCablePath(cable)
end

-- Footprints of the site's docks and buoys (metres), for the clearance rule.
local function siteFootprints(park: any, path: any): { FeatureValidator.Footprint }
	local out = {}
	local site = park.site
	if not site then
		return out
	end
	for _, d in site.docks or {} do
		local a = Sim.Cable.cablePointAt(path, d.s)
		local b = Sim.Cable.cablePointAt(path, d.s + d.length)
		local ra, rb = Sim.Vec.rightOf(a.heading), Sim.Vec.rightOf(b.heading)
		table.insert(out, {
			name = d.name,
			a = Vector2.new(a.pos.x + ra.x * d.offset, a.pos.z + ra.z * d.offset),
			b = Vector2.new(b.pos.x + rb.x * d.offset, b.pos.z + rb.z * d.offset),
			half = d.width / 2,
		})
	end
	-- Buoys: boundary buoys 6 m from the approach line (layout spec 5); lane
	-- markers flank the line out of the dock 3.5 m either side by design, so
	-- 3 m. LayoutValidator keeps all of them out of the approach and run-out
	-- zones themselves.
	for i, p in site.buoys or {} do
		local def = site.buoyLayout and site.buoyLayout[i]
		local clearance = if def and def.kind == "Lane" then 3 else Layout.RULES.buoyClear
		table.insert(out, { name = `buoy {i}`, a = Vector2.new(p.x, p.z), b = Vector2.new(p.x, p.z), half = 0.6, clearance = clearance })
	end
	return out
end

local function specOf(def: any, f: any): FeatureBuilder.BuildSpec
	return {
		id = def.id, catalog = def.catalog, params = def.params, side = def.side, accent = def.accent, name = def.name,
		origin = Vector3.new(f.origin.x, 0, f.origin.z), heading = f.heading, offsetFromCable = def.offset, yaw = def.yaw,
		line = def.line,
	}
end

-- Back up the current park before a rebuild (layout spec, rule 1): clones
-- Workspace.Park (the features) and Workspace.WakePark (the client's towers,
-- cable and site) into ServerStorage/Backup_<date>. Run it from the server or
-- the Studio command bar (ServerStorage is not visible to clients). Returns
-- the backup folder, or nil when there is nothing to back up.
function ParkBuilder.backup(date: string?): Folder?
	local storage = game:GetService("ServerStorage")
	local name = "Backup_" .. (date or os.date("!%Y-%m-%d"))
	local found = false
	local folder = storage:FindFirstChild(name) or Instance.new("Folder")
	folder.Name = name
	for _, source in { FeatureConfig.ParkFolder, "WakePark" } do
		local inst = workspace:FindFirstChild(source)
		if inst then
			local old = folder:FindFirstChild(source)
			if old then
				old:Destroy()
			end
			inst:Clone().Parent = folder
			found = true
		end
	end
	if not found then
		return nil
	end
	folder.Parent = storage
	return folder :: Folder
end

-- Clear Workspace.Park.Features and build `park`'s catalogue features into it.
function ParkBuilder.buildPark(park: any?, quiet: boolean?): BuildReport
	local p = park or Sim.Park.DEFAULT_PARK
	local folder = FeatureModel.featuresFolder()
	folder:ClearAllChildren()
	FeatureRegistry.clear()
	FeatureModel.setupCollisionGroups()
	local path = ParkBuilder.cableOf(p)
	local resolved = Sim.Park.resolvePark(p, path)
	-- Build everything first (unparented) for the footprints, then validate.
	local built = {}
	for i, f in resolved do
		local def = f.def
		if def.kind == "feature" then
			table.insert(built, { def = def, model = FeatureBuilder.build(specOf(def, f)) })
		end
	end
	local site = siteFootprints(p, path)
	local feet = {}
	for i, b in built do
		feet[i] = FeatureValidator.footprint(b.model)
	end
	local report: BuildReport = { placed = {}, refused = {}, reports = {} }
	for i, b in built do
		local others = table.clone(site)
		for j, fp in feet do
			if j ~= i then
				table.insert(others, fp.foot)
			end
		end
		local r = FeatureValidator.validate(b.model, { cable = path, others = others, self = feet[i] })
		table.insert(report.reports, r)
		if r.ok then
			b.model.Parent = folder
			table.insert(report.placed, b.def.id)
		else
			local failed = {}
			for _, c in r.checks do
				if not c.pass then
					table.insert(failed, `{c.rule}: {c.detail}`)
				end
			end
			table.insert(report.refused, { id = b.def.id, failed = failed })
			b.model:Destroy()
			if not quiet then
				warn(`[buildPark] {b.def.id} not placed: {table.concat(failed, "; ")}`)
			end
		end
	end
	FeatureRegistry.init()
	for _, m in folder:GetChildren() do
		if m:IsA("Model") then
			FeatureRegistry.refresh(m :: Model)
		end
	end
	if not quiet then
		print(`[buildPark] {p.name}: {#report.placed} features placed, {#report.refused} refused`)
		ParkBuilder.layoutReport(p)
	end
	return report
end

-- The park's Park/Layout entries (the wake park's MAIN, the beginner line's BEGINNER), if it has them.
function ParkBuilder.layoutOf(park: any): ({ any }?, boolean)
	if park.name == Sim.ParkLayout.WAKE_PARK.name then
		return Layout.MAIN, false
	elseif park.name == Sim.ParkLayout.BEGINNER_PARK.name then
		return Layout.BEGINNER, true
	end
	return nil, false
end

-- Print the LayoutValidator table (layout spec 1.5) and the ride-data check
-- for a built park. Returns true when every row passes.
function ParkBuilder.layoutReport(park: any): boolean
	local entries, beginner = ParkBuilder.layoutOf(park)
	if not entries then
		return true
	end
	local rows = LayoutValidator.validate(park, entries, nil, beginner)
	for _, r in LayoutValidator.rideData(park, entries, FeatureModel.featuresFolder()) do
		table.insert(rows, r)
	end
	LayoutValidator.print(rows)
	for _, r in rows do
		if not r.pass then
			warn(`[layout] {r.feature} {r.rule}: {r.value} (limit {r.limit})`)
		end
	end
	for _, r in rows do
		if not r.pass then
			return false
		end
	end
	return true
end

return ParkBuilder
