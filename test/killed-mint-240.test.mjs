// awebai/oats-aweb#240: a non-retained spawn's mint (`aw init --join-from`) killed
// or failed after the service registered the identity leaves a record retire finds.
// Spawn writes the intended mint to the home's .oats-aweb/pending-mint.json before
// the mint and drops it once the mint is in its answer's meta (or confirmed refused);
// a failed mint answers `pendingMint`. Retire with an intent and no bound identity
// reads the team's members from the root the spawn minted from.
//
// aw 1.36.58 writes signing.key BEFORE the registration and team-certs/ and
// workspace.yaml after it (test/helpers/fake-aw-join-from.mjs), so the realistic
// killed mint leaves a key and no binding; the "registers before writing anything"
// mode covers an aw whose order differs.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { joinFromFake, membersFake } from "./helpers/fake-aw-join-from.mjs";
import { canonicalAwPath } from "./helpers/canonical-aw.mjs";
import { didKeyOfSigningKey } from "../oats-package/capabilities/oats-aweb/lib/member-key.mjs";
import { verifySignature } from "../oats-package/capabilities/oats-aweb/lib/status-document.mjs";

const HOOK = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const TEAM = "default:example.test";
const REGISTRY = "https://registry.example.test";
const COMMAND = `aw id team remove-member --namespace example.test --team default --cert-id cert-dev-1 --registry ${REGISTRY} --json`;
const MEMBERS_READ = `\`aw id team members --team-id=${TEAM} --json\``;
// A mint the hook's own timeout cuts, as a kill at that step.
const KILLED = { OATS_AWEB_JOIN_TIMEOUT_MS: "1500" };

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-240-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const rootTeams = (rows) => `active_team: ${TEAM}\nmemberships:\n${rows.map((r) => `    - team_id: ${r.team_id}\n      alias: root\n      cert_path: team-certs/${r.team_id.replace(/:/g, "__")}.pem\n${r.registry_url ? `      registry_url: ${r.registry_url}\n` : ""}${r.aweb_url ? `      aweb_url: ${r.aweb_url}\n` : ""}`).join("")}`;

