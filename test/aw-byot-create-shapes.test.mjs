// awebai/oats-aweb#208: the fake aw that the setup --create --namespace tests
// drive answers as real aw 1.36.56 does. Each answer is compared with
// test/fixtures/byot-create: runs of the real binary, and, for what needs a
// registry, the shapes read from aw's source at aw-v1.36.56 (see its README).
//
// With OATS_AWEB_TEST_AW set to a real aw binary (1.36.56 or later), the same
// offline commands also run against that binary, and setup's create runs on it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fakeAwSetupPath } from './helpers/fake-aw-setup.mjs';

const fixtures = fileURLToPath(new URL('./fixtures/byot-create/', import.meta.url));
const hook = fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs', import.meta.url));
const realAw = process.env.OATS_AWEB_TEST_AW;
const NS = 'example.invalid';

const captured = (name, dir = fixtures) => ({
  stdout: readFileSync(join(dir, `${name}.stdout`), 'utf8'),
  stderr: existsSync(join(dir, `${name}.stderr`)) ? readFileSync(join(dir, `${name}.stderr`), 'utf8') : '',
  exit: Number(readFileSync(join(dir, `${name}.exit`), 'utf8')),
});
const derived = (name) => captured(name, join(fixtures, 'source-derived'));
const envelope = (stdout) => JSON.parse(stdout).error;

function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aw-byot-shapes-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'home', 'deployment'), { recursive: true });
  return dir;
}
/** Runs an aw binary with nothing of this process's aw state: a throwaway HOME
 *  and an unreachable registry. */
const runAw = (aw, home, cwd, args) => spawnSync(aw, args, { cwd, encoding: 'utf8', timeout: 30000, env: { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, AWID_REGISTRY_URL: 'http://127.0.0.1:9' } });
const writeTeamKey = (home) => {
  const dir = join(home, '.awid', 'team-keys', NS);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'eng.key'), `-----BEGIN ED25519 PRIVATE KEY-----\n${randomBytes(32).toString('base64')}\n-----END ED25519 PRIVATE KEY-----\n`, { mode: 0o600 });
};

test('the fixtures were captured from aw 1.36.56 and hold no invite token or key', () => {
  assert.match(readFileSync(join(fixtures, 'aw-version.txt'), 'utf8'), /^aw 1\.36\.56\n  commit: 4d5eafdcc9118cfb8204740fa70a0d48acfd18e4 /);
  assert.equal(JSON.parse(captured('invite-team-key').stdout).token, 'SCRUBBED-INVITE-TOKEN');
  for (const dir of [fixtures, join(fixtures, 'source-derived')]) {
    for (const f of readdirSync(dir).filter((n) => /\.(stdout|stderr)$/.test(n))) assert.doesNotMatch(readFileSync(join(dir, f), 'utf8'), /PRIVATE KEY|aw_inv_[A-Za-z0-9_-]{8,}|SECRET-LOCAL-INVITE/, f);
  }
});

test('every flag setup passes to create, invite, accept-invite, register, set-server and show-server is one aw 1.36.56 has', () => {
  const flags = { create: ['--name', '--namespace', '--json'], invite: ['--team', '--namespace', '--json'], 'accept-invite': ['--token-stdin', '--name', '--local', '--json'], register: ['--service', '--team', '--json'], 'set-server': ['--team', '--namespace', '--url', '--json'], 'show-server': ['--team', '--namespace', '--json'] };
  for (const [command, wanted] of Object.entries(flags)) {
    const help = captured(`help-${command}`);
    assert.equal(help.exit, 0, command);
    for (const flag of wanted) assert.match(help.stdout, new RegExp(`^\\s+(?:-\\w, )?${flag}\\b`, 'm'), `aw id team ${command} ${flag}`);
  }
});

