// oats.aweb 1.25: the single aw client floor is 1.36.32. aw 1.36.31 lets an
// agent reply to a sender outside its team roster; 1.36.32 mints grants that
// never expire (test/never-grant.test.mjs). Every path that refuses
// below the floor uses one wording; a host wake daemon below the floor is a
// readiness warning, not a problem; and an E2EE grant seat (the default)
// requires its running custody to report `mail_reply_continuation.v1`.
//
// Fake aw shapes: `aw version` ("aw 1.36.32" then commit/built lines) comes from
// the real npm @awebai/aw@1.36.32 (commit df6bb193), and the not-running
// `aw custody status --json` shape from the real aw 1.36.31 binary (2f77ffdb).
// A running custody's ops are derived from the aw source at df6bb193
// (cmd/aw/custody.go:306): status.v1, sign_plain_message.v1, sign_app_request.v1,
// grant_never_ttl.v1 and, only with E2EE keys, create_e2ee_envelope.v1,
// unwrap_e2ee_message.v1 and mail_reply_continuation.v1.
// `aw wake status --json` fields (daemon_running, daemon_version_state,
// daemon_version) are from the aw 1.36.30 binary and source (wake/status.go).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fakeAw } from "./helpers/fake-aw-grant.mjs";
import { AW_MIN } from "../oats-package/capabilities/oats-aweb/lib/binding-wire.mjs";
import { custodyPreflight } from "../oats-package/capabilities/oats-aweb/lib/grant-custody.mjs";
import { targetReceiveAssessment } from "../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs";
import { PROBE_RELEASE_SUPPORT } from "../oats-package/capabilities/oats-aweb/lib/probe-support.mjs";

const HOOK = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const BINDING = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb-binding.mjs", import.meta.url).pathname);
const TEAM = "t:example.test";
const INSTALL = "`npm i -g @awebai/aw@latest` (or `npm i -g @awebai/aw@1.36.32`)";
const OLD_AW = "aw 1.36.31 is older than required 1.36.32; upgrade with " + INSTALL;
// A 1.36.32 custody without encryption keys lists only these.
const SIGNING_OPS = ["status.v1", "sign_plain_message.v1", "sign_app_request.v1", "grant_never_ttl.v1"];
const OPS_1_36_32 = [...SIGNING_OPS, "create_e2ee_envelope.v1", "unwrap_e2ee_message.v1", "mail_reply_continuation.v1"];
const OPS_WITHOUT_CONTINUATION = OPS_1_36_32.filter(op => op !== "mail_reply_continuation.v1");
const CONTINUATION_REMEDY = "required custody operations are missing: mail_reply_continuation.v1; restart the custody on aw 1.36.32 or later (upgrade aw, restart the custody service and the wake daemon, then oats sync)";

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-125-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
const teamEnv = { OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]) };

/** A deployment root, an instance home in it and a GLOBAL resident's custody directory. */
function deployment(base) {
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "probe"); mkdirSync(home, { recursive: true });
  const custody = join(base, "custody", "merlin");
  write(join(custody, ".aw", "identity.yaml"), "alias: resident-alias\n");
  return { root, home, custody };
}
const globalSettings = (custody, identity = {}) => ({ identity: { mode: "global", resident: "merlin", ...identity }, residents: { merlin: custody } });

function runHook(bin, event, env) {
  const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OATS_EVENT: event, ...teamEnv, ...env } });
  let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
  return { ...r, doc };
}
function runCommand(bin, args, env = {}) {
  return spawnSync(process.execPath, [HOOK, ...args], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...teamEnv, ...env } });
}
function readiness(bin, settings, context, env = {}) {
  const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings, input: { action: { kind: "readiness" }, context } };
  const r = spawnSync(process.execPath, [BINDING, "check"], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...teamEnv, ...env } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout).result;
}

// ------------------------------------------------------------------ the floor

