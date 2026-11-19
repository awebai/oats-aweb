import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('every pinned stack version builds its exact selection before invoking npm', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-stack-selection-')), bin = join(dir, 'bin'), log = join(dir, 'argv.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(bin);
  // npm is the external boundary: record its argv without executing a local
  // stack or kernel. The real Node selection/count behavior is tested above.
  writeFileSync(join(bin, 'npm'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\nconsole.log('# tests 1\\n# skipped 0');\n`, { mode: 0o755 });
  const name = "a rerun with another registry gets aw's own refusal, unchanged (aw 1.36.33: from aw 1.36.53 aw leaves no partial to carry a registry)";
  for (const version of ['1.36.33', '1.36.58', '1.36.59-rc.3']) {
    const result = spawnSync(process.execPath, ['scripts/test-ci.mjs', 'stack'], { encoding: 'utf8', env: { HOME: dir, PATH: bin, AW_VERSION: version } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const args = JSON.parse(readFileSync(log, 'utf8'));
    assert.deepEqual(args.filter(arg => arg.startsWith('--test-skip-pattern=')), version === '1.36.33' ? [] : exclusionArgs([name], ['test/resident-journey.test.mjs']));
    assert.equal(args.at(-1), 'test/resident-journey.test.mjs');
  }
});
