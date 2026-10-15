-- Public entry point of the Luau simulation: a line-by-line port of src/sim
-- (TypeScript). Same functions, same state fields, same numbers; checked by
-- tests/parity.test.ts. Pure Luau: no Instances, no Roblox services, no
-- math.random, no os.clock, so it runs anywhere (server, client, plain luau CLI).
--
-- Rojo maps this folder to ReplicatedStorage.WakeShared.Sim:
--   local Sim = require(ReplicatedStorage.WakeShared.Sim)
--   local run = Sim.Session.createRun()
--   Sim.Session.stepRun(run, Sim.Input.neutralInput())
local Sim = {
	Actions = require(script.Actions),
	Air = require(script.Air),
	Cable = require(script.Cable),
	Config = require(script.Config),
	DetMath = require(script.DetMath),
	Edge = require(script.Edge),
	Features = require(script.Features),
	Fsm = require(script.Fsm),
	Handle = require(script.Handle),
	Hydro = require(script.Hydro),
	Input = require(script.Input),
	Landing = require(script.Landing),
	Noise = require(script.Noise),
	OnFeature = require(script.OnFeature),
	Park = require(script.Park),
	ParkLayout = require(script.ParkLayout),
	Pop = require(script.Pop),
	Posture = require(script.Posture),
	Rng = require(script.Rng),
	Rope = require(script.Rope),
	Rotation = require(script.Rotation),
	Scalar = require(script.Scalar),
	ScoringCombo = require(script.ScoringCombo),
	ScoringJudges = require(script.ScoringJudges),
	ScoringMetrics = require(script.ScoringMetrics),
	Session = require(script.Session),
	Step = require(script.Step),
	Stepper = require(script.Stepper),
	TricksClassify = require(script.TricksClassify),
	TricksData = require(script.TricksData),
	Vec = require(script.Vec),
	WaterTrick = require(script.WaterTrick),
	World = require(script.World),
}

-- Shortcuts matching src/sim/index.ts.
Sim.DT = Sim.Config.DT
Sim.DEFAULT_CONFIG = Sim.Config.DEFAULT_CONFIG
Sim.createRun = Sim.Session.createRun
Sim.stepRun = Sim.Session.stepRun
Sim.createSim = Sim.World.createSim
Sim.stepSim = Sim.Step.stepSim
Sim.transition = Sim.Fsm.transition
Sim.scoreCombo = Sim.ScoringCombo.scoreCombo

return Sim
