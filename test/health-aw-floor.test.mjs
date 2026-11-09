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
  const [major, minor, patch] = AW_TESTED.split(/[-+]/)[0].split(".").map(Number);
  const nextPatch = `${major}.${minor}.${patch + 1}`;
  for (const v of [nextPatch, `${nextPatch}-rc.3`, `${major}.${minor + 1}.0`, `${major + 1}.0.0-alpha`]) assert.match(awNewerThanTestedMessage(v, self) || "", new RegExp(`^aw ${v.replaceAll(".", "\\.")} is newer than the aw this oats\\.aweb is tested with \\(${AW_TESTED.replaceAll(".", "\\.")}\\)`), v);
  for (const v of [AW_TESTED, `${AW_TESTED}+build.1`, `${AW_TESTED}-rc.1`, AW_MIN, "dev", undefined]) assert.equal(awNewerThanTestedMessage(v, self), undefined, String(v));
  assert.equal(awNewerThanTestedMessage(nextPatch, "https://app.aweb.ai/api"), undefined, "the Cloud is covered by aw's release order");
  assert.equal(awNewerThanTestedMessage(nextPatch, null), undefined, "no service named is aw's default, the Cloud");
});

const CI = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const COMPAT = JSON.parse(readFileSync(new URL("../oats-package/capabilities/oats-aweb/aw-compat.json", import.meta.url), "utf8"));

/** ci.yml's text for one job: from its `  <name>:` line to the next job's. */
function ciJob(ci, name) {
  const start = ci.indexOf(`\n  ${name}:\n`);
  if (start < 0) return undefined;
  const rest = ci.slice(start + 1);
  const next = rest.slice(1).search(/\n  [A-Za-z0-9_-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 2);
}

/** Why ci.yml's real-aw journeys don't run exactly aw-compat.json's
 *  [min, tested], each installed at its own version and none skippable, as a
 *  list of problems (empty when they do). The matrix's only key is `aw`, so no
 *  include, exclude or second axis adds or drops a job. */
function journeyCoverProblems(ci, compat) {
  const problems = [];
  const job = ciJob(ci, "resident-journey");
  if (!job) return ["ci.yml has no resident-journey job"];
  // The matrix is every line under `matrix:` until one indented no deeper; a
  // blank or comment line inside it doesn't end it. Any form other than the
  // block mapping (`matrix: {...}`, an expression) finds no entries and fails.
  const lines = job.split("\n");
  const at = lines.findIndex((l) => /^ +matrix:$/.test(l));
  const entries = [];
  if (at >= 0) {
    const indent = lines[at].length - lines[at].trimStart().length;
    for (const line of lines.slice(at + 1)) {
      const text = line.trim();
      if (!text || text.startsWith("#")) continue;
      if (line.length - line.trimStart().length <= indent) break;
      entries.push(text);
    }
  }
  const aw = entries.length === 1 ? /^aw:\s*\[([^\]]*)\]$/.exec(entries[0]) : null;
  // Each entry is quoted: YAML reads a plain 1.40 as the number 1.4.
  if (!aw) problems.push(`the resident-journey matrix must be the one line aw: [...] (found ${JSON.stringify(entries)})`);
  else {
    const versions = aw[1].split(",").map((v) => v.trim()).map((v) => /^'([^']*)'$|^"([^"]*)"$/.exec(v)).map((m) => m && (m[1] ?? m[2]));
    const expected = [compat.min, compat.tested];
    if (JSON.stringify(versions) !== JSON.stringify(expected)) problems.push(`the resident-journey matrix is [${aw[1].trim()}], not aw-compat.json's [min, tested] ${JSON.stringify(expected)}`);
  }
  if (!/\n      AW_VERSION: \$\{\{ matrix\.aw \}\}\n/.test(job)) problems.push("resident-journey's AW_VERSION is not its matrix entry");
  if (/^ {4}if:/m.test(job)) problems.push("resident-journey has a job-level if:, so it can skip");
  if (/continue-on-error/.test(job)) problems.push("resident-journey has continue-on-error, so a failure is not red");
  const install = job.indexOf('npm install --prefix "$RUNNER_TEMP/aw" --no-audit --no-fund "@awebai/aw@$AW_VERSION"');
  const check = job.indexOf(`test "\${installed%%$'\\n'*}" = "aw $AW_VERSION"`);
  const realAw = job.indexOf("- name: Real-aw tests at this version");
  if (install < 0) problems.push("resident-journey does not install @awebai/aw@$AW_VERSION into $RUNNER_TEMP/aw");
  if (check < 0 || check < install || check > realAw) problems.push("resident-journey does not check, after installing and before any test, that the installed aw version is its matrix entry");
  if (!/grep -q '\^# skipped 0\$' "\$RUNNER_TEMP\/real-aw\.tap"/.test(job)) problems.push("the real-aw tests can skip without failing the job");
  if (!/OATS_RESIDENT_JOURNEY_REQUIRED: '1'\n[\s\S]*?OATS_RESIDENT_JOURNEY_AW: \$\{\{ runner\.temp \}\}\/aw\/node_modules\/\.bin\/aw\n/.test(job)) problems.push("the resident journeys are not required to run on the installed aw");
  return problems;
}

