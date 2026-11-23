// Validate the argv recorded while real hook paths run against recording fakes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { AW_BYOT_CREATE, byotCreateAwRefusal } from '../oats-package/capabilities/oats-aweb/lib/byot-create.mjs';
import { freshMailSendFlag } from '../oats-package/capabilities/oats-aweb/lib/probe-support.mjs';
import { MAIL_AW_MIN } from '../oats-package/capabilities/oats-aweb/lib/mail-read.mjs';
import { versionAtLeast } from '../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs';
import { ADOPTED_ROOT_AW_TOO_OLD, AW_ATTRIBUTION } from '../oats-package/capabilities/oats-aweb/lib/attribution.mjs';

/** The lowest aw of the test matrix with `aw who` (contract §3: its fields are those of
 *  aw 1.36.58). Below it the provider's reads answer nothing: C1 carries the recorded
 *  attribution forward and C2 reports `unavailable`, so nothing depends on it. */
export const WHO_AW_MIN = '1.36.58';
import { pathToFileURL } from 'node:url';

const helpOptions = home => ({ cwd: home, encoding: 'utf8', timeout: 10000,
  env: { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, AW_NO_UPDATE_CHECK: '1' } });

export function checkRecordedAwArgv(binary, records, { version } = {}) {
  binary = resolve(binary);
  const home = mkdtempSync(join(tmpdir(), 'aw-argv-help-'));
  const cache = new Map(), combinations = new Set();
  try {
    for (let { command, flags } of records) {
      if (!cache.has(command)) {
        const r = spawnSync(binary, [...command.split(' '), '--help'], helpOptions(home));
        if (command === 'who' && version && !versionAtLeast(version, WHO_AW_MIN)) {
          assert.ok(r.status !== 0 || !r.stdout.includes('\n  aw who '), `aw who unexpectedly exists at aw ${version}; update this capability exclusion`);
          console.log(`Capability exclusion: aw ${version} lacks who; attribution reads answer nothing below aw ${WHO_AW_MIN} (C1 carries forward, C2 reports unavailable)`);
          cache.set(command, null);
          continue;
        }
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
        if (command === 'mail threads' && version && !versionAtLeast(version, MAIL_AW_MIN)) {
          // Only messaging:mail runs it, and it refuses an aw below its own
          // floor (E_AW_TOO_OLD) before any aw mail call.
          assert.ok(!r.stdout.includes(`\n  aw ${command} `) && !r.stdout.includes(`\n  aw ${command}\n`), `${command} unexpectedly exists at aw ${version}; update this capability exclusion`);
          console.log(`Capability exclusion: aw ${version} lacks ${command}; messaging:mail requires aw >= ${MAIL_AW_MIN}`);
          cache.set(command, null);
          continue;
        }
        // Cobra can print a parent's help for an unknown path. Require this
        // precise command in the Usage line, not only a successful exit.
        assert.ok(r.stdout.includes(`\n  aw ${command} `) || r.stdout.includes(`\n  aw ${command}\n`), `missing full command: ${command}`);
        cache.set(command, new Map([...r.stdout.matchAll(/^\s+(?:-\w, )?(--[\w-]+)(?:\s+(stringArray|stringSlice|string|int64|uint64|int|uint|duration))?\s{2,}/gm)].map(m => [m[1], m[2]])));
      }
      if (cache.get(command) === null) continue;
      if (command === 'id team accept-invite' && flags.includes('--parent') && version && !versionAtLeast(version, AW_ATTRIBUTION) && !cache.get(command).has('--parent')) {
        // Only a join from an adopted root passes it, and below aw 1.36.59 that join
        // stops before any invite with the provider's own code. An aw that has the flag
        // (1.36.59, tested and the pinned next) is checked like any other.
        console.log(`Capability exclusion: aw ${version} lacks ${command} --parent; a join from an adopted root needs aw >= ${AW_ATTRIBUTION} and stops before any invite below it (${ADOPTED_ROOT_AW_TOO_OLD})`);
        flags = flags.filter((flag) => flag !== '--parent');
      }
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
        const accepted = spawnSync(binary, [...command.split(' '), ...argv, '--help'], helpOptions(home));
        assert.equal(accepted.status, 0, `${command}: real aw refused the recorded flags parsed together: ${accepted.stderr}`);
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
  const required = ['version', 'init', 'whoami', 'heartbeat', 'team list', 'team invite', 'team invite inspect', 'id team list', 'id team members', 'id team create', 'id team invite', 'id team accept-invite', 'id team register', 'id team set-server', 'id team show-server', 'id grant mint', 'id grant revoke', 'id grant show', 'id grant list', 'custody status', 'workspace connect', 'workspace status', 'workspace delete', 'wake register', 'wake deregister', 'wake status', 'mail inbox', 'mail send', 'mail show', 'mail threads', 'who'];
  const observationHome = mkdtempSync(join(tmpdir(), 'aw-capability-'));
  let version, legacyFlag;
  try {
    const options = helpOptions(observationHome);
    const detected = spawnSync(resolve(binary), ['version'], options);
    assert.equal(detected.status, 0, detected.stderr);
    version = /^aw (\S+)$/m.exec(detected.stdout)?.[1];
    const help = spawnSync(resolve(binary), ['mail', 'send', '--help'], options);
    assert.equal(help.status, 0, help.stderr);
    legacyFlag = freshMailSendFlag(help.stdout);
  } finally { rmSync(observationHome, { recursive: true, force: true }); }
  // Unit vectors intentionally exercise both contracts. Admit only the branch
  // this real CLI qualifies, and require a runtime witness for that branch. An
  // always-legacy send regression therefore loses the modern required witness.
  const applicable = records.filter(r => r.command !== 'mail send' || r.flags.includes('--new-conversation') === legacyFlag);
  console.log(`Capability selection: aw ${version} fresh mail uses ${legacyFlag ? '--new-conversation' : 'recipient plus subject'}`);
  const seen = new Set(applicable.map(r => r.command));
  for (const command of required) assert.ok(seen.has(command), `hook path was not recorded for this CLI capability: ${command}`);
  const commands = checkRecordedAwArgv(resolve(binary), applicable, { version });
  console.log(`real aw accepted flags for ${commands.length} recorded full command paths: ${commands.join(', ')}`);
}
