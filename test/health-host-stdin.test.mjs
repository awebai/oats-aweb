// An aw that exits before reading its stdin (a refusal decided from argv, or a
// crash) closes the pipe while the publisher is still writing the document:
// that EPIPE is the child's answer arriving early, never a crash of the tick.
// A document far larger than a pipe's buffer makes the EPIPE certain.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { healthHost } from "../oats-package/capabilities/oats-aweb/lib/health-host.mjs";

test("an aw that exits without reading the document gives a refusal, not a crash", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aweb-health-stdin-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "aw"), "#!/bin/sh\nexit 3\n", { mode: 0o755 });
  const host = healthHost({ deployment: dir, env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir } });
  const document = { padding: "x".repeat(4 * 1024 * 1024) };
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(await host.statusPublish({ cwd: dir }, "a1", document), { ok: false, status: null, code: "transport", message: "aw exited 3", retry_after: null });
  }
});
