// Real public kernel verbs in an isolated deployment. Broker/count observations
// are controlled here; this does not prove real aw count-only admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {healthHost} from '../oats-package/capabilities/oats-aweb/lib/health-host.mjs';
import {observeUnreadAttention} from '../oats-package/capabilities/oats-aweb/lib/unread-attention.mjs';
import {createScratchDeployment} from './helpers/scratch-deployment.mjs';

const skip = process.env.OATS_AWEB_HEALTH_NATIVE === '1' ? false : 'set OATS_AWEB_HEALTH_NATIVE=1 for real kernel waiting claims';
const kernel = process.env.OATS_PREVIEW_KERNEL_ROOT;
test('observer uses real kernel claims, idempotence and producer isolation', {skip}, async t => {
  const scratch = createScratchDeployment({kernel});
  t.after(() => scratch.dispose());
  const home = scratch.spawn('unread', {launch: false});
  const env = {...scratch.env, ...(kernel ? {OATS_NODE_BIN: process.execPath, OATS_CLI_BIN: join(kernel, 'bin/oats.mjs')} : {})};
  const host = healthHost({deployment: scratch.deployment, env});
  assert.equal(await host.supportsWaiting(), true, 'selected real kernel needs waiting-on-you');
  const rows = [{home, capabilityMeta: {'oats.aweb': {}}}];
  const target = {home, delivery: 'session', channel_core: {last_error: 'private content'}, receive_identities: [{identity_home: `${home}/.aw`}]};
  host.wakeStatus = async () => ({instances: [target]});
  host.unreadCount = async () => 3;
  const status = () => JSON.stringify(scratch.json(['status']));
  const events = () => scratch.json(['instance', 'events', 'unread', '--home', home]).result.events;
  const other = scratch.json(['instance', 'waiting', 'set', '--producer', 'agent', '--reason', 'attention', '--message', 'Other producer claim', '--home', home]);
  assert.equal(other.ok, true, JSON.stringify(other));
  assert.equal((await observeUnreadAttention({host, rows})).set, 1);
  assert.match(status(), /aweb: 3 unread, not delivered \(broker-worker-error\)/);
  assert.doesNotMatch(status(), /private content/);
  const afterSet = events().length;
  await observeUnreadAttention({host, rows});
  assert.equal(events().length, afterSet, 'identical set is idempotent');
  host.unreadCount = async () => null;
  assert.equal((await observeUnreadAttention({host, rows})).unknown, 1);
  assert.equal(events().length, afterSet, 'count error preserves claim');
  host.unreadCount = async () => 0;
  assert.equal((await observeUnreadAttention({host, rows})).cleared, 1);
  assert.doesNotMatch(status(), /aweb: 3 unread/);
  assert.match(status(), /Other producer claim/);
  const afterClear = events().length;
  await observeUnreadAttention({host, rows});
  assert.equal(events().length, afterClear, 'identical clear is idempotent');
  host.unreadCount = async () => 1;
  await observeUnreadAttention({host, rows});
  host.wakeStatus = async () => ({instances: []});
  await observeUnreadAttention({host, rows});
  assert.doesNotMatch(status(), /aweb: 1 unread/);

  // Disable uses this exact all-home clear pass, without broker/count reads.
  host.wakeStatus = async () => ({instances: [target]});
  await observeUnreadAttention({host, rows});
  await observeUnreadAttention({host, rows, clear: true, budgetMs: 0});
  assert.doesNotMatch(status(), /aweb: 1 unread/);
  assert.match(status(), /Other producer claim/);

  // The real retire hook must clear the target despite foreign ambient instance
  // selectors; no identity was minted, so retirement has no remote effects.
  await observeUnreadAttention({host, rows});
  writeFileSync(join(scratch.bin, 'aw'), '#!/bin/sh\n[ "$1 $2" = "wake deregister" ] && exit 0\nexit 1\n', {mode: 0o755});
  const hook = spawnSync(process.execPath, [new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs', import.meta.url).pathname, 'retire'], {
    cwd: home, env: {...env, PATH: `${scratch.bin}:${env.PATH}`, OATS_EVENT: 'retire', OATS_HOME: home, OATS_INSTANCE_HOME: '/foreign', OATS_INSTANCE: 'foreign', OATS_TEAM_SCOPE: scratch.deployment, OATS_WORKSPACE: scratch.deployment, OATS_META: '{}'}, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(hook.status, 0, hook.stdout + hook.stderr);
  assert.doesNotMatch(status(), /aweb: 1 unread/);
  assert.match(status(), /Other producer claim/);

  await observeUnreadAttention({host, rows});
  const started = scratch.json(['session', 'start', '--home', home, '--launch-config', 'fake']);
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.doesNotMatch(status(), /aweb: 1 unread/);
  await observeUnreadAttention({host, rows});
  scratch.stop('unread');
  assert.doesNotMatch(status(), /aweb: 1 unread/);
});
