-- The rider skeleton (spec section 1.5): one bone per joint, the board as the
-- root, rest orientation identity for every bone, so a joint's local rotation
-- is exactly Motor6D.Transform's rotation. Rider frame (metres): +x along the
-- board to the nose (the lead side), +y up, +z toward the toes (the chest).
-- Canonical rider: regular, so "L" joints are the lead side. Twin of
-- src/anim/skeleton.ts.
local Quat = require(script.Parent.Quat)

local Skeleton = {}

Skeleton.JOINTS = {
	"Hips",
	"Waist",
	"Neck",
	"LShoulder",
	"LElbow",
	"LWrist",
	"RShoulder",
	"RElbow",
	"RWrist",
	"LHip",
	"LKnee",
	"LAnkle",
	"RHip",
	"RKnee",
	"RAnkle",
}

Skeleton.PARENT = {
	Hips = "Root",
	Waist = "Hips",
	Neck = "Waist",
	LShoulder = "Waist",
	LElbow = "LShoulder",
	LWrist = "LElbow",
	RShoulder = "Waist",
	RElbow = "RShoulder",
	RWrist = "RElbow",
	LHip = "Hips",
	LKnee = "LHip",
	LAnkle = "LKnee",
	RHip = "Hips",
	RKnee = "RHip",
	RAnkle = "RKnee",
}

Skeleton.MIRROR = {
	Hips = "Hips",
	Waist = "Waist",
	Neck = "Neck",
	LShoulder = "RShoulder",
	LElbow = "RElbow",
	LWrist = "RWrist",
	RShoulder = "LShoulder",
	RElbow = "LElbow",
	RWrist = "LWrist",
	LHip = "RHip",
	LKnee = "RKnee",
	LAnkle = "RAnkle",
	RHip = "LHip",
	RKnee = "LKnee",
	RAnkle = "LAnkle",
}

-- Forward kinematics in the root frame: the pelvis moves by hipsOffset, every joint turns by its local rotation.
function Skeleton.forwardKinematics(rig, hipsOffset, localRot)
	local out = {}
	for _, j in Skeleton.JOINTS do
		local p = Skeleton.PARENT[j]
		if p == "Root" then
			out[j] = { pos = Quat.vadd(rig.rest[j], hipsOffset), rot = localRot[j] }
		else
			local pb = out[p]
			out[j] = {
				pos = Quat.vadd(pb.pos, Quat.qrot(pb.rot, Quat.vsub(rig.rest[j], rig.rest[p]))),
				rot = Quat.qmul(pb.rot, localRot[j]),
			}
		end
	end
	return out
end

function Skeleton.carried(rig, sk, j, restPoint)
	return Quat.vadd(sk[j].pos, Quat.qrot(sk[j].rot, Quat.vsub(restPoint, rig.rest[j])))
end

function Skeleton.headPos(rig, sk)
	return Skeleton.carried(rig, sk, "Neck", rig.headCentre)
end

function Skeleton.handPos(rig, sk, side)
	local wrist = side .. "Wrist"
	local elbow = side .. "Elbow"
	local restDir = Quat.vsub(rig.rest[wrist], rig.rest[elbow])
	local len = math.sqrt(restDir.x * restDir.x + restDir.y * restDir.y + restDir.z * restDir.z)
	return Skeleton.carried(rig, sk, wrist, Quat.vadd(rig.rest[wrist], Quat.vscale(restDir, rig.handLength / len)))
end

-- Centre of mass: torso 0.5, head 0.08, each arm 0.05, each leg 0.16, at segment centres.
function Skeleton.centreOfMass(rig, sk)
	local torso = Quat.vlerp(sk.Hips.pos, sk.Neck.pos, 0.4)
	local head = Skeleton.headPos(rig, sk)
	local c = Quat.vadd(Quat.vscale(torso, 0.5), Quat.vscale(head, 0.08))
	c = Quat.vadd(c, Quat.vscale(Quat.vadd(sk.LElbow.pos, sk.RElbow.pos), 0.05))
	c = Quat.vadd(c, Quat.vscale(Quat.vadd(sk.LKnee.pos, sk.RKnee.pos), 0.16))
	return c
end

function Skeleton.identityLocals()
	local l = {}
	for _, j in Skeleton.JOINTS do
		l[j] = Quat.qid()
	end
	return l
end

function Skeleton.chainLengths(rig, a, b, c)
	local function d(p, q)
		return math.sqrt((p.x - q.x) ^ 2 + (p.y - q.y) ^ 2 + (p.z - q.z) ^ 2)
	end
	return d(rig.rest[a], rig.rest[b]), d(rig.rest[b], rig.rest[c])
end

return Skeleton
