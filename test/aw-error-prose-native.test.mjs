// Real aw, temporary HOME and loopback-only services. These pin the prose
// decisions that must remain until the supported aw floor supplies codes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {generateKeyPairSync, randomBytes, randomUUID, sign} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {createServer} from 'node:http';
import {didKeyOfSigningKey} from '../oats-package/capabilities/oats-aweb/lib/member-key.mjs';
import {NAMESPACE_CONTROLLER_KEY_MISSING, TEAM_KEY_MISSING, teamNameTaken, teamServerRecordMissing, usernameUnavailable, withheldFailureCause} from '../oats-package/capabilities/oats-aweb/lib/aw-failure-cause.mjs';
import {readAwVersion} from '../oats-package/capabilities/oats-aweb/lib/binding-wire.mjs';
import {probeAwVersion} from '../oats-package/capabilities/oats-aweb/lib/probe-support.mjs';

const binary = process.env.OATS_AWEB_TEST_AW;
const options = {skip: !binary && 'set OATS_AWEB_TEST_AW to the CI tested aw'};
const NS = 'example.invalid', TEAM = `eng:${NS}`;
const key = () => `-----BEGIN ED25519 PRIVATE KEY-----\n${randomBytes(32).toString('base64')}\n-----END ED25519 PRIVATE KEY-----\n`;
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'aw-prose-'));
  t.after(() => rmSync(home, {recursive: true, force: true}));
  const cwd = join(home, 'cwd'); mkdirSync(cwd);
  const write = (relative, text) => {const p = join(home, relative); mkdirSync(dirname(p), {recursive: true}); writeFileSync(p, text, {mode: 0o600});};
  const run = (args, registry = 'http://127.0.0.1:9', extra = {}) => new Promise((resolve, reject) => {
    const child = spawn(binary, args, {cwd, env: {HOME: home, PATH: '/usr/bin:/bin', AW_NO_UPDATE_CHECK: '1', AWID_REGISTRY_URL: registry, ...extra}, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c);
    child.on('error', reject); child.on('close', status => resolve({status, stdout, stderr}));
  });
  return {home, cwd, write, run};
}
async function service(t, respond) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    requests.push({method: req.method, path: req.url, body});
    res.setHeader('content-type', 'application/json'); respond(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {url: `http://127.0.0.1:${server.address().port}`, requests};
}

test('real aw prose: missing controller and team keys keep their fixed causes', options, async t => {
  const f = fixture(t);
  const missing = await f.run(['id', 'team', 'create', '--name=eng', `--namespace=${NS}`, '--json']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /no local controller key for --namespace example\.invalid/);
  assert.equal(withheldFailureCause(missing), NAMESPACE_CONTROLLER_KEY_MISSING);
  const invite = await f.run(['id', 'team', 'invite', '--team=eng', `--namespace=${NS}`, '--json']);
  assert.notEqual(invite.status, 0);
  assert.match(invite.stderr, /no team key for example\.invalid\/eng/);
  assert.equal(withheldFailureCause(invite), TEAM_KEY_MISSING);
  f.write(`.awid/controllers/${NS}.key`, 'not a PEM key');
  const corrupt = await f.run(['id', 'team', 'create', '--name=eng', `--namespace=${NS}`, '--json']);
  assert.notEqual(corrupt.status, 0);
  assert.match(corrupt.stderr, /load controller key for example\.invalid/);
  assert.equal(withheldFailureCause(corrupt), NAMESPACE_CONTROLLER_KEY_MISSING);
});

test('real aw prose: a failed join-from invite has the native no-mint suffix', options, async t => {
  const f = fixture(t), root = join(f.home, 'root');
  mkdirSync(join(root, '.aw'), {recursive: true});
  const r = await f.run(['init', `--join-from=${root}`, `--join-team=${TEAM}`, '--name=worker', '--json', '--do-not-touch-agents-md']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /; alternatively use --admission-team-id eng:example\.invalid with host authorization/);
});

