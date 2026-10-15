import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const simFiles = [
  ...walk(join(import.meta.dirname, '..', 'src', 'sim')),
  ...walk(join(import.meta.dirname, '..', 'src', 'art')),
].filter((f) => f.endsWith('.ts'));

describe('sim architecture', () => {
  it('has source files', () => {
    expect(simFiles.length).toBeGreaterThan(0);
  });

  it.each(simFiles)('%s stays pure and deterministic', (file) => {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/from\s+['"](three|@babylonjs)/);
    expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now|\bwindow\b|\bdocument\b/);
  });

  // Math.sin & co. round differently in V8 and in C libraries; the sim uses
  // math/detmath.ts so the TypeScript and Luau versions stay bit-identical.
  it.each(simFiles.filter((f) => f.includes(join('src', 'sim')) && !f.endsWith('detmath.ts')))(
    '%s uses detmath for transcendental functions',
    (file) => {
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(src).not.toMatch(/Math\.(sin|cos|tan|asin|acos|atan|atan2|exp|log|log2|log10|pow|hypot|cbrt|sinh|cosh|tanh)\b|\*\*/);
    },
  );
});

const luauSimDir = join(import.meta.dirname, '..', 'roblox', 'src', 'shared', 'Sim');
const luauSimFiles = walk(luauSimDir).filter((f) => f.endsWith('.luau'));

describe('Luau sim architecture', () => {
  it('mirrors every TypeScript sim module', () => {
    const names = new Set(luauSimFiles.map((f) => f.slice(luauSimDir.length + 1).replace(/\.luau$/, '')));
    // src/sim file -> Luau module. hash, events, rider and index are TypeScript-only (types or tooling).
    const tsOnly = new Set(['hash', 'events', 'rider', 'index']);
    const toLuau = (rel: string): string =>
      rel
        .replace(/\.ts$/, '')
        .replace(/^math\//, '')
        .split(/[/]/)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join('')
        .replace(/^Detmath$/, 'DetMath')
        .replace(/^OnFeature$/i, 'OnFeature');
    const simRoot = join(import.meta.dirname, '..', 'src', 'sim');
    const missing = simFiles
      .filter((f) => f.startsWith(simRoot))
      .map((f) => f.slice(simRoot.length + 1))
      .filter((rel) => !tsOnly.has(rel.replace(/\.ts$/, '')))
      .map(toLuau)
      .filter((n) => !names.has(n));
    expect(missing).toEqual([]);
  });

  it.each(luauSimFiles)('%s stays pure and deterministic', (file) => {
    const src = readFileSync(file, 'utf8').replace(/--.*$/gm, '');
    // No Roblox engine, clocks or randomness: the module must also run in the plain luau CLI.
    expect(src).not.toMatch(/\b(game|workspace|Instance|Vector3|CFrame|task|os)\s*[.:]|\b(wait|spawn|delay)\s*\(/);
    expect(src).not.toMatch(/math\.random/);
    if (!file.endsWith('DetMath.luau')) {
      expect(src).not.toMatch(/math\.(sin|cos|tan|asin|acos|atan|atan2|exp|log|log10|pow|sinh|cosh|tanh)\b|\^/);
    }
  });
});

describe('animation architecture', () => {
  const animDir = join(import.meta.dirname, '..', 'src', 'anim');
  const animFiles = walk(animDir).filter((f) => f.endsWith('.ts'));
  const luauAnimDir = join(import.meta.dirname, '..', 'roblox', 'src', 'shared', 'Anim');
  const TWIN: Record<string, string> = {
    animator: 'Animator',
    channels: 'Channels',
    clip: 'Clip',
    config: 'AnimConfig',
    ik: 'TwoBoneIK',
    index: 'init',
    poses: 'RiderPoses',
    quat: 'Quat',
    ragdoll: 'Ragdoll',
    replication: 'AnimReplication',
    skeleton: 'Skeleton',
    spring: 'Spring',
    state: 'RiderAnimStateAdapter',
    testDriver: 'AnimTestDriver',
  };

  it.each(animFiles)('%s is engine-free (no Babylon, three.js, DOM)', (file) => {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/from\s+['"](three|@babylonjs)/);
    expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now|\bwindow\b|\bdocument\b/);
  });

  it('every TypeScript animation module has its Luau twin', () => {
    const luau = new Set(walk(luauAnimDir).filter((f) => f.endsWith('.luau')).map((f) => f.slice(luauAnimDir.length + 1).replace(/\.luau$/, '')));
    const missing = animFiles.map((f) => f.slice(animDir.length + 1).replace(/\.ts$/, '')).filter((n) => !luau.has(TWIN[n] ?? '?'));
    expect(missing).toEqual([]);
  });

  it('Luau Anim modules use no Roblox APIs (they run in the plain luau CLI)', () => {
    for (const f of walk(luauAnimDir).filter((x) => x.endsWith('.luau'))) {
      const src = readFileSync(f, 'utf8').replace(/--.*$/gm, '');
      expect(src, f).not.toMatch(/\b(game|workspace|Instance|Vector3|CFrame|task)\b[.:(]/);
    }
  });
});
