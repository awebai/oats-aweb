// The publisher's aw floor is a version gate: an aw older than AW_STATUS_MIN
// is refused even when it has a `status publish` command, as a pre-release
// build of 1.36.37 does. Floors compare by semver precedence: a pre-release is
// below its own release and above every lower one. Clearing designations on disable is the off path: it
// needs only an aw that can clear them. The aw here is a script on PATH that
// prints a version and answers the commands it is given.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AW_MIN, AW_TESTED, awebCloudService, awNewerThanTestedMessage, versionAtLeast } from "../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs";
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

test("versionAtLeast compares numerically and only accepts semver", () => {
  assert.equal(versionAtLeast("1.36.38", "1.36.38"), true);
  assert.equal(versionAtLeast("1.36.100", "1.36.38"), true);
  assert.equal(versionAtLeast("1.36.9", "1.36.38"), false);
  assert.equal(versionAtLeast("1.37.0", "1.36.38"), true);
  for (const odd of ["01.36.38", "1.36.038", "1.36", "dev", "", undefined, `1.36.${"9".repeat(20)}`, "1.36.38+", "1.36.38+a..b", "1.36.38-", "1.36.38-rc..1", "1.36.38-01"]) assert.equal(versionAtLeast(odd, "1.36.38"), false, String(odd));
});

test("a pre-release meets a floor below its release, and never its own release's floor", () => {
  for (const [version, floor, meets] of [
    ["1.36.53-rc.3", "1.36.38", true],
    ["1.36.39-rc.1", "1.36.38", true],
    ["1.37.0-alpha", "1.36.38", true],
    ["1.36.38-rc.1", "1.36.38", false],
    ["1.36.38-rc.9", "1.36.38", false],
    ["1.36.37-rc.1", "1.36.38", false],
    ["1.36.53-rc.3", "1.36.53-rc.3", true],
    ["1.36.53-rc.10", "1.36.53-rc.3", true],
    ["1.36.53-rc.2", "1.36.53-rc.3", false],
    ["1.36.53-rc", "1.36.53-rc.1", false],
    ["1.36.53-beta", "1.36.53-alpha", true],
    ["1.36.53-1", "1.36.53-alpha", false],
    ["1.36.53", "1.36.53-rc.3", true],
    // Build metadata has no precedence.
    ["1.36.38+build.1", "1.36.38", true],
    ["1.36.38-rc.1+abc", "1.36.38", false],
    ["1.36.38", "1.36.38+zzz", true],
    // Numeric ids past Number.MAX_SAFE_INTEGER stay exact.
    ["1.36.53-rc.9007199254740992", "1.36.53-rc.9007199254740993", false],
    ["1.36.53-rc.9007199254740993", "1.36.53-rc.9007199254740992", true],
    ["1.36.53-rc.10000000000000000000", "1.36.53-rc.9999999999999999999", true],
  ]) assert.equal(versionAtLeast(version, floor), meets, `${version} >= ${floor}`);
});

test("an aw older than the floor is refused even when it answers status publish", async (t) => {
  assert.deepEqual(await hostWithAw(t, "aw 1.36.37\n").awSupportsStatus(), { ok: false, message: "aw 1.36.37 has no status publish; needs aw >= 1.36.38 (aweb-acah.3.1)" });
  assert.deepEqual(await hostWithAw(t, "aw 1.36.9\n").awSupportsStatus(), { ok: false, message: "aw 1.36.9 has no status publish; needs aw >= 1.36.38 (aweb-acah.3.1)" });
});

test("the floor and every later aw publish, as aw prints its version", async (t) => {
  for (const version of ["1.36.38", "1.36.40", "1.37.0", "2.0.0"]) assert.deepEqual(await hostWithAw(t, `aw ${version}\n  commit: 1fc7692e87eeb7b0622ddb6075fa91492dd552d3 (github.com/awebai/aw)\n  built:  2026-10-15T19:49:44Z\n`).awSupportsStatus(), { ok: true }, version);
});

