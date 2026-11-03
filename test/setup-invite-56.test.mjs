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
import { createHash } from 'node:crypto';
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
  // The joined team becomes the deployment's default, which the soul takes as its own.
  const f = fixture(t, { soulTeams: { dev: { defaultTeam: { label: LABEL, team: TEAM, from: 'deployment' }, teams: [{ label: LABEL, team: TEAM, default: true, from: 'local', via: ['default'] }] } } });
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
  // The resume command is exact: the label and the invite's service.
  assert.match(JSON.parse(failed.stdout).error.message, new RegExp(`oats aweb setup --dir \\S+ --soul dev --join ${LABEL} --service ${SERVICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
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

test('a derived label already mapped to the invite\'s team is reused: one accept, other roots and the default unchanged', t => {
  const prior = { label: 'prior', team: 'prior:example.invalid', from: 'deployment' };
  const f = fixture(t, { teams: [{ ...prior, from: 'local' }, { label: LABEL, team: TEAM, from: 'shared' }], defaultTeam: prior });
  const local = join(f.dep, 'oats-local.yaml');
  writeFileSync(local, 'schemaVersion: 2\nworkspace: fixture\nsettings:\n  oats.aweb:\n    roots:\n      "prior:example.invalid": "/prior/root"\n');
  const r = f.run(['--invite-stdin', '--name', 'host', '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).result.label, LABEL);
  assert.equal(f.accepts().length, 1);
  assert.deepEqual(f.kernel.read().defaultTeam, prior, 'the default is unchanged');
  assert.deepEqual(f.kernel.calls().filter(c => ['add', 'default'].includes(c.args[1])), [], 'the mapping is reused, not written');
  assert.match(readFileSync(local, 'utf8'), /"prior:example\.invalid": "\/prior\/root"/, 'another team\'s root is untouched');
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

// --- review follow-ups -------------------------------------------------------

test('a workspace default with the derived label unmapped refuses before redeeming (E_SETUP_DEFAULT_PRESERVE)', t => {
  const d = { label: 'prior', team: 'prior:example.invalid', from: 'workspace' };
  const f = fixture(t, { teams: [{ ...d, from: 'shared' }], defaultTeam: d });
  const r = f.run(['--invite-stdin', '--name', 'host', '--json']);
  const error = refused(f, r, 'E_SETUP_DEFAULT_PRESERVE');
  assert.deepEqual(error.details.commands, [['oats', 'teams', 'add', LABEL, '--team', TEAM, '--dir', f.dep]], 'the exact command names the invite\'s team');
});

test('a team already mapped under another label joins under that label, and says so', t => {
  const f = fixture(t, { teams: [{ label: 'ops', team: TEAM, from: 'local' }], defaultTeam: { label: 'ops', team: TEAM, from: 'deployment' } });
  const json = f.run(['--invite-stdin', '--name', 'host', '--json']);
  assert.equal(json.status, 0, json.stdout + json.stderr);
  const result = JSON.parse(json.stdout).result;
  assert.equal(result.label, 'ops');
  assert.equal(result.labelFrom, 'mapping');
  assert.equal(result.teamRoot, join(f.dep, '.aweb-roots', 'ops'));
  assert.deepEqual(f.kernel.read().teams.map(r => r.label), ['ops'], 'no new label');
  assert.equal(f.accepts().length, 1);
});

test('the human output names the mapped label it uses', t => {
  const f = fixture(t, { teams: [{ label: 'ops', team: TEAM, from: 'local' }], defaultTeam: { label: 'ops', team: TEAM, from: 'deployment' } });
  const r = f.run(['--invite-stdin', '--name', 'host']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`Using label ops, already mapped to ${TEAM.replace(/\./g, '\\.')}\\.`));
});

test('a deployment already a member of the team refuses before redeeming, and never re-points roots[team]', t => {
  const f = fixture(t);
  const member = join(f.dir, 'member-root');
  mkdirSync(join(member, '.aw'), { recursive: true });
  writeFileSync(join(member, '.aw', 'teams.json'), JSON.stringify({ memberships: [{ team_id: TEAM }] }));
  const settings = JSON.stringify({ roots: { [TEAM]: member } });
  const r = f.run(['--invite-stdin', '--name', 'host', '--json'], { OATS_SETTINGS: settings });
  const error = refused(f, r, 'E_SETUP_ALREADY_MEMBER');
  assert.ok(error.message.startsWith(`already a member of ${TEAM} at ${member}; nothing redeemed`), error.message);
  assert.doesNotMatch(readFileSync(join(f.dep, 'oats-local.yaml'), 'utf8'), /roots/, 'roots[team] is not re-pointed');
});

/** A shared root (settings.root, no roots[team]) whose `aw team list` lists the team or cannot be read. */
function sharedRoot(f, { list } = {}) {
  const member = join(f.dir, 'member-root');
  mkdirSync(join(member, '.aw'), { recursive: true });
  writeFileSync(join(member, '.aw', 'teams.json'), JSON.stringify({ memberships: [{ team_id: TEAM }] }));
  return { member, extra: { OATS_SETTINGS: JSON.stringify({ root: member }), ...(list ? { AW_LIST_TEAMS: list } : {}) } };
}

test('a shared root (settings.root) already in the team refuses before redeeming, naming the mapping it lacks', t => {
  const f = fixture(t);
  const { member, extra } = sharedRoot(f);
  const r = f.run(['--invite-stdin', '--name', 'host', '--json'], extra);
  const error = refused(f, r, 'E_SETUP_ALREADY_MEMBER');
  assert.ok(error.message.startsWith(`already a member of ${TEAM} at ${member}; nothing redeemed`), error.message);
  // No kernel team maps the team, and this root is no per-team root a resume would find: record the mapping.
  assert.ok(error.message.includes(`oats teams add ${LABEL} --team ${TEAM} --no-default --dir ${f.dep}`), error.message);
  assert.doesNotMatch(readFileSync(join(f.dep, 'oats-local.yaml'), 'utf8'), /roots/, 'roots is unchanged');
});

test('the mapping remedy keeps a workspace default: oats teams add ... --no-default', t => {
  const prior = { label: 'prior', team: 'prior:example.invalid', from: 'workspace' };
  const f = fixture(t, { teams: [{ ...prior, from: 'shared' }], defaultTeam: prior });
  const { extra } = sharedRoot(f);
  const error = refused(f, f.run(['--invite-stdin', '--name', 'host', '--json'], extra), 'E_SETUP_ALREADY_MEMBER');
  // Without --no-default the first local team would become the deployment's default over the workspace's.
  assert.ok(error.message.includes(`oats teams add ${LABEL} --team ${TEAM} --no-default --dir ${f.dep}`), error.message);
});

test('in a workspace closed to local teams, the mapping remedy names the workspace commit', t => {
  const f = fixture(t, { localTeams: false });
  const { extra } = sharedRoot(f);
  const error = refused(f, f.run(['--invite-stdin', '--name', 'host', '--json'], extra), 'E_SETUP_ALREADY_MEMBER');
  assert.doesNotMatch(error.message, /oats teams add/);
  assert.ok(error.message.includes(`commit ${JSON.stringify(LABEL)}: { team: ${JSON.stringify(TEAM)} } under teams: in oats-workspace.yaml`), error.message);
});

test('a shared root whose membership cannot be read refuses before redeeming (E_SETUP_MEMBERSHIP), never as "not a member"', t => {
  const f = fixture(t);
  const { member, extra } = sharedRoot(f, { list: 'not-json' });
  const r = f.run(['--invite-stdin', '--name', 'host', '--json'], extra);
  const error = refused(f, r, 'E_SETUP_MEMBERSHIP');
  assert.equal(error.message, `membership at ${member} could not be read; nothing redeemed`);
  assert.doesNotMatch(readFileSync(join(f.dep, 'oats-local.yaml'), 'utf8'), /roots/, 'roots is unchanged');
});

test('a member root an earlier run recorded but never mapped names the tokenless resume, which finishes without redeeming', t => {
  const f = fixture(t);
  const ran = f.kernel.read();
  f.kernel.set({ ...ran, failure: 'add-before' });
  const first = f.run(['--invite-stdin', '--name', 'host', '--json']);
  assert.equal(first.status, 1, first.stdout + first.stderr);
  assert.equal(f.accepts().length, 1);
  f.kernel.set({ ...f.kernel.read(), failure: undefined });
  const root = join(f.dep, '.aweb-roots', LABEL);
  const settings = { OATS_SETTINGS: JSON.stringify({ roots: { [TEAM]: root } }) };
  const again = f.run(['--invite-stdin', '--name', 'host', '--json'], settings);
  assert.equal(again.status, 1, again.stdout + again.stderr);
  const error = JSON.parse(again.stdout).error;
  assert.equal(error.code, 'E_SETUP_ALREADY_MEMBER');
  const resume = `oats aweb setup --dir ${f.dep} --soul dev --join ${LABEL} --service ${SERVICE}`;
  assert.ok(error.message.includes(resume), error.message);
  assert.equal(f.accepts().length, 1, 'the refusal redeems nothing');
  const resumed = f.run(resume.split(' ').slice(3), settings, '');
  assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  assert.equal(f.accepts().length, 1, 'the resume redeems nothing');
  assert.ok(f.kernel.read().teams.some(row => row.label === LABEL && row.team === TEAM), 'the resume records the mapping');
});

test('an inspect failure names the label already mapped to the invite\'s team in its resume', t => {
  const f = fixture(t, { teams: [{ label: 'ops', team: TEAM, from: 'local' }] });
  const r = f.run(['--invite-stdin', '--name', 'host', '--json'], { AW_INSPECT_FAIL: 'exhausted', AW_INSPECT_FAIL_INVITE: '1' });
  const error = refused(f, r, 'E_SETUP_INVITE_INSPECT');
  assert.ok(error.message.includes(`oats aweb setup --dir ${f.dep} --soul dev --join ops --service ${SERVICE}`), error.message);
});

for (const [name, extra] of [
  ['aw 1.36.52 (no inspect)', { AW_FAKE_VERSION: '1.36.52' }],
  ['an inspect that fails (no invite preview)', { AW_INSPECT_FAIL: 'unknown_or_invalid' }],
  ['a controller envelope', { AW_INSPECT_KIND: 'controller' }],
  ['a global envelope', { AW_INSPECT_SCOPE: 'global' }],
]) test(`released --join L --invite with a mapped label and ${name} proceeds as released`, t => {
  const f = fixture(t, { teams: [{ label: 'mine', team: TEAM, from: 'local' }] });
  const r = f.run(['--join', 'mine', '--invite-stdin', '--name', 'host', '--service', SERVICE, '--json'], extra);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(f.accepts().length, 1);
  if (extra.AW_FAKE_VERSION === '1.36.52') assert.deepEqual(f.inspects(), [], 'no inspect below aw 1.36.53');
  assertTokenContained(f, r);
});

test('the released --join form passes the token to accept on stdin, never its argv', t => {
  const f = fixture(t);
  const r = f.run(['--join', 'mine', '--invite', TOKEN, '--name', 'host', '--service', SERVICE, '--json'], { AW_FAKE_VERSION: '1.36.33' }, '');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const accept = f.accepts()[0];
  assert.ok(accept.args.includes('--token-stdin'));
  assert.equal(accept.stdinSha256, createHash('sha256').update(TOKEN).digest('hex'), 'aw got exactly the token on stdin');
  for (const c of f.calls()) assert.ok(!c.args.join(' ').includes(TOKEN), `token on aw argv: ${c.args.join(' ')}`);
});

test('an invite for a GLOBAL identity refuses before redeeming, asking for a LOCAL invite', t => {
  const f = fixture(t);
  const r = f.run(['--invite-stdin', '--name', 'host', '--json'], { AW_INSPECT_SCOPE: 'global' });
  const error = refused(f, r, 'E_SETUP_INVITE_SCOPE');
  assert.match(error.message, /ask for a LOCAL member invite/);
  assert.match(error.message, /GLOBAL resident journey/);
  assert.doesNotMatch(error.message, /--service/);
});

test('a hosted invite whose identity scope is unknown joins with --local', t => {
  const f = fixture(t);
  const r = f.run(['--invite-stdin', '--name', 'host', '--json'], { AW_INSPECT_SCOPE: 'unknown' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(f.accepts()[0].args.includes('--local'));
});

test('--install-aw upgrades an aw older than 1.36.53 before the invite is read', t => {
  const f = fixture(t);
  const versionFile = join(f.dir, 'aw-version'), npmLog = join(f.dir, 'npm.jsonl');
  writeFileSync(join(f.aw.path, 'npm'), `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(npmLog)},JSON.stringify(process.argv.slice(2))+'\\n');fs.writeFileSync(${JSON.stringify(versionFile)},'1.36.53\\n');console.log('added 1 package');\n`, { mode: 0o755 });
  const r = f.run(['--install-aw', '--invite-stdin', '--name', 'host', '--json'], { AW_FAKE_VERSION: '1.36.40', AW_FAKE_VERSION_FILE: versionFile });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readFileSync(npmLog, 'utf8').trim().split('\n').map(JSON.parse), [['install', '-g', '@awebai/aw@^1.36.53']]);
  assert.equal(f.accepts().length, 1);
});

test('an explicit --service for another service refuses before redeeming (E_SETUP_SERVICE_MISMATCH)', t => {
  const f = fixture(t);
  const r = f.run(['--invite-stdin', '--name', 'host', '--service', 'https://other.example.invalid/api', '--json']);
  const error = refused(f, r, 'E_SETUP_SERVICE_MISMATCH');
  assert.match(error.message, /--service https:\/\/other\.example\.invalid\/api is not the invite's service https:\/\/svc\.example\.invalid\/api/);
});

test('an explicit --service equal to the invite\'s up to its /api mount is the same service', t => {
  const f = fixture(t);
  const r = f.run(['--invite-stdin', '--name', 'host', '--service', 'https://svc.example.invalid', '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(f.accepts().length, 1);
});

for (const status of ['exhausted', 'expired', 'revoked']) test(`an ${status} invite names the exact resume command from aw's envelope`, t => {
  const f = fixture(t);
  const r = f.run(['--invite-stdin', '--name', 'host', '--json'], { AW_INSPECT_FAIL: status, AW_INSPECT_FAIL_INVITE: '1' });
  const error = refused(f, r, 'E_SETUP_INVITE_INSPECT');
  assert.ok(error.message.includes(`oats aweb setup --dir ${f.dep} --soul dev --join ${LABEL} --service ${SERVICE}`), error.message);
});

