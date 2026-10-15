-- Analytic two-bone IK (spec section 2.1; the rig has no IKControl, so this
-- solver serves both games). Twin of src/anim/ik.ts.
local Quat = require(script.Parent.Quat)

local vadd, vsub, vscale, vdot, vcross, vlen, vnorm = Quat.vadd, Quat.vsub, Quat.vscale, Quat.vdot, Quat.vcross, Quat.vlen, Quat.vnorm
local TwoBoneIK = {}

-- Middle joint of a chain a -> c with bone lengths l1, l2, bending toward `pole` (a direction).
function TwoBoneIK.solveMiddle(a, c, l1, l2, pole)
	local ac = vsub(c, a)
	local len = vlen(ac)
	local d = math.min(math.max(len, math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-5)
	local dir = if len > 1e-9 then vscale(ac, 1 / len) else { x = 0, y = -1, z = 0 }
	local along = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
	local h = math.sqrt(math.max(0, l1 * l1 - along * along))
	local p = vsub(pole, vscale(dir, vdot(pole, dir)))
	if vlen(p) < 1e-6 then
		p = vcross(dir, { x = 1, y = 0, z = 0 })
	end
	p = vnorm(p)
	return vadd(vadd(a, vscale(dir, along)), vscale(p, h))
end

local function frame(dir, normal)
	local x = vnorm(dir)
	local n = vsub(normal, vscale(x, vdot(normal, x)))
	if vlen(n) < 1e-6 then
		n = vcross(x, { x = 0, y = 0, z = 1 })
	end
	if vlen(n) < 1e-6 then
		n = vcross(x, { x = 0, y = 1, z = 0 })
	end
	local y = vnorm(n)
	return Quat.qfromBasis(x, y, vcross(x, y))
end

function TwoBoneIK.bendNormal(a, b, c, pole)
	local n = vcross(vsub(b, a), vsub(c, b))
	if vlen(n) > 1e-6 then
		return vnorm(n)
	end
	return vnorm(vcross(vsub(c, a), pole))
end

-- Root-frame rotations of the upper and lower bones moving the rest chain onto (a, b, c).
function TwoBoneIK.chainRotations(ra, rb, rc, a, b, c, pole, restPole)
	local n0 = TwoBoneIK.bendNormal(ra, rb, rc, restPole)
	local n1 = TwoBoneIK.bendNormal(a, b, c, pole)
	local upper = Quat.qmul(frame(vsub(b, a), n1), Quat.qconj(frame(vsub(rb, ra), n0)))
	local lower = Quat.qmul(frame(vsub(c, b), n1), Quat.qconj(frame(vsub(rc, rb), n0)))
	return upper, lower
end

return TwoBoneIK
