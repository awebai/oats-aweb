// awebai/oats-aweb#56: `oats aweb setup --invite <token>` / `--invite-stdin`
// without `--join`. The team, service and label come from the invite through
// `aw team invite inspect` (aw 1.36.53), which reads the token on stdin and
// redeems nothing. `--join <label>` stays as released and, when given, must
// match the invite's team. Every check refuses before anything is redeemed,
// and the token never reaches an argv, the output or a file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fakeAwSetupPath } from './helpers/fake-aw-setup.mjs';
import { fakeKernelTeamConfig } from './helpers/fake-kernel-team-config.mjs';
const hook = fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs', import.meta.url));
const TEAM = 'ops_team:example.invalid', LABEL = 'ops-team', SERVICE = 'https://svc.example.invalid/api';
const TOKEN = 'aw_inv_SECRET-JOIN-CODE-0123456789abcdef';

function fixture(t, state = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'setup-invite-56-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dep = join(dir, 'deployment');
  mkdirSync(dep);
  writeFileSync(join(dep, 'oats-local.yaml'), 'schemaVersion: 2\nworkspace: fixture\n');
  const kernel = fakeKernelTeamConfig(join(dir, 'kernel'), dep, state), aw = fakeAwSetupPath(t);
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OATS_|AWEB_)/.test(k)));
  const env = { ...clean, PATH: aw.path, OATS_TEAM_SCOPE: dep, OATS_WORKSPACE: dep, OATS_WORKSPACE_NAME: 'fixture', OATS_SETTINGS: '{}',
    OATS_CLI_BIN: kernel.cli, OATS_TEAMS: '[]', AW_FAKE_TEAM: TEAM, AW_FAKE_VERSION: '1.36.53', AW_INSPECT_SERVICE: SERVICE };
  const run = (args, extra = {}, input = `${TOKEN}\n`) => spawnSync(process.execPath, [hook, 'setup', '--soul', 'dev', ...args],
    { cwd: dep, env: { ...env, ...extra }, encoding: 'utf8', input });
  const calls = () => aw.readCalls();
  const accepts = () => calls().filter(c => c.args.includes('accept-invite'));
  const inspects = () => calls().filter(c => c.args.slice(0, 3).join(' ') === 'team invite inspect');
  return { dir, dep, kernel, aw, run, calls, accepts, inspects };
}
function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p)); else out.push({ path: p, text: readFileSync(p, 'utf8') });
  }
  return out;
}
/** The token is in no aw or kernel argv, no output and no file of the deployment. */
function assertTokenContained(f, r) {
  assert.ok(!(r.stdout + r.stderr).includes(TOKEN), 'token in setup output');
  for (const c of f.calls()) assert.ok(!c.args.join(' ').includes(TOKEN), `token on aw argv: ${c.args.join(' ')}`);
  for (const c of f.kernel.calls()) assert.ok(!c.args.join(' ').includes(TOKEN), `token on kernel argv: ${c.args.join(' ')}`);
  for (const file of filesUnder(f.dep)) assert.ok(!file.text.includes(TOKEN), `token written to ${file.path}`);
}
const refused = (f, r, code) => {
  console.error('DBG', JSON.stringify(r.stdout), JSON.stringify(r.stderr));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const error = JSON.parse(r.stdout).error;
  assert.equal(error.code, code, r.stdout);
  assert.deepEqual(f.accepts(), [], 'nothing is redeemed before the checks pass');
  assert.equal(existsSync(join(f.dep, '.aweb-roots')), false, 'no root is created');
  assert.deepEqual(f.kernel.calls().filter(c => ['add', 'default'].includes(c.args[1])), [], 'no team is recorded');
  assertTokenContained(f, r);
  return error;
};

