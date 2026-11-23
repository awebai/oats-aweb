// Real aw, private HOME and a loopback-only onboarding service: username setup after a
// signup whose outcome is unknown (a 5xx), then a plan, then the same setup against a
// service that answers. From aw 1.36.59 (fc8c2b797) aw keeps the attempted signup in the
// root's .aw and the same `aw init` resumes it with the same signer; earlier aw keeps
// nothing and the re-run is a fresh signup. Both end with the account set up.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fakeKernelTeamConfig } from './helpers/fake-kernel-team-config.mjs';
import { verifyPinnedAw } from './helpers/pinned-aw.mjs';
import { versionAtLeast } from '../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs';

const hook = fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs', import.meta.url));
const TEAM = 'default:fixture-user.aweb.ai';
// aw 1.36.59-rc.4 keeps the journal's lock beside it in .aw; later aw keeps the lock in its own state.
const withoutLock = dir => readdirSync(dir).filter(name => name !== 'signup-recovery.lock').sort();

function run(command, args, options) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code, signal) => done({ code, signal, stdout, stderr }));
  });
}
const base58 = bytes => {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + bytes.toString('hex')), out = '';
  while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  return out;
};
const didKey = publicKey => 'did:key:z' + base58(Buffer.concat([Buffer.from([0xed, 1]), publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)]));
/** Every entry of a directory tree with its mode, size and modification time. Contents are
 *  never read: aw's journal holds its signer. */
function listing(dir) {
  if (!existsSync(dir)) return null;
  const out = {};
  const walk = rel => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const path = join(rel, name), stat = statSync(join(dir, path));
      out[path] = `${stat.isDirectory() ? 'dir' : 'file'} ${(stat.mode & 0o777).toString(8)} ${stat.size} ${stat.mtimeMs}`;
      if (stat.isDirectory()) walk(path);
    }
  };
  walk('');
  return out;
}

/** A pinned real aw, a private HOME, a loopback onboarding service whose signup and connect
 *  answer 503 until they are told to answer, and a deployment root for username setup. */
async function harness(t) {
  if (!process.env.OATS_TEST_AW) {
    assert.notEqual(process.env.OATS_USERNAME_NATIVE_REQUIRED, '1', 'set OATS_TEST_AW to the pinned executable');
    t.skip('requires explicit pinned real aw at the supported floor or later executable'); return null;
  }
  const binary = realpathSync(resolve(process.env.OATS_TEST_AW));
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'oats-signup-resume-')));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const home = join(scratch, 'home'), bin = join(scratch, 'bin');
  mkdirSync(home); mkdirSync(bin); symlinkSync(binary, join(bin, 'aw'));
  const env = { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), TMPDIR: scratch, AW_NO_UPDATE_CHECK: '1' };
  const version = spawnSync(binary, ['version'], { env, cwd: scratch, encoding: 'utf8' });
  t.diagnostic(JSON.stringify(verifyPinnedAw(binary, version)));
  // From aw 1.36.59 (fc8c2b797) aw keeps an unfinished signup's journal for the same command to resume.
  const keepsJournal = versionAtLeast(/^aw (\S+)$/m.exec(version.stdout)[1], '1.36.59-rc.4');

  // Signup answers with a LOCAL membership signed by a fixture team key for exactly the
  // signer and name aw sent; connect answers with that membership's workspace.
  const team = generateKeyPairSync('ed25519'), teamDid = didKey(team.publicKey);
  const calls = [], answers = { signup: false, connect: false };
  let endpoint;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    calls.push({ method: req.method, path: req.url, body });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/api/v1/discovery') return res.end(JSON.stringify({ onboarding_url: endpoint, aweb_url: `${endpoint}/api`, registry_url: endpoint }));
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/api/health')) return res.end('{"status":"ok"}');
    if (req.method === 'POST' && req.url === '/api/v1/onboarding/check-username') return res.end(JSON.stringify({ available: true }));
    if (req.method === 'POST' && req.url === '/api/v1/onboarding/cli-signup') {
      if (!answers.signup) { res.statusCode = 503; return res.end('{}'); }
      const signup = JSON.parse(body);
      const cert = { version: 1, certificate_id: randomUUID(), team_id: TEAM, team_did_key: teamDid, member_did_key: signup.did_key, alias: signup.alias, identity_scope: 'local', issued_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
      cert.signature = sign(null, Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(cert).sort().map(k => [k, cert[k]])))), team.privateKey).toString('base64').replace(/=+$/, '');
      return res.end(JSON.stringify({ user_id: randomUUID(), username: signup.username, org_id: randomUUID(), namespace_domain: 'fixture-user.aweb.ai', team_id: TEAM, api_key: 'fixture-api-key', certificate: Buffer.from(JSON.stringify(cert)).toString('base64'), did_aw: '', member_address: '', alias: signup.alias }));
    }
    if (req.method === 'POST' && req.url === '/api/v1/connect') {
      if (!answers.connect) { res.statusCode = 503; return res.end('{}'); }
      return res.end(JSON.stringify({ agent_type: 'agent', team_id: TEAM, alias: 'fixture-root', agent_id: randomUUID(), workspace_id: randomUUID(), repo_id: '', team_did_key: teamDid }));
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  endpoint = `http://127.0.0.1:${server.address().port}`;
  env.AWEB_URL = endpoint; env.AWID_REGISTRY_URL = endpoint;

  const root = join(scratch, 'provider');
  mkdirSync(root); writeFileSync(join(root, 'oats-local.yaml'), 'schemaVersion: 2\nworkspace: fixture\n');
  const kernel = fakeKernelTeamConfig(join(scratch, 'kernel'), root);
  const setupEnv = { ...env, OATS_EVENT: 'setup', OATS_WORKSPACE: root, OATS_CLI_BIN: kernel.cli, OATS_SETTINGS: JSON.stringify({ root, registry: endpoint }) };
  const setup = async (...extra) => {
    const r = await run(process.execPath, [hook, 'setup', '--username', 'fixture-user', '--name', 'fixture-root', ...extra, '--json'], { cwd: root, env: setupEnv });
    assert.equal(r.signal, null);
    assert.doesNotMatch(r.stdout + r.stderr, /fixture-api-key/);
    return { ...r, doc: JSON.parse(r.stdout) };
  };
  const count = path => calls.filter(c => c.path === path).length;
  return { keepsJournal, answers, calls, count, setup, awDir: join(root, '.aw') };
}
const SIGNUP = '/api/v1/onboarding/cli-signup', CHECK = '/api/v1/onboarding/check-username';

