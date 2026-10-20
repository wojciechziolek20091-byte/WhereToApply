-- Twin of src/sim/featureRide/entryResolver.ts (EntryResolver, feature riding
-- spec sections 3 and 4): every way onto a feature resolves here.
--   startEntry     the water pop near a feature: approach kept, side hop added
--   crossEdge      flying onto a part across its front or side edge: clearance
--   resolveLanding contact with a main: roll, snap, balance width, impact, skid
local DetMath = require(script.Parent.DetMath)
local Edge = require(script.Parent.Edge)
local FeatureRotation = require(script.Parent.FeatureRideFeatureRotation)
local Features = require(script.Parent.Features)
local FeatureShapes = require(script.Parent.FeatureShapes)
local Landing = require(script.Parent.Landing)
local Scalar = require(script.Parent.Scalar)
local SlideController = require(script.Parent.FeatureRideSlideController)
local SlideOnConfig = require(script.Parent.FeatureRideSlideOnConfig)
local Vec = require(script.Parent.Vec)

local EntryResolver = {}

-- Folded angle between a direction and a feature axis (rad, 0..PI/2).
local function axisAngle(a)
	local w = math.abs(Scalar.wrapAngle(a))
	return if w > math.pi / 2 then math.pi - w else w
end

local function findFeature(s, id)
	for _, x in s.features do
		if x.def.id == id then
			return x
		end
	end
	return nil
end

function EntryResolver.startEntry(s, air, steer, charge)
	local r, cfg = s.rider, s.cfg
	local a = r.approach
	if not a then
		return
	end
	local R = cfg.featureRide
	local f = findFeature(s, a.featureId)
	if not f then
		return
	end
	-- A side approach pops off its edge (v2 spec 1.1): only a front approach slips out.
	local slipping = a.side == "front" and a.edgeAge <= R.Landing.SlipWindow
	local slip = if a.side == "heelside"
		then R.Landing.SlipRollHeelside
		elseif a.side == "toeside" then R.Landing.SlipRollToeside
		else R.Landing.SlipRollFront
	local hop = 0
	-- The hop toward it, unless the edge's release already carries the slide-on there.
	if not air.slideOn and a.side ~= "front" and a.sideGap <= R.SideEntry.MaxLateral and steer ~= 0 and steer == a.featureSide then
		hop = Scalar.lerp(R.SideEntry.HopLateralVMin, R.SideEntry.HopLateralVMax, charge)
		r.vel = Vec.add(r.vel, Vec.scale(Vec.rightOf(f.heading), -Scalar.sign(a.lateral) * hop))
	end
	air.entry = { featureId = a.featureId, side = a.side, angle = axisAngle(a.angle), hop = hop, roll = if slipping then slip else 0 }
end

local function partU0(f, part)
	local u0 = math.huge
	for _, q in f.shape.pieces do
		if q.part == part and q.axis == "u" and q.u0 < u0 then
			u0 = q.u0
		end
	end
	return u0
end

function EntryResolver.crossEdge(s, air, f, l, surface, part)
	local r, cfg = s.rider, s.cfg
	local E = cfg.featureRide.Entry
	local p = surface.piece
	local vu = Vec.dot(r.vel, Vec.forwardOf(f.heading))
	local vv = Vec.dot(r.vel, Vec.rightOf(f.heading))
	local off = l.v - FeatureShapes.pieceCentre(p, l.u)
	local inward = -Scalar.sign(off) * vv
	local tFront = if vu > 0 then (l.u - partU0(f, p.part)) / vu else math.huge
	local tSide = if inward > 0 then (p.width / 2 - math.abs(off)) / inward else math.huge
	local side = if tSide < tFront then (if off >= 0 then 1 else -1) else 0
	air.crossing = { featureId = f.def.id, part = part, side = side, height = surface.height }
	local short = surface.height + E.Clearance - r.pos.y
	local S = cfg.slideOn
	-- From the side (v2 spec 2) a board a little low scrapes up the edge; well below it the nose digs in.
	local allow = E.TailClipTolerance + (if side ~= 0 then S.NoseTolerance.Rounded + S.ScrapeBand else 0)
	if short > allow then
		return if side == 0 then "shortOllie" else "noseDig"
	end
	if short > 0 then
		air.tailClip = true
	end
	return nil
end

function EntryResolver.balanceHalfWidth(p, s)
	local S = s.cfg.featureRide.SideEntry
	if p.profile == "Round" then
		return S.PipeHalfWidth
	end
	if p.width < S.RailMaxWidth then
		return S.RailHalfWidth
	end
	return math.max((p.width - S.BoxEdgeMargin) / 2, S.RailHalfWidth)
end

function EntryResolver.boardYawInAir(air)
	return air.takeoffHeading + air.rot.spinAngle
end

