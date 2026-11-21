// Human attribution (README, "Human attribution"; aweb-acxy7.7, PR a of
// oats docs/design/2026-11-21-human-ids-contract.md): C1, the served identity's
// `attribution`; C2, check-only's `roots[]`; C3, the record of a root's last verified
// human; joined teams' `--parent` (P4); connect's inviter check; the signature-pending
// home; and that a deployment of chainless roots changes in nothing else (A9).
// Acceptance A1-A9 are named as such. A10 (the real binaries) is
// test/human-attribution-native.test.mjs and the stack journey; the kernel's retention
// of a signature-pending home is test/public-kernel-signature-pending.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { joinFromFake, membersFake } from "./helpers/fake-aw-join-from.mjs";
import { pendingMintFake } from "./helpers/fake-pending-mint.mjs";
import { fakeAwArgvCheck } from "./helpers/aw-argv.mjs";
import { didKeyOfSigningKey } from "../oats-package/capabilities/oats-aweb/lib/member-key.mjs";
import { attributionFor, lineageEntryFor, pendingMintRetention, readLineage, readWho, recordLineage, whoObservation, UNKNOWN_ATTRIBUTION } from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";

const HOOK = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const TEAM = "default:example.test";
const JOINED = "joined:example.test";
const HUMAN = "did:aw:person.example.test";
const SERVER = "builder";

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-attribution-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A signing key as aw saves it, and its did:key. */
function writeKey(identityHome) {
  const { privateKey } = generateKeyPairSync("ed25519");
  const der = privateKey.export({ format: "der", type: "pkcs8" });
  const pem = `-----BEGIN ED25519 PRIVATE KEY-----\n${Buffer.from(der.subarray(der.length - 32)).toString("base64")}\n-----END ED25519 PRIVATE KEY-----\n`;
  mkdirSync(identityHome, { recursive: true });
  writeFileSync(join(identityHome, "signing.key"), pem, { mode: 0o600 });
  return didKeyOfSigningKey(pem);
}

// aw's own answers (aw 1.36.58 who.go; chain root side first, ending with the identity).
const chainless = (id) => ({ domain: "", human_id: null, id, identity_valid: null, kind: null, outcome: "unknown", reason: "legacy_no_chain" });
const nearest = (id, chainIds) => ({ domain: "person.example.test", human_id: HUMAN, id, identity_valid: true, kind: "agent", outcome: "nearest_human", reason: "verified", chain: chainIds.map((c, i) => ({ id: c, kind: i === 0 ? "human" : "agent" })) });
const noHuman = (id) => ({ domain: "example.test", human_id: null, id, identity_valid: true, kind: "agent", outcome: "no_human", reason: "no_human_in_chain", chain: [{ id: "did:aw:example.test", kind: "namespace" }, { id, kind: "agent" }] });
const unavailable = (id) => ({ domain: "example.test", human_id: null, id, identity_valid: null, kind: null, outcome: "unavailable", reason: "evidence_unavailable" });

/** The fake aw and the fake kernel, configured through a state file a test may
 *  change between runs: `version`, `who` ({<identity home>: answer | {status, stdout}
 *  | "hang"}), `signaturePending` ("code" | "error"), `joinTeam`, `features`. */
