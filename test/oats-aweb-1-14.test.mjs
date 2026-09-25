import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CAPABILITY = join(REPO, "oats-package", "capabilities", "oats-aweb");
const HOOK = join(CAPABILITY, "bin", "oats-aweb.mjs");
const BINDING = join(CAPABILITY, "bin", "oats-aweb-binding.mjs");
const CLASSIC_REFUSAL = "oats.aweb 1.14 needs OATS 0.26.0 or newer (workspace model); on an older kernel pin oats.aweb v1.13.x";

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "oats-aweb-114-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(p, c, mode) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c, mode ? { mode } : undefined); }

function runHook(event, { cwd, env = {}, args = [] } = {}) {
  return spawnSync(process.execPath, [HOOK, event, ...args], { cwd, env: { ...process.env, ...env }, encoding: "utf8", timeout: 20000 });
}

function runBindingCheck(input, env = {}, cwd = process.cwd()) {
  return spawnSync(process.execPath, [BINDING, "check"], { cwd, input: JSON.stringify(input), env: { ...process.env, ...env }, encoding: "utf8", timeout: 20000 });
}

function fakeAw114(t, { wakeStatus = { daemon_running: true, daemon_version_state: "reported", daemon_version: "1.36.5", daemon_commit: "347d4875" } } = {}) {
  const base = tempDir(t);
  const bin = join(base, "bin");
  mkdirSync(bin);
  const calls = join(base, "calls.jsonl");
  write(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const calls = ${JSON.stringify(calls)};
let args = process.argv.slice(2);
let identityHome = null;
if (args[0] === "--identity-home") { identityHome = args[1]; args = args.slice(2); }
fs.appendFileSync(calls, JSON.stringify({ args, cwd: process.cwd(), identityHome }) + "\\n");
const emit = (o) => console.log(JSON.stringify(o));
const teamFromToken = (token) => token.replace(/^TOKEN__/, "");
const homeForWrite = () => identityHome || path.join(process.cwd(), ".aw");
if (args[0] === "version") { console.log("aw 1.36.6 5a285ceb"); process.exit(0); }
if (args[0] === "wake" && args[1] === "status" && args.includes("--json")) { emit(${JSON.stringify(wakeStatus)}); process.exit(0); }
if (args[0] === "wake") { console.log("ok"); process.exit(0); }
if (args[0] === "team" && args[1] === "list" && args.includes("--json")) { emit({ active_team: "personal:example.test", memberships: [{ team_id: "personal:example.test" }, { team_id: "alpha:example.test" }, { team_id: "beta:example.test" }] }); process.exit(0); }
if (args[0] === "team" && args[1] === "invite") { const team = args[args.indexOf("--team-id") + 1]; emit({ token: "TOKEN__" + team }); process.exit(0); }
if (args[0] === "team" && args[1] === "join") { const team = teamFromToken(args[2]); const alias = args[args.indexOf("--name") + 1] || "probe"; const dest = homeForWrite(); fs.mkdirSync(dest, { recursive: true }); fs.writeFileSync(path.join(dest, "identity.yaml"), "alias: " + alias + "\\n"); emit({ alias, team_id: team }); process.exit(0); }
if (args[0] === "init") { console.log("initialized"); process.exit(0); }
if (args[0] === "workspace" && args[1] === "delete") { fs.rmSync(homeForWrite(), { recursive: true, force: true }); emit({ alias: args[2], alias_released: true, alias_released_reason: "released" }); process.exit(0); }
console.error("unexpected fake aw " + args.join(" ")); process.exit(93);
`, 0o755);
  return { path: bin, calls, readCalls: () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [] };
}

function bindingRequest(settings, context) {
  return { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings, input: { action: { kind: "readiness" }, context } };
}

const teamsEnv = JSON.stringify([
  { label: "alpha", team: "alpha:example.test", mapped: true, payload: { team: "alpha:example.test" } },
  { label: "beta", team: "beta:example.test", mapped: true, payload: { team: "beta:example.test" } },
  { label: "ghost", team: null, mapped: false, payload: {} },
]);

test("1.14 refuses classic OATS environments consistently", (t) => {
  const root = tempDir(t), home = join(root, "home");
  mkdirSync(home);
  const fake = fakeAw114(t);
  const classicEnv = { PATH: fake.path, OATS_TEAM_SCOPE: root, OATS_EVENT: "spawn", OATS_HOME: home, OATS_INSTANCE: "probe" };

  const spawned = runHook("spawn", { cwd: home, env: classicEnv });
  assert.notEqual(spawned.status, 0);
  assert.equal(JSON.parse(spawned.stdout).warning, `oats-aweb: ${CLASSIC_REFUSAL}`);

  const setup = runHook("setup", { cwd: home, env: { ...classicEnv, OATS_EVENT: "setup" } });
  assert.notEqual(setup.status, 0);
  assert.equal(setup.stderr.trim(), CLASSIC_REFUSAL);

  const checked = runBindingCheck(bindingRequest({}, { kind: "workspace", workspace: root, deployment: root, soul: "dev", home }), { PATH: fake.path, OATS_TEAM_SCOPE: root }, home);
  assert.equal(checked.status, 0, checked.stderr);
  const result = JSON.parse(checked.stdout).result;
  assert.equal(result.status, "needs-configuration");
  assert.equal(result.problems[0].message, CLASSIC_REFUSAL);
  assert.deepEqual(fake.readCalls(), [], "classic refusal happens before aw is invoked");
});

test("manifest declares 1.14 floor, team setting, commands and home operations", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  const dist = JSON.parse(readFileSync(join(REPO, "oats-package", "oats-package.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));
  assert.equal(pkg.version, "1.14.0");
  assert.equal(dist.version, "1.14.0");
  assert.equal(manifest.version, "1.14.0");
  assert.equal(dist.compatibility.oats, ">=0.26.0");
  assert.equal(manifest.compatibility.oats, ">=0.26.0");
  assert.ok(manifest.settings.join.description.includes("comma-separated eligible team labels"));
  assert.equal(manifest.commands.teams, "bin/oats-aweb.mjs teams");
  assert.equal(manifest.commands.join, "bin/oats-aweb.mjs join");
  assert.equal(manifest.commands.leave, "bin/oats-aweb.mjs leave");
  assert.equal(manifest.operations["messaging:teams"].kind, "action");
  assert.equal(manifest.operations["messaging:join"].args[0].flag, "--labels");
  assert.equal(manifest.operations["messaging:leave"].args[0].required, true);
});

test("spawn join setting mints joined-team identities and teams/join/leave update instance meta", (t) => {
  const root = tempDir(t), home = join(root, "home");
  mkdirSync(join(root, ".aw"), { recursive: true });
  mkdirSync(home);
  const fake = fakeAw114(t);
  const env = {
    PATH: fake.path,
    OATS_EVENT: "spawn",
    OATS_HOME: home,
    OATS_INSTANCE: "probe",
    OATS_WORKSPACE: root,
    OATS_WORKSPACE_KEY: "repo:fixture",
    OATS_TEAM_ID: "personal:example.test",
    OATS_TEAM_LABELS: "alpha,beta,ghost",
    OATS_TEAMS_SOURCE: "live",
    OATS_TEAMS: teamsEnv,
    OATS_SETTINGS: JSON.stringify({ root, team: "personal:example.test", join: "alpha" }),
  };
  const spawned = runHook("spawn", { cwd: home, env });
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const spawnDoc = JSON.parse(spawned.stdout);
  assert.deepEqual(spawnDoc.meta.joinedTeams.map((j) => ({ label: j.label, team: j.team, receive: j.receive })), [{ label: "alpha", team: "alpha:example.test", receive: "poll" }]);
  assert.equal(spawnDoc.meta.joinedTeams[0].identityHome, join(home, ".aweb-identity-alpha"));
  assert.equal(existsSync(join(home, ".aweb-identity-alpha", "identity.yaml")), true);
  writeFileSync(join(home, "instance.json"), JSON.stringify({ capabilityMeta: { "oats.aweb": spawnDoc.meta } }, null, 2));

  const listed = runHook("teams", { cwd: home, env: { ...env, OATS_EVENT: "teams", OATS_META: JSON.stringify(spawnDoc.meta) }, args: ["--json"] });
  assert.equal(listed.status, 0, listed.stderr);
  const teams = JSON.parse(listed.stdout);
  assert.deepEqual(teams.unmapped, ["ghost"]);
  assert.equal(teams.eligible.find((e) => e.label === "alpha").joined, true);
  assert.equal(teams.eligible.find((e) => e.label === "beta").joined, false);
  assert.equal(teams.joined[0].receive, "poll");

  const joined = runHook("join", { cwd: home, env: { ...env, OATS_EVENT: "join" }, args: ["--labels", "beta", "--json"] });
  assert.equal(joined.status, 0, joined.stdout + joined.stderr);
  let instance = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  assert.deepEqual(instance.capabilityMeta["oats.aweb"].joinedTeams.map((j) => j.label).sort(), ["alpha", "beta"]);
  assert.equal(existsSync(join(home, ".aweb-identity-beta", "identity.yaml")), true);

  const left = runHook("leave", { cwd: home, env: { ...env, OATS_EVENT: "leave" }, args: ["--labels", "alpha", "--json"] });
  assert.equal(left.status, 0, left.stdout + left.stderr);
  instance = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  assert.deepEqual(instance.capabilityMeta["oats.aweb"].joinedTeams.map((j) => j.label), ["beta"]);
  assert.equal(existsSync(join(home, ".aweb-identity-alpha")), false);
});

test("published aw 1.36.6 exposes wake status version state", (t) => {
  const version = spawnSync("aw", ["version"], { encoding: "utf8", timeout: 10000 });
  if (version.status !== 0 || !/aw\s+1\.36\.6/.test(version.stdout + version.stderr) || !/5a285ceb/.test(version.stdout + version.stderr)) {
    t.skip(`aw is not published 1.36.6 / 5a285ceb: ${(version.stdout + version.stderr).trim()}`);
    return;
  }
  t.diagnostic(`aw version fixture: ${(version.stdout + version.stderr).trim()}`);
  const status = spawnSync("aw", ["wake", "status", "--json"], { encoding: "utf8", timeout: 10000 });
  assert.equal(status.status, 0, status.stderr || status.stdout);
  const doc = JSON.parse(status.stdout);
  assert.ok(["reported", "unknown", "not_running"].includes(doc.daemon_version_state), status.stdout);
  if (doc.daemon_version_state === "reported") assert.equal(typeof doc.daemon_version, "string");
});

test("wake daemon readiness reports outdated, unknown and not-running states", (t) => {
  const root = tempDir(t), home = join(root, "home");
  mkdirSync(join(root, ".aw"), { recursive: true });
  mkdirSync(home);
  const context = { kind: "workspace", workspace: root, deployment: root, soul: "dev", home };
  const settings = { delivery: "session", root, team: "personal:example.test" };

  const outdatedAw = fakeAw114(t, { wakeStatus: { daemon_running: true, daemon_version_state: "reported", daemon_version: "1.36.4" } });
  let checked = runBindingCheck(bindingRequest(settings, context), { PATH: outdatedAw.path, OATS_WORKSPACE: root, OATS_WORKSPACE_KEY: "repo:fixture" }, home);
  let result = JSON.parse(checked.stdout).result;
  assert.equal(result.status, "needs-configuration");
  assert.match(result.problems.find((p) => p.code === "wake-daemon-outdated").message, /running 1\.36\.4.*required 1\.36\.5.*upgrade aw, then restart the host wake daemon/);

  const unknownAw = fakeAw114(t, { wakeStatus: { daemon_running: true, daemon_version_state: "unknown" } });
  checked = runBindingCheck(bindingRequest(settings, context), { PATH: unknownAw.path, OATS_WORKSPACE: root, OATS_WORKSPACE_KEY: "repo:fixture" }, home);
  result = JSON.parse(checked.stdout).result;
  assert.equal(result.status, "ready");
  assert.match(result.warnings.find((w) => w.code === "wake-daemon-version-unknown").message, /compatibility unproven.*upgrade aw, then restart the host wake daemon/);

  const downAw = fakeAw114(t, { wakeStatus: { daemon_running: false, daemon_version_state: "not_running" } });
  checked = runBindingCheck(bindingRequest(settings, context), { PATH: downAw.path, OATS_WORKSPACE: root, OATS_WORKSPACE_KEY: "repo:fixture" }, home);
  result = JSON.parse(checked.stdout).result;
  assert.equal(result.status, "needs-configuration");
  assert.ok(result.problems.some((p) => p.code === "wake-daemon-not-running"));
});
