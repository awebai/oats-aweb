// The plain lines `oats aweb health` prints: pure formatting of its result.
import test from "node:test";
import assert from "node:assert/strict";
import { healthText } from "../oats-package/capabilities/oats-aweb/lib/health.mjs";

const floors = { aw: "1.36.38", claudeChannel: "1.7.17", piExtension: "0.3.15" };

test("a tick's line counts what failed beside what was published, refused and skipped", () => {
  assert.equal(healthText({ ok: true, result: { published: [1, 2], refused: [], skipped: [1], failed: [1] } }), "published 2, refused 0, skipped 1, failed 1");
});

test("status names the last tick, which is not the last successful publish", () => {
  const lastTick = { at: "2026-10-15T10:00:00.000Z", published: 0, refused: 3, skipped: 0, failed: 1 };
  const lines = healthText({ ok: true, result: { publish: true, ready: true, lastTick, problems: [], floors, note: "n" } }).split("\n");
  assert.ok(lines.includes("last tick: 2026-10-15T10:00:00.000Z (published 0, refused 3, skipped 0, failed 1)"), lines.join("\n"));
});

test("status states the released aw, Claude channel and pi extension as required", () => {
  const lines = healthText({ ok: true, result: { publish: false, problems: [], floors, note: "n" } }).split("\n");
  assert.ok(lines.includes("required: aw 1.36.38 to publish; Claude channel 1.7.17 or pi extension 0.3.15 to prove receive"), lines.join("\n"));
});
