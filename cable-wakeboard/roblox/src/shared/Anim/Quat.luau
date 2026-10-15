-- Quaternions and vector helpers for the animation system. Plain {x, y, z, w}
-- tables (not Roblox CFrame/Vector3, so the module runs in the luau CLI and
-- matches src/anim/quat.ts). Rotations act on column vectors: q v q*.
local Quat = {}

local DEG = math.pi / 180
Quat.DEG = DEG

local function v3(x, y, z)
	return { x = x or 0, y = y or 0, z = z or 0 }
end
Quat.v3 = v3
function Quat.vadd(a, b)
	return { x = a.x + b.x, y = a.y + b.y, z = a.z + b.z }
end
function Quat.vsub(a, b)
	return { x = a.x - b.x, y = a.y - b.y, z = a.z - b.z }
end
function Quat.vscale(a, k)
	return { x = a.x * k, y = a.y * k, z = a.z * k }
end
function Quat.vdot(a, b)
	return a.x * b.x + a.y * b.y + a.z * b.z
end
function Quat.vcross(a, b)
	return { x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x }
end
function Quat.vlen(a)
	return math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
end
function Quat.vlerp(a, b, t)
	return { x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t }
end
function Quat.vnorm(a)
	local l = Quat.vlen(a)
	if l > 1e-9 then
		return { x = a.x / l, y = a.y / l, z = a.z / l }
	end
	return { x = 0, y = 0, z = 0 }
end

function Quat.qid()
	return { x = 0, y = 0, z = 0, w = 1 }
end

function Quat.qmul(a, b)
	return {
		x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
		y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
		z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
		w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
	}
end

function Quat.qconj(q)
	return { x = -q.x, y = -q.y, z = -q.z, w = q.w }
end

function Quat.qnorm(q)
	local l = math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)
	if l > 1e-12 then
		return { x = q.x / l, y = q.y / l, z = q.z / l, w = q.w / l }
	end
	return Quat.qid()
end

function Quat.qaxis(axis, angle)
	local s = math.sin(angle / 2)
	return { x = axis.x * s, y = axis.y * s, z = axis.z * s, w = math.cos(angle / 2) }
end

function Quat.qrot(q, v)
	local u = { x = q.x, y = q.y, z = q.z }
	local t = Quat.vscale(Quat.vcross(u, v), 2)
	return Quat.vadd(Quat.vadd(v, Quat.vscale(t, q.w)), Quat.vcross(u, t))
end

local XA, YA, ZA = v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)

-- Joint rotation from degrees: q = Y * X * Z (see quat.ts for the axes).
function Quat.qeuler(xDeg, yDeg, zDeg)
	local qx = Quat.qaxis(XA, xDeg * DEG)
	local qy = Quat.qaxis(YA, yDeg * DEG)
	local qz = Quat.qaxis(ZA, zDeg * DEG)
	return Quat.qmul(qy, Quat.qmul(qx, qz))
end

function Quat.qslerp(a, b, t)
	local d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
	local bx, by, bz, bw = b.x, b.y, b.z, b.w
	if d < 0 then
		d = -d
		bx, by, bz, bw = -bx, -by, -bz, -bw
	end
	if d > 0.9995 then
		return Quat.qnorm({ x = a.x + (bx - a.x) * t, y = a.y + (by - a.y) * t, z = a.z + (bz - a.z) * t, w = a.w + (bw - a.w) * t })
	end
	local th = math.acos(d)
	local s = math.sin(th)
	local ka = math.sin((1 - t) * th) / s
	local kb = math.sin(t * th) / s
	return { x = a.x * ka + bx * kb, y = a.y * ka + by * kb, z = a.z * ka + bz * kb, w = a.w * ka + bw * kb }
end

function Quat.qfromTo(a, b)
	local d = Quat.vdot(a, b)
	if d < -0.999999 then
		local axis = Quat.vcross(XA, a)
		if Quat.vlen(axis) < 1e-6 then
			axis = Quat.vcross(YA, a)
		end
		return Quat.qaxis(Quat.vnorm(axis), math.pi)
	end
	local c = Quat.vcross(a, b)
	return Quat.qnorm({ x = c.x, y = c.y, z = c.z, w = 1 + d })
end

function Quat.qfromBasis(x, y, z)
	local m00, m01, m02 = x.x, y.x, z.x
	local m10, m11, m12 = x.y, y.y, z.y
	local m20, m21, m22 = x.z, y.z, z.z
	local tr = m00 + m11 + m22
	if tr > 0 then
		local s = math.sqrt(tr + 1) * 2
		return Quat.qnorm({ w = 0.25 * s, x = (m21 - m12) / s, y = (m02 - m20) / s, z = (m10 - m01) / s })
	end
	if m00 > m11 and m00 > m22 then
		local s = math.sqrt(1 + m00 - m11 - m22) * 2
		return Quat.qnorm({ w = (m21 - m12) / s, x = 0.25 * s, y = (m01 + m10) / s, z = (m02 + m20) / s })
	end
	if m11 > m22 then
		local s = math.sqrt(1 + m11 - m00 - m22) * 2
		return Quat.qnorm({ w = (m02 - m20) / s, x = (m01 + m10) / s, y = 0.25 * s, z = (m12 + m21) / s })
	end
	local s = math.sqrt(1 + m22 - m00 - m11) * 2
	return Quat.qnorm({ w = (m10 - m01) / s, x = (m02 + m20) / s, y = (m12 + m21) / s, z = 0.25 * s })
end

function Quat.qlook(up, fwd)
	local y = Quat.vnorm(up)
	local x = Quat.vcross(y, fwd)
	if Quat.vlen(x) < 1e-6 then
		x = Quat.vcross(y, ZA)
	end
	if Quat.vlen(x) < 1e-6 then
		x = Quat.vcross(y, XA)
	end
	x = Quat.vnorm(x)
	local z = Quat.vcross(x, y)
	return Quat.qfromBasis(x, y, z)
end

function Quat.qangle(q)
	local w = math.min(1, math.abs(q.w))
	return 2 * math.acos(w)
end

function Quat.qmirrorX(q)
	return { x = q.x, y = -q.y, z = -q.z, w = q.w }
end

return Quat
