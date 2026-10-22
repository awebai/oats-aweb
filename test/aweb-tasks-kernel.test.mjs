// Opt-in real-kernel integration. All repos, HOME and caches stay in the
// explicitly supplied scratch directory; no real deployment or aw is used.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

test('real kernel selects messaging and tasks together with no catalog alias', { timeout: 120000 }, t => {
  if (!process.env.OATS_TASKS_KERNEL_ROOT || !process.env.OATS_TASKS_SCRATCH_ROOT) {
    t.skip('requires explicit pinned kernel source and scratch parent'); return;
  }
  const kernel = resolve(process.env.OATS_TASKS_KERNEL_ROOT);
  const base = realpathSync(mkdtempSync(join(process.env.OATS_TASKS_SCRATCH_ROOT, 'aweb-tasks-kernel-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'), bin = join(base, 'bin'), marker = join(base, 'aw-called');
  mkdirSync(home); mkdirSync(bin);
  writeFileSync(join(bin, 'aw'), `#!/bin/sh\necho called >> '${marker}'\nexit 97\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
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
  // The scratch parent may be a linked worktree. Its own Git boundary keeps
  // kernel canonical-deployment lookup from mapping fixtures to that repo's
  // primary checkout and inheriting the real deployment's launch settings.
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
  const packageRef = remote('package', {}, fileURLToPath(new URL('../oats-package', import.meta.url)));
  const packageCommit = git(base, '--git-dir', fileURLToPath(packageRef), 'rev-parse', 'HEAD');
  const workspaceRef = pathToFileURL(join(base, 'workspace.git')).href;
  const workspace = {
    schemaVersion: 2, name: 'aweb-tasks-fixture', members: [workspaceRef],
    packages: { 'oats.aweb': `git:${packageRef}@${packageCommit}` },
    defaults: { knowledge: 'none', messaging: { 'oats.aweb': { from: 'package' } }, tasks: { 'oats.aweb-tasks': { from: 'package' } } },
  };
  remote('workspace', {
    'oats-workspace.yaml': workspace,
    'oats-membership.yaml': { schemaVersion: 2, workspace: workspaceRef },
    'souls/worker/soul.yaml': { schemaVersion: 2, name: 'worker', description: 'inert fixture', work: 'directory' },
    'souls/worker/AGENTS.md': '# Inert fixture\n',
  });
  const deployment = join(base, 'deployment'); mkdirSync(deployment);
  git(base, 'clone', '-q', fileURLToPath(workspaceRef), join(deployment, 'workspace'));
  writeFileSync(join(deployment, 'oats-local.yaml'), JSON.stringify({ schemaVersion: 2, workspace: workspaceRef }));
  const cli = (...args) => spawnSync(process.execPath, [join(kernel, 'bin/oats.mjs'), ...args, '--dir', deployment, '--json'], { cwd: deployment, env, encoding: 'utf8', timeout: 60000 });
  const synced = cli('sync'); assert.equal(synced.status, 0, synced.stdout + synced.stderr);
  const result = cli('spawn', 'worker', '--work', 'directory', '--harness', 'codex', '--launch-config', 'none', '--preview');
  // Emit the exact public answer for handoff, including any alias refusal.
  t.diagnostic(`No-alias spawn preview: ${result.stdout.trim()}${result.stderr.trim()}`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const answer = JSON.parse(result.stdout);
  assert.equal(answer.ok, true);
  assert.ok(answer.result.home.startsWith(base + '/'), 'planned home stays inside the scratch fixture');
  assert.equal(answer.result.work, 'directory');
  const selected = answer.result.modules.map(({ name, layer }) => ({ name, layer }));
  assert.deepEqual(selected, [
    { name: 'oats.aweb', layer: 'messaging' },
    { name: 'oats.aweb-tasks', layer: 'tasks' },
  ]);
  const text = JSON.stringify(answer.result);
  assert.match(text, /oats\.aweb-tasks/);
  assert.match(text, /oats\.aweb/);
  assert.doesNotMatch(text, /E_SLOT_CONFLICT/);
  assert.equal(existsSync(marker), false, 'selection must never call aw');
  const catalog = JSON.parse(readFileSync(join(kernel, 'package-catalog.json')));
  assert.equal(catalog.capabilities['oats.aweb-tasks'], undefined, 'test must use an unamended catalog');
  t.diagnostic(`Selection: ${JSON.stringify({ ok: answer.ok, modules: selected, catalogAlias: false })}`);
});