test('real aw prose: service register unwraps detail to a top-level code', options, async t => {
  const f = fixture(t), pem = key(), did = didKeyOfSigningKey(pem);
  f.write(`.awid/team-keys/${NS}/eng.key`, pem);
  const s = await service(t, (req, res) => {
    if (req.method === 'POST' && req.url.endsWith('/teams/service-register')) {
      res.statusCode = 422; res.end(JSON.stringify({detail: {code: 'service_url_mismatch', message: 'NATIVE-BODY-SENTINEL'}}));
    } else if (req.url.includes('/teams/eng')) res.end(JSON.stringify({team_id: TEAM, team_did_key: did, name: 'eng', domain: NS}));
    else {res.statusCode = 404; res.end('{}');}
  });
  const r = await f.run(['id', 'team', 'register', `--team=${TEAM}`, `--service=${s.url}`, `--registry=${s.url}`, '--json'], s.url);
  assert.notEqual(r.status, 0);
  assert.ok(s.requests.some(q => q.method === 'POST' && q.path.endsWith('/teams/service-register')), r.stderr);
  assert.match(r.stderr, /service register: http 422: \{"code":"service_url_mismatch","message":"NATIVE-BODY-SENTINEL"\}/);
  assert.doesNotMatch(r.stderr, /"detail"/);
  // Missing controller key wording at register is a separate real path.
  rmSync(join(f.home, '.awid', 'team-keys', NS, 'eng.key'));
  const noKey = await f.run(['id', 'team', 'register', `--team=${TEAM}`, `--service=${s.url}`, '--json'], s.url);
  assert.notEqual(noKey.status, 0);
  assert.match(noKey.stderr, /local team controller key for eng:example\.invalid was not found/);
  assert.equal(withheldFailureCause(noKey), TEAM_KEY_MISSING);
});

test('real aw prose: missing team-server record and name conflicts are classified', options, async t => {
  const f = fixture(t), foreignDid = didKeyOfSigningKey(key()), controller = key();
  f.write(`.awid/controllers/${NS}.key`, controller);
  let mode = 'missing';
  const s = await service(t, (req, res) => {
    if (mode === 'missing') {res.statusCode = 404; res.end('{}');}
    else if (req.method === 'POST' && /\/teams\/?$/.test(req.url)) {res.statusCode = 409; res.end(JSON.stringify({detail: 'team exists'}));}
    else if (req.method === 'GET' && req.url.includes('/teams/eng')) {
      if (mode === 'unreadable') {res.statusCode = 503; res.end('{}');}
      else res.end(JSON.stringify({team_did_key: foreignDid, name: 'eng', domain: NS}));
    } else res.end(JSON.stringify({domain: NS, controller_did: didKeyOfSigningKey(controller)}));
  });
  const missing = await f.run(['id', 'team', 'show-server', '--team=eng', `--namespace=${NS}`, `--registry=${s.url}`, '--json'], s.url);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /no team server record is published for eng:example\.invalid/);
  assert.equal(teamServerRecordMissing(missing.stdout, TEAM), true);
  for (mode of ['pinned', 'unreadable']) {
    const r = await f.run(['id', 'team', 'create', '--name=eng', `--namespace=${NS}`, `--registry=${s.url}`, '--json'], s.url);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, mode === 'pinned' ? /team example\.invalid\/eng is already pinned to did:key:/ : /create team at registry:/);
    assert.equal(teamNameTaken(r.stdout, NS, 'eng'), true, r.stderr);
  }
});

test('real aw prose: version and count-only help match the feature readers', options, async t => {
  const f = fixture(t), version = await f.run(['version']), help = await f.run(['mail', 'inbox', '--help']);
  assert.equal(version.status, 0);
  const matched = /^aw (\S+)$/m.exec(version.stdout); assert.ok(matched);
  assert.equal(probeAwVersion(version.stdout), matched[1]);
  assert.equal(await readAwVersion({env: {HOME: f.home, PATH: `${dirname(binary)}:${dirname(process.execPath)}:/usr/bin:/bin`}}), matched[1]);
  assert.equal(help.status, 0); assert.ok(help.stdout.includes('--count-only'));
});