test("the real-aw journeys run exactly aw-compat.json's [min, tested], each checked at its version and never skipped", () => {
  assert.deepEqual(journeyCoverProblems(CI, COMPAT), []);
});

test("the journey guard fails when the matrix and aw-compat.json differ", () => {
  const matrixLine = /\n( +)aw: \[[^\]]*\]\n/.exec(CI);
  assert.ok(matrixLine, "ci.yml's matrix line is found");
  const withMatrix = (list) => CI.replace(matrixLine[0], `\n${matrixLine[1]}aw: ${list}\n`);
  const stale = withMatrix("['1.36.33', '1.36.53']");
  assert.match(journeyCoverProblems(stale, { min: "1.36.33", tested: "1.36.56" }).join("\n"), /matrix is \['1\.36\.33', '1\.36\.53'\], not aw-compat\.json's \[min, tested\] \["1\.36\.33","1\.36\.56"\]/);
  assert.deepEqual(journeyCoverProblems(stale, { min: "1.36.33", tested: "1.36.53" }), [], "a matrix that matches its file passes");
  for (const list of [`['${COMPAT.tested}', '${COMPAT.min}']`, `['${COMPAT.min}']`, `['${COMPAT.min}', '1.36.40', '${COMPAT.tested}']`, `[${COMPAT.min}, ${COMPAT.tested}]`]) {
    assert.match(journeyCoverProblems(withMatrix(list), COMPAT).join("\n"), /resident-journey matrix is/, list);
  }
  const included = CI.replace(matrixLine[0], `${matrixLine[0]}${matrixLine[1]}include:\n${matrixLine[1]}  - aw: '1.36.40'\n`);
  assert.match(journeyCoverProblems(included, COMPAT).join("\n"), /must be the one line aw:/);
  // A blank or comment line inside the matrix doesn't end it.
  for (const gap of ["\n", `${matrixLine[1]}# a comment\n`, "\n\n"]) {
    for (const [key, entry] of [["exclude", `'${COMPAT.tested}'`], ["include", "'1.36.40'"]]) {
      const hidden = CI.replace(matrixLine[0], `${matrixLine[0]}${gap}${matrixLine[1]}${key}:\n${matrixLine[1]}  - aw: ${entry}\n`);
      assert.match(journeyCoverProblems(hidden, COMPAT).join("\n"), /must be the one line aw:/, `${key} after ${JSON.stringify(gap)}`);
    }
  }
});

test("the journey guard fails when a job could run another aw than its entry, or skip", () => {
  const check = `test "\${installed%%$'\\n'*}" = "aw $AW_VERSION"`;
  assert.ok(CI.includes(check), "the version check is in ci.yml");
  const problems = (ci) => journeyCoverProblems(ci, COMPAT).join("\n");
  assert.match(problems(CI.replace(check, "true")), /installed aw version is its matrix entry/);
  assert.match(problems(CI.replace("\n    timeout-minutes: 40\n", "\n    if: github.event_name == 'push'\n    timeout-minutes: 40\n")), /job-level if:/);
  assert.match(problems(CI.replace("\n    timeout-minutes: 40\n", "\n    continue-on-error: true\n    timeout-minutes: 40\n")), /continue-on-error/);
  assert.match(problems(CI.replace("OATS_RESIDENT_JOURNEY_REQUIRED: '1'", "OATS_RESIDENT_JOURNEY_REQUIRED: ''")), /journeys are not required/);
  assert.match(problems(CI.replace(`grep -q '^# skipped 0$' "$RUNNER_TEMP/real-aw.tap"`, "true")), /real-aw tests can skip/);
});

test("validate-and-test installs AW_TESTED, read from aw-floor.mjs, before npm test, and requires the aw-verb guard", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const job = ci.slice(ci.indexOf("\n  validate-and-test:"), ci.indexOf("\n  resident-journey:"));
  const install = job.indexOf("import {AW_TESTED} from './oats-package/capabilities/oats-aweb/lib/aw-floor.mjs'");
  assert.ok(install > 0, "the install step reads AW_TESTED from aw-floor.mjs");
  assert.match(job, /npm install --prefix "\$RUNNER_TEMP\/aw" --no-audit --no-fund "@awebai\/aw@\$version"/);
  assert.doesNotMatch(job, new RegExp(`aw@\\d|${AW_TESTED.replaceAll(".", "\\.")}`), "no aw version is written twice");
  const npmTest = job.indexOf("npm test");
  assert.ok(npmTest > install, "aw is installed before npm test");
  assert.match(job.slice(job.lastIndexOf("- name:", npmTest), npmTest + "npm test".length), /OATS_AW_VERBS_REQUIRED: '1'[\s\S]*PATH="\$RUNNER_TEMP\/aw\/node_modules\/\.bin:\$PATH" npm test$/);
});
