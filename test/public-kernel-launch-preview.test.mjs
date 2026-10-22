// The start preview against a pinned public kernel: a Claude home spawned in
// development mode under delivery: channel, then `oats launch-config preview`.
// The kernel runs launchPreview-aware launch hooks under OATS_LAUNCH_PREVIEW=1
// and projects their warnings into the preview (OATS 0.44.0 and later), so the
// decision statement reaches it. `oats spawn --preview` runs no provider hook
// (oats#912), so it is not exercised here. Opt-in locally, REQUIRED in CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeAwSetupPath } from './helpers/fake-aw-setup.mjs';

const packageRoot = fileURLToPath(new URL('../oats-package', import.meta.url));
const PINNED = '593255d945c9039860cfa986f4192499e73cd12f'; // upgrade review pin; source version 0.67.1 until the release pin
const kernel = process.env.OATS_PREVIEW_KERNEL_ROOT;
if (process.env.OATS_PREVIEW_KERNEL_REQUIRED === '1') assert.ok(kernel, 'required launch-preview test needs OATS_PREVIEW_KERNEL_ROOT');
const DEV_FLAG = '--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace';
const DECISION = "oats-aweb: channel-dev-confirmation — Claude's development-channel prompt: OATS confirms this prompt at launch; `settings.oats.aweb.delivery: session` or `settings.oats.aweb.claudeChannelMode: approved` stop it.";
// A spawn's hook cannot see its launch's Claude config dir, and a spawn's own
// launch runs no launch hook, so every Claude channel spawn says so.
const CACHE_UNCHECKED = "oats-aweb: channel-cache-unchecked — a spawn does not know its launch's Claude config dir, so Claude's MCP failure cache was not checked; if Claude skips the channel, readiness reports channel-not-connected";
// The provider joins its warnings into one line with ' | '.
const statements = (warnings) => (warnings ?? []).flatMap((w) => w.split(' | '));

// A deployment whose `probe` soul (work: directory) activates oats.aweb from a
// local git member, with the host-only mode set in oats-local.yaml. The inert
// `claude` answers only the kernel's plugin query, so the channel requirement
// is met; nothing launches it.
function deployment(t, mode) {
  assert.equal(execFileSync('git', ['-C', kernel, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), PINNED);
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'public-launch-preview-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const host = join(base, 'source'), dep = join(base, 'deployment'), privateHome = join(base, 'home');
  const root = join(dep, '.aweb-roots', 'default');
  for (const dir of [join(host, 'souls', 'probe'), join(dep, 'agents'), join(root, '.aw'), privateHome]) mkdirSync(dir, { recursive: true });
  const fake = fakeAwSetupPath(t);
  writeFileSync(join(fake.path, 'claude'), `#!/bin/sh\nif [ "$1 $2 $3" = "plugin list --json" ]; then echo '[{"id":"aweb-channel@awebai-marketplace","scope":"user","enabled":true}]'; exit 0; fi\necho unexpected-harness-launch >&2\nexit 99\n`, { mode: 0o755 });
  const env = { PATH: `${fake.path}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: privateHome, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', OATS_REMOTE_CACHE: join(base, 'cache'), AW_NO_UPDATE_CHECK: '1', AW_FAKE_KEYS: '1' };
  const git = (...args) => execFileSync('git', ['-C', host, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { env, encoding: 'utf8' }).trim();
  const ref = pathToFileURL(host).href;
  writeFileSync(join(host, 'oats-workspace.yaml'), `schemaVersion: 2\nname: fixture\nmembers:\n  - ${ref}\nteams:\n  default: { team: 'default:example.invalid' }\ndefaultTeam: default\nlocalTeams: true\ndefaults:\n  messaging:\n    oats.aweb: { from: local/${host} }\n`);
  writeFileSync(join(host, 'oats-membership.yaml'), `schemaVersion: 2\nworkspace: ${ref}\n`);
  writeFileSync(join(host, 'souls/probe/soul.yaml'), 'schemaVersion: 2\nname: probe\ndescription: probe\nwork: directory\n');
  writeFileSync(join(host, 'souls/probe/AGENTS.md'), 'Fixture only.\n');
  cpSync(join(packageRoot, 'capabilities', 'oats-aweb'), join(host, 'capabilities', 'oats-aweb'), { recursive: true });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'isolated fixture');
  writeFileSync(join(dep, 'oats-local.yaml'), `schemaVersion: 2\nworkspace: ${ref}\nsettings:\n  oats.aweb:\n    root: ${root}\n    claudeChannelMode: ${mode}\n`);
  writeFileSync(join(root, '.aw', 'teams.json'), '{"memberships":[{"team_id":"default:example.invalid"}]}');
  const oats = (args) => {
    const r = spawnSync(process.execPath, [join(kernel, 'bin/oats.mjs'), ...args, '--json'], { cwd: dep, env, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const doc = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.equal(doc.ok, true, r.stdout);
    return doc.result;
  };
  return { dep, oats };
}

test('the start preview of a development Claude home carries the decision statement', { skip: !kernel && 'requires pinned upgrade-contract public kernel checkout', timeout: 180000 }, (t) => {
  const f = deployment(t, 'development');
  const spawned = f.oats(['spawn', 'probe', '--name', 'dev-probe', '--no-launch', '--harness', 'claude', '--dir', f.dep]);
  assert.ok(statements(spawned.warnings).includes(DECISION), JSON.stringify(spawned.warnings));
  assert.ok(statements(spawned.warnings).includes(CACHE_UNCHECKED), JSON.stringify(spawned.warnings));
  const preview = f.oats(['launch-config', 'preview', '--home', spawned.home]);
  assert.deepEqual(preview.argv.slice(0, 2), DEV_FLAG.split(' '));
  assert.ok(preview.preflight.some((c) => c.check === 'capabilities' && /refreshed by launch hooks: oats\.aweb/.test(c.detail)), JSON.stringify(preview.preflight));
  // Kernels carrying oats#886 add their own launch-prompt line beside it.
  assert.equal(statements(preview.warnings).filter((w) => w === DECISION).length, 1, JSON.stringify(preview.warnings));
  // The preview is the launch hook's preview pass: it reads and clears no cache.
  assert.doesNotMatch(JSON.stringify(preview.warnings ?? []), /channel-cache-|channel-failure-cleared/);
});

test('the start preview of an approved Claude home carries no decision statement', { skip: !kernel && 'requires pinned upgrade-contract public kernel checkout', timeout: 180000 }, (t) => {
  const f = deployment(t, 'approved');
  const spawned = f.oats(['spawn', 'probe', '--name', 'approved-probe', '--no-launch', '--harness', 'claude', '--dir', f.dep]);
  const preview = f.oats(['launch-config', 'preview', '--home', spawned.home]);
  assert.deepEqual(preview.argv.slice(0, 2), ['--channels', 'plugin:aweb-channel@awebai-marketplace']);
  assert.doesNotMatch(JSON.stringify(preview.warnings ?? []), /channel-dev-confirmation/);
});
