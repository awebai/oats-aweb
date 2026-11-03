// Opt-in real-kernel integration of the oats.aweb-tasks `team` setting, given
// through a soul's `tasks:` payload, the way the workspace's or a soul's
// payload delivers it. All repos, HOME and caches stay in the explicitly
// supplied scratch directory; no real deployment or aw is used.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const SOULS = {
  worker: undefined,                    // no team: today's behaviour
  'worker-shared': { team: 'shared' },  // an eligible team
  'worker-home': { team: 'home' },      // the default team's own label
  'worker-other': { team: 'elsewhere' },
  'worker-bad': { team: 'no spaces' },
  'worker-global': { team: 'shared' },  // with a GLOBAL oats.aweb identity
};
const MESSAGING = { 'worker-global': { identity: { mode: 'global', resident: 'fixture-resident' } } };

const skipReason = () => (!process.env.OATS_TASKS_KERNEL_ROOT || !process.env.OATS_TASKS_SCRATCH_ROOT ? 'requires explicit pinned kernel source and scratch parent' : null);

/** An isolated workspace, package and deployment on the kernel the caller names. */
function kernelFixture(t) {
  const kernel = resolve(process.env.OATS_TASKS_KERNEL_ROOT);
  const base = realpathSync(mkdtempSync(join(process.env.OATS_TASKS_SCRATCH_ROOT, 'aweb-tasks-team-kernel-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'), bin = join(base, 'bin'), marker = join(base, 'aw-called');
  mkdirSync(home); mkdirSync(bin);
  writeFileSync(join(bin, 'aw'), `#!/bin/sh\necho called >> '${marker}'\nexit 97\n`, { mode: 0o755 });
  const env = { HOME: home, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    OATS_REMOTE_CACHE: join(base, 'cache'), OATS_HOME_DIR: join(base, 'data'),
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  const git = (cwd, ...args) => {
    const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { cwd, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  // Its own Git boundary keeps kernel deployment lookup off any enclosing repo.
  git(base, 'init', '-q', '--initial-branch=fixture');
  function remote(name, files, payload) {
    const seed = join(base, `${name}-seed`), bare = join(base, `${name}.git`);
    mkdirSync(seed); git(seed, 'init', '-q', '--initial-branch=main');
    for (const [path, value] of Object.entries(files)) {
      mkdirSync(dirname(join(seed, path)), { recursive: true });
      writeFileSync(join(seed, path), typeof value === 'string' ? value : JSON.stringify(value));
    }
    if (payload) cpSync(payload, join(seed, 'oats-package'), { recursive: true });
    git(seed, 'add', '.'); git(seed, 'commit', '-qm', 'isolated fixture');
    git(base, 'clone', '-q', '--bare', seed, bare);
    git(bare, 'config', 'uploadpack.allowFilter', 'true');
    git(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    return pathToFileURL(bare).href;
  }
  // Each package copy also ships a GLOBAL soul named like the member soul
  // worker-global, so that bare name is ambiguous: the check must still name
  // the soul it was asked about (OATS_SOUL_ID), never read an unknown mode as
  // ready, and refuse both.
  function packageCopy(name) {
    const dir = join(base, name);
    cpSync(fileURLToPath(new URL('../oats-package', import.meta.url)), dir, { recursive: true });
    const index = join(dir, 'oats-package.json'), pkg = JSON.parse(readFileSync(index, 'utf8'));
    writeFileSync(index, JSON.stringify({ ...pkg, souls: [...(pkg.souls || []), 'souls/worker-global'] }));
    mkdirSync(join(dir, 'souls/worker-global'), { recursive: true });
    writeFileSync(join(dir, 'souls/worker-global/soul.yaml'), JSON.stringify({ schemaVersion: 2, name: 'worker-global', description: 'inert fixture', work: 'directory',
      tasks: { team: 'shared' }, messaging: MESSAGING['worker-global'] }));
    writeFileSync(join(dir, 'souls/worker-global/AGENTS.md'), '# Inert fixture\n');
    return dir;
  }
  function deployment(name, packageDir, { local = {} } = {}) {
    const packageRef = remote(`${name}-package`, {}, packageDir);
    const packageCommit = git(base, '--git-dir', fileURLToPath(packageRef), 'rev-parse', 'HEAD');
    const workspaceRef = pathToFileURL(join(base, `${name}-workspace.git`)).href;
    const files = {
      'oats-workspace.yaml': {
        schemaVersion: 2, name: 'aweb-tasks-team-fixture', members: [workspaceRef],
        packages: { 'oats.aweb': `git:${packageRef}@${packageCommit}` },
        teams: { home: { team: 'home:example.invalid' }, shared: { team: 'shared:example.invalid' } },
        defaultTeam: 'home', souls: { '*': { teams: ['shared'] } },
        defaults: { knowledge: 'none', messaging: { 'oats.aweb': { from: 'package' } }, tasks: { 'oats.aweb-tasks': { from: 'package' } } },
      },
      'oats-membership.yaml': { schemaVersion: 2, workspace: workspaceRef },
    };
    for (const [soul, payload] of Object.entries(SOULS)) {
      files[`souls/${soul}/soul.yaml`] = { schemaVersion: 2, name: soul, description: 'inert fixture', work: 'directory', ...(payload ? { tasks: payload } : {}), ...(MESSAGING[soul] ? { messaging: MESSAGING[soul] } : {}) };
      files[`souls/${soul}/AGENTS.md`] = '# Inert fixture\n';
    }
    remote(`${name}-workspace`, files);
    const dir = join(base, `${name}-deployment`); mkdirSync(dir);
    git(base, 'clone', '-q', fileURLToPath(workspaceRef), join(dir, 'workspace'));
    writeFileSync(join(dir, 'oats-local.yaml'), JSON.stringify({ schemaVersion: 2, workspace: workspaceRef, ...local }));
    const cli = (...args) => spawnSync(process.execPath, [join(kernel, 'bin/oats.mjs'), ...args, '--dir', dir, '--json'], { cwd: dir, env, encoding: 'utf8', timeout: 120000 });
    const synced = cli('sync'); assert.equal(synced.status, 0, synced.stdout + synced.stderr);
    const readiness = (soul) => {
      const r = cli('readiness', '--soul', soul);
      const doc = JSON.parse(r.stdout);
      return doc.result ?? doc;
    };
    return Object.assign(readiness, { cli });
  }
  return { kernel, env, packageCopy, deployment };
}

test('real kernel delivers team from the soul payload to the readiness check, and an absent team changes nothing else', { timeout: 300000 }, t => {
  if (skipReason()) { t.skip(skipReason()); return; }
  const { packageCopy, deployment } = kernelFixture(t);
  // "Before": this package with the tasks binding, its commands and the team
  // setting removed, which is oats.aweb-tasks as it was without a check.
  const before = packageCopy('before-package');
  const beforeManifest = join(before, 'capabilities/oats-aweb-tasks/oats.json');
  const { binding, commands, settings, ...older } = JSON.parse(readFileSync(beforeManifest, 'utf8'));
  writeFileSync(beforeManifest, JSON.stringify(older));
  const tasksItem = (doc) => doc.checks.providers.items.find((i) => i.capability?.id === 'oats.aweb-tasks');

  const after = deployment('after', packageCopy('after-package'));
  const answers = Object.fromEntries([...Object.keys(SOULS).filter((soul) => soul !== 'worker-global'), 'oats.aweb/worker-global', 'after-workspace/worker-global']
    .map((soul) => [soul, tasksItem(after(soul))]));
  t.diagnostic(`oats.aweb-tasks items: ${JSON.stringify(answers)}`);
  assert.deepEqual(answers.worker.result, { status: 'ready', problems: [], warnings: [] });
  assert.equal(answers.worker.status, 'pass');
  assert.equal(answers['worker-shared'].status, 'pass');
  assert.deepEqual(answers['worker-shared'].result.warnings.map((w) => w.code), ['team-join-at-spawn']);
  assert.deepEqual(answers['worker-home'].result.warnings.map((w) => w.code), ['team-is-default']);
  assert.equal(answers['worker-other'].status, 'fail');
  assert.deepEqual(answers['worker-other'].result.problems.map((p) => p.code), ['team-not-eligible']);
  assert.equal(answers['worker-bad'].status, 'fail');
  assert.deepEqual(answers['worker-bad'].result.problems.map((p) => p.code), ['team-invalid']);
  for (const soul of ['oats.aweb/worker-global', 'after-workspace/worker-global']) {
    assert.deepEqual(answers[soul].result.problems.map((p) => p.code), ['team-global-seat'], `${soul}: a qualified soul is inspected by its own name`);
  }
  assert.match(answers['worker-bad'].reason, /setting team "no spaces" contains " "/);

  // An absent team: the one passing item is all the check adds.
  const was = deployment('before', before)('worker'), now = after('worker');
  assert.equal(tasksItem(was), undefined, 'the stripped package has no check');
  const shape = (doc) => ({
    ready: doc.summary.ready, fail: doc.summary.fail, unknown: doc.summary.unknown,
    statuses: Object.fromEntries(Object.entries(doc.checks).map(([k, c]) => [k, c.status])),
    byCapability: doc.summary.byCapability.map(({ capability, ready, ownReady }) => ({ id: capability.id, ready, ownReady })),
    subjectBlockers: doc.summary.subjectBlockers, warnings: doc.warnings,
    otherProviders: doc.checks.providers.items.filter((i) => i.capability?.id !== 'oats.aweb-tasks').map((i) => i.status),
  });
  assert.deepEqual(shape(now), shape(was));
  assert.equal(now.summary.required, was.summary.required + 1);
  assert.equal(now.summary.pass, was.summary.pass + 1);
});

// team is committedOnly: a kernel with settings-committed-only refuses it from
// oats-local.yaml and from --provider. An earlier kernel ignores the flag.
test('a kernel with settings-committed-only refuses team from oats-local.yaml and from --provider', { timeout: 300000 }, t => {
  if (skipReason()) { t.skip(skipReason()); return; }
  const { kernel, env, packageCopy, deployment } = kernelFixture(t);
  const version = spawnSync(process.execPath, [join(kernel, 'bin/oats.mjs'), 'version', '--json'], { env, encoding: 'utf8' });
  if (!JSON.parse(version.stdout).features?.includes('settings-committed-only')) { t.skip('the kernel does not list settings-committed-only'); return; }
  const refused = (r, layer, at) => {
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const { error } = JSON.parse(r.stdout);
    assert.equal(error.code, 'E_WORKSPACE_SCHEMA');
    assert.deepEqual({ reason: error.details.reason, capability: error.details.capability, key: error.details.key, layer: error.details.layer, at: error.details.at },
      { reason: 'committed-only-key', capability: 'oats.aweb-tasks', key: 'team', layer, at });
  };
  const preview = ['spawn', 'worker', '--preview', '--work', 'directory', '--harness', 'codex', '--launch-config', 'none'];
  const local = deployment('local', packageCopy('local-package'), { local: { settings: { 'oats.aweb-tasks': { team: 'shared' } } } });
  refused(local.cli('readiness', '--soul', 'worker'), 'host', 'oats-local.yaml#/settings/oats.aweb-tasks');
  refused(local.cli(...preview), 'host', 'oats-local.yaml#/settings/oats.aweb-tasks');
  const plain = deployment('plain', packageCopy('plain-package'));
  refused(plain.cli(...preview, '--provider', 'oats.aweb-tasks', 'team=shared'), 'spawn', '--provider oats.aweb-tasks');
  const fromSoul = plain.cli('spawn', 'worker-shared', '--preview', '--work', 'directory', '--harness', 'codex', '--launch-config', 'none');
  assert.equal(fromSoul.status, 0, `a soul's tasks: payload is committed: ${fromSoul.stdout}${fromSoul.stderr}`);
});
