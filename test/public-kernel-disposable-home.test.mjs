// Retirement recovery against the pinned public kernel (bb2ba8c9, 0.42.0): an
// aweb instance spawned in local mode with the fake aw, then retired through
// the real `oats retire`. The provider's home state (.aw, .aweb-identity,
// .aweb-identity-*, .oats-aweb) is declared in retirement.disposable.home, so
// the recovery copy never holds the identity's private keys, while the retire
// hook still runs with them in place. Opt-in locally, REQUIRED in CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeAwSetupPath } from './helpers/fake-aw-setup.mjs';

const packageRoot = fileURLToPath(new URL('../oats-package', import.meta.url));
const DECLARED = ['.aw', '.aweb-identity', '.aweb-identity-*', '.oats-aweb'];
const kernel = process.env.OATS_HOST_ONLY_KERNEL_ROOT;
if (process.env.OATS_HOST_ONLY_REQUIRED === '1') assert.ok(kernel, 'required disposable-home test needs OATS_HOST_ONLY_KERNEL_ROOT');

// A deployment whose `probe` soul (work: directory) activates oats.aweb from a
// local git member, minting from a root for the default team and from a second
// root for the eligible team `joined`.
function deployment(t, { prefix = 'public-disposable-home-' } = {}) {
  assert.equal(execFileSync('git', ['-C', kernel, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), 'bb2ba8c9a254edb745913b9c5a9d9b833fda932d');
  const base = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const host = join(base, 'source'), dep = join(base, 'deployment'), privateHome = join(base, 'home');
  const root = join(dep, '.aweb-roots', 'default'), joinedRoot = join(dep, '.aweb-roots', 'joined');
  for (const dir of [join(host, 'souls', 'probe'), join(dep, 'agents'), join(root, '.aw'), join(joinedRoot, '.aw'), privateHome]) mkdirSync(dir, { recursive: true });
  const fake = fakeAwSetupPath(t);
  // An inert harness for the spawn preflight; --no-launch never runs it.
  writeFileSync(join(fake.path, 'codex'), '#!/bin/sh\necho unexpected-harness-launch >&2\nexit 99\n', { mode: 0o755 });
  const env = { PATH: `${fake.path}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: privateHome, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', OATS_REMOTE_CACHE: join(base, 'cache'), AW_NO_UPDATE_CHECK: '1', AW_FAKE_KEYS: '1', AW_FAKE_TEAM: 'joined:example.invalid' };
  const git = (...args) => execFileSync('git', ['-C', host, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { env, encoding: 'utf8' }).trim();
  const ref = pathToFileURL(host).href;
  writeFileSync(join(host, 'oats-workspace.yaml'), `schemaVersion: 2\nname: fixture\nmembers:\n  - ${ref}\nteams:\n  default: { team: 'default:example.invalid' }\n  joined: { team: 'joined:example.invalid' }\ndefaultTeam: default\nlocalTeams: true\nsouls:\n  "*": { teams: [joined] }\ndefaults:\n  messaging:\n    oats.aweb: { from: local/${host} }\n`);
  writeFileSync(join(host, 'oats-membership.yaml'), `schemaVersion: 2\nworkspace: ${ref}\n`);
  writeFileSync(join(host, 'souls/probe/soul.yaml'), 'schemaVersion: 2\nname: probe\ndescription: probe\nwork: directory\n');
  writeFileSync(join(host, 'souls/probe/AGENTS.md'), 'Fixture only.\n');
  cpSync(join(packageRoot, 'capabilities', 'oats-aweb'), join(host, 'capabilities', 'oats-aweb'), { recursive: true });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'isolated fixture');
  writeFileSync(join(dep, 'oats-local.yaml'), `schemaVersion: 2\nworkspace: ${ref}\nsettings:\n  oats.aweb:\n    root: ${root}\n    roots:\n      "joined:example.invalid": ${joinedRoot}\n`);
  writeFileSync(join(root, '.aw', 'teams.json'), '{"memberships":[{"team_id":"default:example.invalid"}]}');
  writeFileSync(join(joinedRoot, '.aw', 'teams.json'), '{"memberships":[{"team_id":"joined:example.invalid"}]}');
  const oats = (args, extra = {}) => spawnSync(process.execPath, [join(kernel, 'bin/oats.mjs'), ...args, '--dir', dep, '--json'], { cwd: dep, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60000 });
  return { dep, fake, oats };
}

// Spawn through the provider's real paths: the default identity by `aw init
// --join-from`, the joined team by the spawn-time `join` setting (invite from
// its root, accept into .aweb-identity-joined). Nonempty work makes retirement
// write a recovery.
function spawnProbe(f, name) {
  const r = f.oats(['spawn', 'probe', '--name', name, '--no-launch', '--harness', 'codex', '--provider', 'oats.aweb', 'delivery=session', '--provider', 'oats.aweb', 'join=joined']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const home = JSON.parse(r.stdout).result.home;
  writeFileSync(join(home, 'work', 'notes.md'), 'work worth keeping\n');
  // The spawn premise: the provider wrote every kind of state it declares
  // except the global grant home, and the keys are real files.
  for (const path of ['.aw/signing.key', '.aw/encryption-keys/fixture.x25519.key', '.aweb-identity-joined/signing.key', '.oats-aweb/teams.json']) assert.ok(existsSync(join(home, path)), `spawn wrote ${path}`);
  return home;
}

const providerEntry = (name) => name === '.aw' || name === '.aweb-identity' || name.startsWith('.aweb-identity-') || name === '.oats-aweb';
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    out.push(join(dir, entry.name));
    if (entry.isDirectory() && !entry.isSymbolicLink()) walk(join(dir, entry.name), out);
  }
  return out;
}
// No provider entry in any copied home and no private key file anywhere in the recovery.
function assertNoProviderState(recovery) {
  assert.ok(existsSync(join(recovery, 'home')), 'the recovery holds a home copy');
  assert.equal(readFileSync(join(recovery, 'work', 'notes.md'), 'utf8'), 'work worth keeping\n', 'the work was preserved');
  for (const copied of [join(recovery, 'home'), join(recovery, 'after-hooks', 'home')]) {
    if (!existsSync(copied)) continue;
    assert.deepEqual(readdirSync(copied).filter(providerEntry), [], `${copied} holds no provider home state`);
  }
  const keys = walk(recovery).filter((path) => /(^|\/)signing\.key$|\.x25519\.key$/.test(path));
  assert.deepEqual(keys, [], 'no private key file is anywhere in the recovery');
}
const notCopiedRows = (names) => names.map((path) => ({ scope: 'home', path, owner: 'oats.aweb' }));

test('manifest declares the provider home state and the kernel floor that honours it', () => {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'capabilities/oats-aweb/oats.json'), 'utf8'));
  assert.deepEqual(manifest.retirement, { disposable: { home: DECLARED } });
  assert.equal(manifest.compatibility.oats, '>=0.42.0');
});

