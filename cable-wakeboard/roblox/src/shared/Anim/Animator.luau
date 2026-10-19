-- The rider animation system (spec section 1): layers evaluated in order,
--   1 base pose (riding stance from state, edge, tension, charge),
--   2 trick layer (clips by phase or rotation progress, grabs),
--   3 physical reactions (springs: tension, yank, landing, chatter, breathing),
--   4 IK (handle in the hands, feet in the bindings, head aim),
--   5 secondary motion (spine lead and lag in rotations, free arms),
-- on a channel pose that is inertialized on every state change. Pure (no
-- Roblox APIs); WakeClient applies the frame to the rig's Motor6Ds.
-- Twin of src/anim/animator.ts: keep them in step (tests/animParity.test.ts).
local AnimConfig = require(script.Parent.AnimConfig)
local Channels = require(script.Parent.Channels)
local Clip = require(script.Parent.Clip)
local TwoBoneIK = require(script.Parent.TwoBoneIK)
local RiderPoses = require(script.Parent.RiderPoses)
local Quat = require(script.Parent.Quat)
local Ragdoll = require(script.Parent.Ragdoll)
local Skeleton = require(script.Parent.Skeleton)
local Spring = require(script.Parent.Spring)

local CH, NCH = Channels.CH, Channels.NCH
local DEG = Quat.DEG
local qaxis, qconj, qeuler, qfromTo, qid, qmul, qnorm, qrot, qslerp =
	Quat.qaxis, Quat.qconj, Quat.qeuler, Quat.qfromTo, Quat.qid, Quat.qmul, Quat.qnorm, Quat.qrot, Quat.qslerp
local v3, vadd, vcross, vdot, vlen, vlerp, vnorm, vscale, vsub =
	Quat.v3, Quat.vadd, Quat.vcross, Quat.vdot, Quat.vlen, Quat.vlerp, Quat.vnorm, Quat.vscale, Quat.vsub
local spring, stepSpring, impulse = Spring.spring, Spring.step, Spring.impulse
local JOINTS = Skeleton.JOINTS
local CRASH_LEAD_IN = RiderPoses.CRASH_LEAD_IN

local Animator = {}

local function EASE(s)
	return s * s * (3 - 2 * s)
end
local function clamp01(x)
	return if x < 0 then 0 elseif x > 1 then 1 else x
end
local function clamp(x, lo, hi)
	return if x < lo then lo elseif x > hi then hi else x
end
local UPV = { x = 0, y = 1, z = 0 }

local function newHand()
	return {
		kind = "Handle",
		goal = "handle",
		from = v3(),
		reach = 1,
		ik = spring(1),
		pos = v3(),
		counter = spring(0),
		reachTime = 0.1,
		bend = nil,
	}
end

function Animator.create(rig, cfg)
	cfg = cfg or AnimConfig.DEFAULT
	local clips = {}
	for _, c in RiderPoses.ALL_CLIPS do
		clips[c.name] = Clip.compileClip(c)
	end
	local inertia = {}
	for i = 1, NCH do
		inertia[i] = spring(0)
	end
	return {
		rig = rig,
		cfg = cfg,
		clips = clips,
		time = 0,
		key = "",
		last = nil,
		lastVel = table.create(NCH, 0),
		inertia = inertia,
		inertiaFreq = 6,
		rootOff = qid(),
		rootOffT = 1,
		rootOffDur = 0.12,
		e1 = 0,
		e2 = 0,
		e3 = 0,
		loadW = spring(0),
		blindW = spring(0),
		slackW = spring(0),
		chargeW = spring(0),
		tensionPitch = spring(0),
		yank = spring(0),
		landDrop = spring(0),
		wobble = spring(0),
		bob = spring(0),
		leadHips = spring(0),
		leadShoulders = spring(0),
		leadHead = spring(0),
		preWind = spring(0),
		aimYaw = spring(70),
		aimPitch = spring(0),
		grabW = spring(0),
		tweakW = spring(0),
		slideOnW = spring(0),
		slideOnT = 0,
		slideOnSide = 0,
		grab = nil,
		grabStart = 0,
		releaseTimer = 0,
		lastGrab = nil,
		flipDoneU = -1,
		sBendStartU = -1,
		hands = { L = newHand(), R = newHand() },
		gripSwap = false,
		handleOff = { x = spring(0), y = spring(0), z = spring(0) },
		grabAssist = { x = spring(0), y = spring(0), z = spring(0) },
		invertW = spring(0),
		handleWorld = v3(),
		handleVel = v3(),
		barWorld = nil,
		dropped = false,
		lastTension = 0,
		lastRootRot = nil,
		lastBoardFwd = nil,
		comOffset = nil,
		prevWorld = nil,
		prevHead = nil,
		ragdoll = nil,
		frame = nil,
	}
end