function fakes(t, base) {
  const bin = join(base, "bin"), calls = join(base, "calls.jsonl"), kernelCalls = join(base, "kernel-calls.jsonl"), state = join(base, "state.json");
  mkdirSync(bin);
  writeFileSync(state, "{}");
  writeFileSync(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
let args = process.argv.slice(2);
${fakeAwArgvCheck("args")}
const cfg = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, "utf8"));
let identityHome = null, rest = args;
if (rest[0] === "--identity-home") { identityHome = rest[1]; rest = rest.slice(2); }
const accepting = rest.slice(0, 3).join(" ") === "id team accept-invite";
const stdin = accepting ? fs.readFileSync(0, "utf8").trim() : undefined;
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, identityHome, cwd: process.cwd(), ...(accepting ? { stdin: !!stdin } : {}) }) + "\\n");
const awDir = identityHome || path.join(process.cwd(), ".aw");
const flag = (n) => rest.find((a) => a.startsWith(n + "="))?.slice(n.length + 1) ?? (rest.includes(n) ? rest[rest.indexOf(n) + 1] : undefined);
const key = (dir) => {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const der = privateKey.export({ format: "der", type: "pkcs8" });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "signing.key"), "-----BEGIN ED25519 PRIVATE KEY-----\\n" + Buffer.from(der.subarray(der.length - 32)).toString("base64") + "\\n-----END ED25519 PRIVATE KEY-----\\n", { mode: 0o600 });
};
if (rest[0] === "version") { console.log("aw " + (cfg.version || "1.36.58")); process.exit(0); }
if (rest[0] === "who") {
  const a = (cfg.who || {})[awDir];
  if (a === "hang" || a === "hang-ignoring-term") { if (a !== "hang") process.on("SIGTERM", () => {}); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); process.exit(0); }
  if (a && a.status !== undefined) { if (a.stdout) process.stdout.write(a.stdout); process.exit(a.status); }
  console.log(JSON.stringify(a || { domain: "", human_id: null, id: "did:key:zUnlisted", identity_valid: null, kind: null, outcome: "unknown", reason: "legacy_no_chain" }, null, 2));
  process.exit(0);
}
if (rest[0] === "init" && cfg.signaturePending) {
  (${pendingMintFake})(awDir);
  const message = "native agent signature pending; its key and pending invite are retained in " + awDir;
  console.error(message);
  console.log(JSON.stringify({ error: { code: cfg.signaturePending === "code" ? "native_agent_signature_pending" : "error", message } }));
  process.exit(1);
}
(${joinFromFake})(rest);
(${membersFake})(rest);
if (rest[0] === "team" && rest[1] === "list") {
  let doc = { memberships: [] }; try { doc = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".aw", "teams.json"), "utf8")); } catch {}
  console.log(JSON.stringify(doc)); process.exit(0);
}
if (rest[0] === "team" && rest[1] === "invite" && cfg.inviteFail) { console.error("invite refused"); process.exit(5); }
if (rest[0] === "team" && rest[1] === "invite") { console.log(JSON.stringify({ token: "aw_inv_FIXTURE-TOKEN", aweb_url: "https://app.aweb.ai/api" })); process.exit(0); }
if (accepting) {
  if (!stdin) { console.error("no token on stdin"); process.exit(2); }
  if (cfg.joinPending) {
    (${pendingMintFake})(awDir);
    console.log(JSON.stringify({ error: { code: "native_agent_signature_pending", message: "native agent signature pending in " + awDir + "; child key and request retained" } }));
    process.exit(1);
  }
  const team = cfg.joinTeam || ${JSON.stringify(JOINED)};
  key(awDir);
  fs.writeFileSync(path.join(awDir, "teams.json"), JSON.stringify({ memberships: [{ team_id: team }] }));
  console.log(JSON.stringify({ team_id: team, alias: flag("--name"), aweb_url: "https://app.aweb.ai/api" })); process.exit(0);
}
if (rest.slice(0, 3).join(" ") === "id team list") { let doc = { memberships: [] }; try { doc = JSON.parse(fs.readFileSync(path.join(awDir, "teams.json"), "utf8")); } catch {} console.log(JSON.stringify(doc)); process.exit(0); }
if (rest[0] === "workspace" && rest[1] === "connect") { fs.mkdirSync(awDir, { recursive: true }); fs.writeFileSync(path.join(awDir, "workspace.yaml"), "aweb_url: " + flag("--service") + "\\nteam_id: " + flag("--team") + "\\n"); console.log(JSON.stringify({ status: "connected" })); process.exit(0); }
if (rest[0] === "wake" && rest[1] === "status") { console.log(JSON.stringify({ daemon_running: true, daemon_version_state: "reported", daemon_version: "1.36.58", instances: [] })); process.exit(0); }
if (rest[0] === "wake") { console.log("ok"); process.exit(0); }
if (rest[0] === "workspace" && rest[1] === "delete") {
  let text = ""; try { text = fs.readFileSync(path.join(awDir, "workspace.yaml"), "utf8"); } catch {}
  const own = (text.match(/workspace_id:\\s*(\\S+)/) || [])[1];
  if (!own) { console.error("Error: no workspace binding in this directory"); process.exit(1); }
  fs.rmSync(awDir, { recursive: true, force: true });
  console.log(JSON.stringify({ workspace_id: own, identity_deleted: true, alias_released: true, alias_released_reason: "released" })); process.exit(0);
}
if (cfg.grantRevoke !== undefined && rest.slice(0, 3).join(" ") === "id grant revoke") { if (cfg.grantRevoke === "fail") { console.error("revoke refused"); process.exit(1); } console.log("{}"); process.exit(0); }
console.error("unexpected fake aw " + args.join(" ")); process.exit(93);
`, { mode: 0o755 });
  // The kernel: `version --json` lists `features` (default: spawn-attribution), and the
  // capability route (`aweb setup ... --server <id>`) answers connect's host steps.
  writeFileSync(join(bin, "oats"), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(kernelCalls)}, JSON.stringify(args) + "\\n");
const cfg = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, "utf8"));
if (args[0] === "version" && cfg.kernelHang) { process.on("SIGTERM", () => {}); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); process.exit(0); }
if (args[0] === "version") { console.log(JSON.stringify({ version: "0.70.0", features: cfg.features || ["spawn-attribution"] })); process.exit(0); }
// \`oats inspect\`, as an explicit join reads the deployment's live roots (lib/team-roots.mjs).
if (args[0] === "inspect") {
  const isHome = args.includes("--home");
  console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { subject: isHome ? { kind: "instance", home: cfg.home, soul: "dev" } : { kind: "soul", soul: "dev" }, workspace: { deployment: cfg.ws }, teamsSource: "live", problems: [], layers: { messaging: { id: "oats.aweb" } }, capabilities: [{ id: "oats.aweb", layer: "messaging", settings: cfg.liveSettings, compatibility: { ok: true } }] } }));
  process.exit(0);
}
if (args[0] === "aweb" && args[1] === "setup" && args.includes("--check-only")) {
  const joined = fs.existsSync(${JSON.stringify(join(base, "host-joined"))});
  console.log(JSON.stringify({ aw: { status: "ok", version: "1.36.58" }, defaultTeam: { label: "default", team: ${JSON.stringify(TEAM)} }, member: joined, root: joined ? "/host/root" : null, roots: [] }));
  process.exit(0);
}
if (args[0] === "aweb" && args[1] === "setup" && args.includes("--join")) { fs.readFileSync(0, "utf8"); fs.writeFileSync(${JSON.stringify(join(base, "host-joined"))}, "1"); process.exit(0); }
console.error("fake kernel: unexpected " + args.join(" ")); process.exit(97);
`, { mode: 0o755 });
  const lines = (file) => existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  const set = (patch) => writeFileSync(state, JSON.stringify({ ...JSON.parse(readFileSync(state, "utf8")), ...patch }));
  return { bin, calls: () => lines(calls), kernelCalls: () => lines(kernelCalls), set, path: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin` };
}

/** A deployment `ws` with a minting root for the default team (`root`, a real key)
 *  and one for the eligible team `joined` (`joinedRoot`), and an instance home. */
function fixture(t, { join: joinLabels } = {}) {
  const base = tempDir(t), fake = fakes(t, base);
  const ws = join(base, "ws"), home = join(ws, "agents", "dev", "instances", "dev-1");
  const root = join(ws, ".aweb-roots", "default"), joinedRoot = join(ws, ".aweb-roots", "joined");
  const rootKey = writeKey(join(root, ".aw")), joinedRootKey = writeKey(join(joinedRoot, ".aw"));
  writeFileSync(join(root, ".aw", "teams.json"), JSON.stringify({ memberships: [{ team_id: TEAM }] }));
  writeFileSync(join(root, ".aw", "teams.yaml"), `active_team: ${TEAM}\nmemberships:\n    - team_id: ${TEAM}\n      alias: root\n      cert_path: team-certs/x.pem\n`);
  writeFileSync(join(root, ".aw", "workspace.yaml"), "aweb_url: https://app.aweb.ai/api\n");
  writeFileSync(join(joinedRoot, ".aw", "teams.json"), JSON.stringify({ memberships: [{ team_id: JOINED }] }));
  writeFileSync(join(ws, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  mkdirSync(home, { recursive: true });
  const settings = { root, roots: { [JOINED]: joinedRoot }, delivery: "session", ...(joinLabels ? { join: joinLabels } : {}) };
  fake.set({ home, ws, liveSettings: settings });
  const env = {
    HOME: base, PATH: fake.path, AW_NO_UPDATE_CHECK: "1",
    OATS_INSTANCE: "dev-1", OATS_HOME: home, OATS_WORKSPACE: ws, OATS_TEAM_SCOPE: ws, OATS_RUNTIME: "claude",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }, { label: "joined", team: JOINED, default: false, from: "local" }]),
    OATS_SETTINGS: JSON.stringify(settings), OATS_CLI_BIN: join(fake.bin, "oats"), OATS_NODE_BIN: process.execPath,
    FAKE_JOIN_FROM_REGISTRY: join(base, "registry.json"),
  };
  const run = (argv, { cwd = home, env: more = {} } = {}) => {
    const started = Date.now();
    const r = spawnSync(process.execPath, [HOOK, ...argv], { cwd, env: { ...env, OATS_EVENT: argv[0], ...more }, encoding: "utf8", timeout: 60000 });
    return { ...r, ms: Date.now() - started, doc: (() => { try { return JSON.parse(r.stdout.trim().split("\n").pop()); } catch { return undefined; } })() };
  };
  const rootHome = join(root, ".aw"), homeAw = join(home, ".aw");
  const launchMeta = (attribution) => ({ team: TEAM, alias: "dev-1", delivery: "session", runtime: "claude", defaultTeam: { label: "default", team: TEAM, from: "deployment" }, left: [], identity: { mode: "local", alias: "dev-1", team: TEAM, address: null, resident: null, ...(attribution === undefined ? {} : { attribution }) } });
  const launch = (attribution, more = {}) => run(["launch"], { env: { OATS_META: JSON.stringify(launchMeta(attribution)), ...more } });
  const who = (calls, identityHome) => calls.filter((c) => c.identityHome === identityHome && c.args.includes("who"));
  return { base, fake, ws, home, root, joinedRoot, rootHome, homeAw, rootKey, joinedRootKey, env, run, launch, who, settings };
}
const lineage = (fx) => JSON.parse(readFileSync(join(fx.ws, ".oats-aweb", "root-lineage.json"), "utf8"));

// ---------------------------------------------------------------------------
// The reader and the mapping, as functions.

test("aw who --json answers map to observations, and anything not an answer is no answer", () => {
  const leaf = "did:aw:person.example.test/dev-1", root = "did:aw:person.example.test/root";
  assert.deepEqual(whoObservation(JSON.stringify(nearest(leaf, [HUMAN, root, leaf]))), { outcome: "nearest_human", answered: true, id: leaf, humanId: HUMAN, parent: root, reason: "verified" });
  assert.equal(whoObservation(JSON.stringify(nearest(leaf, [HUMAN, root]))).parent, null, "a chain that doesn't end with the identity names no parent");
  assert.equal(whoObservation(JSON.stringify({ ...nearest(leaf, []), chain: undefined })).parent, null);
  assert.equal(whoObservation(JSON.stringify({ ...nearest(leaf, [HUMAN, leaf]), human_id: null })).answered, false, "nearest_human with no human is no answer");
  assert.deepEqual(whoObservation(JSON.stringify(noHuman(leaf))), { outcome: "no_human", answered: true, id: leaf, humanId: null, parent: null, reason: "no_human_in_chain" });
  assert.equal(whoObservation(JSON.stringify(chainless("did:key:zA"))).outcome, "unknown");
  assert.equal(whoObservation(JSON.stringify({ outcome: "some_new_outcome", id: "did:key:zA" })).outcome, "unknown", "an outcome aw adds reads as unknown");
  for (const text of [JSON.stringify(unavailable(leaf)), "not json", "[]", JSON.stringify({ id: leaf })]) assert.equal(whoObservation(text).answered, false, text);
  assert.equal(whoObservation(JSON.stringify(unavailable(leaf))).reason, "evidence_unavailable");
});

test("readWho reads only a home with a key, passes exactly its argv, and names how a failed read ended", (t) => {
  const dir = tempDir(t), home = join(dir, ".aw");
  assert.match(readWho(() => assert.fail("no aw for a home with no key"), home).reason, /no aw identity at/);
  writeKey(home);
  let seen;
  readWho((args, timeout) => { seen = { args, timeout }; return JSON.stringify(chainless("did:key:zA")); }, home);
  assert.deepEqual(seen, { args: ["--identity-home", home, "who", "--json"], timeout: 5000 });
  const failed = readWho(() => { throw Object.assign(new Error("x"), { outcome: "failed (exit 1)", stdout: JSON.stringify({ error: { code: "error", message: "SECRET-SHOULD-NOT-SHOW" } }) }); }, home);
  assert.deepEqual([failed.answered, failed.reason], [false, "aw who failed (exit 1), error.code error"]);
  assert.equal(readWho(() => assert.fail("not run"), home, 0).answered, false, "no time left: not run");
});

test("A1 (C1 mapping): each outcome's attribution, and what carries the previous value forward", () => {
  const previous = { mode: "human", human: { id: HUMAN, label: HUMAN }, parent: { id: "did:aw:x/root" } };
  const leaf = "did:aw:person.example.test/dev-1", root = "did:aw:person.example.test/root";
  assert.deepEqual(attributionFor(whoObservation(JSON.stringify(nearest(leaf, [HUMAN, root, leaf]))), undefined), { mode: "human", human: { id: HUMAN, label: HUMAN }, parent: { id: root } });
  assert.deepEqual(attributionFor(whoObservation(JSON.stringify(noHuman(leaf))), previous), { mode: "none", human: null, parent: null });
  assert.deepEqual(attributionFor(whoObservation(JSON.stringify(chainless("did:key:zA"))), previous), UNKNOWN_ATTRIBUTION);
  for (const text of [JSON.stringify(unavailable(leaf)), "garbage"]) {
    assert.deepEqual(attributionFor(whoObservation(text), previous), previous, "carried forward");
    assert.deepEqual(attributionFor(whoObservation(text), undefined), UNKNOWN_ATTRIBUTION, "unknown with none");
    assert.deepEqual(attributionFor(whoObservation(text), { mode: "human", human: null, parent: null }), UNKNOWN_ATTRIBUTION, "a malformed previous value is not carried");
  }
});

// ---------------------------------------------------------------------------
// C1 through the hooks.

test("A1 (C1 mapping): a start records each outcome exactly, and carries the previous value over unavailable, a non-zero exit and bad JSON", (t) => {
  const fx = fixture(t);
  writeKey(fx.homeAw);
  const previous = { mode: "human", human: { id: HUMAN, label: HUMAN }, parent: { id: "did:aw:person.example.test/root" } };
  const leaf = "did:aw:person.example.test/dev-1";
  const cases = [
    [nearest(leaf, [HUMAN, "did:aw:person.example.test/root", leaf]), undefined, previous],
    [noHuman(leaf), previous, { mode: "none", human: null, parent: null }],
    [chainless("did:key:zA"), previous, UNKNOWN_ATTRIBUTION],
    [unavailable(leaf), previous, previous],
    [unavailable(leaf), undefined, UNKNOWN_ATTRIBUTION],
    [{ status: 1, stdout: JSON.stringify({ error: { code: "error", message: "boom" } }) }, previous, previous],
    [{ status: 0, stdout: "not json" }, previous, previous],
    [{ status: 0, stdout: "not json" }, undefined, UNKNOWN_ATTRIBUTION],
  ];
  for (const [answer, recorded, expected] of cases) {
    fx.fake.set({ who: { [fx.homeAw]: answer } });
    const r = fx.launch(recorded);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.doc.meta.identity.attribution, expected, JSON.stringify(answer));
  }
  assert.equal(fx.who(fx.fake.calls(), fx.homeAw).length, cases.length, "one read per start");
});

test("A1 (C1 mapping): a spawn records the new identity's attribution after its mint, its parent being the root", (t) => {
  const fx = fixture(t);
  const leaf = "did:aw:person.example.test/dev-1", rootId = "did:aw:person.example.test/root";
  fx.fake.set({ who: { [fx.homeAw]: nearest(leaf, [HUMAN, rootId, leaf]), [fx.rootHome]: nearest(rootId, [HUMAN, rootId]) } });
  const r = fx.run(["spawn"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.doc.meta.identity.attribution, { mode: "human", human: { id: HUMAN, label: HUMAN }, parent: { id: rootId } });
  const calls = fx.fake.calls();
  const mint = calls.findIndex((c) => c.args[0] === "init"), own = calls.findIndex((c) => c.identityHome === fx.homeAw && c.args.includes("who"));
  assert.ok(mint >= 0 && own > mint, "the instance's read comes after its mint");
  assert.equal(fx.who(calls, fx.rootHome).length, 1, "the root is read once, before the mint");
  assert.ok(calls.findIndex((c) => c.identityHome === fx.rootHome) < mint);
});

test("C1 needs the kernel's spawn-attribution, read at run time: without it the identity is left as it is", (t) => {
  const fx = fixture(t);
  fx.fake.set({ features: ["served-identity"] });
  const spawned = fx.run(["spawn"]);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  assert.equal(Object.hasOwn(spawned.doc.meta.identity, "attribution"), false);
  const started = fx.launch(undefined);
  assert.equal(Object.hasOwn(started.doc.meta.identity, "attribution"), false);
  assert.equal(fx.who(fx.fake.calls(), fx.homeAw).length, 0, "no read of the instance without the feature");
  assert.ok(fx.fake.kernelCalls().every((argv) => argv.join(" ") === "version --json"), "the kernel is only asked its features");
});

test("C1 at a start skips a GLOBAL grant seat", (t) => {
  const fx = fixture(t);
  const meta = { identity: { mode: "global", alias: "dev-1", team: TEAM, grant: { id: "g1", home: join(fx.home, ".aweb-identity") } } };
  fx.run(["launch"], { env: { OATS_META: JSON.stringify(meta) } });
  assert.equal(fx.fake.calls().filter((c) => c.args.includes("who")).length, 0);
});

test("A2 (C1 preview): under OATS_LAUNCH_PREVIEW=1 no aw who runs and nothing recorded changes", (t) => {
  const fx = fixture(t);
  writeKey(fx.homeAw);
  const recorded = { mode: "human", human: { id: HUMAN, label: HUMAN }, parent: null };
  fx.fake.set({ who: { [fx.homeAw]: noHuman("did:aw:x/dev-1") } });
  const r = fx.launch(recorded, { OATS_LAUNCH_PREVIEW: "1" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.meta, undefined, "a preview answers no meta");
  assert.equal(fx.fake.calls().filter((c) => c.args.includes("who")).length, 0, "no aw who");
  assert.deepEqual(fx.fake.kernelCalls(), [], "not even the feature read");
  assert.equal(existsSync(join(fx.ws, ".oats-aweb", "root-lineage.json")), false);
});

test("A3 (C1 bound): a who that never exits is cut at 5 s, once; the start and the spawn complete", (t) => {
  const fx = fixture(t);
  writeKey(fx.homeAw);
  const previous = { mode: "none", human: null, parent: null };
  fx.fake.set({ who: { [fx.homeAw]: "hang" } });
  const started = fx.launch(previous);
  assert.equal(started.status, 0, started.stdout + started.stderr);
  assert.deepEqual(started.doc.meta.identity.attribution, previous, "carried forward");
  assert.ok(started.ms >= 4500 && started.ms < 15000, `cut at the bound (${started.ms} ms)`);
  assert.equal(fx.who(fx.fake.calls(), fx.homeAw).length, 1, "no retry");

  rmSync(fx.homeAw, { recursive: true, force: true });
  fx.fake.set({ who: { [fx.homeAw]: "hang", [fx.rootHome]: "hang" } });
  const spawned = fx.run(["spawn"]);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  assert.deepEqual(spawned.doc.meta.identity.attribution, UNKNOWN_ATTRIBUTION);
  assert.ok(spawned.ms < 25000, `two bounded reads (${spawned.ms} ms)`);
  assert.equal(fx.who(fx.fake.calls(), fx.rootHome).length, 1, "the root once, no retry");
  assert.equal(fx.who(fx.fake.calls(), fx.homeAw).length, 2, "the instance once at this spawn, no retry");
});

test("A3 (C1 bound): a kernel feature read that ignores SIGTERM is cut within the same 5 s; the start completes", (t) => {
  const fx = fixture(t);
  writeKey(fx.homeAw);
  const previous = { mode: "none", human: null, parent: null };
  fx.fake.set({ kernelHang: true });
  const started = fx.launch(previous);
  assert.equal(started.status, 0, started.stdout + started.stderr);
  assert.ok(started.ms < 9000, `bounded (${started.ms} ms)`);
  assert.deepEqual(started.doc.meta.identity.attribution, previous, "no feature answer: the recorded identity is left as it is");
  assert.equal(fx.who(fx.fake.calls(), fx.homeAw).length, 0, "no time left for who after the cut");
});

test("A3 (bound): a root's who that ignores SIGTERM is cut at 5 s in check-only and in an explicit join too", (t) => {
  const fx = fixture(t, { join: "joined" });
  fx.fake.set({ who: { [fx.rootHome]: "hang-ignoring-term", [join(fx.joinedRoot, ".aw")]: "hang-ignoring-term" } });
  const checked = checkOnly(fx);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.ok(checked.ms < 15000, `check-only: two roots, each cut at 5 s (${checked.ms} ms)`);
  assert.ok(checked.doc.roots.every((r) => r.attribution.outcome === "unavailable"));
  const joined = fx.run(["join", "--labels", "joined", "--json"]);
  assert.equal(joined.status, 0, joined.stdout + joined.stderr);
  assert.ok(joined.ms < 9000, `join: cut at 5 s (${joined.ms} ms)`);
});

test("a chainless did:key root's read at spawn is offline and fast, and adds nothing to the answer", (t) => {
  const fx = fixture(t);
  fx.fake.set({ who: { [fx.rootHome]: chainless(fx.rootKey), [fx.homeAw]: chainless("did:key:zLeaf") } });
  const r = fx.run(["spawn"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.warning, undefined, "nothing to say");
  assert.equal(existsSync(join(fx.ws, ".oats-aweb", "root-lineage.json")), false, "nothing recorded for a chainless root");
});

// ---------------------------------------------------------------------------
// C2 and C3 in check-only.

const checkOnly = (fx, more = {}) => {
  const r = fx.run(["setup", "--check-only", "--json"], { cwd: fx.ws, env: more });
  return { ...r, doc: JSON.parse(r.stdout.trim().split("\n").pop()) };
};

test("A4 (C2 shape and argv): check-only lists every roots-map entry and the shared root, read with <root>/.aw", (t) => {
  const fx = fixture(t);
  const third = join(fx.ws, ".aweb-roots", "third");
  writeKey(join(third, ".aw"));
  const settings = { ...fx.settings, roots: { [JOINED]: fx.joinedRoot, "third:example.test": third, "bad:example.test": "relative/root" } };
  const rootId = "did:aw:person.example.test/root";
  fx.fake.set({ who: { [fx.rootHome]: nearest(rootId, [HUMAN, rootId]), [join(fx.joinedRoot, ".aw")]: noHuman("did:aw:example.test/joined-root"), [join(third, ".aw")]: { status: 1, stdout: JSON.stringify({ error: { code: "error", message: "nope" } }) } } });
  const r = checkOnly(fx, { OATS_SETTINGS: JSON.stringify(settings) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(Object.keys(r.doc), ["aw", "defaultTeam", "member", "root", "roots"]);
  const needs = "spawning from this root needs aw 1.36.59 or later, and this host has aw 1.36.58: upgrade aw before spawning from it (README, \"Human attribution\")";
  assert.deepEqual(r.doc.roots, [
    { label: "joined", team: JOINED, home: fx.joinedRoot, attribution: { outcome: "no_human", humanId: null, reason: "no_human_in_chain" }, warnings: [] },
    { label: "third:example.test", team: "third:example.test", home: third, attribution: { outcome: "unavailable", humanId: null, reason: "aw who failed (exit 1), error.code error" }, warnings: [] },
    { label: "bad:example.test", team: "bad:example.test", home: "relative/root", attribution: { outcome: "unavailable", humanId: null, reason: "the configured root is not an absolute directory" }, warnings: [] },
    { label: "root", team: null, home: fx.root, attribution: { outcome: "nearest_human", humanId: HUMAN, reason: "verified" }, warnings: [needs] },
  ]);
  const reads = fx.fake.calls().filter((c) => c.args.includes("who"));
  assert.deepEqual(reads.map((c) => c.args), [join(fx.joinedRoot, ".aw"), join(third, ".aw"), fx.rootHome].map((h) => ["--identity-home", h, "who", "--json"]));
  fx.fake.set({ version: "1.36.59" });
  assert.deepEqual(checkOnly(fx, { OATS_SETTINGS: JSON.stringify(settings) }).doc.roots[3].warnings, [], "no note on aw 1.36.59");
});

test("A4 (C2): two labels mapping one team name the team id; a root named twice is read once", (t) => {
  const fx = fixture(t);
  const teams = [{ label: "default", team: TEAM, default: true, from: "local" }, { label: "joined", team: JOINED, from: "local" }, { label: "joined-too", team: JOINED, from: "local" }];
  const r = checkOnly(fx, { OATS_TEAMS: JSON.stringify(teams), OATS_SETTINGS: JSON.stringify({ ...fx.settings, roots: { [JOINED]: fx.root } }) });
  assert.deepEqual(r.doc.roots.map((e) => [e.label, e.team]), [[JOINED, JOINED], ["root", null]]);
  assert.equal(fx.who(fx.fake.calls(), fx.rootHome).length, 1);
});

test("A5 (C3): nearest_human then unknown warns, naming the root and aw's reason, at every read until a new nearest_human; unavailable keeps the record and doesn't warn", (t) => {
  const fx = fixture(t);
  const rootId = "did:aw:person.example.test/root";
  const shared = (r) => r.doc.roots.find((e) => e.label === "root");
  fx.fake.set({ who: { [fx.rootHome]: nearest(rootId, [HUMAN, rootId]) } });
  assert.deepEqual(shared(checkOnly(fx)).warnings, ["spawning from this root needs aw 1.36.59 or later, and this host has aw 1.36.58: upgrade aw before spawning from it (README, \"Human attribution\")"]);
  const [entry] = lineage(fx).roots;
  assert.deepEqual([entry.id, entry.key, entry.humanId], [rootId, fx.rootKey, HUMAN]);

  fx.fake.set({ who: { [fx.rootHome]: { ...chainless(rootId), reason: "legacy_no_chain" } } });
  for (let i = 0; i < 2; i++) {
    const [warning] = shared(checkOnly(fx)).warnings;
    assert.match(warning, /^attribution-lineage-missing — root /);
    assert.ok(warning.includes(fx.root) && warning.includes("unknown (legacy_no_chain)") && warning.includes(HUMAN), warning);
  }
  fx.fake.set({ who: { [fx.rootHome]: { ...noHuman(rootId), reason: "root_replaced" } } });
  assert.match(shared(checkOnly(fx)).warnings[0], /no_human \(root_replaced\)/);

  fx.fake.set({ who: { [fx.rootHome]: unavailable(rootId) } });
  const quiet = shared(checkOnly(fx));
  assert.deepEqual([quiet.attribution.outcome, quiet.warnings], ["unavailable", []]);
  assert.equal(lineage(fx).roots.length, 1, "kept");
  fx.fake.set({ who: { [fx.rootHome]: { status: 1 } } });
  assert.deepEqual(shared(checkOnly(fx)).warnings, [], "a failed read is unavailable too");

  fx.fake.set({ who: { [fx.rootHome]: chainless(rootId) } });
  const renamed = checkOnly(fx, { OATS_SETTINGS: JSON.stringify({ ...fx.settings, root: undefined, roots: { [TEAM]: fx.root } }) }).doc.roots.find((e) => e.team === TEAM);
  assert.equal(renamed.label, "default");
  assert.match(renamed.warnings[0], /attribution-lineage-missing/, "the record is the root's, whatever its label");

  fx.fake.set({ version: "1.36.59", who: { [fx.rootHome]: nearest(rootId, [HUMAN, rootId]) } });
  assert.deepEqual(shared(checkOnly(fx)).warnings, [], "a new nearest_human replaces it");
  fx.fake.set({ who: { [fx.rootHome]: chainless(rootId) } });
  assert.equal(shared(checkOnly(fx)).warnings.length, 1);

  writeKey(fx.rootHome);
  assert.deepEqual(shared(checkOnly(fx)).warnings, [], "a new key doesn't inherit the record");
});

test("A5 (C3): a joined root's warning is said when its join fails too", (t) => {
  const fx = fixture(t, { join: "joined" });
  const joinedHome = join(fx.joinedRoot, ".aw"), rootId = "did:aw:person.example.test/joined-root";
  fx.fake.set({ version: "1.36.59", who: { [joinedHome]: nearest(rootId, [HUMAN, rootId]) } });
  assert.equal(checkOnly(fx).status, 0);
  fx.fake.set({ who: { [joinedHome]: { ...chainless(rootId), reason: "revoked" } }, inviteFail: true });
  const r = fx.run(["spawn"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.doc.warning, /nothing was joined/);
  assert.match(r.doc.warning, /attribution-lineage-missing — root .*joined.* now reads unknown \(revoked\)/);
  const explicit = fx.run(["join", "--labels", "joined"]);
  assert.equal(explicit.status, 1);
  assert.match(explicit.stderr, /attribution-lineage-missing — root .* now reads unknown \(revoked\)/);
});

test("A5 (C3): an existing record that can't be read or is malformed is left as it is, never replaced by a partial one", (t) => {
  for (const [name, spoil] of [
    ["unreadable (a directory)", (file) => { rmSync(file); mkdirSync(file); }],
    ["malformed JSON", (file) => writeFileSync(file, "{not json")],
    ["one malformed entry", (file) => { const doc = JSON.parse(readFileSync(file, "utf8")); doc.roots.push({ id: "x" }); writeFileSync(file, JSON.stringify(doc)); }],
  ]) {
    const dep = tempDir(t), file = join(dep, ".oats-aweb", "root-lineage.json");
    const a = { id: "did:aw:person.example.test/root-a", key: "did:key:z6MkA", humanId: HUMAN, seenAt: new Date(0).toISOString() };
    assert.deepEqual(recordLineage(dep, a), {});
    spoil(file);
    const before = existsSync(file) && !statSync(file).isDirectory() ? readFileSync(file, "utf8") : null;
    const r = recordLineage(dep, { id: "did:aw:person.example.test/root-b", key: "did:key:z6MkB", humanId: HUMAN, seenAt: new Date(1).toISOString() });
    assert.match(r.cause ?? "", /left as it is/, name);
    if (before !== null) assert.equal(readFileSync(file, "utf8"), before, `${name}: untouched`);
    else assert.ok(statSync(file).isDirectory(), `${name}: untouched`);
    assert.equal(readdirSync(join(dep, ".oats-aweb")).filter((f) => f !== "root-lineage.json").length, 0, `${name}: no lock or temporary file left`);
  }
});

test("A5 (C3): with an unreadable record, check-only says the root's adoption wasn't recorded and names the file to move aside", (t) => {
  const fx = fixture(t);
  const rootId = "did:aw:person.example.test/root", file = join(fx.ws, ".oats-aweb", "root-lineage.json");
  mkdirSync(join(fx.ws, ".oats-aweb"), { recursive: true });
  writeFileSync(file, "{not json");
  fx.fake.set({ version: "1.36.59", who: { [fx.rootHome]: nearest(rootId, [HUMAN, rootId]) } });
  const r = checkOnly(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stderr.includes(`root ${fx.root}'s adoption was not recorded: the existing record ${file} is malformed, and is left as it is: move it aside to record roots again`), r.stderr);
  assert.equal(readFileSync(file, "utf8"), "{not json");
});

