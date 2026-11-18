// Offline signing vectors use the real aw binary.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AW_STATUS_MIN, statusPublishArgs } from "../oats-package/capabilities/oats-aweb/lib/health-host.mjs";
const skip = process.env.OATS_AWEB_HEALTH_NATIVE === "1" ? false : "set OATS_AWEB_HEALTH_NATIVE=1 to run against the real aw";
test("the real aw signs every valid vector document, sent as the publisher sends it, to the vector's exact bytes and signature", { skip }, (t) => {
  const aw = process.env.OATS_AWEB_HEALTH_AW ?? "aw";
  if (spawnSync(aw, ["status", "publish", "--help"], { encoding: "utf8" }).status !== 0) return t.skip(`${aw} has no status publish; set OATS_AWEB_HEALTH_AW to an aw >= ${AW_STATUS_MIN}`);
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
