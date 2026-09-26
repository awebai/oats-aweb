import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
const CLASSIC_REFUSAL = "oats.aweb 1.14 needs OATS 0.26.0 or newer (workspace model); on an older kernel pin oats.aweb v1.13.x";
const JOINED_TEAMS_AW_MIN = /const JOINED_TEAMS_AW_MIN = "([^"]+)"/.exec(readFileSync(HOOK, "utf8"))[1];
const JOINED_TEAMS_FLOOR_IS_RELEASED = /^\d+\.\d+\.\d+$/.test(JOINED_TEAMS_AW_MIN);
const FAKE_AW_VERSION = JOINED_TEAMS_FLOOR_IS_RELEASED ? JOINED_TEAMS_AW_MIN : "1.36.6";
const IDENTITY_HOME_POLICY = "not yet identity-home-aware";
const LOCAL_SCOPE_POLICY = "local identity creation is not identity-home-aware";
const TEAM_JOIN_POLICY = 'command "aw team join" is not yet identity-home-aware; refusing to use an external identity home';


function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "oats-aweb-114-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function realTempDir(t) {
  return realpathSync(tempDir(t));
}

function awVersionText() {
  const version = spawnSync("aw", ["version"], { encoding: "utf8", timeout: 10000 });
  return { version, text: `${version.stdout ?? ""}${version.stderr ?? ""}` };
}

function write(p, c, mode) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c, mode ? { mode } : undefined); }

function runHook(event, { cwd, env = {}, args = [] } = {}) {
  return spawnSync(process.execPath, [HOOK, event, ...args], { cwd, env: { ...process.env, ...env }, encoding: "utf8", timeout: 20000 });
}

function runBindingCheck(input, env = {}, cwd = process.cwd()) {
  const result = spawnSync(process.execPath, [BINDING, "check"], { cwd, input: JSON.stringify(input), env: { ...process.env, ...env }, encoding: "utf8", timeout: 20000 });
  if (!result.error && result.status === 0) assertKernelCheckAnswerRule(result.stdout, input, "oats-aweb binding check");
  return result;
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
const refuseIdentityHome = () => { console.error('command "aw team join" is not yet identity-home-aware; refusing to use an external identity home so principal state cannot fall back to the instance directory. Supported alternatives for this attached principal: aw id team accept-invite'); process.exit(2); };
const joinedTeamsFloorIsReleased = ${JSON.stringify(JOINED_TEAMS_FLOOR_IS_RELEASED)};
if (args[0] === "version") { console.log("aw " + ${JSON.stringify(FAKE_AW_VERSION)} + " 5a285ceb"); process.exit(0); }
if (args[0] === "wake" && args[1] === "status" && args.includes("--json")) { emit(${JSON.stringify(wakeStatus)}); process.exit(0); }
if (args[0] === "wake") { console.log("ok"); process.exit(0); }
if (args[0] === "team" && args[1] === "list" && args.includes("--json")) { emit({ active_team: "personal:example.test", memberships: [{ team_id: "personal:example.test" }, { team_id: "alpha:example.test" }, { team_id: "beta:example.test" }] }); process.exit(0); }
if (args[0] === "team" && args[1] === "invite") { const team = args[args.indexOf("--team-id") + 1]; emit({ token: "TOKEN__" + team }); process.exit(0); }
if (args[0] === "team" && args[1] === "join" && identityHome) refuseIdentityHome();
if (args[0] === "team" && args[1] === "join") { const team = teamFromToken(args[2]); const alias = args[args.indexOf("--name") + 1] || "probe"; const dest = homeForWrite(); fs.mkdirSync(dest, { recursive: true }); fs.writeFileSync(path.join(dest, "identity.yaml"), "alias: " + alias + "\\n"); emit({ alias, team_id: team }); process.exit(0); }
if (args[0] === "id" && args[1] === "team" && args[2] === "accept-invite" && identityHome && args.includes("--local") && !joinedTeamsFloorIsReleased) { console.error("external identity home requires --global for team invite acceptance; local identity creation is not identity-home-aware"); process.exit(2); }
if (args[0] === "id" && args[1] === "team" && args[2] === "accept-invite") { const team = teamFromToken(args[3]); const alias = args[args.indexOf("--name") + 1] || "probe"; const dest = homeForWrite(); fs.mkdirSync(path.join(dest, "team-certs"), { recursive: true }); fs.writeFileSync(path.join(dest, "identity.yaml"), "alias: " + alias + "\\nteam_id: " + team + "\\n"); fs.writeFileSync(path.join(dest, "workspace.yaml"), "alias: " + alias + "\\nteam_id: " + team + "\\naweb_url: https://app.aweb.ai/api\\n"); emit({ status: "accepted", team_id: team, alias, cert: path.join(dest, "team-certs", team + ".yaml") }); process.exit(0); }
if (args[0] === "init") { console.log("initialized"); process.exit(0); }
if (args[0] === "workspace" && args[1] === "connect") { const dest = homeForWrite(); fs.mkdirSync(dest, { recursive: true }); fs.writeFileSync(path.join(dest, "workspace.yaml"), "alias: probe\\nteam_id: alpha:example.test\\naweb_url: " + (args[args.indexOf("--service") + 1] || "https://app.aweb.ai/api") + "\\n"); emit({ status: "connected", team_id: "alpha:example.test", alias: "probe" }); process.exit(0); }
if (args[0] === "workspace" && args[1] === "delete") { if (process.env.FAIL_WORKSPACE_DELETE) { console.error("delete failed"); process.exit(7); } if (process.env.PERMISSION_MEMBER_WORKSPACE_DELETE) { console.error("permission denied: identity is not a member of that team"); process.exit(8); } if (process.env.MALFORMED_WORKSPACE_DELETE) { console.log("not json"); process.exit(0); } if (process.env.IDENTITY_DELETED_ONLY_WORKSPACE_DELETE) { emit({ alias: args[2], alias_released: false, alias_released_reason: "already-released", identity_deleted: true }); process.exit(0); } fs.rmSync(homeForWrite(), { recursive: true, force: true }); emit({ alias: args[2], alias_released: true, alias_released_reason: "released", identity_deleted: true }); process.exit(0); }
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
  const schema = JSON.parse(readFileSync(join(REPO, "schemas", "capability-manifest.schema.json"), "utf8"));
  assert.equal(pkg.version, "1.15.0");
  assert.equal(dist.version, "1.15.0");
  assert.equal(manifest.version, "1.15.0");
  assert.equal(dist.compatibility.oats, ">=0.26.0");
  assert.equal(manifest.compatibility.oats, ">=0.26.0");
  assert.ok(manifest.settings.join.description.includes("comma-separated eligible team labels"));
  assert.equal(manifest.commands.teams, "bin/oats-aweb.mjs teams");
  assert.equal(manifest.commands.join, "bin/oats-aweb.mjs join");
  assert.equal(manifest.commands.leave, "bin/oats-aweb.mjs leave");
  assert.equal(schema.properties.operations.propertyNames.pattern, "^[a-z][a-z0-9-]*$");
  assert.deepEqual(Object.keys(manifest.operations).sort(), ["join", "leave", "teams"]);
  assert.ok(!Object.keys(manifest.operations).some((key) => key.includes(":")), "operation keys are names; kernel forms messaging:<name>");
  assert.equal(manifest.operations.teams.kind, "action");
  assert.equal(manifest.operations.join.args[0].flag, "--labels");
  assert.equal(manifest.operations.leave.args[0].required, true);
});

