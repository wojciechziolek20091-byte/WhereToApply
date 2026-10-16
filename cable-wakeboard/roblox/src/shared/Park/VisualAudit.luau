--!strict
-- VisualAudit (layout spec section 3): finds and counts visual bugs in built
-- feature models. Runs in Studio and under the mock (roblox/tests).
--
--   local r = VisualAudit.scan(workspace.Park.Features)
--   VisualAudit.print(r)
--
-- Checks (each finding names the feature and the part):
--   zFight        two visible block faces pointing the same way in the same
--                 plane (within `PlaneTol` studs) that overlap
--   waterFight    a visible horizontal face within `PlaneTol` of the water
--   decals        SurfaceGui / Decal / Texture / SurfaceAppearance instances
--   transparent   a part with 0 < Transparency < 1 overlapping another visible part
--   duplicate     two parts with the same class, size and CFrame
--   stray         a part outside the model's folders, or far from its Root
--   brokenAsset   a Sound / Decal / Texture / MeshPart with an empty asset id
--   tiny          a visible part under `TinySize` studs on its largest side
--   material      a visible part whose material or colour is not in `allowed`
local VisualAudit = {}

local PlaneTol = 0.01
local TinySize = 0.25
local StrayDistance = 40 * 3.57

export type Finding = { check: string, feature: string, part: string, detail: string }
export type Report = { findings: { Finding }, counts: { [string]: number }, parts: number, features: number }

type Face = { n: Vector3, d: number, c: Vector3, a: Vector3, b: Vector3, ha: number, hb: number }

-- The six faces of a block part: normal, plane offset, centre, in-plane axes and half extents.
local function faces(p: BasePart): { Face }
	local cf, s = p.CFrame, p.Size
	local axes = { { cf.RightVector, s.X / 2 }, { cf.UpVector, s.Y / 2 }, { -cf.LookVector, s.Z / 2 } }
	local out = {}
	for i = 1, 3 do
		local j, k = i % 3 + 1, (i + 1) % 3 + 1
		for _, sign in { 1, -1 } do
			local n = axes[i][1] * sign
			local c = cf.Position + n * axes[i][2]
			table.insert(out, { n = n, d = n:Dot(c), c = c, a = axes[j][1], b = axes[k][1], ha = axes[j][2], hb = axes[k][2] })
		end
	end
	return out
end

-- Do two coplanar rectangles overlap with positive area? (2D separating axis test.)
local function rectsOverlap(f: Face, g: Face): boolean
	local d = g.c - f.c
	for _, ax in { f.a, f.b, g.a, g.b } do
		local rf = math.abs(f.a:Dot(ax)) * f.ha + math.abs(f.b:Dot(ax)) * f.hb
		local rg = math.abs(g.a:Dot(ax)) * g.ha + math.abs(g.b:Dot(ax)) * g.hb
		if math.abs(d:Dot(ax)) >= rf + rg - 1e-3 then
			return false
		end
	end
	return true
end

-- Axis-aligned bounds of a part (studs).
local function bounds(p: BasePart): (Vector3, Vector3)
	local cf, s = p.CFrame, p.Size / 2
	local e = Vector3.new(
		math.abs(cf.RightVector.X) * s.X + math.abs(cf.UpVector.X) * s.Y + math.abs(cf.LookVector.X) * s.Z,
		math.abs(cf.RightVector.Y) * s.X + math.abs(cf.UpVector.Y) * s.Y + math.abs(cf.LookVector.Y) * s.Z,
		math.abs(cf.RightVector.Z) * s.X + math.abs(cf.UpVector.Z) * s.Y + math.abs(cf.LookVector.Z) * s.Z
	)
	return cf.Position - e, cf.Position + e
end

local function boxesOverlap(a: BasePart, b: BasePart): boolean
	local a0, a1 = bounds(a)
	local b0, b1 = bounds(b)
	return a0.X < b1.X and b0.X < a1.X and a0.Y < b1.Y and b0.Y < a1.Y and a0.Z < b1.Z and b0.Z < a1.Z
end

local function isBlock(p: BasePart): boolean
	return p.ClassName == "Part" and (p :: Part).Shape == Enum.PartType.Block
end

-- (Unset properties read as nil under the mock; Roblox defaults them.)
local function transparency(p: BasePart): number
	return (p.Transparency :: number?) or 0
end

local function visible(p: BasePart): boolean
	return transparency(p) < 1
end

local function key(p: BasePart): string
	local c, s = p.CFrame, p.Size
	local function r(x: number): string
		return string.format("%.3f", x)
	end
	return table.concat({
		p.ClassName, r(s.X), r(s.Y), r(s.Z), r(c.Position.X), r(c.Position.Y), r(c.Position.Z),
		r(c.UpVector.X), r(c.UpVector.Y), r(c.UpVector.Z), r(c.LookVector.X), r(c.LookVector.Y), r(c.LookVector.Z),
	}, ",")
end

export type Options = {
	-- Allowed (material, colour) pairs for visible parts: "SmoothPlastic 240,240,240".
	allowed: { [string]: boolean }?,
	-- Water surface height (studs).
	waterY: number?,
}

