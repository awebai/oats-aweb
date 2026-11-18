import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeCapture } from './helpers/native-capture.mjs';
import { sanitizeCaptures } from '../scripts/sanitize-captures.mjs';

function directory(t) {
  const dir = mkdtempSync(join(tmpdir(), 'native-capture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('capture removes credentials, scrubs paths and tokens, and writes only owner-readable public observations', t => {
  const dir = directory(t), previous = process.env.OATS_AWEB_CAPTURE_DIR;
  process.env.OATS_AWEB_CAPTURE_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.OATS_AWEB_CAPTURE_DIR; else process.env.OATS_AWEB_CAPTURE_DIR = previous; });
  nativeCapture('wire', { grant_id: 'public-id', token: 'PRIVATE', nested: { api_key: 'PRIVATE', home: '/scratch/a b/home' }, note: 'aw_inv_SYNTHETIC' }, { version: '1.36.58', paths: { '/scratch/a b': '/fixture' } });
  const file = join(dir, 'wire.json'), doc = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(doc, { grant_id: 'public-id', nested: { home: '/fixture/home' }, note: '<redacted>' });
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(join(dir, 'wire.provenance.json'), 'utf8')).aw, '1.36.58');
  assert.throws(() => nativeCapture('../outside', {}), /match/);
  assert.throws(() => nativeCapture('private', { data: '-----BEGIN X25519 PRIVATE KEY-----\nSYNTHETIC-PRIVATE-MATERIAL' }), error => {
    assert.ok(!error.message.includes('SYNTHETIC-PRIVATE-MATERIAL'));
    return /private key/.test(error.message);
  });
  assert.equal(existsSync(join(dir, 'private.json')), false);
});

test('artifact sanitizer refuses private material without reflecting it in the error', t => {
  for (const [name, text] of [['key.stdout', '-----BEGIN ED25519 PRIVATE KEY-----\nSYNTHETIC-PRIVATE-MATERIAL'], ['secret.json', '{"token":"SYNTHETIC-PRIVATE-MATERIAL"}'], ['secret.yaml', 'api_key: SYNTHETIC-PRIVATE-MATERIAL\n']]) {
    const dir = directory(t);
    writeFileSync(join(dir, name), text);
    assert.throws(() => sanitizeCaptures(dir), error => {
      assert.ok(!error.message.includes('SYNTHETIC-PRIVATE-MATERIAL'));
      return /private key|credential/.test(error.message);
    });
  }
  const dir = directory(t), file = join(dir, 'public.stdout');
  writeFileSync(file, '/runner/tmp/root aw_inv_SYNTHETIC\n');
  sanitizeCaptures(dir, { RUNNER_TEMP: '/runner/tmp' });
  assert.equal(readFileSync(file, 'utf8'), '/fixture/capture/root <redacted>\n');
});
