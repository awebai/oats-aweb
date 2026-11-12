// awebai/oats-aweb#232: `oats spawn --provider oats.aweb key=value` delivers every value as a
// string, so a boolean setting arrives as "true" or "false". Every boolean setting oats.aweb
// reads (identity.e2ee, identity.takeOver, health.publish) accepts true/false and the strings
// "true"/"false", and refuses anything else before any effect, naming the setting, the
// accepted values and where to set it. Spawn, start and readiness read them through one
// helper, so readiness reports the refusal spawn gives.
//
// Fake aw shapes are test/helpers/fake-aw-grant.mjs's; a running custody's ops follow aw
// 1.36.32 (see test/oats-aweb-1-25.test.mjs): the E2EE ops and mail_reply_continuation.v1
// come only with E2EE keys.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fakeAw } from "./helpers/fake-aw-grant.mjs";
import { healthSettings } from "../oats-package/capabilities/oats-aweb/lib/health-settings.mjs";

const HOOK = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const BINDING = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb-binding.mjs", import.meta.url).pathname);
const TEAM = "t:example.test";
const SIGNING_OPS = ["status.v1", "sign_plain_message.v1", "sign_app_request.v1", "grant_never_ttl.v1"];
const ALL_OPS = [...SIGNING_OPS, "create_e2ee_envelope.v1", "unwrap_e2ee_message.v1", "mail_reply_continuation.v1"];
const OPS_WITHOUT_CONTINUATION = ALL_OPS.filter((op) => op !== "mail_reply_continuation.v1");
const identityRefusal = (name) => `${name} must be true or false (the strings "true" and "false" are accepted too); set it under settings.oats.aweb.identity in oats-local.yaml, oats-workspace.yaml or the soul's soul.yaml, or pass \`--provider oats.aweb ${name}=true\` (or \`=false\`) to oats spawn; a home keeps the settings it was spawned with, so respawn it; nothing was changed`;
const HEALTH_REFUSAL = "health.publish must be true or false (the strings \"true\" and \"false\" are accepted too); set it under settings.oats.aweb.health in oats-local.yaml; nothing was changed";

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-232-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
const teamEnv = { OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]) };
/** A deployment root, an instance home in it and a GLOBAL resident's custody directory. */
function deployment(t) {
  const base = tempDir(t);
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "probe"); mkdirSync(home, { recursive: true });
  const custody = join(base, "custody", "merlin");
  write(join(custody, ".aw", "identity.yaml"), "alias: resident-alias\n");
  return { base, root, home, custody, bin: fakeAw(base) };
}
const globalSettings = (fx, identity = {}) => ({ identity: { mode: "global", resident: "merlin", ...identity }, residents: { merlin: fx.custody } });
function runHook(fx, event, settings, env = {}) {
  const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, OATS_EVENT: event, ...teamEnv,
    OATS_INSTANCE: "probe", OATS_HOME: fx.home, OATS_WORKSPACE: fx.root, OATS_CONTEXT: fx.root, OATS_SETTINGS: JSON.stringify(settings), ...env } });
  let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
  return { ...r, doc };
}
function readiness(fx, settings, env = {}) {
  const context = { kind: "workspace", workspace: fx.root, deployment: fx.root, soul: "dev" };
  const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings, input: { action: { kind: "readiness" }, context } };
  const r = spawnSync(process.execPath, [BINDING, "check"], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, ...teamEnv, ...env } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout).result;
}
const awCalls = (fx) => { try { return readFileSync(join(fx.base, "aw.log"), "utf8").trim().split(/\n/).filter(Boolean).map((l) => JSON.parse(l).argv.join(" ")); } catch { return []; } };
const READ_ONLY_PROBES = ["version", "wake status --json"];

