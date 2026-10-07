import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyPinnedAw } from './helpers/pinned-aw.mjs';

test('native source fixture requires exact source, version, clean receipt and binary hash', t => {
  const dir = mkdtempSync(join(tmpdir(), 'native-receipt-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const binary = join(dir, 'aw'), receiptPath = join(dir, 'receipt.json');
  writeFileSync(binary, 'non-executable receipt validation fixture');
  const sourceCommit = '61c38162596d1af9085741d70d15900ff9894257';
  const version = { status: 0, stdout: 'aw 1.36.23-source-fixture\n  commit: ' + sourceCommit + ' (github.com/awebai/aw)\n' };
  const receipt = { kind: 'exact-source-build', binary, sourceCommit, sourceClean: true,
    sha256: createHash('sha256').update('non-executable receipt validation fixture').digest('hex'), version: version.stdout.trim() };
  const save = delta => writeFileSync(receiptPath, JSON.stringify({ ...receipt, ...delta }));
  save({});
  assert.equal(verifyPinnedAw(binary, version, receiptPath).kind, 'exact-source-build');
  assert.throws(() => verifyPinnedAw(binary, version, null), 'source build cannot pass published mode');
  for (const delta of [{ sourceCommit: 'wrong' }, { sourceClean: false }, { sha256: 'wrong' },
    { binary: receiptPath }, { version: 'aw 1.36.26' }, { kind: 'unverified' }]) {
    save(delta); assert.throws(() => verifyPinnedAw(binary, version, receiptPath));
  }
  save({});
  assert.throws(() => verifyPinnedAw(binary, { ...version, stdout: version.stdout.replace('1.36.23-source-fixture', '1.36.26') }, receiptPath));
  assert.throws(() => verifyPinnedAw(binary, { ...version, stdout: version.stdout.replace(sourceCommit, 'bad') }, receiptPath));
  assert.throws(() => verifyPinnedAw(binary, version, join(dir, 'absent')));
});
