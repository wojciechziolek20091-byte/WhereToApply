-- Replication (spec section 12): other players never get joints. Each client
-- sends its rider's anim state as a flat number list at 15-20 Hz over an
-- UnreliableRemoteEvent; the others rebuild a RiderAnimState, interpolate
-- between packets and run the same animator. One-shot flags (landed, popped,
-- rope snap) ride on the next packet and fire once. Twin of
-- src/anim/replication.ts (indices here are the TS index + 1).
local Quat = require(script.Parent.Quat)

local R = {}

local STATES = { "Riding", "RidingBlind", "WaterTrickLoad", "WaterTrickAir", "Airborne", "OnSafety", "OnFeature", "Landing", "Crashed" }
local TRICKS = { "", "Ollie", "Spin", "FrontFlip", "Tantrum", "Raley", "Backroll", "Frontroll", "SBendL", "SBendR", "Mobe" }
local GRABS = { "", "Indy", "Stalefish", "Nose", "Tail" }
local HANDLES = { "InFront", "Behind", "Passing", "Dropped" }
local SLIDES = { "", "FiftyFifty", "Backboard", "Frontboard", "SwitchFiftyFifty", "WallRide" }
local SIDES = { "", "Frontside", "Backside" }
local QUALITIES = { "", "Clean", "Sketchy" }
local ROLLS = { "", "back", "front" }
local CRASHES = {
	"",
	"shortOllie",
	"missedSafetyPop",
	"handleDropped",
	"underRotated",
	"overRotated",
	"grabHeldOnLanding",
	"raleyExtendedOnLanding",
	"caughtEdgeBlind",
	"fellOffFeature",
	"ropeYank",
	"badLandingYaw",
	"hardLanding",
	"hitFeature",
	"letGo",
	"clippedSide",
	"noseHitSide",
	"overshoot",
	"slippedOut",
	"badAngle",
	"landedInGap",
	"stalled",
	"kinkThrow",
}

R.PACKET_LENGTH = 50
R.SEND_RATE = 18

-- 0-based index of v in list (nil and "" are index 0), like the TS indexOf.
local function idx(list, v)
	local key = if v == nil then "" else v
	for i, x in list do
		if x == key then
			return i - 1
		end
	end
	return 0
end
local function at(list, i)
	local v = list[i + 1]
	if v == "" then
		return nil
	end
	return v
end

function R.pack(s, time, flags)
	local b = s.boardCFrame
	return {
		time,
		idx(STATES, s.state),
		idx(TRICKS, s.trick.id),
		s.trick.phase,
		s.trick.spinDegrees,
		s.trick.flipDegrees,
		s.edge,
		s.tension,
		idx(HANDLES, s.handle),
		idx(GRABS, s.trick.grab),
		s.trick.grabTime,
		b.pos.x,
		b.pos.y,
		b.pos.z,
		b.rot.x,
		b.rot.y,
		b.rot.z,
		b.rot.w,
		s.velocity.x,
		s.velocity.y,
		s.velocity.z,
		s.ext.carrier.x,
		s.ext.carrier.y,
		s.ext.carrier.z,
		s.ext.toes,
		s.popCharge,
		s.ext.spinRate,
		s.ext.spinRemaining,
		s.ext.flipRemaining,
		s.ext.extension,
		s.ext.rollDegrees,
		s.ext.sBend,
		idx(ROLLS, s.ext.rollKind),
		s.ext.edgeDegrees,
		s.ext.slope,
		idx(SLIDES, if s.feature then s.feature.slide else nil),
		if s.feature then s.feature.balance else 0,
		s.ext.featureTurn,
		idx(CRASHES, s.crashReason),
		s.ext.modeTime,
		s.ext.airTime,
		s.ext.airDuration,
		flags,
		if s.landing then s.landing.impactSpeed else 0,
		if s.landing then idx(QUALITIES, s.landing.quality) else -1,
		idx(SIDES, s.trick.spinDirection),
		s.ext.preWind,
		s.passProgress or -1,
		s.speed,
		if s.feature then 1 else 0,
	}
end

function R.flags(s)
	return (if s.ext.justLanded then 1 else 0) + (if s.ext.justTookOff then 2 else 0) + (if s.ext.ropeSnap then 4 else 0)
