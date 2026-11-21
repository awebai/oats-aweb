// Which of oats.aweb's package requirements apply to a launch, judged by the
// pinned kernel's own predicate (lib/core.mjs applicableRequirements): the
// channel packages are required of tmux launches only, and a session
// provider's launch gets its own session-delivery floor rows, whatever the
// `delivery` value. Opt-in locally and REQUIRED in CI (the kernel group).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const root = process.env.OATS_HOST_ONLY_KERNEL_ROOT;
if (process.env.OATS_HOST_ONLY_REQUIRED === '1') assert.ok(root, 'required requirement-backends test needs OATS_HOST_ONLY_KERNEL_ROOT');
const manifest = JSON.parse(readFileSync(new URL('../oats-package/capabilities/oats-aweb/oats.json', import.meta.url), 'utf8'));
const kernel = root ? await import(pathToFileURL(join(root, 'lib/core.mjs'))) : null;

// Each package row named by what it is, so the kernel's answer says which row it kept.
const ROW_NAMES = ['pi channel package', 'claude channel package', 'pi session floor', 'claude session floor', 'pi provider floor', 'claude provider floor'];
const packageRows = manifest.requires.filter((row) => row.package);
const named = {...manifest, requires: packageRows.map((row, index) => ({...row, package: ROW_NAMES[index]}))};
const applying = (harness, delivery, backend) => kernel.applicableRequirements(harness, [{id: 'oats.aweb', manifest: named, settings: {delivery}}], backend).map((row) => row.package);

test('the manifest declares six package rows, in the order this test names them', () => {
  assert.deepEqual(packageRows.map((row) => [row.runtime, row.package, row.when?.delivery, row.backends ?? null, row.minVersion ?? null, row.ifInstalled === true]), [
    ['pi', 'npm:@awebai/pi', 'channel', ['tmux'], null, false],
    ['claude', 'aweb-channel@awebai-marketplace', 'channel', ['tmux'], null, false],
    ['pi', 'npm:@awebai/pi', 'session', ['tmux'], '0.3.10', true],
    ['claude', 'aweb-channel@awebai-marketplace', 'session', ['tmux'], '1.7.9', true],
    ['pi', 'npm:@awebai/pi', undefined, ['session-provider'], '0.3.10', true],
    ['claude', 'aweb-channel@awebai-marketplace', undefined, ['session-provider'], '1.7.9', true],
  ]);
});

test('every package row names its backends: no row applies to both tmux and a session provider', () => {
  for (const row of packageRows) assert.equal(row.backends?.length, 1, JSON.stringify(row).slice(0, 120));
});

test('the pinned kernel lists session-providers: the floor a row that excludes tmux needs', {skip: !root}, () => {
  const version = spawnSync(process.execPath, [join(root, 'bin/oats.mjs'), 'version', '--json'], {encoding: 'utf8'});
  assert.equal(version.status, 0, version.stderr);
  assert.ok(JSON.parse(version.stdout).features.includes('session-providers'));
});

test('a tmux launch: the channel package under delivery: channel, the floor under delivery: session', {skip: !root}, () => {
  assert.deepEqual(applying('claude', 'channel', 'tmux'), ['claude channel package']);
  assert.deepEqual(applying('pi', 'channel', 'tmux'), ['pi channel package']);
  assert.deepEqual(applying('claude', 'session', 'tmux'), ['claude session floor']);
  assert.deepEqual(applying('pi', 'session', 'tmux'), ['pi session floor']);
});

test("a session provider's launch: never the channel package, and exactly one floor under either delivery value", {skip: !root}, () => {
  for (const backend of ['bb', 'fake']) {
    assert.deepEqual(applying('claude', 'channel', backend), ['claude provider floor'], backend);
    assert.deepEqual(applying('pi', 'channel', backend), ['pi provider floor'], backend);
    assert.deepEqual(applying('claude', 'session', backend), ['claude provider floor'], backend);
    assert.deepEqual(applying('pi', 'session', backend), ['pi provider floor'], backend);
  }
});

test('a harness with no aweb channel has no package requirement on any backend', {skip: !root}, () => {
  for (const backend of ['tmux', 'bb']) for (const delivery of ['channel', 'session']) assert.deepEqual(applying('codex', delivery, backend), [], `${backend} ${delivery}`);
});
