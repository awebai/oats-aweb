// The plain lines `oats aweb health` prints: pure formatting of its result.
import test from "node:test";
import assert from "node:assert/strict";
import { healthExit, healthText } from "../oats-package/capabilities/oats-aweb/lib/health.mjs";

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

const CANNOT_CLEAR = "aw 1.36.37 has no status-host clear; upgrade aw to 1.36.38 or later and run `oats aweb health disable` again";
const disabled = (designations) => ({ publish: false, problems: [], floors, note: "n", designations });

test("disable says when designations are left on the server, and why, once per reason", () => {
  const failed = [{ alias: "a", team: "t", status: null, code: "aw", message: CANNOT_CLEAR }, { alias: "b", team: "t", status: null, code: "aw", message: CANNOT_CLEAR }];
  const lines = healthText({ ok: true, result: disabled({ cleared: [], failed }) }).split("\n");
  assert.ok(lines.includes("designations cleared: 0, not cleared: 2"), lines.join("\n"));
  assert.deepEqual(lines.filter((l) => l.startsWith("designations not cleared: ")), [`designations not cleared: ${CANNOT_CLEAR}`]);
});

test("disable with nothing left on the server prints only the counts", () => {
  const lines = healthText({ ok: true, result: disabled({ cleared: [{ alias: "a", team: "t" }], failed: [] }) }).split("\n");
  assert.ok(lines.includes("designations cleared: 1, not cleared: 0"));
  assert.equal(lines.filter((l) => l.startsWith("designations not cleared: ")).length, 0);
});

test("the exit status: 1 while publishing is on and not ready, or when a designation is left; else 0", () => {
  assert.equal(healthExit({ publish: true, ready: false }), 1);
  assert.equal(healthExit({ publish: true, ready: true }), 0);
  assert.equal(healthExit(disabled({ cleared: [], failed: [{ message: CANNOT_CLEAR }] })), 1);
  assert.equal(healthExit(disabled({ cleared: [], failed: [] })), 0);
  assert.equal(healthExit({ published: [], refused: [], skipped: [], failed: [] }), 0);
});

test("a refusal with no message is named by its HTTP status, else its code", () => {
  const failed = [{ alias: "a", team: "t", status: 403, code: "forbidden", message: "" }, { alias: "b", team: "t", status: null, code: "transport", message: "" }];
  const lines = healthText({ ok: true, result: disabled({ cleared: [], failed }) }).split("\n");
  assert.deepEqual(lines.filter((l) => l.startsWith("designations not cleared: ")), ["designations not cleared: HTTP 403", "designations not cleared: transport"]);
});
