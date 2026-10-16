/**
 * Bundles roblox/src/shared/Sim (ModuleScripts that use
 * `require(script.Parent.X)`) into one script for the plain `luau` CLI, with
 * a tiny stand-in for Roblox's `script` and `require`. Studio and Rojo do not
 * need this: there the folder is real ModuleScripts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SIM_DIR = join(__dirname, '../../roblox/src/shared/Sim');

const PRELUDE = `
local __src, __cache = {}, {}
local __Sim = {}
setmetatable(__Sim, { __index = function(_, name) return { __module = name, Parent = __Sim } end })
local function require(inst)
	local name = inst.__module
	if __cache[name] == nil then
		-- The folder's own module (init) sees the folder as its script.
		__cache[name] = __src[name](if name == "init" then __Sim else { __module = name, Parent = __Sim })
	end
	return __cache[name]
end
`;

/** Luau source defining a local `Sim` (the init module's return value). */
export function bundleSim(): string {
  const parts = [PRELUDE];
  for (const file of readdirSync(SIM_DIR).filter((f) => f.endsWith('.luau')).sort()) {
    const name = file.replace(/\.luau$/, '');
    const body = readFileSync(join(SIM_DIR, file), 'utf8').replace(/^--!.*$/gm, '');
    parts.push(`__src[${JSON.stringify(name)}] = function(script)\n${body}\nend`);
  }
  parts.push('local Sim = __src.init(__Sim)');
  return parts.join('\n');
}

export const SHARED_DIR = join(__dirname, '../../roblox/src/shared');

const SHARED_PRELUDE = `
local __src, __cache, __folders = {}, {}, {}
local __root = {}
local function __folder(name)
	local f = __folders[name]
	if f then return f end
	f = { __path = name, Parent = __root }
	setmetatable(f, { __index = function(_, child) return { __path = name .. "/" .. child, Parent = f } end })
	__folders[name] = f
	return f
end
local __isFolder = {}
setmetatable(__root, { __index = function(_, name)
	if __src[name .. "/init"] or __isFolder[name] then return __folder(name) end
	return { __path = name, Parent = __root }
end })
local function require(inst)
	local path = inst.__path
	local isFolder = __src[path .. "/init"] ~= nil
	local key = if isFolder then path .. "/init" else path
	if __cache[key] == nil then
		__cache[key] = __src[key](if isFolder then __folder(path) else inst)
	end
	return __cache[key]
end
`;

/**
 * Luau source with the shared folders as a module tree (Sim/, Anim/ and the
 * given shared modules), defining locals `Sim` and `Anim`.
 */
export function bundleShared(modules: string[] = ['RiderPose'], folders: string[] = ['Sim', 'Anim']): string {
  const parts = [SHARED_PRELUDE];
  for (const folder of folders) {
    parts.push(`__isFolder[${JSON.stringify(folder)}] = true`);
    const dir = join(SHARED_DIR, folder);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.luau')).sort()) {
      const body = readFileSync(join(dir, file), 'utf8').replace(/^--!.*$/gm, '');
      parts.push(`__src[${JSON.stringify(`${folder}/${file.replace(/\.luau$/, '')}`)}] = function(script)\n${body}\nend`);
    }
  }
  for (const m of modules) {
    const body = readFileSync(join(SHARED_DIR, `${m}.luau`), 'utf8').replace(/^--!.*$/gm, '');
    parts.push(`__src[${JSON.stringify(m)}] = function(script)\n${body}\nend`);
  }
  parts.push(`local Sim = require(__root.Sim)${folders.includes('Anim') ? '\nlocal Anim = require(__root.Anim)' : ''}`);
  return parts.join('\n');
}