test("A5 (C3): no verified observation is evicted by others: 250 roots keep every record", (t) => {
  const dep = tempDir(t);
  const key = (i) => `did:key:z6Mk${String(i).padStart(40, "A")}`;
  for (let i = 0; i < 250; i++) assert.deepEqual(recordLineage(dep, { id: `did:aw:person.example.test/root-${i}`, key: key(i), humanId: HUMAN, seenAt: new Date(0).toISOString() }), {});
  const { entries } = readLineage(dep);
  assert.equal(entries.length, 250);
  assert.equal(lineageEntryFor(entries, { id: "did:aw:person.example.test/root-0", key: key(0) })?.humanId, HUMAN, "the first root's record is kept");
  assert.deepEqual(recordLineage(dep, { id: "did:aw:person.example.test/root-0", key: key(0), humanId: "did:aw:other.example.test", seenAt: new Date(1).toISOString() }), {});
  const after = readLineage(dep).entries;
  assert.equal(after.length, 250, "a new nearest_human replaces only that root's entry");
  assert.equal(lineageEntryFor(after, { id: "did:aw:person.example.test/root-0", key: key(0) }).humanId, "did:aw:other.example.test");
});

test("A5 (C3): the warning shows at every spawn from that root", (t) => {
  const fx = fixture(t);
  const rootId = "did:aw:person.example.test/root";
  fx.fake.set({ version: "1.36.59", who: { [fx.rootHome]: nearest(rootId, [HUMAN, rootId]) } });
  assert.equal(checkOnly(fx).status, 0);
  fx.fake.set({ who: { [fx.rootHome]: { ...chainless(rootId), reason: "revoked" } } });
  for (const name of ["dev-1", "dev-2"]) {
    const home = join(fx.ws, "agents", "dev", "instances", name);
    mkdirSync(home, { recursive: true });
    const r = fx.run(["spawn"], { cwd: home, env: { OATS_INSTANCE: name, OATS_HOME: home } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.doc.warning, /attribution-lineage-missing — root .* now reads unknown \(revoked\)/);
  }
});

// ---------------------------------------------------------------------------
// Joined teams (P4).

const accepts = (fx) => fx.fake.calls().filter((c) => c.args.includes("accept-invite"));
const invites = (fx) => fx.fake.calls().filter((c) => c.args[0] === "team" && c.args[1] === "invite");

test("A6 (P4): a chainless root's join passes no --parent; an adopted root's passes --parent <root>/.aw", (t) => {
  const fx = fixture(t, { join: "joined" });
  const joinedHome = join(fx.joinedRoot, ".aw");
  let r = fx.run(["spawn"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(accepts(fx).map((c) => c.args), [["--identity-home", join(fx.home, ".aweb-identity-joined"), "id", "team", "accept-invite", "--token-stdin", "--name=dev-1", "--local", "--json"]]);
  assert.equal(fx.who(fx.fake.calls(), joinedHome).length, 1, "one read of roots[T] at join time");

  const fy = fixture(t, { join: "joined" });
  const adopted = join(fy.joinedRoot, ".aw"), rootId = "did:aw:person.example.test/joined-root";
  fy.fake.set({ version: "1.36.59", who: { [adopted]: nearest(rootId, [HUMAN, rootId]) } });
  r = fy.run(["spawn"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(accepts(fy).map((c) => c.args.slice(2)), [["id", "team", "accept-invite", "--token-stdin", "--name=dev-1", "--local", `--parent=${adopted}`, "--json"]]);
  assert.equal(accepts(fy)[0].stdin, true, "the token still on stdin");
});

test("A6 (P4): an unavailable read falls back to C3's record; with none --parent is omitted", (t) => {
  const fx = fixture(t, { join: "joined" });
  const adopted = join(fx.joinedRoot, ".aw"), rootId = "did:aw:person.example.test/joined-root";
  fx.fake.set({ version: "1.36.59", who: { [adopted]: unavailable(rootId) } });
  let r = fx.run(["join", "--labels", "joined", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!accepts(fx)[0].args.some((a) => a.startsWith("--parent")), "no record: no --parent");
  r = fx.run(["leave", "--labels", "joined", "--json"]);

  const fy = fixture(t, { join: "joined" });
  const adoptedY = join(fy.joinedRoot, ".aw");
  fy.fake.set({ version: "1.36.59", who: { [adoptedY]: nearest(rootId, [HUMAN, rootId]) } });
  assert.equal(checkOnly(fy, { OATS_SETTINGS: JSON.stringify({ ...fy.settings, roots: { [JOINED]: fy.joinedRoot } }) }).status, 0, "records it");
  fy.fake.set({ who: { [adoptedY]: unavailable(rootId) } });
  r = fy.run(["join", "--labels", "joined", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(accepts(fy)[0].args.includes(`--parent=${adoptedY}`), "the record says adopted");
});

test("A6 (P4): an adopted root on aw < 1.36.59 stops before any team invite with E_ADOPTED_ROOT_AW_TOO_OLD", (t) => {
  const fx = fixture(t, { join: "joined" });
  const adopted = join(fx.joinedRoot, ".aw"), rootId = "did:aw:person.example.test/joined-root";
  fx.fake.set({ version: "1.36.58", who: { [adopted]: nearest(rootId, [HUMAN, rootId]) } });
  const joined = fx.run(["join", "--labels", "joined"]);
  assert.equal(joined.status, 1);
  assert.match(joined.stderr, /^E_ADOPTED_ROOT_AW_TOO_OLD: root .* is adopted by a person, and joining from it needs aw 1\.36\.59 or later; this host has aw 1\.36\.58: upgrade aw to 1\.36\.59/m);
  assert.deepEqual(invites(fx), [], "no invite was minted");
  assert.equal(existsSync(join(fx.home, ".aweb-identity-joined")), false);

  const spawned = fixture(t, { join: "joined" });
  spawned.fake.set({ version: "1.36.58", who: { [join(spawned.joinedRoot, ".aw")]: nearest(rootId, [HUMAN, rootId]) } });
  const r = spawned.run(["spawn"]);
  assert.equal(r.status, 1);
  assert.match(r.doc.warning, /identity minting failed: E_ADOPTED_ROOT_AW_TOO_OLD: /);
  assert.deepEqual(invites(spawned), []);
});

// ---------------------------------------------------------------------------
// Connect.

const connect = (fx, args = []) => fx.run(["connect", SERVER, "--json", ...args], { cwd: fx.ws });

test("A7 (connect): a chained inviter is refused before any invite is minted", (t) => {
  for (const answer of [(id) => nearest(id, [HUMAN, id]), noHuman]) {
    const fx = fixture(t);
    fx.fake.set({ version: "1.36.59", who: { [fx.rootHome]: answer("did:aw:person.example.test/root") } });
    const r = connect(fx);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(r.doc.ok, false);
    assert.equal(r.doc.error.code, "E_CONNECT_CHAINED_INVITER");
    const step = r.doc.error.details.steps.find((s) => s.step === "invite");
    assert.match(step.detail, /has an identity chain .*nothing was minted/);
    assert.match(step.remedy, /mint an invite from .* yourself, accept it on builder, move the files aw prints between the two hosts, then retry that accept on builder with the same invite/);
    assert.deepEqual(invites(fx), []);
    assert.equal(fx.fake.kernelCalls().filter((a) => a.includes("--join")).length, 0, "nothing routed");
  }
});

test("A7 (connect): an unavailable read with C3's record is refused; with none it proceeds with a warning", (t) => {
  const fx = fixture(t);
  const rootId = "did:aw:person.example.test/root";
  fx.fake.set({ who: { [fx.rootHome]: unavailable(rootId) } });
  let r = connect(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const step = r.doc.result.steps.find((s) => s.step === "invite");
  assert.equal(step.status, "done");
  assert.match(step.warning, /could not be read \(evidence_unavailable\), so whether it has an identity chain is unknown/);
  assert.equal(invites(fx).length, 1);

  const fy = fixture(t);
  fy.fake.set({ version: "1.36.59", who: { [fy.rootHome]: nearest(rootId, [HUMAN, rootId]) } });
  checkOnly(fy);
  fy.fake.set({ who: { [fy.rootHome]: unavailable(rootId) } });
  r = connect(fy);
  assert.equal(r.status, 1);
  assert.equal(r.doc.error.code, "E_CONNECT_CHAINED_INVITER");
  assert.match(r.doc.error.message, /has no answer from aw \(evidence_unavailable\) and was last verified to did:aw:person/);
  assert.deepEqual(invites(fy), []);
});

test("A7 (connect) and A9: a chainless inviter's connect is unchanged", (t) => {
  const fx = fixture(t);
  fx.fake.set({ who: { [fx.rootHome]: chainless(fx.rootKey) } });
  const r = connect(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.doc.result.steps, [
    { step: "aw", status: "ok", detail: "aw 1.36.58" },
    { step: "invite", status: "done" },
    { step: "join", status: "done", detail: "root /host/root" },
    { step: "readiness", status: "ok" },
  ]);
  assert.equal(invites(fx).length, 1);
});

// ---------------------------------------------------------------------------
// Signature pending.

const pendingFiles = (identityHome) => ["hosted-invite-creation.json", "pending-hosted-accept"].map((f) => join(identityHome, f));

test("A8 (signature pending): a mint aw stops with native_agent_signature_pending is kept while aw holds it; once aw settles it a plain retire clears it", (t) => {
  const fx = fixture(t);
  fx.fake.set({ version: "1.36.59", signaturePending: "code" });
  const spawned = fx.run(["spawn"]);
  assert.equal(spawned.status, 1, spawned.stdout + spawned.stderr);
  assert.match(spawned.doc.warning, /signature-pending — the mint stopped before membership \(native_agent_signature_pending\)/);
  const did = didKeyOfSigningKey(readFileSync(join(fx.homeAw, "signing.key"), "utf8"));
  assert.deepEqual(spawned.doc.meta.pendingMint.signaturePending.did, did);
  assert.equal(spawned.doc.meta.pendingMint.signaturePending.code, "native_agent_signature_pending");

  const retire = () => fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
  for (let i = 0; i < 2; i++) {
    const kept = retire();
    assert.equal(kept.status, 1, kept.stdout + kept.stderr);
    assert.deepEqual([kept.doc.meta.retired, kept.doc.meta.reason], [false, "signature-pending"]);
    assert.match(kept.doc.warning, /signature-pending — the mint of alias "dev-1" .* is waiting for an agent signature/);
    for (const f of [join(fx.homeAw, "signing.key"), ...pendingFiles(fx.homeAw)]) assert.ok(existsSync(f), `${f} kept`);
  }
  assert.equal(fx.fake.calls().filter((c) => c.args.includes("members")).length, 0, "nothing settles it while aw holds it");

  // aw settles it (its pending invite released): the retire answers what is true.
  for (const f of pendingFiles(fx.homeAw)) rmSync(f);
  const cleared = retire();
  assert.equal(cleared.status, 0, cleared.stdout + cleared.stderr);
  assert.deepEqual([cleared.doc.meta.retired, cleared.doc.meta.reason], [false, "nothing-to-delete"]);
});

test("A8 (signature pending): only that exact pending mint is held: progress on it is, another selection or request or a malformed record is kept as unknown", (t) => {
  const journal = (fx) => join(fx.homeAw, "hosted-invite-creation.json");
  const edit = (fx, change) => { const doc = JSON.parse(readFileSync(journal(fx), "utf8")); change(doc); writeFileSync(journal(fx), JSON.stringify(doc)); };
  const cases = [
    ["aw prepares the response for that request", (fx) => edit(fx, (d) => { d.request_ready = true; d.response_json = "{}"; d.accept_attempted = true; }), "signature-pending"],
    ["another invite selection", (fx) => edit(fx, (d) => { d.token_hash = "f".repeat(64); }), "mint-outcome-unknown"],
    ["another prepared request", (fx) => edit(fx, (d) => { d.id_tree.request_id = "00000000-0000-4000-8000-000000000000"; }), "mint-outcome-unknown"],
    ["another key named in the record", (fx) => edit(fx, (d) => { d.did_key = "did:key:z6MkOther"; }), "mint-outcome-unknown"],
    ["a malformed record", (fx) => writeFileSync(journal(fx), "{not json"), "mint-outcome-unknown"],
    ["the record gone, the marker kept", (fx) => rmSync(journal(fx)), "mint-outcome-unknown"],
    ["a malformed marker", (fx) => writeFileSync(join(fx.homeAw, "pending-hosted-accept"), "something else\n"), "mint-outcome-unknown"],
  ];
  for (const [name, change, reason] of cases) {
    const fx = fixture(t);
    fx.fake.set({ version: "1.36.59", signaturePending: "code" });
    const spawned = fx.run(["spawn"]);
    const { binding } = spawned.doc.meta.pendingMint.signaturePending;
    assert.match(binding.selection, /^[0-9a-f]{64}$/, name);
    assert.match(binding.request, /^[0-9a-f-]{36}$/, name);
    assert.ok(!readFileSync(join(fx.home, ".oats-aweb", "pending-mint.json"), "utf8").includes(JSON.parse(readFileSync(journal(fx), "utf8")).token_hash), "aw's token_hash is never copied");
    change(fx);
    const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
    assert.deepEqual([r.status, r.doc.meta.retired, r.doc.meta.reason], [1, false, reason], name);
    if (reason !== "signature-pending") assert.match(r.doc.warning, /aw still holds a pending mint in this home, and .*, so whether the mint of alias "dev-1" .* can be settled is unknown: this home, aw's files .* are kept/, name);
    assert.ok(existsSync(join(fx.homeAw, "signing.key")), `${name}: nothing deleted`);
    assert.equal(fx.fake.calls().filter((c) => c.args.includes("members")).length, 0, `${name}: nothing settled on a guess`);
  }
});

test("A8 (signature pending): a key that can't be read, or is gone, while aw's pending files stay is kept, never settled", (t) => {
  for (const [name, change] of [
    ["unreadable (a directory)", (fx) => { rmSync(join(fx.homeAw, "signing.key")); mkdirSync(join(fx.homeAw, "signing.key")); }],
    ["unparseable", (fx) => writeFileSync(join(fx.homeAw, "signing.key"), "not a key\n")],
    ["gone", (fx) => rmSync(join(fx.homeAw, "signing.key"))],
  ]) {
    const fx = fixture(t);
    fx.fake.set({ version: "1.36.59", signaturePending: "code" });
    const spawned = fx.run(["spawn"]);
    const original = readFileSync(join(fx.homeAw, "signing.key"), "utf8");
    change(fx);
    const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
    assert.deepEqual([r.status, r.doc.meta.retired, r.doc.meta.reason], [1, false, "mint-outcome-unknown"], name);
    assert.ok(r.doc.meta.pendingMint.signaturePending, `${name}: the record is kept`);
    assert.equal(fx.fake.calls().filter((c) => c.args.includes("members")).length, 0, `${name}: nothing settled on a guess`);
    // The key comes back as it was: held again.
    rmSync(join(fx.homeAw, "signing.key"), { recursive: true, force: true });
    writeFileSync(join(fx.homeAw, "signing.key"), original, { mode: 0o600 });
    assert.equal(fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } }).doc.meta.reason, "signature-pending", name);
  }
  const dir = tempDir(t), aw = join(dir, ".aw");
  writeKey(aw);
  writeFileSync(join(aw, "pending-hosted-accept"), "pending hosted accept\n");
  const never = () => assert.fail("a recorded signature-pending stop never asks whether its root is chainless");
  assert.deepEqual(pendingMintRetention(aw, { signaturePending: { did: null, binding: { selection: null, request: null } }, issuerChainless: never }), { keep: "mint-outcome-unknown", cause: "the key aw kept could not be read when the mint stopped" }, "a stop whose key couldn't be read is kept while aw's files stay");
  rmSync(join(aw, "pending-hosted-accept"));
  assert.deepEqual(pendingMintRetention(aw, { signaturePending: { did: null, binding: { selection: null, request: null } }, issuerChainless: never }), { settle: true }, "aw holds no pending mint: settled");
});

test("A8 (signature pending): another key is kept while aw's pending files stay, and settled once they are gone", (t) => {
  for (const [name, replace] of [
    ["another key, the same pending files", (fx) => writeKey(fx.homeAw)],
    ["another key with its own pending mint", (fx) => { for (const f of ["signing.key", "hosted-invite-creation.json", "pending-hosted-accept"]) rmSync(join(fx.homeAw, f)); spawnSync(process.execPath, ["-e", `(${pendingMintFake})(${JSON.stringify(fx.homeAw)})`]); }],
  ]) {
    const fx = fixture(t);
    fx.fake.set({ signaturePending: "code" });
    const spawned = fx.run(["spawn"]);
    const before = readFileSync(join(fx.homeAw, "signing.key"), "utf8");
    replace(fx);
    assert.notEqual(readFileSync(join(fx.homeAw, "signing.key"), "utf8"), before, `${name}: the key was replaced`);
    const kept = fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
    assert.deepEqual([kept.status, kept.doc.meta.retired, kept.doc.meta.reason], [1, false, "mint-outcome-unknown"], name);
    assert.match(kept.doc.warning, /the home holds another key while aw's pending files stay/, name);
    for (const f of ["signing.key", "hosted-invite-creation.json", "pending-hosted-accept"]) assert.ok(existsSync(join(fx.homeAw, f)), `${name}: ${f} kept`);
    assert.equal(fx.fake.calls().filter((c) => c.args.includes("members")).length, 0, `${name}: nothing settled on a guess`);
    // aw's pending files gone: another key is no longer this mint's, and retire answers what is true.
    for (const f of ["hosted-invite-creation.json", "pending-hosted-accept"]) rmSync(join(fx.homeAw, f));
    const settled = fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
    assert.notEqual(settled.doc.meta.reason, "signature-pending", name);
    assert.notEqual(settled.doc.meta.reason, "mint-outcome-unknown", name);
  }
});

test("A8 (signature pending): a provider record whose signature-pending stop can't be read back is kept, never settled as an ordinary mint", (t) => {
  for (const [name, corrupt] of [["a corrupt did", (sp) => ({ ...sp, did: "corrupt-did" })], ["the wrong type", () => "signature-pending"], ["null", () => null]]) {
    const fx = fixture(t);
    fx.fake.set({ version: "1.36.59", signaturePending: "code" });
    const spawned = fx.run(["spawn"]);
    const file = join(fx.home, ".oats-aweb", "pending-mint.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...doc, signaturePending: corrupt(doc.signaturePending) }));
    const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
    assert.deepEqual([r.status, r.doc.meta.retired, r.doc.meta.reason], [1, false, "mint-outcome-unknown"], name);
    assert.match(r.doc.warning, /the provider's record of this signature-pending mint is malformed/, name);
    for (const f of ["signing.key", "hosted-invite-creation.json", "pending-hosted-accept"]) assert.ok(existsSync(join(fx.homeAw, f)), `${name}: ${f} kept`);
    assert.equal(fx.fake.calls().filter((c) => c.args.includes("members")).length, 0, `${name}: nothing settled on a guess`);
  }
});

test("A8 (signature pending) on aw without the code: a post-key failure from a chainless root is retired as today, from a chained root kept", (t) => {
  // [name, aw, issuing root's answer, recorded as signature pending, retire's status and reason]
  for (const [name, version, root, recorded, expected] of [
    ["chainless, 1.36.58", "1.36.58", (fx) => chainless(fx.rootKey), false, [0, "nothing-to-delete"]],
    ["no_human, 1.36.58", "1.36.58", () => noHuman("did:aw:example.test/root"), true, [1, "signature-pending"]],
    ["nearest_human, 1.36.59-rc.3", "1.36.59-rc.3", () => nearest("did:aw:person.example.test/root", [HUMAN, "did:aw:person.example.test/root"]), true, [1, "signature-pending"]],
    // aw 1.36.59 has the code, so a generic error is no signature-pending stop; aw
    // still holds a pending mint from a root that isn't chainless: kept, fail closed.
    ["no_human, 1.36.59 (the code is the only signature-pending path)", "1.36.59", () => noHuman("did:aw:example.test/root"), false, [1, "mint-outcome-unknown"]],
  ]) {
    const fx = fixture(t);
    fx.fake.set({ version, signaturePending: "error", who: { [fx.rootHome]: root(fx) } });
    const spawned = fx.run(["spawn"]);
    assert.equal(spawned.status, 1, name);
    assert.equal(!!spawned.doc.meta.pendingMint.signaturePending, recorded, name);
    const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
    assert.deepEqual([r.status, r.doc.meta.reason], expected, name);
  }
});

test("retention fence: while aw holds a pending mint in the home, no other retire path settles it", (t) => {
  const kept = (r, name) => {
    assert.deepEqual([r.status, r.doc.meta.retired, r.doc.meta.reason], [1, false, "mint-outcome-unknown"], name);
  };
  const stopped = () => {
    const fx = fixture(t);
    fx.fake.set({ version: "1.36.59", signaturePending: "code" });
    return { fx, spawned: fx.run(["spawn"]) };
  };
  // A workspace binding with an alias next to aw's pending files: no self-delete.
  {
    const { fx, spawned } = stopped();
    writeFileSync(join(fx.homeAw, "workspace.yaml"), "aweb_url: https://app.aweb.ai/api\nteam_id: default:example.test\nalias: dev-1\nworkspace_id: ws-fixture\n");
    kept(fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } }), "alias in the home");
    assert.equal(fx.fake.calls().filter((c) => c.args[0] === "workspace" && c.args[1] === "delete").length, 0, "no self-delete");
    assert.ok(existsSync(join(fx.homeAw, "signing.key")));
  }
  // No record of the mint at all (journal and metadata lost).
  {
    const { fx } = stopped();
    rmSync(join(fx.home, ".oats-aweb", "pending-mint.json"));
    const r = fx.run(["retire"], { env: { OATS_META: "{}" } });
    kept(r, "no record");
    assert.match(r.doc.warning, /aw still holds a pending mint in .*, and this home has no usable record of it/);
  }
  // A completed default retire marker does not short-cut it either.
  {
    const { fx, spawned } = stopped();
    writeFileSync(join(fx.home, ".oats-aweb", "default-retire.json"), JSON.stringify({ schemaVersion: 1, kind: "default-workspace-delete", retired: true, alias: "dev-1" }));
    const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
    assert.deepEqual([r.status, r.doc.meta.reason], [1, "signature-pending"], "the marker is not a settlement");
  }
  // aw's files gone: the ordinary paths run again, unchanged.
  {
    const { fx, spawned } = stopped();
    for (const f of ["hosted-invite-creation.json", "pending-hosted-accept"]) rmSync(join(fx.homeAw, f));
    const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
    assert.deepEqual([r.status, r.doc.meta.reason], [0, "nothing-to-delete"]);
  }
});

test("retention fence, joined teams: an accept aw leaves signature pending in .aweb-identity-<label> is kept by spawn, retire, join and leave until aw settles it", (t) => {
  const fx = fixture(t, { join: "joined" });
  const joinedHome = join(fx.home, ".aweb-identity-joined");
  const awFiles = ["signing.key", "hosted-invite-creation.json", "pending-hosted-accept"];
  fx.fake.set({ version: "1.36.59", joinPending: true });
  const spawned = fx.run(["spawn"]);
  assert.equal(spawned.status, 1, spawned.stdout + spawned.stderr);
  assert.deepEqual(spawned.doc.meta.pendingJoins.map((p) => p.label), ["joined"], "the join stays recorded as unfinished");
  for (const f of awFiles) assert.ok(existsSync(join(joinedHome, f)), `${f} kept by the spawn`);
  const retire = () => fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
  const kept = retire();
  assert.notEqual(kept.status, 0, kept.stdout + kept.stderr);
  assert.match(kept.doc.warning, /signature pending: aw holds the pending mint of the join of joined/);
  assert.equal(kept.doc.meta.retired, false);
  for (const f of awFiles) assert.ok(existsSync(join(joinedHome, f)), `${f} kept by retire`);
  assert.equal(fx.fake.calls().filter((c) => c.identityHome === joinedHome && c.args.includes("delete")).length, 0, "nothing released");
  const left = fx.run(["leave", "--labels", "joined"]);
  assert.equal(left.status, 1);
  assert.match(left.stderr, /signature pending: aw holds the pending mint of the join of joined/);
  for (const f of awFiles) assert.ok(existsSync(join(joinedHome, f)), `${f} kept by leave`);
  // aw settles it (a refusal clears both files): the home holds no membership, and leave drops it.
  for (const f of ["hosted-invite-creation.json", "pending-hosted-accept"]) rmSync(join(joinedHome, f));
  const settled = fx.run(["leave", "--labels", "joined", "--json"]);
  assert.equal(settled.status, 0, settled.stdout + settled.stderr);
  assert.equal(existsSync(joinedHome), false);
});

test("retention fence, joined teams: a recorded joined team whose home holds aw's pending files releases nothing", (t) => {
  const fx = fixture(t, { join: "joined" });
  const joinedHome = join(fx.home, ".aweb-identity-joined");
  assert.equal(fx.run(["join", "--labels", "joined", "--json"]).status, 0);
  spawnSync(process.execPath, ["-e", `(${pendingMintFake})(${JSON.stringify(joinedHome + "-scratch")})`]);
  for (const f of ["hosted-invite-creation.json", "pending-hosted-accept"]) writeFileSync(join(joinedHome, f), readFileSync(join(joinedHome + "-scratch", f)));
  const left = fx.run(["leave", "--labels", "joined"]);
  assert.equal(left.status, 1, left.stdout + left.stderr);
  assert.match(left.stderr, /aw holds a pending mint in .*\.aweb-identity-joined .*so nothing was released and it is kept/);
  assert.equal(fx.fake.calls().filter((c) => c.identityHome === joinedHome && c.args.includes("delete")).length, 0);
  assert.ok(existsSync(join(joinedHome, "signing.key")));
});

test("home-level fence: a joined home aw holds is found from the directory, whatever the provider's records say", (t) => {
  for (const [name, spoil, meta] of [
    ["teams.json of the wrong type, the meta's mirror intact", (fx) => writeFileSync(join(fx.home, ".oats-aweb", "teams.json"), "[]"), (spawned) => spawned.doc.meta],
    ["no record and no mirror", (fx) => rmSync(join(fx.home, ".oats-aweb", "teams.json")), () => ({})],
  ]) {
    const fx = fixture(t, { join: "joined" });
    fx.fake.set({ version: "1.36.59", joinPending: true });
    const spawned = fx.run(["spawn"]);
    spoil(fx);
    const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify(meta(spawned)) } });
    // The mirror names it: its own leave keeps it. No record: the home-level fence does.
    assert.deepEqual([r.status, r.doc.meta.retired], [1, false], name);
    assert.match(r.doc.warning, /aw holds (a|the) pending mint (in \.aweb-identity-joined|of the join of joined)/, name);
    assert.equal(fx.fake.calls().filter((c) => c.identityHome === join(fx.home, ".aweb-identity-joined") && c.args.includes("delete")).length, 0, `${name}: nothing released from the joined home`);
    assert.ok(existsSync(join(fx.home, ".aweb-identity-joined", "hosted-invite-creation.json")), name);
  }
  // A symlink at that name is never followed: what it points at is not this home's.
  const fx = fixture(t);
  const elsewhere = join(fx.base, "elsewhere");
  spawnSync(process.execPath, ["-e", `(${pendingMintFake})(${JSON.stringify(elsewhere)})`]);
  assert.equal(fx.run(["spawn"]).status, 0);
  symlinkSync(elsewhere, join(fx.home, ".aweb-identity-linked"));
  const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify({ alias: "dev-1", team: TEAM }) } });
  assert.notEqual(r.doc.meta.reason, "mint-outcome-unknown", "a symlink is not followed");
});

test("rule (b) is bound to the mint's issuer: a root replaced by a fresh chainless key, or an intent with no issuer, is kept", (t) => {
  const fx = fixture(t);
  fx.fake.set({ version: "1.36.59", signaturePending: "error", who: { [fx.rootHome]: noHuman("did:aw:example.test/original-root") } });
  const stopped = fx.run(["spawn"]);
  assert.equal(stopped.doc.meta.pendingMint.signaturePending, undefined, "aw 1.36.59's generic error is no recorded stop");
  assert.deepEqual(stopped.doc.meta.pendingMint.issuer, { key: fx.rootKey, id: "did:aw:example.test/original-root" });
  const replacement = writeKey(fx.rootHome);
  fx.fake.set({ who: { [fx.rootHome]: chainless(replacement) } });
  const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify(stopped.doc.meta) } });
  assert.deepEqual([r.status, r.doc.meta.reason], [1, "mint-outcome-unknown"], "another root at the issuing path");
  assert.deepEqual(r.doc.meta.pendingMint.issuer, stopped.doc.meta.pendingMint.issuer, "the binding is kept for the retry");
  // An intent from an older provider, with no issuer binding: kept for the operator.
  const fy = fixture(t);
  fy.fake.set({ version: "1.36.58", signaturePending: "error", who: { [fy.rootHome]: chainless(fy.rootKey) } });
  const older = fy.run(["spawn"]);
  const file = join(fy.home, ".oats-aweb", "pending-mint.json");
  const { issuer: _issuer, ...unbound } = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify(unbound));
  const { issuer: _metaIssuer, ...unboundMeta } = older.doc.meta.pendingMint;
  const k = fy.run(["retire"], { env: { OATS_META: JSON.stringify({ ...older.doc.meta, pendingMint: unboundMeta }) } });
  assert.deepEqual([k.status, k.doc.meta.reason], [1, "mint-outcome-unknown"], "no issuer binding");
  // Its warning points to the README entry with the way out, which exists by that name.
  assert.ok(k.doc.warning.includes('clear it as README, "Human attribution", "A mint cut short under an older provider" says'), k.doc.warning);
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes("- **A mint cut short under an older provider.**"));
  assert.doesNotMatch(r.doc.warning, /older provider/, "a bound issuer's keep points elsewhere");
  // The README's way out on a chainless root: aw's two files moved aside, then a plain retire settles it.
  const aside = `${fy.home}.aw-pending-aside`;
  mkdirSync(aside);
  for (const f of ["hosted-invite-creation.json", "pending-hosted-accept"]) renameSync(join(fy.home, ".aw", f), join(aside, f));
  const cleared = fy.run(["retire"], { env: { OATS_META: JSON.stringify({ ...older.doc.meta, pendingMint: unboundMeta }) } });
  assert.deepEqual([cleared.status, cleared.doc.meta.reason], [0, "nothing-to-delete"], cleared.stdout + cleared.stderr);
  assert.ok(existsSync(join(aside, "hosted-invite-creation.json")), "moved aside, never deleted");
});

