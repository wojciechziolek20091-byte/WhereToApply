/**
 * Writes roblox/src/shared/Sim/ParkLayout.luau from src/sim/parkLayout.ts, so
 * the park data has one source. Run after editing the park:
 *   npx vite-node scripts/gen-park-luau.ts
 * tests/parity.test.ts fails if the two drift apart.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAKESIDE_PARK } from '../src/sim/parkLayout';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LUAU_KEYWORDS = new Set(['local', 'end', 'function', 'then', 'repeat', 'until', 'nil', 'not', 'and', 'or']);

function lua(v: unknown, indent: string): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return String(v);
  const inner = `${indent}\t`;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object')) return `{ ${v.map((x) => lua(x, inner)).join(', ')} }`;
    // Short rows (points) stay on one line.
    const rows = v.map((x) => lua(x, inner));
    const oneLine = `{ ${rows.join(', ')} }`;
    if (!oneLine.includes('\n') && oneLine.length < 160) return oneLine;
    return `{\n${rows.map((r) => `${inner}${r},`).join('\n')}\n${indent}}`;
  }
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
  const parts = entries.map(([k, x]) => `${IDENT.test(k) && !LUAU_KEYWORDS.has(k) ? k : `[${JSON.stringify(k)}]`} = ${lua(x, inner)}`);
  const flat = `{ ${parts.join(', ')} }`;
  if (!flat.includes('\n') && flat.length < 160) return flat;
  return `{\n${parts.map((p) => `${inner}${p},`).join('\n')}\n${indent}}`;
}

const out = `-- GENERATED from src/sim/parkLayout.ts by scripts/gen-park-luau.ts. Do not edit:
-- edit the TypeScript file and rerun the script. The lakeside cable park from
-- the user's map: features along the cable, plus the site (shore, island,
-- dock, buildings) for renderers. Towers are in Config.luau.
local ParkLayout = {}

ParkLayout.LAKESIDE_PARK = ${lua(LAKESIDE_PARK, '')}

return ParkLayout
`;
writeFileSync(join(__dirname, '../roblox/src/shared/Sim/ParkLayout.luau'), out);
console.log('wrote ParkLayout.luau');