function fakeAw(t) {
  const base = tempDir(t), bin = join(base, "bin"), calls = join(base, "calls.jsonl");
  mkdirSync(bin);
  writeFileSync(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");
if (args[0] === "version") { console.log("aw 1.36.58\\n  commit: abc"); process.exit(0); }
(${joinFromFake})(args);
(${membersFake})(args);
if (args[0] === "wake" && args[1] === "status") { console.log(JSON.stringify({ daemon_running: true, daemon_version_state: "reported", daemon_version: "1.36.58", instances: [] })); process.exit(0); }
if (args[0] === "wake") { console.log("ok"); process.exit(0); }
if (args[0] === "workspace" && args[1] === "delete") {
  let text = ""; try { text = fs.readFileSync(path.join(process.cwd(), ".aw", "workspace.yaml"), "utf8"); } catch {}
  const own = (text.match(/workspace_id:\\s*(\\S+)/) || [])[1];
  if (!own) { console.error("Error: no workspace binding in this directory"); process.exit(1); }
  fs.rmSync(path.join(process.cwd(), ".aw"), { recursive: true, force: true });
  console.log(JSON.stringify({ workspace_id: own, identity_deleted: true, alias_released: true, alias_released_reason: "released" }));
  process.exit(0);
}
console.error("unexpected fake aw " + args.join(" ")); process.exit(93);
`);
  chmodSync(join(bin, "aw"), 0o755);
  const readCalls = () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  return { base, path: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, readCalls };
}

function fixture(t) {
  const fake = fakeAw(t), ws = join(fake.base, "ws"), home = join(ws, "agents", "dev", "instances", "dev-1");
  const registry = join(fake.base, "registry.json");
  mkdirSync(join(ws, ".aw"), { recursive: true });
  // aw's layout (awconfig/team_state.go): each membership records its own registry; a root may hold several teams.
  writeFileSync(join(ws, ".aw", "teams.yaml"), rootTeams([{ team_id: "other:example.test", registry_url: "https://other-registry.example.test" }, { team_id: TEAM, registry_url: REGISTRY }]));
  writeFileSync(join(ws, "oats-local.yaml"), "settings: {}\n");
  mkdirSync(home, { recursive: true });
  const env = {
    HOME: fake.base, PATH: fake.path,
    OATS_INSTANCE: "dev-1", OATS_HOME: home, OATS_WORKSPACE: ws, OATS_RUNTIME: "claude",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]),
    OATS_SETTINGS: JSON.stringify({ root: ws, delivery: "session" }),
    FAKE_JOIN_FROM_REGISTRY: registry,
  };
  const hook = (event, more = {}) => {
    const r = spawnSync(process.execPath, [HOOK, event], { cwd: home, env: { ...env, OATS_EVENT: event, ...more }, encoding: "utf8", timeout: 60000 });
    return { ...r, doc: (() => { try { return JSON.parse(r.stdout); } catch { return undefined; } })() };
  };
  const intentFile = join(home, ".oats-aweb", "pending-mint.json");
  const recordFile = join(ws, ".oats-aweb", "retired-certificates.json");
  const members = () => { try { return JSON.parse(readFileSync(registry, "utf8"))[TEAM] || []; } catch { return []; } };
  const setMembers = (list) => writeFileSync(registry, JSON.stringify({ [TEAM]: list }));
  const retire = (meta, more = {}) => hook("retire", { OATS_META: JSON.stringify(meta), ...more });
  return { fake, ws, home, env, hook, retire, intentFile, recordFile, members, setMembers };
}

/** The failed spawn's answer for a mint cut where `mode` says. */
function killedSpawn(fx, mode) {
  const r = fx.hook("spawn", { ...KILLED, ...mode });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  return r;
}
const pendingMintOf = (r) => { const { team, alias } = r.doc.meta.pendingMint; return { team, alias }; };

// ------------------------------------------------- acceptance (#240 spec, 1-5)

test("1. a mint registered before any local file: the spawn names team and alias, and retire names no command, points to the roster and the members read, and records nothing", (t) => {
  const fx = fixture(t);
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_REGISTER_FIRST: "1" });
  assert.deepEqual(pendingMintOf(r), { team: TEAM, alias: "dev-1" });
  assert.equal(existsSync(join(fx.home, ".aw", "signing.key")), false, "the key is absent");
  assert.equal(fx.members().some((m) => m.alias === "dev-1"), true, "the alias holds a certificate");

  const retired = fx.retire(r.doc.meta);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.match(retired.doc.warning, /was not released/);
  assert.match(retired.doc.warning, /most likely another instance's \(aw writes the key before it registers\)/);
  assert.ok(retired.doc.warning.includes(`check it with \`oats aweb roster\` and ${MEMBERS_READ}`), retired.doc.warning);
  assert.doesNotMatch(retired.doc.warning, /remove-member/, "no command for a certificate this home can't show is its own");
  assert.equal(existsSync(fx.recordFile), false, "no retired-certificates entry without established ownership");
  assert.equal(retired.doc.meta.pendingControllerCleanup, undefined);
});

test("2. a mint registered before any local file, and a members read that fails: retire says the outcome is unknown and names the read", (t) => {
  const fx = fixture(t);
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_REGISTER_FIRST: "1" });
  const retired = fx.retire(r.doc.meta, { FAKE_MEMBERS_FAIL: "1" });
  assert.equal(retired.status, 1, retired.stdout + retired.stderr);
  assert.match(retired.doc.warning, /is unknown/);
  assert.ok(retired.doc.warning.includes(MEMBERS_READ), retired.doc.warning);
  assert.doesNotMatch(retired.doc.warning, /released|nothing was registered/);
  assert.equal(existsSync(fx.intentFile), true, "the intent is kept for the retry");
  assert.deepEqual({ team: retired.doc.meta.pendingMint.team, alias: retired.doc.meta.pendingMint.alias }, { team: TEAM, alias: "dev-1" });
});

test("3. a mint killed before the registration, with no local file: retire drops the intent and says nothing was registered", (t) => {
  const fx = fixture(t);
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_REGISTER_FIRST: "1" });
  fx.setMembers([]);
  const retired = fx.retire(r.doc.meta);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.match(retired.doc.warning, /nothing was registered/);
  assert.equal(existsSync(fx.intentFile), false);
  assert.equal(existsSync(fx.recordFile), false);
});