test("retire choke point: no answer lets the kernel delete a home where aw holds a pending file, whichever branch gives it", (t) => {
  const pendingIn = (dir) => spawnSync(process.execPath, ["-e", `(${pendingMintFake})(${JSON.stringify(dir)})`]);
  // A joined home holding only a key and aw's marker (an interrupted hosted accept), no record of it.
  const fx = fixture(t);
  const primary = fx.run(["spawn"]);
  assert.equal(primary.status, 0);
  const joined = join(fx.home, ".aweb-identity-joined");
  writeKey(joined);
  writeFileSync(join(joined, "pending-hosted-accept"), "pending hosted accept\n");
  const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify(primary.doc.meta) } });
  assert.deepEqual([r.status, r.doc.meta.retired, r.doc.meta.reason], [1, false, "mint-outcome-unknown"], r.stdout + r.stderr);
  assert.match(r.doc.warning, /aw holds a pending mint in \.aweb-identity-joined of /);
  assert.ok(existsSync(join(joined, "pending-hosted-accept")) && existsSync(join(joined, "signing.key")));
  // A retained seat's branch, by a record of the wrong type or the boolean itself.
  for (const retained of ["false", true]) {
    const fy = fixture(t);
    fy.fake.set({ version: "1.36.59", signaturePending: "code" });
    const stopped = fy.run(["spawn"]);
    assert.equal(stopped.status, 1);
    const k = fy.run(["retire"], { env: { OATS_META: JSON.stringify({ ...stopped.doc.meta, retained }) } });
    assert.deepEqual([k.status, k.doc.meta.retired], [1, false], `retained ${JSON.stringify(retained)}: ${k.stdout}${k.stderr}`);
    for (const f of ["signing.key", "hosted-invite-creation.json", "pending-hosted-accept"]) assert.ok(existsSync(join(fy.home, ".aw", f)), `retained ${JSON.stringify(retained)}: ${f} kept`);
  }
  // Rule (b) settles <home>/.aw alone: a held joined home keeps the home all the same.
  const fz = fixture(t);
  fz.fake.set({ version: "1.36.58", signaturePending: "error", who: { [fz.rootHome]: chainless(fz.rootKey) } });
  const spawned = fz.run(["spawn"]);
  pendingIn(join(fz.home, ".aweb-identity-other"));
  const z = fz.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
  assert.deepEqual([z.status, z.doc.meta.retired, z.doc.meta.reason], [1, false, "mint-outcome-unknown"], z.stdout + z.stderr);
  assert.match(z.doc.warning, /\.aweb-identity-other/);
  rmSync(join(fz.home, ".aweb-identity-other"), { recursive: true });
  const settled = fz.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
  assert.deepEqual([settled.status, settled.doc.meta.reason], [0, "nothing-to-delete"], "rule (b) alone settles, as #240");
});

