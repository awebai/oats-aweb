import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fakeAw } from './helpers/fake-aw-grant.mjs';

const cap = fileURLToPath(new URL('../oats-package/capabilities/oats-aweb-tasks', import.meta.url));
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'aweb-tasks-upgrade-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = fakeAw(base), module = join(base, 'module'), home = join(base, 'home');
  cpSync(cap, module, { recursive: true }); mkdirSync(home);
  writeFileSync(join(home, 'instance.json'), '{unreadable-metadata');
  const run = (phase, raw) => spawnSync(process.execPath, [join(module, 'bin/oats-aweb-tasks.mjs'), 'upgrade'], {
    cwd: home, encoding: 'utf8', env: {
      HOME: home, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      OATS_EVENT: 'upgrade', OATS_UPGRADE_PHASE: phase,
      OATS_INSTANCE_HOME: join(base, 'does-not-exist'),
      ...(raw === undefined ? {} : { OATS_META: raw }),
    },
  });
  return { run, unchanged() {
    assert.equal(existsSync(join(base, 'aw.log')), false, 'upgrade made no aw calls');
    assert.equal(readFileSync(join(home, 'instance.json'), 'utf8'), '{unreadable-metadata');
  } };
}

test('tasks upgrade plan adopts absent, empty and arbitrary metadata without reads or aw calls', t => {
  const f = fixture(t);
  for (const raw of [undefined, '', '{}', '{"future":{"id":"synthetic-id"}}', 'null', '[1,2]', '{malformed']) {
    const r = f.run('plan', raw);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { adopt: true });
    f.unchanged();
  }
});

test('tasks upgrade apply preserves metadata and is idempotent without reads or aw calls', t => {
  const f = fixture(t);
  for (const raw of [undefined, '', '{}', '{"future":{"id":"synthetic-id","nested":[1,null]}}', 'null', '[1,2]', 'false', '"text"']) {
    const expected = { meta: raw ? JSON.parse(raw) : {} }, r = f.run('apply', raw);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const result = JSON.parse(r.stdout);
    assert.deepEqual(result, expected);
    const again = f.run('apply', JSON.stringify(result.meta));
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.deepEqual(JSON.parse(again.stdout), result);
    f.unchanged();
  }
});

test('tasks upgrade refuses malformed apply metadata and unknown phases without echoing input', t => {
  const f = fixture(t);
  for (const [phase, raw] of [['apply', '{secret-input'], ['secret-phase', '{}']]) {
    const r = f.run(phase, raw);
    assert.notEqual(r.status, 0);
    assert.equal(r.stdout, '');
    assert.doesNotMatch(r.stderr, /secret-input|secret-phase/);
    f.unchanged();
  }
});

test('tasks manifest declares a non-required upgrade hook', () => {
  const manifest = JSON.parse(readFileSync(join(cap, 'oats.json'), 'utf8'));
  assert.equal(manifest.hooks.upgrade, 'bin/oats-aweb-tasks.mjs upgrade');
});
