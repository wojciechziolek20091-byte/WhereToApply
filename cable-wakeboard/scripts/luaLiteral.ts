/** Luau table literals from plain data, for the generated Luau files. */
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LUAU_KEYWORDS = new Set(['local', 'end', 'function', 'then', 'repeat', 'until', 'nil', 'not', 'and', 'or']);

export function lua(v: unknown, indent: string): string {
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

