import assert from "node:assert/strict";
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
const emit = (o) => console.log(JSON.stringify(o));
const flag = (n) => args.find((a) => a.startsWith(n + "="))?.slice(n.length + 1) ?? (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const home = () => identityHome || path.join(process.cwd(), ".aw");
if (args[0] === "version") { console.log("aw ${version} abcdef"); process.exit(0); }
if (args[0] === "team" && args[1] === "list") { emit({ active_team: "wrong-active:example.test", memberships: [{ team_id: "default:example.test" }, { team_id: "shared:example.test" }, { team_id: "other:example.test" }] }); process.exit(0); }
if (args[0] === "team" && args[1] === "invite") { emit({ token: "TOKEN__" + flag("--team-id") }); process.exit(0); }
if (args[0] === "team" && args[1] === "join") { const team = args[2].replace(/^TOKEN__/, ""), alias = flag("--name"); fs.mkdirSync(home(), { recursive: true }); fs.writeFileSync(path.join(home(), "identity.yaml"), "alias: " + alias + "\\n"); emit({ alias, team_id: team }); process.exit(0); }
if (args[0] === "id" && args[1] === "team" && args[2] === "accept-invite") { const team = args[3].replace(/^TOKEN__/, ""), alias = flag("--name"); fs.mkdirSync(home(), { recursive: true }); fs.writeFileSync(path.join(home(), "workspace.yaml"), "alias: " + alias + "\\n"); fs.mkdirSync(path.join(home(), "team-certs"), { recursive: true }); emit({ status: "accepted", team_id: team, alias }); process.exit(0); }
if (args[0] === "workspace" && args[1] === "delete") { fs.rmSync(home(), { recursive: true, force: true }); emit({ alias_released: true, alias_released_reason: "released" }); process.exit(0); }
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
  assert.equal(manifest.version, "1.17.0");
  assert.equal(JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version, "1.17.0");
  assert.equal(JSON.parse(readFileSync(join(REPO, "oats-package", "oats-package.json"), "utf8")).version, "1.17.0");
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
  const invites = fake.calls().filter(c => c.args[0] === "team" && c.args[1] === "invite");
  assert.deepEqual(invites.map(c => c.args.find((a) => a.startsWith("--team-id="))?.slice("--team-id=".length) ?? c.args[c.args.indexOf("--team-id") + 1]), ["default:example.test", "shared:example.test"]);
  assert.equal(invites[0].cwd, fx.ws);
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
});

test("valid team id is passed inert as one --team-id=value token", (t) => {
  const fx = fixture(t), fake = fakeAw117(t);
  const env = { ...process.env, ...fx.env, PATH: fake.path, OATS_DEFAULT_TEAM: "json", OATS_DEFAULT_TEAM_ID: "json:example.test", OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: JSON.stringify([{ label: "json", team: "json:example.test", default: true, from: "local" }]) };
  const r = spawnSync(process.execPath, [HOOK, "spawn"], { cwd: fx.home, env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const invite = fake.calls().find((c) => c.args[0] === "team" && c.args[1] === "invite");
  assert.ok(invite.args.includes("--team-id=json:example.test"));
  assert.equal(invite.args.includes("--team-id"), false);
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
  const message = "the default team shared-default has no provider id yet: its owner runs oats aweb setup, then commits the id, or choose another default with oats teams default";
  assert.deepEqual(readiness(fx, fake), { status: "needs-configuration", problems: [{ code: "needs-configuration", message }], warnings: [] });
  const spawned = runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } });
  assert.notEqual(spawned.status, 0);
  assert.match(spawned.stdout + spawned.stderr, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const teams = JSON.parse(runHook("teams", { cwd: fx.home, env: { ...fx.env, PATH: fake.path, OATS_META: "{}" }, args: ["--json"] }).stdout);
  assert.deepEqual(teams.defaultTeam, { label: "shared-default", team: null, from: "deployment" });
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
