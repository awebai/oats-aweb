import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { exclusionArgs } from '../scripts/ci-exclusions.mjs';

test('CI exclusions omit exactly named tests without running or counting skips, and reject renamed exclusions', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-exclusions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'fixture.test.mjs');
  writeFileSync(file, `import test from 'node:test';
    test('keep me', () => {});
    test('drop (one)', () => { throw Error('excluded test ran'); });
    test("drop two's case", () => { throw Error('second excluded test ran'); });\n`);
  const args = exclusionArgs(['drop (one)', "drop two's case"], [file]);
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...args, file], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^# tests 1$/m);
  assert.match(result.stdout, /^# skipped 0$/m);
  assert.match(result.stdout, /ok 1 - keep me/);
  assert.doesNotMatch(result.stdout, /excluded test ran|drop \(one\)|drop two/);
  assert.throws(() => exclusionArgs(['renamed test'], [file]), /names no declared literal test/);
});
