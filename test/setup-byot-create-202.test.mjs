// awebai/oats-aweb#202: `oats aweb setup --create L --namespace D` completes
// against aw as it is. A BYOT create prints no invite token, so setup registers
// the team with the aweb service and mints a local invite with the team key
// create wrote, then accepts, connects and records. A re-run resumes a partial
// create; a missing key gets a fixed cause; aw's own text never passes through.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fakeAwSetupPath } from './helpers/fake-aw-setup.mjs';

const hook = fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs', import.meta.url));
const SERVICE = 'https://aweb.example.invalid/api', NS = 'example.invalid', TEAM = `eng:${NS}`;
const TOKEN = `SECRET-LOCAL-INVITE__${TEAM}`;
const SENTINEL = 'RAW-AW-SENTINEL';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'byot-create-202-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'oats-local.yaml'), 'schemaVersion: 2\nworkspace: fixture\n');
  const kernelCalls = join(root, 'kernel-calls.jsonl'), cli = join(root, 'oats');
  const teams = { teamsApi: 1, deployment: root, defaultTeam: null, teams: [], souls: { teams: {}, default: {} }, problems: [] };
  writeFileSync(cli, `#!${process.execPath}\nconst fs = require("node:fs");\nconst args = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(kernelCalls)}, JSON.stringify({ args }) + "\\n");\nif (args[0] === "teams" && args[1] === "add" && process.env.FIXTURE_TEAMS_ADD_FAIL) { console.error("fixture teams add refusal"); process.exit(1); }\nif (args[0] === "teams" && args[1] === "--json") console.log(${JSON.stringify(JSON.stringify({ schemaVersion: 1, ok: true, result: teams }))});\n`, { mode: 0o755 });
  const fake = fakeAwSetupPath(t);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OATS_|AWEB_|AW_)/.test(k)));
  Object.assign(env, { PATH: fake.path, AWEB_API_KEY: '', AWEB_URL: SERVICE, OATS_EVENT: 'setup', OATS_WORKSPACE: root, OATS_CLI_BIN: cli, OATS_SETTINGS: JSON.stringify({ root }) });
  const run = (extra = {}) => spawnSync(process.execPath, [hook, 'setup', '--create', 'eng', '--namespace', NS], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8', timeout: 30000 });
  const calls = () => fake.readCalls().map((c) => c.args.join(' '));
  const kernel = () => existsSync(kernelCalls) ? readFileSync(kernelCalls, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).args) : [];
  const teamRoot = join(root, '.aweb-roots', 'eng');
  return { root, fake, run, calls, kernel, teamRoot };
}
const named = (calls, prefix) => calls.filter((c) => c.startsWith(prefix));

test('a BYOT create registers the team, mints a local invite and accepts it; the token is in no argv and no output', (t) => {
  const f = fixture(t), r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.calls(), [
    `id team create --name=eng --namespace=${NS} --json`,
    `id team register --service=${SERVICE} --team=${TEAM} --json`,
    `id team invite --team=eng --namespace=${NS} --json`,
    'whoami --json',
    'id team accept-invite --token-stdin --name=fixture --local --json',
    `workspace connect --service=${SERVICE} --team=${TEAM} --json`,
    'team list --json',
  ]);
  const accept = f.fake.readCalls().find((c) => c.args[2] === 'accept-invite');
  assert.equal(accept.stdinSha256, createHash('sha256').update(TOKEN).digest('hex'), 'the minted token reaches accept on stdin');
  for (const c of [...f.fake.readCalls().map((x) => x.args), ...f.kernel()]) assert.ok(!c.join(' ').includes('SECRET-LOCAL-INVITE'), `token in argv: ${c.join(' ')}`);
  assert.doesNotMatch(r.stdout + r.stderr, /SECRET-LOCAL-INVITE/);
  assert.match(r.stdout, new RegExp(`registered with ${SERVICE}`));
  assert.match(r.stdout, new RegExp(`created ${TEAM}, accepted it into ${f.teamRoot}`));
  assert.match(readFileSync(join(f.teamRoot, '.aw', 'workspace.yaml'), 'utf8'), new RegExp(`aweb_url: ${SERVICE}`));
  assert.match(readFileSync(join(f.root, 'oats-local.yaml'), 'utf8'), /"eng:example\.invalid": ".*\.aweb-roots\/eng"/);
  assert.deepEqual(f.kernel(), [['teams', '--json'], ['teams', 'add', 'eng', `--team=${TEAM}`]]);
});

