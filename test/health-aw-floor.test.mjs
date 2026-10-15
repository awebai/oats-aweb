// The publisher's aw floor is a version gate: an aw older than AW_STATUS_MIN
// is refused even when it has a `status publish` command, as a pre-release
// build of 1.36.37 does. The aw here is a script on PATH that prints a version
// and answers every status command, so only the version decides.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AW_STATUS_MIN, healthHost } from "../oats-package/capabilities/oats-aweb/lib/health-host.mjs";

function hostWithAw(t, versionLine) {
  const dir = mkdtempSync(join(tmpdir(), "aweb-health-floor-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "aw"), `#!/bin/sh\nif [ "$1" = "version" ]; then printf '%s\\n' '${versionLine}'; fi\nexit 0\n`, { mode: 0o755 });
  return healthHost({ deployment: dir, env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir } });
}

test("the floor is aw 1.36.38", () => {
  assert.equal(AW_STATUS_MIN, "1.36.38");
});

test("an aw older than the floor is refused even when it answers status publish", async (t) => {
  assert.deepEqual(await hostWithAw(t, "aw 1.36.37").awSupportsStatus(), { ok: false, message: "aw 1.36.37 has no status publish; needs aw >= 1.36.38 (aweb-acah.3.1)" });
});

test("the floor and every later aw publish", async (t) => {
  for (const version of ["1.36.38", "1.36.40", "1.37.0", "2.0.0"]) assert.deepEqual(await hostWithAw(t, `aw ${version}`).awSupportsStatus(), { ok: true }, version);
});

test("an aw whose version cannot be read is refused", async (t) => {
  assert.deepEqual(await hostWithAw(t, "aw dev").awSupportsStatus(), { ok: false, message: "aw unknown has no status publish; needs aw >= 1.36.38 (aweb-acah.3.1)" });
});
