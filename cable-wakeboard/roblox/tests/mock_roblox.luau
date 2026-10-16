-- Minimal Roblox API mock: just enough for RiderBuilder to run under the
-- plain `luau` CLI. Not a full engine: no rendering, no physics.

local V = {}
V.__index = V
local function vec(x, y, z)
	return setmetatable({ X = x or 0, Y = y or 0, Z = z or 0 }, V)
end
V.__add = function(a, b) return vec(a.X + b.X, a.Y + b.Y, a.Z + b.Z) end
V.__sub = function(a, b) return vec(a.X - b.X, a.Y - b.Y, a.Z - b.Z) end
V.__unm = function(a) return vec(-a.X, -a.Y, -a.Z) end
V.__mul = function(a, b)
	if type(a) == "number" then return vec(a * b.X, a * b.Y, a * b.Z) end
	if type(b) == "number" then return vec(a.X * b, a.Y * b, a.Z * b) end
	return vec(a.X * b.X, a.Y * b.Y, a.Z * b.Z)
end
V.__div = function(a, b) return vec(a.X / b, a.Y / b, a.Z / b) end
V.__index = function(self, k)
	if k == "Magnitude" then return math.sqrt(self.X ^ 2 + self.Y ^ 2 + self.Z ^ 2) end
	if k == "Unit" then
		local m = math.sqrt(self.X ^ 2 + self.Y ^ 2 + self.Z ^ 2)
		return vec(self.X / m, self.Y / m, self.Z / m)
	end
	return rawget(V, k)
end
function V.Cross(a, b) return vec(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X) end
function V.Dot(a, b) return a.X * b.X + a.Y * b.Y + a.Z * b.Z end
function V.Lerp(a, b, t) return vec(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t, a.Z + (b.Z - a.Z) * t) end
Vector3 = { new = vec }
local V2 = {}
local function vec2(x, y) return setmetatable({ X = x or 0, Y = y or 0 }, V2) end
V2.__add = function(a, b) return vec2(a.X + b.X, a.Y + b.Y) end
V2.__sub = function(a, b) return vec2(a.X - b.X, a.Y - b.Y) end
V2.__unm = function(a) return vec2(-a.X, -a.Y) end
V2.__mul = function(a, b)
	if type(a) == "number" then return vec2(a * b.X, a * b.Y) end
	if type(b) == "number" then return vec2(a.X * b, a.Y * b) end
	return vec2(a.X * b.X, a.Y * b.Y)
end
V2.__div = function(a, b) return vec2(a.X / b, a.Y / b) end
V2.__index = function(self, k)
	if k == "Magnitude" then return math.sqrt(self.X ^ 2 + self.Y ^ 2) end
	if k == "Unit" then
		local m = math.sqrt(self.X ^ 2 + self.Y ^ 2)
		return vec2(self.X / m, self.Y / m)
	end
	return rawget(V2, k)
end
function V2.Dot(a, b) return a.X * b.X + a.Y * b.Y end
function V2.Lerp(a, b, t) return vec2(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t) end
Vector2 = { new = vec2 }

-- CFrame: rotation stored as columns (right, up, back) plus position.
local C = {}
local function cf(p, r, u, b)
	return setmetatable({ p = p, r = r, u = u, b = b }, C)
end
local function rotate(c, v) return c.r * v.X + c.u * v.Y + c.b * v.Z end
C.__add = function(a, v) return cf(a.p + v, a.r, a.u, a.b) end
C.__mul = function(a, o)
	if getmetatable(o) == C then
		return cf(a.p + rotate(a, o.p), rotate(a, o.r), rotate(a, o.u), rotate(a, o.b))
	end
	return a.p + rotate(a, o)
end
C.__index = function(self, k)
	if k == "Position" then return self.p end
	if k == "LookVector" then return -self.b end
	if k == "UpVector" then return self.u end
	if k == "RightVector" then return self.r end
	if k == "PointToWorldSpace" then return function(c, v) return c.p + rotate(c, v) end end
	if k == "VectorToWorldSpace" then return function(c, v) return rotate(c, v) end end
	if k == "VectorToObjectSpace" then return function(c, v) return vec(v:Dot(c.r), v:Dot(c.u), v:Dot(c.b)) end end
	if k == "PointToObjectSpace" then
		return function(c, v)
			local d = v - c.p
			return vec(d:Dot(c.r), d:Dot(c.u), d:Dot(c.b))
		end
	end
	if k == "Inverse" then
		return function(c)
			-- Transpose the rotation, rotate the negated position.
			local r, u, b = c.r, c.u, c.b
			local nr, nu, nb = vec(r.X, u.X, b.X), vec(r.Y, u.Y, b.Y), vec(r.Z, u.Z, b.Z)
			local p = -c.p
			return cf(nr * p.X + nu * p.Y + nb * p.Z, nr, nu, nb)
		end
	end
	return nil
end
local I = { vec(1, 0, 0), vec(0, 1, 0), vec(0, 0, 1) }
CFrame = {}
function CFrame.new(x, y, z)
	if type(x) == "table" then return cf(x, I[1], I[2], I[3]) end
	return cf(vec(x or 0, y or 0, z or 0), I[1], I[2], I[3])
