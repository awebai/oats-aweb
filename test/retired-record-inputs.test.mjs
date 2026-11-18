import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordRetiredCertificates, readRetiredRecord, retiredRecordDir, retiredRecordFile, controllerCleanupCommand } from '../oats-package/capabilities/oats-aweb/lib/retired-certificates.mjs';

test('retired records accept legacy commands but write only authoritative inputs', t => {
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
    assert.ok(written.entries.every(e => !Object.hasOwn(e, 'command')));
  }
});