test('the fake\'s answers have real aw\'s shapes: create, invite and their refusals', (t) => {
  const fake = fakeAwSetupPath(t), dir = scratch(t), cwd = join(dir, 'home', 'deployment');
  const aw = (args, extra = {}) => spawnSync(join(fake.path, 'aw'), args, { cwd, encoding: 'utf8', timeout: 30000, env: { PATH: fake.path, ...extra } });

  const refused = aw(['id', 'team', 'create', '--name=eng', `--namespace=${NS}`, '--json'], { AW_CREATE_MODE: 'no-controller-key' });
  const realRefused = captured('create-no-controller-key');
  assert.equal(refused.status, realRefused.exit);
  assert.equal(envelope(refused.stdout).code, envelope(realRefused.stdout).code);
  assert.ok(envelope(refused.stdout).message.startsWith(envelope(realRefused.stdout).message), 'the fake adds only its sentinel to aw\'s text');

  const noKey = aw(['id', 'team', 'invite', '--team=eng', `--namespace=${NS}`, '--json']);
  const realNoKey = captured('invite-no-team-key');
  assert.deepEqual([noKey.status, noKey.stdout, noKey.stderr], [realNoKey.exit, realNoKey.stdout.replace(/nokey/g, 'eng'), realNoKey.stderr.replace(/nokey/g, 'eng')]);

  const created = aw(['id', 'team', 'create', '--name=eng', `--namespace=${NS}`, '--json']);
  assert.equal(created.status, 0, created.stderr);
  assert.deepEqual(Object.keys(JSON.parse(created.stdout)), Object.keys(JSON.parse(derived('create-created').stdout)));

  const invite = aw(['id', 'team', 'invite', '--team=eng', `--namespace=${NS}`, '--json']);
  const realInvite = JSON.parse(captured('invite-team-key').stdout);
  assert.equal(invite.status, 0, invite.stderr);
  assert.deepEqual(Object.keys(JSON.parse(invite.stdout)), Object.keys(realInvite));
  assert.equal(JSON.parse(invite.stdout).status, realInvite.status);

  for (const [mode, name] of [['pinned', 'create-team-pinned'], ['registry-409', 'create-team-registry-409']]) {
    const taken = aw(['id', 'team', 'create', '--name=eng', `--namespace=${NS}`, '--json'], { AW_CREATE_MODE: mode });
    const shape = derived(name);
    assert.deepEqual([taken.status, taken.stdout, taken.stderr], [shape.exit, shape.stdout, shape.stderr], mode);
  }
});

test('the fake\'s team-server record has real aw\'s shapes: none, published, verified', (t) => {
  const fake = fakeAwSetupPath(t), dir = scratch(t), cwd = join(dir, 'home', 'deployment');
  const aw = (args) => spawnSync(join(fake.path, 'aw'), args, { cwd, encoding: 'utf8', timeout: 30000, env: { PATH: fake.path } });
  const target = ['--team=eng', `--namespace=${NS}`];
  assert.equal(aw(['id', 'team', 'create', '--name=eng', `--namespace=${NS}`, '--json']).status, 0);

  const none = aw(['id', 'team', 'show-server', ...target, '--json']), noneShape = derived('show-server-none');
  assert.deepEqual([none.status, none.stdout, none.stderr], [noneShape.exit, noneShape.stdout, noneShape.stderr]);

  for (const [args, name] of [[['set-server', ...target, '--url=https://aweb.example.invalid/api'], 'set-server-published'], [['show-server', ...target], 'show-server-verified']]) {
    const r = aw(['id', 'team', ...args, '--json']), shape = JSON.parse(derived(name).stdout);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(out), Object.keys(shape), name);
    for (const k of ['status', 'team_id', 'server_url', 'audience']) assert.equal(out[k], shape[k], `${name} ${k}`);
  }
});