test("spawn join setting gates joined-team identities before minting invites", (t) => {
  if (JOINED_TEAMS_FLOOR_IS_RELEASED) return t.skip("JOINED_TEAMS_AW_MIN names a released aw; covered by parked success-path test");
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
    OATS_WORKSPACE_KEY: "local/fixture",
    OATS_TEAM_ID: "personal:example.test",
    OATS_TEAM_LABELS: "alpha,beta,ghost",
    OATS_TEAMS_SOURCE: "live",
    OATS_TEAMS: teamsEnv,
    OATS_SETTINGS: JSON.stringify({ root, team: "personal:example.test", join: "alpha" }),
  };
  const spawned = runHook("spawn", { cwd: home, env });
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const spawnDoc = JSON.parse(spawned.stdout);
  assert.equal(spawnDoc.meta.team, "personal:example.test", "primary identity still mints");
  assert.deepEqual(spawnDoc.meta.joinedTeams || [], []);
  assert.match(spawnDoc.warning, /E_TEAM_AW_FLOOR.*joined-team identities need an aw release.*not yet published/);
  assert.equal(existsSync(join(home, ".aweb-identity-alpha")), false);
  let calls = fake.readCalls();
  assert.equal(calls.some((c) => c.args[0] === "team" && c.args[1] === "invite" && c.args.includes("alpha:example.test")), false, "join= floor gate happens before minting a joined-team invite");

  const instanceJson = { capabilityMeta: { "oats.aweb": { sentinel: true } } };
  writeFileSync(join(home, "instance.json"), JSON.stringify(instanceJson, null, 2));
  const listed = runHook("teams", { cwd: home, env: { ...env, OATS_EVENT: "teams", OATS_META: JSON.stringify(spawnDoc.meta) }, args: ["--json"] });
  assert.equal(listed.status, 0, listed.stderr);
  const teams = JSON.parse(listed.stdout);
  assert.deepEqual(teams.unmapped, ["ghost"]);
  assert.equal(teams.eligible.find((e) => e.label === "alpha").joined, false);
  assert.equal(teams.eligible.find((e) => e.label === "beta").joined, false);

  const joined = runHook("join", { cwd: home, env: { ...env, OATS_EVENT: "join" }, args: ["--labels", "beta", "--json"] });
  assert.notEqual(joined.status, 0);
  assert.match(joined.stderr, /E_TEAM_AW_FLOOR.*joined-team identities need an aw release.*not yet published/);
  assert.deepEqual(JSON.parse(readFileSync(join(home, "instance.json"), "utf8")), instanceJson, "provider command must not rewrite kernel instance.json");
  assert.equal(existsSync(join(home, ".aweb-identity-beta")), false);
  calls = fake.readCalls();
  assert.equal(calls.some((c) => c.args[0] === "team" && c.args[1] === "invite" && c.args.includes("beta:example.test")), false, "oats aweb join floor gate happens before minting a joined-team invite");
});



