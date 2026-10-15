-- Raw buttons for one tick, and the memory that turns them into presses,
-- releases, taps and grab chords. Mirrors src/sim/input.ts.
--   steer   A/D: -1 = A (left), +1 = D (right of travel / clockwise from above)
--   pop     Space held          forward  W held      back  S held
--   pass    Q held (handle pass)
--   grab    E held              grabMod  "stalefish" (R) / "nose" (N) / "tail" (T) or nil
--   armsOut Shift held          letGo    X held
local Input = {}

function Input.neutralInput()
	return {
		steer = 0,
		pop = false,
		forward = false,
		back = false,
		pass = false,
		grab = false,
		grabMod = nil,
		armsOut = false,
		letGo = false,
	}
end

function Input.createInputMemory()
	return {
		prev = Input.neutralInput(),
		popPressed = false,
		popReleased = false,
		popHeldTime = 0,
		passPressed = false,
		steerDir = 0,
		steerHeldTime = 0,
		lastSteerDir = 0,
		steerAge = 0,
		steerTap = 0,
		grabTime = 0,
		grabChoice = nil,
	}
end

local function steerDirOf(steer)
	if steer > 0.5 then
		return 1
	elseif steer < -0.5 then
		return -1
	end
	return 0
end

-- Advance the memory with this tick's input. E alone is an indy once the chord
-- window has passed; R, N or T held when E goes down or within the window picks
-- stalefish, nose or tail instead.
function Input.updateInputMemory(m, input, cfg, dt)
	local prev = m.prev
	m.popPressed = input.pop and not prev.pop
	m.popReleased = not input.pop and prev.pop
	if m.popPressed then
		m.popHeldTime = 0
	elseif input.pop then
		m.popHeldTime += dt
	end
	m.passPressed = input.pass and not prev.pass

	local dir = steerDirOf(input.steer)
	m.steerTap = 0
	if dir ~= m.steerDir then
		if m.steerDir ~= 0 and m.steerHeldTime < cfg.feature.tapTime then
			m.steerTap = m.steerDir
		end
		m.steerDir = dir
		m.steerHeldTime = 0
	elseif dir ~= 0 then
		m.steerHeldTime += dt
	end
	if dir ~= 0 then
		m.lastSteerDir = dir
		m.steerAge = 0
	else
		m.steerAge += dt
	end

	if not input.grab then
		m.grabTime = 0
		m.grabChoice = nil
	else
		if not prev.grab then
			m.grabTime = 0
		else
			m.grabTime += dt
		end
		if m.grabChoice == nil or (m.grabChoice == "indy" and input.grabMod and m.grabTime <= cfg.grab.chordWindow) then
			if input.grabMod and m.grabTime <= cfg.grab.chordWindow then
				m.grabChoice = input.grabMod
			elseif m.grabTime >= cfg.grab.chordWindow then
				m.grabChoice = "indy"
			end
		end
	end
	m.prev = table.clone(input)
end

return Input
