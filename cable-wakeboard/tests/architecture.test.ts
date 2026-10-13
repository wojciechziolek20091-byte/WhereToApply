import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const simFiles = walk(join(import.meta.dirname, '..', 'src', 'sim')).filter((f) => f.endsWith('.ts'));

describe('sim architecture', () => {
  it('has source files', () => {
    expect(simFiles.length).toBeGreaterThan(0);
  });

  it.each(simFiles)('%s stays pure and deterministic', (file) => {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/from\s+['"]three/);
    expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now|\bwindow\b|\bdocument\b/);
  });
});
