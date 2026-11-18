// Validate the argv recorded while real hook paths run against recording fakes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { AW_BYOT_CREATE, byotCreateAwRefusal } from '../oats-package/capabilities/oats-aweb/lib/byot-create.mjs';
import { pathToFileURL } from 'node:url';

export function checkRecordedAwArgv(binary, records, { version } = {}) {
  binary = resolve(binary);
  const home = mkdtempSync(join(tmpdir(), 'aw-argv-help-'));
  const cache = new Map(), combinations = new Set();
  try {
    for (const { command, flags } of records) {
      if (!cache.has(command)) {
        const r = spawnSync(binary, [...command.split(' '), '--help'], { cwd: home, encoding: 'utf8', timeout: 10000,
          env: { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, AW_NO_UPDATE_CHECK: '1' } });
        assert.equal(r.status, 0, `${command}: ${r.stderr}`);
        if (version === '1.36.33' && ['id team set-server', 'id team show-server'].includes(command)) {
          // These commands belong only to the BYOT create route, whose existing
          // admission floor refuses .33 before any native effect.
          assert.ok(byotCreateAwRefusal(version)?.includes(AW_BYOT_CREATE));
          assert.ok(!r.stdout.includes(`\n  aw ${command} `), `${command} unexpectedly exists; update this capability exclusion`);
          console.log(`Capability exclusion: aw ${version} lacks ${command}; BYOT create requires ${AW_BYOT_CREATE}`);
          cache.set(command, null);
          continue;
        }
        // Cobra can print a parent's help for an unknown path. Require this
        // precise command in the Usage line, not only a successful exit.
        assert.ok(r.stdout.includes(`\n  aw ${command} `) || r.stdout.includes(`\n  aw ${command}\n`), `missing full command: ${command}`);
        cache.set(command, new Map([...r.stdout.matchAll(/^\s+(?:-\w, )?(--[\w-]+)(?:\s+(stringArray|stringSlice|string|int64|uint64|int|uint|duration))?\s{2,}/gm)].map(m => [m[1], m[2]])));
      }
      if (cache.get(command) === null) continue;
      for (const flag of flags) assert.ok(cache.get(command).has(flag), `${binary}: aw ${command} does not accept ${flag}`);
      const key = JSON.stringify([command, [...flags].sort()]);
      if (!combinations.has(key)) {
        combinations.add(key);
        const values = { '--ttl': '720h', '--team': 'fixture:example.invalid', '--team-id': 'fixture:example.invalid', '--join-team': 'fixture:example.invalid', '--scope': 'mail.read', '--backend': 'tmux', '--delivery': 'session', '--runtime-delivery': 'external-session', '--registration-json': '-' };
        const argv = flags.flatMap(flag => {
          const type = cache.get(command).get(flag);
          if (!type) return [flag];
          const value = values[flag] ?? (/^(?:u?int)(?:64)?$/.test(type) ? '1' : type === 'duration' ? '1m' : join(home, 'unused'));
          return [flag, value];
        });
        const accepted = spawnSync(binary, [...command.split(' '), ...argv, '--help'], { cwd: home, encoding: 'utf8', timeout: 10000,
          env: { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, AW_NO_UPDATE_CHECK: '1' } });
        assert.equal(accepted.status, 0, `${command}: real aw refused the recorded flag combination: ${accepted.stderr}`);
      }
    }
    assert.ok(cache.size > 0, 'no hook argv recorded');
    return [...cache].filter(([, flags]) => flags !== null).map(([command]) => command).sort();
  } finally { rmSync(home, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [binary, log] = process.argv.slice(2);
  assert.ok(binary && log, 'usage: node scripts/check-aw-argv.mjs <aw> <recording.jsonl>');
  const records = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  // Coverage witnesses: the suite must execute each hook path against its
  // recording fake, rather than passing on a small accidental subset.
  const required = ['version', 'init', 'whoami', 'check', 'heartbeat', 'team list', 'team invite', 'team invite inspect', 'id team list', 'id team members', 'id team create', 'id team invite', 'id team accept-invite', 'id team register', 'id team set-server', 'id team show-server', 'id grant mint', 'id grant revoke', 'id grant show', 'id grant list', 'custody status', 'workspace connect', 'workspace status', 'workspace delete', 'wake register', 'wake deregister', 'wake status', 'mail inbox'];
  const seen = new Set(records.map(r => r.command));
  for (const command of required) assert.ok(seen.has(command), `hook path was not recorded: ${command}`);
  const detected = spawnSync(resolve(binary), ['version'], { encoding: 'utf8' });
  assert.equal(detected.status, 0, detected.stderr);
  const version = /^aw (\S+)$/m.exec(detected.stdout)?.[1];
  const commands = checkRecordedAwArgv(resolve(binary), records, { version });
  console.log(`real aw accepted flags for ${commands.length} recorded full command paths: ${commands.join(', ')}`);
}