// Pinned acceptance: identity.e2ee: "false" → E2EE not required (the grant path's custody op
// check for mail_reply_continuation.v1 is not made).
test("identity.e2ee \"false\" does not require E2EE: a custody without mail_reply_continuation.v1 mints", (t) => {
  const fx = deployment(t);
  const r = runHook(fx, "spawn", globalSettings(fx, { e2ee: "false" }), { FAKE_CUSTODY_OPS: SIGNING_OPS.join(","), FAKE_ENCRYPTION_READY: "0" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.doc.meta.identity.grant.id, "the grant is minted");
  assert.match(r.doc.brief, /E2E encryption is disabled for this grant/);
});

// Pinned acceptance: "true" and true → required.
for (const e2ee of ["true", true]) {
  test(`identity.e2ee ${JSON.stringify(e2ee)} requires E2EE: a custody without mail_reply_continuation.v1 refuses before any mint`, (t) => {
    const fx = deployment(t);
    const r = runHook(fx, "spawn", globalSettings(fx, { e2ee }), { FAKE_CUSTODY_OPS: OPS_WITHOUT_CONTINUATION.join(",") });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.doc.warning, /required custody operations are missing: mail_reply_continuation\.v1/);
    assert.equal(awCalls(fx).some((a) => a.startsWith("id grant mint")), false, "nothing is minted");
  });
}

// Pinned acceptance: "yes", 1, "False" → refused naming identity.e2ee and the accepted values, no effect.
for (const e2ee of ["yes", 1, "False"]) {
  test(`identity.e2ee ${JSON.stringify(e2ee)} is refused at spawn, naming the setting and the accepted values, before any effect`, (t) => {
    const fx = deployment(t);
    const r = runHook(fx, "spawn", globalSettings(fx, { e2ee }), { FAKE_CUSTODY_OPS: ALL_OPS.join(",") });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(r.doc.warning, `oats-aweb: ${identityRefusal("identity.e2ee")}`);
    assert.equal(r.doc.meta, undefined, "no seat is reported");
    assert.deepEqual(awCalls(fx).filter((a) => !READ_ONLY_PROBES.includes(a)), [], "no aw command runs but the read-only probes");
    assert.equal(existsSync(join(fx.home, ".aweb-identity")), false, "no grant home");
    assert.equal(existsSync(join(fx.home, ".oats-aweb")), false, "no provider state");
  });
}

test("a start refuses a bad identity.e2ee the same way, before any renewal", (t) => {
  const fx = deployment(t);
  const spawned = runHook(fx, "spawn", globalSettings(fx), { FAKE_CUSTODY_OPS: ALL_OPS.join(",") });
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const before = awCalls(fx).length;
  const r = runHook(fx, "launch", globalSettings(fx, { e2ee: "yes" }), { OATS_META: JSON.stringify(spawned.doc.meta), FAKE_CUSTODY_OPS: ALL_OPS.join(",") });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.doc.warning, `oats-aweb: ${identityRefusal("identity.e2ee")}`);
  assert.deepEqual(awCalls(fx).slice(before).filter((a) => !READ_ONLY_PROBES.includes(a)), [], "no renewal or other aw effect");
});

test("a bad identity.takeOver is refused at spawn on every route, naming the setting", (t) => {
  const fx = deployment(t);
  const r = runHook(fx, "spawn", globalSettings(fx, { takeOver: "yes" }), { FAKE_CUSTODY_OPS: ALL_OPS.join(",") });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.doc.warning, `oats-aweb: ${identityRefusal("identity.takeOver")}`);
  assert.deepEqual(awCalls(fx).filter((a) => !READ_ONLY_PROBES.includes(a)), []);
});

test("a retire reads no boolean setting: a bad identity.e2ee never fails it", (t) => {
  const fx = deployment(t);
  const spawned = runHook(fx, "spawn", globalSettings(fx), { FAKE_CUSTODY_OPS: ALL_OPS.join(",") });
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const r = runHook(fx, "retire", globalSettings(fx, { e2ee: "yes", takeOver: 1 }), { OATS_META: JSON.stringify(spawned.doc.meta), FAKE_CUSTODY_OPS: ALL_OPS.join(",") });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /must be true or false/);
});

