-- Cable path (towers joined by filleted corners) and carrier kinematics.
-- Mirrors src/sim/cable.ts. Segment indices are 0-based like the TypeScript.
local DetMath = require(script.Parent.DetMath)
local Vec = require(script.Parent.Vec)
local Scalar = require(script.Parent.Scalar)

local Cable = {}

-- Two-tower system: one straight cable out and back (see src/sim/cable.ts).
local function buildShuttlePath(cfg)
	local a, b = cfg.towers[1], cfg.towers[2]
	assert(a and b, "A two-tower system needs two towers")
	local start = Vec.vec3(a.x, 0, a.z)
	local span = Vec.sub(Vec.vec3(b.x, 0, b.z), start)
	local len = Vec.length(span)
	local line = { kind = "line", start = start, heading = Vec.headingOf(span), length = len, s0 = 0 }
	return { segments = { line }, length = 2 * len, height = cfg.cableHeight, shuttle = true }
end

function Cable.buildCablePath(cfg)
	if cfg.mode == "twoTower" then
		return buildShuttlePath(cfg)
	end
	local n = #cfg.towers
	assert(n >= 3, "A closed cable loop needs at least 3 towers")
	local p = {}
	for i, t in cfg.towers do
		p[i] = Vec.vec3(t.x, 0, t.z)
	end
	local function at(i)
		return p[Scalar.mod(i, n) + 1]
	end

	local corners = {}
	for i = 0, n - 1 do
		local dIn = Vec.normalize(Vec.sub(at(i), at(i - 1)))
		local dOut = Vec.normalize(Vec.sub(at(i + 1), at(i)))
		local headingIn = Vec.headingOf(dIn)
		local delta = Scalar.wrapAngle(Vec.headingOf(dOut) - headingIn)
		local turn = if delta >= 0 then 1 else -1
		local tangentLen = cfg.cornerRadius * DetMath.tan(math.abs(delta) / 2)
		local inLen = Vec.length(Vec.sub(at(i), at(i - 1)))
		local outLen = Vec.length(Vec.sub(at(i + 1), at(i)))
		if tangentLen * 2 > math.min(inLen, outLen) then
			error(`cornerRadius too large for tower {i}`)
		end
		local a = Vec.addScaled(at(i), dIn, -tangentLen)
		local b = Vec.addScaled(at(i), dOut, tangentLen)
		local center = Vec.addScaled(a, Vec.rightOf(headingIn), turn * cfg.cornerRadius)
		corners[i + 1] = { a = a, b = b, center = center, headingIn = headingIn, turn = turn, sweep = math.abs(delta) }
	end

	-- Start on the straight leaving tower 0, so s = 0 is just past its arc.
	local segments = {}
	local s = 0
	for i = 0, n - 1 do
		local prev = corners[i + 1]
		local c = corners[Scalar.mod(i + 1, n) + 1]
		local lineLen = Vec.length(Vec.sub(c.a, prev.b))
		table.insert(segments, { kind = "line", start = prev.b, heading = c.headingIn, length = lineLen, s0 = s })
		s += lineLen
		local arcLen = cfg.cornerRadius * c.sweep
		table.insert(segments, {
			kind = "arc",
			center = c.center,
			radius = cfg.cornerRadius,
			heading0 = c.headingIn,
			turn = c.turn,
			length = arcLen,
			s0 = s,
		})
		s += arcLen
	end
	return { segments = segments, length = s, height = cfg.cableHeight, shuttle = false }
end

-- Point and heading on the cable at arc length s (wraps around the loop).
function Cable.cablePointAt(path, s)
	if path.shuttle then
		local line = path.segments[1]
		local phase = Scalar.mod(s, path.length)
		local out = phase < line.length
		local u = if out then phase else path.length - phase
		local pos = Vec.addScaled(line.start, Vec.forwardOf(line.heading), u)
		return {
			pos = Vec.vec3(pos.x, path.height, pos.z),
			heading = if out then line.heading else Scalar.wrapAngle(line.heading + math.pi),
			segment = 0,
		}
	end
	local ss = Scalar.mod(s, path.length)
	local count = #path.segments
	local index = count - 1
	for i = 0, count - 1 do
		local seg = path.segments[i + 1]
		if ss < seg.s0 + seg.length then
			index = i
			break
		end
	end
	local seg = path.segments[index + 1]
	local u = math.min(ss - seg.s0, seg.length)
	if seg.kind == "line" then
		local pos = Vec.addScaled(seg.start, Vec.forwardOf(seg.heading), u)
		return { pos = Vec.vec3(pos.x, path.height, pos.z), heading = seg.heading, segment = index }
	end
	local heading = seg.heading0 + (seg.turn * u) / seg.radius
	local pos = Vec.addScaled(seg.center, Vec.rightOf(heading), -seg.turn * seg.radius)
	return { pos = Vec.vec3(pos.x, path.height, pos.z), heading = heading, segment = index }
end

function Cable.createCarrier(path, s, speed)
	local p = Cable.cablePointAt(path, s)
	return { s = s, pos = p.pos, vel = Vec.scale(Vec.forwardOf(p.heading), speed), heading = p.heading }
end

-- Advance the carrier at constant speed. The carrier never slows for the rider.
function Cable.stepCarrier(c, path, speed, dt)
	c.s += speed * dt
	local p = Cable.cablePointAt(path, c.s)
	c.pos = p.pos
	c.heading = p.heading
	c.vel = Vec.scale(Vec.forwardOf(p.heading), speed)
end

function Cable.lapsAt(path, s)
	return math.floor(s / path.length)
end

return Cable
