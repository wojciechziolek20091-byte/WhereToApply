-- RiderRig on a real RiderBuilder rig, under the mock: chaining the Motor6Ds
-- (Part0 * C0 * Transform) must put every bone where the animator put the
-- joint, in studs, for several poses and both stances. Appended to the mock
-- and the shared bundle by tests/robloxRig.test.ts.
local failures = 0
local function check(cond, msg)
	if not cond then
		failures += 1
		print("FAIL: " .. msg)
	end
end
local mps = RiderBuilder.Config.Rig.MetresPerStud
for _, stance in { 1, -1 } do
	for _, name in { "Cruise", "Heelside", "FrontFlip", "Indy", "Backboard", "Raley", "CrashUnderRotated" } do
		local opts = { palette = "Sheet" }
		local model = RiderBuilder.build(opts)
		local rig = RiderRig.new(model, mps)
		local a = Anim.Animator.create(RiderBuilder.rigDef(opts))
		local sc = Anim.TestDriver.SCENARIOS[name]
		local scenario = sc
		if stance < 0 then
			scenario = {
				duration = sc.duration,
				at = function(u, p, o)
					local s = sc.at(u, p, o)
					s.stance = "Goofy"
					s.ext.toes = -1
					return s
				end,
			}
		end
		local frame = Anim.TestDriver.playTo(a, scenario, 0.55, { x = 4, y = 0, z = -3 })
		RiderRig.apply(rig, frame)
		-- Walk the chain from the Root through the Motor6Ds.
		local world = { Root = model.PrimaryPart.CFrame }
		local motors = rig.motors
		for _, j in Anim.Skeleton.JOINTS do
			local m = motors[j]
			local parent = Anim.Skeleton.PARENT[j]
			world[j] = world[parent] * m.C0 * m.Transform * m.C1:Inverse()
			local want = RiderRig.stud(rig, frame.world[j])
			local got = world[j].Position
			local err = (got - want).Magnitude
			check(err < 1e-3, `{name} stance {stance}: {j} off by {string.format("%.4f", err)} studs`)
		end
		local hp = model:FindFirstChild("Handle").PrimaryPart.CFrame.Position
		check((hp - RiderRig.stud(rig, frame.handle.pos)).Magnitude < 1e-6, `{name}: handle not where the frame says`)
	end
end
if failures == 0 then print("RIG OK") else error(`{failures} FAILURES`) end
