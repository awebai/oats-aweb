// oats.aweb-tasks `team`: the setting, the spawn brief, the inject and skill
// block, and the readiness check against a fake kernel that answers
// `oats aweb teams --json` and `oats inspect … --json`.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { labelProblem, teamSetting } from '../oats-package/capabilities/oats-aweb-tasks/lib/team.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cap = join(root, 'oats-package/capabilities/oats-aweb-tasks');
const read = (path) => readFileSync(join(cap, path), 'utf8');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const DEFAULT_BRIEF = "Tasks: aweb tasks, as your oats.aweb identity in its default team (joined teams: `aw --identity-home <home> task …`). Load /aweb-tasks. If `aw whoami` fails, report it to your human and don't use tasks.";

// A copy of only this module, a fake aw that must never run, and a fake kernel
// whose answers the test chooses: FAKE_TEAMS / FAKE_INSPECT hold the stdout
// document, or "exit" (a refusal) or "garbage" (not JSON).
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'aweb-tasks-team-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home'), bin = join(dir, 'bin'), module = join(dir, 'module'), deployment = join(dir, 'deployment');
  const awCalls = join(dir, 'aw-calls'), kernelCalls = join(dir, 'kernel-calls'), cli = join(dir, 'fake-oats.mjs');
  for (const d of [home, bin, deployment]) mkdirSync(d);
  writeFileSync(join(bin, 'aw'), `#!/bin/sh\necho "$*" >> '${awCalls}'\nexit 97\n`, { mode: 0o755 });
  writeFileSync(cli, `import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const leaked = Object.keys(process.env).filter((k) => k.startsWith('OATS_'));
appendFileSync(${JSON.stringify(kernelCalls)}, JSON.stringify({ args, cwd: process.cwd(), leaked }) + '\\n');
const answer = args[0] === 'aweb' && args[1] === 'teams' ? process.env.FAKE_TEAMS : args[0] === 'inspect' ? process.env.FAKE_INSPECT : undefined;
if (answer === undefined || answer === 'exit') { process.stderr.write('E_FAKE: refused\\n'); process.exit(1); }
process.stdout.write(answer === 'garbage' ? 'not json\\n' : answer + '\\n');
`);
  cpSync(cap, module, { recursive: true });
  const env = (extra = {}) => ({ HOME: home, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, OATS_CLI_BIN: cli, OATS_NODE_BIN: process.execPath, ...extra });
  const kernel = () => existsSync(kernelCalls) ? readFileSync(kernelCalls, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  return {
    home, deployment, kernel, awCalled: () => existsSync(awCalls),
    // A home's readiness reads only the host wake daemon (aweb-tasks-claim-floors.test.mjs).
    awReadsOnlyWakeStatus: () => !existsSync(awCalls) || readFileSync(awCalls, 'utf8').trim().split('\n').every((l) => l === 'wake status --json'),
    spawn(extra = {}) {
      const r = spawnSync(process.execPath, [join(module, 'bin/oats-aweb-tasks.mjs'), 'spawn'], { cwd: module, encoding: 'utf8',
        env: env({ OATS_INSTANCE_HOME: home, OATS_INSTANCE: 'worker-1', OATS_DEFAULT_TEAM: 'home-team', OATS_DEFAULT_TEAM_ID: 'home:example.invalid', ...extra }) });
      assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
    },
    binding(phase, request, extra = {}) {
      const r = spawnSync(process.execPath, [join(module, 'bin/oats-aweb-tasks-binding.mjs'), phase], { cwd: module, encoding: 'utf8',
        input: typeof request === 'string' ? request : JSON.stringify(request), env: env(extra) });
      assert.equal(r.status, 0, r.stderr);
      const lines = r.stdout.trim().split('\n'); assert.equal(lines.length, 1, 'exactly one document');
      return JSON.parse(lines[0]);
    },
  };
}
const request = (settings, { home = null, deployment = '/srv/d', soul = 'worker' } = {}) => ({
  schemaVersion: 1, phase: 'check', slot: 'tasks', capability: 'oats.aweb-tasks', settings,
  input: { context: { kind: 'workspace', workspace: 'github.com/acme/agents', deployment, soul, instance: home ? 'worker-1' : null, home }, action: { kind: 'readiness' } },
});
const teamsDoc = ({ joined = [], eligible = [{ label: 'shared', team: 'shared:example.invalid', joined: false, from: 'shared' }] } = {}) => JSON.stringify({
  defaultTeam: { label: 'home-team', team: 'home:example.invalid', from: 'workspace' }, eligible, joined, left: [], at: '2026-11-03T00:00:00.000Z',
});
const JOINED = [{ label: 'shared', team: 'shared:example.invalid', identityHome: '/h/somewhere', receive: 'poll', since: '2026-11-03T00:00:00.000Z' }];
const inspectDoc = (mode) => JSON.stringify({ ok: true, result: { capabilities: [{ id: 'oats.aweb', settings: { identity: { mode } } }, { id: 'oats.aweb-tasks', settings: {} }] } });
const SOUL_TEAMS = JSON.stringify([
  { label: 'home-team', team: 'home:example.invalid', default: true, from: 'shared', via: 'default' },
  { label: 'shared', team: 'shared:example.invalid', default: false, from: 'shared', via: 'workspace' },
]);
const result = (answer) => {
  assert.deepEqual(Object.keys(answer).sort(), ['capability', 'ok', 'phase', 'result', 'schemaVersion', 'slot']);
  assert.deepEqual([answer.schemaVersion, answer.phase, answer.slot, answer.capability, answer.ok], [1, 'check', 'tasks', 'oats.aweb-tasks', true]);
  return answer.result;
};
const codes = (r) => r.problems.map((p) => p.code);

