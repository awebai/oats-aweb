import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observePrivateRegistryAw } from './helpers/observe-private-registry.mjs';

test('CI observer preserves native behavior and writes only private-refusal booleans', t => {
  const dir = mkdtempSync(join(tmpdir(), "aw-refusal-observer a'b-")), bin = join(dir, 'bin'), native = join(dir, 'native-aw');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(bin);
  writeFileSync(native, `#!${process.execPath}
console.log(JSON.stringify({ marker: 'SYNTHETIC-SENSITIVE', registry: process.env.AWID_REGISTRY_URL ?? null, argv: process.argv.slice(2) }));
console.error(process.env.REFUSAL === '1' ? 'a registry not named by AWID_REGISTRY_URL or the command line must use https' : 'SYNTHETIC-SENSITIVE');
process.exitCode = 23;
`, { mode: 0o700 });
  const log = observePrivateRegistryAw(bin, native), argv = ['init', '--join-from=/fixture/root', '--json'];
  for (const refusal of ['1', '0']) {
    const result = spawnSync(join(bin, 'aw'), argv, { encoding: 'utf8', env: { HOME: dir, PATH: '/usr/bin:/bin', REFUSAL: refusal } });
    assert.equal(result.status, 23);
    assert.deepEqual(JSON.parse(result.stdout), { marker: 'SYNTHETIC-SENSITIVE', registry: null, argv });
    assert.equal(result.stderr.trim(), refusal === '1' ? 'a registry not named by AWID_REGISTRY_URL or the command line must use https' : 'SYNTHETIC-SENSITIVE');
  }
  const bypass = spawnSync(join(bin, 'aw'), ['version'], { encoding: 'utf8', env: { HOME: dir, PATH: '/usr/bin:/bin' } });
  assert.equal(bypass.status, 23);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse), [true, false]);
  assert.doesNotMatch(readFileSync(log, 'utf8'), /SYNTHETIC|fixture|AWID|https/);
});
