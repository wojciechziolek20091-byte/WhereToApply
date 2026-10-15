-- Plain 3D vectors as {x, y, z} tables of doubles. Mirrors src/sim/math/vec.ts.
-- Roblox's Vector3 is not used: it stores 32-bit floats, which would make the
-- simulation drift from the TypeScript version.
local DetMath = require(script.Parent.DetMath)

local Vec = {}

local function vec3(x, y, z)
	return { x = x or 0, y = y or 0, z = z or 0 }
end
Vec.vec3 = vec3
Vec.ZERO = table.freeze(vec3())
Vec.UP = table.freeze(vec3(0, 1, 0))

function Vec.add(a, b)
	return vec3(a.x + b.x, a.y + b.y, a.z + b.z)
end
function Vec.sub(a, b)
	return vec3(a.x - b.x, a.y - b.y, a.z - b.z)
end
function Vec.scale(a, s)
	return vec3(a.x * s, a.y * s, a.z * s)
end
function Vec.addScaled(a, b, s)
	return vec3(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s)
end
function Vec.dot(a, b)
	return a.x * b.x + a.y * b.y + a.z * b.z
end
function Vec.cross(a, b)
	return vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
end
-- Plain sqrt of a sum, exactly as the TypeScript does, so both compute the same bits.
function Vec.length(a)
	return math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
end
function Vec.distance(a, b)
	return Vec.length(Vec.sub(a, b))
end
function Vec.normalize(a)
	local l = Vec.length(a)
	if l > 1e-12 then
		return Vec.scale(a, 1 / l)
	end
	return vec3()
end
function Vec.lerpVec(a, b, t)
	return vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
end
function Vec.horizontal(a)
	return vec3(a.x, 0, a.z)
end
function Vec.horizontalLength(a)
	return math.sqrt(a.x * a.x + a.z * a.z)
end
-- Unit forward vector for heading psi: (cos psi, 0, sin psi).
function Vec.forwardOf(psi)
	return vec3(DetMath.cos(psi), 0, DetMath.sin(psi))
end
-- Unit vector to the right of heading psi, seen from above with +y up.
function Vec.rightOf(psi)
	return vec3(-DetMath.sin(psi), 0, DetMath.cos(psi))
end
function Vec.headingOf(a)
	return DetMath.atan2(a.z, a.x)
end

return Vec
