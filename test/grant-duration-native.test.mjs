// Read-only flag/help contract, not a mint, authority or expiry acceptance test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { durationNanoseconds } from '../oats-package/capabilities/oats-aweb/lib/grant-duration.mjs';

test('pinned real aw duration flag grammar and stated grant limits (help only)', t => {
  if (!process.env.OATS_TEST_AW_1_36_23) {
    assert.notEqual(process.env.OATS_GRANT_DURATION_NATIVE_REQUIRED, '1', 'set OATS_TEST_AW_1_36_23');
    t.skip('requires explicit pinned real aw 1.36.23 executable'); return;
  }
  const binary = realpathSync(process.env.OATS_TEST_AW_1_36_23);
  const home = mkdtempSync(join(tmpdir(), 'oats-duration-help-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { HOME: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'),
    AW_NO_UPDATE_CHECK: '1', PATH: '/usr/bin:/bin', TMPDIR: home };
  const run = args => spawnSync(binary, args, { cwd: home, env, encoding: 'utf8', timeout: 10000 });
  const version = run(['version']);
  assert.equal(version.status, 0);
  assert.match(version.stdout, /^aw 1\.36\.23\n/);
  assert.match(version.stdout, /commit: 61c38162596d1af9085741d70d15900ff9894257/);
  t.diagnostic(JSON.stringify({ binary, sha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), version: version.stdout.trim() }));
  const cases = ['720h', '+720h', '720.h', '719h60m', '2592000000000µs', '2592000000000μs',
    '720h0.1ns', '720h1ns', '2592000.000000001s', '0.000000000000000000001h', '-60s',
    '-9223372036854775808ns', '9223372036854775808ns', '1h-1s', '1e3s', '30d', '.s', '60', ''];
  for (const value of cases) {
    // --help prevents command execution even for syntactically valid out-of-range
    // durations; the native min/max is separately source-qualified.
    const result = run(['id', 'grant', 'mint', '--ttl=' + value, '--help']);
    let parsed = true; try { durationNanoseconds(value); } catch { parsed = false; }
    assert.equal(result.status === 0, parsed, value + ': native/parser grammar disagreement');
    if (parsed) assert.match(result.stdout, /60s to 720h/);
  }
  assert.deepEqual(readdirSync(home), [], 'help must leave isolated home unchanged');
});