test('real aw prose: a native mutating timeout names the uncertain outcome', options, async t => {
  const f = fixture(t), pair = generateKeyPairSync('ed25519');
  const pem = `-----BEGIN ED25519 PRIVATE KEY-----\n${pair.privateKey.export({format: 'der', type: 'pkcs8'}).subarray(-32).toString('base64')}\n-----END ED25519 PRIVATE KEY-----\n`;
  const did = didKeyOfSigningKey(pem), certPath = 'team-certs/eng__example.invalid.pem';
  const cert = {version: 1, certificate_id: randomUUID(), team_id: TEAM, team_did_key: did,
    member_did_key: did, alias: 'worker', identity_scope: 'local', issued_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z')};
  cert.signature = sign(null, Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(cert).sort().map(k => [k, cert[k]])))), pair.privateKey).toString('base64').replace(/=+$/, '');
  f.write('cwd/.aw/signing.key', pem);
  f.write('cwd/.aw/identity.yaml', `did: ${did}\ncustody: self\nidentity_scope: local\n`);
  f.write(`cwd/.aw/${certPath}`, JSON.stringify(cert));
  const s = await service(t, (req, res) => {if (req.method === 'GET') res.end('{}');});
  const membership = `    - team_id: ${TEAM}\n      alias: worker\n      cert_path: ${certPath}\n      workspace_id: ${randomUUID()}\n`;
  f.write('cwd/.aw/teams.yaml', `active_team: ${TEAM}\nmemberships:\n${membership}      aweb_url: ${s.url}\n`);
  f.write('cwd/.aw/workspace.yaml', `aweb_url: ${s.url}\nmemberships:\n${membership}`);
  const r = await f.run(['heartbeat', '--json'], s.url, {AWEB_HTTP_TIMEOUT: '100ms'});
  assert.notEqual(r.status, 0);
  assert.ok(s.requests.some(q => q.method === 'POST'), r.stderr);
  assert.match(r.stderr, /Request timed out before a response was received; it may have applied\./);
});

// #285: setup names an unavailable username, from aw's one sentence for it with no
// terminal, both when the availability check refuses and when signup conflicts.
test('real aw prose: an unavailable username is one fixed sentence with its reason', options, async t => {
  for (const [check, signup, reason] of [[{available: false, reason: 'reserved'}, null, 'reserved'], [{available: true}, 409, 'taken']]) {
    const f = fixture(t);
    const s = await service(t, (req, res) => {
      if (req.method === 'GET' && req.url === '/api/v1/discovery') res.end(JSON.stringify({onboarding_url: s.url, aweb_url: `${s.url}/api`, registry_url: s.url}));
      else if (req.method === 'POST' && req.url === '/api/v1/onboarding/check-username') res.end(JSON.stringify(check));
      else if (req.method === 'POST' && req.url === '/api/v1/onboarding/cli-signup' && signup) {res.statusCode = signup; res.end(JSON.stringify({detail: 'NATIVE-BODY-SENTINEL'}));}
      else {res.statusCode = 503; res.end('{}');}
    });
    const r = await f.run(['init', '--new-account', '--username', 'fixture-user', '--name', 'fixture-root', '--do-not-touch-agents-md'], s.url, {AWEB_URL: s.url});
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /^username "fixture-user" is not available \(([a-z_]+)\)$/m);
    assert.equal(usernameUnavailable(r.stderr.split('fixture-user').join('<redacted>')), reason);
    const paths = s.requests.map(q => q.path);
    assert.ok(paths.includes('/api/v1/onboarding/check-username'), paths.join(' '));
    assert.equal(paths.includes('/api/v1/onboarding/cli-signup'), !!signup, paths.join(' '));
    assert.equal(existsSync(join(f.cwd, '.aw')), false, 'aw creates nothing before it refuses the username');
  }
});