test("retire's deletes: a global retire never removes a numeric joined home where aw holds a pending mint", (t) => {
  // A joined label of digits names its home like a grant home (.aweb-identity-<digits>).
  for (const [name, revoke, seatRecord] of [["a grant in the meta, revoked", "ok", false], ["a grant in the meta, its revoke refused", "fail", false], ["a surviving seat record", "ok", true]]) {
    const fx = fixture(t);
    const pendingHome = join(fx.home, ".aweb-identity-123");
    spawnSync(process.execPath, ["-e", `(${pendingMintFake})(${JSON.stringify(pendingHome)})`]);
    writeFileSync(join(fx.rootHome, "identity.yaml"), `did: ${fx.rootKey}\n`);
    fx.fake.set({ grantRevoke: revoke });
    const pendingJoins = [{ label: "123", team: JOINED, identityHome: pendingHome, alias: "dev-1", root: fx.joinedRoot }];
    if (seatRecord) {
      mkdirSync(join(fx.home, ".oats-aweb"), { recursive: true });
      writeFileSync(join(fx.home, ".oats-aweb", "seat.json"), JSON.stringify({ seat: "0123456789abcdef", instance: "dev-1", resident: "fixture", team: TEAM }));
    }
    const meta = { alias: "dev-1", team: TEAM, pendingJoins, ...(seatRecord ? {} : { identity: { mode: "global", team: TEAM, resident: "fixture", grant: { id: "g1" } } }) };
    const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify(meta), OATS_SETTINGS: JSON.stringify({ ...fx.settings, residents: { fixture: fx.root } }) } });
    assert.notEqual(r.status, 0, `${name}: ${r.stdout}${r.stderr}`);
    assert.equal(r.doc.meta.retired, false, name);
    for (const f of ["signing.key", "hosted-invite-creation.json", "pending-hosted-accept"]) assert.ok(existsSync(join(pendingHome, f)), `${name}: ${f} kept`);
  }
  // With nothing pending, a numeric grant home is still removed (the global path as before).
  const fx = fixture(t);
  const grantHome = join(fx.home, ".aweb-identity-1");
  writeKey(grantHome);
  writeFileSync(join(fx.rootHome, "identity.yaml"), `did: ${fx.rootKey}\n`);
  fx.fake.set({ grantRevoke: "ok" });
  const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify({ identity: { mode: "global", team: TEAM, resident: "fixture", grant: { id: "g1" } } }), OATS_SETTINGS: JSON.stringify({ ...fx.settings, residents: { fixture: fx.root } }) } });
  assert.equal(existsSync(grantHome), false, r.stdout + r.stderr);
});

