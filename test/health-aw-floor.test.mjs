// The publisher's aw floor is a version gate: an aw older than AW_STATUS_MIN
// is refused even when it has a `status publish` command, as a pre-release
// build of 1.36.37 does. Clearing designations on disable is the off path: it
// needs only an aw that can clear them. The aw here is a script on PATH that
// prints a version and answers the commands it is given.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { versionAtLeast } from "../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs";
import { AW_STATUS_MIN, healthHost } from "../oats-package/capabilities/oats-aweb/lib/health-host.mjs";

/** An aw whose `version` prints `versionText`; `statusHost` says whether it
 *  has `status-host clear`. Every other command succeeds. */
function hostWithAw(t, versionText, { statusHost = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "aweb-health-floor-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "version.txt"), versionText);
  writeFileSync(join(dir, "aw"), `#!/bin/sh\nif [ "$1" = "version" ]; then cat '${join(dir, "version.txt")}'; exit 0; fi\nif [ "$1" = "status-host" ]; then exit ${statusHost ? 0 : 1}; fi\nexit 0\n`, { mode: 0o755 });
  return healthHost({ deployment: dir, env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir } });
}

test("the floor is aw 1.36.38", () => {
  assert.equal(AW_STATUS_MIN, "1.36.38");
});

test("versionAtLeast compares numerically and only accepts plain major.minor.patch", () => {
  assert.equal(versionAtLeast("1.36.38", "1.36.38"), true);
  assert.equal(versionAtLeast("1.36.100", "1.36.38"), true);
  assert.equal(versionAtLeast("1.36.9", "1.36.38"), false);
  assert.equal(versionAtLeast("1.37.0", "1.36.38"), true);
  for (const odd of ["1.36.38-rc.1", "01.36.38", "1.36.038", "1.36", "dev", "", undefined, `1.36.${"9".repeat(20)}`]) assert.equal(versionAtLeast(odd, "1.36.38"), false, String(odd));
});

test("an aw older than the floor is refused even when it answers status publish", async (t) => {
  assert.deepEqual(await hostWithAw(t, "aw 1.36.37\n").awSupportsStatus(), { ok: false, message: "aw 1.36.37 has no status publish; needs aw >= 1.36.38 (aweb-acah.3.1)" });
  assert.deepEqual(await hostWithAw(t, "aw 1.36.9\n").awSupportsStatus(), { ok: false, message: "aw 1.36.9 has no status publish; needs aw >= 1.36.38 (aweb-acah.3.1)" });
});

test("the floor and every later aw publish, as aw prints its version", async (t) => {
  for (const version of ["1.36.38", "1.36.40", "1.37.0", "2.0.0"]) assert.deepEqual(await hostWithAw(t, `aw ${version}\n  commit: 1fc7692e87eeb7b0622ddb6075fa91492dd552d3 (github.com/awebai/aw)\n  built:  2026-10-15T19:49:44Z\n`).awSupportsStatus(), { ok: true }, version);
});

test("a pre-release or unreadable version is refused, naming what aw printed", async (t) => {
  assert.deepEqual(await hostWithAw(t, "aw 1.36.38-rc.1\n").awSupportsStatus(), { ok: false, message: "aw 1.36.38-rc.1 has no status publish; needs aw >= 1.36.38 (aweb-acah.3.1)" });
  assert.deepEqual(await hostWithAw(t, "something else\n").awSupportsStatus(), { ok: false, message: "aw unknown has no status publish; needs aw >= 1.36.38 (aweb-acah.3.1)" });
});

test("the refusal holds none of the words that make the scheduler hold the job", async (t) => {
  const { message } = await hostWithAw(t, "aw 1.36.37\n").awSupportsStatus();
  assert.doesNotMatch(message, /INCOMPLETE|quarantin|retain|could not (?:be )?(?:verif|confirm)/i);
});

test("designations can be cleared by any aw that has status-host clear, below the floor too", async (t) => {
  assert.deepEqual(await hostWithAw(t, "aw 1.36.37\n").awClearsDesignations(), { ok: true });
  assert.deepEqual(await hostWithAw(t, "aw 1.36.30\n", { statusHost: false }).awClearsDesignations(), { ok: false, message: "aw 1.36.30 has no status-host clear; upgrade aw to 1.36.38 or later and run `oats aweb health disable` again" });
});
