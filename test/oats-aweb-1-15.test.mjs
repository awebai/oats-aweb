import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertKernelCheckAnswerRule } from "./helpers/kernel-check-answer-rule.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CAPABILITY = join(REPO, "oats-package", "capabilities", "oats-aweb");
const HOOK = join(CAPABILITY, "bin", "oats-aweb.mjs");
const BINDING = join(CAPABILITY, "bin", "oats-aweb-binding.mjs");
const HOSTED_KEY = "github.com/acme/agents";
const digest = (key) => createHash("sha256").update(key).digest("hex");
const PERSONAL_TEAM = `personal-${digest(HOSTED_KEY).slice(0, 8)}:alice.aweb.ai`;

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-115-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

/** A fake aw 1.36.12 modelling the 1.15 surface: personal ensure (cred-root
 *  binding marker), read-only spawn-authority, host auth status, multi-identity
 *  wake registration and wake status derived from the stored registration. */
function fakeAw115(t, { auth = "authorized", canSpawn = true, daemon = true, version = "1.36.12" } = {}) {
  const base = tempDir(t);
  const bin = join(base, "bin");
  const calls = join(base, "calls.jsonl");
  const reg = join(base, "registrations.json");
  write(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
let args = process.argv.slice(2), identityHome = null;
if (args[0] === "--identity-home") { identityHome = args[1]; args = args.slice(2); }
let stdin = "";
if (args.includes("--registration-json")) { try { stdin = fs.readFileSync(0, "utf8"); } catch {} }
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, cwd: process.cwd(), identityHome, stdin }) + "\\n");
const emit = (o) => console.log(JSON.stringify(o));
const regs = () => { try { return JSON.parse(fs.readFileSync(${JSON.stringify(reg)}, "utf8")); } catch { return {}; } };
const saveRegs = (r) => fs.writeFileSync(${JSON.stringify(reg)}, JSON.stringify(r));
const flag = (n) => args.includes(n) ? args[args.indexOf(n) + 1] : undefined;
const home = () => identityHome || path.join(process.cwd(), ".aw");
if (args[0] === "version") { console.log("aw ${version} 44786439"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") { emit({ status: process.env.FAKE_AUTH || ${JSON.stringify(auth)} }); process.exit(0); }
if (args[0] === "team" && args[1] === "ensure") {
  if (!identityHome) { console.error("aw team ensure requires explicit --identity-home"); process.exit(2); }
  const key = flag("--workspace-key");
  if (key.startsWith("local/")) { console.error("workspace-key-not-portable: local workspace keys cannot be used for hosted personal team ensure"); process.exit(2); }
  if ((process.env.FAKE_AUTH || ${JSON.stringify(auth)}) !== "authorized") { console.error("authorization-required: run \`aw auth login\` before \`aw team ensure\`"); process.exit(2); }
  const d = crypto.createHash("sha256").update(key).digest("hex"), team = "personal-" + d.slice(0, 8) + ":alice.aweb.ai";
  fs.mkdirSync(identityHome, { recursive: true });
  fs.writeFileSync(path.join(identityHome, "personal-workspace-binding.yaml"), "version: 1\\nissuer: https://app.aweb.ai\\nworkspace_key_sha256: " + d + "\\nteam_id: " + team + "\\ncanonical_team_id: " + team + "\\nbound_at: 2026-09-26T00:00:00Z\\n");
  fs.writeFileSync(path.join(identityHome, "teams.yaml"), "active_team: " + team + "\\n");
  emit({ status: "bound", team_id: team, canonical_team_id: team, identity_home: identityHome, identity_scope: "local", did: "did:key:zFAKE", alias: "personal", created: true, reused: false, can_spawn: true });
  process.exit(0);
}
if (args[0] === "team" && args[1] === "spawn-authority") { emit({ team_id: flag("--team-id"), can_spawn: ${JSON.stringify(canSpawn)} && !process.env.FAKE_NO_SPAWN, live_agent: true, auth_kind: "team_cert" }); process.exit(0); }
if (args[0] === "team" && args[1] === "list") { emit({ active_team: "legacy:example.test", memberships: [{ team_id: "legacy:example.test" }, { team_id: "alpha:example.test" }, { team_id: "beta:example.test" }] }); process.exit(0); }
if (args[0] === "team" && args[1] === "invite") { if (identityHome) { console.error('command "aw team invite" is not yet identity-home-aware'); process.exit(2); } emit({ token: "TOKEN__" + flag("--team-id") }); process.exit(0); }
if (args[0] === "team" && args[1] === "join") { const team = args[2].replace(/^TOKEN__/, ""), alias = flag("--name"); fs.mkdirSync(home(), { recursive: true }); fs.writeFileSync(path.join(home(), "identity.yaml"), "alias: " + alias + "\\n"); emit({ alias, team_id: team }); process.exit(0); }
if (args[0] === "id" && args[1] === "team" && args[2] === "accept-invite") { const team = args[3].replace(/^TOKEN__/, ""), alias = flag("--name"); fs.mkdirSync(path.join(home(), "team-certs"), { recursive: true }); fs.writeFileSync(path.join(home(), "workspace.yaml"), "alias: " + alias + "\\n"); emit({ status: "accepted", team_id: team, alias }); process.exit(0); }
if (args[0] === "id" && args[1] === "team" && args[2] === "members") { emit({ team_id: flag("--team-id"), members: [{ alias: "dev-1" }, { alias: "alice" }] }); process.exit(0); }
if (args[0] === "init") { console.log("initialized"); process.exit(0); }
if (args[0] === "workspace" && args[1] === "delete") { fs.rmSync(home(), { recursive: true, force: true }); emit({ alias: args[2], alias_released: true, alias_released_reason: "released" }); process.exit(0); }
if (args[0] === "wake" && args[1] === "register") {
  const r = regs();
  if (args.includes("--registration-json")) { const doc = JSON.parse(stdin); if (process.env.FAKE_WAKE_REFUSE) { console.error("refused"); process.exit(2); } r[doc.home] = doc; }
  else r[flag("--home")] = { home: flag("--home"), identity_home: flag("--identity-home"), delivery: flag("--delivery") };
  saveRegs(r); console.log("registered"); process.exit(0);
}
if (args[0] === "wake" && args[1] === "deregister") { const r = regs(); delete r[flag("--home")]; saveRegs(r); console.log("deregistered"); process.exit(0); }
if (args[0] === "wake" && args[1] === "status") {
  const running = !process.env.FAKE_DAEMON_DOWN && ${JSON.stringify(daemon)};
  const instances = Object.values(regs()).map((doc) => ({ home: doc.home, delivery: doc.delivery, runtime_delivery: doc.runtime_delivery, phase: running ? "present" : "pending", receive_identities: (doc.receive_identities || [{ identity_home: doc.identity_home }]).map((ri) => ({ ...ri, stream_admitted: running, stream_phase: running ? "connected" : "daemon-down" })) }));
  emit({ daemon_running: running, daemon_version_state: running ? "reported" : "not_running", daemon_version: running ? "1.36.12" : undefined, instances });
  process.exit(0);
}
console.error("unexpected fake aw " + args.join(" ")); process.exit(93);
`);
  spawnSync("chmod", ["755", join(bin, "aw")]);
  return {
    path: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    readCalls: () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [],
    registrations: () => { try { return JSON.parse(readFileSync(reg, "utf8")); } catch { return {}; } },
  };
}

const teamsEnv = JSON.stringify([
  { label: "alpha", team: "alpha:example.test", mapped: true, payload: { team: "alpha:example.test" } },
  { label: "beta", team: "beta:example.test", mapped: true, payload: { team: "beta:example.test" } },
]);

function fixture(t, { key = HOSTED_KEY, settings = {}, delivery, runtime = "claude", legacyRoot = false } = {}) {
  const ws = tempDir(t), home = join(ws, "agents", "dev", "instances", "dev-1");
  mkdirSync(home, { recursive: true });
  if (legacyRoot) { mkdirSync(join(ws, ".aw"), { recursive: true }); writeFileSync(join(ws, ".aw", "teams.yaml"), "active_team: legacy:example.test\n"); }
  const merged = { ...(delivery ? { delivery } : {}), ...settings };
  const env = {
    OATS_HOME: home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: ws, OATS_WORKSPACE_KEY: key, OATS_WORKSPACE_NAME: "acme",
    OATS_TEAM_LABEL: "alpha", OATS_TEAM_LABELS: "alpha,beta", OATS_TEAMS: teamsEnv, OATS_TEAMS_SOURCE: "live",
    OATS_RUNTIME: runtime, OATS_SETTINGS: JSON.stringify(merged),
  };
  return { ws, home, env, settings: merged, personalRoot: join(ws, ".aweb-personal") };
}

function runHook(event, { cwd, env, args = [] }) {
  return spawnSync(process.execPath, [HOOK, event, ...args], { cwd, env: { ...env, OATS_EVENT: event }, encoding: "utf8", timeout: 20000 });
}
function spawnDoc(result) { assert.equal(result.status, 0, result.stdout + result.stderr); return JSON.parse(result.stdout.trim().split("\n").pop()); }
function check(fx, fake, settings = fx.settings) {
  const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: fx.env.OATS_WORKSPACE_KEY, deployment: fx.ws, soul: "dev", team: "alpha", instance: "dev-1", home: fx.home } } };
  const { OATS_SETTINGS, OATS_EVENT, OATS_HOME, OATS_RUNTIME, ...rest } = fx.env;
  const result = spawnSync(process.execPath, [BINDING, "check"], { cwd: fx.home, input: JSON.stringify(input), env: { ...rest, PATH: fake.path, OATS_INSTANCE_HOME: fx.home }, encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return assertKernelCheckAnswerRule(result.stdout, input, "oats-aweb 1.15 binding check").result;
}

test("1.15 manifest: version, roots.personal, oats-aweb skill", () => {
  const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  const dist = JSON.parse(readFileSync(join(REPO, "oats-package", "oats-package.json"), "utf8"));
  assert.equal(manifest.version, "1.15.0");
  assert.equal(pkg.version, "1.15.0");
  assert.equal(dist.version, "1.15.0");
  assert.match(manifest.settings.roots.description, /personal/);
  assert.equal(manifest.settings.roots.hostOnly, true);
  assert.ok(manifest.skills.includes("skills/oats-aweb"));
  assert.match(readFileSync(join(CAPABILITY, "skills", "oats-aweb", "SKILL.md"), "utf8"), /^---\nname: oats-aweb\n/);
});

test("spawn on a hosted workspace ensures the per-workspace personal team and mints into it", (t) => {
  const fake = fakeAw115(t);
  const fx = fixture(t);
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } }));
  assert.equal(doc.meta.team, PERSONAL_TEAM);
  assert.equal(doc.meta.identity.team, PERSONAL_TEAM);
  assert.deepEqual(doc.meta.personal, { team: PERSONAL_TEAM, source: "workspace", root: fx.personalRoot });
  const calls = fake.readCalls();
  const ensure = calls.find((c) => c.args[0] === "team" && c.args[1] === "ensure");
  assert.equal(ensure.identityHome, join(fx.personalRoot, ".aw"));
  assert.equal(ensure.args[ensure.args.indexOf("--workspace-key") + 1], HOSTED_KEY);
  const invite = calls.find((c) => c.args[0] === "team" && c.args[1] === "invite");
  assert.equal(invite.cwd, fx.personalRoot, "the personal authority mints from its own root (team invite is not identity-home-aware)");
  assert.equal(invite.identityHome, null);
  assert.equal(invite.args[invite.args.indexOf("--team-id") + 1], PERSONAL_TEAM);
  assert.match(doc.brief, /personal team/i);
  assert.equal(existsSync(join(fx.ws, ".aw")), false, "no shared legacy root is needed or created");

  // Second spawn: bound marker → no second ensure.
  const home2 = join(fx.ws, "agents", "dev", "instances", "dev-2");
  mkdirSync(home2, { recursive: true });
  spawnDoc(runHook("spawn", { cwd: home2, env: { ...fx.env, PATH: fake.path, OATS_HOME: home2, OATS_INSTANCE: "dev-2" } }));
  assert.equal(fake.readCalls().filter((c) => c.args[1] === "ensure").length, 1, "a bound personal root is reused, not re-ensured");
});

test("spawn honours an explicit roots.personal and refuses a root bound to another workspace", (t) => {
  const fake = fakeAw115(t);
  const fx = fixture(t);
  const personal = join(fx.ws, "host", "personal");
  const env = { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify({ roots: { personal } }) };
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env }));
  assert.equal(doc.meta.personal.root, personal);
  const home2 = join(fx.ws, "agents", "dev", "instances", "dev-2");
  mkdirSync(home2, { recursive: true });
  const other = runHook("spawn", { cwd: home2, env: { ...env, OATS_HOME: home2, OATS_INSTANCE: "dev-2", OATS_WORKSPACE_KEY: "github.com/acme/other" } });
  assert.notEqual(other.status, 0);
  assert.match(other.stdout, /bound to another workspace/);
  assert.equal(fake.readCalls().filter((c) => c.args[1] === "invite").length, 1, "no invite is minted for the refused spawn");
});

test("spawn without host aw login fails closed with the auth remedy and mints nothing", (t) => {
  const fake = fakeAw115(t, { auth: "missing" });
  const fx = fixture(t);
  const result = runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /authorization-required/);
  assert.match(result.stdout, /aw auth login/);
  assert.equal(fake.readCalls().some((c) => c.args[1] === "invite"), false);
});

test("spawn below the ensure aw floor refuses with E_TEAM_AW_FLOOR-style guidance", (t) => {
  const fake = fakeAw115(t, { version: "1.36.6" });
  const fx = fixture(t);
  const result = runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /aw >= 1\.36\.8/);
});

test("a local/ workspace key keeps the root's active team with the personal-team-local-workspace warning", (t) => {
  const fake = fakeAw115(t);
  const fx = fixture(t, { key: "local//srv/acme", legacyRoot: true });
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } }));
  assert.equal(doc.meta.team, "legacy:example.test");
  assert.equal(doc.meta.personal.source, "root-fallback");
  assert.match(doc.warning, /personal-team-local-workspace/);
  assert.equal(fake.readCalls().some((c) => c.args[1] === "ensure"), false);
  const result = check(fx, fake);
  assert.equal(result.status, "ready");
  assert.equal(result.warnings.find((w) => w.code === "personal-team-local-workspace").message, "this workspace's key is local-only; the per-workspace personal team needs a hosted workspace repository");
});

test("an explicit settings.team still wins over the personal team", (t) => {
  const fake = fakeAw115(t);
  const fx = fixture(t, { settings: { team: "alpha:example.test" }, legacyRoot: true });
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } }));
  assert.equal(doc.meta.team, "alpha:example.test");
  assert.equal(doc.meta.personal.source, "setting");
  assert.equal(fake.readCalls().some((c) => c.args[1] === "ensure"), false);
});

test("readiness is read-only: bound personal team uses the spawn-authority check, never a probe mint", (t) => {
  const fake = fakeAw115(t);
  const fx = fixture(t);
  spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } }));
  const before = fake.readCalls().length;
  let result = check(fx, fake);
  assert.equal(result.status, "ready", JSON.stringify(result));
  const readCalls = fake.readCalls().slice(before);
  assert.ok(readCalls.some((c) => c.args[1] === "spawn-authority" && c.identityHome === join(fx.personalRoot, ".aw")));
  assert.equal(readCalls.some((c) => ["ensure", "invite", "join"].includes(c.args[1]) || c.args[2] === "accept-invite"), false, "no probe mint");

  const denied = fakeAw115(t, { canSpawn: false });
  result = check(fx, denied);
  assert.equal(result.status, "needs-configuration");
  assert.equal(result.problems[0].code, "personal-team-no-spawn-authority");
});

test("readiness before first spawn: authorization-required without host login, pending with it", (t) => {
  const fx = fixture(t);
  let result = check(fx, fakeAw115(t, { auth: "missing" }));
  assert.equal(result.status, "authorization-required");
  assert.equal(result.problems[0].code, "personal-team-authorization-required");
  assert.match(result.problems[0].message, /aw auth login/);
  result = check(fx, fakeAw115(t));
  assert.equal(result.status, "ready");
  assert.ok(result.warnings.some((w) => w.code === "personal-team-pending"));
});

test("session delivery registers every joined identity with the broker and reports native receive", (t) => {
  const fake = fakeAw115(t);
  const fx = fixture(t, { delivery: "session", settings: { join: "alpha" } });
  mkdirSync(join(fx.ws, ".aw"), { recursive: true });
  const env = { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify({ delivery: "session", join: "alpha", root: fx.ws }) };
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env }));
  const reg = fake.registrations()[fx.home];
  assert.equal(reg.runtime_delivery, "external-session");
  assert.deepEqual(reg.receive_identities.map((r) => [r.label, r.identity_home, !!r.controls]), [
    ["personal", join(fx.home, ".aw"), true],
    ["alpha", join(fx.home, ".aweb-identity-alpha"), false],
  ]);
  assert.equal(doc.meta.joinedTeams[0].receive, "native");
  const listed = spawnSync(process.execPath, [HOOK, "teams", "--json"], { cwd: fx.home, env: { ...env, OATS_EVENT: "teams", OATS_META: JSON.stringify(doc.meta) }, encoding: "utf8" });
  assert.equal(JSON.parse(listed.stdout).joined[0].receive, "native");
  const result = check({ ...fx, settings: { delivery: "session", root: fx.ws } }, fake);
  assert.equal(result.status, "ready", JSON.stringify(result));
  assert.match(result.warnings.find((w) => w.code === "joined-team-receive").message, /alpha.*native/);
});

test("channel homes use aw's mixed mode: the channel keeps the primary, the broker takes joined teams", (t) => {
  const fake = fakeAw115(t);
  const fx = fixture(t, { runtime: "claude" });
  mkdirSync(join(fx.ws, ".aw"), { recursive: true });
  const env = { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify({ root: fx.ws }) };
  let doc = spawnDoc(runHook("spawn", { cwd: fx.home, env }));
  assert.equal(fake.registrations()[fx.home], undefined, "no joined team: a channel home is not registered");
  const joined = spawnSync(process.execPath, [HOOK, "join", "--labels", "alpha", "--json"], { cwd: fx.home, env: { ...env, OATS_EVENT: "join", OATS_META: JSON.stringify(doc.meta) }, encoding: "utf8" });
  assert.equal(joined.status, 0, joined.stdout + joined.stderr);
  const reg = fake.registrations()[fx.home];
  assert.equal(reg.runtime_delivery, "native-channel");
  assert.equal(reg.primary_identity_home, join(fx.home, ".aw"));
  assert.deepEqual(reg.receive_identities.map((r) => r.label), ["alpha"]);
  assert.equal(JSON.parse(joined.stdout).joined[0].receive, "native");

  // Leave: re-register before the identity home is removed; last team → deregister.
  const left = spawnSync(process.execPath, [HOOK, "leave", "--labels", "alpha", "--json"], { cwd: fx.home, env: { ...env, OATS_EVENT: "leave", OATS_META: JSON.stringify(doc.meta) }, encoding: "utf8" });
  assert.equal(left.status, 0, left.stdout + left.stderr);
  assert.equal(fake.registrations()[fx.home], undefined);
  const calls = fake.readCalls();
  const del = calls.findIndex((c) => c.args[0] === "workspace" && c.args[1] === "delete");
  const dereg = calls.findIndex((c) => c.args[0] === "wake" && c.args[1] === "deregister");
  assert.ok(dereg > del, "deregistration follows a confirmed release");
});

test("codex channel homes have no broker surface: joined teams stay poll with a reason", (t) => {
  const fake = fakeAw115(t);
  const fx = fixture(t, { runtime: "codex" });
  mkdirSync(join(fx.ws, ".aw"), { recursive: true });
  const env = { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify({ root: fx.ws, join: "alpha" }) };
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env }));
  assert.equal(doc.meta.joinedTeams[0].receive, "poll");
  assert.equal(fake.registrations()[fx.home], undefined);
  const result = check({ ...fx, settings: { root: fx.ws } }, fake);
  assert.match(result.warnings.find((w) => w.code === "joined-team-poll-only").message, /alpha/);
});

test("readiness reports poll when the wake daemon is down for a registered joined team", (t) => {
  const fake = fakeAw115(t);
  const fx = fixture(t, { runtime: "claude" });
  mkdirSync(join(fx.ws, ".aw"), { recursive: true });
  spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify({ root: fx.ws, join: "alpha" }) } }));
  const down = { ...fake, path: fake.path };
  const result = spawnSync(process.execPath, [BINDING, "check"], {
    cwd: fx.home,
    input: JSON.stringify({ schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: { root: fx.ws }, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: HOSTED_KEY, deployment: fx.ws, soul: "dev", team: "alpha", instance: "dev-1", home: fx.home } } }),
    env: { ...fx.env, PATH: down.path, FAKE_DAEMON_DOWN: "1" }, encoding: "utf8",
  });
  const doc = JSON.parse(result.stdout).result;
  assert.match(doc.warnings.find((w) => w.code === "joined-team-poll-only").message, /alpha.*wake daemon/);
});

test("retire deregisters a channel home that carried joined-team receive", (t) => {
  const fake = fakeAw115(t);
  const fx = fixture(t, { runtime: "pi" });
  mkdirSync(join(fx.ws, ".aw"), { recursive: true });
  const env = { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify({ root: fx.ws, join: "alpha" }) };
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env }));
  assert.equal(fake.registrations()[fx.home].runtime_delivery, "native-pi");
  const retired = runHook("retire", { cwd: fx.home, env: { ...env, OATS_META: JSON.stringify(doc.meta) } });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(fake.registrations()[fx.home], undefined);
});

// ---------------------------------------------------------------------------
// Real published aw (>= 1.36.12): the admission table for every 1.15 command
// under --identity-home, the broker registration shapes, and every aw
// invocation the skills and inject teach.
const REAL_AW_MIN = [1, 36, 12];
function realAw(t) {
  const v = spawnSync("aw", ["version"], { encoding: "utf8", timeout: 10000 });
  const m = /aw\s+v?(\d+)\.(\d+)\.(\d+)/.exec(`${v.stdout ?? ""}${v.stderr ?? ""}`);
  const ok = m && (() => { const a = m.slice(1, 4).map(Number); for (let i = 0; i < 3; i++) if (a[i] !== REAL_AW_MIN[i]) return a[i] > REAL_AW_MIN[i]; return true; })();
  if (!ok) { t.skip(`needs a published aw >= ${REAL_AW_MIN.join(".")} on PATH (found ${m ? m[0] : "none"})`); return false; }
  t.diagnostic(`aw version fixture: ${`${v.stdout}`.trim().split("\n")[0]}`);
  return true;
}
const POLICY = "not yet identity-home-aware";

test("real aw: admission table for the 1.15 commands under --identity-home", (t) => {
  if (!realAw(t)) return;
  const root = tempDir(t), empty = join(root, "empty"), idh = join(root, ".aweb-identity-alpha"), home = join(root, "home"), state = join(root, "wake-state");
  mkdirSync(idh, { recursive: true }); mkdirSync(home, { recursive: true }); mkdirSync(join(home, ".aw"), { recursive: true });
  const env = { ...process.env, AW_WAKE_STATE_DIR: state };
  const rows = [
    // admitted: fails on its own semantics, never on the identity-home policy
    { name: "team ensure (hosted key)", args: ["--identity-home", empty, "team", "ensure", "--workspace-key", "github.com/oats-scratch/admission", "--json"], admitted: true, expect: /authorization-required|unsupported-server|ensure/ },
    { name: "team ensure (local key)", args: ["--identity-home", empty, "team", "ensure", "--workspace-key", "local//tmp/x", "--json"], admitted: true, expect: /workspace-key-not-portable/ },
    { name: "team spawn-authority", args: ["--identity-home", idh, "team", "spawn-authority", "--team-id", "x:example.invalid", "--json"], admitted: true, expect: /initialized|identity|team|not found/i },
    { name: "mail inbox", args: ["--identity-home", idh, "mail", "inbox", "--json"], admitted: true, expect: /initialized|identity|workspace/i },
    { name: "mail send", args: ["--identity-home", idh, "mail", "send", "--to", "nobody", "--subject", "s", "--body", "b"], admitted: true, expect: /initialized|identity|workspace|recipient/i },
    { name: "mail reply", args: ["--identity-home", idh, "mail", "reply", "m-1", "--body", "b"], admitted: true, expect: /initialized|identity|workspace|message/i },
    { name: "mail ack", args: ["--identity-home", idh, "mail", "ack", "m-1"], admitted: true, expect: /initialized|identity|workspace|message/i },
    { name: "chat pending", args: ["--identity-home", idh, "chat", "pending"], admitted: true, expect: /initialized|identity|workspace/i },
    { name: "chat send-and-leave", args: ["--identity-home", idh, "chat", "send-and-leave", "nobody", "hi"], admitted: true, expect: /initialized|identity|workspace/i },
    { name: "workspace delete", args: ["--identity-home", idh, "workspace", "delete", "nobody", "--json"], admitted: true, expect: /initialized|identity|workspace|alias/i },
    { name: "whoami", args: ["--identity-home", idh, "whoami"], admitted: true, expect: /initialized|identity|workspace|not found/i },
    // refused by aw: why the personal authority mints from its root directory (cwd), not --identity-home
    { name: "team invite", args: ["--identity-home", idh, "team", "invite", "--team-id", "x:example.invalid", "--json"], admitted: false, expect: /aw team ensure, aw team spawn-authority/ },
    { name: "id team members", args: ["--identity-home", idh, "id", "team", "members", "--json"], admitted: false, expect: new RegExp(POLICY) },
  ];
  for (const row of rows) {
    const r = spawnSync("aw", row.args, { cwd: home, env, encoding: "utf8", timeout: 15000 });
    const text = `${r.stdout}${r.stderr}`;
    if (row.admitted) assert.doesNotMatch(text, new RegExp(POLICY), `${row.name}: hit the identity-home policy: ${text}`);
    else assert.match(text, new RegExp(POLICY), `${row.name}: expected the identity-home refusal: ${text}`);
    assert.notEqual(r.status, 0, `${row.name} unexpectedly succeeded`);
    assert.match(text, row.expect, `${row.name}: unexpected failure: ${text}`);
  }
  const auth = spawnSync("aw", ["auth", "status", "--json"], { cwd: home, env, encoding: "utf8", timeout: 15000 });
  assert.equal(auth.status, 0, auth.stderr);
  assert.equal(typeof JSON.parse(auth.stdout).status, "string", "aw auth status --json answers {status}");
});

test("real aw: the broker accepts the registrations oats.aweb writes (session, native-channel, native-pi)", async (t) => {
  if (!realAw(t)) return;
  const { wakeRegistration } = await import(join(CAPABILITY, "lib", "wake-receive.mjs"));
  const root = tempDir(t), home = join(root, "home"), state = join(root, "wake-state");
  for (const d of [join(home, ".aw"), join(home, ".aweb-identity-alpha"), join(home, ".aweb-identity-beta")]) mkdirSync(d, { recursive: true });
  const joined = [{ label: "alpha", identityHome: join(home, ".aweb-identity-alpha") }, { label: "beta", identityHome: join(home, ".aweb-identity-beta") }];
  for (const [delivery, runtime, expected] of [["session", "claude", "external-session"], ["channel", "claude", "native-channel"], ["channel", "pi", "native-pi"]]) {
    const doc = wakeRegistration({ home, primaryIdentityHome: join(home, ".aw"), delivery, runtime, joined });
    const r = spawnSync("aw", ["wake", "register", "--state-dir", state, "--registration-json", "-"], { input: JSON.stringify(doc), encoding: "utf8", timeout: 15000 });
    assert.equal(r.status, 0, `${expected}: ${r.stdout}${r.stderr}`);
    const status = JSON.parse(spawnSync("aw", ["wake", "status", "--state-dir", state, "--json"], { encoding: "utf8", timeout: 15000 }).stdout);
    const row = status.instances.find((i) => i.home === home);
    assert.equal(row.runtime_delivery, expected);
    const labels = row.receive_identities.map((ri) => ri.label);
    assert.deepEqual(labels, expected === "external-session" ? ["personal", "alpha", "beta"] : ["alpha", "beta"]);
  }
  const overlap = spawnSync("aw", ["wake", "register", "--state-dir", state, "--registration-json", "-"], { input: JSON.stringify({ home, runtime_delivery: "native-channel", primary_identity_home: join(home, ".aw"), receive_identities: [{ identity_home: join(home, ".aw") }] }), encoding: "utf8" });
  assert.notEqual(overlap.status, 0, "aw refuses a broker stream on the channel-owned primary");
  const dereg = spawnSync("aw", ["wake", "deregister", "--state-dir", state, "--home", home], { encoding: "utf8" });
  assert.equal(dereg.status, 0, dereg.stderr);
});

/** Every `aw …` invocation the agent guidance teaches, from code blocks and
 *  inline code: the subcommand path must exist and each --flag it uses must be
 *  on that command's help. */
function citedAwInvocations(text) {
  const out = [];
  const clean = (line) => line.replace(/\s+#.*$/, "").trim();
  for (const block of text.matchAll(/```(?:bash|sh)?\n([\s\S]*?)```/g)) for (const line of block[1].split("\n")) { const l = clean(line); if (/^aw\s/.test(l)) out.push(l); }
  for (const m of text.matchAll(/`(aw\s[^`]+)`/g)) out.push(m[1].trim());
  return [...new Set(out)];
}
function parseInvocation(inv) {
  let words = inv.split(/\s+/).slice(1);
  if (words[0] === "--identity-home") words = words.slice(2);
  const path = [];
  for (const w of words) { if (/^[a-z][a-z0-9-]*$/.test(w) && !w.includes("|")) path.push(w); else break; }
  const alt = words.find((w) => /^[a-z]+\|[a-z|]+$/.test(w));
  const flags = words.filter((w) => /^--[a-z][a-z0-9-]*$/.test(w));
  return { path, flags, alt };
}

test("real aw: every aw invocation in the skills and inject exists with its flags", (t) => {
  if (!realAw(t)) return;
  const files = [
    join(CAPABILITY, "injects", "aweb.md"),
    ...["oats-aweb", "aweb-messaging", "aweb-team-membership", "aweb-identity"].map((s) => join(CAPABILITY, "skills", s, "SKILL.md")),
  ];
  const helpCache = new Map();
  const help = (path) => {
    const key = path.join(" ");
    if (!helpCache.has(key)) { const r = spawnSync("aw", [...path, "--help"], { encoding: "utf8", timeout: 10000 }); helpCache.set(key, { ok: r.status === 0, text: `${r.stdout}${r.stderr}` }); }
    return helpCache.get(key);
  };
  let checked = 0;
  const problems = [];
  for (const file of files) {
    for (const inv of citedAwInvocations(readFileSync(file, "utf8"))) {
      const { path, flags, alt } = parseInvocation(inv);
      if (!path.length && !alt) continue;
      const paths = alt ? alt.split("|").map((a) => [...path, a]) : [path];
      for (const full of paths) {
        // The longest prefix that is a command; any remaining words must be
        // positionals that command's usage line declares (<arg> or [arg]).
        const isCommand = (q) => { const h = help(q); return h.ok && new RegExp(`Usage:\\s*\\n\\s*aw ${q.join(" ")}(\\s|$)`).test(h.text); };
        let p = full;
        while (p.length && !isCommand(p)) p = p.slice(0, -1);
        const h = p.length ? help(p) : undefined;
        const usage = h ? (new RegExp(`Usage:\\s*\\n\\s*(aw ${p.join(" ")}[^\\n]*)`).exec(h.text)?.[1] || "") : "";
        if (!p.length || (p.length < full.length && !/[<[]/.test(usage.slice(`aw ${p.join(" ")}`.length)))) { problems.push(`${file.split("/oats-aweb/").pop()}: \`${inv}\` → aw ${full.join(" ")} is not a command`); continue; }
        for (const f of flags) if (f !== "--identity-home" && f !== "--help" && !h.text.includes(`${f} `) && !h.text.includes(`${f}\n`)) problems.push(`${file.split("/oats-aweb/").pop()}: \`${inv}\` → aw ${p.join(" ")} has no ${f}`);
        checked++;
      }
    }
  }
  t.diagnostic(`checked ${checked} cited aw invocations`);
  assert.ok(checked > 20);
  assert.deepEqual(problems, []);
});