const PRIOR = { label: 'prior', team: 'prior:example.invalid', from: 'deployment' };
const preserved = (soulTeams) => ({ teams: [{ ...PRIOR, from: 'local' }], defaultTeam: PRIOR, ...(soulTeams ? { soulTeams: { dev: soulTeams } } : {}) });
const row = (label, team, isDefault = false) => ({ label, team, default: isDefault, from: 'local', via: [isDefault ? 'default' : 'workspace'] });
/** One Next: line in text, the same step in JSON, and the preserved default folded into the note. */
function oneNext(t, state, step, { command = true } = {}) {
  const j = fixture(t, state).run(['--invite-stdin', '--name', 'host', '--json']);
  assert.equal(j.status, 0, j.stdout + j.stderr);
  const result = JSON.parse(j.stdout).result;
  assert.equal(result.next, step);
  assert.equal(result.remaining, undefined, 'remaining is folded into the note');
  assert.match(result.note, new RegExp(`oats teams default ${LABEL} --dir `));
  const h = fixture(t, state).run(['--invite-stdin', '--name', 'host']);
  assert.equal(h.status, 0, h.stdout + h.stderr);
  const lines = h.stdout.split('\n').filter(l => /Next:/.test(l));
  assert.equal(lines.length, 1, h.stdout);
  assert.ok(lines[0].startsWith(command ? `Next: \`${step}\`` : `Next: ${step}`), lines[0]);
  assert.doesNotMatch(h.stdout, /"remaining"/);
  return { result, line: lines[0] };
}