test("4. a mint that succeeds leaves no intent record behind", (t) => {
  const fx = fixture(t);
  const r = fx.hook("spawn");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.meta.pendingMint, undefined);
  assert.equal(existsSync(fx.intentFile), false);
});

test("5. a mint that wrote all its local files, and a hook killed before it answered: retire self-deletes with the key as today", (t) => {
  const fx = fixture(t);
  killedSpawn(fx, { FAKE_JOIN_FROM_HANG: "1" });
  // The answer was lost: the kernel's retire has no meta.
  const retired = fx.retire({});
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(retired.doc.meta.retired, true);
  assert.equal(retired.doc.meta.aliasReusable, true);
  assert.equal(fx.fake.readCalls().filter((c) => c.args[0] === "workspace" && c.args[1] === "delete").length, 1);
  assert.equal(fx.fake.readCalls().some((c) => c.args.slice(0, 3).join(" ") === "id team members"), false, "a bound identity needs no members read");
});

// --------------------------------------------- aw 1.36.58's real order

for (const step of ["register", "cert"]) {
  test(`a mint killed after the ${step === "register" ? "registration" : "certificate was written"}: retire records the home key's certificate with the controller command`, (t) => {
    const fx = fixture(t);
    const r = killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: step });
    assert.deepEqual(pendingMintOf(r), { team: TEAM, alias: "dev-1" });
    assert.equal(existsSync(join(fx.home, ".aw", "signing.key")), true);
    const retired = fx.retire(r.doc.meta);
    assert.equal(retired.status, 0, retired.stdout + retired.stderr);
    assert.match(retired.doc.warning, /registered alias "dev-1" in team default:example\.test \(certificate cert-dev-1\) but could not be released/);
    assert.ok(retired.doc.warning.includes(COMMAND), retired.doc.warning);
    assert.doesNotMatch(retired.doc.warning, /most likely another instance's/);
    const record = JSON.parse(readFileSync(fx.recordFile, "utf8"));
    assert.deepEqual(record.entries.map((e) => ({ team: e.team, certificateId: e.certificateId, alias: e.alias, command: e.command })), [{ team: TEAM, certificateId: "cert-dev-1", alias: "dev-1", command: COMMAND }]);
    assert.deepEqual(retired.doc.meta.pendingControllerCleanup, [{ label: "default", team: TEAM, alias: "dev-1", certificateId: "cert-dev-1", command: COMMAND }]);
    assert.equal(fx.fake.readCalls().some((c) => c.args[0] === "workspace" && c.args[1] === "connect"), false, "retire never finishes a half-done mint");
  });
}

test("a mint killed after the key, before the registration: retire finds no certificate for the key and drops the intent", (t) => {
  const fx = fixture(t);
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "key" });
  const retired = fx.retire(r.doc.meta);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.match(retired.doc.warning, /nothing was registered/);
  assert.equal(existsSync(fx.intentFile), false);
  assert.equal(existsSync(fx.recordFile), false);
});

test("an alias whose certificate is another key's is not this mint's: nothing recorded, nothing claimed", (t) => {
  const fx = fixture(t);
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "key" });
  fx.setMembers([{ certificate_id: "cert-other", team_id: TEAM, alias: "dev-1", member_did_key: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", identity_scope: "local" }]);
  const retired = fx.retire(r.doc.meta);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.match(retired.doc.warning, /another key/);
  assert.match(retired.doc.warning, /nothing was registered/);
  assert.doesNotMatch(retired.doc.warning, /remove-member/);
  assert.equal(existsSync(fx.recordFile), false);
});

test("a hook killed before it answered: retire finds the intent on disk", (t) => {
  const fx = fixture(t);
  killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "register" });
  assert.equal(existsSync(fx.intentFile), true, "written before the mint");
  const intent = JSON.parse(readFileSync(fx.intentFile, "utf8"));
  assert.deepEqual({ team: intent.team, alias: intent.alias, root: intent.root }, { team: TEAM, alias: "dev-1", root: fx.ws });
  assert.ok(!Number.isNaN(Date.parse(intent.at)));
  const retired = fx.retire({});
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.ok(retired.doc.warning.includes(COMMAND), retired.doc.warning);
});