test('retire leaves the provider home state out of recovery, after the hook ran with the keys in place', { skip: !kernel && 'requires pinned bb2ba8c public kernel checkout', timeout: 180000 }, (t) => {
  const f = deployment(t);
  const home = spawnProbe(f, 'disposable-probe');
  const r = f.oats(['retire', 'disposable-probe']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // 0.42.0 `oats retire --json` prints the retire result itself, unenveloped.
  const retired = JSON.parse(r.stdout);
  assert.equal(retired.retired, 'disposable-probe');
  assert.equal(retired.removedDir, true);
  assert.equal(existsSync(home), false, 'a complete retire removes the home');
  const recovery = retired.workRecovery.path;
  assertNoProviderState(recovery);
  // .aweb-identity (the global grant home) does not exist in a local-mode home,
  // so it is simply absent from the receipt.
  const expected = notCopiedRows(['.aw', '.aweb-identity-joined', '.oats-aweb']);
  assert.deepEqual(retired.workRecovery.notCopied, expected);
  assert.deepEqual(JSON.parse(readFileSync(join(recovery, 'recovery.json'), 'utf8')).notCopied, expected);
  // The hook's self-delete ran from the home, its signing key present.
  const deletes = f.fake.readCalls().filter((c) => c.args[0] === 'workspace' && c.args[1] === 'delete');
  const own = deletes.find((c) => !c.identityHome);
  assert.ok(own, 'the default identity self-deleted');
  assert.equal(own.cwd, home);
  assert.equal(own.signingKey, true, '<home>/.aw/signing.key existed when the self-delete ran');
  const joined = deletes.find((c) => c.identityHome === join(home, '.aweb-identity-joined'));
  assert.ok(joined, 'the joined team was left');
  assert.equal(joined.signingKey, true, 'the joined identity key existed when it left');
});

test('a refused self-delete keeps the home with its keys for the retry, and the recovery still holds none', { skip: !kernel && 'requires pinned bb2ba8c public kernel checkout', timeout: 180000 }, (t) => {
  const f = deployment(t);
  const home = spawnProbe(f, 'refused-probe');
  const r = f.oats(['retire', 'refused-probe'], { AW_DELETE_FAIL: '1' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const retired = JSON.parse(r.stdout);
  assert.equal(retired.removedDir, false);
  assert.equal(retired.retainedHome, home, 'an incomplete cleanup keeps the home');
  assert.ok(retired.rollbackIncomplete.some((line) => /oats\.aweb: reported incomplete cleanup \(self-delete-failed\)/.test(line)), JSON.stringify(retired.rollbackIncomplete));
  assert.equal(readFileSync(join(home, '.aw', 'signing.key'), 'utf8'), 'FIXTURE-PRIVATE-SIGNING-KEY\n', 'the key stays in place for the retry');
  assert.ok(existsSync(join(home, '.aw', 'encryption-keys', 'fixture.x25519.key')));
  const own = f.fake.readCalls().find((c) => c.args[0] === 'workspace' && c.args[1] === 'delete' && !c.identityHome);
  assert.equal(own?.cwd, home);
  assert.equal(own?.signingKey, true);
  // The attempt's own recovery, beside the kept home, holds none of it.
  const recoveryRoot = join(dirname(home), '.oats-retirement', 'recovery');
  assert.deepEqual(readdirSync(recoveryRoot).map((name) => join(recoveryRoot, name)), [retired.workRecovery.path], 'the attempt wrote one recovery');
  assertNoProviderState(retired.workRecovery.path);
  assert.deepEqual(retired.workRecovery.notCopied, notCopiedRows(['.aw', '.aweb-identity-joined', '.oats-aweb']));
});

// Amendment 1: the key a failed joined-team leave needs is never in recovery,
// so retire must not let the kernel remove the home that holds it.
// The variants put "team_not_hosted" in an ancestor of every identity home, or
// at the end of the HTTP error's prose: neither is aw's own refusal, and the
// key must still stay.
for (const [variant, prefix, suffix] of [['plain', 'public-disposable-home-', ''], ['path', 'team_not_hosted-', ''], ['prose', 'public-disposable-home-', ' (reason: team_not_hosted)']]) test(`a failed joined-team leave keeps the home with its key; the retry leaves the team without a second self-delete (${variant})`, { skip: !kernel && 'requires pinned bb2ba8c public kernel checkout', timeout: 180000 }, (t) => {
  const f = deployment(t, { prefix });
  const home = spawnProbe(f, 'leave-probe');
  const deletes = () => f.fake.readCalls().filter((c) => c.args[0] === 'workspace' && c.args[1] === 'delete');
  const joinedHome = join(home, '.aweb-identity-joined');
  let r = f.oats(['retire', 'leave-probe'], { AW_DELETE_FAIL_FOR: 'joined', AW_DELETE_FAIL_SUFFIX: suffix });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  let retired = JSON.parse(r.stdout);
  assert.equal(retired.retainedHome, home, 'the home is kept for the retry');
  assert.ok(retired.rollbackIncomplete.some((line) => /oats\.aweb: reported incomplete cleanup \(joined-team-leave-failed\)/.test(line)), JSON.stringify(retired.rollbackIncomplete));
  assert.equal(readFileSync(join(joinedHome, 'signing.key'), 'utf8'), 'FIXTURE-PRIVATE-SIGNING-KEY\n', 'the joined key stays in the home');
  assert.ok(existsSync(join(home, '.oats-aweb', 'default-retire.json')), 'the default self-delete completed and was recorded');
  assert.equal(deletes().filter((c) => !c.identityHome).length, 1);
  assertNoProviderState(retired.workRecovery.path);
  assert.deepEqual(retired.workRecovery.notCopied, notCopiedRows(['.aw', '.aweb-identity-joined', '.oats-aweb']));

  r = f.oats(['retire', 'leave-probe']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  retired = JSON.parse(r.stdout);
  assert.equal(retired.removedDir, true);
  assert.equal(existsSync(home), false, 'the retry completes and removes the home');
  assert.equal(deletes().filter((c) => !c.identityHome).length, 1, 'the default identity is not deleted a second time');
  const leaves = deletes().filter((c) => c.identityHome === joinedHome);
  assert.equal(leaves.length, 2, 'the leave was retried');
  assert.equal(leaves[1].signingKey, true, 'with its key read from the home');
  assertNoProviderState(retired.workRecovery.path);
});
