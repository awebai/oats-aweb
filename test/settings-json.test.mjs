import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const hook = new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs', import.meta.url).pathname;
for (const [name, args, extra, code] of [
  ['main hook', ['spawn'], {}, null],
  ['username setup', ['setup', '--username', 'fixture-user', '--name', 'fixture', '--json'], {}, 'E_SETUP_ROOT'],
  ['setup check', ['setup', '--check-only', '--json'], {}, 'E_SETUP_ROOT'],
  ['setup create', ['setup', '--create', 'fixture', '--json'], {}, 'E_SETUP_ROOT'],
  ['setup join', ['setup', '--join', 'fixture', '--invite-stdin', '--json'], {}, 'E_SETUP_ROOT'],
  ['setup text', ['setup', '--check-only'], {}, 'stderr:E_SETUP_ROOT'],
  ...['roster', 'connect', 'teams', 'join', 'leave'].map(event => [event, [event, '--json'], {}, 'stderr']),
  ['teams operation', ['teams', '--json'], { OATS_OPERATION: 'teams' }, 'E_SETTINGS'],
  ['empty settings', ['spawn'], { OATS_SETTINGS: '' }, null],
  ...['null', '[]', '3', '"x"'].map(value => [`non-object ${value}`, ['spawn'], { OATS_SETTINGS: value }, null]),
  ['upgrade plan', ['upgrade'], { OATS_UPGRADE_PHASE: 'plan' }, 'plan'],
  ['upgrade apply', ['upgrade'], { OATS_UPGRADE_PHASE: 'apply' }, null],
  ['resident', ['resident', 'create', 'fixture', '--plan', '--json'], {}, 'E_RESIDENT_FAILED'],
  ['wake', ['wake', 'status', '--json'], {}, 'E_WAKE_FAILED'],
  ['invite', ['invite', '--plan', '--json'], {}, 'E_INVITE_ROOT'],
  ['invite with absent settings', ['invite', '--plan', '--json'], { OATS_SETTINGS: undefined }, 'E_INVITE_ROOT'],
  ['health', ['health', 'status', '--json'], {}, 'E_HEALTH'],
]) test(`${name} refuses malformed OATS_SETTINGS without echoing input`, t => {
  const dir = mkdtempSync(join(tmpdir(), 'settings-json-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dep = join(dir, 'deployment'); mkdirSync(dep);
  writeFileSync(join(dep, 'oats-local.yaml'), 'schemaVersion: 2\nworkspace: fixture\n');
  const bin = join(dir, 'bin'); mkdirSync(bin);
  const calls = join(dir, 'calls');
  for (const command of ['aw', 'oats', 'launchctl', 'systemctl', 'loginctl']) {
    writeFileSync(join(bin, command), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(calls)}, 'unexpected child\\n');process.exit(88);\n`, { mode: 0o755 });
  }
  const result = spawnSync(process.execPath, [hook, ...args], { cwd: dep, encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir, OATS_CLI_BIN: join(bin, 'oats'), OATS_WORKSPACE: dep, OATS_TEAM_SCOPE: dep,
      OATS_HOME: dir, OATS_INSTANCE_HOME: dir, OATS_INSTANCE: 'fixture', OATS_WORKSPACE_NAME: 'fixture',
      OATS_META: JSON.stringify({ team: 'fixture:example.invalid', alias: 'fixture' }),
      OATS_SETTINGS: '{SECRET_SETTINGS_INPUT', ...extra } });
  const output = result.stdout + result.stderr;
  assert.equal(existsSync(calls), false, 'invalid settings stop before any external command');
  assert.doesNotMatch(output, /SECRET_SETTINGS_INPUT/);
  assert.match(output, /OATS_SETTINGS/);
  if (code?.startsWith('stderr')) {
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /oats aweb/);
    if (code.includes(':')) assert.ok(result.stderr.includes(code.split(':')[1]));
    return;
  }
  const doc = JSON.parse(result.stdout);
  if (name.startsWith('non-object')) assert.equal(doc.warning, 'oats-aweb: OATS_SETTINGS must be a JSON object');
  if (code === 'plan') { assert.equal(result.status, 0); assert.equal(doc.adopt, false); }
  else { assert.equal(result.status, 1); if (code) assert.equal(doc.error.code, code); }
});
