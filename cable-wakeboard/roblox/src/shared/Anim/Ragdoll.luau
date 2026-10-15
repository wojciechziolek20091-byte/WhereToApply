-- The crash ragdoll (spec section 9), shared by both games: point masses on
-- the joints held by distance constraints (bones plus braces that keep the
-- torso solid), knees and elbows limited to a smallest hinge angle, water
-- buoyancy and drag. It starts from the last animated pose and its joint
-- velocities; the board floats off on its own. Kinematic (the rider model
-- stays anchored), so no BallSocketConstraints are needed. Twin of
-- src/anim/ragdoll.ts.
local Quat = require(script.Parent.Quat)
local Skeleton = require(script.Parent.Skeleton)
local TwoBoneIK = require(script.Parent.TwoBoneIK)

local vadd, vsub, vscale, vdot, vcross, vlen, vnorm = Quat.vadd, Quat.vsub, Quat.vscale, Quat.vdot, Quat.vcross, Quat.vlen, Quat.vnorm
local Ragdoll = {}

local POINTS = table.clone(Skeleton.JOINTS)
table.insert(POINTS, "Head")
table.insert(POINTS, "LHand")
table.insert(POINTS, "RHand")

local BONES = {
	{ "Hips", "Waist" },
	{ "Waist", "Neck" },
	{ "Neck", "Head" },
	{ "Waist", "LShoulder" },
	{ "Waist", "RShoulder" },
	{ "LShoulder", "LElbow" },
	{ "LElbow", "LWrist" },
	{ "LWrist", "LHand" },
	{ "RShoulder", "RElbow" },
	{ "RElbow", "RWrist" },
	{ "RWrist", "RHand" },
	{ "Hips", "LHip" },
	{ "Hips", "RHip" },
	{ "LHip", "LKnee" },
	{ "LKnee", "LAnkle" },
	{ "RHip", "RKnee" },
	{ "RKnee", "RAnkle" },
}
local BRACES = {
	{ "LShoulder", "RShoulder" },
	{ "LHip", "RHip" },
	{ "LShoulder", "Hips" },
	{ "RShoulder", "Hips" },
	{ "LHip", "Waist" },
	{ "RHip", "Waist" },
	{ "Neck", "LShoulder" },
	{ "Neck", "RShoulder" },
	{ "Head", "Waist" },
	{ "LShoulder", "LHip" },
	{ "RShoulder", "RHip" },
}

local function dist(a, b)
	return vlen(vsub(a, b))
end

function Ragdoll.create(frame, prevWorld, prevHead, dt, cfg)
	local pos, prev = {}, {}
	for _, j in Skeleton.JOINTS do
		pos[j] = table.clone(frame.world[j])
		prev[j] = if prevWorld then table.clone(prevWorld[j]) else table.clone(frame.world[j])
	end
	pos.Head = table.clone(frame.head)
	prev.Head = if prevHead then table.clone(prevHead) else table.clone(frame.head)
	pos.LHand = table.clone(frame.hands.L)
	pos.RHand = table.clone(frame.hands.R)
	prev.LHand = vsub(pos.LHand, vsub(pos.LWrist, prev.LWrist))
	prev.RHand = vsub(pos.RHand, vsub(pos.RWrist, prev.RWrist))
	local links = {}
	for _, list in { BONES, BRACES } do
		for _, ab in list do
			table.insert(links, { a = ab[1], b = ab[2], len = dist(pos[ab[1]], pos[ab[2]]) })
		end
	end
	local minHinge = (cfg.Ragdoll.MinHinge * math.pi) / 180
	local function hinge(a, b, c)
		local l1 = dist(pos[a], pos[b])
		local l2 = dist(pos[b], pos[c])
		return { a = a, c = c, min = math.sqrt(math.max(0, l1 * l1 + l2 * l2 - 2 * l1 * l2 * math.cos(minHinge))) }
	end
	local hinges = {
		hinge("LShoulder", "LElbow", "LWrist"),
		hinge("RShoulder", "RElbow", "RWrist"),
		hinge("LHip", "LKnee", "LAnkle"),
		hinge("RHip", "RKnee", "RAnkle"),
	}
	local v = if prevWorld and dt > 0 then vscale(vsub(frame.world.Hips, prevWorld.Hips), 1 / dt) else { x = 0, y = 0, z = 0 }
	return {
		pos = pos,
		prev = prev,
		links = links,
		hinges = hinges,
		board = { pos = table.clone(frame.root.pos), vel = v, rot = frame.root.rot, spin = { x = 0, y = 0, z = 0 } },
		time = 0,
	}
end

