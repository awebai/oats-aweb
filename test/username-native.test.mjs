// Opt-in real aw 1.36.23 contract check. No hosted account is created: every
// endpoint is loopback and signup is deliberately refused before credentials
// or certificates are issued. This proves argv/wire acceptance, not live setup.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fakeKernelTeamConfig } from './helpers/fake-kernel-team-config.mjs';

const hook = fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs', import.meta.url));
function run(command, args, options) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code, signal) => done({ code, signal, stdout, stderr }));
  });
}
test('pinned real aw username contract accepts explicit root name and preserves no-root on refused signup', async t => {
  if (!process.env.OATS_TEST_AW_1_36_23) {
    assert.notEqual(process.env.OATS_USERNAME_NATIVE_REQUIRED, '1', 'set OATS_TEST_AW_1_36_23 to the pinned executable');
    t.skip('requires explicit pinned real aw 1.36.23 executable'); return;
  }
  const binary = realpathSync(resolve(process.env.OATS_TEST_AW_1_36_23));
  const scratch = mkdtempSync(join(tmpdir(), 'oats-username-native-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const home = join(scratch, 'home'), bin = join(scratch, 'bin');
  mkdirSync(home); mkdirSync(bin); symlinkSync(binary, join(bin, 'aw'));
  const env = { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), TMPDIR: scratch };
  const version = spawnSync(binary, ['version'], { env, cwd: scratch, encoding: 'utf8' });
  assert.equal(version.status, 0);
  assert.match(version.stdout, /^aw 1\.36\.23\n/);
  assert.match(version.stdout, /commit: 61c38162596d1af9085741d70d15900ff9894257/);
  t.diagnostic(JSON.stringify({ binary, sha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), version: version.stdout.trim() }));
  const help = spawnSync(binary, ['init', '--help'], { env, cwd: scratch, encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /--name string/); assert.match(help.stdout, /--new-account/);
  const calls = [];
  let endpoint;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    calls.push({ method: req.method, path: req.url, body });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/api/v1/discovery') {
      res.end(JSON.stringify({ onboarding_url: endpoint, aweb_url: `${endpoint}/api`, registry_url: endpoint }));
    } else if (req.method === 'POST' && req.url === '/api/v1/onboarding/check-username') {
      res.end(JSON.stringify({ available: true }));
    } else {
      res.statusCode = 503;
      res.end(JSON.stringify({ detail: 'CONTROLLED-SIGNUP-REFUSAL-SYNTHETIC-SECRET' }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  endpoint = `http://127.0.0.1:${server.address().port}`;
  env.AWEB_URL = endpoint; env.AWID_REGISTRY_URL = endpoint;
  const nativeRoot = join(scratch, 'native'); mkdirSync(nativeRoot);
  const missing = await run(binary, ['init', '--new-account', '--username', 'fixture-user'], { env, cwd: nativeRoot });
  assert.equal(missing.code, 2); assert.match(missing.stderr, /missing required flag: --name/);
  assert.equal(calls.length, 0); assert.equal(existsSync(join(nativeRoot, '.aw')), false);
  const root = join(scratch, 'provider'); mkdirSync(root);
  writeFileSync(join(root, 'oats-local.yaml'), 'schemaVersion: 2\nworkspace: fixture\n');
  const kernel = fakeKernelTeamConfig(join(scratch, 'kernel'), root);
  const result = await run(process.execPath, [hook, 'setup', '--username', 'fixture-user', '--name', 'fixture-root'], {
    cwd: root, env: { ...env, OATS_EVENT: 'setup', OATS_WORKSPACE: root, OATS_CLI_BIN: kernel.cli, OATS_SETTINGS: JSON.stringify({ root }) },
  });
  assert.equal(result.code, 1, result.stderr); assert.equal(result.signal, null);
  assert.match(result.stderr, /output withheld/);
  assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC-SECRET|missing required flag/);
  assert.deepEqual(calls.map(c => [c.method, c.path]), [
    ['GET', '/api/v1/discovery'], ['POST', '/api/v1/onboarding/check-username'], ['POST', '/api/v1/onboarding/cli-signup'],
  ]);
  assert.equal(calls[1].body.username, 'fixture-user');
  assert.equal(calls[2].body.username, 'fixture-user');
  assert.equal(calls[2].body.alias, 'fixture-root');
  assert.equal(existsSync(join(root, '.aw')), false);
  t.diagnostic('Real pinned binary accepted provider argv and submitted explicit alias to controlled signup; refused signup created no root. Successful bootstrap/membership not exercised.');
});
