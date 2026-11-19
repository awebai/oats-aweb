// Explicitly selected released aw, checked against the CI matrix entry.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { AW_TEST_VERSIONS } from '../../scripts/aw-test-versions.mjs';

// Explicit validation for the historical source-receipt integrity fixture.
export function verifySourceAwFixture(binary, version, receiptPath) {
  assert.equal(version.status, 0, version.stderr);
  const sha256 = createHash('sha256').update(readFileSync(binary)).digest('hex');
  const sourceCommit = '877bbee94ce45aa1ff103912bc9850556e61dfb4';
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.kind, 'exact-source-build');
  assert.equal(receipt.sourceCommit, sourceCommit);
  assert.equal(receipt.sourceClean, true);
  assert.equal(realpathSync(receipt.binary), realpathSync(binary));
  assert.equal(receipt.sha256, sha256);
  assert.equal(receipt.version, version.stdout.trim());
  assert.match(version.stdout, /^aw 1\.36\.33-source-fixture\n/);
  assert.ok(version.stdout.includes(`commit: ${sourceCommit} (github.com/awebai/aw)`));
  return { kind: receipt.kind, binary, sha256, version: version.stdout.trim(), sourceCommit };
}

// Native admission always enforces the current released matrix.
export function verifyPinnedAw(binary, version) {
  assert.equal(version.status, 0, version.stderr);
  const sha256 = createHash('sha256').update(readFileSync(binary)).digest('hex');
  const actual = /^aw (\S+)$/m.exec(version.stdout)?.[1];
  const expected = process.env.OATS_TEST_AW_VERSION;
  assert.ok(AW_TEST_VERSIONS.includes(actual), `unqualified aw ${actual}`);
  if (expected) assert.equal(actual, expected, 'the installed binary must be the selected CI matrix version');
  return { kind: 'distributed-binary', binary, sha256, version: version.stdout.trim() };
}