local function startsWith(s, p)
	return string.sub(s, 1, #p) == p
end

local function modeKey(s)
	local st = s.state
	if st == "Riding" or st == "RidingBlind" or st == "WaterTrickLoad" or st == "Landing" then
		return "Water"
	end
	if st == "Airborne" or st == "WaterTrickAir" then
		local id = s.trick.id
		return "Air|" .. (if id == "Ollie" or id == "Spin" or id == nil then "Basic" else id)
	end
	if st == "OnFeature" then
		return "Feature|" .. (if s.feature and s.feature.slide then s.feature.slide else "")
	end
	if st == "Crashed" then
		return "Crashed|" .. (s.crashReason or "")
	end
	return st
end

local function blendTime(cfg, key)
	if startsWith(key, "Crashed") then
		return cfg.Blend.ToCrashed
	elseif key == "Water" then
		return cfg.Blend.ToLanding
	elseif startsWith(key, "Air") then
		return cfg.Blend.ToAirborne
	elseif startsWith(key, "Feature") then
		return cfg.Blend.ToOnFeature
	end
	return cfg.Blend.Default
end

local function bump(p, name, v)
	local i = CH[name]
	p[i] = p[i] + v
end

local function lag(x, target, tau, dt)
	return x + (target - x) * (1 - math.exp(-dt / math.max(1e-4, tau)))
end

local function chatter(t, hz)
	return 0.6 * math.sin(2 * math.pi * hz * t) + 0.4 * math.sin(2 * math.pi * hz * 1.71 * t + 1.3)
end

local function sample(a, name, u)
	local p = Channels.neutralPose()
	Clip.sampleClip(a.clips[name], u, p)
	return p
end

local function ridingPose(a, e)
	local p = sample(a, "cruise", 0)
	local c = a.clips
	if e > 0 then
		Channels.blendInto(p, sample(a, "heelside", 0), e, c.heelside.mask)
	elseif e < 0 then
		Channels.blendInto(p, sample(a, "toeside", 0), -e, c.toeside.mask)
	end
	Channels.blendInto(p, sample(a, "loaded", 0), clamp01(a.loadW.x), c.loaded.mask)
	Channels.blendInto(p, sample(a, "blind", 0), clamp01(a.blindW.x), c.blind.mask)
	Channels.blendInto(p, sample(a, "slack", 0), clamp01(a.slackW.x), c.slack.mask)
	return p
end

local LEG_CH = { "kneeL", "kneeR" }
local HIP_CH = { "Hips.x", "Hips.y", "Hips.z", "pelvis.x", "pelvis.y", "pelvis.z" }

local function rotationClipTime(a, progress, done, phase)
	if progress <= 0 then
		return math.min(0.08, phase)
	end
	if not done then
		a.flipDoneU = -1
		return 0.08 + 0.77 * math.min(1, progress)
	end
	if a.flipDoneU < 0 then
		a.flipDoneU = phase
	end
	local span = math.max(0.05, 1 - a.flipDoneU)
	return 0.85 + 0.15 * clamp01((phase - a.flipDoneU) / span)
end

local function lowerFirst(s)
	return string.lower(string.sub(s, 1, 1)) .. string.sub(s, 2)
end

-- Layers 1-3 on the canonical (regular) rider.
local function canonicalPose(a, s, dt)
	local cfg = a.cfg
	local R = cfg.Riding
	local st = s.state
	local water = st == "Riding" or st == "RidingBlind" or st == "WaterTrickLoad" or st == "Landing" or st == "Crashed"
	local air = st == "Airborne" or st == "WaterTrickAir"

	a.e1 = lag(a.e1, s.edge, R.ChainDelay, dt)
	a.e2 = lag(a.e2, a.e1, R.ChainDelay, dt)
	a.e3 = lag(a.e3, a.e2, R.ChainDelay, dt)
	stepSpring(a.loadW, if st == "WaterTrickLoad" then 1 else 0, R.Lean, dt)
	stepSpring(a.blindW, if s.handle == "Behind" then 1 else 0, R.Lean, dt)
	local slack = if water and st ~= "Crashed" then 1 - clamp01((s.tension - R.SlackBelow) / (R.SlackAbove - R.SlackBelow)) else 0
	stepSpring(a.slackW, slack, R.Lean, dt)
	local charge = if water then s.popCharge else 0
	if cfg.Physics.CrouchFollowsCharge then
		a.chargeW.x = charge
		a.chargeW.v = 0
	else
		stepSpring(a.chargeW, charge, R.Knee, dt)
	end

	local p
	if water then
		local legs = ridingPose(a, a.e1)
		local hips = ridingPose(a, a.e2)
		p = ridingPose(a, a.e3)
		for _, c in LEG_CH do
			p[CH[c]] = legs[CH[c]]
		end
		for _, c in HIP_CH do
			p[CH[c]] = hips[CH[c]]
		end
		Channels.addInto(p, sample(a, "charge", 0), a.chargeW.x, a.clips.charge.mask)
		bump(p, "kneeL", R.ChargeKnee * a.chargeW.x)
		bump(p, "kneeR", R.ChargeKnee * a.chargeW.x)
	elseif st == "OnSafety" then
		p = sample(a, "ramp", 0)
		bump(p, "kneeL", cfg.Feature.SlopeKnee * s.ext.slope)
		bump(p, "kneeR", cfg.Feature.SlopeKnee * s.ext.slope)
	elseif st == "OnFeature" then
		local slide = if s.feature and s.feature.slide then s.feature.slide else "FiftyFifty"
		local name = if slide == "Backboard"
			then "backboard"
			elseif slide == "Frontboard" then "frontboard"
			elseif slide == "SwitchFiftyFifty" then "switchFiftyFifty"
			else "fiftyFifty"
		p = sample(a, name, 0)
		local bal = if s.feature then s.feature.balance else 0
		bump(p, "Hips.z", cfg.Feature.BalanceSway * bal)
		bump(p, "Waist.z", -(cfg.Feature.BalanceSway * 0.5 * bal))
		bump(p, "handle.x", -(0.05 * bal))
		local turn = s.ext.featureTurn
		if turn >= 0 and turn < 0.5 then
			bump(p, "pelvis.y", cfg.Feature.HopHeight * math.sin(math.pi * turn * 2))
		end
	else
		p = sample(a, "air", 0)
	end

	-- Layer 2: tricks.
	if air then
		local id = s.trick.id
		local phase = s.trick.phase
		local clip
		local t = phase
		if id == "FrontFlip" or id == "Tantrum" then
			local deg = math.abs(s.trick.flipDegrees)
			local total = math.max(360, deg + math.abs(s.ext.flipRemaining))
			clip = if id == "FrontFlip" then "frontFlip" else "tantrum"
			t = rotationClipTime(a, deg / total, s.ext.flipRemaining == 0 and deg > 300, phase)
		elseif id == "Backroll" or id == "Frontroll" or id == "Mobe" then
			local deg = math.abs(s.ext.rollDegrees)
			clip = if id == "Frontroll" or (id == "Mobe" and s.ext.rollKind == "front") then "frontroll" else "backroll"
			t = rotationClipTime(a, deg / 360, deg >= 359, phase)
		elseif id == "Raley" then
			clip = "raley"
		elseif id == "SBendL" or id == "SBendR" then
			if a.sBendStartU < 0 then
				a.sBendStartU = phase
			end
			clip = if id == "SBendL" then "sBendL" else "sBendR"
			t = clamp01((phase - a.sBendStartU) / math.max(0.05, 1 - a.sBendStartU))
		else
			clip = "ollie"
		end
		if id ~= "SBendL" and id ~= "SBendR" then
			a.sBendStartU = -1
		end
		if id ~= "FrontFlip" and id ~= "Tantrum" and id ~= "Backroll" and id ~= "Frontroll" and id ~= "Mobe" then
			a.flipDoneU = -1
		end
		Channels.blendInto(p, sample(a, clip, t), 1, a.clips[clip].mask)

		local w = clamp01(math.abs(s.ext.spinRate) / 540)
		if w > 0 then
			Channels.addInto(p, sample(a, "spinCompact", 0), w, a.clips.spinCompact.mask)
			bump(p, "kneeL", cfg.Spin.CompactKnee * w)
			bump(p, "kneeR", cfg.Spin.CompactKnee * w)
		end
	else
		a.flipDoneU = -1
		a.sBendStartU = -1
	end

	-- Grabs: the knees come up first; the legs stay up LegsAfterRelease after the hand lets go.
	local G = cfg.Grab
	local grab = if air then s.trick.grab else nil
	if grab and grab ~= a.grab then
		a.grabStart = a.time
	end
	if not grab and a.grab then
		a.releaseTimer = G.LegsAfterRelease
	end
	a.grab = grab
	if grab then
		a.lastGrab = grab
	end
	a.releaseTimer = math.max(0, a.releaseTimer - dt)
	local holdLegs = grab ~= nil or a.releaseTimer > 0
	stepSpring(a.grabW, if holdLegs then 1 else 0, { freq = 1 / (G.TweakTime * 3), damping = 1 }, dt)
	stepSpring(a.tweakW, if grab and s.trick.grabTime > G.TweakAfter then 1 else 0, { freq = 0.755 / G.TweakTime, damping = 1 }, dt)
	if a.lastGrab and a.grabW.x > 0.001 then
		local name = lowerFirst(a.lastGrab)
		Channels.blendInto(p, sample(a, name, 0), clamp01(a.grabW.x), a.clips[name].mask)
		Channels.blendInto(p, sample(a, name .. "Tweak", 0), clamp01(a.tweakW.x) * clamp01(a.grabW.x), a.clips[name .. "Tweak"].mask)
	end

	-- Slide-on (side approaches spec 5): the clip by its phase, leaning toward the feature at the climb.
	local SO = cfg.SlideOn
	local so = s.ext.slideOn
	local soOn = false
	if so then
		if so.phase == "Lift" then
			a.slideOnT = 0.35 * so.progress
			soOn = true
		elseif so.phase == "Contact" then
			a.slideOnT = 0.35 + 0.4 * so.progress
			soOn = true
		elseif so.progress < SO.SettleTime then
			a.slideOnT = 0.75 + (0.25 * so.progress) / SO.SettleTime
			soOn = true
		end
		a.slideOnSide = so.side
	end
	stepSpring(a.slideOnW, if soOn then 1 else 0, SO.Blend, dt)
	if a.slideOnW.x > 0.001 then
		local w = clamp01(a.slideOnW.x)
		Channels.blendInto(p, sample(a, "slideOn", a.slideOnT), w, a.clips.slideOn.mask)
		bump(p, "Waist.x", a.slideOnSide * SO.Lean * math.sin(math.pi * math.min(1, a.slideOnT / 0.9)) * w)
	end

	if st == "Crashed" then
		local clip = CRASH_LEAD_IN[s.crashReason or ""] or "crashSide"
		Channels.blendInto(p, sample(a, clip, clamp01(s.ext.modeTime / cfg.Crash.LeadIn)), 1, a.clips[clip].mask)
	end

	-- Layer 3: reactions.
	local kN = s.tension / 1000
	stepSpring(a.tensionPitch, if water or st == "OnFeature" then R.TensionPitch * kN else 0, R.Lean, dt)
	bump(p, "Waist.x", a.tensionPitch.x)
	bump(p, "Waist.z", -(0.5 * a.tensionPitch.x))
	local jump = s.tension - a.lastTension
	if s.ext.ropeSnap or (jump > 600 * dt * 10 and s.tension > 900 and water) then
		impulse(a.yank, R.YankKick * kN)
	end
	a.lastTension = s.tension
	stepSpring(a.yank, 0, R.Yank, dt)
	bump(p, "Waist.x", a.yank.x)

	local L = cfg.Landing
	local landW = 1 / (L.CompressPerMS * math.exp(1))
	local landSpring = { freq = landW / (2 * math.pi), damping = 1 }
	if s.ext.justLanded and s.landing then
		local v = math.min(s.landing.impactSpeed, L.MaxCompress * landW * math.exp(1))
		impulse(a.landDrop, -v)
		impulse(a.bob, 6 * v)
		if s.landing.quality == "Sketchy" then
			impulse(a.wobble, L.SketchyKick * (if a.time % 2 < 1 then 1 else -1))
		end
	end
	stepSpring(a.landDrop, 0, landSpring, dt)
	stepSpring(a.wobble, 0, L.Sketchy, dt)
	stepSpring(a.bob, 0, cfg.Secondary.HeadBob, dt)
	bump(p, "pelvis.y", a.landDrop.x)
	bump(p, "Waist.x", -(a.landDrop.x * L.PitchPerMetre))
	bump(p, "Waist.z", a.wobble.x)
	bump(p, "Neck.x", a.bob.x)

	if water and st ~= "Crashed" then
		local amp = R.ChatterDeg * clamp01(s.speed / R.ChatterSpeed) * (0.3 + 0.7 * math.abs(s.edge))
		bump(p, "kneeL", amp * chatter(a.time, R.ChatterHz))
		bump(p, "kneeR", amp * chatter(a.time + 0.37, R.ChatterHz))
	end
	if st ~= "Crashed" then
		bump(p, "Waist.x", R.BreathDeg * math.max(0.25, 1 - s.speed / 6) * math.sin(2 * math.pi * R.BreathHz * a.time))
	end
	return p
end

local function legSpan(l1, l2, bendDeg)
	local b = clamp(bendDeg, 2, 150) * DEG
	return math.sqrt(l1 * l1 + l2 * l2 + 2 * l1 * l2 * math.cos(b))
end

local function chanQ(p, j)
	local i = Channels.jointCh(j)
	return qeuler(p[i], p[i + 1], p[i + 2])
end

local function aboutUp(v, deg)
	return qrot(qaxis(UPV, deg * DEG), v)
end

local function toWorld(root, p)
	return vadd(root.pos, qrot(root.rot, p))
end

local function toRootFrame(f, p)
	return qrot(qconj(f.root.rot), vsub(p, f.root.pos))
end

local function gripSign(a, side, lead)
	local s = if side == lead then 1 else -1
	return if a.gripSwap then -s else s
end

local function grabTarget(rig, g, leadSign)
	local top = rig.deckTop + 0.04
	local hw = rig.boardWidth / 2
	local hl = rig.boardLength / 2
	if g == "Indy" then
		return { x = 0, y = top, z = hw * 0.95 }
	elseif g == "Stalefish" then
		return { x = -leadSign * 0.12, y = top, z = -hw * 0.95 }
	elseif g == "Nose" then
		return { x = leadSign * (hl - 0.16), y = top, z = 0.04 }
	end
	return { x = -leadSign * (hl - 0.16), y = top, z = 0.04 }
end
Animator.grabTarget = grabTarget

local function clamp01P(p, name)
	return clamp01(p[CH[name]])
end

local function buildFrame(a, s, root, hipsOffset, localRot, sk, com, handleRoot, bar, half, ikTargets, P, mirrored, events)
	local rig = a.rig
	local world = {}
	for _, j in JOINTS do
		world[j] = toWorld(root, sk[j].pos)
	end
	local axis = nil
	if a.lastRootRot then
		local d = qmul(root.rot, qconj(a.lastRootRot))
		local sn = math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z)
		if sn > 1e-4 then
			axis = vscale({ x = d.x, y = d.y, z = d.z }, (if d.w < 0 then -1 else 1) / sn)
		end
	end
	local barW = qrot(root.rot, bar)
	return {
		root = { pos = root.pos, rot = root.rot },
		hipsOffset = hipsOffset,
		["local"] = localRot,
		world = world,
		head = toWorld(root, Skeleton.headPos(rig, sk)),
		hands = { L = toWorld(root, Skeleton.handPos(rig, sk, "L")), R = toWorld(root, Skeleton.handPos(rig, sk, "R")) },
		handKinds = { L = a.hands.L.kind, R = a.hands.R.kind },
		com = toWorld(root, com),
		rotationAxis = axis,
		handle = {
			pos = if a.dropped then a.handleWorld else toWorld(root, handleRoot),
			rot = qfromTo({ x = 1, y = 0, z = 0 }, barW),
			visible = true,
			grips = { toWorld(root, vadd(handleRoot, vscale(bar, half))), toWorld(root, vsub(handleRoot, vscale(bar, half))) },
		},
		ikTargets = ikTargets,
		tuck = clamp01P(P, "tuck"),
		mirrored = mirrored,
		events = events,
		impact = if s.ext.justLanded and s.landing then s.landing.impactSpeed else 0,
		ragdoll = false,
	}
