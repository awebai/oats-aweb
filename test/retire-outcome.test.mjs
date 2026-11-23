import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';

const HOOK = resolve('oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs');

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'retire-outcome-'));
  t.after(() => rmSync(base, {recursive: true, force: true}));
  const home = join(base, 'home'), bin = join(base, 'bin'), calls = join(base, 'calls');
  mkdirSync(join(home, '.aw'), {recursive: true});
  mkdirSync(bin);
  writeFileSync(calls, '');
  writeFileSync(join(bin, 'aw'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
if (args.join(' ') === 'version') console.log('aw 1.36.33');
else if (args.slice(0, 2).join(' ') === 'workspace delete') console.log(process.env.DELETE_RECEIPT);
else { console.error('unexpected aw command'); process.exitCode = 1; }
`);
  chmodSync(join(bin, 'aw'), 0o755);
  // Retire asks only whether the kernel supports waiting claims. Never dispatch
  // into the installed kernel or a live deployment from this disposable home.
  const kernel = join(base, 'kernel.mjs');
  writeFileSync(kernel, 'console.log(JSON.stringify({features: []}));');
  const retire = (meta, receipt = {}) => {
    const r = spawnSync(process.execPath, [HOOK, 'retire'], {cwd: home, encoding: 'utf8', env: {
      PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: base,
      OATS_NODE_BIN: process.execPath, OATS_CLI_BIN: kernel,
      OATS_EVENT: 'retire', OATS_HOME: home, OATS_INSTANCE_HOME: home, OATS_INSTANCE: 'probe',
      OATS_TEAM_SCOPE: base, OATS_DEFAULT_TEAM: 'default', OATS_DEFAULT_TEAM_ID: 't:example.test',
      OATS_SETTINGS: '{}', OATS_META: JSON.stringify({runtime: 'pi', delivery: 'channel', ...meta}),
      DELETE_RECEIPT: JSON.stringify(receipt),
    }});
    return {...r, doc: JSON.parse(r.stdout)};
  };
  return {home, retire, calls: () => readFileSync(calls, 'utf8').split('\n').filter(Boolean).map(JSON.parse)};
}

test('global retire without a grant or seat reports the kernel completion vocabulary', t => {
  const fx = fixture(t);
  const r = fx.retire({identity: {mode: 'global'}});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.doc.meta, {retired: false, reason: 'nothing-to-delete'});
  assert.ok(fx.calls().every(args => args[0] === 'version'), 'no revoke or delete is needed');
});

test('a failed joined leave replaces no-op completion but preserves an incomplete default cleanup', t => {
  for (const alias of [undefined, 'probe']) {
    const fx = fixture(t);
    rmSync(join(fx.home, '.aw'), {recursive: true});
    const identityHome = join(fx.home, '.aweb-identity-other');
    mkdirSync(identityHome);
    const r = fx.retire({alias, joinedTeams: [{label: 'other', team: 'other:example.test', alias: 'probe', identityHome}]});
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(r.doc.meta.retired, false);
    assert.equal(r.doc.meta.reason, alias ? 'no-local-identity-key' : 'joined-team-leave-failed');
    assert.deepEqual(r.doc.meta.failedLeaves, ['other']);
  }
});

test('retire reads only alias_released_reason from the native workspace receipt', t => {
  for (const [receipt, expected] of [
    [{alias_released: false, reason: 'team_not_hosted'}, 'unstated'],
    [{alias_released: false, alias_released_reason: 'alias_held', reason: 'team_not_hosted'}, 'alias_held'],
    [{alias_released: true, alias_released_reason: 'released'}, 'released'],
  ]) {
    const fx = fixture(t);
    const r = fx.retire({alias: 'probe'}, receipt);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.doc.meta.retired, true);
    assert.equal(r.doc.meta.aliasReason, expected);
    assert.equal(r.doc.meta.aliasReusable, receipt.alias_released);
    assert.equal(r.doc.meta.pendingControllerCleanup, undefined);
  }
});
