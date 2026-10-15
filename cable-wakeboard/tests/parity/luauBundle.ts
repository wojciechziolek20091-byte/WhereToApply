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
		__cache[name] = __src[name]({ __module = name, Parent = __Sim })
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
