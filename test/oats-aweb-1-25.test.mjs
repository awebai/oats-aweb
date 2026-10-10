// oats.aweb 1.25: the single aw client floor is 1.36.30, the version that lets
// an agent reply to a sender outside its team roster. Every path that refuses
// below the floor uses one wording; a host wake daemon below the floor is a
// readiness warning, not a problem; and a grant seat's readiness warns that a
// running custody service cannot be shown to continue such replies until its
// status reports `mail_reply_continuation.v1`.
//
// Fake aw shapes follow the real aw 1.36.30 (npm @awebai/aw@1.36.30, commit
// ee55192): `aw version` prints "aw 1.36.30" then commit/built lines; `aw wake
// status --json` reports daemon_running, daemon_version_state and
// daemon_version; `aw custody status --json` reports status, teams, keys and
// ops, where a 1.36.30 custody's ops are status.v1, sign_plain_message.v1,
// sign_app_request.v1 and, with E2EE keys, create_e2ee_envelope.v1 and
// unwrap_e2ee_message.v1. The ops with `mail_reply_continuation.v1` model aw
// 1.36.31, which is synthetic here.
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
const INSTALL = "`npm i -g @awebai/aw@latest` (or `npm i -g @awebai/aw@1.36.30`)";
const OLD_AW = "aw 1.36.29 is older than required 1.36.30; upgrade with " + INSTALL;
const OPS_1_36_30 = ["status.v1", "sign_plain_message.v1", "sign_app_request.v1", "create_e2ee_envelope.v1", "unwrap_e2ee_message.v1"];
const OPS_WITH_CONTINUATION = [...OPS_1_36_30, "mail_reply_continuation.v1"];
const CONTINUATION = "custody-reply-continuation-unproven";

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

test("one client floor: AW_MIN is 1.36.30, and the probe and the manifest use it", () => {
  assert.equal(AW_MIN, "1.36.30");
  assert.equal(PROBE_RELEASE_SUPPORT.cliFloor, AW_MIN);
  const manifest = JSON.parse(readFileSync(new URL("../oats-package/capabilities/oats-aweb/oats.json", import.meta.url), "utf8"));
  assert.match(manifest.requires.find(r => r.command === "aw").why, /^aw >= 1\.36\.30: .*replies to senders outside the team roster$/);
});

test("readiness refuses aw below the floor naming the installed version, the floor and the install command", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root, home } = deployment(base);
  const result = readiness(bin, { root, delivery: "session" }, { kind: "workspace", workspace: root, deployment: root, soul: "dev", home }, { FAKE_AW_VERSION: "1.36.29" });
  assert.equal(result.status, "needs-configuration");
  assert.deepEqual(result.problems.filter(p => /older than required/.test(p.message)), [{ code: "needs-configuration", message: OLD_AW }]);
});

test("spawn refuses aw below the floor with the same wording, before minting anything", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root, home } = deployment(base);
  const r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify({ root }), FAKE_AW_VERSION: "1.36.29" });
  assert.notEqual(r.status, 0);
  assert.equal(r.doc.warning, `oats-aweb: ${OLD_AW}, so no identity could be minted and this instance would not meet the messaging contract`);
});

test("commands refuse aw below the floor with the same wording", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root } = deployment(base);
  const r = runCommand(bin, ["roster"], { OATS_WORKSPACE: root, FAKE_AW_VERSION: "1.36.29" });
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim(), `oats aweb roster: ${OLD_AW}`);
});

test("setup --check-only reports aw below the floor with the same wording", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root } = deployment(base);
  const r = runCommand(bin, ["setup", "--check-only", "--json"], { OATS_WORKSPACE: root, OATS_TEAM_SCOPE: root, FAKE_AW_VERSION: "1.36.29" });
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
  assert.ok(result.problems.some(p => p.message === `aw CLI not on PATH; install aw >= 1.36.30 with ${INSTALL}`), JSON.stringify(result));
  const unreadable = join(base, "unreadable-bin"); write(join(unreadable, "aw"), "#!/bin/sh\nexit 42\n"); spawnSync("chmod", ["755", join(unreadable, "aw")]);
  result = readiness(unreadable, { root, delivery: "session" }, context);
  assert.ok(result.problems.some(p => p.message === `aw version could not be read; install aw >= 1.36.30 with ${INSTALL}`), JSON.stringify(result));
});

// ------------------------------------------------------- the host wake daemon

const reported = (version, extra = {}) => ({ daemon_running: true, daemon_version_state: "reported", daemon_version: version, instances: [], ...extra });
const expected = { home: "/nonexistent/home", runtimeDelivery: "external-session", bindings: [] };