end

local function resetForRespawn(a)
	for _, sp in a.inertia do
		sp.x = 0
		sp.v = 0
	end
	a.last = nil
	a.rootOffT = 1
	a.ragdoll = nil
	a.dropped = false
	a.comOffset = nil
	a.frame = nil
	a.barWorld = nil
	a.lastRootRot = nil
	a.lastBoardFwd = nil
	a.prevWorld = nil
	a.prevHead = nil
	a.grab = nil
	a.lastGrab = nil
	a.grabW.x = 0
	a.tweakW.x = 0
	a.slideOnW.x = 0
	a.slideOnW.v = 0
	for _, sp in { a.landDrop, a.wobble, a.yank, a.bob, a.leadHips, a.leadShoulders, a.leadHead, a.preWind } do
		sp.x = 0
		sp.v = 0
	end
	for _, side in { "L", "R" } do
		local h = a.hands[side]
		h.goal = ""
		h.reach = 1
		h.ik.x = 1
		h.ik.v = 0
		h.bend = nil
	end
	for _, sp in { a.grabAssist.x, a.grabAssist.y, a.grabAssist.z } do
		sp.x = 0
		sp.v = 0
	end
end

function Animator.step(a, s, dt)
	local cfg = a.cfg
	local rig = a.rig
	a.time += dt
	local events = {}
	local mirrored = s.ext.toes < 0
	local lead = if mirrored then "R" else "L"
	local back = if mirrored then "L" else "R"
	local leadSign = if mirrored then -1 else 1

	local key = modeKey(s)
	local respawn = startsWith(a.key, "Crashed") and not startsWith(key, "Crashed")
	if respawn or not a.last then
		resetForRespawn(a)
	end
	local keyChanged = key ~= a.key and a.last ~= nil and not respawn
	if startsWith(key, "Crashed") and not startsWith(a.key, "Crashed") then
		table.insert(events, "crash")
	end
	if s.ext.justTookOff then
		table.insert(events, "pop")
	end
	if s.ext.justLanded then
		table.insert(events, "land")
	end
	if s.ext.ropeSnap then
		table.insert(events, "snap")
	end
	if s.handle == "Passing" and a.frame and a.frame.handKinds.L ~= "Passing" and a.frame.handKinds.R ~= "Passing" then
		table.insert(events, "pass")
	end

	local raw = canonicalPose(a, s, dt)
	local bt = blendTime(cfg, key)
	if keyChanged and a.last then
		a.inertiaFreq = 0.755 / bt
		for i = 1, NCH do
			a.inertia[i].x = a.last[i] - raw[i]
			a.inertia[i].v = a.lastVel[i]
		end
	end
	local out = table.create(NCH, 0)
	for i = 1, NCH do
		local off = a.inertia[i]
		stepSpring(off, 0, { freq = a.inertiaFreq, damping = 1 }, dt)
		out[i] = raw[i] + off.x
	end
	if a.last then
		for i = 1, NCH do
			a.lastVel[i] = if dt > 0 then (out[i] - a.last[i]) / dt else 0
		end
	end
	a.last = out
	a.key = key

	local P = if mirrored then Channels.mirrorPose(out) else table.clone(out)

	local rot = s.boardCFrame.rot
	if mirrored then
		rot = qmul(rot, qaxis(UPV, math.pi))
	end
	local st = s.state
	local airborne = st == "Airborne" or st == "WaterTrickAir"
	if st == "WaterTrickAir" and (s.trick.id == "Raley" or s.trick.id == "SBendL" or s.trick.id == "SBendR") then
		local e = clamp01(s.ext.extension / 90)
		rot = qmul(rot, qaxis({ x = 1, y = 0, z = 0 }, e * (105 + s.ext.edgeDegrees) * DEG))
	end
	local tweak = qeuler(P[CH["board.x"]], P[CH["board.y"]], P[CH["board.z"]])
	rot = qmul(rot, tweak)
	if keyChanged and a.lastRootRot then
		a.rootOff = qmul(a.lastRootRot, qconj(rot))
		a.rootOffT = 0
		a.rootOffDur = if startsWith(key, "Crashed") then cfg.Crash.LeadIn else bt * 1.5
	end
	if a.rootOffT < 1 then
		a.rootOffT = math.min(1, a.rootOffT + dt / a.rootOffDur)
		rot = qmul(qslerp(a.rootOff, qid(), EASE(a.rootOffT)), rot)
	end
	rot = qnorm(rot)
	local up = qrot(rot, UPV).y

	local fwd = qrot(rot, { x = leadSign, y = 0, z = 0 })
	local yawRate = 0
	if airborne then
		yawRate = s.ext.spinRate
	elseif a.lastBoardFwd and dt > 0 then
		local c = vcross(a.lastBoardFwd, fwd).y
		yawRate = (-math.asin(clamp(c / math.max(1e-6, vlen(a.lastBoardFwd) * vlen(fwd)), -1, 1)) / DEG) / dt
	end
	a.lastBoardFwd = fwd

	-- Layer 5 (spine): head first, shoulders, hips, board last; spotting.
	local S = cfg.Spin
	local rem = s.ext.spinRemaining
	local spotting = airborne and rem ~= 0 and math.abs(rem) < S.SpotSpin
	local turning = airborne or st == "OnFeature" or s.ext.spinOut ~= 0
	local function leadOf(k, max)
		if not turning then
			return 0
		end
		return clamp(if spotting then rem else yawRate * k, -max, max)
	end
	stepSpring(a.leadHips, if spotting then clamp(rem * 0.3, -S.MaxLeadHips, S.MaxLeadHips) else leadOf(S.LeadHips, S.MaxLeadHips), S.Lead, dt)
	stepSpring(a.leadShoulders, leadOf(S.LeadShoulders, S.MaxLeadShoulders), S.Lead, dt)
	stepSpring(a.leadHead, leadOf(S.LeadHead, S.MaxLeadHead), S.Lead, dt)
	stepSpring(a.preWind, S.PreWind * s.ext.preWind, S.Lead, dt)
	bump(P, "Hips.y", -a.leadHips.x * up)
	bump(P, "Waist.y", (-(a.leadShoulders.x - a.leadHips.x) + a.preWind.x) * up)

	-- Pelvis from the knees.
	local lt, ls = Skeleton.chainLengths(rig, "LHip", "LKnee", "LAnkle")
	local restHips = rig.rest.Hips
	local px, py, pz = P[CH["pelvis.x"]], P[CH["pelvis.y"]], P[CH["pelvis.z"]]
	local ySum = 0
	for _, side in { "L", "R" } do
		local hip = rig.rest[side .. "Hip"]
		local ankle = rig.rest[side .. "Ankle"]
		local d = legSpan(lt, ls, P[CH["knee" .. side]])
		local hx = hip.x + px - ankle.x
		local hz = hip.z + pz - ankle.z
		ySum += ankle.y + math.sqrt(math.max(1e-4, d * d - hx * hx - hz * hz)) - (hip.y - restHips.y)
	end
	-- Board to the hand: while grabbing, the pelvis drops toward the board until the hand reaches.
	local GA = a.grabAssist
	local assist = v3()
	if a.grab and a.frame and a.frame.mirrored == mirrored then
		local gh = if a.grab == "Nose" then lead else back
		local tgt = grabTarget(rig, a.grab, leadSign)
		local sh = toRootFrame(a.frame, a.frame.world[gh .. "Shoulder"])
		local ua, ub = Skeleton.chainLengths(rig, "LShoulder", "LElbow", "LWrist")
		local d = vsub(tgt, sh)
		local deficit = vlen(d) - (ua + ub + rig.handLength) * 0.95
		if deficit > 0 then
			assist = vscale(vnorm(d), deficit)
		end
	end
	local am = cfg.Hand.GrabAssistMax
	local aimA = { x = clamp(GA.x.x + assist.x, -am, am), y = clamp(GA.y.x + assist.y, -am, 0), z = clamp(GA.z.x + assist.z * 0.5, -am, am) }
	local assistSp = { freq = 2.5, damping = 1 }
	stepSpring(GA.x, if a.grab then aimA.x else 0, assistSp, dt)
	stepSpring(GA.y, if a.grab then aimA.y else 0, assistSp, dt)
	stepSpring(GA.z, if a.grab then aimA.z else 0, assistSp, dt)
	local minY = rig.rest.LAnkle.y + 0.26 - (rig.rest.LHip.y - restHips.y)
	local bodyPelvis = { x = restHips.x + px + GA.x.x, y = math.max(minY, ySum / 2 + py + GA.y.x), z = restHips.z + pz + GA.z.x }
	local tweakInv = qconj(tweak)
	local pelvis = qrot(tweakInv, bodyPelvis)
	local hipsOffset = vsub(pelvis, restHips)

	local loc = Skeleton.identityLocals()
	loc.Hips = qmul(tweakInv, chanQ(P, "Hips"))
	loc.Waist = chanQ(P, "Waist")
	for _, j in { "LShoulder", "LElbow", "LWrist", "RShoulder", "RElbow", "RWrist" } do
		loc[j] = chanQ(P, j)
	end

	for _, side in { "L", "R" } do
		local h = a.hands[side]
		local own = if side == "L" then 1 else -1
		local target = -cfg.Secondary.CounterSwing * (yawRate / 100)
		local bal = if s.feature then s.feature.balance else 0
		local zAdd, xAdd = 0, 0
		if st == "OnFeature" then
			zAdd = cfg.Feature.BalanceArm * bal * own
			if math.abs(bal) > cfg.Feature.WindmillAbove then
				xAdd = 60 * math.sin(2 * math.pi * cfg.Feature.WindmillHz * a.time)
			end
		end
		target = clamp(target, -60, 60)
		stepSpring(h.counter, target, cfg.Secondary.FreeArm, dt)
		if h.ik.x < 0.999 then
			local sh = side .. "Shoulder"
			local i = Channels.jointCh(sh)
			loc[sh] = qeuler(P[i] + xAdd, P[i + 1] + h.counter.x, P[i + 2] + zAdd)
		end
	end

	local sk = Skeleton.forwardKinematics(rig, hipsOffset, loc)

	-- Legs: hips to the bindings.
	local kp = cfg.Hand.KneePole
	for _, side in { "L", "R" } do
		local own = if side == "L" then 1 else -1
		local hipJ, kneeJ, ankJ = side .. "Hip", side .. "Knee", side .. "Ankle"
		local H = sk[hipJ].pos
		local A = rig.rest[ankJ]
		local pole = vnorm({ x = kp[1] * own, y = kp[2], z = kp[3] })
		local K = TwoBoneIK.solveMiddle(H, A, lt, ls, pole)
		local upper, lower = TwoBoneIK.chainRotations(rig.rest[hipJ], rig.rest[kneeJ], A, H, K, A, pole, pole)
		loc[hipJ] = qmul(qconj(sk.Hips.rot), upper)
		loc[kneeJ] = qmul(qconj(upper), lower)
		loc[ankJ] = qconj(lower)
	end

	-- Root placement (centre-of-mass pivot in the air).
	sk = Skeleton.forwardKinematics(rig, hipsOffset, loc)
	local com0 = Skeleton.centreOfMass(rig, sk)
	local rootPos = s.boardCFrame.pos
	if airborne and cfg.Physics.ComPivot then
		if not a.comOffset then
			a.comOffset = if a.frame then vsub(a.frame.com, a.frame.root.pos) else qrot(rot, com0)
		end
		local w = 1 - EASE(clamp01((s.trick.phase - 0.82) / 0.18))
		rootPos = vadd(rootPos, vscale(vsub(a.comOffset, qrot(rot, com0)), w))
	else
		a.comOffset = nil
	end
	local root = { pos = rootPos, rot = rot }
	local rootInv = qconj(rot)

	-- Head aim.
	local vel = s.velocity
	local hv = { x = vel.x, y = 0, z = vel.z }
	local look = if vlen(hv) > 1 then vnorm(hv) else vnorm({ x = fwd.x, y = 0, z = fwd.z })
	local heel = qrot(rot, { x = 0, y = 0, z = -1 })
	local ropeDirW = vnorm(vsub(s.ext.carrier, toWorld(root, pelvis)))
	if st == "Riding" or st == "WaterTrickLoad" or st == "Landing" then
		local th = cfg.Head.CutLook * s.edge * DEG
		look = vnorm(vadd(vscale(look, math.cos(th)), vscale(heel, math.sin(th))))
	elseif st == "RidingBlind" or s.trick.id == "Raley" then
		look = ropeDirW
	end
	if airborne and math.abs(s.ext.spinRate) > 1 and not spotting then
		look = aboutUp(vnorm({ x = fwd.x, y = 0, z = fwd.z }), -a.leadHead.x)
	end
	if airborne and (s.trick.id == "FrontFlip" or s.trick.id == "Tantrum") then
		look = vnorm(vadd(look, { x = 0, y = -0.6, z = 0 }))
	end
	local waistRot = sk.Waist.rot
	local lookLocal = qrot(qconj(waistRot), qrot(rootInv, look))
	local yawT = clamp(math.atan2(lookLocal.x, lookLocal.z) / DEG, -cfg.Head.MaxYaw, cfg.Head.MaxYaw)
	local pitchT = clamp(
		math.atan2(-lookLocal.y, math.sqrt(lookLocal.x * lookLocal.x + lookLocal.z * lookLocal.z)) / DEG,
		-cfg.Head.MaxPitch,
		cfg.Head.MaxPitch
	)
	stepSpring(a.aimYaw, yawT, cfg.Head.Aim, dt)
	stepSpring(a.aimPitch, pitchT, cfg.Head.Aim, dt)
	local aimW = clamp01(P[CH.aim])
	do
		local i = Channels.jointCh("Neck")
		loc.Neck = qeuler(P[i] + aimW * a.aimPitch.x, P[i + 1] + aimW * a.aimYaw.x, P[i + 2])
	end
	sk = Skeleton.forwardKinematics(rig, hipsOffset, loc)

	-- Hands: grip states.
	local dropped = s.handle == "Dropped" or st == "Crashed"
	local grabHand = nil
	if a.grab and a.time - a.grabStart >= cfg.Grab.HandDelay then
		grabHand = if a.grab == "Nose" then lead else back
	end
	local goals = { L = "handle", R = "handle" }
	if dropped then
		goals.L = "free"
		goals.R = "free"
	elseif grabHand then
		goals[grabHand] = a.grab
	elseif s.handle == "Behind" then
		goals[back] = "free"
	end

	-- The handle: a real object on the rope.
	local H = cfg.Handle
	local handleRoot
	if dropped then
		a.dropped = true
		local toC = vsub(s.ext.carrier, a.handleWorld)
		local acc = vsub(vscale(vnorm(toC), H.DropPull * clamp01(vlen(toC) / 20)), vscale(a.handleVel, H.DropDrag))
		a.handleVel = vadd(a.handleVel, vscale(vadd(acc, { x = 0, y = -9.81 * 0.3, z = 0 }), dt))
		a.handleWorld = vadd(a.handleWorld, vscale(a.handleVel, dt))
		if a.handleWorld.y < 0.02 then
			a.handleWorld.y = 0.02
			a.handleVel.y = math.max(0, a.handleVel.y)
		end
		handleRoot = qrot(rootInv, vsub(a.handleWorld, root.pos))
	else
		a.dropped = false
		local rd = qrot(rootInv, ropeDirW)
		local wf = clamp01(rd.x * leadSign * 1.4)
		local fb = H.FrontBias
		local bb = H.BlindBias
		local bw = clamp01(a.blindW.x)
		local pull = clamp01(s.tension / H.FullPullTension)
		if s.trick.id == "Raley" or s.trick.id == "SBendL" or s.trick.id == "SBendR" then
			pull = math.max(pull, clamp01(s.ext.extension / 60))
		end
		local slackSag = if st == "Riding" or st == "WaterTrickLoad" then a.slackW.x else 0
		local target = vadd(sk.Hips.pos, vscale(rd, H.RopeRadius + H.MaxReach * pull))
		local id = s.trick.id
		local inv = id == "FrontFlip" or id == "Tantrum" or id == "Backroll" or id == "Frontroll" or id == "Mobe" or id == "SBendL" or id == "SBendR"
		stepSpring(a.invertW, if airborne and inv then 1 else 0, { freq = 3, damping = 1 }, dt)
		local iw = clamp01(a.invertW.x)
		if iw > 0 then
			local hipSpot = vadd(sk.Hips.pos, qrot(sk.Hips.rot, { x = 0.14 * leadSign, y = -0.04, z = 0.3 }))
			target = vlerp(target, hipSpot, iw)
		end
		target = vadd(target, vscale({ x = fb[1] * leadSign, y = fb[2], z = fb[3] }, wf * (1 - bw) * (1 - iw)))
		target = vadd(target, vscale({ x = bb[1] * leadSign, y = bb[2], z = bb[3] }, bw))
		target = vadd(target, { x = P[CH["handle.x"]], y = P[CH["handle.y"]] - H.SlackSag * slackSag, z = P[CH["handle.z"]] })
		local offW = qrot(rot, vsub(target, sk.Hips.pos))
		if not a.frame or respawn then
			a.handleOff.x.x = offW.x
			a.handleOff.y.x = offW.y
			a.handleOff.z.x = offW.z
		end
		local o = {
			x = stepSpring(a.handleOff.x, offW.x, H.Follow, dt),
			y = stepSpring(a.handleOff.y, offW.y, H.Follow, dt),
			z = stepSpring(a.handleOff.z, offW.z, H.Follow, dt),
		}
		handleRoot = vadd(sk.Hips.pos, qrot(rootInv, o))
	end

	-- Bar across the rope, horizontal; grips either side of the middle.
	local rdRoot = qrot(rootInv, if dropped then vnorm(vsub(s.ext.carrier, a.handleWorld)) else ropeDirW)
	local bar = vscale(vcross(rdRoot, qrot(rootInv, UPV)), leadSign)
	if vlen(bar) < 1e-4 then
		bar = if a.barWorld then qrot(rootInv, a.barWorld) else { x = 0, y = 0, z = 1 }
	end
	bar = vnorm(bar)
	local prevBar = if a.barWorld then qrot(rootInv, a.barWorld) else vcross(rdRoot, { x = 0, y = leadSign, z = 0 })
	if vdot(bar, prevBar) < 0 then
		bar = vscale(bar, -1)
	end
	a.barWorld = qrot(rot, bar)
	local half = rig.gripSpacing / 2
	local holders = {}
	for _, sd in { "L", "R" } do
		if goals[sd] == "handle" then
			table.insert(holders, sd)
		end
	end
	local function grip(k)
		return vadd(handleRoot, vscale(bar, k * half))
	end
	local la, lb = Skeleton.chainLengths(rig, "LShoulder", "LElbow", "LWrist")
	local armReach = (la + lb + rig.handLength) * 0.985
	for _ = 1, 2 do
		for _, sd in holders do
			local shoulder = sk[sd .. "Shoulder"].pos
			local g = if #holders == 2 then grip(gripSign(a, sd, lead)) else handleRoot
			local d = vsub(g, shoulder)
			local len = vlen(d)
			if len > armReach then
				handleRoot = vsub(handleRoot, vscale(d, (len - armReach) / len))
			end
		end
	end
	if not dropped then
		local o = qrot(rot, vsub(handleRoot, sk.Hips.pos))
		a.handleOff.x.x = o.x
		a.handleOff.y.x = o.y
		a.handleOff.z.x = o.z
		local hw = toWorld(root, handleRoot)
		a.handleVel = if a.frame and dt > 0 then vscale(vsub(hw, a.handleWorld), 1 / dt) else v3()
		a.handleWorld = hw
	end
	if #holders == 2 then
		local lsp, bsp = sk[lead .. "Shoulder"].pos, sk[back .. "Shoulder"].pos
		local dl0 = vlen(vsub(grip(1), lsp)) + vlen(vsub(grip(-1), bsp))
		local dl1 = vlen(vsub(grip(-1), lsp)) + vlen(vsub(grip(1), bsp))
		if not a.gripSwap and dl1 < dl0 - 0.06 then
			a.gripSwap = true
		elseif a.gripSwap and dl0 < dl1 - 0.06 then
			a.gripSwap = false
		end
	end

	-- Arms: IK to the goals, reaching along a curve.
	local ikTargets = {}
	local ep = cfg.Hand.ElbowPole
	local passing = s.handle == "Passing"
	for _, side in { "L", "R" } do
		local h = a.hands[side]
		local own = if side == "L" then 1 else -1
		local goal = goals[side]
		local target = nil
		if goal == "handle" then
			target = if #holders == 2 then grip(gripSign(a, side, lead)) else handleRoot
		elseif goal ~= "free" then
			target = grabTarget(rig, goal, leadSign)
		end
		local goalKey = goal
		if goal == "handle" then
			goalKey = "handle" .. #holders .. (if #holders == 2 then tostring(gripSign(a, side, lead)) else "")
		end
		if goalKey ~= h.goal then
			h.from = if a.frame then h.pos elseif target then target else h.pos
			h.reach = if a.frame then 0 else 1
			h.goal = goalKey
			h.reachTime = if target then math.max(cfg.Hand.ReachTime, vlen(vsub(target, h.from)) / cfg.Hand.ReachSpeed) else cfg.Hand.ReachTime
		end
		stepSpring(h.ik, if target then 1 else 0, cfg.Secondary.FreeArm, dt)
		h.reach = math.min(1, h.reach + dt / h.reachTime)
		local shJ, elJ, wrJ = side .. "Shoulder", side .. "Elbow", side .. "Wrist"
		if target then
			local T = target
			if h.reach < 1 then
				local e = EASE(h.reach)
				local mid = vlerp(h.from, target, e)
				local outDir = vnorm(vsub(mid, sk.Hips.pos))
				T = vadd(mid, vscale(outDir, cfg.Hand.ReachArc * vlen(vsub(target, h.from)) * 4 * e * (1 - e)))
			end
			table.insert(ikTargets, toWorld(root, T))
			local Sp = sk[shJ].pos
			local pole = qrot(sk.Waist.rot, vnorm({ x = ep[1] * own, y = ep[2], z = ep[3] }))
			if h.bend then
				local want = vnorm(vadd(pole, vscale(h.bend, cfg.Hand.ElbowCoherence)))
				local ang = math.acos(clamp(vdot(h.bend, want), -1, 1))
				local maxA = cfg.Hand.ElbowTurnRate * DEG * dt
				if ang > maxA and ang > 1e-6 then
					local axis = vcross(h.bend, want)
					pole = if vlen(axis) > 1e-9 then qrot(qaxis(vnorm(axis), maxA), h.bend) else h.bend
				else
					pole = want
				end
			end
			local restHand = vadd(rig.rest[wrJ], vscale(vnorm(vsub(rig.rest[wrJ], rig.rest[elJ])), rig.handLength))
			local E = TwoBoneIK.solveMiddle(Sp, T, la, lb + rig.handLength, pole)
			do
				local mid = vlerp(Sp, T, la / (la + lb + rig.handLength))
				local bd = vsub(E, mid)
				if vlen(bd) > 1e-3 then
					h.bend = vnorm(bd)
				end
			end
			local toT = vsub(T, E)
			local Tc = vadd(E, vscale(vnorm(toT), lb + rig.handLength))
			local upper, lower = TwoBoneIK.chainRotations(rig.rest[shJ], rig.rest[elJ], restHand, Sp, E, Tc, pole, pole)
			local ikShoulder = qmul(qconj(sk.Waist.rot), upper)
			local ikElbow = qmul(qconj(upper), lower)
			local w = clamp01(h.ik.x)
			loc[shJ] = qslerp(loc[shJ], ikShoulder, w)
			loc[elJ] = qslerp(loc[elJ], ikElbow, w)
		end
		if not target then
			h.kind = "Free"
		elseif h.reach < 1 then
			h.kind = "Reaching"
		elseif goal == "handle" then
			h.kind = if passing then "Passing" else "Handle"
		else
			h.kind = "Grab"
		end
	end

	-- Final skeleton.
	sk = Skeleton.forwardKinematics(rig, hipsOffset, loc)
	for _, side in { "L", "R" } do
		a.hands[side].pos = Skeleton.handPos(rig, sk, side)
	end
	local com = Skeleton.centreOfMass(rig, sk)

	local frame = buildFrame(a, s, root, hipsOffset, loc, sk, com, handleRoot, bar, half, ikTargets, P, mirrored, events)

	-- Crash: lead-in, then the ragdoll.
	if st == "Crashed" and s.ext.modeTime >= cfg.Crash.LeadIn then
		if not a.ragdoll then
			a.ragdoll = Ragdoll.create(frame, a.prevWorld, a.prevHead, dt, cfg)
			table.insert(events, "splash")
		end
		Ragdoll.step(a.ragdoll, cfg, dt)
		local rp = Ragdoll.pose(rig, a.ragdoll)
		local rsk = Skeleton.forwardKinematics(rig, rp.hipsOffset, rp["local"])
		frame = buildFrame(
			a,
			s,
			rp.root,
			rp.hipsOffset,
			rp["local"],
			rsk,
			Skeleton.centreOfMass(rig, rsk),
			qrot(qconj(rp.root.rot), vsub(a.handleWorld, rp.root.pos)),
			bar,
			half,
			{},
			P,
			mirrored,
			events
		)
		frame.ragdoll = true
	end

	a.prevWorld = frame.world
	a.prevHead = frame.head
	a.lastRootRot = frame.root.rot
	a.frame = frame
	return frame
end

return Animator