test("one client floor: AW_MIN is 1.36.32, and the probe and the manifest use it", () => {
  assert.equal(AW_MIN, "1.36.32");
  assert.equal(PROBE_RELEASE_SUPPORT.cliFloor, AW_MIN);
  const manifest = JSON.parse(readFileSync(new URL("../oats-package/capabilities/oats-aweb/oats.json", import.meta.url), "utf8"));
  assert.match(manifest.requires.find(r => r.command === "aw").why, /^aw >= 1\.36\.32: .*replies to senders outside the team roster, and grants that never expire$/);
});

test("readiness refuses aw below the floor naming the installed version, the floor and the install command", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root, home } = deployment(base);
  const result = readiness(bin, { root, delivery: "session" }, { kind: "workspace", workspace: root, deployment: root, soul: "dev", home }, { FAKE_AW_VERSION: "1.36.31" });
  assert.equal(result.status, "needs-configuration");
  assert.deepEqual(result.problems.filter(p => /older than required/.test(p.message)), [{ code: "needs-configuration", message: OLD_AW }]);
});

test("spawn refuses aw below the floor with the same wording, before minting anything", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root, home } = deployment(base);
  const r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify({ root }), FAKE_AW_VERSION: "1.36.31" });
  assert.notEqual(r.status, 0);
  assert.equal(r.doc.warning, `oats-aweb: ${OLD_AW}, so no identity could be minted and this instance would not meet the messaging contract`);
});

test("commands refuse aw below the floor with the same wording", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root } = deployment(base);
  const r = runCommand(bin, ["roster"], { OATS_WORKSPACE: root, FAKE_AW_VERSION: "1.36.31" });
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim(), `oats aweb roster: ${OLD_AW}`);
});

test("setup --check-only reports aw below the floor with the same wording", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root } = deployment(base);
  const r = runCommand(bin, ["setup", "--check-only", "--json"], { OATS_WORKSPACE: root, OATS_TEAM_SCOPE: root, FAKE_AW_VERSION: "1.36.31" });
  const doc = JSON.parse(r.stdout.trim().split("\n").at(-1));
  assert.equal(doc.aw.status, "needs-human");
  assert.equal(doc.aw.detail, OLD_AW);
});

test("a missing or unreadable aw names the floor and the install command", (t) => {
  const base = tempDir(t);
  const { root, home } = deployment(base);
  const empty = join(base, "empty-bin"); mkdirSync(empty);
  const context = { kind: "workspace", workspace: root, deployment: root, soul: "dev", home };
  let result = readiness(empty, { root, delivery: "session" }, context, { PATH: empty });
  assert.ok(result.problems.some(p => p.message === `aw CLI not on PATH; install aw >= 1.36.32 with ${INSTALL}`), JSON.stringify(result));
  const unreadable = join(base, "unreadable-bin"); write(join(unreadable, "aw"), "#!/bin/sh\nexit 42\n"); spawnSync("chmod", ["755", join(unreadable, "aw")]);
  result = readiness(unreadable, { root, delivery: "session" }, context);
  assert.ok(result.problems.some(p => p.message === `aw version could not be read; install aw >= 1.36.32 with ${INSTALL}`), JSON.stringify(result));
});

// ------------------------------------------------------- the host wake daemon

const reported = (version, extra = {}) => ({ daemon_running: true, daemon_version_state: "reported", daemon_version: version, instances: [], ...extra });
const expected = { home: "/nonexistent/home", runtimeDelivery: "external-session", bindings: [] };

test("a wake daemon below the floor is the wake-daemon-outdated warning, and the target row is still assessed", () => {
  const assessed = targetReceiveAssessment(reported("1.36.31"), expected, { minimumVersion: AW_MIN });
  assert.deepEqual(assessed.warnings, [{ code: "wake-daemon-outdated", message: "host wake daemon is running 1.36.31; required 1.36.32: upgrade aw, then restart the host wake daemon" }]);
  assert.deepEqual(assessed.problems.map(p => p.code), ["wake-target-missing"], "assessment continues past the version to the target row");
  assert.deepEqual(targetReceiveAssessment(reported("1.36.32"), expected, { minimumVersion: AW_MIN }).warnings, []);
});

