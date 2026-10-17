-- Twin of src/sim/featureRide/exitResolver.ts (ExitResolver, feature riding
-- spec 6): exit kinds (ride-off, pop-off, side pop, hop, sketchy), the line
-- of slides carried through transfers, the ride-off turn assist, and the
-- featureLine event on the water.
local Config = require(script.Parent.Config)
local Scalar = require(script.Parent.Scalar)

local DT = Config.DT
local ExitResolver = {}

function ExitResolver.popKind(s, remaining, steerDir)
	if steerDir ~= 0 then
		return "sidePop"
	end
	return if remaining <= s.cfg.featureRide.Exit.PopOffZone then "popOff" else "hop"
end

function ExitResolver.exitOf(j, kind, switchStance)
	local jibs = table.clone(j.chain)
	table.insert(jibs, j)
	return { kind = kind, jibs = jibs, boardAngle = j.boardAngle, switchStance = switchStance }
end

function ExitResolver.stepExitAssist(s, air, input)
	local E = s.cfg.featureRide.Exit
	if not air.exit or air.exit.kind ~= "rideOff" or input.steer ~= 0 or air.rot.spinRate ~= 0 then
		return
	end
	local off = Scalar.wrapHalfTurn(air.rot.spinAngle)
	if off == 0 or math.abs(off) > E.AssistAngle then
		return
	end
	air.rot.spinAngle = Scalar.approach(air.rot.spinAngle, air.rot.spinAngle - off, E.AssistRate * DT)
end

function ExitResolver.finishLine(s, air, landing)
	if not air.exit then
		return
	end
	table.insert(s.events, { type = "featureLine", tick = s.tick, exit = air.exit, air = air, landing = landing })
end

return ExitResolver
