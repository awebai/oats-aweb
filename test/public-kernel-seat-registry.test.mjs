// The oldest admitted kernel, the pinned public 0.42.0 (bb2ba8c9), takes this
// manifest, with AWID_REGISTRY_URL declared under the AWID_ namespace, and a
// GLOBAL seat's spawn hook output that sets it: the capability lists, the
// spawn previews, and a --no-launch scaffold records the resident's registry in
// its hook environment. aw is the fake of helpers/fake-aw-grant.mjs; the
// resident's identity.yaml is the real aw 1.36.33 one in
// test/fixtures/resident. Opt-in locally, REQUIRED in CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeAw } from './helpers/fake-aw-grant.mjs';

const capability = fileURLToPath(new URL('../oats-package/capabilities/oats-aweb', import.meta.url));
const identity = fileURLToPath(new URL('./fixtures/resident/identity-global.yaml', import.meta.url));
const kernel = process.env.OATS_HOST_ONLY_KERNEL_ROOT;
const OPS = 'status.v1,sign_plain_message.v1,sign_app_request.v1,grant_never_ttl.v1,create_e2ee_envelope.v1,unwrap_e2ee_message.v1,mail_reply_continuation.v1';

test('the 0.42.0 kernel admits the AWID_ namespace and a grant seat that carries its resident\'s registry', { timeout: 180000 }, (t) => {
  if (!kernel) { if (process.env.OATS_HOST_ONLY_REQUIRED === '1') assert.fail('pinned kernel required'); t.skip('requires pinned bb2ba8c public kernel checkout'); return; }
  assert.equal(execFileSync('git', ['-C', kernel, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), 'bb2ba8c9a254edb745913b9c5a9d9b833fda932d');
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'public-seat-registry-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = fakeAw(base);
  // An inert harness for the spawn preflight; --no-launch never runs it.
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\necho unexpected-harness-launch >&2\nexit 99\n', { mode: 0o755 });
  const host = join(base, 'source'), dep = join(base, 'deploy'), custody = join(base, 'custody', 'merlin'), home = join(base, 'home');
  for (const d of [join(host, 'souls', 'probe'), join(dep, 'agents'), join(custody, '.aw'), home]) mkdirSync(d, { recursive: true });
  writeFileSync(join(custody, '.aw', 'identity.yaml'), readFileSync(identity));
  const env = { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', OATS_REMOTE_CACHE: join(base, 'cache'), AW_NO_UPDATE_CHECK: '1', FAKE_CUSTODY_OPS: OPS, AWID_REGISTRY_URL: 'http://operator-registry.invalid:9' };
  const ref = pathToFileURL(host).href;
  writeFileSync(join(host, 'oats-workspace.yaml'), `schemaVersion: 2\nname: fixture\nmembers:\n  - ${ref}\nteams:\n  default: { team: 't:example.test' }\ndefaultTeam: default\nlocalTeams: true\ndefaults:\n  messaging:\n    oats.aweb: { from: local/${host} }\n`);
  writeFileSync(join(host, 'oats-membership.yaml'), `schemaVersion: 2\nworkspace: ${ref}\n`);
  writeFileSync(join(host, 'souls/probe/soul.yaml'), 'schemaVersion: 2\nname: probe\ndescription: probe\nwork: directory\n');
  writeFileSync(join(host, 'souls/probe/AGENTS.md'), 'Fixture only.\n');
  cpSync(capability, join(host, 'capabilities', 'oats-aweb'), { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', host, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { env, encoding: 'utf8' });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'isolated fixture');
  writeFileSync(join(dep, 'oats-local.yaml'), `schemaVersion: 2\nworkspace: ${ref}\nsettings:\n  oats.aweb:\n    delivery: session\n    residents:\n      merlin: ${custody}\n`);
  const oats = (args) => {
    const r = spawnSync(process.execPath, [join(kernel, 'bin/oats.mjs'), ...args, '--dir', dep, '--json'], { cwd: dep, env, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, `oats ${args.join(' ')}: ${r.stdout}${r.stderr}`);
    return JSON.parse(r.stdout);
  };
  const listed = oats(['capabilities']).result.capabilities.find((c) => c.name === 'oats.aweb');
  assert.ok(listed, 'the 0.42.0 kernel lists oats.aweb');
  const seat = ['spawn', 'probe', '--harness', 'codex', '--provider', 'oats.aweb', 'identity.mode=global', '--provider', 'oats.aweb', 'identity.resident=merlin'];
  assert.equal(oats([...seat, '--preview']).ok, true);
  const { instance, home: seatHome } = oats([...seat, '--no-launch']).result;
  const record = JSON.parse(readFileSync(join(seatHome, 'instance.json'), 'utf8'));
  assert.equal(record.capabilityMeta['oats.aweb'].identity.mode, 'global');
  assert.equal(record.launch.hooks.env.AWID_REGISTRY_URL, 'http://127.0.0.1:52519');
  oats(['retire', instance]);
});