local function colourKey(p: BasePart): string
	local c = (p.Color :: Color3?) or Color3.new(0.64, 0.64, 0.64)
	local m = (p.Material :: Enum.Material?) or Enum.Material.Plastic
	return `{m.Name} {math.round(c.R * 255)},{math.round(c.G * 255)},{math.round(c.B * 255)}`
end

-- Scan every feature model under `folder`.
function VisualAudit.scan(folder: Instance, opts: Options?): Report
	local o = opts or {}
	local waterY = o.waterY or 0
	local report: Report = { findings = {}, counts = {}, parts = 0, features = 0 }
	local function add(check: string, feature: string, part: string, detail: string)
		table.insert(report.findings, { check = check, feature = feature, part = part, detail = detail })
		report.counts[check] = (report.counts[check] or 0) + 1
	end
	for _, model in folder:GetChildren() do
		if not model:IsA("Model") then
			continue
		end
		report.features += 1
		local fid = model.Name
		local root = (model :: Model).PrimaryPart
		local parts: { BasePart } = {}
		for _, d in model:GetDescendants() do
			local cls = d.ClassName
			if cls == "SurfaceGui" or cls == "Decal" or cls == "Texture" or cls == "SurfaceAppearance" then
				add("decals", fid, d.Parent and d.Parent.Name or "?", cls)
			end
			if cls == "Sound" and ((d :: any).SoundId or "") == "" then
				add("brokenAsset", fid, d.Name, "Sound without SoundId")
			end
			if (cls == "Decal" or cls == "Texture") and ((d :: any).Texture or "") == "" then
				add("brokenAsset", fid, d.Name, cls .. " without Texture")
			end
			if cls == "MeshPart" and ((d :: any).MeshId or "") == "" then
				add("brokenAsset", fid, d.Name, "MeshPart without MeshId")
			end
			if d:IsA("BasePart") then
				local p = d :: BasePart
				report.parts += 1
				table.insert(parts, p)
				local parent = p.Parent
				if p ~= root and (parent == model or parent == nil or not parent:IsA("Folder")) then
					add("stray", fid, p.Name, "not in a feature folder")
				elseif root and (p.CFrame.Position - root.CFrame.Position).Magnitude > StrayDistance then
					add("stray", fid, p.Name, string.format("%.0f studs from the Root", (p.CFrame.Position - root.CFrame.Position).Magnitude))
				end
			end
		end
		-- Duplicates.
		local seen: { [string]: string } = {}
		for _, p in parts do
			local k = key(p)
			if seen[k] then
				add("duplicate", fid, p.Name, "same as " .. seen[k])
			else
				seen[k] = p.Name
			end
		end
		-- Visible parts only from here.
		local vis: { BasePart } = {}
		for _, p in parts do
			if visible(p) then
				table.insert(vis, p)
				local s = p.Size
				if math.max(s.X, s.Y, s.Z) < TinySize then
					add("tiny", fid, p.Name, string.format("%.2f studs", math.max(s.X, s.Y, s.Z)))
				end
				if o.allowed and not o.allowed[colourKey(p)] then
					add("material", fid, p.Name, colourKey(p))
				end
			end
		end
		-- Z-fighting between blocks, and against the water plane.
		local blockFaces: { { p: BasePart, f: { Face } } } = {}
		for _, p in vis do
			if isBlock(p) then
				local fs = faces(p)
				table.insert(blockFaces, { p = p, f = fs })
				for _, f in fs do
					if f.n.Y > 0.999 and math.abs(f.c.Y - waterY) < PlaneTol then
						add("waterFight", fid, p.Name, "top face at the waterline")
					end
				end
			end
		end
		for i = 1, #blockFaces do
			for j = i + 1, #blockFaces do
				local A, B = blockFaces[i], blockFaces[j]
				if not boxesOverlap(A.p, B.p) and (A.p.CFrame.Position - B.p.CFrame.Position).Magnitude > (A.p.Size.Magnitude + B.p.Size.Magnitude) / 2 then
					continue
				end
				local hit = false
				for _, f in A.f do
					for _, g in B.f do
						if f.n:Dot(g.n) > 0.999 and math.abs(f.d - g.d) < PlaneTol and rectsOverlap(f, g) then
							hit = true
							break
						end
					end
					if hit then
						break
					end
				end
				if hit then
					add("zFight", fid, A.p.Name, "with " .. B.p.Name)
				end
			end
		end
		-- Transparency layering.
		for _, p in vis do
			if transparency(p) > 0 then
				for _, q in vis do
					if q ~= p and boxesOverlap(p, q) then
						add("transparent", fid, p.Name, string.format("%.2f transparent over %s", transparency(p), q.Name))
						break
					end
				end
			end
		end
	end
	return report
end

local ORDER = { "zFight", "waterFight", "decals", "transparent", "duplicate", "stray", "brokenAsset", "tiny", "material" }

-- Print the counts, then the first `limit` findings of each check.
function VisualAudit.print(r: Report, limit: number?)
	print(`[VisualAudit] {r.features} features, {r.parts} parts`)
	for _, c in ORDER do
		print(string.format("  %-12s %d", c, r.counts[c] or 0))
	end
	local shown: { [string]: number } = {}
	for _, f in r.findings do
		shown[f.check] = (shown[f.check] or 0) + 1
		if shown[f.check] <= (limit or 5) then
			print(`    {f.check}: {f.feature} / {f.part}: {f.detail}`)
		end
	end
end

return VisualAudit