test('with the default preserved and the new team the soul\'s default, the next step is a plain spawn', t => {
  oneNext(t, preserved({ defaultTeam: { label: LABEL, team: TEAM, from: 'soul' }, teams: [row(LABEL, TEAM, true), row('prior', PRIOR.team)] }), 'oats spawn dev --preview');
});

test('with the default preserved and the new team eligible for the soul, the next step joins it', t => {
  const { result } = oneNext(t, preserved({ defaultTeam: PRIOR, teams: [row('prior', PRIOR.team, true), row(LABEL, TEAM)] }), `oats spawn dev --provider oats.aweb join=${LABEL} --preview`);
  assert.equal(result.nextNote, undefined, 'eligibility was read, nothing is assumed');
});

test('with the new team not eligible for the soul, the one next step is the shared souls: change', t => {
  const { result } = oneNext(t, preserved({ defaultTeam: PRIOR, teams: [row('prior', PRIOR.team, true)] }),
    `make ${LABEL} eligible for dev: add it to dev's teams in the souls: of oats-workspace.yaml, a shared-file change (/oats-teams); then \`oats spawn dev --provider oats.aweb join=${LABEL} --preview\``, { command: false });
  assert.equal(result.nextNote, undefined);
});

test('when the soul\'s teams cannot be read, the next step keeps the join spawn and says it assumes eligibility', t => {
  const { result, line } = oneNext(t, preserved(), `oats spawn dev --provider oats.aweb join=${LABEL} --preview`);
  assert.equal(result.nextNote, `assumes ${LABEL} is eligible for dev: oats soul teams dev could not be read`);
  assert.ok(line.endsWith(`(${result.nextNote})`), line);
});