test('a create that prints a token (a future aw) still registers, and mints no invite', (t) => {
  const f = fixture(t), r = f.run({ AW_CREATE_MODE: 'token' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(named(f.calls(), 'id team register').length, 1);
  assert.deepEqual(named(f.calls(), 'id team invite'), []);
  assert.equal(named(f.calls(), 'id team accept-invite').length, 1);
});

test('without AWEB_URL, the service comes from an existing root\'s workspace.yaml', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, '.aw'), { recursive: true });
  writeFileSync(join(f.root, '.aw', 'workspace.yaml'), 'team_id: other:example.invalid\naweb_url: https://root.example.invalid/api\n');
  const r = f.run({ AWEB_URL: '' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(named(f.calls(), 'id team register'), [`id team register --service=https://root.example.invalid/api --team=${TEAM} --json`]);
});

test('with no known service, create fails before any aw call, with the fixed text', (t) => {
  const f = fixture(t), r = f.run({ AWEB_URL: '' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--create eng --namespace example\.invalid needs the aweb service to register the new team with, and none is known: set AWEB_URL to the server's public URL \(hosted aweb is https:\/\/app\.aweb\.ai\/api\) and re-run; nothing was created/);
  assert.deepEqual(f.calls(), []);
  assert.deepEqual(f.kernel(), [['teams', '--json']], 'only the local-teams question, which creates nothing');
});

test('a create that dies before the accept resumes on re-run: same team, no suffix, a fresh invite', (t) => {
  const f = fixture(t);
  const first = f.run({ AW_ACCEPT_FAIL: '1' });
  assert.equal(first.status, 1);
  assert.equal(existsSync(join(f.teamRoot, '.aw', 'identity.yaml')), false);
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(named(f.calls(), 'id team create'), Array(2).fill(`id team create --name=eng --namespace=${NS} --json`), 'no -2 suffix');
  assert.equal(named(f.calls(), 'id team register').length, 2, 'register runs on every create; a re-run is safe');
  assert.equal(named(f.calls(), 'id team invite').length, 2);
  assert.match(r.stdout, new RegExp(`created ${TEAM}, accepted it into ${f.teamRoot}`));
  assert.deepEqual(f.kernel().filter((a) => a[1] === 'add'), [['teams', 'add', 'eng', `--team=${TEAM}`]]);
});

test('a create that dies after the accept resumes on re-run without minting another invite', (t) => {
  const f = fixture(t);
  const first = f.run({ AW_CONNECT_FAIL: '1' });
  assert.equal(first.status, 1);
  assert.match(first.stderr, /workspace connect\/verification failed/);
  assert.equal(existsSync(join(f.teamRoot, '.aw', 'identity.yaml')), true);
  const before = f.calls().length;
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.calls().slice(before), [
    `id team create --name=eng --namespace=${NS} --json`,
    `id team register --service=${SERVICE} --team=${TEAM} --json`,
    'id team list --json',
    `workspace connect --service=${SERVICE} --team=${TEAM} --json`,
    'team list --json',
  ]);
  assert.equal(named(f.calls(), 'id team invite').length, 1, 'only the first run minted');
  assert.equal(named(f.calls(), 'id team accept-invite').length, 1);
  assert.match(readFileSync(join(f.root, 'oats-local.yaml'), 'utf8'), /"eng:example\.invalid": ".*\.aweb-roots\/eng"/);
});

test('a missing namespace controller key gets the fixed cause and remedy, never aw\'s text, and no suffix', (t) => {
  const f = fixture(t), r = f.run({ AW_CREATE_MODE: 'no-controller-key' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /aw id team failed \(exit 2\) \(output withheld: this command handles credentials; the namespace controller key for this namespace is not on this machine\); run `aw id namespace prepare-controller --domain example\.invalid` as this user, or create the team where that key is, then re-run; nothing was created/);
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SENTINEL));
  assert.doesNotMatch(r.stderr, /pass --hosted/);
  assert.deepEqual(f.calls(), [`id team create --name=eng --namespace=${NS} --json`]);
});

test('a register refusal names the HTTP status and the known code, and nothing else of the body', (t) => {
  const f = fixture(t), r = f.run({ AW_REGISTER_FAIL_CODE: 'service_url_mismatch' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(`registering ${TEAM} with the aweb service at ${SERVICE} failed: aw id team failed \\(exit 1\\) \\(output withheld: this command handles credentials; http 422, detail\\.code: service_url_mismatch\\); team ${TEAM} exists and its key is kept on this machine; re-run the same command to resume`));
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(`${SENTINEL}|Content-Type`));
  assert.deepEqual(named(f.calls(), 'id team invite'), [], 'no invite before the service knows the team');
});

for (const [what, code] of [['a code with a newline', 'service_url_mismatch\nINJECTED-LINE'], ['an overlong code', `a${'b'.repeat(48)}`]]) {
  test(`a register refusal with ${what} is service-refused with the status, and the code never shows`, (t) => {
    const f = fixture(t), r = f.run({ AW_REGISTER_FAIL_CODE: code, AW_REGISTER_FAIL_STATUS: '409' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\(output withheld: this command handles credentials; http 409, service-refused\)/);
    for (const part of code.split('\n')) assert.ok(!(r.stdout + r.stderr).includes(part), `${JSON.stringify(part)} shows`);
    assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SENTINEL));
  });
}