test("fake aw 1.14 refuses both joined-team mint forms under --identity-home", (t) => {
  const fake = fakeAw114(t);
  const root = realTempDir(t);
  const identityHome = join(root, ".aweb-identity-alpha");

  const oldForm = spawnSync("aw", ["--identity-home", identityHome, "team", "join", "TOKEN__alpha:example.test", "--name", "probe", "--json"], { env: { ...process.env, PATH: fake.path }, encoding: "utf8", timeout: 10000 });
  assert.equal(oldForm.status, 2);
  assert.match(oldForm.stderr, new RegExp(TEAM_JOIN_POLICY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const acceptLocal = spawnSync("aw", ["--identity-home", identityHome, "id", "team", "accept-invite", "TOKEN__alpha:example.test", "--name", "probe", "--local", "--json"], { env: { ...process.env, PATH: fake.path }, encoding: "utf8", timeout: 10000 });
  if (JOINED_TEAMS_FLOOR_IS_RELEASED) {
    assert.equal(acceptLocal.status, 0, acceptLocal.stderr);
    assert.equal(JSON.parse(acceptLocal.stdout).team_id, "alpha:example.test");
    assert.equal(existsSync(join(identityHome, "identity.yaml")), true);
    assert.equal(existsSync(join(identityHome, "workspace.yaml")), true);
  } else {
    assert.equal(acceptLocal.status, 2);
    assert.match(acceptLocal.stderr, new RegExp(LOCAL_SCOPE_POLICY));
    assert.equal(existsSync(join(identityHome, "identity.yaml")), false);
  }
});

test("mapped primary label in OATS_TEAMS is eligible while no settings team mints primary into personal team", (t) => {
  const root = tempDir(t), home = join(root, "home");
  mkdirSync(join(root, ".aw"), { recursive: true });
  mkdirSync(home);
  const fake = fakeAw114(t);
  const primaryTeams = JSON.stringify([
    { label: "alpha", team: "alpha:example.test", mapped: true, payload: { team: "alpha:example.test" } },
    { label: "beta", team: "beta:example.test", mapped: true, payload: { team: "beta:example.test" } },
  ]);
  const env = {
    PATH: fake.path,
    OATS_EVENT: "spawn",
    OATS_HOME: home,
    OATS_INSTANCE: "probe",
    OATS_WORKSPACE: root,
    OATS_WORKSPACE_KEY: "local/fixture",
    OATS_TEAM_ID: "alpha:example.test",
    OATS_TEAM_LABEL: "alpha",
    OATS_TEAM_LABELS: "alpha,beta",
    OATS_TEAMS_SOURCE: "live",
    OATS_TEAMS: primaryTeams,
    OATS_SETTINGS: JSON.stringify({ root }),
  };
  const spawned = runHook("spawn", { cwd: home, env });
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const doc = JSON.parse(spawned.stdout);
  assert.equal(doc.meta.team, "personal:example.test", "OATS_TEAM_ID names the primary label team, not the primary mint target");
  assert.equal((doc.meta.joinedTeams || []).length, 0);
  const inviteCalls = fake.readCalls().filter((c) => c.args[0] === "team" && c.args[1] === "invite");
  assert.equal(inviteCalls[0].args[inviteCalls[0].args.indexOf("--team-id") + 1], "personal:example.test");

  const listed = runHook("teams", { cwd: home, env: { ...env, OATS_EVENT: "teams", OATS_META: JSON.stringify(doc.meta) }, args: ["--json"] });
  assert.equal(listed.status, 0, listed.stderr);
  const teams = JSON.parse(listed.stdout);
  assert.equal(teams.personal.team, "personal:example.test");
  assert.deepEqual(teams.eligible.map((e) => ({ label: e.label, team: e.team, joined: e.joined })), [
    { label: "alpha", team: "alpha:example.test", joined: false },
    { label: "beta", team: "beta:example.test", joined: false },
  ]);

  if (JOINED_TEAMS_FLOOR_IS_RELEASED) return;
  const joinedPrimary = runHook("join", { cwd: home, env: { ...env, OATS_EVENT: "join" }, args: ["--labels", "alpha", "--json"] });
  assert.notEqual(joinedPrimary.status, 0);
  assert.match(joinedPrimary.stderr, /E_TEAM_AW_FLOOR/);

  const joinedAtSpawnHome = join(root, "home-joined-at-spawn");
  mkdirSync(joinedAtSpawnHome);
  const joinedAtSpawn = runHook("spawn", { cwd: joinedAtSpawnHome, env: { ...env, OATS_HOME: joinedAtSpawnHome, OATS_SETTINGS: JSON.stringify({ root, join: "alpha" }) } });
  assert.equal(joinedAtSpawn.status, 0, joinedAtSpawn.stdout + joinedAtSpawn.stderr);
  const joinedAtSpawnDoc = JSON.parse(joinedAtSpawn.stdout);
  assert.equal(joinedAtSpawnDoc.meta.team, "personal:example.test");
  assert.deepEqual(joinedAtSpawnDoc.meta.joinedTeams || [], []);
  assert.match(joinedAtSpawnDoc.warning, /E_TEAM_AW_FLOOR/);
});


test("parked: spawn join setting mints joined-team identities and teams/join/leave update instance meta", (t) => {
  if (!JOINED_TEAMS_FLOOR_IS_RELEASED) return t.skip("until JOINED_TEAMS_AW_MIN names a released aw");
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
    OATS_WORKSPACE_KEY: "local/fixture",
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
  assert.equal(existsSync(join(home, ".aweb-identity-alpha", "workspace.yaml")), true, "accept-invite auto-connects the joined workspace");
  let calls = fake.readCalls();
  assert.ok(calls.some((c) => c.identityHome === join(home, ".aweb-identity-alpha") && c.args.slice(0, 3).join(" ") === "id team accept-invite"), "joined team mint uses identity-home-aware accept-invite");
  assert.equal(calls.some((c) => c.identityHome === join(home, ".aweb-identity-alpha") && c.args[0] === "team" && c.args[1] === "join"), false, "joined team mint never uses refused team join under --identity-home");
  const instanceJson = { capabilityMeta: { "oats.aweb": { sentinel: true } } };
  writeFileSync(join(home, "instance.json"), JSON.stringify(instanceJson, null, 2));

  const listed = runHook("teams", { cwd: home, env: { ...env, OATS_EVENT: "teams", OATS_META: JSON.stringify(spawnDoc.meta) }, args: ["--json"] });
  assert.equal(listed.status, 0, listed.stderr);
  const teams = JSON.parse(listed.stdout);
  assert.deepEqual(teams.unmapped, ["ghost"]);
  assert.equal(teams.eligible.find((e) => e.label === "alpha").joined, true);
  assert.equal(teams.eligible.find((e) => e.label === "beta").joined, false);
  assert.equal(teams.joined[0].receive, "poll");

  const joined = runHook("join", { cwd: home, env: { ...env, OATS_EVENT: "join" }, args: ["--labels", "beta", "--json"] });
  assert.equal(joined.status, 0, joined.stdout + joined.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(home, "instance.json"), "utf8")), instanceJson, "provider command must not rewrite kernel instance.json");
  let state = JSON.parse(readFileSync(join(home, ".oats-aweb", "teams.json"), "utf8"));
  assert.deepEqual(state.joinedTeams.map((j) => j.label).sort(), ["alpha", "beta"]);
  assert.equal(existsSync(join(home, ".aweb-identity-beta", "identity.yaml")), true);
  calls = fake.readCalls();
  assert.ok(calls.some((c) => c.identityHome === join(home, ".aweb-identity-beta") && c.args.slice(0, 3).join(" ") === "id team accept-invite"));
  assert.equal(calls.some((c) => c.identityHome === join(home, ".aweb-identity-beta") && c.args[0] === "team" && c.args[1] === "join"), false);

  const failedLeave = runHook("leave", { cwd: home, env: { ...env, OATS_EVENT: "leave", FAIL_WORKSPACE_DELETE: "1" }, args: ["--labels", "beta", "--json"] });
  assert.notEqual(failedLeave.status, 0);
  assert.equal(existsSync(join(home, ".aweb-identity-beta", "identity.yaml")), true, "failed leave keeps the key for retry");
  state = JSON.parse(readFileSync(join(home, ".oats-aweb", "teams.json"), "utf8"));
  assert.ok(state.joinedTeams.some((j) => j.label === "beta"), "failed leave keeps provider state");

  for (const row of [
    { env: { IDENTITY_DELETED_ONLY_WORKSPACE_DELETE: "1" }, match: /alias_released.*false.*identity_deleted.*true/s },
    { env: { PERMISSION_MEMBER_WORKSPACE_DELETE: "1" }, match: /permission denied: identity is not a member/ },
    { env: { MALFORMED_WORKSPACE_DELETE: "1" }, match: /returned no JSON result|not json/ },
  ]) {
    const kept = runHook("leave", { cwd: home, env: { ...env, OATS_EVENT: "leave", ...row.env }, args: ["--labels", "beta", "--json"] });
    assert.notEqual(kept.status, 0, kept.stdout + kept.stderr);
    assert.match(kept.stderr, row.match);
    assert.equal(existsSync(join(home, ".aweb-identity-beta", "identity.yaml")), true, "ambiguous leave keeps the key for retry");
    state = JSON.parse(readFileSync(join(home, ".oats-aweb", "teams.json"), "utf8"));
    assert.ok(state.joinedTeams.some((j) => j.label === "beta"), "ambiguous leave keeps provider state");
  }

  const leftBeta = runHook("leave", { cwd: home, env: { ...env, OATS_EVENT: "leave" }, args: ["--labels", "beta", "--json"] });
  assert.equal(leftBeta.status, 0, leftBeta.stdout + leftBeta.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(home, "instance.json"), "utf8")), instanceJson, "leave still does not rewrite instance.json");
  const leftBetaDoc = JSON.parse(leftBeta.stdout);
  assert.equal(leftBetaDoc.actions[0].action, "leave");
  assert.equal(leftBetaDoc.actions[0].label, "beta");
  assert.equal(leftBetaDoc.actions[0].released, "released");
  assert.equal(leftBetaDoc.actions[0].receipt.alias_released, true);
  state = JSON.parse(readFileSync(join(home, ".oats-aweb", "teams.json"), "utf8"));
  assert.deepEqual(state.joinedTeams.map((j) => j.label), ["alpha"]);
  assert.equal(existsSync(join(home, ".aweb-identity-beta")), false);

  const left = runHook("leave", { cwd: home, env: { ...env, OATS_EVENT: "leave" }, args: ["--labels", "alpha", "--json"] });
  assert.equal(left.status, 0, left.stdout + left.stderr);
  state = JSON.parse(readFileSync(join(home, ".oats-aweb", "teams.json"), "utf8"));
  assert.deepEqual(state.joinedTeams, []);
  assert.equal(existsSync(join(home, ".aweb-identity-alpha")), false);
});

