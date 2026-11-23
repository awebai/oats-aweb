// Refresh with an isolated released aw; help never touches a service or identity.
// usage: node scripts/capture-aw-argv.mjs <tested-aw> [<floor-aw> [<next-aw>]]
// The floor supplies the legacy `mail send --new-conversation`; the next aw (the
// pinned AW_NEXT) supplies `id team accept-invite --parent`, which joined teams pass
// only for an adopted root and only on aw >= 1.36.59 (README, "Human attribution").
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const binary = resolve(process.argv[2]);
const home = mkdtempSync(join(tmpdir(), 'aw-help-capture-'));
try {
  const run = (args, selected = binary) => {
    const r = spawnSync(selected, args, { cwd: home, env: { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, AW_NO_UPDATE_CHECK: '1' }, encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const commands = ['version', 'init', 'whoami', 'check', 'heartbeat', 'doctor identity', 'doctor registry', 'team list', 'team invite', 'team invite inspect', 'team join', 'id team list', 'id team members', 'id team create', 'id team invite', 'id team accept-invite', 'id team register', 'id team set-server', 'id team show-server', 'id cert show', 'id grant mint', 'id grant revoke', 'id grant show', 'id grant list', 'custody status', 'workspace connect', 'workspace status', 'workspace delete', 'wake register', 'wake deregister', 'wake status', 'mail inbox', 'mail send', 'mail show', 'mail threads', 'status publish', 'who'];
  const grammar = Object.fromEntries(commands.map(command => {
    const help = run([...command.split(' '), '--help']);
    assert.ok(help.includes(`aw ${command}`), command);
    const flags = Object.fromEntries([...help.matchAll(/^\s+(?:-\w, )?(--[\w-]+)(?:\s+(stringArray|stringSlice|string|int|duration|uint))?\s{2,}/gm)].map(m => [m[1], !!m[2]]));
    assert.ok(flags['--help'] === false, command);
    return [command, flags];
  }));
  let compatibility;
  if (process.argv[3]) {
    const legacy = resolve(process.argv[3]);
    const help = run(['mail', 'send', '--help'], legacy);
    assert.match(help, /^\s+--new-conversation\s{2,}/m);
    grammar['mail send']['--new-conversation'] = false;
    compatibility = { version: run(['version'], legacy).trim(), command: 'mail send', flag: '--new-conversation' };
  }
  let next;
  if (process.argv[4]) {
    const later = resolve(process.argv[4]);
    const help = run(['id', 'team', 'accept-invite', '--help'], later);
    assert.match(help, /^\s+--parent string\s{2,}/m);
    grammar['id team accept-invite']['--parent'] = true;
    next = { version: run(['version'], later).trim(), command: 'id team accept-invite', flag: '--parent' };
  }
  writeFileSync(new URL('../test/fixtures/aw-argv/grammar.json', import.meta.url), JSON.stringify({ version: run(['version']).trim(), compatibility, ...(next ? { next } : {}), commands: grammar }, null, 2) + '\n');
} finally { rmSync(home, { recursive: true, force: true }); }