test('a team key that is not on this machine gets the fixed cause and remedy, never aw\'s text', (t) => {
  const f = fixture(t), r = f.run({ AW_CREATE_MODE: 'keyless' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(`registering ${TEAM} with the aweb service at ${SERVICE} failed: aw id team failed \\(exit 1\\) \\(output withheld: this command handles credentials; the team key is not on this machine\\); team ${TEAM} exists: run setup as the user whose ~/\\.awid/team-keys/example\\.invalid/ holds its key, or copy the key there, then re-run the same command to resume`));
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(`${SENTINEL}|no such file|key is kept`));
  assert.deepEqual(named(f.calls(), 'id team invite'), []);
});

test('a retry whose only service is the retained root it connected resumes there, without another invite', (t) => {
  const f = fixture(t), service = 'https://public.example.invalid/api';
  const first = f.run({ AWEB_URL: service, FIXTURE_TEAMS_ADD_FAIL: '1' });
  assert.equal(first.status, 1, 'the local mapping failed after the root was connected and recorded');
  assert.match(readFileSync(join(f.teamRoot, '.aw', 'workspace.yaml'), 'utf8'), new RegExp(`aweb_url: ${service}`));
  const before = f.calls().length;
  const r = f.run({ AWEB_URL: '', OATS_SETTINGS: JSON.stringify({ root: f.root, roots: { [TEAM]: f.teamRoot } }) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.calls().slice(before), [
    `id team create --name=eng --namespace=${NS} --json`,
    `id team register --service=${service} --team=${TEAM} --json`,
    'id team list --json',
    'team list --json',
  ]);
  assert.match(r.stdout, new RegExp(`registered with ${service}`));
  assert.deepEqual(f.kernel().filter((a) => a[1] === 'add'), Array(2).fill(['teams', 'add', 'eng', `--team=${TEAM}`]));
});
