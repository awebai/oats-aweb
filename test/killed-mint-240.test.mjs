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
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createPrivateKey, sign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { joinFromFake, membersFake } from "./helpers/fake-aw-join-from.mjs";
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
  // A retire that runs while this process serves a loopback discovery answer.
  const retireAsync = (meta, more = {}) => new Promise((done) => {
    const c = spawn(process.execPath, [HOOK, "retire"], { cwd: home, env: { ...env, OATS_EVENT: "retire", OATS_META: JSON.stringify(meta), ...more } });
    let stdout = "", stderr = "";
    c.stdout.on("data", (d) => { stdout += d; }); c.stderr.on("data", (d) => { stderr += d; });
    c.on("close", (status) => done({ status, stdout, stderr, doc: (() => { try { return JSON.parse(stdout); } catch { return undefined; } })() }));
  });
  return { fake, ws, home, env, hook, retire, retireAsync, intentFile, recordFile, members, setMembers };
}

/** The failed spawn's answer for a mint cut where `mode` says. */
function killedSpawn(fx, mode) {
  const r = fx.hook("spawn", { ...KILLED, ...mode });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  return r;
}
const pendingMintOf = (r) => { const { team, alias } = r.doc.meta.pendingMint; return { team, alias }; };

// ------------------------------------------------- acceptance (#240 spec, 1-5)

test("1. a mint registered before any local file: the spawn names team and alias, and retire names the controller command but records nothing", (t) => {
  const fx = fixture(t);
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_REGISTER_FIRST: "1" });
  assert.deepEqual(pendingMintOf(r), { team: TEAM, alias: "dev-1" });
  assert.equal(existsSync(join(fx.home, ".aw", "signing.key")), false, "the key is absent");
  assert.equal(fx.members().some((m) => m.alias === "dev-1"), true, "the alias holds a certificate");

  const retired = fx.retire(r.doc.meta);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.match(retired.doc.warning, /was not released/);
  assert.match(retired.doc.warning, /ownership could not be established/);
  assert.match(retired.doc.warning, /may belong to another instance of that name/);
  assert.ok(retired.doc.warning.includes(COMMAND), retired.doc.warning);
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
    assert.doesNotMatch(retired.doc.warning, /ownership could not be established/);
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
  assert.ok(retired.doc.warning.includes("aw id team remove-member --namespace example.test --team default --cert-id cert-dev-1 --json (the root records no registry and no service for the team, so the command omits --registry and aw uses its default, as the root does)"), retired.doc.warning);
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

/** A loopback aweb service whose discovery answers `reply(req, res)`; closed after the test. */
async function discoveryService(t, reply) {
  const seen = [];
  const server = createServer((req, res) => { seen.push(req.url); reply(req, res); });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  t.after(() => new Promise((ok) => server.close(ok)));
  return { url: `http://127.0.0.1:${server.address().port}`, seen };
}
const serviceOnlyRoot = (fx, service) => writeFileSync(join(fx.ws, ".aw", "teams.yaml"), rootTeams([{ team_id: "other:example.test", registry_url: "https://other-registry.example.test" }, { team_id: TEAM, aweb_url: service }]));
const membersCalls = (fx) => fx.fake.readCalls().filter((c) => c.args.slice(0, 3).join(" ") === "id team members");

test("a root that records only the team's service: the members read, the command and the record take the registry its discovery names", async (t) => {
  const fx = fixture(t);
  const discovered = "http://127.0.0.1:9";
  const service = await discoveryService(t, (req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ aweb_url: "http://127.0.0.1", registry_url: discovered })); });
  serviceOnlyRoot(fx, service.url);
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "register" });
  const retired = await fx.retireAsync(r.doc.meta);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.deepEqual(service.seen, ["/api/v1/discovery"]);
  assert.ok(membersCalls(fx).every((c) => c.args.includes(`--registry=${discovered}`)), JSON.stringify(membersCalls(fx)));
  assert.ok(retired.doc.warning.includes(`aw id team remove-member --namespace example.test --team default --cert-id cert-dev-1 --registry ${discovered} --json`), retired.doc.warning);
  assert.doesNotMatch(retired.doc.warning, /omits --registry/);
  assert.equal(JSON.parse(readFileSync(fx.recordFile, "utf8")).entries[0].registry, discovered);
});

test("a root that records only the team's service, whose discovery fails: the outcome is unknown and the home is kept", async (t) => {
  const fx = fixture(t);
  const service = await discoveryService(t, (req, res) => { res.statusCode = 503; res.end("down"); });
  serviceOnlyRoot(fx, service.url);
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "register" });
  const retired = await fx.retireAsync(r.doc.meta);
  assert.equal(retired.status, 1, retired.stdout + retired.stderr);
  assert.equal(retired.doc.meta.reason, "mint-outcome-unknown");
  assert.ok(retired.doc.warning.includes(`${service.url}/api/v1/discovery`), retired.doc.warning);
  assert.match(retired.doc.warning, /HTTP 503/);
  assert.equal(existsSync(fx.intentFile), true);
  assert.equal(existsSync(fx.recordFile), false);
});

test("a discovery that redirects is not followed: the outcome is unknown", async (t) => {
  const fx = fixture(t);
  const service = await discoveryService(t, (req, res) => { res.statusCode = 302; res.setHeader("location", "http://127.0.0.1:9/api/v1/discovery"); res.end(); });
  serviceOnlyRoot(fx, service.url);
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "register" });
  const retired = await fx.retireAsync(r.doc.meta);
  assert.equal(retired.status, 1, retired.stdout + retired.stderr);
  assert.equal(retired.doc.meta.reason, "mint-outcome-unknown");
  assert.match(retired.doc.warning, /redirect/);
  assert.deepEqual(service.seen, ["/api/v1/discovery"]);
});

test("a discovery whose registry is not a plain origin: the outcome is unknown, and nothing reads or names it", async (t) => {
  const fx = fixture(t);
  const service = await discoveryService(t, (req, res) => { res.end(JSON.stringify({ registry_url: "https://registry.example.test/x; rm -rf ~" })); });
  serviceOnlyRoot(fx, service.url);
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "register" });
  const retired = await fx.retireAsync(r.doc.meta);
  assert.equal(retired.status, 1, retired.stdout + retired.stderr);
  assert.equal(retired.doc.meta.reason, "mint-outcome-unknown");
  assert.doesNotMatch(retired.doc.warning, /rm -rf/);
  assert.equal(membersCalls(fx).length, 0);
});

test("a discovery that names no registry: the read and the command use aw's default, and the warning says so", async (t) => {
  const fx = fixture(t);
  const service = await discoveryService(t, (req, res) => { res.end(JSON.stringify({ aweb_url: "http://127.0.0.1" })); });
  serviceOnlyRoot(fx, service.url);
  const r = killedSpawn(fx, { FAKE_JOIN_FROM_STOP_AFTER: "register" });
  const retired = await fx.retireAsync(r.doc.meta);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.ok(membersCalls(fx).every((c) => !c.args.some((a) => a.startsWith("--registry"))), JSON.stringify(membersCalls(fx)));
  assert.ok(retired.doc.warning.includes(`--cert-id cert-dev-1 --json (the team's service names no registry in its discovery (${service.url}/api/v1/discovery), so the command omits --registry and aw uses its default)`), retired.doc.warning);
});
