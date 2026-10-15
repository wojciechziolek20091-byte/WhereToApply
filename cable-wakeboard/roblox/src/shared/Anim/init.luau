-- The rider animation system (Luau twin of src/anim): layered procedural
-- poses, two-bone IK, springs, inertialized blends, a shared ragdoll and the
-- replication packet. Pure Luau (no Roblox APIs), so it runs in the plain
-- luau CLI for the parity test; the client applies frames to Motor6Ds.
--   local Anim = require(ReplicatedStorage.WakeShared.Anim)
--   local a = Anim.Animator.create(rig)
--   local frame = Anim.Animator.step(a, Anim.Adapter.fromSim(sim, events, prev), dt)
return {
	AnimConfig = require(script.AnimConfig),
	Adapter = require(script.RiderAnimStateAdapter),
	Animator = require(script.Animator),
	Channels = require(script.Channels),
	Clip = require(script.Clip),
	Quat = require(script.Quat),
	Ragdoll = require(script.Ragdoll),
	Replication = require(script.AnimReplication),
	RiderPoses = require(script.RiderPoses),
	Skeleton = require(script.Skeleton),
	Spring = require(script.Spring),
	TestDriver = require(script.AnimTestDriver),
	TwoBoneIK = require(script.TwoBoneIK),
}