test('real aw: the offline answers still have the captured shapes', { skip: !realAw && 'set OATS_AWEB_TEST_AW to an aw 1.36.56 or later binary' }, (t) => {
  const dir = scratch(t), home = join(dir, 'home'), cwd = join(home, 'deployment');
  const refused = runAw(realAw, home, cwd, ['id', 'team', 'create', '--name=eng', `--namespace=${NS}`, '--json']);
  const realRefused = captured('create-no-controller-key');
  assert.deepEqual([refused.status, refused.stdout, refused.stderr], [realRefused.exit, realRefused.stdout, realRefused.stderr]);

  writeTeamKey(home);
  const invite = runAw(realAw, home, cwd, ['id', 'team', 'invite', '--team=eng', `--namespace=${NS}`, '--json']);
  assert.equal(invite.status, 0, invite.stderr);
  const minted = JSON.parse(invite.stdout);
  assert.deepEqual(Object.keys(minted), Object.keys(JSON.parse(captured('invite-team-key').stdout)));
  assert.equal(typeof minted.token, 'string');
  assert.ok(minted.token.length > 0);
  assert.equal(invite.stderr, '');
  assert.deepEqual(readdirSync(join(home, '.config', 'aw', 'team-invites')), [`${minted.invite_id}.json`], 'aw keeps the invite record user-wide');

  for (const [name, args] of [['set-server-unreachable', ['set-server', '--team=eng', `--namespace=${NS}`, '--url=http://127.0.0.1:9/api']], ['show-server-unreachable', ['show-server', '--team=eng', `--namespace=${NS}`]]]) {
    const r = runAw(realAw, home, cwd, ['id', 'team', ...args, '--json']), shape = captured(name);
    assert.deepEqual([r.status, r.stdout, r.stderr], [shape.exit, shape.stdout, shape.stderr], name);
  }
});

// A fresh deployment, as the real binary sees one: an empty HOME, so `aw whoami` finds no root
// identity, and no namespace controller key. Nothing reaches a registry.
function realSetupCreate(t, more = []) {
  const dir = scratch(t), home = join(dir, 'home'), deployment = join(home, 'deployment'), bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'aw'), `#!/bin/sh\nexec ${JSON.stringify(realAw)} "$@"\n`);
  chmodSync(join(bin, 'aw'), 0o755);
  writeFileSync(join(deployment, 'oats-local.yaml'), 'schemaVersion: 2\nworkspace: fixture\n');
  const cli = join(dir, 'oats');
  const teams = { teamsApi: 1, deployment, defaultTeam: null, teams: [], souls: { teams: {}, default: {} }, problems: [] };
  writeFileSync(cli, `#!${process.execPath}\nif (process.argv[2] === "teams" && process.argv[3] === "--json") console.log(${JSON.stringify(JSON.stringify({ schemaVersion: 1, ok: true, result: teams }))});\n`, { mode: 0o755 });
  const env = { HOME: home, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, AWID_REGISTRY_URL: 'http://127.0.0.1:9', AWEB_URL: 'http://127.0.0.1:9/api', OATS_EVENT: 'setup', OATS_WORKSPACE: deployment, OATS_CLI_BIN: cli, OATS_SETTINGS: JSON.stringify({ root: deployment }) };
  const r = spawnSync(process.execPath, [hook, 'setup', '--create', 'eng', '--namespace', NS, ...more], { cwd: deployment, env, encoding: 'utf8', timeout: 60000 });
  return { r, home, deployment };
}

test('real aw: setup --create with no namespace controller key names it and creates nothing', { skip: !realAw && 'set OATS_AWEB_TEST_AW to an aw 1.36.56 or later binary' }, (t) => {
  const { r, home, deployment } = realSetupCreate(t, ['--name', 'lab-root']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /aw id team failed \(exit 2\) \(output withheld: this command handles credentials; the namespace controller key for this namespace is not on this machine\); run `aw id namespace prepare-controller --domain example\.invalid` as this user, or create the team where that key is, then re-run; nothing was created/);
  assert.doesNotMatch(r.stdout + r.stderr, /pass --hosted/);
  assert.equal(existsSync(join(deployment, '.aweb-roots')), false);
  assert.equal(existsSync(join(home, '.awid', 'team-keys')), false);
});

// awebai/oats-aweb#208, live lab: without --name, a fresh deployment's create stops before aw writes a team key.
test('real aw: setup --create on a fresh deployment without --name stops before create, naming --name <alias>', { skip: !realAw && 'set OATS_AWEB_TEST_AW to an aw 1.36.56 or later binary' }, (t) => {
  const { r, home, deployment } = realSetupCreate(t);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.stderr, 'oats aweb setup: --name <alias> is required when no root identity is available; aliases must match the aweb 1-64 character rule; nothing was created\n');
  assert.equal(existsSync(join(deployment, '.aweb-roots')), false);
  assert.equal(existsSync(join(home, '.awid')), false);
});
