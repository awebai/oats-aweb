import test from 'node:test';
import { spawnSync } from 'node:child_process';
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

test('an unusable old entry gets a shell-comment placeholder while a fresh certificate is recorded', t => {
  const dep = mkdtempSync(join(tmpdir(), 'retired-invalid-inputs-'));
  t.after(() => rmSync(dep, { recursive: true, force: true }));
  mkdirSync(retiredRecordDir(dep));
  const entry = { team: 'fixture:example.invalid', certificateId: 'cert-old', alias: 'fixture',
    instance: 'fixture', retiredAt: '2026-11-18T00:00:00Z', registry: 'https://invalid.example/path', command: 'legacy-display-only' };
  const before = JSON.stringify({ version: 1, entries: [entry] });
  writeFileSync(retiredRecordFile(dep), before);
  const result = recordRetiredCertificates(dep, [{ ...entry, registry: null, certificateId: 'cert-new' }]);
  assert.deepEqual(result, {});
  const read = released.readRetiredRecord(dep);
  assert.equal(read.problem, undefined);
  assert.deepEqual(read.entries.map(e => e.certificateId), ['cert-old', 'cert-new']);
  assertComment(read.entries[0].command, '# unavailable: invalid cleanup inputs', dep);
});

function assertComment(command, expected, cwd) {
  assert.equal(command, expected);
  assert.match(command, /^#/);
  assert.doesNotMatch(command, /[\r\n]/);
  const run = spawnSync('/bin/sh', ['-c', command], { cwd, env: { PATH: '/usr/bin:/bin', HOME: cwd }, encoding: 'utf8' });
  assert.equal(run.status, 0); assert.equal(run.stdout + run.stderr, '');
}

test('a registry absent from an old entry stays absent across writes and never becomes a default-registry command', t => {
  const dep = mkdtempSync(join(tmpdir(), 'retired-unknown-registry-'));
  t.after(() => rmSync(dep, { recursive: true, force: true }));
  mkdirSync(retiredRecordDir(dep));
  const entry = { team: 'fixture:example.invalid', certificateId: 'cert-old', alias: 'fixture',
    instance: 'fixture', retiredAt: '2026-11-18T00:00:00Z', command: 'aw id team remove-member --registry https://legacy.example --json' };
  writeFileSync(retiredRecordFile(dep), JSON.stringify({ version: 1, entries: [entry] }));
  for (const certificateId of ['cert-new', 'cert-next']) {
    assert.deepEqual(recordRetiredCertificates(dep, [{ ...entry, certificateId, registry: null }]), {});
    const read = released.readRetiredRecord(dep);
    assert.equal(read.problem, undefined);
    const old = read.entries.find(e => e.certificateId === 'cert-old');
    assert.equal(Object.hasOwn(old, 'registry'), false);
    assertComment(old.command, '# unavailable: registry was not recorded', dep);
    assert.doesNotMatch(readFileSync(retiredRecordFile(dep), 'utf8'), /legacy\.example/);
  }
  assert.deepEqual(released.readRetiredRecord(dep).entries.map(e => e.certificateId), ['cert-old', 'cert-new', 'cert-next']);
});