test("parked: mapped primary joined team can be joined and left once aw floor exists", (t) => {
  if (!JOINED_TEAMS_FLOOR_IS_RELEASED) return t.skip("until JOINED_TEAMS_AW_MIN names a released aw");
  const root = tempDir(t), home = join(root, "home");
  mkdirSync(join(root, ".aw"), { recursive: true });
  mkdirSync(home);
  const fake = fakeAw114(t);
  const primaryTeams = JSON.stringify([
    { label: "alpha", team: "alpha:example.test", mapped: true, payload: { team: "alpha:example.test" } },
    { label: "beta", team: "beta:example.test", mapped: true, payload: { team: "beta:example.test" } },
  ]);
  const env = {
    PATH: fake.path,
    OATS_EVENT: "spawn",
    OATS_HOME: home,
    OATS_INSTANCE: "probe",
    OATS_WORKSPACE: root,
    OATS_WORKSPACE_KEY: "local/fixture",
    OATS_TEAM_ID: "alpha:example.test",
    OATS_TEAM_LABEL: "alpha",
    OATS_TEAM_LABELS: "alpha,beta",
    OATS_TEAMS_SOURCE: "live",
    OATS_TEAMS: primaryTeams,
    OATS_SETTINGS: JSON.stringify({ root }),
  };
  const spawned = runHook("spawn", { cwd: home, env });
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const doc = JSON.parse(spawned.stdout);
  const joinedPrimary = runHook("join", { cwd: home, env: { ...env, OATS_EVENT: "join" }, args: ["--labels", "alpha", "--json"] });
  assert.equal(joinedPrimary.status, 0, joinedPrimary.stdout + joinedPrimary.stderr);
  let state = JSON.parse(readFileSync(join(home, ".oats-aweb", "teams.json"), "utf8"));
  assert.ok(state.joinedTeams.some((j) => j.label === "alpha" && j.team === "alpha:example.test"));

  const leftPrimary = runHook("leave", { cwd: home, env: { ...env, OATS_EVENT: "leave" }, args: ["--labels", "alpha", "--json"] });
  assert.equal(leftPrimary.status, 0, leftPrimary.stdout + leftPrimary.stderr);
  state = JSON.parse(readFileSync(join(home, ".oats-aweb", "teams.json"), "utf8"));
  assert.ok(!state.joinedTeams.some((j) => j.label === "alpha"));

  const joinedAtSpawnHome = join(root, "home-joined-at-spawn");
  mkdirSync(joinedAtSpawnHome);
  const joinedAtSpawn = runHook("spawn", { cwd: joinedAtSpawnHome, env: { ...env, OATS_HOME: joinedAtSpawnHome, OATS_SETTINGS: JSON.stringify({ root, join: "alpha" }) } });
  assert.equal(joinedAtSpawn.status, 0, joinedAtSpawn.stdout + joinedAtSpawn.stderr);
  const joinedAtSpawnDoc = JSON.parse(joinedAtSpawn.stdout);
  assert.equal(joinedAtSpawnDoc.meta.team, "personal:example.test");
  assert.deepEqual(joinedAtSpawnDoc.meta.joinedTeams.map((j) => ({ label: j.label, team: j.team })), [{ label: "alpha", team: "alpha:example.test" }]);
  assert.equal(doc.meta.team, "personal:example.test");
});

