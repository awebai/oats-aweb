import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {readAwVersion} from '../oats-package/capabilities/oats-aweb/lib/binding-wire.mjs';
import {healthHost} from '../oats-package/capabilities/oats-aweb/lib/health-host.mjs';
import {readWakeStatus} from '../oats-package/capabilities/oats-aweb/lib/wake-service.mjs';
import {awChildEnv, AW_UNSET_ENV} from '../oats-package/capabilities/oats-aweb/lib/aw-child-env.mjs';

const HOOK = resolve('oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs');
const BINDING = resolve('oats-package/capabilities/oats-aweb/bin/oats-aweb-binding.mjs');
const SELECTORS = ['AWEB_IDENTITY_HOME', 'AWEB_URL', 'AWEB_API_KEY', 'AWEB_ROLE_NAME', 'AWEB_ROLE', 'AWID_REGISTRY_URL'];
const SERVICE = 'https://home.example.invalid/api';
test('one selector list allows only named explicit overrides without changing the base', () => {
  assert.deepEqual(AW_UNSET_ENV, SELECTORS);
  const base = Object.fromEntries(SELECTORS.map(k => [k, 'ambient']));
  const explicit = {AWEB_IDENTITY_HOME: '/grant', AWID_REGISTRY_URL: 'https://registry.example.invalid'};
  assert.deepEqual(awChildEnv(base, explicit), {AW_NO_UPDATE_CHECK: '1', ...explicit});
  assert.ok(SELECTORS.every(k => base[k] === 'ambient'));
});
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'aw-child-env-'));
  t.after(() => rmSync(base, {recursive: true, force: true}));
  const home = join(base, 'home'), bin = join(base, 'bin'), calls = join(base, 'calls');
  mkdirSync(join(home, '.aw'), {recursive: true}); mkdirSync(bin);
  writeFileSync(calls, '');
  writeFileSync(join(home, '.aw', 'workspace.yaml'), `aweb_url: ${SERVICE}\n`);
  writeFileSync(join(bin, 'aw'), `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
const env = Object.fromEntries(${JSON.stringify(SELECTORS)}.filter(k => k in process.env).map(k => [k, process.env[k]]));
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({args, env}) + '\\n');
if (args[0] === 'version') console.log('aw 1.36.33');
else if (args.slice(0, 2).join(' ') === 'wake status') console.log('{}');
else if (args.slice(0, 2).join(' ') === 'workspace delete') {
  const service = process.env.AWEB_URL || fs.readFileSync(path.join(process.cwd(), '.aw', 'workspace.yaml'), 'utf8').match(/aweb_url: (.*)/)[1];
  console.log(JSON.stringify({alias_released: true, alias_released_reason: service}));
} else if (args[0] === 'init') {
  if (!process.env.AWEB_API_KEY || !process.env.AWEB_URL) process.exit(91);
  fs.writeFileSync(path.join(process.cwd(), '.aw', 'initialized'), '1');
} else if (args.slice(0, 2).join(' ') === 'team list') {
  console.log(JSON.stringify({memberships: fs.existsSync(path.join(process.cwd(), '.aw', 'initialized')) ? [{team_id: 't:example.test'}] : []}));
} else { console.error('unexpected aw command'); process.exitCode = 92; }
`);
  chmodSync(join(bin, 'aw'), 0o755);
  const kernel = join(base, 'kernel.mjs');
  writeFileSync(kernel, 'console.log(JSON.stringify({features: []}));');
  const env = {PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: base,
    OATS_NODE_BIN: process.execPath, OATS_CLI_BIN: kernel,
    OATS_HOME: home, OATS_INSTANCE_HOME: home, OATS_INSTANCE: 'probe', OATS_TEAM_SCOPE: base,
    OATS_WORKSPACE_NAME: 'fixture', OATS_DEFAULT_TEAM: 'default', OATS_DEFAULT_TEAM_ID: 't:example.test',
    OATS_SETTINGS: JSON.stringify({root: home}), OATS_META: JSON.stringify({alias: 'probe', runtime: 'pi', delivery: 'channel'}),
    ...Object.fromEntries(SELECTORS.map(k => [k, `ambient-${k}`])),
    AWEB_URL: 'https://wrong.example.invalid/api',
  };
  const hook = event => spawnSync(process.execPath, [HOOK, event], {cwd: home, env: {...env, OATS_EVENT: event}, encoding: 'utf8'});
  return {home, env, hook, calls: () => readFileSync(calls, 'utf8').split('\n').filter(Boolean).map(JSON.parse)};
}

test('retire uses the home service with every ambient aw selector exported', t => {
  const f = fixture(t), r = f.hook('retire');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).meta.aliasReason, SERVICE);
  assert.deepEqual(f.calls().find(c => c.args[0] === 'workspace').env, {});
});

test('binding version and health aw children use the same isolated environment', async t => {
  const f = fixture(t);
  assert.equal(await readAwVersion({env: f.env}), '1.36.33');
  await healthHost({deployment: f.home, env: f.env}).awSupportsStatus();
  assert.deepEqual(readWakeStatus('aw', f.env, f.home), {});
  assert.equal(f.calls().length, 3);
  for (const c of f.calls()) assert.deepEqual(c.env, {});
});

test('binding readiness strips selectors from its native wake read', t => {
  const f = fixture(t);
  const input = {schemaVersion: 1, phase: 'check', slot: 'messaging', capability: 'oats.aweb',
    settings: {root: f.home, delivery: 'session', registry:'https://registry.example.invalid'}, input: {action: {kind: 'readiness'}, context: {kind: 'workspace', workspace: 'fixture', deployment: f.home, home: null, soul: 'probe'}}};
  const r = spawnSync(process.execPath, [BINDING, 'check'], {input: JSON.stringify(input), env: f.env, encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(f.calls().some(c => c.args[0] === 'wake'), 'readiness asks for broker status');
  for (const c of f.calls()) assert.deepEqual(c.env, {});
});

test('setup passes its documented key and service only to the explicit init', t => {
  const f = fixture(t);f.env.OATS_SETTINGS=JSON.stringify({root:f.home,registry:'https://registry.example.invalid'});const r=f.hook('setup');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /readiness: ready/);
  const calls = f.calls(), init = calls.find(c => c.args[0] === 'init');
  assert.ok(init, r.stdout + r.stderr);
  assert.deepEqual(init.env, {AWEB_URL: f.env.AWEB_URL, AWEB_API_KEY: f.env.AWEB_API_KEY, AWID_REGISTRY_URL: 'https://registry.example.invalid'});
  assert.ok(calls.indexOf(init) < calls.length - 1, 'a native child runs after init');
  for (const c of calls.filter(c => c !== init)) assert.deepEqual(c.env, {});
});
