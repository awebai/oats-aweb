// oats.aweb-tasks's claim floors: what keeps a home's aweb task claims present
// (the host wake daemon from aw 1.36.54, the aweb-channel plugin from 1.8.2,
// the aweb pi extension from 0.4.1), the local version rules, and the readiness
// check against a fake aw, a fake kernel and fake Claude and pi installs. CI
// cannot install the new releases yet, so every component here is a fake.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as floors from '../oats-package/capabilities/oats-aweb-tasks/lib/claim-floors.mjs';
import * as version from '../oats-package/capabilities/oats-aweb-tasks/lib/version.mjs';
import * as awFloor from '../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs';
import { checkResult } from '../oats-package/capabilities/oats-aweb-tasks/lib/binding.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cap = join(root, 'oats-package/capabilities/oats-aweb-tasks');
const DAEMON = (v) => `oats.aweb-tasks: host wake daemon is running ${v}; aweb task claims need aw 1.36.54 or later, whose wake daemon heartbeats claims: upgrade aw, then restart the host wake daemon (\`oats aweb wake install\`)`;
const CHANNEL = (v, home) => `oats.aweb-tasks: aweb task claims on this Claude home are kept present by the aweb-channel plugin, which needs 1.8.2 or later (installed: ${v}): update the plugin, then restart the home (\`oats session restart --home ${home}\`)`;
const PI = (v, home) => `oats.aweb-tasks: aweb task claims on this pi home are kept present by the aweb pi extension (@awebai/pi), which needs 0.4.1 or later (installed: ${v}): update the extension, then restart the home (\`oats session restart --home ${home}\`)`;
const reported = (v, extra = {}) => ({ daemon_running: true, daemon_version_state: 'reported', daemon_version: v, ...extra });
const codes = (list) => (list || []).map((x) => x.code);
const scratch = (t, prefix) => { const d = realpathSync(mkdtempSync(join(tmpdir(), prefix))); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const write = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };

// ------------------------------------------------------------ version rules

test('the floors are the final releases, and the local AW_MIN is oats.aweb\'s', () => {
  assert.deepEqual([floors.TASKS_WAKE_FLOOR, floors.AWEB_CHANNEL_FLOOR, floors.PI_EXTENSION_FLOOR], ['1.36.54', '1.8.2', '0.4.1']);
  assert.equal(floors.AW_MIN, awFloor.AW_MIN, 'oats-aweb-tasks/lib/claim-floors.mjs AW_MIN must equal oats-aweb/lib/aw-floor.mjs AW_MIN');
  // Read from the files too, so a copy that only re-exports cannot pass.
  const constant = (path, name) => new RegExp(`export const ${name} = '([^']+)';`).exec(readFileSync(join(root, path), 'utf8'))?.[1];
  // oats.aweb's AW_MIN is aw-compat.json's min.
  const compat = JSON.parse(readFileSync(join(root, 'oats-package/capabilities/oats-aweb/aw-compat.json'), 'utf8'));
  assert.equal(constant('oats-package/capabilities/oats-aweb-tasks/lib/claim-floors.mjs', 'AW_MIN'), compat.min);
  for (const file of ['claim-floors.mjs', 'version.mjs', 'binding.mjs']) assert.doesNotMatch(readFileSync(join(cap, 'lib', file), 'utf8'), /from '[^']*oats-aweb\//, `${file} imports nothing of oats.aweb`);
  // oats.aweb-tasks never reads oats.aweb's instance.json meta or its private files.
  for (const file of ['claim-floors.mjs', 'binding.mjs']) assert.doesNotMatch(readFileSync(join(cap, 'lib', file), 'utf8'), /capabilityMeta|\.oats-aweb\b/, file);
});