end

function R.unpack(p)
	-- n(i): the TS packet index i.
	local function n(i)
		return p[i + 1] or 0
	end
	local function v(i)
		return { x = n(i), y = n(i + 1), z = n(i + 2) }
	end
	local flags = n(42)
	local landingQ = n(44)
	return {
		state = STATES[n(1) + 1] or "Riding",
		stance = if n(24) >= 0 then "Regular" else "Goofy",
		isSwitch = false,
		speed = n(48),
		velocity = v(18),
		edge = n(6),
		tension = n(7),
		popCharge = n(25),
		boardCFrame = { pos = v(11), rot = { x = n(14), y = n(15), z = n(16), w = n(17) } },
		handlePosition = v(11),
		trick = {
			id = at(TRICKS, n(2)),
			phase = n(3),
			spinDegrees = n(4),
			spinDirection = at(SIDES, n(45)),
			flipDegrees = n(5),
			grab = at(GRABS, n(9)),
			grabTime = n(10),
		},
		handle = HANDLES[n(8) + 1] or "InFront",
		passProgress = if n(47) >= 0 then n(47) else nil,
		feature = if n(49) > 0 then { slide = at(SLIDES, n(35)), balance = n(36) } else nil,
		landing = if landingQ >= 0 then { impactSpeed = n(43), quality = at(QUALITIES, landingQ) } else nil,
		crashReason = if n(38) > 0 then at(CRASHES, n(38)) else nil,
		ext = {
			toes = if n(24) >= 0 then 1 else -1,
			carrier = v(21),
			airTime = n(40),
			airDuration = n(41),
			spinRate = n(26),
			spinRemaining = n(27),
			flipRemaining = n(28),
			preWind = n(46),
			extension = n(29),
			rollDegrees = n(30),
			sBend = n(31),
			rollKind = at(ROLLS, n(32)),
			edgeDegrees = n(33),
			slope = n(34),
			rail = false,
			featureTurn = n(37),
			lipPop = false,
			modeTime = n(39),
			justLanded = bit32.band(flags, 1) ~= 0,
			justTookOff = bit32.band(flags, 2) ~= 0,
			ropeSnap = bit32.band(flags, 4) ~= 0,
			spinOut = 0,
		},
	}
end

-- TS indices that interpolate linearly.
local LERP = { 3, 4, 5, 6, 7, 10, 11, 12, 13, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30, 33, 34, 36, 37, 39, 40, 41, 46, 48 }

function R.createBuffer()
	return { packets = {}, flagsFiredAt = -1 }
end

function R.push(buf, p)
	local last = buf.packets[#buf.packets]
	if last and p[1] <= last[1] then
		return
	end
	table.insert(buf.packets, p)
	while #buf.packets > 24 do
		table.remove(buf.packets, 1)
	end
end

-- A remote rider's state at `time` (render a little behind the newest packet).
function R.sample(buf, time)
	local packets = buf.packets
	if #packets == 0 then
		return nil
	end
	local i = #packets
	while i > 1 and packets[i - 1][1] > time do
		i -= 1
	end
	local b = packets[i]
	local a = if i > 1 then packets[i - 1] else b
	local ta, tb = a[1], b[1]
	local t = if tb > ta then math.max(0, math.min(1, (time - ta) / (tb - ta))) else 1
	local sameMode = a[2] == b[2] and a[3] == b[3]
	local out = table.clone(b)
	if sameMode then
		for _, k in LERP do
			out[k + 1] = a[k + 1] + (b[k + 1] - a[k + 1]) * t
		end
	else
		for _, k in { 11, 12, 13, 21, 22, 23 } do
			out[k + 1] = a[k + 1] + (b[k + 1] - a[k + 1]) * t
		end
	end
	local q = Quat.qslerp({ x = a[15], y = a[16], z = a[17], w = a[18] }, { x = b[15], y = b[16], z = b[17], w = b[18] }, t)
	out[15], out[16], out[17], out[18] = q.x, q.y, q.z, q.w
	if tb > buf.flagsFiredAt and time >= ta then
		buf.flagsFiredAt = tb
	else
		out[43] = 0
	end
	return R.unpack(out)
end

return R