test("retention invariant: an unreadable C3 record never shows a root chainless", (t) => {
  const fx = fixture(t);
  fx.fake.set({ version: "1.36.58", signaturePending: "error", who: { [fx.rootHome]: chainless(fx.rootKey) } });
  const spawned = fx.run(["spawn"]);
  assert.equal(spawned.doc.meta.pendingMint.signaturePending, undefined, "an ordinary mint intent");
  mkdirSync(join(fx.ws, ".oats-aweb"), { recursive: true });
  writeFileSync(join(fx.ws, ".oats-aweb", "root-lineage.json"), "{not json");
  const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
  assert.deepEqual([r.status, r.doc.meta.reason], [1, "mint-outcome-unknown"], "the record could not be read: not shown chainless");
  assert.equal(fx.fake.calls().filter((c) => c.args.includes("members")).length, 0);
  rmSync(join(fx.ws, ".oats-aweb", "root-lineage.json"));
  const settled = fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
  assert.deepEqual([settled.status, settled.doc.meta.reason], [0, "nothing-to-delete"], "a store that isn't there yet is read: chainless, settled (#240)");
});

test("absent means no directory entry: a dangling symlink at a record retire reasons about is a problem, never \"none\"", (t) => {
  // C3's record: the reader reports it, the writer leaves it, and rule (b) isn't shown.
  const dep = tempDir(t), file = join(dep, ".oats-aweb", "root-lineage.json");
  mkdirSync(dirname(file), { recursive: true });
  symlinkSync(join(dep, "nowhere.json"), file);
  assert.ok(readLineage(dep).problem, "the reader names a problem");
  const w = recordLineage(dep, { id: "did:aw:person.example.test/root-a", key: "did:key:z6MkA", humanId: HUMAN, seenAt: new Date(0).toISOString() });
  assert.match(w.cause ?? "", /left as it is: move it aside/);
  assert.ok(lstatSync(file).isSymbolicLink() && readlinkSync(file) === join(dep, "nowhere.json"), "the symlink is untouched");
  const fx = fixture(t);
  fx.fake.set({ version: "1.36.58", signaturePending: "error", who: { [fx.rootHome]: chainless(fx.rootKey) } });
  const spawned = fx.run(["spawn"]);
  mkdirSync(join(fx.ws, ".oats-aweb"), { recursive: true });
  symlinkSync(join(fx.base, "nowhere.json"), join(fx.ws, ".oats-aweb", "root-lineage.json"));
  const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
  assert.deepEqual([r.status, r.doc.meta.reason], [1, "mint-outcome-unknown"], "not shown chainless");
  assert.ok(existsSync(join(fx.home, ".aw", "hosted-invite-creation.json")));
  // The provider's own record of an interrupted mint: a dangling one is unusable, not absent.
  const fy = fixture(t);
  mkdirSync(join(fy.home, ".oats-aweb"), { recursive: true });
  symlinkSync(join(fy.base, "nowhere.json"), join(fy.home, ".oats-aweb", "pending-mint.json"));
  const k = fy.run(["retire"], { env: { OATS_META: "{}" } });
  assert.deepEqual([k.status, k.doc.meta.reason], [1, "mint-outcome-unknown"], k.stdout + k.stderr);
});