test("a wake daemon below the floor is the wake-daemon-outdated warning, and the target row is still assessed", () => {
  const assessed = targetReceiveAssessment(reported("1.36.29"), expected, { minimumVersion: AW_MIN });
  assert.deepEqual(assessed.warnings, [{ code: "wake-daemon-outdated", message: "host wake daemon is running 1.36.29; required 1.36.30: upgrade aw, then restart the host wake daemon" }]);
  assert.deepEqual(assessed.problems.map(p => p.code), ["wake-target-missing"], "assessment continues past the version to the target row");
  assert.deepEqual(targetReceiveAssessment(reported("1.36.30"), expected, { minimumVersion: AW_MIN }).warnings, []);
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

// ---------------------------------------- custody reply continuation (grants)

/** custodyPreflight against one `aw custody status --json` document. */
function preflightWith(ops) {
  const status = { status: "running", socket_path: "/run/custody.sock", teams: [{ team_id: TEAM, ready: true, certificate_present: true }], keys: { signing_ready: true, encryption_ready: true }, ops, errors: [] };
  return custodyPreflight({ custody: "/custody", resident: "merlin", team: TEAM, runAw: () => JSON.stringify(status), fatalOnError: false });
}

test("custody preflight warns when the running custody does not report mail_reply_continuation.v1, and only then", () => {
  const warned = preflightWith(OPS_1_36_30).warnings;
  assert.deepEqual(warned.map(w => w.code), [CONTINUATION]);
  assert.match(warned[0].message, /cannot tell/);
  assert.match(warned[0].message, /not a detected fault/);
  assert.match(warned[0].message, /restart the custody service after upgrading aw/);
  assert.deepEqual(preflightWith(OPS_WITH_CONTINUATION).warnings, []);
});

test("the continuation op is not required: a custody without it still passes preflight", () => {
  assert.doesNotThrow(() => preflightWith(OPS_1_36_30));
});

test("grant-seat readiness carries the continuation warning; a 1.36.31 custody clears it", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root, home } = deployment(base);
  const context = { kind: "workspace", workspace: root, deployment: root, soul: "dev", home };
  let result = readiness(bin, { root, ...globalSettings(join(base, "custody", "merlin")) }, context, { FAKE_AW_VERSION: "1.36.30", FAKE_CUSTODY_OPS: OPS_1_36_30.join(",") });
  const warning = result.warnings.find(w => w.code === CONTINUATION);
  assert.ok(warning, JSON.stringify(result));
  assert.equal(result.problems.some(p => p.code === CONTINUATION), false, "a warning, never a problem");
  result = readiness(bin, { root, ...globalSettings(join(base, "custody", "merlin")) }, context, { FAKE_AW_VERSION: "1.36.30", FAKE_CUSTODY_OPS: OPS_WITH_CONTINUATION.join(",") });
  assert.equal(result.warnings.some(w => w.code === CONTINUATION), false, JSON.stringify(result));
});

test("a self-custodial (LOCAL) seat never gets the continuation warning and never asks custody", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root, home } = deployment(base);
  const result = readiness(bin, { root, delivery: "session" }, { kind: "workspace", workspace: root, deployment: root, soul: "dev", home }, { FAKE_AW_VERSION: "1.36.30", FAKE_CUSTODY_OPS: OPS_1_36_30.join(",") });
  assert.equal(result.warnings.some(w => w.code === CONTINUATION), false, JSON.stringify(result));
});

test("grant spawn reports the continuation warning to the operator, never in the agent's brief", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root, home, custody } = deployment(base);
  let r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify(globalSettings(custody)), FAKE_AW_VERSION: "1.36.30", FAKE_CUSTODY_OPS: OPS_1_36_30.join(",") });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.doc.warning, new RegExp(`oats-aweb: ${CONTINUATION} — .*restart the custody service after upgrading aw`));
  assert.doesNotMatch(r.doc.brief, new RegExp(CONTINUATION));
  assert.doesNotMatch(r.doc.brief, /restart the custody service/);
  rmSync(join(home, ".aweb-identity"), { recursive: true, force: true });
  r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify(globalSettings(custody)), FAKE_AW_VERSION: "1.36.30", FAKE_CUSTODY_OPS: OPS_WITH_CONTINUATION.join(",") });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.doc.warning || "", new RegExp(CONTINUATION));
});

test("e2ee-disabled still reaches the brief alongside the continuation warning", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root, home, custody } = deployment(base);
  const r = runHook(bin, "spawn", { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify(globalSettings(custody, { e2ee: false })), FAKE_AW_VERSION: "1.36.30", FAKE_CUSTODY_OPS: "status.v1,sign_plain_message.v1,sign_app_request.v1", FAKE_ENCRYPTION_READY: "0" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.doc.brief, / Warning: E2E encryption is disabled for this grant/);
  assert.doesNotMatch(r.doc.brief, new RegExp(CONTINUATION));
  assert.match(r.doc.warning, /E2E encryption is disabled/);
  assert.match(r.doc.warning, new RegExp(CONTINUATION));
});

test("a renewing launch reports the continuation warning; preview and renew: off ask custody nothing", (t) => {
  const base = tempDir(t);
  const bin = fakeAw(base); const { root, home, custody } = deployment(base);
  mkdirSync(join(home, ".aweb-identity"), { recursive: true });
  const old = { delivery: "channel", identity: { mode: "global", alias: "resident-alias", team: TEAM, resident: "merlin", grant: { id: "grant-old", expiresAt: "old", scopes: ["mail.read"], home: join(home, ".aweb-identity") } } };
  const env = (identity, extra = {}) => ({ OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_META: JSON.stringify(old), OATS_SETTINGS: JSON.stringify(globalSettings(custody, identity)), FAKE_AW_VERSION: "1.36.30", FAKE_CUSTODY_OPS: OPS_1_36_30.join(","), ...extra });
  let r = runHook(bin, "launch", env({ renew: "launch" }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.doc.warning, new RegExp(`oats-aweb: ${CONTINUATION} — `));
  for (const [identity, extra] of [[{ renew: "launch" }, { OATS_LAUNCH_PREVIEW: "1" }], [{ renew: "off" }, {}]]) {
    r = runHook(bin, "launch", env(identity, extra));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.doc.warning || "", new RegExp(CONTINUATION));
  }
});