end
-- CFrame.new(x, y, z, qx, qy, qz, qw): position plus a unit quaternion (standard rotation).
local baseNew = CFrame.new
function CFrame.new(x, y, z, qx, qy, qz, qw)
	if qw == nil then return baseNew(x, y, z) end
	local r = vec(1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qw * qz), 2 * (qx * qz - qw * qy))
	local u = vec(2 * (qx * qy - qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qw * qx))
	local b = vec(2 * (qx * qz + qw * qy), 2 * (qy * qz - qw * qx), 1 - 2 * (qx * qx + qy * qy))
	return cf(vec(x, y, z), r, u, b)
end
function CFrame.Angles(rx, ry, rz)
	local function rotX(t) local c, s = math.cos(t), math.sin(t) return cf(vec(), vec(1, 0, 0), vec(0, c, s), vec(0, -s, c)) end
	local function rotY(t) local c, s = math.cos(t), math.sin(t) return cf(vec(), vec(c, 0, -s), vec(0, 1, 0), vec(s, 0, c)) end
	local function rotZ(t) local c, s = math.cos(t), math.sin(t) return cf(vec(), vec(c, s, 0), vec(-s, c, 0), vec(0, 0, 1)) end
	return rotX(rx) * rotY(ry) * rotZ(rz)
end
function CFrame.fromMatrix(pos, x, y, z)
	return cf(pos, x, y, z or x:Cross(y))
end
function CFrame.lookAt(at, target, up)
	up = up or vec(0, 1, 0)
	local look = (target - at).Unit
	local right = look:Cross(up).Unit
	local newUp = right:Cross(look)
	return cf(at, right, newUp, -look)
end

local Col = {}
Col.__index = Col
local function color(r, g, b) return setmetatable({ R = r, G = g, B = b }, Col) end
function Col.ToHSV(c)
	local mx, mn = math.max(c.R, c.G, c.B), math.min(c.R, c.G, c.B)
	local d = mx - mn
	local h = 0
	if d > 0 then
		if mx == c.R then h = ((c.G - c.B) / d) % 6
		elseif mx == c.G then h = (c.B - c.R) / d + 2
		else h = (c.R - c.G) / d + 4 end
		h = h / 6
	end
	return h, (mx == 0 and 0 or d / mx), mx
end
function Col.Lerp(a, b, t) return color(a.R + (b.R - a.R) * t, a.G + (b.G - a.G) * t, a.B + (b.B - a.B) * t) end
Color3 = {
	new = function(r, g, b) return color(r, g, b) end,
	fromRGB = function(r, g, b) return color(r / 255, g / 255, b / 255) end,
	fromHSV = function(h, s, v)
		local i = math.floor(h * 6)
		local f = h * 6 - i
		local p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
		local m = i % 6
		if m == 0 then return color(v, t, p) elseif m == 1 then return color(q, v, p)
		elseif m == 2 then return color(p, v, t) elseif m == 3 then return color(p, q, v)
		elseif m == 4 then return color(t, p, v) else return color(v, p, q) end
	end,
}

local function enumGroup(names)
	local g = {}
	for _, n in names do g[n] = { Name = n } end
	return g
end
Enum = {
	Material = enumGroup({ "SmoothPlastic", "Plastic", "DiamondPlate", "Metal", "Wood", "Neon", "Concrete", "Grass", "Sand", "Slate", "Foil", "Glass" }),
	ModelStreamingMode = enumGroup({ "Default", "Atomic", "Persistent", "PersistentPerPlayer", "Nonatomic" }),
	ModelLevelOfDetail = enumGroup({ "Automatic", "StreamingMesh", "Disabled" }),
	PartType = enumGroup({ "Block", "Ball", "Cylinder" }),
	SurfaceType = enumGroup({ "Smooth" }),
	NormalId = enumGroup({ "Top", "Bottom", "Front", "Back", "Left", "Right" }),
	Font = enumGroup({ "GothamBlack", "GothamBold", "Gotham", "SourceSans" }),
	SurfaceGuiSizingMode = enumGroup({ "FixedSize", "PixelsPerStud" }),
}

Random = {}
function Random.new(seed)
	local state = (seed or 1) * 2654435761 % 4294967296
	local r = {}
	local function nextf()
		state = (state * 1664525 + 1013904223) % 4294967296
		return state / 4294967296
	end
	function r:NextNumber(a, b) return a + (b - a) * nextf() end
	function r:NextInteger(a, b) return a + math.floor((b - a + 1) * nextf()) end
	return r
end

-- Instances: plain property bags with a parent/children tree.
local Inst = {}
Inst.__index = function(self, k)
	local m = rawget(Inst, k)
	if m then return m end
	return rawget(self, "_props")[k]
end
Inst.__newindex = function(self, k, v)
	local props = rawget(self, "_props")
	if k == "Parent" then
		local old = props.Parent
		if old then
			local kids = rawget(old, "_children")
			for i, c in kids do if c == self then table.remove(kids, i) break end end
		end
		if v then table.insert(rawget(v, "_children"), self) end
	end
	props[k] = v