// Pinned acceptance: identity.takeOver: "true" still takes over.
test("identity.takeOver \"true\" still takes a retained seat over", (t) => {
  const base = tempDir(t);
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "retained"); mkdirSync(home, { recursive: true });
  const source = join(base, "seats", "retained", ".aw");
  write(join(source, "signing.key"), "fixture-signing-key");
  write(join(source, "identity.yaml"), "alias: retained\ndid: did:key:zRetained\naddress: fixture.test/retained\n");
  write(join(source, "teams.yaml"), `active_team: ${TEAM}\n`);
  write(join(source, "workspace.yaml"), "alias: retained\naweb_url: https://fixture.invalid/api\n");
  const lock = join(dirname(source), ".aw-retained-seat.json");
  write(lock, JSON.stringify({ home: join(base, "gone-home"), instance: "gone", host: "elsewhere" }));
  const fx = { base, root, home, bin: fakeAw(base) };
  const settings = (takeOver) => ({ delivery: "session", identity: { mode: "local", source, takeOver } });
  const refused = runHook(fx, "spawn", settings("false"), { OATS_INSTANCE: "retained", OATS_RUNTIME: "codex", FAKE_RETAINED: "1" });
  assert.equal(refused.status, 1, "\"false\" takes nothing over");
  const r = runHook(fx, "spawn", settings("true"), { OATS_INSTANCE: "retained", OATS_RUNTIME: "codex", FAKE_RETAINED: "1" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).home, home);
  assert.match(r.doc.warning, /took over the retained identity/);
});

// Pinned acceptance: readiness reports the same refusal as spawn for a bad value.
for (const [name, identity] of [["identity.e2ee", { e2ee: "yes" }], ["identity.takeOver", { takeOver: 1 }]]) {
  test(`readiness reports the refusal spawn gives for a bad ${name}`, (t) => {
    const fx = deployment(t);
    const spawned = runHook(fx, "spawn", globalSettings(fx, identity), { FAKE_CUSTODY_OPS: ALL_OPS.join(",") });
    assert.equal(spawned.status, 1);
    const result = readiness(fx, { root: fx.root, ...globalSettings(fx, identity) }, { FAKE_CUSTODY_OPS: ALL_OPS.join(",") });
    assert.equal(result.status, "needs-configuration");
    assert.ok(result.problems.some((p) => p.code === "needs-configuration" && `oats-aweb: ${p.message}` === spawned.doc.warning), JSON.stringify(result.problems));
  });
}

test("readiness accepts the strings \"true\" and \"false\" as spawn does", (t) => {
  const fx = deployment(t);
  const result = readiness(fx, { root: fx.root, ...globalSettings(fx, { e2ee: "false", takeOver: "true" }) }, { FAKE_CUSTODY_OPS: SIGNING_OPS.join(","), FAKE_ENCRYPTION_READY: "0" });
  assert.equal(result.problems.some((p) => /must be true or false/.test(p.message)), false, JSON.stringify(result.problems));
  assert.equal(result.problems.some((p) => p.code === "custody"), false, "e2ee \"false\" does not require the op");
});

test("health.publish accepts true/false and their strings, and refuses anything else naming where to set it", () => {
  for (const [value, publish] of [[true, true], ["true", true], [false, false], ["false", false], [undefined, false]]) {
    assert.equal(healthSettings({ health: value === undefined ? {} : { publish: value } }).publish, publish, JSON.stringify(value));
  }
  for (const value of ["yes", 1, "False", null]) {
    assert.throws(() => healthSettings({ health: { publish: value } }), { message: HEALTH_REFUSAL }, JSON.stringify(value));
  }
});

test("readiness reports the health.publish refusal, and accepts its strings", (t) => {
  const fx = deployment(t);
  for (const value of ["yes", 1, "False", null]) {
    const result = readiness(fx, { root: fx.root, delivery: "session", health: { publish: value } });
    assert.equal(result.status, "needs-configuration", JSON.stringify(value));
    assert.deepEqual(result.problems.filter((p) => /health\.publish/.test(p.message)), [{ code: "needs-configuration", message: HEALTH_REFUSAL }], JSON.stringify(value));
  }
  for (const value of ["true", "false"]) {
    const result = readiness(fx, { root: fx.root, delivery: "session", health: { publish: value } });
    assert.equal(result.problems.some((p) => /health\.publish/.test(p.message)), false, JSON.stringify(result.problems));
  }
});