test("a wake daemon that is not running or reports no version is still a problem", () => {
  for (const [status, code] of [
    [{ daemon_running: false, daemon_version_state: "not_running", instances: [] }, "wake-daemon-not-running"],
    [{ daemon_running: true, daemon_version_state: "unknown", instances: [] }, "wake-daemon-version-unknown"],
  ]) {
    const assessed = targetReceiveAssessment(status, expected, { minimumVersion: AW_MIN });
    assert.deepEqual(assessed.problems.map(p => p.code), [code]);
    assert.equal(assessed.warnings.some(w => w.code === "wake-daemon-outdated"), false);
  }
});

// ------------------------------- custody reply continuation (E2EE grant seats)

/** custodyPreflight against one running `aw custody status --json` document. */
function preflightWith(ops, { e2eeRequired = true, encryptionReady = true } = {}) {
  const status = { status: "running", socket_path: "/run/custody.sock", teams: [{ team_id: TEAM, ready: true, certificate_present: true }], keys: { signing_ready: true, encryption_ready: encryptionReady }, ops, errors: [] };
  return custodyPreflight({ custody: "/custody", resident: "merlin", team: TEAM, e2eeRequired, runAw: () => JSON.stringify(status), fatalOnError: false });
}

test("an E2EE grant seat requires mail_reply_continuation.v1 from its running custody", () => {
  assert.deepEqual(preflightWith(OPS_1_36_32).warnings, []);
  assert.throws(() => preflightWith(OPS_WITHOUT_CONTINUATION), { message: `custody preflight failed for merlin: status=running; ${CONTINUATION_REMEDY}` });
});

test("a custody whose status cannot be read says so, and never that it lacks the op", () => {
  const preflight = (runAw) => custodyPreflight({ custody: "/custody", resident: "merlin", team: TEAM, runAw, fatalOnError: false });
  for (const [runAw, why] of [
    [() => { throw new Error("aw custody status failed (exit 1)"); }, "custody status could not be read: aw custody status failed (exit 1)"],
    [() => "custody socket not reachable", "custody status could not be read: aw custody status returned no JSON result"],
    [() => "[]", "custody status could not be read: aw custody status returned no status object"],
    [() => JSON.stringify({ status: "running", teams: [{ team_id: TEAM, ready: true, certificate_present: true }], keys: { signing_ready: true, encryption_ready: true } }), "custody status could not be read: it lists no ops"],
  ]) {
    assert.throws(() => preflight(runAw), (error) => error.message.includes(why) && !error.message.includes("mail_reply_continuation.v1") && !/operations are missing/.test(error.message), why);
  }
  // Real aw 1.36.31 (npm darwin-arm64, 2f77ffdb) with no custody running: ops is null.
  const notRunning = { status: "not_running", socket_path: "/x/.aw/run/custody.sock", resident: {}, teams: null, keys: null, ops: null, freshness: null, errors: ["custody_unavailable"] };
  assert.throws(() => preflight(() => JSON.stringify(notRunning)), (error) => /status=not_running error=custody_unavailable; custody service is not running/.test(error.message) && !error.message.includes("mail_reply_continuation.v1"));
});

test("a custody missing its E2EE ops as well keeps the serve remedy; only a missing continuation op asks for a restart on the floor", () => {
  assert.throws(() => preflightWith(SIGNING_OPS), { message: "custody preflight failed for merlin: status=running; required custody operations are missing: unwrap_e2ee_message.v1, create_e2ee_envelope.v1, mail_reply_continuation.v1; start aw custody serve for merlin" });
});

