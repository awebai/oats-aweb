// Opt-in contract fixtures accept the distributed pin or an explicitly receipted
// exact-source build. A source build is never reported as the published binary.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';

const commit = '61c38162596d1af9085741d70d15900ff9894257';
export function verifyPinnedAw(binary, version, receiptPath = process.env.OATS_TEST_AW_SOURCE_RECEIPT) {
  assert.equal(version.status, 0);
  const sha256 = createHash('sha256').update(readFileSync(binary)).digest('hex');
  assert.match(version.stdout, new RegExp('commit: ' + commit + ' \\(github.com/awebai/aw\\)'));
  if (!receiptPath) {
    assert.match(version.stdout, /^aw 1\.36\.23\n/);
    return { kind: 'distributed-binary', binary, sha256, version: version.stdout.trim() };
  }
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.kind, 'exact-source-build');
  assert.equal(receipt.sourceCommit, commit);
  assert.equal(receipt.sourceClean, true);
  assert.equal(realpathSync(receipt.binary), realpathSync(binary));
  assert.equal(receipt.sha256, sha256);
  assert.equal(receipt.version, version.stdout.trim());
  assert.match(version.stdout, /^aw 1\.36\.23-source-fixture\n/);
  return { kind: receipt.kind, binary, sha256, version: version.stdout.trim(), sourceCommit: commit };
}
