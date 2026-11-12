// awebai/oats-aweb#217: a join killed between `aw id team accept-invite` and the
// record of the joined team leaves no orphaned membership. The intended join is
// written ahead of the accept (teams.json pendingJoins); the next join adopts
// it, a leave or retire releases it (adopt first, then the one release path),
// and a start only warns.
//
// The fake aw models what real aw does in an identity home: accept-invite
// writes identity.yaml, signing.key, a team certificate and teams.yaml, and
// refuses to overwrite completed local state; `id team list` reads teams.yaml;
// `workspace delete` needs the workspace binding that `workspace connect`
// writes. Opt-in behaviour, by env:
//   FAKE_KILL=before-accept  accept-invite SIGKILLs its parent (the hook) before writing
//   FAKE_KILL=empty-home     the same, after creating the empty identity home
//   FAKE_KILL=after-accept   accept-invite writes the identity, then SIGKILLs its parent
//   FAKE_KILL=after-connect  workspace connect writes the binding, then SIGKILLs its parent
//   FAKE_KILL_FOR=<label>    kill only for .aweb-identity-<label>
//   FAKE_LIST_FAIL           `id team list` fails as aw does on a server error
//   FAKE_DELETE_FAIL         `workspace delete` of a joined home fails (503)
//   FAKE_DELETE_NOT_HOSTED   `workspace delete` of a joined home is aw's team_not_hosted refusal
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { currentRootQuery } from "./helpers/current-root-query.mjs";
import { joinFromFake } from "./helpers/fake-aw-join-from.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HOOK = join(REPO, "oats-package", "capabilities", "oats-aweb", "bin", "oats-aweb.mjs");
const DEFAULT = "default:example.test", SHARED = "shared:example.test", EXTRA = "extra:example.test", MOVED = "moved:example.test";

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-217-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

