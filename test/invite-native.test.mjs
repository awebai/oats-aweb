import { verifyPinnedAw } from './helpers/pinned-aw.mjs';
// Opt-in pinned binary, loopback only. Synthetic certificates and responses do
// not establish live server authority or create a usable invitation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
const hook = fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs', import.meta.url));
function b58(buf) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + buf.toString('hex')), out = '';
  while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  return out;
}
function key() {
  const pair = generateKeyPairSync('ed25519');
  const publicBytes = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { ...pair, did: 'did:key:z' + b58(Buffer.concat([Buffer.from([0xed, 1]), publicBytes])) };
}
function run(args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hook, 'invite', ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c);
    child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}
function snapshot(dir) {
  return Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => {
    const path = join(e.parentPath, e.name);
    return [path, createHash('sha256').update(readFileSync(path)).digest('hex')];
  }));
}
test('pinned real member invite: selected-root wire, token once, safe status adapter and read-only plan', async t => {
  if (!process.env.OATS_TEST_AW_1_36_23) {
    assert.notEqual(process.env.OATS_INVITE_NATIVE_REQUIRED, '1', 'set OATS_TEST_AW_1_36_23');
    t.skip('requires explicit pinned real aw 1.36.23 executable'); return;
  }
  const binary = realpathSync(process.env.OATS_TEST_AW_1_36_23);
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'invite-native-')));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const root = join(scratch, 'root'), dep = join(scratch, 'deployment'), home = join(scratch, 'foreign'), bin = join(scratch, 'bin');
  for (const path of [join(root, '.aw', 'team-certs'), dep, home, bin]) mkdirSync(path, { recursive: true });
  symlinkSync(binary, join(bin, 'aw'));
  const isolated = { HOME: home, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, XDG_CONFIG_HOME: join(home, '.config'), AW_NO_UPDATE_CHECK: '1' };
  const version = spawnSync(binary, ['version'], { env: isolated, cwd: scratch, encoding: 'utf8' });
  t.diagnostic(JSON.stringify(verifyPinnedAw(binary, version)));
  const member = key(), signer = key(), team = 'fixture:example.invalid', alias = 'fixture-root';
  const cert = { version: 1, certificate_id: randomUUID(), team_id: team, team_did_key: signer.did, member_did_key: member.did, alias, identity_scope: 'local', issued_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
  cert.signature = sign(null, Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(cert).sort().map(k => [k, cert[k]])))), signer.privateKey).toString('base64').replace(/=+$/, '');
  writeFileSync(join(root, '.aw', 'team-certs', 'fixture__example.invalid.pem'), JSON.stringify(cert), { mode: 0o600 });
  const pem = '-----BEGIN ED25519 PRIVATE KEY-----\n' + member.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64') + '\n-----END ED25519 PRIVATE KEY-----\n';
  writeFileSync(join(root, '.aw', 'signing.key'), pem, { mode: 0o600 });
  writeFileSync(join(root, '.aw', 'identity.yaml'), `did: ${member.did}\ncustody: self\nidentity_scope: local\n`);
  // If inherited HOME were used, this controller key could select local issuance.
  mkdirSync(join(home, '.awid', 'team-keys', 'example.invalid'), { recursive: true });
  writeFileSync(join(home, '.awid', 'team-keys', 'example.invalid', 'fixture.key'), pem, { mode: 0o600 });
  let mode = 'success'; const calls = [], token = 'aw_inv_SYNTHETIC_NO_VALID_AUTHORITY';
  const posts = () => calls.filter(c => c.method === 'POST');
  const server = createServer(async (req, res) => {
    let data = ''; for await (const c of req) data += c;
    calls.push({ method: req.method, path: req.url, body: data ? JSON.parse(data) : null, authorization: !!req.headers.authorization, certificate: !!req.headers['x-awid-team-certificate'] });
    if (req.method === 'GET' && req.url === '/api/v1/discovery') return res.end('{}');
    if (mode === 'transport') { req.socket.destroy(); return; }
    res.setHeader('content-type', 'application/json');
    if (mode === 'success') return res.end(JSON.stringify({ invite_id: 'synthetic', token }));
    if (mode === 'malformed') return res.end('{malformed SYNTHETIC_SECRET');
    if (mode === 'missing') return res.end(JSON.stringify({ invite_id: 'synthetic' }));
    const [status, detail] = mode;
    res.statusCode = status; res.end(JSON.stringify({ detail }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const membership = `  - team_id: ${team}\n    alias: ${alias}\n    cert_path: team-certs/fixture__example.invalid.pem\n`;
  writeFileSync(join(root, '.aw', 'teams.yaml'), `active_team: ${team}\nmemberships:\n${membership}    aweb_url: ${url}\n`);
  writeFileSync(join(root, '.aw', 'workspace.yaml'), `aweb_url: ${url}\nmemberships:\n${membership}`);
  writeFileSync(join(dep, 'oats-local.yaml'), 'schemaVersion: 2\nworkspace: local\n');
  const kernel = join(bin, 'kernel.mjs');
  writeFileSync(kernel, `console.log(JSON.stringify(${JSON.stringify({ schemaVersion: 1, ok: true, result: { teamsApi: 2, deployment: dep, teams: [{ label: 'default', team }], problems: [] } })}));`);
  const env = { ...isolated, OATS_CLI_BIN: kernel, OATS_EVENT: 'invite', OATS_TEAM_SCOPE: dep, OATS_WORKSPACE: dep, OATS_DEFAULT_TEAM: 'default', OATS_DEFAULT_TEAM_ID: team, OATS_SETTINGS: JSON.stringify({ root }), AWEB_IDENTITY_HOME: home, AWEB_URL: 'http://127.0.0.1:1', AWEB_API_KEY: 'SYNTHETIC_SECRET', AWEB_TEAM_ID: 'foreign:invalid', AWID_REGISTRY_URL: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1' };
  const beforeRoot = snapshot(root), beforeHome = snapshot(home);
  const plan = await run(['--plan', '--json'], dep, env);
  assert.equal(plan.code, 0, plan.stdout + plan.stderr); assert.equal(JSON.parse(plan.stdout).result.token, undefined);
  assert.equal(calls.length, 0); assert.deepEqual(snapshot(root), beforeRoot); assert.deepEqual(snapshot(home), beforeHome);
  const success = await run(['--json'], dep, env);
  assert.equal(success.code, 0, success.stdout + success.stderr); assert.equal(success.stderr, '');
  assert.equal(JSON.parse(success.stdout).result.token, token); assert.equal(success.stdout.split(token).length - 1, 1);
  assert.equal(posts().length, 1); assert.equal(posts()[0].path, '/api/v1/spawn/create-invite');
  assert.deepEqual(posts()[0].body, { access_mode: 'open', max_uses: 1 });
  assert.ok(posts()[0].authorization); assert.ok(posts()[0].certificate);
  for (const [response, code] of [
    [[401, 'Identity-scoped team key required'], 'E_INVITE_DENIED'],
    [[403, 'Spawn requires an initialized identity, not an unbound team key'], 'E_INVITE_DENIED'],
    [[403, 'Spawn requires a concrete team identity'], 'E_INVITE_DENIED'],
    [[403, { token: 'SYNTHETIC_SECRET', message: 'owner_admin_required' }], 'E_INVITE_DENIED'],
    [[409, 'Current team does not have a registered namespace for spawn invites'], 'E_INVITE_NATIVE'],
    [[500, 'create hosted team invite: aweb: http 403: SYNTHETIC_SECRET'], 'E_INVITE_NATIVE'],
    ['transport', 'E_INVITE_NATIVE'], ['malformed', 'E_INVITE_NATIVE'], ['missing', 'E_INVITE_NATIVE'],
  ]) {
    mode = response; const count = posts().length;
    const result = await run(['--json'], dep, env);
    assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).error.code, code, result.stdout);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_SECRET|aw_inv_|owner_admin|required namespace/);
    assert.equal(posts().length - count, 1, 'never retry issuance');
  }
  assert.deepEqual(snapshot(root), beforeRoot); assert.deepEqual(snapshot(home), beforeHome);
  // Remove routing to model unsupported non-hosted/controller-only issuance.
  // A valid foreign controller key still must not be borrowed or modified.
  writeFileSync(join(root, '.aw', 'teams.yaml'), `active_team: ${team}\nmemberships:\n${membership}`);
  writeFileSync(join(root, '.aw', 'workspace.yaml'), `memberships:\n${membership}`);
  const unrouted = snapshot(root), priorCalls = calls.length;
  const unsupported = await run(['--json'], dep, env);
  assert.equal(unsupported.code, 1);
  assert.equal(JSON.parse(unsupported.stdout).error.code, 'E_INVITE_NATIVE');
  assert.doesNotMatch(unsupported.stdout + unsupported.stderr, /aw_inv_|SYNTHETIC_SECRET/);
  assert.equal(calls.length, priorCalls); assert.deepEqual(snapshot(home), beforeHome); assert.deepEqual(snapshot(root), unrouted);
  t.diagnostic('Synthetic loopback only: pinned argv/wire, native HTTP-prefix adapter, token-once and no-write plan verified; no live issuance or permission equivalence proved.');
});