end
function Inst:GetChildren() return table.clone(rawget(self, "_children")) end
function Inst:GetDescendants()
	local out = {}
	local function walk(i)
		for _, c in rawget(i, "_children") do table.insert(out, c) walk(c) end
	end
	walk(self)
	return out
end
function Inst:IsA(cls)
	local c = rawget(self, "_props").ClassName
	if cls == "BasePart" then return c == "Part" or c == "WedgePart" or c == "CornerWedgePart" or c == "TrussPart" end
	if cls == "Motor6D" then return c == "Motor6D" end
	return c == cls
end
function Inst:SetAttribute(k, v)
	local a = rawget(self, "_attrs")
	if not a then a = {} rawset(self, "_attrs", a) end
	a[k] = v
end
function Inst:GetAttribute(k)
	local a = rawget(self, "_attrs")
	return a and a[k]
end
function Inst:GetAttributes() return table.clone(rawget(self, "_attrs") or {}) end
function Inst:Destroy()
	self.Parent = nil
	for _, c in rawget(self, "_children") do c:Destroy() end
end
function Inst:ClearAllChildren()
	for _, c in table.clone(rawget(self, "_children")) do c:Destroy() end
end
function Inst:FindFirstChildOfClass(cls)
	for _, c in rawget(self, "_children") do if c.ClassName == cls then return c end end
	return nil
end
function Inst:IsDescendantOf(other)
	local p = self.Parent
	while p do
		if p == other then return true end
		p = p.Parent
	end
	return false
end
function Inst:ScaleTo(_s) rawget(self, "_props").Scaled = _s end
function Inst:FindFirstChild(name, recursive)
	for _, c in (if recursive then self:GetDescendants() else rawget(self, "_children")) do
		if c.Name == name then return c end
	end
	return nil
end
function Inst:PivotTo(c) if self.PrimaryPart then self.PrimaryPart.CFrame = c end end
function Inst:GetPivot() return if self.PrimaryPart then self.PrimaryPart.CFrame else CFrame.new() end
warn = function(...) print("WARN", ...) end
Instance = {
	new = function(className)
		local i = setmetatable({ _props = { ClassName = className, Name = className }, _children = {} }, Inst)
		if className == "Part" then i.Shape = Enum.PartType.Block end
		return i
	end,
}

-- Services: CollectionService tags, PhysicsService collision groups, a Workspace.
local tags = {}
local CollectionService = {}
function CollectionService:AddTag(inst, tag)
	tags[tag] = tags[tag] or {}
	tags[tag][inst] = true
end
function CollectionService:HasTag(inst, tag) return tags[tag] ~= nil and tags[tag][inst] == true end
function CollectionService:RemoveTag(inst, tag) if tags[tag] then tags[tag][inst] = nil end end
function CollectionService:GetTagged(tag)
	local out = {}
	for inst in tags[tag] or {} do
		-- Destroyed instances drop out, like the engine.
		if inst.Parent ~= nil then table.insert(out, inst) end
	end
	return out
end
local function signal()
	return { Connect = function() return { Disconnect = function() end } end }
end
function CollectionService:GetInstanceAddedSignal(_tag) return signal() end
function CollectionService:GetInstanceRemovedSignal(_tag) return signal() end
function CollectionService:GetTags(inst)
	local out = {}
	for tag, set in tags do if set[inst] then table.insert(out, tag) end end
	return out
end
local groups, collidable = {}, {}
local PhysicsService = {}
function PhysicsService:RegisterCollisionGroup(name) groups[name] = true end
function PhysicsService:IsCollisionGroupRegistered(name) return name == "Default" or groups[name] == true end
local function pairKey(a, b) if a < b then return a .. "|" .. b end return b .. "|" .. a end
function PhysicsService:CollisionGroupSetCollidable(a, b, on)
	assert(self:IsCollisionGroupRegistered(a) and self:IsCollisionGroupRegistered(b), "unregistered collision group")
	collidable[pairKey(a, b)] = on
end
function PhysicsService:CollisionGroupsAreCollidable(a, b)
	local v = collidable[pairKey(a, b)]
	if v == nil then return true end
	return v
end
workspace = Instance.new("Workspace")
workspace.Name = "Workspace"
local services = { CollectionService = CollectionService, PhysicsService = PhysicsService, Workspace = workspace }
game = {
	GetService = function(_, name)
		local s = services[name]
		if not s then
			s = Instance.new(name)
			services[name] = s
		end
		return s
	end,
	Workspace = workspace,
}
task = task or {}
task.defer = task.defer or function(f, ...) f(...) end
task.spawn = task.spawn or function(f, ...) f(...) end
UDim2 = {
	new = function(xs, xo, ys, yo) return { X = { Scale = xs, Offset = xo }, Y = { Scale = ys, Offset = yo } } end,
	fromScale = function(x, y) return { X = { Scale = x, Offset = 0 }, Y = { Scale = y, Offset = 0 } } end,
	fromOffset = function(x, y) return { X = { Scale = 0, Offset = x }, Y = { Scale = 0, Offset = y } } end,
}