test("retained seat retire leaves joined team identities before releasing the retained primary", (t) => {
  const root = tempDir(t), home = join(root, "home"), source = join(root, "source", ".aw");
  mkdirSync(join(root, ".aw"), { recursive: true });
  mkdirSync(join(home, ".aw"), { recursive: true });
  mkdirSync(join(home, ".aweb-identity-alpha"), { recursive: true });
  mkdirSync(join(home, ".oats-aweb"), { recursive: true });
  mkdirSync(source, { recursive: true });
  const fake = fakeAw114(t);
  const lock = join(root, "source", ".aw-retained-seat.json");
  writeFileSync(lock, JSON.stringify({ home }));
  const meta = {
    alias: "retained",
    team: "personal:example.test",
    retained: true,
    source,
    lock,
    delivery: "channel",
    identity: { mode: "local", alias: "retained", team: "personal:example.test" },
    joinedTeams: [{ label: "alpha", team: "alpha:example.test", identityHome: join(home, ".aweb-identity-alpha"), receive: "poll", since: "2026-09-25T00:00:00Z", alias: "probe" }],
  };
  writeFileSync(join(home, ".oats-aweb", "teams.json"), JSON.stringify({ joinedTeams: meta.joinedTeams }, null, 2));
  const retired = runHook("retire", { cwd: home, env: { PATH: fake.path, OATS_EVENT: "retire", OATS_HOME: home, OATS_META: JSON.stringify(meta), OATS_WORKSPACE: root, OATS_WORKSPACE_KEY: "local/fixture" } });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  const doc = JSON.parse(retired.stdout);
  assert.equal(doc.meta.retained, true);
  assert.deepEqual(doc.meta.joinedTeams, []);
  assert.equal(existsSync(join(home, ".aweb-identity-alpha")), false);
  assert.equal(existsSync(lock), false);
  assert.ok(fake.readCalls().some((c) => c.identityHome === join(home, ".aweb-identity-alpha") && c.args[0] === "workspace" && c.args[1] === "delete"));
});