test("one inventory: the legacy grant home and a recorded identity home of any name are kept while aw holds a pending mint there", (t) => {
  for (const revoke of ["ok", "fail"]) {
    const fx = fixture(t);
    const bare = join(fx.home, ".aweb-identity");
    spawnSync(process.execPath, ["-e", `(${pendingMintFake})(${JSON.stringify(bare)})`]);
    writeFileSync(join(fx.rootHome, "identity.yaml"), `did: ${fx.rootKey}\n`);
    fx.fake.set({ grantRevoke: revoke });
    const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify({ identity: { mode: "global", team: TEAM, resident: "fixture", grant: { id: "g1" } } }), OATS_SETTINGS: JSON.stringify({ ...fx.settings, residents: { fixture: fx.root } }) } });
    assert.deepEqual([r.status, r.doc.meta.retired], [1, false], `revoke ${revoke}: ${r.stdout}${r.stderr}`);
    for (const f of ["signing.key", "hosted-invite-creation.json", "pending-hosted-accept"]) assert.ok(existsSync(join(bare, f)), `revoke ${revoke}: ${f} kept`);
  }
  const fx = fixture(t);
  assert.equal(fx.run(["spawn"]).status, 0);
  const custom = join(fx.home, "custom-identity");
  spawnSync(process.execPath, ["-e", `(${pendingMintFake})(${JSON.stringify(custom)})`]);
  // The provider's teams state is the record (it outranks the meta's mirror).
  const pendingJoins = [{ label: "custom", team: JOINED, identityHome: custom, alias: "dev-1", root: fx.joinedRoot, at: new Date(0).toISOString() }];
  const state = join(fx.home, ".oats-aweb", "teams.json");
  writeFileSync(state, JSON.stringify({ ...JSON.parse(readFileSync(state, "utf8")), pendingJoins }));
  const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify({ alias: "dev-1", team: TEAM }) } });
  assert.deepEqual([r.status, r.doc.meta.retired], [1, false], r.stdout + r.stderr);
  assert.ok(existsSync(join(custom, "hosted-invite-creation.json")) && existsSync(join(custom, "signing.key")));
});

