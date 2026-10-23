import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const cap = join(root, 'oats-package/capabilities/oats-aweb-tasks');
const json = path => JSON.parse(readFileSync(path, 'utf8'));

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'aweb-tasks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home'), bin = join(dir, 'bin'), calls = join(dir, 'aw-calls');
  mkdirSync(home); mkdirSync(bin);
  writeFileSync(join(bin, 'aw'), `#!/bin/sh\necho called >> '${calls}'\nexit 97\n`, { mode: 0o755 });
  // Copy only this module: no imports may depend on its package siblings.
  const module = join(dir, 'module');
  cpSync(cap, module, { recursive: true });
  return { home, calls, run() {
    return spawnSync(process.execPath, [join(module, 'bin/oats-aweb-tasks.mjs'), 'spawn'], {
      cwd: module, encoding: 'utf8', env: {
        HOME: home, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
        OATS_INSTANCE_HOME: home, OATS_INSTANCE: 'worker-1',
        OATS_DEFAULT_TEAM: 'default-label', OATS_DEFAULT_TEAM_ID: 'tasks:example.invalid',
        // Ambient identity and team configuration cannot alter the fixed brief.
        AWEB_IDENTITY_HOME: dir,
      },
    });
  } };
}

test('package exports messaging and tasks at 1.32.0 with the same floors', () => {
  const pkg = json(join(root, 'oats-package/oats-package.json'));
  assert.deepEqual(pkg.capabilities, ['capabilities/oats-aweb', 'capabilities/oats-aweb-tasks']);
  const messaging = json(join(root, 'oats-package/capabilities/oats-aweb/oats.json'));
  const tasks = json(join(cap, 'oats.json'));
  for (const manifest of [pkg, messaging, tasks, json(join(root, 'package.json'))]) assert.equal(manifest.version, '1.32.0');
  assert.equal(tasks.capability, 'oats.aweb-tasks');
  assert.equal(tasks.layer, 'tasks');
  assert.deepEqual(tasks.compatibility, messaging.compatibility);
  assert.equal(tasks.requires.length, 1);
  assert.equal(tasks.requires[0].command, 'aw');
  assert.match(tasks.requires[0].why, /aw >= 1\.36\.33/);
  assert.match(messaging.requires.find(row => row.command === 'aw').why, /aw >= 1\.36\.33/);
  assert.deepEqual(Object.keys(tasks.hooks), ['spawn']);
  assert.equal(typeof tasks.hooks.spawn, 'string');
  assert.equal(tasks.binding, undefined, 'readiness does not qualify bound preparation');
  assert.equal(tasks.environment, undefined, 'tasks reuse messaging identity without setting environment');
});

test('tasks spawn emits a fixed brief independent of identity state, and never calls aw', t => {
  const f = fixture(t), expected = {
    brief: "Tasks: aweb tasks, as your oats.aweb identity in its default team (joined teams: `aw --identity-home <home> task …`). Load /aweb-tasks. If `aw whoami` fails, report it to your human and don't use tasks.",
  };
  for (const state of [undefined, '{broken', JSON.stringify({ modules: { 'oats.aweb': {} } })]) {
    if (state !== undefined) writeFileSync(join(f.home, 'instance.json'), state);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected);
  }
  assert.equal(existsSync(f.calls), false);
});

test('manifest validator enforces both capability IDs, versions and floors', t => {
  const f = fixture(t), repo = join(f.home, 'repo');
  for (const path of ['scripts', 'schemas', 'oats-package']) cpSync(join(root, path), join(repo, path), { recursive: true });
  const run = () => spawnSync(process.execPath, [join(repo, 'scripts/validate-manifests.mjs')], { cwd: repo, encoding: 'utf8' });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  const path = join(repo, 'oats-package/capabilities/oats-aweb-tasks/oats.json'), tasks = json(path);
  for (const [change, reason] of [
    [{ version: '0.0.1' }, /version/],
    [{ capability: 'other.tasks' }, /must export oats\.aweb-tasks/],
    [{ compatibility: { oats: '>=0.1.0' } }, /compatibility floor/],
  ]) {
    writeFileSync(path, JSON.stringify({ ...tasks, ...change }));
    result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, reason);
  }
  writeFileSync(path, JSON.stringify(tasks));
  const pkgPath = join(repo, 'oats-package/oats-package.json'), pkg = json(pkgPath);
  pkg.capabilities.pop(); writeFileSync(pkgPath, JSON.stringify(pkg));
  result = run(); assert.equal(result.status, 1);
  assert.match(result.stderr, /must enumerate its messaging and tasks capability directories/);
});

test('messaging instructions route task state to the selected tasks provider', () => {
  for (const path of ['injects/aweb.md', 'skills/oats-aweb/SKILL.md']) {
    const text = readFileSync(join(root, 'oats-package/capabilities/oats-aweb', path), 'utf8');
    assert.match(text, /oats\.aweb-tasks/);
    assert.match(text, /\/aweb-tasks/);
    assert.match(text, /`aw lock` and `aw roles` stay outside OATS/);
    assert.doesNotMatch(text, /`aw task`\/`work`\/`lock`\/`roles` are not part/);
  }
});