test("unmapped primary label falls back to personal root team with readiness warning", (t) => {
  const root = tempDir(t), home = join(root, "home");
  mkdirSync(join(root, ".aw"), { recursive: true });
  writeFileSync(join(root, ".aw", "teams.yaml"), "active_team: personal:example.test\n");
  mkdirSync(home);
  const fake = fakeAw114(t);
  const unmappedTeams = JSON.stringify([{ label: "ghost", team: null, mapped: false, payload: {} }]);
  const env = {
    PATH: fake.path,
    OATS_EVENT: "spawn",
    OATS_HOME: home,
    OATS_INSTANCE: "probe",
    OATS_WORKSPACE: root,
    OATS_WORKSPACE_KEY: "local/fixture",
    OATS_TEAM_LABEL: "ghost",
    OATS_TEAM_LABELS: "ghost",
    OATS_TEAMS_SOURCE: "live",
    OATS_TEAMS: unmappedTeams,
    OATS_SETTINGS: JSON.stringify({ root }),
  };
  const spawned = runHook("spawn", { cwd: home, env });
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const doc = JSON.parse(spawned.stdout);
  assert.equal(doc.meta.team, "personal:example.test");
  assert.match(doc.warning, /team-unmapped.*ghost.*personal:example\.test/);

  const checked = runBindingCheck(bindingRequest({ delivery: "channel", root }, { kind: "workspace", workspace: root, deployment: root, soul: "dev", home }), env, home);
  const result = JSON.parse(checked.stdout).result;
  assert.equal(result.status, "ready");
  assert.deepEqual(Object.keys(result).sort(), ["problems", "status", "warnings"], "binding check answers must not carry provider-only teams data");
  assert.match(result.warnings.find((w) => w.code === "team-unmapped").message, /ghost.*personal:example\.test/);
});

