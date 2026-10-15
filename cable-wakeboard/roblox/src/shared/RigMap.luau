--!strict
--[[
	RigMap (spec section 1.5): animation joint name -> the rig's Motor6D name.
	CUSTOM is the WakeRider rig from RiderBuilder (Motor6Ds named after the
	joints). R15 maps the same joints onto a standard R15 character. Also
	turns an AnimFrame (metres, plain quaternions) into Roblox CFrames.

	The animator's rest frame is +X lead side (the rider's left for a regular
	rider), +Y up, +Z chest. An R15 character faces -Z with its left at -X, so
	for R15 every rotation is conjugated by a half turn about Y. R15 support is
	untested in Studio (no R15 rig is used by the game); the custom rig is the
	one WakeClient drives.
]]
local RigMap = {}

RigMap.JOINTS = { "Hips", "Waist", "Neck", "LShoulder", "LElbow", "LWrist", "RShoulder", "RElbow", "RWrist", "LHip", "LKnee", "LAnkle", "RHip", "RKnee", "RAnkle" }

RigMap.CUSTOM = {
	Hips = "Hips",
	Waist = "Waist",
	Neck = "Neck",
	LShoulder = "LShoulder",
	LElbow = "LElbow",
	LWrist = "LWrist",
	RShoulder = "RShoulder",
	RElbow = "RElbow",
	RWrist = "RWrist",
	LHip = "LHip",
	LKnee = "LKnee",
	LAnkle = "LAnkle",
	RHip = "RHip",
	RKnee = "RKnee",
	RAnkle = "RAnkle",
}

RigMap.R15 = {
	Hips = "Root",
	Waist = "Waist",
	Neck = "Neck",
	LShoulder = "LeftShoulder",
	LElbow = "LeftElbow",
	LWrist = "LeftWrist",
	RShoulder = "RightShoulder",
	RElbow = "RightElbow",
	RWrist = "RightWrist",
	LHip = "LeftHip",
	LKnee = "LeftKnee",
	LAnkle = "LeftAnkle",
	RHip = "RightHip",
	RKnee = "RightKnee",
	RAnkle = "RightAnkle",
}

export type Motors = { [string]: Motor6D }

--- Find every mapped Motor6D under `model`. Missing joints are reported in the second result.
function RigMap.motors(model: Instance, map: { [string]: string }?): (Motors, { string })
	local m = map or RigMap.CUSTOM
	local byName: { [string]: Motor6D } = {}
	for _, d in model:GetDescendants() do
		if d:IsA("Motor6D") then
			byName[d.Name] = d
		end
	end
	local out: Motors = {}
	local missing = {}
	for _, j in RigMap.JOINTS do
		local motor = byName[m[j]]
		if motor then
			out[j] = motor
		else
			table.insert(missing, j)
		end
	end
	return out, missing
end

--- Plain {x, y, z, w} quaternion -> rotation-only CFrame.
function RigMap.quat(q: { x: number, y: number, z: number, w: number }): CFrame
	return CFrame.new(0, 0, 0, q.x, q.y, q.z, q.w)
end

local HALF_TURN = CFrame.Angles(0, math.pi, 0)

--- Rotation for a joint in an R15 rig (half turn about Y each side).
function RigMap.r15(q: { x: number, y: number, z: number, w: number }): CFrame
	return HALF_TURN * RigMap.quat(q) * HALF_TURN:Inverse()
end

return RigMap
