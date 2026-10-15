-- Polygon helpers for drawing the park site in Roblox. Mirrors the parts of
-- src/art/site.ts the client needs (centroid, point in polygon, ear clipping,
-- radial growth). Pure Luau on {x, z} tables, so it also runs outside Studio.
local SiteGeometry = {}

function SiteGeometry.area(poly)
	local a = 0
	for i, p in poly do
		local q = poly[i % #poly + 1]
		a += p.x * q.z - q.x * p.z
	end
	return a / 2
end

function SiteGeometry.centroid(poly)
	local x, z = 0, 0
	for _, p in poly do
		x += p.x
		z += p.z
	end
	return { x = x / #poly, z = z / #poly }
end

function SiteGeometry.pointInPolygon(p, poly)
	local inside = false
	local j = #poly
	for i = 1, #poly do
		local a, b = poly[i], poly[j]
		if (a.z > p.z) ~= (b.z > p.z) and p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x then
			inside = not inside
		end
		j = i
	end
	return inside
end

-- Push each vertex away from the centroid by d (for star-shaped outlines).
function SiteGeometry.growRadially(poly, d)
	local c = SiteGeometry.centroid(poly)
	local out = {}
	for i, p in poly do
		local dx, dz = p.x - c.x, p.z - c.z
		local len = math.sqrt(dx * dx + dz * dz)
		if len == 0 then
			len = 1
		end
		out[i] = { x = p.x + dx / len * d, z = p.z + dz / len * d }
	end
	return out
end

local function cross(a, b, c)
	return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
end

-- Ear-clipping triangulation of a simple polygon: a list of {i, j, k} index triples.
function SiteGeometry.triangulate(poly)
	local sign = if SiteGeometry.area(poly) < 0 then -1 else 1
	local idx = {}
	for i = 1, #poly do
		idx[i] = i
	end
	local out = {}
	local guard = 0
	while #idx > 3 and guard < 10000 do
		guard += 1
		local clipped = false
		local n = #idx
		for k = 1, n do
			local i0, i1, i2 = idx[(k - 2) % n + 1], idx[k], idx[k % n + 1]
			local a, b, c = poly[i0], poly[i1], poly[i2]
			if cross(a, b, c) * sign > 0 then
				local tri = { a, c, b }
				local blocked = false
				for _, j in idx do
					if j ~= i0 and j ~= i1 and j ~= i2 and SiteGeometry.pointInPolygon(poly[j], tri) then
						blocked = true
						break
					end
				end
				if not blocked then
					table.insert(out, { i0, i1, i2 })
					table.remove(idx, k)
					clipped = true
					break
				end
			end
		end
		if not clipped then
			break
		end
	end
	if #idx == 3 then
		table.insert(out, { idx[1], idx[2], idx[3] })
	end
	return out
end

return SiteGeometry