test("an unknown outcome keeps the home, and the retry settles it once the read answers", (t) => {
  const fx = fixture(t);
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "register" });
  const first = fx.retire(r.doc.meta, { FAKE_MEMBERS_FAIL: "1" });
  assert.equal(first.status, 1, first.stdout + first.stderr);
  assert.equal(first.doc.meta.retired, false);
  assert.ok(first.doc.warning.includes(MEMBERS_READ), first.doc.warning);
  assert.equal(existsSync(join(fx.home, ".aw", "signing.key")), true);
  const retry = fx.retire(first.doc.meta);
  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  assert.ok(retry.doc.warning.includes(COMMAND), retry.doc.warning);
});

test("the controller command takes the registry the root records for that team's membership", (t) => {
  const fx = fixture(t);
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "register" });
  const retired = fx.retire(r.doc.meta);
  assert.ok(retired.doc.warning.includes(`--registry ${REGISTRY} --json`), retired.doc.warning);
  assert.doesNotMatch(retired.doc.warning, /other-registry|omits --registry/);
  assert.equal(JSON.parse(readFileSync(fx.recordFile, "utf8")).entries[0].registry, REGISTRY);
});

test("a root that records no registry and no service for the team: the command omits --registry and says so", (t) => {
  const fx = fixture(t);
  writeFileSync(join(fx.ws, ".aw", "teams.yaml"), rootTeams([{ team_id: "other:example.test", registry_url: "https://other-registry.example.test" }, { team_id: TEAM }]));
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "register" });
  const retired = fx.retire(r.doc.meta);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.ok(retired.doc.warning.includes("aw id team remove-member --namespace example.test --team default --cert-id cert-dev-1 --json (the team's registry is not recorded here (the root records no registry and no service for the team); the command omits --registry)"), retired.doc.warning);
});

test("a failure after the registration whose text only looks like an alias refusal keeps the intent for retire", (t) => {
  const fx = fixture(t);
  const r = fx.hook("spawn", { FAKE_JOIN_FROM_FAIL_AFTER_REGISTER: "write /var/cache/conflict-1/cert: no space left on device" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(pendingMintOf(r), { team: TEAM, alias: "dev-1" });
  assert.match(r.doc.warning, /did not confirm by its code, so whether it registered an identity is unknown/);
  assert.equal(existsSync(fx.intentFile), true);
  const retired = fx.retire(r.doc.meta);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.ok(retired.doc.warning.includes(COMMAND), retired.doc.warning);
});

test("a retire killed before it recorded or answered the handoff leaves the intent, and its retry hands the certificate over", (t) => {
  const fx = fixture(t);
  killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "register" });
  // SIGKILL as the retire starts to write the retired-certificates record: no record, no answer.
  const preload = join(fx.fake.base, "kill-at-record.mjs");
  writeFileSync(preload, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const open = fs.openSync;
fs.openSync = function (p, ...args) {
  if (String(p).endsWith("retired-certificates.json.lock")) process.kill(process.pid, "SIGKILL");
  return open.call(this, p, ...args);
};
syncBuiltinESMExports();
`);
  const killed = fx.hook("retire", { OATS_META: "{}", NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` });
  assert.equal(killed.signal, "SIGKILL", killed.stdout + killed.stderr);
  assert.equal(killed.stdout, "", "no answer");
  assert.equal(existsSync(fx.recordFile), false);
  assert.equal(existsSync(fx.intentFile), true, "the intent outlives a retire that did not hand the certificate over");
  const retry = fx.retire({});
  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  assert.ok(retry.doc.warning.includes(COMMAND), retry.doc.warning);
  assert.equal(JSON.parse(readFileSync(fx.recordFile, "utf8")).entries.length, 1);
});

// --------------------------------------------- spawn's refusals

test("a refused mint drops its intent and answers no meta", (t) => {
  for (const refusal of [{ FAKE_JOIN_FROM_NOT_MEMBER: "1" }, { FAKE_JOIN_FROM_CONFLICT: "1" }, { FAKE_JOIN_FROM_PREVIEW: "1" }, { FAKE_JOIN_FROM_SELF_CUSTODY: "1" }]) {
    const fx = fixture(t);
    const r = fx.hook("spawn", refusal);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(r.doc.meta, undefined, JSON.stringify(refusal));
    assert.equal(existsSync(fx.intentFile), false, JSON.stringify(refusal));
  }
});

