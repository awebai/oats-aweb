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

test('real kernel delivers team from the soul payload to the readiness check, and an absent team changes nothing else', { timeout: 300000 }, t => {
  if (!process.env.OATS_TASKS_KERNEL_ROOT || !process.env.OATS_TASKS_SCRATCH_ROOT) {
    t.skip('requires explicit pinned kernel source and scratch parent'); return;
  }
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
  // "Before": this package with the tasks binding, its commands and the team
  // setting removed, which is oats.aweb-tasks as it was without a check.
  const before = join(base, 'before-package');
  cpSync(fileURLToPath(new URL('../oats-package', import.meta.url)), before, { recursive: true });
  const beforeManifest = join(before, 'capabilities/oats-aweb-tasks/oats.json');
  const { binding, commands, settings, ...older } = JSON.parse(readFileSync(beforeManifest, 'utf8'));
  writeFileSync(beforeManifest, JSON.stringify(older));

  function deployment(name, packageDir) {
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
    writeFileSync(join(dir, 'oats-local.yaml'), JSON.stringify({ schemaVersion: 2, workspace: workspaceRef }));
    const cli = (...args) => spawnSync(process.execPath, [join(kernel, 'bin/oats.mjs'), ...args, '--dir', dir, '--json'], { cwd: dir, env, encoding: 'utf8', timeout: 120000 });
    const synced = cli('sync'); assert.equal(synced.status, 0, synced.stdout + synced.stderr);
    return (soul) => {
      const r = cli('readiness', '--soul', soul);
      const doc = JSON.parse(r.stdout);
      return doc.result ?? doc;
    };
  }
  const tasksItem = (doc) => doc.checks.providers.items.find((i) => i.capability?.id === 'oats.aweb-tasks');

  const after = deployment('after', fileURLToPath(new URL('../oats-package', import.meta.url)));
  const answers = Object.fromEntries(Object.keys(SOULS).map((soul) => [soul, tasksItem(after(soul))]));
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
  assert.deepEqual(answers['worker-global'].result.problems.map((p) => p.code), ['team-global-seat']);
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
