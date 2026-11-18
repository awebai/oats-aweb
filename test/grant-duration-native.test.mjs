import { verifyPinnedAw } from './helpers/pinned-aw.mjs';
// Read-only flag/help contract, not a mint, authority or expiry acceptance test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveGrantTTL } from '../oats-package/capabilities/oats-aweb/lib/grant-duration.mjs';

test('pinned real aw duration flag grammar and stated grant limits (help only)', t => {
  if (!process.env.OATS_TEST_AW) {
    assert.notEqual(process.env.OATS_GRANT_DURATION_NATIVE_REQUIRED, '1', 'set OATS_TEST_AW');
    t.skip('requires explicit pinned real aw at the supported floor or later executable'); return;
  }
  const binary = realpathSync(process.env.OATS_TEST_AW);
  const home = mkdtempSync(join(tmpdir(), 'oats-duration-help-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { HOME: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'),
    AW_NO_UPDATE_CHECK: '1', PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: home };
  const run = args => spawnSync(binary, args, { cwd: home, env, encoding: 'utf8', timeout: 10000 });
  const version = run(['version']);
  t.diagnostic(JSON.stringify(verifyPinnedAw(binary, version)));
  const cases = ['never', '720h', '+720h', '720.h', '719h60m', '2592000000000µs', '2592000000000μs',
    '720h0.1ns', '720h1ns', '2592000.000000001s', '0.000000000000000000001h', '-60s',
    '-9223372036854775808ns', '9223372036854775808ns', '1h-1s', '1e3s', '30d', '.s', '60', ''];
  assert.equal(resolveGrantTTL(''), 'never', 'empty settings use the documented default');
  assert.notEqual(run(['id', 'grant', 'mint', '--ttl=', '--help']).status, 0, 'empty wire values are refused');
  for (const value of cases) {
    // aw parses and validates TTL before help; both sides use these exact vectors.
    let parsed = true, provider; try { provider = resolveGrantTTL(value); } catch (e) { parsed = false; provider = e.message; }
    const result = run(['id', 'grant', 'mint', '--ttl=' + (parsed ? provider : value), '--help']);
    assert.equal(result.status === 0, parsed, JSON.stringify({ value, native: { status: result.status, stdout: result.stdout, stderr: result.stderr }, provider }));
    if (parsed) assert.match(result.stdout, /60s to 720h/);
  }
  assert.deepEqual(readdirSync(home), [], 'help must leave isolated home unchanged');
});
