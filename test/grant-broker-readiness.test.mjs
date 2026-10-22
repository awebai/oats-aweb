import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fakeAw} from './helpers/fake-aw-grant.mjs';
import {assertKernelCheckAnswerRule} from './helpers/kernel-check-answer-rule.mjs';

const BINDING = new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb-binding.mjs', import.meta.url).pathname;
const capture = () => JSON.parse(readFileSync(new URL('./fixtures/wake-status/daemon-1.36.37-grant-quarantined.json', import.meta.url), 'utf8'));
const TEAM = 'jro:jro.aweb.ai';

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'oats-grant-broker-')));
  t.after(() => rmSync(base, {recursive: true, force: true}));
  const bin = fakeAw(base), home = join(base, 'seat'), custody = join(base, 'custody');
  const current = join(home, '.aweb-identity-current');
  const previous = join(home, '.aweb-identity-1792217848');
  for (const dir of [current, previous, join(custody, '.aw')]) mkdirSync(dir, {recursive: true});
  writeFileSync(join(custody, '.aw', 'identity.yaml'), 'alias: resident-alias\n');
  const record = {launch: {harness: 'claude', hooks: {env: {AWEB_IDENTITY_HOME: current}}}, capabilityMeta: {'oats.aweb': {
    delivery: 'session', runtime: 'claude', identity: {mode: 'global', alias: 'resident-alias', team: TEAM, resident: 'merlin',
      grant: {id: 'grant-current', home: current, expiresAt: 'never', ttl: 'never', renew: 'launch', scopes: ['mail.read']}},
  }}};
  writeFileSync(join(home, 'instance.json'), JSON.stringify(record));
  const settings = {delivery: 'session', identity: {mode: 'global', resident: 'merlin'}, residents: {merlin: custody}};
  const input = {schemaVersion: 1, phase: 'check', slot: 'messaging', capability: 'oats.aweb', settings,
    input: {action: {kind: 'readiness'}, context: {kind: 'workspace', workspace: base, deployment: base, soul: 'dev', home}}};
  const status = JSON.parse(JSON.stringify(capture()).replaceAll('/fixture/home', home));
  // The reduced capture has neither daemon flag. Supply them synthetically;
  // they are prerequisites for assessing the captured row, not captured facts.
  status.daemon_running = true;
  status.daemon_version_state = 'reported';
  const row = status.instances[0];
  const match = () => {
    row.identity_home = current;
    row.receive_identities[0].identity_home = current;
    row.receive_identities[0].stream_phase = 'streaming';
    delete row.receive_identities[0].stream_error;
  };
  const run = () => {
    const before = readFileSync(join(home, 'instance.json'), 'utf8');
    const result = spawnSync(process.execPath, [BINDING, 'check'], {cwd: base, input: JSON.stringify(input), encoding: 'utf8', timeout: 20000,
      env: {HOME: base, PATH: `${bin}:${process.env.PATH}`, FAKE_WAKE_STATUS: JSON.stringify(status), FAKE_CUSTODY_TEAM: TEAM,
        OATS_DEFAULT_TEAM: 'default', OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: 'deployment',
        OATS_TEAMS: JSON.stringify([{label: 'default', team: TEAM, default: true, from: 'local'}])}});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(readFileSync(join(home, 'instance.json'), 'utf8'), before, 'readiness leaves the captured grant unchanged');
    const calls = readFileSync(join(base, 'aw.log'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(calls.every(c => ['version', 'custody status --json', 'wake status --json'].includes(c.argv.join(' '))),
      'only read-only prerequisite/status calls, never broker registration or grant mutation');
    return assertKernelCheckAnswerRule(result.stdout, input, 'grant broker readiness').result;
  };
  return {status, row, current, previous, match, run, record: () => writeFileSync(join(home, 'instance.json'), JSON.stringify(record)), captured: record};
}

test('the reduced quarantined capture preserves its wire error and does not invent daemon flags', () => {
  const status = capture();
  assert.equal(status.daemon_version, '1.36.37');
  assert.equal(status.instances.length, 1);
  assert.equal(status.instances[0].receive_identities[0].stream_phase, 'quarantined');
  assert.equal(status.instances[0].receive_identities[0].stream_error, 'aweb: http 403 (x-request-id: redacted, cf-ray: redacted): {"detail":"grant revoked"}');
  assert.equal(status.daemon_running, undefined);
  assert.equal(status.daemon_version_state, undefined);
  assert.doesNotMatch(JSON.stringify(status), /owner_id|\/Users\//);
});

test('a broker bound to the previous grant is unavailable and names both homes and restart remedy', t => {
  const fx = fixture(t);
  fx.row.receive_identities[0].stream_phase = 'streaming';
  delete fx.row.receive_identities[0].stream_error;
  const result = fx.run();
  assert.equal(result.status, 'unavailable');
  const issue = result.problems.find(p => p.code === 'wake-target-binding');
  assert.ok(issue, JSON.stringify(result));
  assert.ok(issue.message.includes('.aweb-identity-current'), issue.message);
  assert.ok(issue.message.includes('.aweb-identity-1792217848'), issue.message);
  assert.match(issue.message, /broker.*bound.*grant home other than.*current/);
  assert.match(issue.message, /restart.*seat.*re-register.*current grant home/);
});

test('a foreign primary receive identity fails even if the row locator matches', t => {
  const fx = fixture(t); fx.match();
  fx.row.receive_identities[0].identity_home = fx.previous;
  const result = fx.run();
  assert.equal(result.status, 'unavailable');
  const issue = result.problems.find(p => p.code === 'wake-target-binding');
  assert.ok(issue, JSON.stringify(result));
  assert.ok(issue.message.includes('.aweb-identity-current'), issue.message);
  assert.ok(issue.message.includes('.aweb-identity-1792217848'), issue.message);
});

test('a matching quarantined stream reports HTTP status and detail, excluding other response content', t => {
  const fx = fixture(t);
  fx.row.identity_home = fx.current;
  fx.row.receive_identities[0].identity_home = fx.current;
  const result = fx.run();
  assert.equal(result.status, 'unavailable');
  const issue = result.problems.find(p => p.code === 'wake-stream-unavailable');
  assert.ok(issue, JSON.stringify(result));
  assert.match(issue.message, /quarantined/);
  assert.match(issue.message, /403.*grant revoked/);
  assert.match(issue.message, /restart.*seat.*re-register.*current grant home/);
  fx.row.receive_identities[0].stream_error = 'aweb: http 403 (x-request-id: request-secret, cf-ray: ray-secret): {"detail":"grant revoked","token":"token-secret","request_body":"body-secret"}';
  const diagnostic = JSON.stringify(fx.run());
  assert.match(diagnostic, /403.*grant revoked/);
  assert.doesNotMatch(diagnostic, /request-secret|ray-secret|token-secret|body-secret|request_body/);
  fx.row.receive_identities[0].stream_error = 'aweb: http 403: {"detail":"Bearer token-secret","request_body":"body-secret"}';
  const unknown = JSON.stringify(fx.run());
  assert.match(unknown, /HTTP 403/);
  assert.doesNotMatch(unknown, /Bearer|token-secret|body-secret/);
});

test('a matching streaming grant is ready', t => {
  const fx = fixture(t); fx.match();
  const result = fx.run();
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.deepEqual(result.problems, []);
});

// aw v1.36.37 wake/stream.go: StreamStarting="starting", StreamRetrying="retrying".
for (const phase of ['starting', 'retrying']) test(`a matching ${phase} grant stream warns without failing readiness`, t => {
  const fx = fixture(t); fx.match();
  fx.row.receive_identities[0].stream_phase = phase;
  const result = fx.run();
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.deepEqual(result.problems, []);
  assert.ok(result.warnings.some(w => w.code === 'wake-stream-unavailable' && w.message.includes(phase)), JSON.stringify(result));
  fx.row.channel_core.running = false;
  assert.equal(fx.run().status, 'unavailable', 'transient stream does not skip worker failures');
});

test('a legacy grant seat without a runtime keeps the same transient and error rules', t => {
  const fx = fixture(t); fx.match();
  delete fx.captured.launch.harness;
  delete fx.captured.capabilityMeta['oats.aweb'].runtime;
  fx.record();
  fx.row.receive_identities[0].stream_phase = 'retrying';
  fx.row.receive_identities[0].stream_error = 'aweb: http 503: {"detail":"service unavailable"}';
  const result = fx.run();
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.equal(result.warnings.filter(w => w.code === 'wake-stream-unavailable').length, 1);
  assert.ok(result.warnings.some(w => w.code === 'receive-ownership-unproven'));
  fx.row.receive_identities[0].stream_phase = 'quarantined';
  fx.row.receive_identities[0].stream_error = 'aweb: http 403: {"detail":"grant revoked"}';
  const failed = fx.run();
  assert.equal(failed.status, 'unavailable');
  assert.ok(failed.problems.some(p => /403.*grant revoked/.test(p.message)), JSON.stringify(failed));
});

test('transient phase never excuses missing admission or malformed stream errors', t => {
  const fx = fixture(t); fx.match();
  fx.row.receive_identities[0].stream_phase = 'starting';
  fx.row.receive_identities[0].stream_admitted = false;
  assert.equal(fx.run().status, 'unavailable');
  fx.row.receive_identities[0].stream_admitted = true;
  fx.row.receive_identities[0].stream_error = {detail: 'grant revoked'};
  assert.ok(fx.run().problems.some(p => p.code === 'wake-status-unavailable'));
});

// aw v1.36.37 wake/stream.go:269-279,326 quarantines permanent refusals,
// but every retrying observation carries its recoverable error.
for (const [error, detail] of [
  ['aweb: http 503: {"detail":"service unavailable"}', /HTTP 503.*service unavailable/],
  ['dial tcp: network is unreachable', /dial tcp: network is unreachable/],
]) test(`a retrying stream warns with its recoverable error: ${error}`, t => {
  const fx = fixture(t); fx.match();
  fx.row.receive_identities[0].stream_phase = 'retrying';
  fx.row.receive_identities[0].stream_error = error;
  const result = fx.run();
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.deepEqual(result.problems, []);
  const warning = result.warnings.find(w => w.code === 'wake-stream-unavailable');
  assert.ok(warning, JSON.stringify(result));
  assert.match(warning.message, detail);
});

test('streaming phase decides readiness even with retained error text', t => {
  const fx = fixture(t); fx.match();
  fx.row.receive_identities[0].stream_error = 'dial tcp: network is unreachable';
  const result = fx.run();
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.deepEqual(result.problems, []);
});

test('recoverable warnings exclude headers, URLs, credentials and arbitrary bodies', t => {
  const fx = fixture(t); fx.match();
  fx.row.receive_identities[0].stream_phase = 'retrying';
  for (const error of [
    'aweb: http 503 (x-request-id: request-secret, cf-ray: ray-secret): {"detail":"service unavailable","token":"token-secret","request_body":"body-secret"}',
    'Get "https://user:password-secret@example.test/events?token=token-secret": dial tcp 192.0.2.1:443: network is unreachable {"request_body":"body-secret"}',
  ]) {
    fx.row.receive_identities[0].stream_error = error;
    const result = fx.run();
    assert.equal(result.status, 'ready', JSON.stringify(result));
    const diagnostic = JSON.stringify(result.warnings);
    assert.match(diagnostic, /service unavailable|network is unreachable/);
    assert.doesNotMatch(diagnostic, /request-secret|ray-secret|token-secret|password-secret|body-secret|request_body|example\.test|192\.0\.2/);
  }
});

for (const phase of ['quarantined', 'stopped']) test(`a ${phase} stream with an explicit error is unavailable`, t => {
  const fx = fixture(t); fx.match();
  fx.row.receive_identities[0].stream_phase = phase;
  fx.row.receive_identities[0].stream_error = 'aweb: http 403: {"detail":"grant revoked"}';
  const result = fx.run();
  assert.equal(result.status, 'unavailable');
  assert.ok(result.problems.some(p => p.code === 'wake-stream-unavailable' && /403.*grant revoked/.test(p.message)), JSON.stringify(result));
});

test('an unknown phase fails closed and names the raw phase', t => {
  const fx = fixture(t); fx.match();
  fx.row.receive_identities[0].stream_phase = 'new-aw-phase';
  const result = fx.run();
  assert.equal(result.status, 'unavailable');
  const issue = result.problems.find(p => p.code === 'wake-stream-unavailable');
  assert.ok(issue, JSON.stringify(result));
  assert.match(issue.message, /new-aw-phase/);
});

for (const phase of ['quarantined', 'stopped', 'connected', undefined]) test(`a ${phase ?? 'missing'} grant stream phase without an error remains unavailable`, t => {
  const fx = fixture(t); fx.match();
  fx.row.receive_identities[0].stream_phase = phase;
  const result = fx.run();
  assert.equal(result.status, 'unavailable');
  assert.ok(result.problems.some(p => p.code === 'wake-stream-unavailable'), JSON.stringify(result));
});