test("a pre-release of the floor's own release or an unreadable version is refused, naming what aw printed; one above the floor publishes", async (t) => {
  assert.deepEqual(await hostWithAw(t, "aw 1.36.38-rc.1\n").awSupportsStatus(), { ok: false, message: "aw 1.36.38-rc.1 has no status publish; needs aw >= 1.36.38 (aweb-acah.3.1)" });
  assert.deepEqual(await hostWithAw(t, "aw 1.36.53-rc.3\n").awSupportsStatus(), { ok: true });
  assert.deepEqual(await hostWithAw(t, "something else\n").awSupportsStatus(), { ok: false, message: "aw unknown has no status publish; needs aw >= 1.36.38 (aweb-acah.3.1)" });
});

test("the refusals hold none of the words that make the scheduler hold the job", async (t) => {
  const host = hostWithAw(t, "aw 1.36.37\n", { statusHost: false });
  for (const { message } of [await host.awSupportsStatus(), await host.awClearsDesignations()]) assert.doesNotMatch(message, /INCOMPLETE|quarantin|retain|could not (?:be )?(?:verif|confirm)/i);
});

test("designations can be cleared by any aw that has status-host clear, below the floor too", async (t) => {
  assert.deepEqual(await hostWithAw(t, "aw 1.36.37\n").awClearsDesignations(), { ok: true });
  assert.deepEqual(await hostWithAw(t, "aw 1.36.30\n", { statusHost: false }).awClearsDesignations(), { ok: false, message: "aw 1.36.30 has no status-host clear; upgrade aw to 1.36.38 or later and run `oats aweb health disable` again" });
});

test("the Cloud is an exact origin: scheme, host and port, no suffix match", () => {
  for (const url of ["https://app.aweb.ai", "https://app.aweb.ai/api", "https://app.aweb.ai:443/api", "https://APP.aweb.ai/api"]) assert.equal(awebCloudService(url), true, url);
  for (const url of ["http://app.aweb.ai/api", "https://app.aweb.ai:8443/api", "https://app.aweb.ai.example.test/api", "https://eu.app.aweb.ai/api", "https://aweb.ai/api", "not a url", "", undefined]) assert.equal(awebCloudService(url), false, String(url));
});

test("aw newer than tested warns only above AW_TESTED, and only off the Cloud", () => {
  const self = "https://aweb.example.test/api";
  for (const v of ["1.36.52", "1.36.52-rc.3", "1.37.0", "2.0.0-alpha"]) assert.match(awNewerThanTestedMessage(v, self) || "", new RegExp(`^aw ${v.replaceAll(".", "\\.")} is newer than the aw this oats\\.aweb is tested with \\(${AW_TESTED.replaceAll(".", "\\.")}\\)`), v);
  for (const v of [AW_TESTED, `${AW_TESTED}+build.1`, `${AW_TESTED}-rc.1`, "1.36.33", "dev", undefined]) assert.equal(awNewerThanTestedMessage(v, self), undefined, String(v));
  assert.equal(awNewerThanTestedMessage("1.36.53", "https://app.aweb.ai/api"), undefined, "the Cloud is covered by aw's release order");
  assert.equal(awNewerThanTestedMessage("1.36.53", null), undefined, "no service named is aw's default, the Cloud");
});

test("the CI journey matrix spans exactly AW_MIN to AW_TESTED, so the tested range is what CI proves", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const m = /^\s*aw:\s*\[([^\]]*)\]/m.exec(ci);
  assert.ok(m, "ci.yml names the aw versions its journeys run");
  const versions = m[1].split(",").map((v) => v.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  const sorted = [...versions].sort((a, b) => (versionAtLeast(a, b) ? (versionAtLeast(b, a) ? 0 : 1) : -1));
  assert.equal(sorted[0], AW_MIN, "the matrix's lowest aw is the floor");
  assert.equal(sorted.at(-1), AW_TESTED, "AW_TESTED moves only once that aw is in the matrix");
});