function EntryResolver.resolveLanding(s, air, f, surface, l, heading)
	local r, cfg = s.rider, s.cfg
	local L = cfg.featureRide.Landing
	local S = cfg.featureRide.SideEntry
	local part = f.def.id .. ":" .. tostring(surface.piece.part)
	local crossSide = if air.crossing and air.crossing.part == part then air.crossing.side else 0
	local kind = if air.pendingEntry
		then air.pendingEntry
		elseif air.featureId ~= nil and (air.featureId ~= f.def.id or (#air.cleared > 0 and air.cleared[1] ~= part)) then "transfer"
		elseif crossSide ~= 0 then "sideOllieOn"
		else "ollieOn"
	local yaw = Scalar.wrapAngle(EntryResolver.boardYawInAir(air) - heading)
	-- From the side any angle lines up into a slide (v2 spec 2); else the nearest 90.
	-- From the side (or popped beside the feature) any angle lines up into a slide (v2 spec 2).
	local aligned = if crossSide ~= 0 or air.sideTurned or air.noFlip then SlideOnConfig.alignSlide(yaw, cfg) else nil
	local boardAngle = if aligned then aligned.boardAngle else Scalar.round(yaw / (math.pi / 2)) * (math.pi / 2)
	local level = table.clone(air)
	level.rot = table.clone(air.rot)
	level.rot.spinAngle = Scalar.round(air.rot.spinAngle / math.pi) * math.pi
	local landing = Landing.evaluateLanding(r, level, surface.normal, cfg)
	local result = {
		kind = kind,
		success = false,
		boardAngle = boardAngle,
		inRotation = air.rot.spinAngle - air.spinStart,
		quality = landing.quality,
		failReason = nil,
		sketchy = air.tailClip,
		balance = 0,
		speedKeep = if air.tailClip then cfg.featureRide.Entry.TailClipSpeedKeep else 1,
		slide = nil,
		carry = 0,
		landing = landing,
	}
	local function fail(reason)
		result.failReason = reason
		result.quality = 0
		return result
	end
	if landing.crash and landing.crash ~= "hardLanding" then
		return fail(landing.crash)
	end
	local hit = if air.tailClip then cfg.featureRide.Entry.TailClipHit else 0

	-- 1. Base flat on the surface.
	local roll = if air.entry then air.entry.roll else 0
	if roll > L.MaxRoll then
		return fail("slippedOut")
	end
	if roll > L.SketchyRoll then
		result.sketchy = true
		hit += L.RollHit
	end
	-- 2. Board angle to the axis (from the side, alignSlide: never a crash).
	local offAngle = math.abs(yaw - boardAngle)
	if aligned then
		hit += aligned.hit
	elseif offAngle > L.SketchyAngle then
		return fail("badAngle")
	elseif offAngle > L.SnapTolerance then
		result.sketchy = true
		hit += L.AngleHit
	end
	-- 3. Across the feature.
	local off = l.v - FeatureShapes.pieceCentre(surface.piece, l.u)
	local half = EntryResolver.balanceHalfWidth(surface.piece, s)
	if crossSide ~= 0 then
		-- From the side: what it carries across keeps going (it may slide off the far side, v2 spec 3 C).
		result.carry = math.max(0, -crossSide * Vec.dot(r.vel, Vec.rightOf(heading)))
		if math.abs(off) > half then
			result.sketchy = true
			hit += S.OvershootHit
		end
	elseif math.abs(off) > half then
		local recover = if surface.piece.profile == "Round" then 0 else S.OvershootRecover
		if math.abs(off) - half > recover then
			return fail("fellOffFeature")
		end
		result.sketchy = true
		hit += S.OvershootHit
	end
	-- 4. Impact.
	if landing.impact > L.CrashImpact then
		return fail("hardLanding")
	end
	if landing.impact > L.HardImpact then
		hit += (L.ImpactHit * (landing.impact - L.HardImpact)) / (L.CrashImpact - L.HardImpact)
	end
	-- 5. Skid.
	if math.abs(air.rot.spinRate) > L.SkidRate then
		result.sketchy = true
		hit += L.SkidHit
	end
	result.success = true
	if crossSide ~= 0 and SlideController.isBoardslide(boardAngle) then
		local toes = Edge.toeSign({ stance = r.stance, switchStance = air.takeoffSwitch })
		result.slide = FeatureRotation.sideEntrySlide(EntryResolver.boardYawInAir(air), heading, crossSide, toes, air.takeoffHeading)
	end
	local dir = if off ~= 0 then Scalar.sign(off) elseif crossSide ~= 0 then crossSide else 1
	result.balance = Scalar.clamp(dir * hit, -L.MaxHit, L.MaxHit)
	if result.sketchy then
		result.quality *= 0.6
	end
	return result
end

function EntryResolver.safetyPitchError(air, slope)
	return math.abs(DetMath.atan(slope) - Scalar.wrapAngle(air.rot.flipAngle))
end

function EntryResolver.landedInGap(s, air)
	if not air.pendingEntry or air.featureId == nil then
		return false
	end
	local f = findFeature(s, air.featureId)
	if not f then
		return false
	end
	local l = Features.toLocal(f, s.rider.pos)
	local mainU0 = math.huge
	for _, q in f.shape.pieces do
		if q.slide and q.axis == "u" and q.u0 < mainU0 then
			mainU0 = q.u0
		end
	end
	return l.u >= f.shape.uMin and l.u <= mainU0 and l.v >= f.shape.vMin and l.v <= f.shape.vMax
end

return EntryResolver
