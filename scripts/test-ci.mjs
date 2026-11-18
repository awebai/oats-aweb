// Explicit CI groups: every selected test must run. Missing prerequisites fail
// the group instead of silently losing native or kernel coverage.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { exclusionArgs } from './ci-exclusions.mjs';

const groups = {
  kernel: ['claude-channel-host-only', 'public-kernel-team-roots', 'public-kernel-disposable-home', 'public-kernel-seat-registry', 'public-kernel-launch-preview', 'public-kernel-codex-delivery', 'public-kernel-upgrade', 'aweb-tasks-kernel', 'aweb-tasks-team-kernel', 'unread-attention-native'],
  historical: ['public-kernel-grant-inventory'],
  host: ['health-command-native', 'health-host-native'],
  stack: ['resident-journey'],
  // Requires a disposable hosted team, pi extension, dashboard token and the
  // hosted status API. The OSS stack cannot supply these; see docs/test-matrix.md.
  hosted: ['health-live'],
};
const group = process.argv[2];
assert.ok(group === 'unit' || Object.hasOwn(groups, group), 'usage: node scripts/test-ci.mjs unit|kernel|host|stack|historical|hosted');
const other = new Set(Object.values(groups).flat());
const files = group === 'unit'
  ? readdirSync('test').filter(f => f.endsWith('.test.mjs') && !other.has(f.slice(0, -9))).map(f => `test/${f}`)
  : groups[group].map(f => `test/${f}.test.mjs`);
const exclusions = [];
if (group === 'unit' && process.platform !== 'linux') {
  exclusions.push('Linux without systemd lingering stops before any init with the exact admin command');
}
if (group === 'unit' && process.env.OATS_TEST_AW_VERSION === '1.36.33') {
  // BYOT create's controller-key behavior was added in aw 1.36.56. The fake
  // tests still run at the floor; the three real cases run at tested and next.
  // P1's two tested-only native cases additionally need set/show-server (>=.44)
  // and count-only (absent at .33); the other four now run at every version.
  exclusions.push('real aw prose: missing team-server record and name conflicts are classified', 'real aw prose: version and count-only help match the feature readers', 'real aw: the offline answers still have the captured shapes', 'real aw: setup --create with no namespace controller key names it and creates nothing', 'real aw: setup --create on a fresh deployment without --name stops before create, naming --name <alias>');
}
if (group === 'stack' && process.env.AW_VERSION !== '1.36.33') {
  // aw >=1.36.53 refuses this API key before writing a partial; there can be
  // no partial-registry mismatch. The preceding test checks that refusal.
  exclusions.push("a rerun with another registry gets aw's own refusal");
}
if (group === 'kernel') {
  const root = process.env.OATS_TASKS_KERNEL_ROOT;
  assert.ok(root, 'kernel group requires an explicitly provisioned kernel');
  const version = spawnSync(process.execPath, [join(root, 'bin/oats.mjs'), 'version', '--json'], { env: process.env, encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  const doc = JSON.parse(version.stdout);
  if (!doc.features?.includes('settings-committed-only')) {
    const name = 'a kernel with settings-committed-only refuses team from oats-local.yaml and from --provider';
    exclusions.push(name);
    console.log(`Capability exclusion: OATS ${doc.version} lacks settings-committed-only: ${name}`);
  }
}
const args = ['test', '--', '--test-concurrency=1', '--test-reporter=tap', ...exclusionArgs(exclusions, files), ...files];
const result = await new Promise((resolve, reject) => {
  const child = spawn('npm', args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', data => { process.stdout.write(data); stdout += data; });
  child.stderr.on('data', data => process.stderr.write(data));
  child.on('error', reject);
  child.on('close', (status, signal) => resolve({ status, signal, stdout }));
});
assert.equal(result.status, 0, `${group}: npm test failed (${result.signal ?? result.status})`);
assert.match(result.stdout, /^# skipped 0$/m, `${group}: every selected test must run; a prerequisite is missing`);
assert.match(result.stdout, /^# tests [1-9][0-9]*$/m, `${group}: no tests ran`);
