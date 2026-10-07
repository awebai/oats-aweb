import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { currentRootQuery } from "./helpers/current-root-query.mjs";
import { assertKernelCheckAnswerRule } from "./helpers/kernel-check-answer-rule.mjs";
import { flagValue, joinFromCalls, joinFromFake } from "./helpers/fake-aw-join-from.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CAPABILITY = join(REPO, "oats-package", "capabilities", "oats-aweb");
const HOOK = join(CAPABILITY, "bin", "oats-aweb.mjs");
const BINDING = join(CAPABILITY, "bin", "oats-aweb-binding.mjs");
const TEAM_SETTING_MESSAGE = "teams are not a setting since oats.aweb 1.17 / OATS 0.30: use oats teams / oats soul teams";
const AWEB_TEAM_ID_MESSAGE = "aweb team ids must have shape <name>:<namespace> (name matches ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$; namespace is a hostname)";

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-117-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

function fakeAw117(t, { version = "1.36.13" } = {}) {
  const base = tempDir(t), bin = join(base, "bin"), calls = join(base, "calls.jsonl");
  write(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
let args = process.argv.slice(2), identityHome = null;
if (args[0] === "--identity-home") { identityHome = args[1]; args = args.slice(2); }
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, cwd: process.cwd(), identityHome }) + "\\n");
(${joinFromFake})(args);
const emit = (o) => console.log(JSON.stringify(o));
const flag = (n) => args.find((a) => a.startsWith(n + "="))?.slice(n.length + 1) ?? (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const home = () => identityHome || path.join(process.cwd(), ".aw");
if (args[0] === "version") { console.log("aw ${version} abcdef"); process.exit(0); }
if (args[0] === "team" && args[1] === "list") { emit({ active_team: "wrong-active:example.test", memberships: [{ team_id: "default:example.test" }, { team_id: "shared:example.test" }, { team_id: "other:example.test" }] }); process.exit(0); }
if (args[0] === "team" && args[1] === "invite") { emit({ token: "TOKEN__" + flag("--team-id") }); process.exit(0); }
if (args[0] === "team" && args[1] === "join") { const team = args[2].replace(/^TOKEN__/, ""), alias = flag("--name"); fs.mkdirSync(home(), { recursive: true }); fs.writeFileSync(path.join(home(), "identity.yaml"), "alias: " + alias + "\\n"); emit({ alias, team_id: team }); process.exit(0); }
if (args[0] === "id" && args[1] === "team" && args[2] === "accept-invite") { const team = args[3].replace(/^TOKEN__/, ""), alias = flag("--name"); fs.mkdirSync(home(), { recursive: true }); fs.writeFileSync(path.join(home(), "identity.yaml"), "alias: " + alias + "\\nteam_id: " + team + "\\n"); const certDir = path.join(home(), "team-certs"); fs.mkdirSync(certDir, { recursive: true }); if (!process.env.FAKE_CERT_OMIT) { const certTeam = process.env.FAKE_CERT_OTHER_TEAM || team; fs.writeFileSync(path.join(certDir, team.replace(/:/g, "__") + ".pem"), JSON.stringify({ version: 1, certificate_id: "cert-shared-123", team_id: certTeam, alias })); } emit({ status: "accepted", team_id: team, alias, aweb_url: "https://service.example.test/api" }); process.exit(0); }
if (args[0] === "workspace" && args[1] === "connect") { if (process.env.FAKE_CONNECT_FAIL) { console.error("connect refused by fixture"); process.exit(11); } const team = flag("--team"), service = flag("--service"); fs.mkdirSync(home(), { recursive: true }); fs.writeFileSync(path.join(home(), "workspace.yaml"), "alias: connected\\nteam_id: " + team + "\\naweb_url: " + service + "\\n"); emit({ status: "connected", team_id: team, aweb_url: service }); process.exit(0); }
if (args[0] === "workspace" && args[1] === "delete") { if (process.env.FAKE_DELETE_FAIL_FOR && String(identityHome || "").endsWith(".aweb-identity-" + process.env.FAKE_DELETE_FAIL_FOR)) { console.error("refusing aw workspace delete through external identity home: team_not_hosted"); process.exit(7); } if (process.env.FAKE_DEFAULT_TEAM_NOT_HOSTED && !identityHome) { emit({ alias_released: false, alias_released_reason: "team_not_hosted" }); process.exit(0); } fs.rmSync(home(), { recursive: true, force: true }); emit({ alias_released: true, alias_released_reason: "released" }); process.exit(0); }
if (args[0] === "id" && args[1] === "team" && args[2] === "members") { emit({ team_id: flag("--team-id"), members: [{ alias: "dev-1" }] }); process.exit(0); }
if (args[0] === "id" && args[1] === "team" && args[2] === "list") { const team = process.env.FAKE_LIST_OTHER_TEAM ? "other:example.test" : (String(identityHome || "").includes(".aweb-identity-shared") ? "shared:example.test" : "default:example.test"); emit({ memberships: [{ team_id: team, registry_origin: "https://api.awid.ai" }] }); process.exit(0); }
if (args[0] === "wake" && ["register", "deregister"].includes(args[1])) { console.log("ok"); process.exit(0); }
if (args[0] === "wake" && args[1] === "status") { emit({ daemon_running: true, daemon_version_state: "reported", daemon_version: "1.36.13", instances: [] }); process.exit(0); }
if (args[0] === "init") { fs.mkdirSync(path.join(process.cwd(), ".aw"), { recursive: true }); fs.writeFileSync(path.join(process.cwd(), ".aw", "teams.yaml"), "active_team: default:alice.aweb.ai\\n"); emit({ team_id: "default:alice.aweb.ai" }); process.exit(0); }
console.error("unexpected aw " + args.join(" ")); process.exit(93);
`);
  spawnSync("chmod", ["755", join(bin, "aw")]);
  return { path: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, calls: () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [] };
}

function fixture(t, { settings = {}, defaultFrom = "deployment" } = {}) {
  const ws = tempDir(t), home = join(ws, "agents", "dev", "instances", "dev-1");
  mkdirSync(join(ws, ".aw"), { recursive: true });
  write(join(ws, ".aw", "teams.yaml"), "active_team: wrong-active:example.test\n");
  mkdirSync(home, { recursive: true });
  const teams = [
    { label: "personal", team: "default:example.test", default: true, from: "local" },
    { label: "shared", team: "shared:example.test", default: false, from: "shared" },
  ];
  const env = {
    OATS_HOME: home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: ws,
    OATS_DEFAULT_TEAM: "personal", OATS_DEFAULT_TEAM_ID: "default:example.test", OATS_DEFAULT_TEAM_FROM: defaultFrom,
    OATS_TEAMS: JSON.stringify(teams), OATS_TEAMS_SOURCE: "live", OATS_RUNTIME: "claude",
    OATS_SETTINGS: JSON.stringify(settings),
  };
  return { ws, home, env, teams };
}
function runHook(event, { cwd, env, args = [] }) { return spawnSync(process.execPath, [HOOK, event, ...args], { cwd, env: { ...env, OATS_EVENT: event }, encoding: "utf8", timeout: 20000 }); }
function spawnDoc(r) { assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout.trim().split("\n").pop()); }
function readiness(fx, fake, settings = fx.env.OATS_SETTINGS ? JSON.parse(fx.env.OATS_SETTINGS) : {}) {
  const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: "fixture", deployment: fx.ws, soul: "dev", team: null, instance: "dev-1", home: fx.home } } };
  const r = spawnSync(process.execPath, [BINDING, "check"], { cwd: fx.home, input: JSON.stringify(input), env: { ...process.env, ...fx.env, PATH: fake.path }, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return assertKernelCheckAnswerRule(r.stdout, input, "oats-aweb 1.17 readiness").result;
}

test("1.17 manifest removes provider team setting and pins the breaking version", () => {
  const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));
  assert.equal(manifest.version, "1.22.2");
  assert.equal(JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version, "1.22.2");
  assert.equal(JSON.parse(readFileSync(join(REPO, "oats-package", "oats-package.json"), "utf8")).version, "1.22.2");
  assert.equal(manifest.settings.team, undefined);
  assert.doesNotMatch(JSON.stringify(manifest), /OATS_TEAM_ID|OATS_TEAM_LABEL|settings\.oats\.aweb\.team|root's active team/i);
});

test("spawn mints default identity from kernel default and joins only requested eligible teams", (t) => {
  const fake = fakeAw117(t);
  const fx = fixture(t, { settings: { join: "shared" }, defaultFrom: "soul" });
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } }));
  assert.equal(doc.meta.team, "default:example.test");
  assert.deepEqual(doc.meta.defaultTeam, { label: "personal", team: "default:example.test", from: "soul" });
  assert.equal(doc.meta.joinedTeams.length, 1);
  assert.equal(doc.meta.joinedTeams[0].label, "shared");
  const [mint] = joinFromCalls(fake.calls());
  assert.equal(flagValue(mint.args, "--join-team"), "default:example.test");
  assert.equal(flagValue(mint.args, "--join-from"), fx.ws);
  const invites = fake.calls().filter(c => c.args[0] === "team" && c.args[1] === "invite");
  assert.deepEqual(invites.map(c => flagValue(c.args, "--team-id")), ["shared:example.test"], "only the joined team is minted by invite");
  assert.equal(invites[0].cwd, fx.ws);
  const connect = fake.calls().find(c => c.identityHome === join(fx.home, ".aweb-identity-shared") && c.args[0] === "workspace" && c.args[1] === "connect");
  assert.ok(connect, "joined team is explicitly workspace-connected after accept-invite");
  assert.ok(connect.args.includes("--service=https://service.example.test/api"));
  assert.ok(connect.args.includes("--team=shared:example.test"));
  assert.equal(existsSync(join(fx.home, ".aweb-identity-shared", "workspace.yaml")), true);

});


test("joined team connect failure fails the join and records no unusable identity", (t) => {
  const fake = fakeAw117(t);
  const fx = fixture(t, { settings: { join: "shared" } });
  const r = runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path, FAKE_CONNECT_FAIL: "1" } });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.match(doc.warning, /workspace connect\/verification failed/);
  assert.equal(doc.meta?.joinedTeams, undefined, "unusable joined identity is not recorded for rollback as usable state");
  assert.equal(existsSync(join(fx.home, ".aweb-identity-shared")), false, "failed joined identity is deleted with leave cleanup");
  assert.equal(existsSync(join(fx.home, ".oats-aweb", "teams.json")), false, "provider state is not written for the failed join");
});

test("forwarded --soul is ignored by teams, join, leave, and roster operator commands", (t) => {
  const fake = fakeAw117(t);
  const fx = fixture(t);
  writeFileSync(join(fx.ws, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  fx.env.OATS_CLI_BIN = currentRootQuery(fx.ws, { home: fx.home, deployment: fx.ws, settings: { root: fx.ws } }).cli;
  const spawned = spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } }));
  writeFileSync(join(fx.home, "instance.json"), JSON.stringify({ instance: "dev-1", runtime: "claude", capabilityMeta: { "oats.aweb": spawned.meta } }));

  const joined = runHook("join", { cwd: fx.home, env: { ...fx.env, PATH: fake.path, OATS_META: JSON.stringify(spawned.meta) }, args: ["--soul", "dev", "shared", "--json"] });
  assert.equal(joined.status, 0, joined.stdout + joined.stderr);
  assert.deepEqual(JSON.parse(joined.stdout).actions.map((a) => [a.action, a.label]), [["join", "shared"]]);

  const teams = runHook("teams", { cwd: fx.home, env: { ...fx.env, PATH: fake.path }, args: ["--json", "--soul=dev"] });
  assert.equal(teams.status, 0, teams.stdout + teams.stderr);
  assert.equal(JSON.parse(teams.stdout).joined[0].label, "shared");

  const roster = runHook("roster", { cwd: fx.home, env: { ...fx.env, PATH: fake.path }, args: ["--soul", "dev", "--json"] });
  assert.equal(roster.status, 0, roster.stdout + roster.stderr);
  assert.deepEqual(JSON.parse(roster.stdout).members.map((m) => m.alias), ["dev-1"]);

  const left = runHook("leave", { cwd: fx.home, env: { ...fx.env, PATH: fake.path }, args: ["shared", "--soul", "dev", "--json"] });
  assert.equal(left.status, 0, left.stdout + left.stderr);
  assert.deepEqual(JSON.parse(left.stdout).actions.map((a) => [a.action, a.label]), [["leave", "shared"]]);
  assert.equal(fake.calls().some((c) => c.args.includes("--soul") || c.args.some((a) => a.startsWith("--soul="))), false, "--soul is dispatch-only and never reaches aw");
});

test("team setting is refused from host, soul and spawn settings", (t) => {
  const fx = fixture(t), fake = fakeAw117(t);
  for (const [layer, value] of [["host", "host:example.test"], ["soul", "soul:example.test"]]) {
    const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: { team: value }, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: "fixture", deployment: fx.ws, soul: "dev", team: null, instance: null, home: fx.home } } };
    const r = spawnSync(process.execPath, [BINDING, "check"], { cwd: fx.home, input: JSON.stringify(input), env: { ...process.env, ...fx.env, PATH: fake.path }, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, `${layer}: ${r.stderr}`);
    assert.deepEqual(JSON.parse(r.stdout).error, { code: "needs-configuration", message: TEAM_SETTING_MESSAGE }, layer);
  }
  const spawned = spawnSync(process.execPath, [HOOK, "spawn"], { cwd: fx.home, env: { ...process.env, ...fx.env, PATH: fake.path, OATS_EVENT: "spawn", OATS_SETTINGS: JSON.stringify({ team: "spawn:example.test" }) }, encoding: "utf8", timeout: 20000 });
  assert.notEqual(spawned.status, 0);
  assert.match(JSON.parse(spawned.stdout).warning, new RegExp(TEAM_SETTING_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const launched = spawnSync(process.execPath, [HOOK, "launch"], { cwd: fx.home, env: { ...process.env, ...fx.env, PATH: fake.path, OATS_EVENT: "launch", OATS_SETTINGS: JSON.stringify({ team: "launch:example.test" }) }, encoding: "utf8", timeout: 20000 });
  assert.notEqual(launched.status, 0);
  assert.match(JSON.parse(launched.stdout).warning, new RegExp(TEAM_SETTING_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("retire ignores stale current team and invalid current identity mode", (t) => {
  for (const [name, settings] of [["stale-team", { team: "old:example.test" }], ["invalid-mode", { identity: { mode: "bogus" } }]]) {
    const fake = fakeAw117(t);
    const fx = fixture(t, { settings });
    mkdirSync(join(fx.home, ".aw"), { recursive: true });
    write(join(fx.home, ".aw", "identity.yaml"), "alias: dev-1\n");
    const meta = { alias: "dev-1", team: "default:example.test", identity: { mode: "local", alias: "dev-1", team: "default:example.test" } };
    const retired = runHook("retire", { cwd: fx.home, env: { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify(settings), OATS_META: JSON.stringify(meta) } });
    assert.equal(retired.status, 0, `${name}: ${retired.stdout}${retired.stderr}`);
    const doc = JSON.parse(retired.stdout);
    assert.equal(doc.meta.retired, true, name);
    assert.equal(fake.calls().some((c) => c.args.join(" ") === "workspace delete dev-1 --json" && c.cwd === fx.home), true, name);
    if (name === "stale-team") assert.match(doc.warning, new RegExp(TEAM_SETTING_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("retire reports controller cleanup for joined BYOT teams", (t) => {
  const fake = fakeAw117(t);
  const fx = fixture(t, { settings: { join: "shared" } });
  const spawned = spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } }));
  const retired = runHook("retire", { cwd: fx.home, env: { ...fx.env, PATH: fake.path, OATS_META: JSON.stringify(spawned.meta), FAKE_DELETE_FAIL_FOR: "shared" } });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  const doc = JSON.parse(retired.stdout);
  assert.match(doc.warning, /joined team shared cleanup failed: team_not_hosted/);
  assert.match(doc.warning, /aw id team remove-member --namespace example\.test --team shared --cert-id cert-shared-123 --registry https:\/\/api\.awid\.ai --json/);
  assert.doesNotMatch(doc.warning, /kept .* retry/);
  assert.deepEqual(doc.meta.pendingControllerCleanup, [{ label: "shared", team: "shared:example.test", alias: "dev-1", certificateId: "cert-shared-123", command: "aw id team remove-member --namespace example.test --team shared --cert-id cert-shared-123 --registry https://api.awid.ai --json" }]);
});

test("retire reports controller cleanup for a BYOT default identity", (t) => {
  const fake = fakeAw117(t);
  const fx = fixture(t);
  mkdirSync(join(fx.home, ".aw", "team-certs"), { recursive: true });
  write(join(fx.home, ".aw", "identity.yaml"), "alias: dev-1\nteam_id: default:example.test\n");
  write(join(fx.home, ".aw", "team-certs", "default__example.test.pem"), JSON.stringify({ version: 1, certificate_id: "cert-default-123", team_id: "default:example.test", alias: "dev-1" }));
  const meta = { alias: "dev-1", team: "default:example.test", identity: { mode: "local", alias: "dev-1", team: "default:example.test" } };
  const retired = runHook("retire", { cwd: fx.home, env: { ...fx.env, PATH: fake.path, OATS_META: JSON.stringify(meta), FAKE_DEFAULT_TEAM_NOT_HOSTED: "1", AWID_REGISTRY_URL: "https://api.awid.ai" } });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  const doc = JSON.parse(retired.stdout);
  assert.equal(doc.meta.aliasReusable, false);
  assert.equal(doc.meta.aliasReason, "team_not_hosted");
  assert.match(doc.warning, /default identity cleanup failed: team_not_hosted/);
  assert.match(doc.warning, /aw id team remove-member --namespace example\.test --team default --cert-id cert-default-123 --registry https:\/\/api\.awid\.ai --json/);
  assert.deepEqual(doc.meta.pendingControllerCleanup, [{ label: "default", team: "default:example.test", alias: "dev-1", certificateId: "cert-default-123", command: "aw id team remove-member --namespace example.test --team default --cert-id cert-default-123 --registry https://api.awid.ai --json" }]);
});

test("retire of a hosted identity has no controller cleanup disposition", (t) => {
  const fake = fakeAw117(t);
  const fx = fixture(t);
  mkdirSync(join(fx.home, ".aw"), { recursive: true });
  write(join(fx.home, ".aw", "identity.yaml"), "alias: dev-1\n");
  const meta = { alias: "dev-1", team: "default:example.test", identity: { mode: "local", alias: "dev-1", team: "default:example.test" } };
  const retired = runHook("retire", { cwd: fx.home, env: { ...fx.env, PATH: fake.path, OATS_META: JSON.stringify(meta) } });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  const doc = JSON.parse(retired.stdout);
  assert.equal(doc.meta.aliasReusable, true);
  assert.equal(doc.meta.pendingControllerCleanup, undefined);
});

test("valid team id is passed inert as one --team-id=value token", (t) => {
  const fx = fixture(t), fake = fakeAw117(t);
  const env = { ...process.env, ...fx.env, PATH: fake.path, OATS_DEFAULT_TEAM: "json", OATS_DEFAULT_TEAM_ID: "json:example.test", OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: JSON.stringify([{ label: "json", team: "json:example.test", default: true, from: "local" }]) };
  const r = spawnSync(process.execPath, [HOOK, "spawn"], { cwd: fx.home, env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [mint] = joinFromCalls(fake.calls());
  assert.ok(mint.args.includes("--join-team=json:example.test"));
  assert.equal(mint.args.includes("--join-team"), false);
});

test("malformed aweb team ids are refused before any aw call", (t) => {
  for (const [name, override] of [
    ["default", { OATS_DEFAULT_TEAM_ID: "not a team id" }],
    ["eligible", { OATS_TEAMS: JSON.stringify([{ label: "bad", team: "bad:bad host", default: false, from: "local" }]) }],
  ]) {
    const fx = fixture(t), fake = fakeAw117(t);
    const env = { ...process.env, ...fx.env, PATH: fake.path, ...override };
    const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: {}, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: "fixture", deployment: fx.ws, soul: "dev", team: null, instance: "dev-1", home: fx.home } } };
    const checked = spawnSync(process.execPath, [BINDING, "check"], { cwd: fx.home, input: JSON.stringify(input), env, encoding: "utf8", timeout: 20000 });
    assert.equal(checked.status, 0, checked.stderr);
    assert.deepEqual(JSON.parse(checked.stdout).result, { status: "needs-configuration", problems: [{ code: "needs-configuration", message: AWEB_TEAM_ID_MESSAGE }], warnings: [] }, name);
    const spawned = spawnSync(process.execPath, [HOOK, "spawn"], { cwd: fx.home, env: { ...env, OATS_EVENT: "spawn" }, encoding: "utf8", timeout: 20000 });
    assert.notEqual(spawned.status, 0, name);
    assert.match(JSON.parse(spawned.stdout).warning, new RegExp(AWEB_TEAM_ID_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(fake.calls(), [], `${name}: no aw invocation before malformed-id refusal`);
  }
});

test("no kernel default is an exact readiness and spawn configuration failure", (t) => {
  const fake = fakeAw117(t);
  const fx = fixture(t);
  delete fx.env.OATS_DEFAULT_TEAM; delete fx.env.OATS_DEFAULT_TEAM_ID; delete fx.env.OATS_DEFAULT_TEAM_FROM; fx.env.OATS_TEAMS = "[]";
  assert.deepEqual(readiness(fx, fake), { status: "needs-configuration", problems: [{ code: "needs-configuration", message: "no teams configured: run `oats aweb setup`" }], warnings: [] });
  const r = runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /no teams configured: run `oats aweb setup`/);
});

test("unmapped default has distinct readiness/spawn failure and nullable defaultTeam document", (t) => {
  const fake = fakeAw117(t);
  const fx = fixture(t);
  fx.env.OATS_DEFAULT_TEAM = "shared-default";
  fx.env.OATS_DEFAULT_TEAM_FROM = "deployment";
  delete fx.env.OATS_DEFAULT_TEAM_ID;
  fx.env.OATS_TEAMS = JSON.stringify([{ label: "other", team: "other:example.test", default: false, from: "local" }]);
  const message = "the default team shared-default has no provider id yet: its owner runs oats aweb setup, then commits the id, or choose another default: `oats teams default <label>`, or `defaultTeam:` in oats-workspace.yaml when the workspace doesn't allow local teams";
  assert.deepEqual(readiness(fx, fake), { status: "needs-configuration", problems: [{ code: "needs-configuration", message }], warnings: [] });
  const spawned = runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } });
  assert.notEqual(spawned.status, 0);
  assert.match(spawned.stdout + spawned.stderr, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const teams = JSON.parse(runHook("teams", { cwd: fx.home, env: { ...fx.env, PATH: fake.path, OATS_META: "{}" }, args: ["--json"] }).stdout);
  assert.deepEqual(teams.defaultTeam, { label: "shared-default", team: null, from: "deployment" });
});

test("team model 3: a workspace default team is reported as from workspace", (t) => {
  const fake = fakeAw117(t);
  const fx = fixture(t, { defaultFrom: "workspace" });
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } }));
  assert.deepEqual(doc.meta.defaultTeam, { label: "personal", team: "default:example.test", from: "workspace" });
  assert.match(doc.brief, /on team default:example\.test, the workspace's default team\./);
  for (const meta of [doc.meta, {}]) {
    const teams = JSON.parse(runHook("teams", { cwd: fx.home, env: { ...fx.env, PATH: fake.path, OATS_META: JSON.stringify(meta) }, args: ["--json"] }).stdout);
    assert.deepEqual(teams.defaultTeam, { label: "personal", team: "default:example.test", from: "workspace" });
  }
});

test("team model 3: join refuses a label outside the eligible rows", (t) => {
  const fake = fakeAw117(t);
  const fx = fixture(t, { defaultFrom: "soul" });
  // OATS 0.38 rows carry `via`; a workspace team this soul's `souls:` entry does not list is not a row.
  fx.env.OATS_TEAMS = JSON.stringify([
    { label: "personal", team: "default:example.test", default: true, from: "shared", via: ["default"] },
    { label: "shared", team: "shared:example.test", default: false, from: "shared", via: ["workspace"] },
  ]);
  const env = { ...fx.env, PATH: fake.path, OATS_META: "{}" };
  const r = runHook("join", { cwd: fx.home, env, args: ["--labels", "docs"] });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /E_TEAM_NOT_ELIGIBLE: docs is not an eligible team label for this instance \(eligible: shared\)/);
  assert.deepEqual(fake.calls().map((c) => c.args[0]), ["version"], "only the aw floor check; nothing for a refused label");
});

test("team model 3: docs name the workspace default and what setup does where local teams are closed", () => {
  const changelog = readFileSync(join(REPO, "CHANGELOG.md"), "utf8");
  assert.match(changelog, /\n## 1\.19\.0\n/);
  const entry = changelog.slice(changelog.indexOf("## 1.19.0"), changelog.indexOf("## 1.18.1"));
  const skill = readFileSync(join(CAPABILITY, "skills", "oats-aweb", "SKILL.md"), "utf8");
  const readme = readFileSync(join(REPO, "README.md"), "utf8");
  for (const [name, text] of [["CHANGELOG 1.19.0", entry], ["skill", skill], ["README", readme]]) {
    assert.match(text, /workspace/, name);
    assert.match(text, /localTeams: true/, name);
    assert.match(text, /`souls:` entry/, name);
  }
  assert.match(skill, /`defaultTeam\.from` is `soul`, `deployment` or `workspace`/);
});

test("teams document uses eligible non-default rows and preserves visible live leaves", (t) => {
  const fake = fakeAw117(t);
  const fx = fixture(t, { settings: { join: "shared" } });
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } }));
  let teams = JSON.parse(runHook("teams", { cwd: fx.home, env: { ...fx.env, PATH: fake.path, OATS_META: JSON.stringify(doc.meta) }, args: ["--json"] }).stdout);
  assert.deepEqual(teams.defaultTeam, { label: "personal", team: "default:example.test", from: "deployment" });
  assert.deepEqual(teams.eligible.map(t => t.label), ["shared"]);
  assert.equal(teams.left.length, 0);

  const envAfterLoss = { ...fx.env, PATH: fake.path, OATS_META: JSON.stringify(doc.meta), OATS_TEAMS: JSON.stringify([{ label: "personal", team: "default:example.test", default: true, from: "local" }]) };
  const launch = runHook("launch", { cwd: fx.home, env: envAfterLoss });
  assert.equal(launch.status, 0, launch.stdout + launch.stderr);
  assert.match(JSON.parse(launch.stdout).warning, /left joined team shared because it is no longer eligible/);
  teams = JSON.parse(runHook("teams", { cwd: fx.home, env: envAfterLoss, args: ["--json"] }).stdout);
  assert.equal(teams.left[0].label, "shared");
  assert.equal(teams.left[0].reason, "no-longer-eligible");
  const events = readFileSync(join(fx.home, ".oats-events.jsonl"), "utf8");
  assert.match(events, /aweb-team-left/);
});

test("failed lost-team leave appends a durable event and keeps the team joined", (t) => {
  const fake = fakeAw117(t);
  const fx = fixture(t, { settings: { join: "shared" } });
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } }));
  const envAfterLoss = { ...fx.env, PATH: fake.path, OATS_META: JSON.stringify(doc.meta), OATS_TEAMS: JSON.stringify([{ label: "personal", team: "default:example.test", default: true, from: "local" }]), FAKE_DELETE_FAIL_FOR: "shared" };
  const launch = runHook("launch", { cwd: fx.home, env: envAfterLoss });
  assert.equal(launch.status, 0, launch.stdout + launch.stderr);
  const launched = JSON.parse(launch.stdout);
  assert.match(launched.warning, /joined team shared cleanup failed/);
  assert.match(launched.warning, /team_not_hosted/);
  assert.match(launched.warning, /aw id team remove-member --namespace example\.test --team shared --cert-id cert-shared-123 --registry https:\/\/api\.awid\.ai --json/);
  assert.deepEqual(launched.meta.joinedTeams.map((j) => j.label), ["shared"], "failed leave keeps the still-member team recorded as joined");
  assert.deepEqual(launched.meta.left, [], "failed leave does not add a visible successful leave");
  const teams = JSON.parse(runHook("teams", { cwd: fx.home, env: { ...envAfterLoss, OATS_META: JSON.stringify(launched.meta), FAKE_DELETE_FAIL_FOR: undefined }, args: ["--json"] }).stdout);
  assert.deepEqual(teams.joined.map((j) => j.label), ["shared"]);
  assert.deepEqual(teams.left, []);
  const events = readFileSync(join(fx.home, ".oats-events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const failed = events.find((e) => e.kind === "aweb-team-leave-failed");
  assert.deepEqual({ label: failed.data.label, team: failed.data.team, alias: failed.data.alias, certificateId: failed.data.certificateId, registry: failed.data.registry, cleanup: failed.data.cleanup }, { label: "shared", team: "shared:example.test", alias: "dev-1", certificateId: "cert-shared-123", registry: "https://api.awid.ai", cleanup: "controller" });
  assert.equal(failed.data.reason, "team_not_hosted");
  assert.equal(events.some((e) => e.kind === "aweb-team-left"), false, "no successful leave event is appended on failure");
});

test("failed lost-team leave does not use a mismatched certificate file", (t) => {
  const fake = fakeAw117(t);
  const fx = fixture(t, { settings: { join: "shared" } });
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path, FAKE_CERT_OTHER_TEAM: "other:example.test" } }));
  const envAfterLoss = { ...fx.env, PATH: fake.path, OATS_META: JSON.stringify(doc.meta), OATS_TEAMS: JSON.stringify([{ label: "personal", team: "default:example.test", default: true, from: "local" }]), FAKE_DELETE_FAIL_FOR: "shared", FAKE_CERT_OTHER_TEAM: "other:example.test" };
  const launch = runHook("launch", { cwd: fx.home, env: envAfterLoss });
  assert.equal(launch.status, 0, launch.stdout + launch.stderr);
  const launched = JSON.parse(launch.stdout);
  assert.match(launched.warning, /controller cleanup needs the certificate id/);
  assert.doesNotMatch(launched.warning, /--cert-id cert-shared-123/);
  const events = readFileSync(join(fx.home, ".oats-events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const failed = events.find((e) => e.kind === "aweb-team-leave-failed");
  assert.equal(failed.data.certificateId, null);
  assert.match(failed.data.certificateIdError, /certificate file .* is for other:example\.test, not shared:example\.test/);
});

test("failed lost-team leave reports no certificate id when neither cert file nor team list has one", (t) => {
  const fake = fakeAw117(t);
  const fx = fixture(t, { settings: { join: "shared" } });
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path, FAKE_CERT_OMIT: "1" } }));
  const envAfterLoss = { ...fx.env, PATH: fake.path, OATS_META: JSON.stringify(doc.meta), OATS_TEAMS: JSON.stringify([{ label: "personal", team: "default:example.test", default: true, from: "local" }]), FAKE_DELETE_FAIL_FOR: "shared", FAKE_CERT_OMIT: "1" };
  const launch = runHook("launch", { cwd: fx.home, env: envAfterLoss });
  assert.equal(launch.status, 0, launch.stdout + launch.stderr);
  const launched = JSON.parse(launch.stdout);
  assert.match(launched.warning, /controller cleanup needs the certificate id/);
  assert.doesNotMatch(launched.warning, /--cert-id/);
  const events = readFileSync(join(fx.home, ".oats-events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const failed = events.find((e) => e.kind === "aweb-team-leave-failed");
  assert.equal(failed.data.certificateId, null);
  assert.match(failed.data.certificateIdError, /certificate id for shared:example\.test was not present in the joined certificate file or aw id team list --json/);
});