/** C3, C5: the plan names the resume and runs nothing: no request, no change in .aw. */
async function planRunsNothing(h, bootstrap) {
  const before = listing(h.awDir), callsBefore = h.calls.length;
  const plan = await h.setup('--plan');
  assert.equal(plan.code, 0, plan.stdout + plan.stderr);
  assert.equal(plan.doc.result.bootstrap, bootstrap);
  assert.equal(plan.doc.result.team, null);
  assert.equal(h.calls.length, callsBefore);
  assert.deepEqual(listing(h.awDir), before);
}

/** C2: the same setup completes with the LOCAL membership aw installed. */
function completed(done) {
  assert.equal(done.code, 0, done.stdout + done.stderr);
  assert.equal(done.doc.result.team, TEAM);
  assert.equal(done.doc.result.membershipVerified, true);
  assert.deepEqual(done.doc.result.steps.find(s => s.step === 'bootstrap'), { step: 'bootstrap', status: 'command-completed' });
}

test('username setup resumes the signup aw kept after a 5xx signup, and its plan says resume', async t => {
  const h = await harness(t); if (!h) return;
  // An unknown outcome: no username classification, and from 1.36.59 the journal is kept.
  const unknown = await h.setup();
  assert.equal(unknown.code, 1, unknown.stderr);
  assert.equal(unknown.doc.error.code, 'E_SETUP_NATIVE');
  assert.equal(h.count(SIGNUP), 1);
  if (h.keepsJournal) {
    assert.deepEqual(withoutLock(h.awDir), ['signup-recovery.json']);
    assert.match(unknown.doc.error.message, /re-run the same setup command, with the same flags and AWEB_URL, and aw resumes it/);
  } else {
    assert.equal(existsSync(h.awDir), false);
    assert.doesNotMatch(unknown.doc.error.message, /re-run/);
  }
  await planRunsNothing(h, h.keepsJournal ? 'resume' : 'required');

  // Once the service answers, the same setup completes. From 1.36.59 it is aw's resume:
  // the same request byte for byte (so the same signer), with no new availability check;
  // earlier aw signs up afresh.
  h.answers.signup = h.answers.connect = true;
  const checks = h.count(CHECK);
  completed(await h.setup());
  const [first, second] = h.calls.filter(c => c.path === SIGNUP);
  assert.equal(h.count(SIGNUP), 2);
  if (h.keepsJournal) {
    assert.equal(second.body, first.body, 'the resume sends the request aw recorded');
    assert.equal(h.count(CHECK), checks);
  } else {
    assert.notEqual(JSON.parse(second.body).did_key, JSON.parse(first.body).did_key, 'earlier aw signs up with a new signer');
    assert.equal(h.count(CHECK), checks + 1);
  }
  // aw removes its journal once the signer, membership and credential are installed.
  assert.equal(existsSync(join(h.awDir, 'signup-recovery.json')), false);
  assert.ok(existsSync(join(h.awDir, 'signing.key')));
});

test('a 5xx at connect after the signup: setup resumes what aw installed without a second signup', async t => {
  const h = await harness(t); if (!h) return;
  h.answers.signup = true;
  const unknown = await h.setup();
  assert.equal(unknown.code, 1, unknown.stderr);
  assert.equal(unknown.doc.error.code, 'E_SETUP_NATIVE');
  assert.equal(h.count(SIGNUP), 1);
  // aw installed its signer and certificate before connect failed.
  const installed = readdirSync(h.awDir).sort();
  assert.ok(installed.includes('signing.key') && installed.includes('team-certs'), installed.join(' '));
  h.answers.connect = true;
  if (h.keepsJournal) {
    assert.ok(installed.includes('signup-recovery.json'), installed.join(' '));
    assert.match(unknown.doc.error.message, /re-run the same setup command, with the same flags and AWEB_URL, and aw resumes it/);
    await planRunsNothing(h, 'resume');
    completed(await h.setup());
    assert.equal(existsSync(join(h.awDir, 'signup-recovery.json')), false);
  } else {
    // Earlier aw keeps no journal: today's path, a membership read that finds none.
    assert.doesNotMatch(unknown.doc.error.message, /re-run/);
    for (const extra of [['--plan'], []]) {
      const again = await h.setup(...extra);
      assert.equal(again.code, 1);
      assert.equal(again.doc.error.code, 'E_SETUP_MEMBERSHIP');
    }
    assert.deepEqual(readdirSync(h.awDir).sort(), installed);
  }
  // Never a second signup: the resume reuses the confirmed one, earlier aw does not retry.
  assert.equal(h.count(SIGNUP), 1);
});