test("the choke point's inventory is what is in the home at exit: any top-level directory, an in-home symlink target, every recorded locator", (t) => {
  const pendingIn = (dir) => spawnSync(process.execPath, ["-e", `(${pendingMintFake})(${JSON.stringify(dir)})`]);
  const global = (fx, grant = {}) => ({ identity: { mode: "global", team: TEAM, resident: "fixture", grant: { id: "g1", ...grant } } });
  const globalSettings = (fx) => JSON.stringify({ ...fx.settings, residents: { fixture: fx.root } });
  const kept = (r, files, name) => {
    assert.deepEqual([r.status, r.doc?.meta?.retired], [1, false], `${name}: ${r.stdout}${r.stderr}`);
    for (const f of files) assert.ok(existsSync(f), `${name}: ${f} kept`);
  };
  // A global seat's recorded grant home, of any name.
  {
    const fx = fixture(t);
    const grantHome = join(fx.home, "custom-grant-home");
    pendingIn(grantHome);
    writeFileSync(join(fx.rootHome, "identity.yaml"), `did: ${fx.rootKey}\n`);
    fx.fake.set({ grantRevoke: "ok" });
    kept(fx.run(["retire"], { env: { OATS_META: JSON.stringify(global(fx, { home: grantHome })), OATS_SETTINGS: globalSettings(fx) } }), [join(grantHome, "pending-hosted-accept")], "grant.home");
  }
  // The missing-aw exit, before retire reads anything: a custom home teams.json records.
  {
    const fx = fixture(t);
    assert.equal(fx.run(["spawn"]).status, 0);
    const custom = join(fx.home, "custom-joined-home", "nested");
    pendingIn(custom);
    const state = join(fx.home, ".oats-aweb", "teams.json");
    writeFileSync(state, JSON.stringify({ ...JSON.parse(readFileSync(state, "utf8")), pendingJoins: [{ label: "custom", team: JOINED, identityHome: custom, alias: "dev-1", root: fx.joinedRoot }] }));
    kept(fx.run(["retire"], { env: { OATS_META: "{}", PATH: "/no-aw-here" } }), [join(custom, "pending-hosted-accept")], "missing aw");
  }
  // <home>/.aw a symlink to a directory inside the home.
  {
    const fx = fixture(t);
    const relocated = join(fx.home, "relocated-aw");
    pendingIn(relocated);
    rmSync(join(fx.home, ".aw"), { recursive: true, force: true });
    symlinkSync("relocated-aw", join(fx.home, ".aw"));
    kept(fx.run(["retire"], { env: { OATS_META: JSON.stringify({ retained: true }) } }), [join(relocated, "pending-hosted-accept")], "in-home symlink");
  }
  // A top-level directory of any name that no record names.
  {
    const fx = fixture(t);
    assert.equal(fx.run(["spawn"]).status, 0);
    const other = join(fx.home, "anything");
    pendingIn(other);
    kept(fx.run(["retire"], { env: { OATS_META: JSON.stringify({ alias: "dev-1", team: TEAM }) } }), [join(other, "pending-hosted-accept")], "any top-level name");
  }
});

test("retention invariant: with aw's pending files in the home, retire settles only a mint with no recorded stop from a genuinely chainless root", (t) => {
  // [the issuing root's answer, settled?]
  for (const [name, root, settles] of [
    ["chainless (unknown / legacy_no_chain)", (fx) => chainless(fx.rootKey), true],
    ["unknown for another reason", (fx) => ({ ...chainless(fx.rootKey), reason: "revoked" }), false],
    ["no_human", () => noHuman("did:aw:example.test/root"), false],
    ["nearest_human", () => nearest("did:aw:person.example.test/root", [HUMAN, "did:aw:person.example.test/root"]), false],
    ["unavailable", () => unavailable("did:aw:example.test/root"), false],
    ["a failed read", () => ({ status: 1 }), false],
  ]) {
    const fx = fixture(t);
    fx.fake.set({ version: "1.36.58", signaturePending: "error", who: { [fx.rootHome]: chainless(fx.rootKey) } });
    const spawned = fx.run(["spawn"]);
    assert.equal(spawned.doc.meta.pendingMint.signaturePending, undefined, `${name}: no stop recorded`);
    fx.fake.set({ who: { [fx.rootHome]: root(fx) } });
    const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
    if (settles) assert.deepEqual([r.status, r.doc.meta.reason], [0, "nothing-to-delete"], name);
    else {
      assert.deepEqual([r.status, r.doc.meta.retired, r.doc.meta.reason], [1, false, "mint-outcome-unknown"], name);
      assert.match(r.doc.warning, /its issuing root isn't shown to be that same root, genuinely chainless/, name);
      assert.equal(fx.fake.calls().filter((c) => c.args.includes("members")).length, 0, `${name}: nothing settled on a guess`);
    }
  }
  // A chainless root with a C3 record (adopted once) isn't genuinely chainless.
  const fx = fixture(t);
  const rootId = "did:aw:person.example.test/root";
  fx.fake.set({ version: "1.36.59", who: { [fx.rootHome]: nearest(rootId, [HUMAN, rootId]) } });
  checkOnly(fx);
  fx.fake.set({ version: "1.36.58", signaturePending: "error", who: { [fx.rootHome]: unavailable(rootId) } });
  const spawned = fx.run(["spawn"]);
  assert.ok(spawned.doc.meta.pendingMint.signaturePending, "chained by C3's record: recorded as signature pending");
  fx.fake.set({ who: { [fx.rootHome]: { ...chainless(rootId), id: rootId } } });
  const pm = { ...spawned.doc.meta, pendingMint: { ...spawned.doc.meta.pendingMint } };
  delete pm.pendingMint.signaturePending;
  rmSync(join(fx.home, ".oats-aweb", "pending-mint.json"), { force: true });
  const r = fx.run(["retire"], { env: { OATS_META: JSON.stringify(pm) } });
  assert.deepEqual([r.status, r.doc.meta.reason], [1, "mint-outcome-unknown"], "a recorded root reading legacy_no_chain is not shown chainless");
});

test("A8 (signature pending) on aw without the code: an unavailable root read falls back to C3's record", (t) => {
  const fx = fixture(t);
  const rootId = "did:aw:person.example.test/root";
  fx.fake.set({ version: "1.36.59", who: { [fx.rootHome]: nearest(rootId, [HUMAN, rootId]) } });
  checkOnly(fx);
  fx.fake.set({ version: "1.36.58", signaturePending: "error", who: { [fx.rootHome]: unavailable(rootId) } });
  const spawned = fx.run(["spawn"]);
  assert.equal(spawned.doc.meta.pendingMint.signaturePending.code, null);
});

// ---------------------------------------------------------------------------
// A9: chainless roots change in nothing else.

test("A9 (opt-in, chainless roots): spawn, start, join and check-only are unchanged apart from attribution unknown and roots[]", (t) => {
  const run = (features) => {
    const fx = fixture(t, { join: "joined" });
    fx.fake.set({ features, who: { [fx.rootHome]: chainless(fx.rootKey), [join(fx.joinedRoot, ".aw")]: chainless(fx.joinedRootKey) } });
    const spawned = fx.run(["spawn"]);
    assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
    const started = fx.run(["launch"], { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
    const checked = checkOnly(fx);
    const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === "since" || k === "at" ? undefined : v)).split(fx.base).join("<base>"));
    return { fx, spawned: strip(spawned.doc), started: strip(started.doc), checked: checked.doc, accepts: accepts(fx).map((c) => c.args.slice(2)) };
  };
  const without = run(["served-identity"]), withIt = run(["spawn-attribution"]);
  const add = (doc) => ({ ...doc, meta: { ...doc.meta, identity: { ...doc.meta.identity, attribution: UNKNOWN_ATTRIBUTION } } });
  assert.deepEqual(withIt.spawned, add(without.spawned));
  assert.deepEqual(withIt.started, add(without.started));
  assert.deepEqual(withIt.accepts, without.accepts, "the join's argv is the same, without --parent");
  const { roots, ...rest } = withIt.checked;
  assert.deepEqual(Object.keys(rest), ["aw", "defaultTeam", "member", "root"]);
  assert.ok(roots.every((e) => e.attribution.outcome === "unknown" && e.warnings.length === 0), JSON.stringify(roots));
  assert.equal(withIt.spawned.warning, undefined);
  assert.equal(existsSync(join(withIt.fx.ws, ".oats-aweb", "root-lineage.json")), false);
});
