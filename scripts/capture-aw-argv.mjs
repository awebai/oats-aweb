// Refresh with an isolated released aw; help never touches a service or identity.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const binary = resolve(process.argv[2]);
const home = mkdtempSync(join(tmpdir(), 'aw-help-capture-'));
try {
  const run = (args) => {
    const r = spawnSync(binary, args, { cwd: home, env: { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, AW_NO_UPDATE_CHECK: '1' }, encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const commands = ['version', 'init', 'whoami', 'check', 'heartbeat', 'doctor identity', 'team list', 'team invite', 'team invite inspect', 'team join', 'id team list', 'id team members', 'id team create', 'id team invite', 'id team accept-invite', 'id team register', 'id team set-server', 'id team show-server', 'id cert show', 'id grant mint', 'id grant revoke', 'id grant show', 'id grant list', 'custody status', 'workspace connect', 'workspace status', 'workspace delete', 'wake register', 'wake deregister', 'wake status', 'mail inbox'];
  const grammar = Object.fromEntries(commands.map(command => {
    const help = run([...command.split(' '), '--help']);
    assert.ok(help.includes(`aw ${command}`), command);
    const flags = Object.fromEntries([...help.matchAll(/^\s+(?:-\w, )?(--[\w-]+)(?:\s+(stringArray|stringSlice|string|int|duration|uint))?\s{2,}/gm)].map(m => [m[1], !!m[2]]));
    assert.ok(flags['--help'] === false, command);
    return [command, flags];
  }));
  writeFileSync(new URL('../test/fixtures/aw-argv/grammar.json', import.meta.url), JSON.stringify({ version: run(['version']).trim(), commands: grammar }, null, 2) + '\n');
} finally { rmSync(home, { recursive: true, force: true }); }
