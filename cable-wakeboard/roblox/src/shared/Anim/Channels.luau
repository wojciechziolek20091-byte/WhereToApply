-- A pose as a flat list of numbers ("channels"), 1-based. See
-- src/anim/channels.ts for what each channel means. Twin of channels.ts.
local Skeleton = require(script.Parent.Skeleton)

local Channels = {}

local extras = { "pelvis.x", "pelvis.y", "pelvis.z", "kneeL", "kneeR", "handle.x", "handle.y", "handle.z", "tuck", "board.x", "board.y", "board.z", "aim" }

local CHANNELS = {}
for _, j in Skeleton.JOINTS do
	table.insert(CHANNELS, j .. ".x")
	table.insert(CHANNELS, j .. ".y")
	table.insert(CHANNELS, j .. ".z")
end
for _, e in extras do
	table.insert(CHANNELS, e)
end
Channels.CHANNELS = CHANNELS
Channels.NCH = #CHANNELS

local CH = {}
for i, c in CHANNELS do
	CH[c] = i
end
Channels.CH = CH

function Channels.jointCh(j)
	return CH[j .. ".x"]
end

function Channels.neutralPose()
	local p = table.create(Channels.NCH, 0)
	p[CH.kneeL] = 28
	p[CH.kneeR] = 28
	p[CH.aim] = 1
	return p
end

local isJoint = {}
for _, j in Skeleton.JOINTS do
	isJoint[j] = true
end

local MIRROR_FROM, MIRROR_SIGN = {}, {}
for _, c in CHANNELS do
	local name, axis = string.match(c, "^([^%.]+)%.?(.*)$")
	local from, sign = c, 1
	if isJoint[name] then
		from = Skeleton.MIRROR[name] .. "." .. axis
		sign = if axis == "x" then 1 else -1
	elseif name == "kneeL" then
		from = "kneeR"
	elseif name == "kneeR" then
		from = "kneeL"
	elseif name == "pelvis" or name == "handle" then
		sign = if axis == "x" then -1 else 1
	elseif name == "board" then
		sign = if axis == "x" then 1 else -1
	end
	table.insert(MIRROR_FROM, CH[from])
	table.insert(MIRROR_SIGN, sign)
end
Channels.MIRROR_FROM = MIRROR_FROM
Channels.MIRROR_SIGN = MIRROR_SIGN

-- mirrorPose: the same pose for the other stance.
function Channels.mirrorPose(p)
	local out = table.create(Channels.NCH, 0)
	for i = 1, Channels.NCH do
		out[i] = p[MIRROR_FROM[i]] * MIRROR_SIGN[i]
	end
	return out
end

function Channels.blendInto(a, b, w, mask)
	if w <= 0 then
		return
	end
	for i = 1, Channels.NCH do
		local m = if mask then mask[i] * w else w
		if m > 0 then
			a[i] = a[i] + (b[i] - a[i]) * m
		end
	end
end

function Channels.addInto(a, b, w, mask)
	if w == 0 then
		return
	end
	for i = 1, Channels.NCH do
		local m = if mask then mask[i] * w else w
		if m ~= 0 then
			a[i] = a[i] + b[i] * m
		end
	end
end

return Channels