test('a hosted invite gives team, service and label: joins beside the deployment with the token only on stdin', t => {
  const f = fixture(t);
  const r = f.run(['--invite-stdin', '--name', 'host', '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const result = JSON.parse(r.stdout).result;
  const root = join(f.dep, '.aweb-roots', LABEL);
  assert.equal(result.team, TEAM);
  assert.equal(result.label, LABEL, 'the label is the team name normalized as --create normalizes it');
  assert.equal(result.teamRoot, root);
  assert.deepEqual(result.invite, { kind: 'hosted', team: TEAM, service: SERVICE });
  assert.equal(result.next, 'oats spawn dev --preview');
  // inspect, then one acceptance, both reading the token on stdin.
  assert.equal(f.inspects().length, 1);
  assert.equal(f.inspects()[0].stdin, true);
  assert.equal(f.accepts().length, 1);
  assert.equal(f.accepts()[0].stdin, true);
  assert.ok(f.accepts()[0].args.includes('--token-stdin'));
  const connect = f.calls().find(c => c.args.includes('connect'));
  assert.ok(connect.args.includes(`--service=${SERVICE}`), 'the service comes from the invite');
  assert.match(readFileSync(join(f.dep, 'oats-local.yaml'), 'utf8'), new RegExp(`"${TEAM.replace(/\./g, '\\.')}": "${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.deepEqual(f.kernel.read().teams.map(r => [r.label, r.team]), [[LABEL, TEAM]]);
  assertTokenContained(f, r);
});

test('--invite <token> works too, and the human output ends with exactly one next step', t => {
  const f = fixture(t);
  const r = f.run(['--invite', TOKEN, '--name', 'host'], {}, '');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.stdout.split('\n').filter(l => /^Next:/.test(l)), ['Next: `oats spawn dev --preview`']);
  assert.match(r.stdout.trim().split('\n').pop(), /^Next: /);
  assert.ok(f.accepts()[0].args.includes('--token-stdin'));
  assert.ok(!(r.stdout + r.stderr).includes(TOKEN));
  for (const c of f.calls()) assert.ok(!c.args.join(' ').includes(TOKEN));
});

test('an admitted but unconnected join resumes with --join <label>, without spending the token again', t => {
  const f = fixture(t);
  const failed = f.run(['--invite-stdin', '--name', 'host', '--json'], { AW_CONNECT_FAIL: '1' });
  assert.equal(failed.status, 1);
  assert.match(JSON.parse(failed.stdout).error.message, new RegExp(`oats aweb setup --dir \\S+ --soul dev --join ${LABEL} --service <url>`));
  const resumed = f.run(['--join', LABEL, '--service', SERVICE, '--json'], {}, '');
  assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  assert.equal(f.accepts().length, 1, 'one redemption across both runs');
  assertTokenContained(f, failed);
});

test('an aw older than 1.36.53 refuses before inspecting, naming the aw upgrade', t => {
  const f = fixture(t);
  // The provider's floor (1.36.33) up to the last aw before 1.36.53: an aw below the floor is
  // refused by the floor check every command runs first.
  for (const version of ['1.36.51', '1.36.33']) {
    const r = f.run(['--invite-stdin', '--name', 'host', '--json'], { AW_FAKE_VERSION: version });
    const error = refused(f, r, 'E_SETUP_AW_VERSION');
    assert.match(error.message, new RegExp(`aw ${version.replace(/\./g, '\\.')}`));
    assert.match(error.message, /aw 1\.36\.53 or later/);
    assert.match(error.message, /--join <label> --invite-stdin/);
    assert.deepEqual(f.inspects(), []);
  }
});

for (const [name, extra, code, cause] of [
  ['an exhausted invite', { AW_INSPECT_FAIL: 'exhausted' }, 'E_SETUP_INVITE_INSPECT', /aw team invite inspect refused the invite \(exhausted\)/],
  ['a service without invite preview', { AW_INSPECT_FAIL: 'unknown_or_invalid' }, 'E_SETUP_INVITE_INSPECT', /\(unknown_or_invalid\)/],
  ['an unrecognised refusal', { AW_INSPECT_FAIL: 'something_new' }, 'E_SETUP_INVITE_INSPECT', /aw team invite inspect failed \(exit 1\)/],
]) test(`an inspect failure (${name}) refuses before redeeming, naming the fallback`, t => {
  const f = fixture(t);
  const r = f.run(['--invite-stdin', '--name', 'host', '--json'], extra);
  const error = refused(f, r, code);
  assert.match(error.message, cause);
  assert.match(error.message, /nothing was redeemed/);
  assert.match(error.message, /--join <label> --invite-stdin/);
  assert.doesNotMatch(error.message, /refused aw_inv|something_new/, 'aw\'s text and unlisted codes are never relayed');
});

test('a controller (non-hosted) invite refuses: its scope and status are unknown', t => {
  const f = fixture(t);
  const r = f.run(['--invite-stdin', '--name', 'host', '--json'], { AW_INSPECT_KIND: 'controller', AW_INSPECT_SERVICE: '' });
  const error = refused(f, r, 'E_SETUP_INVITE_CONTROLLER');
  assert.match(error.message, /scope and status are unknown/);
  assert.match(error.message, /--join <label> --invite-stdin --name <alias> --service <url>/);
});

test('a derived label already mapped to another team refuses and asks for --join <label>, never a suffix', t => {
  const f = fixture(t, { teams: [{ label: LABEL, team: 'other:example.invalid', from: 'local' }] });
  const r = f.run(['--invite-stdin', '--name', 'host', '--json']);
  const error = refused(f, r, 'E_SETUP_LABEL_COLLISION');
  assert.match(error.message, new RegExp(`label ${LABEL}\\b.*other:example\\.invalid`));
  assert.match(error.message, new RegExp(TEAM.replace(/\./g, '\\.')));
  assert.match(error.message, /pass --join <label>/);
  assert.equal(f.kernel.read().teams.length, 1);
});

test('a derived label already mapped to the invite\'s team is reused', t => {
  const f = fixture(t, { teams: [{ label: LABEL, team: TEAM, from: 'shared' }] });
  const r = f.run(['--invite-stdin', '--name', 'host', '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).result.label, LABEL);
});

test('--join <label> with an invite for another team refuses, naming both', t => {
  const f = fixture(t, { teams: [{ label: 'mine', team: 'other:example.invalid', from: 'local' }] });
  const r = f.run(['--join', 'mine', '--invite-stdin', '--name', 'host', '--service', SERVICE, '--json']);
  const error = refused(f, r, 'E_SETUP_JOIN_MISMATCH');
  assert.match(error.message, /--join mine is team other:example\.invalid/);
  assert.match(error.message, new RegExp(`the invite is for ${TEAM.replace(/\./g, '\\.')}`));
});

test('--join <label> with a matching invite joins under that label, as released', t => {
  const f = fixture(t, { teams: [{ label: 'mine', team: TEAM, from: 'local' }] });
  const r = f.run(['--join', 'mine', '--invite-stdin', '--name', 'host', '--service', SERVICE, '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).result.teamRoot, join(f.dep, '.aweb-roots', 'mine'));
  assert.equal(f.inspects().length, 1);
});