test("a home that already holds identity material gets no intent: aw refuses it before anything", (t) => {
  const fx = fixture(t);
  mkdirSync(join(fx.home, ".aw"));
  writeFileSync(join(fx.home, ".aw", "identity.yaml"), "alias: stray\n");
  const r = fx.hook("spawn");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.doc.meta, undefined);
  assert.equal(existsSync(fx.intentFile), false);
});

test("a later spawn of the name meets the alias refusal, pointing to the roster for the certificate a retire recorded", (t) => {
  const fx = fixture(t);
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "register" });
  assert.equal(fx.retire(r.doc.meta).status, 0);
  rmSync(fx.home, { recursive: true, force: true });
  mkdirSync(fx.home, { recursive: true });
  const again = fx.hook("spawn");
  assert.equal(again.status, 1, again.stdout + again.stderr);
  assert.match(again.doc.warning, /^oats-aweb: alias "dev-1" already holds a certificate on this team/);
  assert.ok(again.doc.warning.includes("; this host's record names a certificate a retire left for that alias and team: see `oats aweb roster`, which shows the team controller's command to remove it only after checking the member's presence"), again.doc.warning);
  assert.equal(again.doc.warning.includes("remove-member"), false, again.doc.warning);
});

test("the alias refusal with no record for that alias and team is unchanged", (t) => {
  const fx = fixture(t);
  fx.setMembers([{ certificate_id: "cert-other", team_id: TEAM, alias: "dev-1", member_did_key: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", identity_scope: "local" }]);
  const r = fx.hook("spawn");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.doc.warning, `oats-aweb: alias "dev-1" already holds a certificate on this team, so no identity could be minted: another machine's instance has that name, or a retired one still holds it; spawn with a different --name. Team: ${TEAM}`);
});

// --------------------------------------------- the home key's did:key

test("didKeyOfSigningKey is the did:key that verifies the key's signatures", () => {
  // RFC 8032, section 7.1, test 1: its seed, as aw saves a signing key (the seed in a PEM block).
  const seed = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
  const pem = `-----BEGIN ED25519 PRIVATE KEY-----\n${seed.toString("base64")}\n-----END ED25519 PRIVATE KEY-----\n`;
  const did = didKeyOfSigningKey(pem);
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  const bytes = Buffer.from("oats-aweb#240");
  assert.equal(verifySignature(bytes, sign(null, bytes, key).toString("base64").replace(/=+$/, ""), did), true);
  assert.equal(didKeyOfSigningKey("not a key"), undefined);
});

const serviceOnlyRoot = (fx, service) => writeFileSync(join(fx.ws, ".aw", "teams.yaml"), rootTeams([{ team_id: "other:example.test", registry_url: "https://other-registry.example.test" }, { team_id: TEAM, aweb_url: service }]));
const membersCalls = (fx) => fx.fake.readCalls().filter((c) => c.args.slice(0, 3).join(" ") === "id team members");

test("a team id configured in mixed case still finds this mint's certificate, and the root's registry, as aw spells them", (t) => {
  const fx = fixture(t);
  const configured = "Default:Example.Test";
  // aw canonicalizes a team id before it registers or reads (awid/team_id.go): the fake
  // lowercases the team flags, so the registry and the members output use aw's spelling.
  const fakeBin = join(fx.fake.base, "bin", "aw");
  const initLine = `(${joinFromFake})(args);`;
  writeFileSync(fakeBin, readFileSync(fakeBin, "utf8").replace(initLine, `for (let i = 0; i < args.length; i++) if (args[i].startsWith("--join-team=") || args[i].startsWith("--team-id=")) args[i] = args[i].toLowerCase();\n${initLine}`));
  const teams = { OATS_DEFAULT_TEAM_ID: configured, OATS_TEAMS: JSON.stringify([{ label: "default", team: configured, default: true, from: "local" }]) };
  const r = fx.hook("spawn", { ...KILLED, ...teams, FAKE_JOIN_FROM_STOP_AFTER: "register" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(fx.members().length, 1);
  const retired = fx.retire(r.doc.meta, teams);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.doesNotMatch(retired.doc.warning, /nothing was registered/);
  assert.ok(retired.doc.warning.includes(`--cert-id cert-dev-1 --registry ${REGISTRY} --json`), retired.doc.warning);
  const entries = JSON.parse(readFileSync(fx.recordFile, "utf8")).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].registry, REGISTRY);
});

const NO_REGISTRY_COMMAND = "aw id team remove-member --namespace example.test --team default --cert-id cert-dev-1 --json";

test("a root that records only the team's service: the members read passes no --registry, so aw discovers it, and the command and the record say it is not recorded", (t) => {
  const fx = fixture(t);
  serviceOnlyRoot(fx, "https://aweb.example.test");
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "register" });
  const retired = fx.retire(r.doc.meta);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.ok(membersCalls(fx).length > 0 && membersCalls(fx).every((c) => !c.args.some((a) => a.startsWith("--registry"))), JSON.stringify(membersCalls(fx)));
  assert.ok(retired.doc.warning.includes(`${NO_REGISTRY_COMMAND} (the team's registry is not recorded here; aw discovers it from https://aweb.example.test: the controller adds --registry <that registry> if it is not aw's default)`), retired.doc.warning);
  const entries = JSON.parse(readFileSync(fx.recordFile, "utf8")).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].registry, null);
  assert.equal(entries[0].command, NO_REGISTRY_COMMAND);
});

