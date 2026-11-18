// Native service selection through the real retire hook, loopback only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {createServer} from 'node:http';
import {didKeyOfSigningKey} from '../oats-package/capabilities/oats-aweb/lib/member-key.mjs';

const binary = process.env.OATS_AWEB_TEST_AW;
const HOOK = resolve('oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs');
test('real aw: retire uses the home service despite every ambient selector', {skip: !binary && 'set OATS_AWEB_TEST_AW to the CI tested aw'}, async t => {
  const base = mkdtempSync(join(tmpdir(), 'aw-env-native-'));
  t.after(() => rmSync(base, {recursive: true, force: true}));
  const home = join(base, 'home'), bin = join(base, 'bin');
  const write = (p, text) => {mkdirSync(dirname(p), {recursive: true}); writeFileSync(p, text, {mode: 0o600});};
  mkdirSync(bin); symlinkSync(binary, join(bin, 'aw'));
  const kernel = join(base, 'kernel.mjs'); write(kernel, 'console.log(JSON.stringify({features: []}));');
  const server = async () => {
    const requests = [], s = createServer(async (req, res) => {
      for await (const _ of req) { /* consume only the disposable native request */ }
      requests.push({method: req.method, path: req.url});
      res.statusCode = 503; res.setHeader('content-type', 'application/json'); res.end('{"detail":"fixture-refusal"}');
    });
    await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => s.close(resolve)));
    return {url: `http://127.0.0.1:${s.address().port}`, requests};
  };
  const own = await server(), caller = await server();
  const pair = generateKeyPairSync('ed25519');
  const pem = `-----BEGIN ED25519 PRIVATE KEY-----\n${pair.privateKey.export({format: 'der', type: 'pkcs8'}).subarray(-32).toString('base64')}\n-----END ED25519 PRIVATE KEY-----\n`;
  const did = didKeyOfSigningKey(pem), team = 'eng:example.invalid', workspace = randomUUID(), certPath = 'team-certs/eng__example.invalid.pem';
  const cert = {version: 1, certificate_id: randomUUID(), team_id: team, team_did_key: did,
    member_did_key: did, alias: 'worker', identity_scope: 'local', issued_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z')};
  cert.signature = sign(null, Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(cert).sort().map(k => [k, cert[k]])))), pair.privateKey).toString('base64').replace(/=+$/, '');
  write(join(home, '.aw', 'signing.key'), pem);
  write(join(home, '.aw', 'identity.yaml'), `did: ${did}\ncustody: self\nidentity_scope: local\n`);
  write(join(home, '.aw', certPath), JSON.stringify(cert));
  const member = `    - team_id: ${team}\n      alias: worker\n      cert_path: ${certPath}\n      workspace_id: ${workspace}\n`;
  write(join(home, '.aw', 'teams.yaml'), `active_team: ${team}\nmemberships:\n${member}      aweb_url: ${own.url}\n`);
  write(join(home, '.aw', 'workspace.yaml'), `aweb_url: ${own.url}\nmemberships:\n${member}`);
  const env = {HOME: base, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, OATS_EVENT: 'retire',
    OATS_NODE_BIN: process.execPath, OATS_CLI_BIN: kernel, OATS_HOME: home, OATS_INSTANCE: 'worker', OATS_TEAM_SCOPE: base,
    OATS_DEFAULT_TEAM: 'default', OATS_DEFAULT_TEAM_ID: team, OATS_SETTINGS: '{}',
    OATS_META: JSON.stringify({alias: 'worker', team, runtime: 'pi', delivery: 'channel'}),
    AWEB_URL: caller.url, AWID_REGISTRY_URL: caller.url, AWEB_API_KEY: 'caller-key', AWEB_IDENTITY_HOME: '/caller/.aw', AWEB_ROLE_NAME: 'caller', AWEB_ROLE: 'caller'};
  const r = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK, 'retire'], {cwd: home, env, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c);
    child.on('error', reject); child.on('close', status => resolve({status, stdout, stderr}));
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).meta.reason, 'self-delete-failed');
  assert.ok(own.requests.some(q => q.method === 'DELETE' && q.path.endsWith(`/workspaces/${workspace}`)), r.stdout + r.stderr);
  assert.deepEqual(caller.requests, [], 'the caller service and registry are never contacted');
});
