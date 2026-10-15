--!strict
--[[
	RiderRig: puts an animation frame (shared/Anim, metres) on a RiderBuilder
	model: the root (board) by PivotTo, every joint by Motor6D.Transform
	(the pelvis also moves), and the separate handle by CFrame. Call `apply`
	from RunService.PreSimulation so nothing overwrites the Transforms.
	There is no Animator on the rig, so no animation tracks compete.
]]
local RigMap = require(script.Parent.RigMap)

local RiderRig = {}

export type Rig = {
	model: Model,
	motors: RigMap.Motors,
	handle: Model?,
	-- Studs per metre (1 / 0.28 at Scale 1).
	scale: number,
	-- Root (PrimaryPart) height above the board base, in studs.
	rootLift: number,
}

function RiderRig.new(model: Model, metresPerStud: number): Rig
	local motors, missing = RigMap.motors(model)
	if #missing > 0 then
		warn(`RiderRig: rig has no Motor6D for {table.concat(missing, ", ")}`)
	end
	local root = model.PrimaryPart
	assert(root, "rider model has no PrimaryPart")
	return {
		model = model,
		motors = motors,
		handle = model:FindFirstChild("Handle") :: Model?,
		scale = 1 / metresPerStud,
		rootLift = root.Size.Y / 2,
	}
end

function RiderRig.stud(rig: Rig, p: { x: number, y: number, z: number }): Vector3
	local k = rig.scale
	return Vector3.new(p.x * k, p.y * k, p.z * k)
end

--- The board's CFrame in the world (studs) for a frame.
function RiderRig.rootCFrame(rig: Rig, frame: any): CFrame
	return CFrame.new(RiderRig.stud(rig, frame.root.pos)) * RigMap.quat(frame.root.rot)
end

function RiderRig.apply(rig: Rig, frame: any)
	local rootCf = RiderRig.rootCFrame(rig, frame)
	rig.model:PivotTo(rootCf * CFrame.new(0, rig.rootLift, 0))
	local loc = frame["local"]
	for j, motor in rig.motors do
		local rot = RigMap.quat(loc[j])
		if j == "Hips" then
			motor.Transform = CFrame.new(RiderRig.stud(rig, frame.hipsOffset)) * rot
		else
			motor.Transform = rot
		end
	end
	local handle = rig.handle
	if handle and handle.PrimaryPart then
		handle.PrimaryPart.CFrame = CFrame.new(RiderRig.stud(rig, frame.handle.pos)) * RigMap.quat(frame.handle.rot)
	end
end

return RiderRig
