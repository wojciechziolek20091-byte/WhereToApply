/**
 * The Roblox rig end to end, without Studio: RiderBuilder's jointed rider,
 * the Luau animator and RiderRig.apply under the tiny Roblox mock. Chaining
 * the Motor6Ds must put every bone where the animator put its joint (units,
 * quaternion convention, C0 offsets, the root's lift). Needs LUAU.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleShared } from './parity/luauBundle';

const LUAU = process.env.LUAU;
const ROBLOX = join(__dirname, '../roblox');

describe.skipIf(!LUAU)('Roblox rig (RiderBuilder + Anim + RiderRig)', () => {
  it('Motor6D chains land every bone on the animated joints, both stances', { timeout: 120000 }, () => {
    const mock = readFileSync(join(ROBLOX, 'tests/mock_roblox.luau'), 'utf8');
    const spec = readFileSync(join(ROBLOX, 'tests/rig_anim_spec.luau'), 'utf8');
    const src = [
      mock,
      bundleShared(['RiderPose', 'RiderBuilder', 'RigMap', 'RiderRig']),
      'local RiderBuilder = require(__root.RiderBuilder)\nlocal RiderRig = require(__root.RiderRig)',
      spec,
    ].join('\n');
    const dir = mkdtempSync(join(tmpdir(), 'rig-'));
    const file = join(dir, 'rig.luau');
    writeFileSync(file, src);
    const out = execFileSync(LUAU!, [file], { encoding: 'utf8' });
    expect(out).toContain('RIG OK');
  });
});
