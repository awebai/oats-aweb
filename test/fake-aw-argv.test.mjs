import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fakeAw } from './helpers/fake-aw-grant.mjs';
import { fakeAwSetupPath } from './helpers/fake-aw-setup.mjs';
import { fakeAwWake } from './helpers/fake-aw-wake.mjs';

for (const [name, make, commands] of [
  ['grant', (t, base) => fakeAw(base), [['wake', 'register'], ['check'], ['heartbeat'], ['id', 'grant', 'show', 'fixture-grant']]],
  ['setup', (t) => fakeAwSetupPath(t).path, [['wake', 'register'], ['team', 'list'], ['id', 'team', 'create']]],
  ['wake', (t) => fakeAwWake(t).path.split(':')[0], [['wake', 'status'], ['workspace', 'connect'], ['init']]],
]) test(`${name} fake rejects unknown flags on known commands before acting`, (t) => {
  const base = mkdtempSync(join(tmpdir(), 'fake-aw-argv-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = make(t, base);
  for (const command of [...commands, ['init', '--join-from=' + base, '--join-team=t:example.invalid', '--name=fixture']]) {
    const cwd = join(base, String(commands.indexOf(command)));
    mkdirSync(cwd, { recursive: true });
    const args = [...command, '--unknown-contract-flag=bad'];
    const r = spawnSync(join(bin, 'aw'), args, { cwd, env: { PATH: process.env.PATH, HOME: base }, encoding: 'utf8' });
    assert.equal(r.status, 2, JSON.stringify({ args, stdout: r.stdout, stderr: r.stderr }));
    assert.match(r.stderr, /unknown flag/);
    assert.ok(r.stderr.includes(JSON.stringify(args)), 'diagnostic prints the rejected argv');
  }
});