test("binding check omits teams data while preserving joined-team readiness warnings", (t) => {
  const root = tempDir(t), home = join(root, "home");
  mkdirSync(join(root, ".aw"), { recursive: true });
  mkdirSync(join(home, ".oats-aweb"), { recursive: true });
  writeFileSync(join(home, ".oats-aweb", "teams.json"), JSON.stringify({ joinedTeams: [{ label: "alpha", team: "alpha:example.test", identityHome: join(home, ".aweb-identity-alpha"), receive: "poll", since: "2026-09-25T00:00:00Z" }] }));
  const fake = fakeAw114(t);
  const checked = runBindingCheck(bindingRequest({ delivery: "channel", root, team: "personal:example.test" }, { kind: "workspace", workspace: root, deployment: root, soul: "dev", home }), {
    PATH: fake.path,
    OATS_WORKSPACE: root,
    OATS_WORKSPACE_KEY: "local/fixture",
    OATS_TEAM_LABELS: "alpha,beta,ghost",
    OATS_TEAMS_SOURCE: "live",
    OATS_TEAMS: teamsEnv,
  }, home);
  const result = JSON.parse(checked.stdout).result;
  assert.equal(result.status, "ready");
  assert.deepEqual(Object.keys(result).sort(), ["problems", "status", "warnings"], "kernel check-answer rule rejects extra teams key");
  assert.ok(result.warnings.some((w) => w.code === "joined-team-poll-only" && /alpha/.test(w.message)));
});

test("leaving the personal team is refused as E_TEAM_PERSONAL", (t) => {
  const root = tempDir(t), home = join(root, "home");
  mkdirSync(join(root, ".aw"), { recursive: true });
  mkdirSync(home);
  const fake = fakeAw114(t);
  const left = runHook("leave", { cwd: home, env: { PATH: fake.path, OATS_WORKSPACE: root, OATS_WORKSPACE_KEY: "local/fixture", OATS_TEAM_LABEL: "personal", OATS_TEAM_LABELS: "personal", OATS_EVENT: "leave", OATS_HOME: home, OATS_SETTINGS: JSON.stringify({ root, team: "personal:example.test" }) }, args: ["--labels", "personal", "--json"] });
  assert.notEqual(left.status, 0);
  assert.match(left.stderr, /E_TEAM_PERSONAL/);
});


