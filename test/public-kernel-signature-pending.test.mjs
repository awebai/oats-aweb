// A8 against the pinned public kernel (README, "Human attribution"): a mint that aw
// stops as native_agent_signature_pending fails the spawn, and the kernel's
// compensation retire answers `retired: false, reason: "signature-pending"`, so the
// kernel keeps the home (its .oats-rollback-incomplete.json) with aw's key and pending
// mint in it. Once aw settles that mint (its pending files gone), a plain `oats retire`
// clears the home. The fake aw stands in for aw's stop (test/helpers/fake-aw-setup.mjs,
// AW_SIGNATURE_PENDING); the kernel is real. Opt-in locally, REQUIRED in CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeAwSetupPath } from './helpers/fake-aw-setup.mjs';

const PINNED = '7512163012876511088da79168c74540f9523c66'; // OATS v0.70.0 release pin
const packageRoot = fileURLToPath(new URL('../oats-package', import.meta.url));
const kernel = process.env.OATS_HOST_ONLY_KERNEL_ROOT;
if (process.env.OATS_HOST_ONLY_REQUIRED === '1') assert.ok(kernel, 'required signature-pending test needs OATS_HOST_ONLY_KERNEL_ROOT');

function deployment(t) {
  assert.equal(execFileSync('git', ['-C', kernel, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), PINNED);
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'public-signature-pending-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const host = join(base, 'source'), dep = join(base, 'deployment'), privateHome = join(base, 'home');
  const root = join(dep, '.aweb-roots', 'default');
  for (const dir of [join(host, 'souls', 'probe'), join(dep, 'agents'), join(root, '.aw'), privateHome]) mkdirSync(dir, { recursive: true });
  const fake = fakeAwSetupPath(t);
  writeFileSync(join(fake.path, 'codex'), '#!/bin/sh\necho unexpected-harness-launch >&2\nexit 99\n', { mode: 0o755 });
  const env = { PATH: `${fake.path}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: privateHome, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', OATS_REMOTE_CACHE: join(base, 'cache'), AW_NO_UPDATE_CHECK: '1', AW_FAKE_KEYS: '1', AW_SIGNATURE_PENDING: 'code', AW_FAKE_VERSION: '1.36.59', FAKE_JOIN_FROM_REGISTRY: join(base, 'registry.json') };
  const git = (...args) => execFileSync('git', ['-C', host, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { env, encoding: 'utf8' }).trim();
  const ref = pathToFileURL(host).href;
  writeFileSync(join(host, 'oats-workspace.yaml'), `schemaVersion: 2\nname: fixture\nmembers:\n  - ${ref}\nteams:\n  default: { team: 'default:example.invalid' }\ndefaultTeam: default\nlocalTeams: true\ndefaults:\n  messaging:\n    oats.aweb: { from: local/${host} }\n`);
  writeFileSync(join(host, 'oats-membership.yaml'), `schemaVersion: 2\nworkspace: ${ref}\n`);
  writeFileSync(join(host, 'souls/probe/soul.yaml'), 'schemaVersion: 2\nname: probe\ndescription: probe\nwork: directory\n');
  writeFileSync(join(host, 'souls/probe/AGENTS.md'), 'Fixture only.\n');
  cpSync(join(packageRoot, 'capabilities', 'oats-aweb'), join(host, 'capabilities', 'oats-aweb'), { recursive: true });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'isolated fixture');
  writeFileSync(join(dep, 'oats-local.yaml'), `schemaVersion: 2\nworkspace: ${ref}\nsettings:\n  oats.aweb:\n    root: ${root}\n`);
  writeFileSync(join(root, '.aw', 'teams.json'), '{"memberships":[{"team_id":"default:example.invalid"}]}');
  const oats = (args, extra = {}) => spawnSync(process.execPath, [join(kernel, 'bin/oats.mjs'), ...args, '--dir', dep, '--json'], { cwd: dep, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60000 });
  return { dep, fake, oats };
}

function homesNamed(dir, name, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.name === name && existsSync(join(path, 'instance.json'))) out.push(path);
    else homesNamed(path, name, out);
  }
  return out;
}

test('A8: a signature-pending mint fails the spawn, the kernel keeps its home, and a retire after aw settles it clears it', { skip: !kernel && 'requires the pinned public kernel checkout', timeout: 180000 }, (t) => {
  const f = deployment(t);
  const spawned = f.oats(['spawn', 'probe', '--name', 'pending-probe', '--no-launch', '--harness', 'codex', '--provider', 'oats.aweb', 'delivery=session']);
  assert.notEqual(spawned.status, 0, 'the spawn fails');
  assert.match(spawned.stdout + spawned.stderr, /signature-pending/);
  const [home] = homesNamed(join(f.dep, 'agents'), 'pending-probe');
  assert.ok(home, `the kernel kept the home: ${spawned.stdout}${spawned.stderr}`);
  assert.ok(existsSync(join(home, '.oats-rollback-incomplete.json')), 'kept as an incomplete rollback');
  for (const kept of ['signing.key', 'hosted-invite-creation.json', 'pending-hosted-accept']) assert.ok(existsSync(join(home, '.aw', kept)), `aw's ${kept} kept`);

  // While aw holds the mint, a retire keeps the home again.
  const held = f.oats(['retire', 'pending-probe']);
  assert.ok(existsSync(join(home, '.aw', 'signing.key')), `${held.stdout}${held.stderr}`);

  // aw settles it: a plain retire clears the home.
  for (const settled of ['hosted-invite-creation.json', 'pending-hosted-accept']) rmSync(join(home, '.aw', settled));
  const cleared = f.oats(['retire', 'pending-probe']);
  assert.equal(cleared.status, 0, cleared.stdout + cleared.stderr);
  assert.equal(existsSync(home), false, 'the home is gone');
});