function fakeAw(t) {
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
const joinedLabel = () => identityHome ? path.basename(identityHome).replace(/^\\.aweb-identity-/, "") : undefined;
const killHere = (when) => process.env.FAKE_KILL === when && (!process.env.FAKE_KILL_FOR || process.env.FAKE_KILL_FOR === joinedLabel());
const killParent = () => { process.kill(process.ppid, "SIGKILL"); process.exit(0); };
const membershipsOf = (dir) => { try { return [...fs.readFileSync(path.join(dir, "teams.yaml"), "utf8").matchAll(/- team_id: (\\S+)/g)].map((m) => ({ team_id: m[1] })); } catch { return []; } };
if (args[0] === "version") { console.log("aw 1.36.33 abcdef"); process.exit(0); }
if (args[0] === "team" && args[1] === "list") { emit({ active_team: "${DEFAULT}", memberships: [{ team_id: "${DEFAULT}" }, { team_id: "${SHARED}" }, { team_id: "${EXTRA}" }, { team_id: "${MOVED}" }] }); process.exit(0); }
if (args[0] === "team" && args[1] === "invite") { emit({ token: "TOKEN__" + flag("--team-id") }); process.exit(0); }
if (args[0] === "id" && args[1] === "team" && args[2] === "accept-invite") {
  const team = fs.readFileSync(0, "utf8").trim().replace(/^TOKEN__/, ""), alias = flag("--name");
  if (killHere("before-accept")) killParent();
  if (killHere("empty-home")) { fs.mkdirSync(home(), { recursive: true }); killParent(); }
  for (const name of ["signing.key", "identity.yaml", "teams.yaml"]) if (fs.existsSync(path.join(home(), name))) { console.error("Error: refusing to overwrite completed local state " + path.join(home(), name)); process.exit(1); }
  const certPath = "team-certs/" + team.replace(/:/g, "__") + ".pem";
  fs.mkdirSync(path.join(home(), "team-certs"), { recursive: true });
  fs.writeFileSync(path.join(home(), "signing.key"), "fixture-key\\n");
  fs.writeFileSync(path.join(home(), "identity.yaml"), "did: did:key:zJoined" + joinedLabel() + "\\nalias: " + alias + "\\n");
  fs.writeFileSync(path.join(home(), certPath), JSON.stringify({ version: 1, certificate_id: "cert-" + joinedLabel(), team_id: team, alias }));
  fs.writeFileSync(path.join(home(), "teams.yaml"), "active_team: " + team + "\\nmemberships:\\n    - team_id: " + team + "\\n      alias: " + alias + "\\n      cert_path: " + certPath + "\\n");
  if (killHere("after-accept")) killParent();
  emit({ status: "accepted", team_id: team, alias, aweb_url: "https://service.example.test/api" }); process.exit(0);
}
if (args[0] === "id" && args[1] === "team" && args[2] === "list") {
  if (process.env.FAKE_LIST_FAIL) { console.error("aweb: http 503 (Content-Type: text/plain): registry unavailable"); process.exit(1); }
  emit({ memberships: membershipsOf(home()).map((m) => ({ ...m, registry_origin: "https://api.awid.ai" })) }); process.exit(0);
}
if (args[0] === "workspace" && args[1] === "connect") {
  fs.writeFileSync(path.join(home(), "workspace.yaml"), "aweb_url: " + flag("--service") + "\\nmemberships:\\n    - team_id: " + flag("--team") + "\\n");
  if (killHere("after-connect")) killParent();
  emit({ status: "connected", team_id: flag("--team"), aweb_url: flag("--service") }); process.exit(0);
}
if (args[0] === "workspace" && args[1] === "delete") {
  if (identityHome && !fs.existsSync(path.join(identityHome, "workspace.yaml"))) { console.error("Error: no workspace binding in " + identityHome + "; run aw workspace connect first"); process.exit(1); }
  if (identityHome && process.env.FAKE_DELETE_FAIL) { console.error("Error: delete workspace " + args[2] + ": 503 Service Unavailable: team controller unavailable"); process.exit(1); }
  if (identityHome && process.env.FAKE_DELETE_NOT_HOSTED) { console.error("refusing aw workspace delete through external identity home for principal did:key:zJoined" + joinedLabel() + "; only own hosted local self-release is supported for an external identity home (reason: team_not_hosted)"); process.exit(2); }
  fs.rmSync(home(), { recursive: true, force: true });
  emit({ alias_released: true, alias_released_reason: "released" }); process.exit(0);
}
if (args[0] === "wake" && ["register", "deregister"].includes(args[1])) { console.log("ok"); process.exit(0); }
if (args[0] === "wake" && args[1] === "status") { emit({ daemon_running: true, daemon_version_state: "reported", daemon_version: "1.36.33", instances: [] }); process.exit(0); }
console.error("unexpected aw " + args.join(" ")); process.exit(93);
`);
  spawnSync("chmod", ["755", join(bin, "aw")]);
  return { path: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, calls: () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [] };
}

/** `captured`: the settings the home was spawned with (OATS_SETTINGS); the
 *  live settings, which an explicit join reads, always name `root: ws`. */
function fixture(t, { teamOf = {}, captured } = {}) {
  const ws = tempDir(t), home = join(ws, "agents", "dev", "instances", "dev-1");
  write(join(ws, ".aw", "workspace.yaml"), "aweb_url: https://service.example.test/api\n");
  write(join(ws, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  mkdirSync(home, { recursive: true });
  const fake = fakeAw(t);
  const teams = (over = {}) => JSON.stringify([
    { label: "personal", team: DEFAULT, default: true, from: "local" },
    { label: "shared", team: over.shared || SHARED, default: false, from: "shared" },
    { label: "extra", team: EXTRA, default: false, from: "shared" },
  ]);
  const env = {
    PATH: fake.path, OATS_HOME: home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: ws,
    OATS_DEFAULT_TEAM: "personal", OATS_DEFAULT_TEAM_ID: DEFAULT, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: teams(teamOf), OATS_TEAMS_SOURCE: "live", OATS_RUNTIME: "claude",
    OATS_SETTINGS: JSON.stringify(captured ? captured(ws) : { root: ws }),
    OATS_CLI_BIN: currentRootQuery(ws, { home, deployment: ws, settings: { root: ws } }).cli,
  };
  const hook = (event, { args = [], extra = {} } = {}) => spawnSync(process.execPath, [HOOK, event, ...args], { cwd: home, env: { ...env, ...extra, OATS_EVENT: event }, encoding: "utf8", timeout: 20000 });
  const spawned = hook("spawn");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const meta = JSON.parse(spawned.stdout.trim().split("\n").pop()).meta;
  writeFileSync(join(home, "instance.json"), JSON.stringify({ instance: "dev-1", runtime: "claude", capabilityMeta: { "oats.aweb": meta } }));
  const stateFile = join(home, ".oats-aweb", "teams.json");
  const state = () => JSON.parse(readFileSync(stateFile, "utf8"));
  const identityHome = (label) => join(home, `.aweb-identity-${label}`);
  const callsSince = (n) => fake.calls().slice(n);
  const invites = (calls = fake.calls()) => calls.filter((c) => c.args[0] === "team" && c.args[1] === "invite");
  const accepts = (calls = fake.calls()) => calls.filter((c) => c.args.slice(0, 3).join(" ") === "id team accept-invite");
  const deletes = (calls = fake.calls()) => calls.filter((c) => c.args[0] === "workspace" && c.args[1] === "delete");
  return { ws, home, env, meta, fake, hook, stateFile, state, identityHome, callsSince, invites, accepts, deletes, teams };
}
const join217 = (fx, labels, extra) => fx.hook("join", { args: ["--labels", labels, "--json"], extra });
const leave217 = (fx, labels, extra) => fx.hook("leave", { args: ["--labels", labels, "--json"], extra });
const retire217 = (fx, extra) => fx.hook("retire", { extra: { OATS_META: JSON.stringify(fx.meta), ...extra } });
const launch217 = (fx, extra) => fx.hook("launch", { extra: { OATS_META: JSON.stringify(fx.meta), ...extra } });
const lastDoc = (r) => JSON.parse(r.stdout.trim().split("\n").pop());

/** The state of #217: a join whose hook was killed right after aw accepted the invite. */
function killedAfterAccept(fx, label = "shared", extra = {}) {
  const r = join217(fx, label, { FAKE_KILL: "after-accept", ...extra });
  assert.equal(r.signal, "SIGKILL", `the fake killed the hook: ${r.status} ${r.stdout}${r.stderr}`);
  assert.ok(existsSync(join(fx.identityHome(label), "identity.yaml")), "aw wrote the accepted identity");
  assert.ok(!existsSync(join(fx.identityHome(label), "workspace.yaml")), "the hook died before workspace connect");
  return r;
}

// ------------------------------------------------- A: a real kill after accept

test("A: the intended join is on disk before accept-invite runs, and a kill leaves it there", (t) => {
  const fx = fixture(t);
  const before = Date.now();
  killedAfterAccept(fx);
  const state = fx.state();
  assert.deepEqual(state.joinedTeams, []);
  assert.equal(state.pendingJoins.length, 1);
  const [pending] = state.pendingJoins;
  assert.deepEqual({ label: pending.label, team: pending.team, identityHome: pending.identityHome, alias: pending.alias }, { label: "shared", team: SHARED, identityHome: fx.identityHome("shared"), alias: "dev-1" });
  assert.ok(Date.parse(pending.at) >= before - 1000 && Date.parse(pending.at) <= Date.now(), pending.at);
});

test("A: after a killed join, `oats aweb join` adopts the membership: recorded, intent gone, no second invite or accept", (t) => {
  const fx = fixture(t);
  killedAfterAccept(fx);
  const r = join217(fx, "shared");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const state = fx.state();
  assert.deepEqual(state.joinedTeams.map((j) => [j.label, j.team, j.identityHome]), [["shared", SHARED, fx.identityHome("shared")]]);
  assert.equal(state.pendingJoins, undefined, "the intent is dropped");
  assert.equal(fx.invites().length, 1, "no second invite minted");
  assert.equal(fx.accepts().length, 1, "no second accept");
  assert.ok(existsSync(join(fx.identityHome("shared"), "workspace.yaml")), "the adoption connected the workspace");
  assert.deepEqual(JSON.parse(r.stdout).joined.map((j) => [j.label, j.team]), [["shared", SHARED]]);
});

test("A: after a killed join, `oats aweb leave` adopts and releases it: workspace delete ran, the identity home is gone, nothing pending or joined", (t) => {
  const fx = fixture(t);
  killedAfterAccept(fx);
  const r = leave217(fx, "shared");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fx.deletes().map((c) => c.identityHome), [fx.identityHome("shared")]);
  assert.equal(existsSync(fx.identityHome("shared")), false);
  const state = fx.state();
  assert.deepEqual(state.joinedTeams, []);
  assert.equal(state.pendingJoins, undefined);
  assert.equal(fx.invites().length, 1);
  assert.equal(fx.accepts().length, 1);
});

test("A: after a killed join, retire releases it like leave", (t) => {
  const fx = fixture(t);
  killedAfterAccept(fx);
  const r = retire217(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fx.deletes().some((c) => c.identityHome === fx.identityHome("shared")), "workspace delete ran for the adopted identity");
  assert.equal(existsSync(fx.identityHome("shared")), false);
  const state = fx.state();
  assert.deepEqual(state.joinedTeams, []);
  assert.equal(state.pendingJoins, undefined);
  assert.equal(lastDoc(r).meta.retired, true);
});

test("A: after a killed join, retire whose delete fails exits nonzero and keeps the identity home and the intent", (t) => {
  const fx = fixture(t);
  killedAfterAccept(fx);
  const r = retire217(fx, { FAKE_DELETE_FAIL: "1" });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(fx.identityHome("shared"), "signing.key")), "the member key is kept");
  assert.deepEqual(fx.state().pendingJoins.map((p) => [p.label, p.team]), [["shared", SHARED]]);
  const doc = lastDoc(r);
  assert.equal(doc.meta.retired, false);
  assert.deepEqual(doc.meta.failedLeaves, ["shared"]);
  assert.match(doc.warning, /joined team shared cleanup failed/);
});

test("A: after a killed join, a start warns naming both commands, leaves teams.json unchanged and makes no aw call a plain start does not", (t) => {
  const plain = fixture(t);
  const n0 = plain.fake.calls().length;
  const baseline = launch217(plain);
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
  const plainCalls = plain.callsSince(n0).map((c) => c.args.join(" ").replaceAll(plain.home, "<home>"));

  const fx = fixture(t);
  killedAfterAccept(fx);
  const before = readFileSync(fx.stateFile, "utf8"), n = fx.fake.calls().length;
  const r = launch217(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doc = lastDoc(r);
  assert.match(doc.warning, /oats aweb join --labels shared/);
  assert.match(doc.warning, /oats aweb leave --labels shared/);
  assert.equal(readFileSync(fx.stateFile, "utf8"), before, "teams.json unchanged");
  const calls = fx.callsSince(n);
  assert.deepEqual(calls.map((c) => c.args.join(" ").replaceAll(fx.home, "<home>")), plainCalls, "the start's aw calls are a plain start's");
  assert.ok(!calls.some((c) => c.identityHome === fx.identityHome("shared")), "nothing runs as the pending identity");
});

// ------------------------------------------------- B: a kill before aw wrote anything

for (const when of ["before-accept", "empty-home"]) test(`B: a join killed before aw wrote an identity (${when}) is followed by a normal join`, (t) => {
  const fx = fixture(t);
  const killed = join217(fx, "shared", { FAKE_KILL: when });
  assert.equal(killed.signal, "SIGKILL");
  assert.equal(fx.state().pendingJoins.length, 1);
  const r = join217(fx, "shared");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fx.invites().length, 2, "the next join mints its own invite");
  assert.equal(fx.accepts().length, 2, "and accepts it");
  const state = fx.state();
  assert.deepEqual(state.joinedTeams.map((j) => [j.label, j.team]), [["shared", SHARED]]);
  assert.equal(state.pendingJoins, undefined);
});

// ------------------------------------------------- edge cases

test("a join killed after connect, before the record, is adopted by the next join without a second connect", (t) => {
  const fx = fixture(t);
  const killed = join217(fx, "shared", { FAKE_KILL: "after-connect" });
  assert.equal(killed.signal, "SIGKILL");
  const n = fx.fake.calls().length;
  const r = join217(fx, "shared");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fx.state().joinedTeams.map((j) => j.label), ["shared"]);
  assert.equal(fx.state().pendingJoins, undefined);
  assert.ok(!fx.callsSince(n).some((c) => c.args[0] === "workspace" || c.args[0] === "team" || c.args[2] === "accept-invite"), "only the membership is read");
});

test("several labels in one join, one killed: the earlier label stays recorded and the killed one is pending", (t) => {
  const fx = fixture(t);
  const killed = join217(fx, "extra,shared", { FAKE_KILL: "after-accept", FAKE_KILL_FOR: "shared" });
  assert.equal(killed.signal, "SIGKILL");
  const state = fx.state();
  assert.deepEqual(state.joinedTeams.map((j) => [j.label, j.team]), [["extra", EXTRA]]);
  assert.deepEqual(state.pendingJoins.map((p) => p.label), ["shared"]);
  const r = join217(fx, "extra,shared");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fx.state().joinedTeams.map((j) => j.label).sort(), ["extra", "shared"]);
  assert.equal(fx.invites().length, 2);
});

test("a pending identity home whose team list succeeds without the team holds no membership: the intent and the home are dropped, and the join mints", (t) => {
  const fx = fixture(t);
  killedAfterAccept(fx);
  writeFileSync(join(fx.identityHome("shared"), "teams.yaml"), "memberships: []\n");
  const r = join217(fx, "shared");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fx.invites().length, 2);
  assert.deepEqual(fx.state().joinedTeams.map((j) => j.label), ["shared"]);
  assert.equal(fx.state().pendingJoins, undefined);
});

for (const kind of ["join", "leave"]) test(`a pending join whose team list fails keeps everything and reports, on ${kind}`, (t) => {
  const fx = fixture(t);
  killedAfterAccept(fx);
  const before = readFileSync(fx.stateFile, "utf8");
  const r = fx.hook(kind, { args: ["--labels", "shared", "--json"], extra: { FAKE_LIST_FAIL: "1" } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /aw id team list/);
  assert.match(r.stderr, new RegExp(`oats aweb ${kind} --labels shared`), "the refusal names its fix");
  assert.equal(readFileSync(fx.stateFile, "utf8"), before);
  assert.ok(existsSync(join(fx.identityHome("shared"), "signing.key")));
  assert.equal(fx.invites().length, 1);
});

test("leave whose release is refused keeps the identity home and the intent", (t) => {
  const fx = fixture(t);
  killedAfterAccept(fx);
  const r = leave217(fx, "shared", { FAKE_DELETE_FAIL: "1" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(existsSync(join(fx.identityHome("shared"), "signing.key")));
  assert.deepEqual(fx.state().pendingJoins.map((p) => p.label), ["shared"]);
  assert.deepEqual(fx.state().joinedTeams, []);
});

test("retire hands a pending join refused as team_not_hosted to the controller, as for a recorded joined team", (t) => {
  const fx = fixture(t);
  killedAfterAccept(fx);
  const r = retire217(fx, { FAKE_DELETE_NOT_HOSTED: "1" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doc = lastDoc(r);
  assert.equal(doc.meta.failedLeaves, undefined);
  const [cleanup] = doc.meta.pendingControllerCleanup;
  assert.deepEqual({ label: cleanup.label, team: cleanup.team, certificateId: cleanup.certificateId }, { label: "shared", team: SHARED, certificateId: "cert-shared" });
  assert.match(cleanup.command, /aw id team remove-member --namespace example\.test --team shared --cert-id cert-shared/);
});

test("a stale intent whose label now maps to another team is released for the recorded team, never adopted into the new one", (t) => {
  const fx = fixture(t);
  killedAfterAccept(fx);
  const r = join217(fx, "shared", { OATS_TEAMS: fx.teams({ shared: MOVED }) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const deleted = fx.deletes();
  assert.equal(deleted.length, 1, "the recorded membership was released");
  const connect = fx.fake.calls().filter((c) => c.args[0] === "workspace" && c.args[1] === "connect");
  assert.ok(connect[0].args.includes(`--team=${SHARED}`), "adopted for the recorded team only");
  assert.deepEqual(fx.state().joinedTeams.map((j) => [j.label, j.team]), [["shared", MOVED]]);
  assert.equal(fx.state().pendingJoins, undefined);
});

test("a spawn killed after a joined-team accept leaves the intent, and retire of that home releases it", (t) => {
  const fx = fixture(t);
  rmSync(join(fx.home, ".aw"), { recursive: true, force: true });
  rmSync(join(fx.home, ".oats-aweb"), { recursive: true, force: true });
  const killed = fx.hook("spawn", { extra: { OATS_SETTINGS: JSON.stringify({ root: fx.ws, join: "shared" }), FAKE_KILL: "after-accept" } });
  assert.equal(killed.signal, "SIGKILL");
  assert.deepEqual(fx.state().pendingJoins.map((p) => p.label), ["shared"]);
  const r = fx.hook("retire", { extra: { OATS_META: "{}" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fx.deletes().some((c) => c.identityHome === fx.identityHome("shared")));
  assert.equal(existsSync(fx.identityHome("shared")), false);
  assert.equal(fx.state().pendingJoins, undefined);
});

test("an identity home that held an identity before the join is refused as before, never written ahead or removed", (t) => {
  const fx = fixture(t);
  write(join(fx.identityHome("shared"), "identity.yaml"), "did: did:key:zSomeoneElse\n");
  write(join(fx.identityHome("shared"), "signing.key"), "other-key\n");
  write(join(fx.identityHome("shared"), "teams.yaml"), "memberships:\n    - team_id: other:example.test\n");
  for (let i = 0; i < 2; i++) {
    const r = join217(fx, "shared");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /unfinished/);
  }
  assert.equal(readFileSync(join(fx.identityHome("shared"), "signing.key"), "utf8"), "other-key\n", "the identity is untouched");
  assert.equal(fx.state().pendingJoins, undefined);
});

// A team root recorded in the live settings after the home's spawn: the join
// mints from it, while the home's captured settings name only the default
// team's root. The release still reaches the service the join used.
const liveRootOnly = { captured: (ws) => ({ roots: { [DEFAULT]: ws } }) };
test("a killed join through a root only the live settings name is released by leave", (t) => {
  const fx = fixture(t, liveRootOnly);
  killedAfterAccept(fx);
  const r = leave217(fx, "shared");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fx.deletes().map((c) => c.identityHome), [fx.identityHome("shared")]);
  assert.equal(existsSync(fx.identityHome("shared")), false);
  assert.equal(fx.state().pendingJoins, undefined);
});
test("a killed join through a root only the live settings name is released by retire", (t) => {
  const fx = fixture(t, liveRootOnly);
  killedAfterAccept(fx);
  const r = retire217(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fx.deletes().some((c) => c.identityHome === fx.identityHome("shared")));
  assert.equal(existsSync(fx.identityHome("shared")), false);
  assert.equal(fx.state().pendingJoins, undefined);
});