test("a recorded service that is not a plain service URL is not printed", (t) => {
  const fx = fixture(t);
  serviceOnlyRoot(fx, "https://aweb.example.test/x?token=abc");
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "register" });
  const retired = fx.retire(r.doc.meta);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.ok(retired.doc.warning.includes("aw discovers it from the root's service: the controller adds --registry <that registry> if it is not aw's default"), retired.doc.warning);
  assert.doesNotMatch(retired.doc.warning, /token=abc/);
});

test("a recorded registry that is not a plain origin is not passed or printed: aw reads its own", (t) => {
  const fx = fixture(t);
  writeFileSync(join(fx.ws, ".aw", "teams.yaml"), rootTeams([{ team_id: TEAM, registry_url: "https://registry.example.test/path" }]));
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "register" });
  const retired = fx.retire(r.doc.meta);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.ok(membersCalls(fx).every((c) => !c.args.some((a) => a.startsWith("--registry"))), JSON.stringify(membersCalls(fx)));
  assert.ok(retired.doc.warning.includes("is not a plain origin, so the command omits --registry: the controller adds --registry with the registry_url of the team's membership there"), retired.doc.warning);
  assert.doesNotMatch(retired.doc.warning, /registry\.example\.test\/path/);
});

// awebai/oats-aweb#252: aw spells a team id canonically; a deployment may not.
test("a mint of a team configured in mixed case, which aw answers in its own spelling, gives no team-mismatch warning", (t) => {
  const fx = fixture(t), configured = "Default:Example.Test";
  const env = { OATS_DEFAULT_TEAM_ID: configured, OATS_TEAMS: JSON.stringify([{ label: "default", team: configured, default: true, from: "local" }]), PATH: canonicalAwPath(fx.fake.base, fx.env.PATH) };
  const r = fx.hook("spawn", env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.doc.warning || "", /team mismatch/);
  assert.doesNotMatch(r.doc.brief, /\[WARNING: joined/);
});

test("retire's self-delete finds the workspace id when the meta spells the team otherwise than aw", (t) => {
  const fx = fixture(t), configured = "Default:Example.Test";
  const r = fx.hook("spawn");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const workspaceId = (readFileSync(join(fx.home, ".aw", "workspace.yaml"), "utf8").match(/workspace_id:\s*(\S+)/) || [])[1];
  assert.match(workspaceId, /^[0-9a-f]{8}-[0-9a-f]{4}-/i, "the fixture's binding records a workspace id");
  const retired = fx.retire({ ...r.doc.meta, team: configured });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  const del = fx.fake.readCalls().find((c) => c.args[0] === "workspace" && c.args[1] === "delete");
  assert.equal(del.args[2], workspaceId, "deleted by workspace id, not by alias");
});
