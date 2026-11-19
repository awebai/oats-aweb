import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyPinnedAw, verifySourceAwFixture } from './helpers/pinned-aw.mjs';

test('native source fixture requires exact source, version, clean receipt and binary hash', t => {
  const dir = mkdtempSync(join(tmpdir(), 'native-receipt-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const binary = join(dir, 'aw'), receiptPath = join(dir, 'receipt.json');
  writeFileSync(binary, 'non-executable receipt validation fixture');
  const sourceCommit = '877bbee94ce45aa1ff103912bc9850556e61dfb4';
  const version = { status: 0, stdout: 'aw 1.36.33-source-fixture\n  commit: ' + sourceCommit + ' (github.com/awebai/aw)\n' };
  const receipt = { kind: 'exact-source-build', binary, sourceCommit, sourceClean: true,
    sha256: createHash('sha256').update('non-executable receipt validation fixture').digest('hex'), version: version.stdout.trim() };
  const save = delta => writeFileSync(receiptPath, JSON.stringify({ ...receipt, ...delta }));
  save({});
  assert.equal(verifySourceAwFixture(binary, version, receiptPath).kind, 'exact-source-build');
  assert.throws(() => verifySourceAwFixture(binary, version, null), 'source build cannot pass published mode');
  for (const delta of [{ sourceCommit: 'wrong' }, { sourceClean: false }, { sha256: 'wrong' },
    { binary: receiptPath }, { version: 'aw 1.36.26' }, { kind: 'unverified' }]) {
    save(delta); assert.throws(() => verifySourceAwFixture(binary, version, receiptPath));
  }
  save({});
  assert.throws(() => verifySourceAwFixture(binary, { ...version, stdout: version.stdout.replace('1.36.33-source-fixture', '1.36.26') }, receiptPath));
  assert.throws(() => verifySourceAwFixture(binary, { ...version, stdout: version.stdout.replace(sourceCommit, 'bad') }, receiptPath));
  assert.throws(() => verifySourceAwFixture(binary, version, join(dir, 'absent')));
});

test('a historical source receipt cannot bypass native matrix admission', t => {
  const dir = mkdtempSync(join(tmpdir(), 'native-receipt-gate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const binary = join(dir, 'aw'), receiptPath = join(dir, 'receipt.json');
  const bytes = 'non-executable receipt validation fixture';
  writeFileSync(binary, bytes);
  const sourceCommit = '877bbee94ce45aa1ff103912bc9850556e61dfb4';
  const version = { status: 0, stdout: `aw 1.36.33-source-fixture\n  commit: ${sourceCommit} (github.com/awebai/aw)\n` };
  writeFileSync(receiptPath, JSON.stringify({ kind: 'exact-source-build', binary, sourceCommit, sourceClean: true,
    sha256: createHash('sha256').update(bytes).digest('hex'), version: version.stdout.trim() }));
  const previous = process.env.OATS_TEST_AW_SOURCE_RECEIPT;
  process.env.OATS_TEST_AW_SOURCE_RECEIPT = receiptPath;
  t.after(() => { if (previous === undefined) delete process.env.OATS_TEST_AW_SOURCE_RECEIPT; else process.env.OATS_TEST_AW_SOURCE_RECEIPT = previous; });
  assert.throws(() => verifyPinnedAw(binary, version), /unqualified aw/);
  assert.throws(() => verifyPinnedAw(binary, version, receiptPath), /unqualified aw/);
});