test('the manifest declares team with a description only, and the smallest binding the kernel accepts', () => {
  const m = JSON.parse(read('oats.json'));
  assert.deepEqual(Object.keys(m.settings), ['team']);
  // committedOnly: a kernel with settings-committed-only takes team from the workspace's or a soul's tasks: only.
  assert.deepEqual(Object.keys(m.settings.team).sort(), ['committedOnly', 'description'], 'no default, and committedOnly is the one flag');
  assert.equal(m.settings.team.committedOnly, true);
  assert.match(m.settings.team.description, /Absent \(the default\) means the home's default team/);
  assert.match(m.settings.team.description, /only in the workspace's or a soul's tasks: payload/);
  assert.deepEqual(m.binding, { version: 1, normalize: 'binding-normalize', bind: 'binding-bind', check: 'binding-check' });
  for (const phase of ['normalize', 'bind', 'check']) assert.equal(m.commands[`binding-${phase}`], `bin/oats-aweb-tasks-binding.mjs ${phase}`);
  assert.equal(m.environment, undefined);
  assert.deepEqual(Object.keys(m.hooks), ['spawn', 'upgrade']);
  assert.equal(typeof m.hooks.spawn, 'string', 'the spawn hook stays not required');
});

test('the schema copy refuses a committedOnly that is not a boolean, or one beside hostOnly', t => {
  const dir = mkdtempSync(join(tmpdir(), 'aweb-tasks-schema-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const path of ['scripts', 'schemas', 'oats-package']) cpSync(join(root, path), join(dir, path), { recursive: true });
  const path = join(dir, 'oats-package/capabilities/oats-aweb-tasks/oats.json'), manifest = JSON.parse(readFileSync(path, 'utf8'));
  const validate = (team) => {
    writeFileSync(path, JSON.stringify({ ...manifest, settings: { team: { ...manifest.settings.team, ...team } } }));
    return spawnSync(process.execPath, [join(dir, 'scripts/validate-manifests.mjs')], { cwd: dir, encoding: 'utf8' }).status;
  };
  assert.equal(validate({}), 0);
  assert.equal(validate({ committedOnly: 'yes' }), 1);
  assert.equal(validate({ hostOnly: true }), 1, 'never hostOnly and committedOnly together');
});

test('a team label follows oats.aweb LABEL_RE, and a refusal names the problem', () => {
  for (const ok of ['a', 'Shared', 'oats', 'team_2', 'x-y', '9', 'a'.repeat(64)]) assert.equal(labelProblem(ok), null, ok);
  for (const [value, problem] of [
    [7, /is a number, not a team label/], [null, /is null, not a team label; remove it/], [['a'], /is a list/], [{}, /is a object/],
    ['', /is empty/], ['a'.repeat(65), /is 65 characters long/], ['-x', /starts with "-"/], ['_x', /starts with "_"/],
    ['a b', /contains " "/], ['a.b', /contains "\."/], ['a/b', /contains "\/"/], ['é', /starts with "é"/],
  ]) assert.match(labelProblem(value), problem, JSON.stringify(value));
  assert.deepEqual(teamSetting({}), { absent: true });
  assert.deepEqual(teamSetting({ other: 1 }), { absent: true });
  assert.deepEqual(teamSetting({ team: 'shared' }), { label: 'shared' });
  assert.match(teamSetting({ team: 'a b' }).problem, /^setting team "a b" contains " "/);
});

test('with team absent the spawn brief is byte-identical to the default brief', t => {
  const f = fixture(t);
  for (const settings of [undefined, '{}', JSON.stringify({ unrelated: true })]) {
    assert.deepEqual(f.spawn(settings === undefined ? {} : { OATS_SETTINGS: settings }), { brief: DEFAULT_BRIEF });
  }
  assert.equal(f.awCalled(), false);
  assert.deepEqual(f.kernel(), []);
});

test('with team set the brief names the label and points at the teams lookup', t => {
  const f = fixture(t);
  const { brief, ...rest } = f.spawn({ OATS_SETTINGS: JSON.stringify({ team: 'shared' }) });
  assert.deepEqual(rest, {});
  assert.match(brief, /^Tasks: aweb tasks in team `shared`, never your default team\./);
  assert.ok(brief.includes('`oats aweb teams --json`'));
  assert.ok(brief.includes('`joined[].identityHome` where `label` is `shared`'));
  assert.ok(brief.includes('`aw --identity-home <identityHome> task|work …`'));
  assert.match(brief, /If `shared` is not joined, report it to your human and don't use tasks\./);
  assert.doesNotMatch(brief, /\.aweb-identity-/);
  // The default team's own label needs no join.
  const own = f.spawn({ OATS_SETTINGS: JSON.stringify({ team: 'home-team' }) }).brief;
  assert.match(own, /^Tasks: aweb tasks in team `home-team`, your default team at spawn: plain `aw task …` and `aw work …`/);
  assert.equal(f.awCalled(), false);
  assert.deepEqual(f.kernel(), [], 'the spawn hook makes no calls');
});

test('an invalid team is refused in the brief, with a warning, and the hook still answers', t => {
  const f = fixture(t);
  for (const [team, problem] of [['a b', /contains " "/], ['', /is empty/], [3, /is a number/]]) {
    const out = f.spawn({ OATS_SETTINGS: JSON.stringify({ team }) });
    assert.match(out.brief, /^Tasks: refused: oats\.aweb-tasks setting team /);
    assert.match(out.brief, problem);
    assert.match(out.brief, /Don't use tasks; report it to your human\.$/);
    assert.match(out.warning, /^oats-aweb-tasks: setting team /);
  }
  assert.match(f.spawn({ OATS_SETTINGS: '{broken' }).brief, /^Tasks: refused: oats\.aweb-tasks the oats\.aweb-tasks settings payload is not an object/);
});

// The one sentence of #186 that changes, in each file: it named the default
// team, and now names the tasks team, which is the default one when `team` is absent.
const SENTENCES = {
  inject: ['using your own oats.aweb identity in the default team; joined teams use their\nexplicit identity home.',
    'using your own oats.aweb identity in the tasks team: the default team, or the\nteam your TASK.md names (Tasks team, below); joined teams use their explicit\nidentity home.'],
  skill: ['with your own oats.aweb identity in\nits default team.',
    'with your own oats.aweb identity in\nthe tasks team: its default team, or the team your TASK.md names ("Tasks\nteam" below).'],
};
const restore = (text, [was, now]) => { assert.equal(text.split(now).length, 2, `the changed sentence appears once: ${now}`); return text.replace(now, was); };
// The paragraph the claim floors add to each file (aweb-tasks-claim-floors.test.mjs).
const HEARTBEAT = 'Your claims stay present only while something heartbeats them: the host\'s\nwake daemon from aw 1.36.54, or on a Claude or pi channel home the aweb-channel\nplugin from 1.8.2 or the aweb pi extension from 0.4.1. If readiness warns\n`wake-daemon-outdated`, `aweb-channel-outdated` or `pi-extension-outdated`,\nreport it to your human.\n\n';
const unheartbeat = (text) => { assert.equal(text.split(HEARTBEAT).length, 2, 'the heartbeat paragraph appears once'); return text.replace(HEARTBEAT, ''); };
// The paragraph the private body files add to the skill (private-body-files.test.mjs).
const PRIVATE_FILES = '\nMake each of these files new and private with `mktemp` (it prints a fresh,\nowner-only path), never a fixed or shared `/tmp` path: other agents and users\non the host share `/tmp`, so a fixed name lets another agent overwrite your\nfile and your task carries its text. `/path/...` below stands for such a path.\n';
const unprivate = (text) => { assert.equal(text.split(PRIVATE_FILES).length, 2, 'the private files paragraph appears once'); return text.replace(PRIVATE_FILES, ''); };

test('the inject and skill add one Tasks team block, the heartbeat and private files paragraphs, change one sentence, and are otherwise the #186 text', () => {
  const inject = unheartbeat(restore(read('injects/aweb-tasks.md'), SENTENCES.inject)), skill = unprivate(unheartbeat(restore(read('skills/aweb-tasks/SKILL.md'), SENTENCES.skill)));
  const injectBlock = inject.slice(inject.indexOf('\n\n**Tasks team.**'));
  assert.ok(injectBlock.startsWith('\n\n**Tasks team.**') && injectBlock.endsWith('never fall back to the default team.\n'));
  assert.equal(sha256(inject.slice(0, -injectBlock.length) + '\n'), '6322e11b18ce1dac51386023b0c3625f051ce78213dda41006cc6f966c252503', 'inject minus the block and with the old sentence is #186');
  const start = skill.indexOf('## Tasks team\n'), end = skill.indexOf('## Find and inspect work\n');
  assert.ok(start > 0 && end > start);
  assert.equal(sha256(skill.slice(0, start) + skill.slice(end)), 'bb9f89dfbf4f0b153532273b427ccfe0604345c9ca8056987156f2576435a000', 'skill minus the section and with the old sentence is #186');
  for (const block of [injectBlock, skill.slice(start, end)]) {
    const text = block.replace(/\*\*/g, '').replace(/\s+/g, ' ');
    assert.ok(text.includes('oats aweb teams --json'), 'names the exact lookup');
    assert.match(text, /instance home/);
    assert.match(text, /`defaultTeam\.label` is that label/);
    assert.match(text, /`joined\[\]\.identityHome`/);
    assert.match(text, /every task and work command/i);
    assert.match(text, /report it to your human and stop/);
    assert.match(text, /[Nn]ever fall back to the default team/);
  }
});

test('nothing oats.aweb-tasks ships builds an identity home from the label', () => {
  for (const path of ['injects/aweb-tasks.md', 'skills/aweb-tasks/SKILL.md', 'bin/oats-aweb-tasks.mjs', 'bin/oats-aweb-tasks-binding.mjs', 'lib/team.mjs', 'lib/binding.mjs', 'oats.json']) {
    assert.doesNotMatch(read(path), /\.aweb-identity-/, path);
  }
});

test('readiness with team absent is ready with nothing else, and reads no kernel', t => {
  const f = fixture(t);
  assert.deepEqual(result(f.binding('check', request({}, {}))), { status: 'ready', problems: [], warnings: [] });
  assert.equal(f.awCalled(), false, 'a soul reads no wake status');
  assert.deepEqual(result(f.binding('check', request({}, { home: f.home }))), { status: 'ready', problems: [], warnings: [] });
  assert.ok(f.awReadsOnlyWakeStatus(), 'a home reads only the host wake daemon');
  assert.deepEqual(f.kernel(), []);
});

test('home readiness reads oats aweb teams from the home and refuses a home that has not joined', t => {
  const f = fixture(t);
  const home = (team, env) => result(f.binding('check', request({ team }, { home: f.home }), env));
  assert.deepEqual(home('shared', { FAKE_TEAMS: teamsDoc({ joined: JOINED }) }), { status: 'ready', problems: [], warnings: [] });
  const teamsCall = f.kernel()[0];
  assert.deepEqual(teamsCall.args, ['aweb', 'teams', '--json']);
  // process.cwd() is a realpath (macOS: /tmp is /private/tmp), so compare realpaths.
  assert.equal(realpathSync(teamsCall.cwd), realpathSync(f.home), 'run from the home');
  assert.deepEqual(teamsCall.leaked, [], "the check's own OATS_* never reach the dispatched command");

  const own = home('home-team', { FAKE_TEAMS: teamsDoc() });
  assert.equal(own.status, 'ready');
  assert.deepEqual(own.warnings.map((w) => w.code), ['team-is-default']);
  assert.match(own.warnings[0].message, /no join is needed: plain `aw task …`/);

  const notJoined = home('shared', { FAKE_TEAMS: teamsDoc(), FAKE_INSPECT: inspectDoc('local') });
  assert.equal(notJoined.status, 'needs-configuration');
  assert.deepEqual(codes(notJoined), ['team-not-joined']);
  assert.ok(notJoined.problems[0].message.includes('`oats aweb join --labels shared` from the home'));
  assert.match(notJoined.problems[0].message, /a GLOBAL seat cannot join teams until #60/);
  assert.ok(notJoined.problems[0].message.includes('`tasks: none`'));

  const global = home('shared', { FAKE_TEAMS: teamsDoc(), FAKE_INSPECT: inspectDoc('global') });
  assert.deepEqual(codes(global), ['team-global-seat']);
  assert.match(global.problems[0].message, /GLOBAL seat: it cannot join teams until #60/);
  assert.ok(global.problems[0].message.includes('`tasks: none`'));
  assert.deepEqual(f.kernel().at(-1).args, ['inspect', '--home', f.home, '--json']);

  // An inspect that fails, or names no mode, never guesses GLOBAL.
  for (const inspect of ['exit', 'garbage', JSON.stringify({ ok: true, result: { capabilities: [] } })]) {
    assert.deepEqual(codes(home('shared', { FAKE_TEAMS: teamsDoc(), FAKE_INSPECT: inspect })), ['team-not-joined']);
  }
  // A joined entry without its identity home is not joined.
  assert.deepEqual(codes(home('shared', { FAKE_TEAMS: teamsDoc({ joined: [{ ...JOINED[0], identityHome: '' }] }), FAKE_INSPECT: inspectDoc('local') })), ['team-not-joined']);

  const other = home('elsewhere', { FAKE_TEAMS: teamsDoc(), FAKE_INSPECT: inspectDoc('local') });
  assert.deepEqual(codes(other), ['team-not-eligible']);
  assert.match(other.problems[0].message, /elsewhere is not one of this home's teams \(home-team, shared\)/);
  assert.ok(f.awReadsOnlyWakeStatus());
});

test('home readiness fails closed when oats aweb teams refuses or answers no document', t => {
  const f = fixture(t);
  for (const teams of ['exit', 'garbage', JSON.stringify({ defaultTeam: null }), JSON.stringify([1])]) {
    const r = result(f.binding('check', request({ team: 'shared' }, { home: f.home }), { FAKE_TEAMS: teams }));
    assert.equal(r.status, 'unavailable', teams);
    assert.deepEqual(codes(r), ['team-unverified']);
    assert.match(r.problems[0].message, /`oats aweb teams --json`/);
  }
  const noCli = result(f.binding('check', request({ team: 'shared' }, { home: f.home }), { OATS_CLI_BIN: '' }));
  assert.equal(noCli.status, 'unavailable');
  assert.match(noCli.problems[0].message, /OATS_CLI_BIN is not set/);
});

test('soul readiness checks the label against the soul teams, and refuses a GLOBAL soul', t => {
  const f = fixture(t);
  const soul = (team, env) => result(f.binding('check', request({ team }, { deployment: f.deployment }), { OATS_TEAMS: SOUL_TEAMS, OATS_DEFAULT_TEAM: 'home-team', ...env }));
  const own = soul('home-team');
  assert.equal(own.status, 'ready');
  assert.deepEqual(own.warnings.map((w) => w.code), ['team-is-default']);
  assert.deepEqual(f.kernel(), [], 'the default label needs no read');

  const eligible = soul('shared', { FAKE_INSPECT: inspectDoc('local') });
  assert.equal(eligible.status, 'ready');
  assert.deepEqual(eligible.warnings.map((w) => w.code), ['team-join-at-spawn']);
  assert.match(eligible.warnings[0].message, /a home must join it: spawn with oats\.aweb `join=shared`/);
  assert.deepEqual(f.kernel().at(-1).args, ['inspect', '--soul', 'worker', '--dir', f.deployment, '--json']);
  // The soul's stable id names it, so another soul of the same bare name cannot make it ambiguous.
  soul('shared', { FAKE_INSPECT: inspectDoc('local'), OATS_SOUL_ID: 'package:oats.aweb#worker' });
  assert.deepEqual(f.kernel().at(-1).args.slice(0, 3), ['inspect', '--soul', 'oats.aweb/worker']);
  soul('shared', { FAKE_INSPECT: inspectDoc('local'), OATS_SOUL_ID: 'github.com/acme/agents#worker' });
  assert.deepEqual(f.kernel().at(-1).args.slice(0, 3), ['inspect', '--soul', 'github.com/acme/agents/worker']);
  // A mode the kernel cannot show is neither GLOBAL nor ready.
  for (const inspect of ['exit', 'garbage', JSON.stringify({ ok: true, result: { capabilities: [] } })]) {
    const unread = soul('shared', { FAKE_INSPECT: inspect });
    assert.equal(unread.status, 'unavailable', inspect);
    assert.deepEqual(codes(unread), ['team-unverified']);
    assert.match(unread.problems[0].message, /identity mode cannot be read, and a GLOBAL seat cannot join teams until #60/);
  }

  const global = soul('shared', { FAKE_INSPECT: inspectDoc('global') });
  assert.deepEqual(codes(global), ['team-global-seat']);
  assert.match(global.problems[0].message, /this soul is a GLOBAL seat/);

  const other = soul('elsewhere');
  assert.deepEqual(codes(other), ['team-not-eligible']);
  assert.match(other.problems[0].message, /\(home-team, shared\)/);

  const unknown = result(f.binding('check', request({ team: 'shared' }), {}));
  assert.equal(unknown.status, 'unavailable');
  assert.deepEqual(codes(unknown), ['team-unverified']);
});

test('readiness refuses an invalid team and names its problem', t => {
  const f = fixture(t);
  for (const ctx of [{ home: f.home }, {}]) {
    const r = result(f.binding('check', request({ team: 'no spaces' }, ctx)));
    assert.equal(r.status, 'needs-configuration');
    assert.deepEqual(codes(r), ['team-invalid']);
    assert.match(r.problems[0].message, /^oats\.aweb-tasks setting team "no spaces" contains " "/);
  }
  assert.deepEqual(f.kernel(), []);
});

test('the binding wire refuses normalize, bind and a malformed request', t => {
  const f = fixture(t);
  for (const phase of ['normalize', 'bind']) {
    assert.deepEqual(f.binding(phase, '{}'), { schemaVersion: 1, phase, slot: 'tasks', capability: 'oats.aweb-tasks', ok: false,
      error: { code: 'provider-not-qualified', message: `oats.aweb-tasks answers only the readiness check, not ${phase}` } });
  }
  for (const bad of ['not json', { ...request({}), extra: 1 }, { ...request({}), slot: 'messaging' }, { ...request({}), settings: [] }]) {
    const answer = f.binding('check', bad);
    assert.equal(answer.ok, false);
    assert.equal(answer.error.code, 'invalid-binding');
    assert.equal(answer.phase, 'check');
  }
  assert.equal(f.binding('other', '{}').error.code, 'invalid-binding');
});