test('the local version rules: the complete token, numeric parts, a pre-release below its release, +build ignored', () => {
  for (const bad of ['', '1.36', '1.36.54.1', 'v1.36.54', ' 1.36.54', '1.36.54 ', '1.36.54x', '01.36.54', '1.036.54', '1.36.54-', '1.36.54-01', '1.36.54+', '1.36.54-rc..1', null, 1.36, undefined]) {
    assert.equal(version.parseVersion(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(version.parseVersion('1.36.54-rc.1+abc.7'), { release: [1, 36, 54], pre: ['rc', '1'] });
  const at = version.versionAtLeast;
  assert.equal(at('1.36.100', '1.36.54'), true, 'numeric, not text');
  assert.equal(at('1.36.9', '1.36.54'), false);
  assert.equal(at('1.36.54-rc.1', '1.36.54'), false, 'a pre-release is below its release');
  assert.equal(at('1.36.54-rc.10', '1.36.54-rc.9'), true, 'numeric pre-release ids compare as numbers');
  assert.equal(at('1.36.54-rc.1', '1.36.53'), true, 'above every lower release');
  assert.equal(at('1.36.54+build.5', '1.36.54'), true, 'build metadata has no precedence');
  assert.equal(at('1.36.53+zzz', '1.36.54'), false);
  assert.equal(at('1.36.54-1', '1.36.54-alpha'), false, 'numeric ids sort below alphanumeric ones');
  assert.equal(at('not-a-version', '1.0.0'), false);
});

test('the local version rules answer exactly as oats.aweb\'s aw-floor.mjs', () => {
  const corpus = ['0.0.0', '0.4.0', '0.4.1-rc.1', '0.4.1', '1.8.1', '1.8.2', '1.36.33', '1.36.33-rc.1', '1.36.53', '1.36.53-rc.3', '1.36.54-rc.1', '1.36.54-rc.10', '1.36.54-rc.9', '1.36.54',
    '1.36.54+b', '1.36.55', '1.37.0', '2.0.0-alpha', '2.0.0-alpha.1', '2.0.0-1', '2.0.0-alpha.beta', '1.36.54-99999999999999999999', '1.36',
    'v1.36.54', '01.2.3', '1.2.3-01', '9007199254740993.0.0'];
  for (const v of corpus) {
    assert.deepEqual(version.parseVersion(v), awFloor.parseVersion(v), `parse ${v}`);
    for (const f of corpus) assert.equal(version.versionAtLeast(v, f), awFloor.versionAtLeast(v, f), `${v} >= ${f}`);
  }
});

// -------------------------------------------------------------- the warnings

test('the daemon warning: 1.36.53 and 1.36.54-rc.1 warn; 1.36.54 and above do not; below AW_MIN and unreadable add nothing', () => {
  const w = floors.wakeDaemonWarning;
  for (const v of ['1.36.53', '1.36.54-rc.1', floors.AW_MIN, '1.36.40+b']) assert.deepEqual(w(reported(v)), { code: 'wake-daemon-outdated', message: DAEMON(v) }, v);
  for (const v of ['1.36.54', '1.36.55', '1.36.54+build', '1.37.0', '2.0.0-rc.1']) assert.equal(w(reported(v)), undefined, v);
  // Below AW_MIN, oats.aweb's own item for this listed home is the only one.
  for (const v of ['1.36.31', `${floors.AW_MIN}-rc.1`, '0.1.0']) assert.equal(w(reported(v)), undefined, v);
  for (const [name, status] of [
    ['not running', { daemon_running: false, daemon_version_state: 'not_running', daemon_version: '1.36.53' }],
    ['running unknown', { daemon_running: 'yes', daemon_version_state: 'reported', daemon_version: '1.36.53' }],
    ['version unknown', { daemon_running: true, daemon_version_state: 'unknown', daemon_version: '1.36.53' }],
    ['no version', { daemon_running: true, daemon_version_state: 'reported' }],
    ['not semver', reported('1.36')], ['a number', reported(1.36)], ['text around it', reported('aw 1.36.53')],
    ['unreadable', undefined], ['null', null], ['an array', [reported('1.36.53')]], ['a string', '1.36.53'],
  ]) assert.equal(w(status), undefined, name);
});

test('the channel and pi warnings: below the floor warns with the installed version; at or above, or unreadable, adds nothing', () => {
  assert.deepEqual(floors.awebChannelWarning('1.8.1', '/h/x'), { code: 'aweb-channel-outdated', message: CHANNEL('1.8.1', '/h/x') });
  assert.deepEqual(floors.awebChannelWarning('1.8.2-rc.1', '/h/x')?.code, 'aweb-channel-outdated');
  for (const v of ['1.8.2', '1.9.0', '2.0.0', undefined, 'latest', '1.8']) assert.equal(floors.awebChannelWarning(v, '/h/x'), undefined, String(v));
  assert.deepEqual(floors.piExtensionWarning('0.4.0', '/h/x'), { code: 'pi-extension-outdated', message: PI('0.4.0', '/h/x') });
  for (const v of ['0.4.1', '0.5.0', undefined, 'x']) assert.equal(floors.piExtensionWarning(v, '/h/x'), undefined, String(v));
});

// ------------------------------------------------------------ the scope

test('claimFloors: the daemon where the status lists the home, else the channel the home records; a soul gets none', t => {
  const dir = scratch(t, 'aweb-tasks-scope-'), home = join(dir, 'home'), link = join(dir, 'link');
  mkdirSync(home); symlinkSync(home, link);
  const listed = (row = {}) => ({ ...reported('1.36.53'), instances: [{ home, ...row }] });
  const launch = (runtime) => ({ runtime, env: {} });
  const f = (status, l, ctx = { home }) => floors.claimFloors(ctx, { status, launch: l });
  assert.deepEqual(f(listed({ runtime_delivery: 'external-session' }), launch('codex')), ['wake-daemon']);
  assert.deepEqual(f({ ...reported('1.36.53'), instances: [{ home: link }] }, launch('codex')), ['wake-daemon'], 'the same home through a symlink');
  assert.deepEqual(f(listed({ runtime_delivery: 'native-pi' }), launch('pi')), ['wake-daemon', 'pi-extension'], 'a pi home listed for its joined teams');
  assert.deepEqual(f(listed({ runtime_delivery: 'native-channel' }), launch('claude')), ['wake-daemon', 'aweb-channel']);
  for (const status of [reported('1.36.53', { instances: [] }), reported('1.36.53'), undefined, reported('1.36.53', { instances: [{ home: 'home' }] })]) {
    assert.deepEqual(f(status, launch('claude')), ['aweb-channel'], 'not listed: the Claude channel');
    assert.deepEqual(f(status, launch('pi')), ['pi-extension'], 'not listed: the pi extension');
    assert.deepEqual(f(status, launch('codex')), [], 'not listed: a Codex home is oats.aweb\'s wake-target-missing');
    assert.deepEqual(f(status, launch(undefined)), [], 'no harness recorded');
    assert.deepEqual(f(status, undefined), [], 'no launch record');
  }
  assert.deepEqual(f(listed(), launch('claude'), { deployment: dir, soul: 'worker' }), [], 'a soul');
});

// --------------------------------------------------------------- the readers

test('the readers: the launch record, the config dirs, and the installed versions, never through a link out', t => {
  const dir = scratch(t, 'aweb-tasks-readers-'), home = join(dir, 'home'), user = join(dir, 'user');
  mkdirSync(home); mkdirSync(user);
  const env = { HOME: user };
  // The kernel's launch record only: never oats.aweb's metadata.
  assert.equal(floors.recordedLaunch(home), undefined, 'no record');
  const meta = { 'oats.aweb': { runtime: 'claude', delivery: 'session', joinedTeams: [{ label: 'shared' }] } };
  write(join(home, 'instance.json'), { harness: 'claude', launch: { harness: 'pi', env: { X: '1' } }, capabilityMeta: meta });
  assert.deepEqual(floors.recordedLaunch(home), { runtime: 'pi', env: { X: '1' } }, 'launch.harness first');
  write(join(home, 'instance.json'), { harness: 'codex', launch: {}, capabilityMeta: meta });
  assert.deepEqual(floors.recordedLaunch(home), { runtime: 'codex', env: {} }, 'then the record\'s harness');
  write(join(home, 'instance.json'), { launch: { harness: '' }, capabilityMeta: meta });
  assert.deepEqual(floors.recordedLaunch(home), { runtime: undefined, env: {} }, 'oats.aweb\'s runtime is never read');
  write(join(home, 'instance.json'), { harness: 'claude' });
  assert.equal(floors.recordedLaunch(home), undefined, 'no launch');
  // Config dirs.
  const launch = (e) => ({ runtime: 'claude', env: e });
  assert.equal(floors.claudeConfigDir(launch({}), env), join(user, '.claude'));
  assert.equal(floors.claudeConfigDir(launch({ CLAUDE_CONFIG_DIR: '/c/dir' }), env), '/c/dir');
  for (const v of [{ fromEnv: 'X' }, 'rel/dir', '']) assert.equal(floors.claudeConfigDir(launch({ CLAUDE_CONFIG_DIR: v }), env), undefined, JSON.stringify(v));
  assert.equal(floors.claudeConfigDir(launch({}), {}), undefined, 'no HOME');
  assert.equal(floors.piAgentDir(launch({}), env), join(user, '.pi', 'agent'));
  assert.equal(floors.piAgentDir(launch({ PI_CODING_AGENT_DIR: '~/pi' }), env), join(user, 'pi'));
  assert.equal(floors.piAgentDir(launch({ PI_CODING_AGENT_DIR: '/p/agent' }), env), '/p/agent');
  assert.equal(floors.piAgentDir(launch({ PI_CODING_AGENT_DIR: { fromEnv: 'P' } }), env), undefined);

  // aweb-channel: the one user-scope entry.
  const claude = join(dir, 'claude'), plugins = join(claude, 'plugins', 'installed_plugins.json');
  const installed = (entries) => write(plugins, { version: 2, plugins: { 'other@m': [{ scope: 'user', version: '9.9.9' }], ...(entries ? { [floors.AWEB_CHANNEL_PLUGIN]: entries } : {}) } });
  assert.equal(floors.awebChannelVersion(claude), undefined, 'no file');
  installed([{ scope: 'user', installPath: '/x', version: '1.8.1' }]);
  assert.equal(floors.awebChannelVersion(claude), '1.8.1');
  installed([{ scope: 'project', projectPath: home, version: '1.8.2' }, { scope: 'user', version: '1.7.11' }]);
  assert.equal(floors.awebChannelVersion(claude), '1.7.11', 'a project-scope install is not read');
  for (const entries of [undefined, [], [{ scope: 'user', version: 'abc' }], [{ scope: 'user' }], [{ scope: 'user', version: '1.8.1' }, { scope: 'user', version: '1.8.2' }], 'x']) {
    installed(entries);
    assert.equal(floors.awebChannelVersion(claude), undefined, JSON.stringify(entries));
  }
  write(plugins, 'not json'); assert.equal(floors.awebChannelVersion(claude), undefined, 'malformed');
  write(plugins, ' '.repeat((1 << 20) + 1)); assert.equal(floors.awebChannelVersion(claude), undefined, 'too large');
  // A link out of the config dir is never read; a link inside it is.
  const outside = join(dir, 'outside.json');
  write(outside, { plugins: { [floors.AWEB_CHANNEL_PLUGIN]: [{ scope: 'user', version: '1.8.1' }] } });
  rmSync(plugins); symlinkSync(outside, plugins);
  assert.equal(floors.awebChannelVersion(claude), undefined, 'a link out');
  const inside = join(claude, 'plugins', 'real.json');
  write(inside, { plugins: { [floors.AWEB_CHANNEL_PLUGIN]: [{ scope: 'user', version: '1.8.1' }] } });
  rmSync(plugins); symlinkSync(inside, plugins);
  assert.equal(floors.awebChannelVersion(claude), '1.8.1', 'a link inside');

  // @awebai/pi: pi's managed npm install.
  const agent = join(dir, 'agent'), pkg = join(agent, 'npm', 'node_modules', '@awebai', 'pi', 'package.json');
  assert.equal(floors.piExtensionVersion(agent), undefined, 'not installed');
  write(pkg, { name: '@awebai/pi', version: '0.4.0' });
  assert.equal(floors.piExtensionVersion(agent), '0.4.0');
  for (const doc of [{ name: '@awebai/other', version: '0.4.0' }, { name: '@awebai/pi' }, { name: '@awebai/pi', version: 'next' }, 'garbage']) {
    write(pkg, doc); assert.equal(floors.piExtensionVersion(agent), undefined, JSON.stringify(doc));
  }
  // A linked package (npm link) resolves outside node_modules and is not read.
  const linked = join(dir, 'linked-pi');
  write(join(linked, 'package.json'), { name: '@awebai/pi', version: '0.4.0' });
  rmSync(dirname(pkg), { recursive: true }); symlinkSync(linked, dirname(pkg));
  assert.equal(floors.piExtensionVersion(agent), undefined, 'a link out');
});

test('a FIFO at an expected path is unreadable, never a blocked check', { skip: process.platform === 'win32' }, t => {
  const dir = scratch(t, 'aweb-tasks-fifo-'), file = join(dir, 'plugins', 'installed_plugins.json');
  mkdirSync(dirname(file));
  assert.equal(spawnSync('mkfifo', [file]).status, 0, 'mkfifo');
  const script = `import { readJsonInside } from ${JSON.stringify(join(cap, 'lib/claim-floors.mjs'))}; console.log(String(readJsonInside(${JSON.stringify(dir)}, ${JSON.stringify(file)})));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' });
  assert.equal(r.signal, null, 'did not block');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'undefined');
});

// ------------------------------------------------------- the readiness wire

// A copy of only this module; a fake aw that answers FAKE_WAKE ("exit",
// "garbage", "hang", or the stdout document) and logs each call; a fake kernel
// that answers FAKE_TEAMS / FAKE_INSPECT as in aweb-tasks-team.test.mjs; and a
// user HOME whose Claude and pi installs the test writes.
function fixture(t) {
  const dir = scratch(t, 'aweb-tasks-floors-');
  const home = join(dir, 'home'), user = join(dir, 'user'), bin = join(dir, 'bin'), module = join(dir, 'module'), deployment = join(dir, 'deployment');
  const awCalls = join(dir, 'aw-calls'), cli = join(dir, 'fake-oats.mjs');
  for (const d of [home, user, bin, deployment]) mkdirSync(d);
  writeFileSync(join(bin, 'aw'), `#!/bin/sh
leaked=$(env | grep -E '^(OATS_[A-Z_]*|AWEB_IDENTITY_HOME)=' | cut -d= -f1 | tr '\\n' ' ')
printf '{"args":"%s","cwd":"%s","leaked":"%s","noUpdate":"%s"}\\n' "$*" "$(pwd -P)" "$leaked" "$AW_NO_UPDATE_CHECK" >> '${awCalls}'
case "$FAKE_WAKE" in
  exit) echo 'E_FAKE' >&2; exit 1;;
  garbage) echo 'not json';;
  hang) exec sleep 30;;
  '') exit 97;;
  *) printf '%s\\n' "$FAKE_WAKE";;