test("real aw 1.36 identity-home policy admits provider subcommands and pins current mint refusals", (t) => {
  const { version, text } = awVersionText();
  if (version.error || version.status !== 0 || !/aw\s+1\.36\./.test(text)) {
    t.skip(`aw is not a 1.36.x binary: ${(version.error?.message || text).trim()}`);
    return;
  }
  t.diagnostic(`aw version fixture: ${text.trim().split(/\r?\n/)[0]}`);
  const root = realTempDir(t);
  const identityHome = join(root, ".aweb-identity-x");
  const otherIdentityHome = join(root, ".aweb-identity-y");
  const home = join(root, "home");
  mkdirSync(identityHome, { recursive: true });
  mkdirSync(otherIdentityHome, { recursive: true });
  mkdirSync(home, { recursive: true });

  const oldForm = spawnSync("aw", ["--identity-home", identityHome, "team", "join", "not-a-token", "--name", "probe", "--json"], { cwd: home, encoding: "utf8", timeout: 10000 });
  assert.equal(oldForm.status, 2, oldForm.stdout + oldForm.stderr);
  assert.match(`${oldForm.stdout}${oldForm.stderr}`, new RegExp(TEAM_JOIN_POLICY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const accept = spawnSync("aw", ["--identity-home", identityHome, "id", "team", "accept-invite", "not-a-token", "--name", "probe", "--local", "--json"], { cwd: home, encoding: "utf8", timeout: 10000 });
  const acceptText = `${accept.stdout}${accept.stderr}`;
  assert.notEqual(accept.status, 0, "invalid token should fail");
  assert.doesNotMatch(acceptText, new RegExp(IDENTITY_HOME_POLICY));
  assert.doesNotMatch(acceptText, new RegExp(LOCAL_SCOPE_POLICY));
  assert.match(acceptText, /invalid invite token|invalid token|token payload|token/i);

  const cases = [
    { name: "accept-invite", args: ["id", "team", "accept-invite", "not-a-token", "--name", "probe", "--local", "--json"], expect: /invalid invite token|invalid token|token payload|token/i },
    { name: "workspace-connect", args: ["workspace", "connect", "--service", "https://app.aweb.ai/api", "--json"], expect: /connect|workspace|identity|initialized|team|member|key/i },
    { name: "workspace-delete", args: ["workspace", "delete", "no-such-alias", "--json"], expect: /delete|workspace|alias|identity|initialized|principal/i },
    { name: "mail-inbox", args: ["mail", "inbox", "--json"], expect: /mail|identity|initialized|workspace/i },
    { name: "mail-send", args: ["mail", "send", "--to", "nobody", "--subject", "probe", "--body", "probe", "--json"], expect: /mail|recipient|identity|initialized|workspace/i },
    { name: "mail-reply", args: ["mail", "reply", "no-such-message", "--body", "probe", "--json"], expect: /mail|message|identity|initialized|workspace/i },
    { name: "chat-pending", args: ["chat", "pending", "--json"], expect: /chat|identity|initialized|workspace/i },
    { name: "chat-send", args: ["chat", "send", "--session-id", "no-such-session", "--body", "probe", "--json"], expect: /chat|session|identity|initialized|workspace/i },
    { name: "wake-register", args: ["wake", "register", "--home", home, "--identity-home", otherIdentityHome, "--delivery", "bogus", "--json"], expect: /wake|home|identity|delivery|registration/i },
    { name: "wake-deregister", args: ["wake", "deregister", "--home", "relative-home", "--json"], expect: /wake|home|absolute|registration|deregister/i },
  ];

  for (const row of cases) {
    const result = spawnSync("aw", ["--identity-home", identityHome, ...row.args], { cwd: home, encoding: "utf8", timeout: 10000 });
    const output = `${result.stdout}${result.stderr}`;
    assert.doesNotMatch(output, new RegExp(IDENTITY_HOME_POLICY), `${row.name} hit the identity-home policy refusal: ${output}`);
    assert.doesNotMatch(output, new RegExp(LOCAL_SCOPE_POLICY), `${row.name} hit the local-scope identity-home policy refusal: ${output}`);
    if (!row.allowZero) assert.notEqual(result.status, 0, `${row.name} unexpectedly succeeded`);
    assert.match(output, row.expect, `${row.name} failed for an unexpected reason: ${output}`);
  }
});

test("published aw >= 1.36.6 exposes wake status version state", (t) => {
  const version = spawnSync("aw", ["version"], { encoding: "utf8", timeout: 10000 });
  const versionText = `${version.stdout ?? ""}${version.stderr ?? ""}`;
  const m = /aw\s+1\.36\.(\d+)/.exec(versionText);
  if (version.error || version.status !== 0 || !m || Number(m[1]) < 6) {
    t.skip(`aw is not a published 1.36.6+: ${(version.error?.message || versionText).trim()}`);
    return;
  }
  t.diagnostic(`aw version fixture: ${versionText.trim()}`);
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
  let checked = runBindingCheck(bindingRequest(settings, context), { PATH: outdatedAw.path, OATS_WORKSPACE: root, OATS_WORKSPACE_KEY: "local/fixture" }, home);
  let result = JSON.parse(checked.stdout).result;
  assert.equal(result.status, "needs-configuration");
  assert.match(result.problems.find((p) => p.code === "wake-daemon-outdated").message, /running 1\.36\.4.*required 1\.36\.5.*upgrade aw, then restart the host wake daemon/);

  const unknownAw = fakeAw114(t, { wakeStatus: { daemon_running: true, daemon_version_state: "unknown" } });
  checked = runBindingCheck(bindingRequest(settings, context), { PATH: unknownAw.path, OATS_WORKSPACE: root, OATS_WORKSPACE_KEY: "local/fixture" }, home);
  result = JSON.parse(checked.stdout).result;
  assert.equal(result.status, "ready");
  assert.match(result.warnings.find((w) => w.code === "wake-daemon-version-unknown").message, /compatibility unproven.*upgrade aw, then restart the host wake daemon/);

  const downAw = fakeAw114(t, { wakeStatus: { daemon_running: false, daemon_version_state: "not_running" } });
  checked = runBindingCheck(bindingRequest(settings, context), { PATH: downAw.path, OATS_WORKSPACE: root, OATS_WORKSPACE_KEY: "local/fixture" }, home);
  result = JSON.parse(checked.stdout).result;
  assert.equal(result.status, "needs-configuration");
  assert.ok(result.problems.some((p) => p.code === "wake-daemon-not-running"));
});
