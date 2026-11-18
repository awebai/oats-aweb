import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as released from './fixtures/retired-certificates-v1.42.1.mjs';
import { recordRetiredCertificates, readRetiredRecord, retiredRecordDir, retiredRecordFile, controllerCleanupCommand } from '../oats-package/capabilities/oats-aweb/lib/retired-certificates.mjs';

test('retired records ignore legacy commands and rebuild the compatibility field', t => {
  const dep = mkdtempSync(join(tmpdir(), 'retired-inputs-'));
  t.after(() => rmSync(dep, { recursive: true, force: true }));
  const entry = { team: 'fixture:example.invalid', certificateId: 'cert-old', registry: null,
    alias: 'fixture', instance: 'fixture', retiredAt: '2026-11-18T00:00:00Z' };
  mkdirSync(retiredRecordDir(dep));
  for (const legacy of [{}, { command: 'hostile; shell input' }, { command: { arbitrary: true } }]) {
    writeFileSync(retiredRecordFile(dep), JSON.stringify({ version: 1, entries: [{ ...entry, ...legacy }] }));
    const read = readRetiredRecord(dep);
    assert.equal(read.problem, undefined);
    assert.equal(controllerCleanupCommand(read.entries[0]), 'aw id team remove-member --namespace example.invalid --team fixture --cert-id cert-old --json');
    assert.deepEqual(recordRetiredCertificates(dep, [{ ...entry, certificateId: 'cert-new' }]), {});
    const written = JSON.parse(readFileSync(retiredRecordFile(dep), 'utf8'));
    assert.equal(written.entries.length, 2);
    assert.ok(written.entries.every(e => e.command === controllerCleanupCommand(e)));
  }
});

test("old and new homes read each other's writes without losing certificates", t => {
  const dep = mkdtempSync(join(tmpdir(), 'retired-mixed-'));
  t.after(() => rmSync(dep, { recursive: true, force: true }));
  const entry = certificateId => ({ team: 'fixture:example.invalid', certificateId,
    alias: 'fixture', instance: 'fixture', retiredAt: '2026-11-18T00:00:00Z', registry: null });
  assert.deepEqual(recordRetiredCertificates(dep, [entry('cert-new')]), {});
  const oldRead = released.readRetiredRecord(dep);
  assert.equal(oldRead.problem, undefined);
  assert.deepEqual(oldRead.entries.map(e => e.certificateId), ['cert-new']);
  assert.deepEqual(released.recordRetiredCertificates(dep, [entry('cert-old')]), {});
  assert.deepEqual(readRetiredRecord(dep).entries.map(e => e.certificateId), ['cert-new', 'cert-old']);
  assert.deepEqual(recordRetiredCertificates(dep, [entry('cert-next')]), {});
  assert.deepEqual(released.readRetiredRecord(dep).entries.map(e => e.certificateId), ['cert-new', 'cert-old', 'cert-next']);
});

test('an existing entry with unusable authoritative inputs is kept when compatibility cannot be rebuilt', t => {
  const dep = mkdtempSync(join(tmpdir(), 'retired-invalid-inputs-'));
  t.after(() => rmSync(dep, { recursive: true, force: true }));
  mkdirSync(retiredRecordDir(dep));
  const entry = { team: 'fixture:example.invalid', certificateId: 'cert-old', alias: 'fixture',
    instance: 'fixture', retiredAt: '2026-11-18T00:00:00Z', registry: 'https://invalid.example/path', command: 'legacy-display-only' };
  const before = JSON.stringify({ version: 1, entries: [entry] });
  writeFileSync(retiredRecordFile(dep), before);
  const result = recordRetiredCertificates(dep, [{ ...entry, registry: null, certificateId: 'cert-new' }]);
  assert.match(result.cause, /invalid controller cleanup inputs.*left unchanged/);
  assert.equal(readFileSync(retiredRecordFile(dep), 'utf8'), before);
  assert.equal(released.readRetiredRecord(dep).entries[0].certificateId, 'cert-old');
});