function Ragdoll.step(r, cfg, dt)
	if dt <= 0 then
		return
	end
	local c = cfg.Ragdoll
	r.time += dt
	for _, p in POINTS do
		local x = r.pos[p]
		local o = r.prev[p]
		local under = x.y < 0
		local depth = if under then math.min(1, -x.y / c.FloatDepth) else 0
		local drag = if under then c.WaterDrag else c.AirDrag
		local ay = -c.Gravity + c.Gravity * c.Buoyancy * depth
		local k = math.max(0, 1 - drag * dt)
		local nx = { x = x.x + (x.x - o.x) * k, y = x.y + (x.y - o.y) * k + ay * dt * dt, z = x.z + (x.z - o.z) * k }
		r.prev[p] = x
		r.pos[p] = nx
	end
	for _ = 1, c.Iterations do
		for _, l in r.links do
			local a = r.pos[l.a]
			local b = r.pos[l.b]
			local d = vsub(b, a)
			local len = vlen(d)
			if len >= 1e-9 then
				local corr = vscale(d, ((len - l.len) / len) * 0.5)
				r.pos[l.a] = vadd(a, corr)
				r.pos[l.b] = vsub(b, corr)
			end
		end
		for _, h in r.hinges do
			local a = r.pos[h.a]
			local b = r.pos[h.c]
			local d = vsub(b, a)
			local len = vlen(d)
			if len < h.min and len >= 1e-9 then
				local corr = vscale(d, ((len - h.min) / len) * 0.5)
				r.pos[h.a] = vadd(a, corr)
				r.pos[h.c] = vsub(b, corr)
			end
		end
	end
	local b = r.board
	local under = b.pos.y < 0.02
	local lift = if under then c.Gravity * c.Buoyancy * 1.6 * math.min(1, (0.02 - b.pos.y) / 0.05) else 0
	b.vel = vadd(b.vel, { x = 0, y = (lift - c.Gravity) * dt, z = 0 })
	b.vel = vscale(b.vel, math.max(0, 1 - (if under then c.WaterDrag else c.AirDrag) * dt))
	b.pos = vadd(b.pos, vscale(b.vel, dt))
	if b.pos.y < -0.05 then
		b.pos.y = -0.05
		b.vel.y = math.max(0, b.vel.y)
	end
	local fwd = Quat.qrot(b.rot, { x = 1, y = 0, z = 0 })
	local flat = Quat.qaxis({ x = 0, y = 1, z = 0 }, -math.atan2(fwd.z, fwd.x))
	b.rot = Quat.qnorm(Quat.qslerp(b.rot, flat, math.min(1, dt * 2.5)))
end

local function frameRot(restY, restX, curY, curX)
	local function basis(y0, x0)
		local y = vnorm(y0)
		local x = vsub(x0, vscale(y, vdot(x0, y)))
		if vlen(x) < 1e-6 then
			x = vcross(y, { x = 0, y = 0, z = 1 })
		end
		x = vnorm(x)
		return Quat.qfromBasis(x, y, vcross(x, y))
	end
	return Quat.qmul(basis(curY, curX), Quat.qconj(basis(restY, restX)))
end

-- The ragdoll as a pose: board root, pelvis offset, joint rotations.
function Ragdoll.pose(rig, r)
	local rs = rig.rest
	local root = { pos = r.board.pos, rot = r.board.rot }
	local inv = Quat.qconj(root.rot)
	local P = {}
	for _, p in POINTS do
		P[p] = Quat.qrot(inv, vsub(r.pos[p], root.pos))
	end
	local world = {}
	world.Hips = frameRot(vsub(rs.Waist, rs.Hips), vsub(rs.LHip, rs.RHip), vsub(P.Waist, P.Hips), vsub(P.LHip, P.RHip))
	world.Waist = frameRot(vsub(rs.Neck, rs.Waist), vsub(rs.LShoulder, rs.RShoulder), vsub(P.Neck, P.Waist), vsub(P.LShoulder, P.RShoulder))
	world.Neck = frameRot(vsub(rig.headCentre, rs.Neck), vsub(rs.LShoulder, rs.RShoulder), vsub(P.Head, P.Neck), vsub(P.LShoulder, P.RShoulder))
	local function restHand(w, e)
		return vadd(rs[w], vscale(vnorm(vsub(rs[w], rs[e])), rig.handLength))
	end
	for _, side in { "L", "R" } do
		local sh, el, wr = side .. "Shoulder", side .. "Elbow", side .. "Wrist"
		local pole = { x = if side == "L" then 0.3 else -0.3, y = -1, z = 0 }
		local upper, lower = TwoBoneIK.chainRotations(rs[sh], rs[el], restHand(wr, el), P[sh], P[el], P[side .. "Hand"], pole, pole)
		world[sh] = upper
		world[el] = lower
		world[wr] = lower
		local hp, kn, an = side .. "Hip", side .. "Knee", side .. "Ankle"
		local kp = { x = 0, y = 0, z = 1 }
		local lu, ll = TwoBoneIK.chainRotations(rs[hp], rs[kn], rs[an], P[hp], P[kn], P[an], kp, kp)
		world[hp] = lu
		world[kn] = ll
		world[an] = ll
	end
	local loc = Skeleton.identityLocals()
	for _, j in Skeleton.JOINTS do
		local parent = nil
		if j == "Waist" or j == "LHip" or j == "RHip" then
			parent = "Hips"
		elseif j == "Neck" or j == "LShoulder" or j == "RShoulder" then
			parent = "Waist"
		end
		if j == "Hips" then
			loc[j] = world.Hips
		elseif parent then
			loc[j] = Quat.qmul(Quat.qconj(world[parent]), world[j])
		end
	end
	for _, side in { "L", "R" } do
		loc[side .. "Elbow"] = Quat.qmul(Quat.qconj(world[side .. "Shoulder"]), world[side .. "Elbow"])
		loc[side .. "Wrist"] = Quat.qid()
		loc[side .. "Knee"] = Quat.qmul(Quat.qconj(world[side .. "Hip"]), world[side .. "Knee"])
		loc[side .. "Ankle"] = Quat.qid()
	end
	return { root = root, hipsOffset = vsub(P.Hips, rs.Hips), ["local"] = loc }
end

return Ragdoll
