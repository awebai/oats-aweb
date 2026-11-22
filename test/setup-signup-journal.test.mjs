// Username setup and the signup journal aw keeps after an unknown outcome (aw 1.36.59,
// fc8c2b797): a root whose .aw holds the journal resumes, one without it keeps today's
// membership path, and setup itself never changes anything in the root's .aw. aw is a recording stub here; the real
// binary's side is test/username-signup-resume-native.test.mjs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, lstatSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setupUsernameDefault, signupUnfinished } from '../oats-package/capabilities/oats-aweb/lib/setup-team-default.mjs';
import { fakeKernelTeamConfig } from './helpers/fake-kernel-team-config.mjs';

const INIT = ['aw', 'init', '--new-account', '--username', 'fixture-user', '--name', 'fixture-root', '--do-not-touch-agents-md'];

/** Names, kinds, modes and content digests under dir, symlinks not followed. */
function listing(dir) {
  const out = {};
  const walk = rel => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const path = join(rel, name), stat = lstatSync(join(dir, path));
      out[path] = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? `dir ${(stat.mode & 0o777).toString(8)}`
        : `${(stat.mode & 0o777).toString(8)} ${createHash('sha256').update(readFileSync(join(dir, path))).digest('hex')}`;
      if (stat.isDirectory() && !stat.isSymbolicLink()) walk(path);
    }
  };
  walk('');
  return out;
}

function fixture(t, entries) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'signup-journal-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'deployment');
  mkdirSync(root);
  writeFileSync(join(root, 'oats-local.yaml'), 'schemaVersion: 2\nworkspace: fixture\n');
  if (entries) {
    mkdirSync(join(root, '.aw'), { mode: 0o700 });
    for (const [name, kind] of Object.entries(entries)) {
      if (kind === 'dir') mkdirSync(join(root, '.aw', name), { mode: 0o700 });
      else writeFileSync(join(root, '.aw', name), `fixture ${name}\n`, { mode: 0o600 });
    }
  }
  const kernel = fakeKernelTeamConfig(join(base, 'kernel'), root);
  const calls = [];
  const deps = {
    normalize: name => name, validTeam: team => typeof team === 'string' && team.length > 0,
    ensureAw: async () => ({ status: 'ok' }),
    // aw's answers: init fails with an unknown outcome and writes nothing; team list is unreadable.
    run: argv => {
      calls.push(argv);
      if (argv[1] === 'init') throw Object.assign(new Error('native failure'), { status: 1 });
      throw new Error('membership unavailable');
    },
    env: { OATS_WORKSPACE: root, OATS_CLI_BIN: kernel.cli, OATS_SETTINGS: JSON.stringify({ root }), PATH: process.env.PATH },
  };
  const setup = (plan = false) => setupUsernameDefault({ username: 'fixture-user', name: 'fixture-root', plan }, deps);
  return { base, root, awDir: join(root, '.aw'), calls, setup };
}

test('a root holding aw\'s signup journal is a resume: the plan says so and runs nothing, the apply re-runs the same aw init', async t => {
  const cases = {
    'the journal alone': { 'signup-recovery.json': 'file' },
    'the journal, its lock and a temp': { 'signup-recovery.json': 'file', 'signup-recovery.lock': 'file', '.tmp.123456': 'file' },
    // A 5xx at connect after a 2xx signup: aw installed its signer and certificate.
    'the journal and what aw installed': { 'signup-recovery.json': 'file', 'signup-recovery.lock': 'file', 'signing.key': 'file', 'team-certs': 'dir' },
  };
  for (const [name, entries] of Object.entries(cases)) {
    const f = fixture(t, entries);
    assert.equal(signupUnfinished(f.awDir), true, name);
    const before = listing(f.awDir);
    const plan = await f.setup(true);
    assert.equal(plan.bootstrap, 'resume', name);
    assert.equal(plan.team, null);
    assert.deepEqual(f.calls, [], `${name}: the plan runs nothing`);
    await assert.rejects(f.setup(), error => {
      assert.equal(error.code, 'E_SETUP_NATIVE');
      assert.match(error.message, /^aw init failed \(exit 1\); output withheld because it handles credentials; aw recorded this signup in the root: re-run the same setup command and aw resumes it; root retained$/);
      assert.deepEqual(error.details.steps, [{ step: 'bootstrap', status: 'unconfirmed' }]);
      return true;
    });
    // The same signup only: no membership read, no other aw command.
    assert.deepEqual(f.calls, [INIT], name);
    assert.deepEqual(listing(f.awDir), before, `${name}: setup changes nothing in .aw`);
  }
});

test('a .aw without the journal, or whose journal is not a regular file, keeps the membership path', async t => {
  const cases = {
    'an identity': { 'signing.key': 'file', 'team-certs': 'dir' },
    'the lock alone': { 'signup-recovery.lock': 'file' },
    'a journal directory': { 'signup-recovery.json': 'dir' },
    'empty': {},
  };
  for (const [name, entries] of Object.entries(cases)) {
    const f = fixture(t, entries);
    assert.equal(signupUnfinished(f.awDir), false, name);
    const before = listing(f.awDir);
    for (const plan of [true, false]) {
      f.calls.length = 0;
      await assert.rejects(f.setup(plan), error => {
        assert.equal(error.code, 'E_SETUP_MEMBERSHIP', name);
        assert.match(error.message, /no repeated signup/);
        return true;
      });
      assert.deepEqual(f.calls, [['aw', 'team', 'list', '--json']], `${name}: no signup`);
    }
    assert.deepEqual(listing(f.awDir), before, `${name}: setup changes nothing in .aw`);
  }
});

test('a journal that is a symlink is not a resume', async t => {
  const f = fixture(t, { 'signup-recovery.lock': 'file' });
  writeFileSync(join(f.base, 'outside.json'), 'fixture\n', { mode: 0o600 });
  symlinkSync(join(f.base, 'outside.json'), join(f.awDir, 'signup-recovery.json'));
  assert.equal(signupUnfinished(f.awDir), false);
  await assert.rejects(f.setup(true), error => error.code === 'E_SETUP_MEMBERSHIP');
  assert.deepEqual(f.calls, [['aw', 'team', 'list', '--json']]);
});

test('a .aw that is a symlink to a directory holding a journal is not a resume', async t => {
  const f = fixture(t);
  const target = join(f.base, 'elsewhere');
  mkdirSync(target, { mode: 0o700 });
  writeFileSync(join(target, 'signup-recovery.json'), 'fixture\n', { mode: 0o600 });
  symlinkSync(target, f.awDir);
  assert.equal(signupUnfinished(f.awDir), false);
  const before = listing(target);
  await assert.rejects(f.setup(true), error => error.code === 'E_SETUP_MEMBERSHIP');
  assert.deepEqual(f.calls, [['aw', 'team', 'list', '--json']]);
  assert.deepEqual(listing(target), before);
});

test('a failed first signup that leaves no journal keeps today\'s message', async t => {
  const f = fixture(t);
  assert.equal(signupUnfinished(f.awDir), false);
  const plan = await f.setup(true);
  assert.equal(plan.bootstrap, 'required');
  await assert.rejects(f.setup(), error => {
    assert.equal(error.code, 'E_SETUP_NATIVE');
    assert.equal(error.message, 'aw init failed (exit 1); output withheld because it handles credentials; root retained');
    return true;
  });
  assert.deepEqual(f.calls, [INIT]);
});
