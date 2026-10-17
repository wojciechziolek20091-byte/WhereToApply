-- Legal moves of the rider state machine. Mirrors src/sim/fsm.ts.
local Fsm = {}

Fsm.TRANSITIONS = {
	riding = { "waterTrickLoad", "airborne", "onKicker", "onSafety", "onFeature", "crashed" },
	ridingBlind = { "riding", "airborne", "crashed" },
	waterTrickLoad = { "riding", "waterTrickAir", "airborne", "onKicker", "onSafety", "onFeature", "crashed" },
	waterTrickAir = { "landing", "onFeature", "onSafety", "crashed" },
	airborne = { "landing", "onFeature", "onKicker", "onSafety", "crashed" },
	onKicker = { "airborne", "onFeature", "riding", "crashed" },
	onSafety = { "airborne", "onFeature", "crashed" },
	onFeature = { "airborne", "onKicker", "riding", "crashed" },
	landing = { "riding", "ridingBlind", "onKicker", "onSafety", "onFeature", "crashed" },
	crashed = { "riding" },
}

function Fsm.canTransition(from, to)
	return table.find(Fsm.TRANSITIONS[from], to) ~= nil
end

-- The one place the rider's mode changes. With debug.enabled, illegal moves error.
function Fsm.transition(s, to, reason)
	local r = s.rider
	local from = r.mode
	if from == to then
		return
	end
	if s.cfg.debug.enabled then
		if not Fsm.canTransition(from, to) then
			error(`illegal transition {from} -> {to} ({reason})`)
		end
		table.insert(s.events, { type = "transition", tick = s.tick, from = from, to = to, reason = reason })
	end
	r.mode = to
	r.modeTime = 0
end

function Fsm.onWater(mode)
	return mode == "riding" or mode == "ridingBlind" or mode == "waterTrickLoad" or mode == "landing"
end

function Fsm.inAir(mode)
	return mode == "airborne" or mode == "waterTrickAir"
end

return Fsm
