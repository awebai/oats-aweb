// Status signing is offline; the floor proves the capability is absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AW_STATUS_MIN, statusPublishArgs } from '../oats-package/capabilities/oats-aweb/lib/health-host.mjs';
import { versionAtLeast } from '../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs';
const skip = !process.env.OATS_TEST_AW && 'set OATS_TEST_AW to a pinned real aw';
test("the real aw signs every valid vector document, sent as the publisher sends it, to the vector's exact bytes and signature", { skip }, (t) => {
  const aw = process.env.OATS_TEST_AW;
  const version = spawnSync(aw, ['version'], { encoding: 'utf8' }).stdout.match(/^aw (\S+)$/m)?.[1];
  const help = spawnSync(aw, ['status', 'publish', '--help'], { encoding: 'utf8' });
  if (!versionAtLeast(version, AW_STATUS_MIN)) {
    assert.notEqual(help.status, 0, `aw ${version} must refuse unsupported status publish`);
    assert.match(help.stderr, /unknown command "status"/);
    return;
  }
  assert.equal(help.status, 0, help.stderr);
  const vector = JSON.parse(readFileSync(new URL("./fixtures/agent-status-v1.json", import.meta.url), "utf8"));
  const dir = mkdtempSync(join(tmpdir(), "aweb-health-sign-"));
  try {
    for (const c of vector.valid) {
      const out = spawnSync(aw, [...statusPublishArgs("alice"), "--print-signed"], { cwd: dir, input: JSON.stringify(c.document), encoding: "utf8", env: { PATH: process.env.PATH, HOME: dir, AW_NO_UPDATE_CHECK: "1", AW_AGENT_STATUS_TEST_SEED_HEX: vector.signing_seed_hex } });
      assert.equal(out.status, 0, `${c.name}: ${out.stderr}`);
      assert.deepEqual(JSON.parse(out.stdout), { signed_payload: c.signed_payload, signature: c.signature }, c.name);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