esac
`, { mode: 0o755 });
  writeFileSync(cli, `const args = process.argv.slice(2);
const answer = args[0] === 'aweb' && args[1] === 'teams' ? process.env.FAKE_TEAMS : args[0] === 'inspect' ? process.env.FAKE_INSPECT : undefined;
if (answer === undefined) { process.stderr.write('E_FAKE: refused\\n'); process.exit(1); }
process.stdout.write(answer + '\\n');
`);
  cpSync(cap, module, { recursive: true });
  const env = (extra = {}) => ({ HOME: user, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, OATS_CLI_BIN: cli, OATS_NODE_BIN: process.execPath,
    OATS_INSTANCE_HOME: home, AWEB_IDENTITY_HOME: join(home, '.aw'), ...extra });
  return {
    dir, home, user, deployment, bin,
    awCalls: () => existsSync(awCalls) ? readFileSync(awCalls, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [],
    record: ({ harness, runtime, launchEnv = {} }) => write(join(home, 'instance.json'),
      { launch: { harness, env: launchEnv }, capabilityMeta: { 'oats.aweb': { ...(runtime ? { runtime } : {}) } } }),
    channel: (v, configDir = join(user, '.claude')) => write(join(configDir, 'plugins', 'installed_plugins.json'), { version: 2, plugins: { [floors.AWEB_CHANNEL_PLUGIN]: [{ scope: 'user', version: v }] } }),
    pi: (v, agentDir = join(user, '.pi', 'agent')) => write(join(agentDir, 'npm', 'node_modules', '@awebai', 'pi', 'package.json'), { name: '@awebai/pi', version: v }),
    listed: (v, row = { runtime_delivery: 'external-session' }) => JSON.stringify(reported(v, { instances: [{ home, ...row }] })),
    check(settings, ctx, extra = {}) {
      const r = spawnSync(process.execPath, [join(module, 'bin/oats-aweb-tasks-binding.mjs'), 'check'], { cwd: module, encoding: 'utf8',
        input: JSON.stringify(request(settings, ctx)), env: env(extra) });
      assert.equal(r.status, 0, r.stderr);
      const doc = JSON.parse(r.stdout);
      assert.equal(doc.ok, true, r.stdout);
      return doc.result;
    },
  };
}
const request = (settings, { home = null, deployment = '/srv/d', soul = 'worker' } = {}) => ({
  schemaVersion: 1, phase: 'check', slot: 'tasks', capability: 'oats.aweb-tasks', settings,
  input: { context: { kind: 'workspace', workspace: 'github.com/acme/agents', deployment, soul, instance: home ? 'worker-1' : null, home }, action: { kind: 'readiness' } },
});
const teamsDoc = (joined = []) => JSON.stringify({ defaultTeam: { label: 'home-team', team: 'home:example.invalid', from: 'workspace' },
  eligible: [{ label: 'shared', team: 'shared:example.invalid', joined: false, from: 'shared' }], joined, left: [], at: '2026-11-03T00:00:00.000Z' });
const JOINED = [{ label: 'shared', team: 'shared:example.invalid', identityHome: '/h/somewhere', receive: 'poll', since: '2026-11-03T00:00:00.000Z' }];
const inspectDoc = (mode) => JSON.stringify({ ok: true, result: { capabilities: [{ id: 'oats.aweb', settings: { identity: { mode } } }] } });
const SOUL_TEAMS = JSON.stringify([
  { label: 'home-team', team: 'home:example.invalid', default: true, from: 'shared', via: 'default' },
  { label: 'shared', team: 'shared:example.invalid', default: false, from: 'shared', via: 'workspace' },
]);
const READY = { status: 'ready', problems: [], warnings: [] };

test('a home reads aw wake status once, from the home, without the check\'s own OATS_* or identity; a soul never runs aw', t => {
  const f = fixture(t);
  f.record({ harness: 'codex' });
  assert.deepEqual(f.check({}, { home: f.home }, { FAKE_WAKE: f.listed('1.36.53') }).warnings, [{ code: 'wake-daemon-outdated', message: DAEMON('1.36.53') }]);
  const calls = f.awCalls();
  assert.equal(calls.length, 1, 'one read per check');
  assert.deepEqual(calls[0], { args: 'wake status --json', cwd: f.home, leaked: '', noUpdate: '1' });
  // A soul: whether its delivery is the broker is not in what the check receives.
  for (const settings of [{}, { team: 'home-team' }]) {
    assert.deepEqual(codes(f.check(settings, { deployment: f.deployment }, { FAKE_WAKE: f.listed('1.36.53'), OATS_TEAMS: SOUL_TEAMS }).warnings).filter((c) => c.endsWith('-outdated')), []);
  }
  assert.equal(f.awCalls().length, 1, 'no aw call at soul scope');
});

test('a home the daemon serves: 1.36.53 and 1.36.54-rc.1 warn beside ready; 1.36.54 and 1.36.55 do not; unreadable adds nothing', t => {
  const f = fixture(t);
  f.record({ harness: 'codex' });
  for (const v of ['1.36.53', '1.36.54-rc.1']) {
    assert.deepEqual(f.check({}, { home: f.home }, { FAKE_WAKE: f.listed(v) }), { status: 'ready', problems: [], warnings: [{ code: 'wake-daemon-outdated', message: DAEMON(v) }] }, v);
  }
  for (const v of ['1.36.54', '1.36.55']) assert.deepEqual(f.check({}, { home: f.home }, { FAKE_WAKE: f.listed(v) }), READY, v);
  for (const [name, answer] of [
    ['not running', JSON.stringify({ daemon_running: false, daemon_version_state: 'not_running', instances: [{ home: f.home }] })],
    ['unknown version', JSON.stringify({ daemon_running: true, daemon_version_state: 'unknown', instances: [{ home: f.home }] })],
    ['not semver', f.listed('1.36')], ['malformed', 'garbage'], ['an array', '[]'], ['aw refuses', 'exit'], ['no aw answer', ''],
    ['not listed', JSON.stringify(reported('1.36.53', { instances: [] }))],
  ]) assert.deepEqual(f.check({}, { home: f.home }, { FAKE_WAKE: answer }), READY, name);
});

test('below AW_MIN only oats.aweb\'s item appears for a listed home, an unlisted home gets no daemon item, and between the floors only this one does', t => {
  const f = fixture(t);
  f.record({ harness: 'codex' });
  // Listed: oats.aweb registered it for the broker and warns itself.
  assert.deepEqual(f.check({}, { home: f.home }, { FAKE_WAKE: f.listed('1.36.31') }), READY);
  assert.deepEqual(codes(f.check({}, { home: f.home }, { FAKE_WAKE: f.listed('1.36.40') }).warnings), ['wake-daemon-outdated']);
  // Not listed: this check reads no daemon floor at all.
  for (const v of ['1.36.31', '1.36.40']) assert.deepEqual(f.check({}, { home: f.home }, { FAKE_WAKE: JSON.stringify(reported(v, { instances: [] })) }), READY, v);
});

test('with team set: a ready answer gains the warning, and a refusal keeps its problems and adds it', t => {
  const f = fixture(t);
  f.record({ harness: 'codex' });
  const outdated = { FAKE_WAKE: f.listed('1.36.53') };
  assert.deepEqual(f.check({ team: 'shared' }, { home: f.home }, { ...outdated, FAKE_TEAMS: teamsDoc(JOINED) }),
    { status: 'ready', problems: [], warnings: [{ code: 'wake-daemon-outdated', message: DAEMON('1.36.53') }] });
  assert.deepEqual(codes(f.check({ team: 'home-team' }, { home: f.home }, { ...outdated, FAKE_TEAMS: teamsDoc() }).warnings), ['team-is-default', 'wake-daemon-outdated']);
  for (const [name, settings, env, status, problems] of [
    ['not joined', { team: 'shared' }, { FAKE_TEAMS: teamsDoc(), FAKE_INSPECT: inspectDoc('local') }, 'needs-configuration', ['team-not-joined']],
    ['unverified', { team: 'shared' }, {}, 'unavailable', ['team-unverified']],
    ['invalid', { team: 'no spaces' }, {}, 'needs-configuration', ['team-invalid']],
  ]) {
    const r = f.check(settings, { home: f.home }, { ...outdated, ...env });
    assert.deepEqual([r.status, codes(r.problems), codes(r.warnings)], [status, problems, ['wake-daemon-outdated']], name);
  }
  // At the floor the team answers are exactly as before.
  assert.deepEqual(f.check({ team: 'shared' }, { home: f.home }, { FAKE_WAKE: f.listed('1.36.54'), FAKE_TEAMS: teamsDoc(JOINED) }), READY);
  assert.equal(f.check({ team: 'shared' }, { home: f.home }, { FAKE_WAKE: f.listed('1.36.54'), FAKE_TEAMS: teamsDoc(), FAKE_INSPECT: inspectDoc('local') }).warnings, undefined);
});

test('a Claude channel home: aweb-channel below 1.8.2 warns, at the floor does not, unreadable adds nothing', t => {
  const f = fixture(t);
  const notListed = { FAKE_WAKE: JSON.stringify(reported('1.36.53', { instances: [] })) };
  f.record({ harness: 'claude' });
  assert.deepEqual(f.check({}, { home: f.home }, notListed), READY, 'no plugin record');
  f.channel('1.8.1');
  assert.deepEqual(f.check({}, { home: f.home }, notListed), { status: 'ready', problems: [], warnings: [{ code: 'aweb-channel-outdated', message: CHANNEL('1.8.1', f.home) }] }, 'the daemon\'s version is not this home\'s');
  assert.deepEqual(codes(f.check({}, { home: f.home }, { FAKE_WAKE: 'exit' }).warnings), ['aweb-channel-outdated'], 'an unreadable status: the recorded channel');
  for (const v of ['1.8.2', '1.9.0']) { f.channel(v); assert.deepEqual(f.check({}, { home: f.home }, notListed), READY, v); }
  f.channel('unknown'); assert.deepEqual(f.check({}, { home: f.home }, notListed), READY, 'unreadable version');
  // The config dir the home launches with.
  const configDir = join(f.dir, 'claude-config');
  f.channel('1.8.2'); f.channel('1.8.0', configDir);
  f.record({ harness: 'claude', launchEnv: { CLAUDE_CONFIG_DIR: configDir } });
  assert.match(f.check({}, { home: f.home }, notListed).warnings[0].message, /installed: 1\.8\.0/);
  f.record({ harness: 'claude', launchEnv: { CLAUDE_CONFIG_DIR: { fromEnv: 'CLAUDE_CONFIG_DIR' } } });
  assert.deepEqual(f.check({}, { home: f.home }, notListed), READY, 'an unknown config dir');
  // A refusal keeps its problems and adds the warning.
  f.channel('1.8.1'); f.record({ harness: 'claude' });
  const refused = f.check({ team: 'shared' }, { home: f.home }, { ...notListed, FAKE_TEAMS: teamsDoc(), FAKE_INSPECT: inspectDoc('local') });
  assert.deepEqual([codes(refused.problems), codes(refused.warnings)], [['team-not-joined'], ['aweb-channel-outdated']]);
});

test('a pi channel home: @awebai/pi below 0.4.1 warns, at the floor does not, unreadable adds nothing; listed, the daemon too', t => {
  const f = fixture(t);
  const notListed = { FAKE_WAKE: JSON.stringify(reported('1.36.53', { instances: [] })) };
  f.record({ harness: 'pi' });
  assert.deepEqual(f.check({}, { home: f.home }, notListed), READY, 'not installed');
  f.pi('0.4.0');
  assert.deepEqual(f.check({}, { home: f.home }, notListed), { status: 'ready', problems: [], warnings: [{ code: 'pi-extension-outdated', message: PI('0.4.0', f.home) }] });
  f.pi('0.4.1'); assert.deepEqual(f.check({}, { home: f.home }, notListed), READY);
  // The pi folder the home launches with.
  f.pi('0.3.15', join(f.user, 'pi-dir'));
  f.record({ harness: 'pi', launchEnv: { PI_CODING_AGENT_DIR: '~/pi-dir' } });
  assert.match(f.check({}, { home: f.home }, notListed).warnings[0].message, /installed: 0\.3\.15/);
  // The kernel's launched harness decides; oats.aweb's runtime is never read.
  f.record({ harness: 'pi', runtime: 'claude' }); f.channel('1.8.2'); f.pi('0.4.0');
  assert.deepEqual(codes(f.check({}, { home: f.home }, notListed).warnings), ['pi-extension-outdated']);
  f.record({ harness: 'claude', runtime: 'pi' }); f.channel('1.8.1'); f.pi('0.4.1');
  assert.deepEqual(codes(f.check({}, { home: f.home }, notListed).warnings), ['aweb-channel-outdated']);
  f.record({ harness: 'pi' }); f.pi('0.3.15', join(f.user, 'pi-dir'));
  f.record({ harness: 'pi', launchEnv: { PI_CODING_AGENT_DIR: '~/pi-dir' } });
  // A pi home the daemon serves for its joined teams: both floors.
  const listed = { FAKE_WAKE: f.listed('1.36.53', { runtime_delivery: 'native-pi' }) };
  assert.deepEqual(codes(f.check({}, { home: f.home }, listed).warnings), ['wake-daemon-outdated', 'pi-extension-outdated']);
});

test('an aw wake status that does not finish in time adds nothing, and the read is bounded by the check\'s budget', t => {
  const f = fixture(t);
  const started = Date.now();
  const status = floors.readWakeStatus({ cwd: f.home, timeout: 300, env: { PATH: `${f.bin}:/usr/bin:/bin`, FAKE_WAKE: 'hang' } });
  assert.equal(status, undefined);
  assert.ok(Date.now() - started < 5000, 'killed at its bound');
  f.record({ harness: 'codex' });
  const timeouts = [];
  const runAw = (cmd, args, options) => { timeouts.push(options.timeout); return { status: 0, stdout: f.listed('1.36.53') }; };
  assert.deepEqual(codes(checkResult(request({}, { home: f.home }), { runAw }).warnings), ['wake-daemon-outdated']);
  assert.equal(timeouts[0], 10_000);
  let clock = 0;
  const slowKernel = (ms) => () => { clock += ms; return { status: 1, stderr: 'slow' }; };
  const env = { OATS_CLI_BIN: '/fake/oats.mjs' };
  const team = request({ team: 'shared' }, { home: f.home });
  checkResult(team, { env, runAw, now: () => clock, run: slowKernel(9_000) });
  assert.equal(timeouts.at(-1), 10_000, '9 s used: still 10 s');
  checkResult(team, { env, runAw, now: () => clock, run: slowKernel(20_000) });
  assert.equal(timeouts.at(-1), 5_000, '20 s used: what is left of 25 s');
  const before = timeouts.length;
  const late = checkResult(team, { env, runAw, now: () => clock, run: slowKernel(24_800) });
  assert.equal(timeouts.length, before, 'no time left: aw is not run');
  assert.deepEqual([late.status, codes(late.problems), late.warnings], ['unavailable', ['team-unverified'], undefined]);
});