test("an e2ee: false seat on a custody without encryption keys or the op stays ready", () => {
  const preflight = preflightWith(SIGNING_OPS, { e2eeRequired: false, encryptionReady: false });
  assert.deepEqual(preflight.warnings, ["E2E encryption is disabled for this grant and custody encryption is not ready; encrypted mail/chat will not be available in this session."]);
});

test("grant-seat readiness: the op present is ready, absent is the custody problem with the restart remedy", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root, home, custody } = deployment(base);
  const context = { kind: "workspace", workspace: root, deployment: root, soul: "dev", home };
  let result = readiness(bin, { root, ...globalSettings(custody) }, context, { FAKE_CUSTODY_OPS: OPS_1_36_32.join(",") });
  assert.equal(result.problems.some(p => p.code === "custody"), false, JSON.stringify(result));
  result = readiness(bin, { root, ...globalSettings(custody) }, context, { FAKE_CUSTODY_OPS: OPS_WITHOUT_CONTINUATION.join(",") });
  assert.equal(result.status, "needs-configuration");
  assert.deepEqual(result.problems.filter(p => p.code === "custody"), [{ code: "custody", message: `custody preflight failed for merlin: status=running; ${CONTINUATION_REMEDY}` }]);
  result = readiness(bin, { root, ...globalSettings(custody, { e2ee: false }) }, context, { FAKE_CUSTODY_OPS: SIGNING_OPS.join(","), FAKE_ENCRYPTION_READY: "0" });
  assert.equal(result.problems.some(p => p.code === "custody"), false, "e2ee: false does not require the op");
  assert.ok(result.warnings.some(w => w.code === "e2ee-disabled"), JSON.stringify(result));
});

test("a LOCAL seat never asks custody, whatever its ops", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root, home } = deployment(base);
  const result = readiness(bin, { root, delivery: "session" }, { kind: "workspace", workspace: root, deployment: root, soul: "dev", home }, { FAKE_CUSTODY_OPS: OPS_WITHOUT_CONTINUATION.join(",") });
  assert.equal(result.problems.some(p => p.code === "custody"), false, JSON.stringify(result));
  assert.equal(readFileSync(join(base, "aw.log"), "utf8").split("\n").filter(Boolean).some(l => JSON.parse(l).argv.slice(0, 2).join(" ") === "custody status"), false);
});

test("grant spawn: the op present mints; absent fails preflight before any mint, with the restart remedy", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root, home, custody } = deployment(base);
  const env = (ops) => ({ OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify(globalSettings(custody)), FAKE_CUSTODY_OPS: ops.join(",") });
  let r = runHook(bin, "spawn", env(OPS_WITHOUT_CONTINUATION));
  assert.notEqual(r.status, 0);
  assert.equal(r.doc.warning, `oats-aweb: custody preflight failed for merlin: status=running; ${CONTINUATION_REMEDY}`);
  assert.equal(readFileSync(join(base, "aw.log"), "utf8").includes('"mint"'), false, "nothing is minted");
  r = runHook(bin, "spawn", env(OPS_1_36_32));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.doc.meta.identity.grant.id);
});

test("the agent's brief keeps e2ee-disabled, and a renewing launch surfaces the preflight warnings", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root, home, custody } = deployment(base);
  const e2eeOff = { OATS_SETTINGS: JSON.stringify(globalSettings(custody, { e2ee: false })), FAKE_CUSTODY_OPS: SIGNING_OPS.join(","), FAKE_ENCRYPTION_READY: "0" };
  const spawned = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, ...e2eeOff });
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  assert.match(spawned.doc.brief, / Warning: E2E encryption is disabled for this grant/);
  const launched = runHook(bin, "launch", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_META: JSON.stringify(spawned.doc.meta), ...e2eeOff });
  assert.equal(launched.status, 0, launched.stdout + launched.stderr);
  assert.notEqual(launched.doc.meta.identity.grant.id, spawned.doc.meta.identity.grant.id, "the launch renewed the grant");
  assert.match(launched.doc.warning, /E2E encryption is disabled for this grant/);
});
