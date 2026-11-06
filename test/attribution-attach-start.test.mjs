// The attach a start makes for its own home (oats#1665 C3, C4): bounded,
// never blocking the start, one warning with its reason, and a lasting
// refusal recorded and not retried until an attach apply.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { attachStateDir, readAttachRefusal, startAttach } from "../oats-package/capabilities/oats-aweb/lib/attach.mjs";
import { homeKeyIds } from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";
import { fakeAwChain, writeIdentity } from "./helpers/fake-aw-chain.mjs";
import { currentRootQuery } from "./helpers/current-root-query.mjs";
import { writeHostSettings } from "./helpers/host-settings.mjs";

/** `oats status` for a test deployment: every instance home under agents/. */
function listAll(ws) {
  return () => ({ known: true, rows: readdirSync(join(ws, "agents")).flatMap((soul) => { try { return readdirSync(join(ws, "agents", soul, "instances")).map((n) => ({ instance: n, home: join(ws, "agents", soul, "instances", n) })); } catch { return []; } }) });
}

const HUMAN = "did:aw:human1", STEWARD = "did:aw:steward1";
const HUMAN_CERT = { id: HUMAN, kind: "human", parent: { kind: "namespace", id: "awtest-demo.example" } };
const STEWARD_CERT = { id: STEWARD, kind: "agent", parent: { kind: "identity", id: HUMAN } };

function keyedHome(dir, { did } = {}) {
  mkdirSync(join(dir, ".aw"), { recursive: true });
  const seed = Buffer.from(generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" }).d, "base64url");
  writeFileSync(join(dir, ".aw", "signing.key"), `-----BEGIN ED25519 PRIVATE KEY-----\n${seed.toString("base64")}\n-----END ED25519 PRIVATE KEY-----\n`);
  writeFileSync(join(dir, ".aw", "did"), did || homeKeyIds(dir).didKey);
  return dir;
}

function fixture(t, { attribution = "human", record = { spawnedBy: null }, did, parentChained = true, host } = {}) {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-attach-start-")));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  writeFileSync(join(ws, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const stewardHome = join(ws, ".aweb-stewards", "s");
  writeIdentity(stewardHome, { did: STEWARD, chain: parentChained ? [HUMAN_CERT, STEWARD_CERT] : undefined });
  const lead = keyedHome(join(ws, "agents", "lead", "instances", "lead-1"));
  writeFileSync(join(lead, "instance.json"), JSON.stringify({ spawnedBy: null }));
  const home = keyedHome(join(ws, "agents", "dev", "instances", "dev-1"), { did });
  writeFileSync(join(home, "instance.json"), JSON.stringify(record));
  const settings = { ...(attribution ? { attribution } : {}), human: { id: HUMAN, label: "Juan" }, steward: { id: STEWARD, home: stewardHome } };
  // This host's oats-local.yaml, as the bind writes it; `host` replaces it.
  if (host === undefined) writeHostSettings(ws, settings);
  else if (typeof host === "string") writeFileSync(join(ws, "oats-local.yaml"), host);
  else if (host) writeHostSettings(ws, host);
  const fake = fakeAwChain(t);
  const start = ({ env, ...extra } = {}) => startAttach({ home, instance: "dev-1", deployment: ws, local: true, env: { PATH: fake.path, ...env }, listHomes: listAll(ws), ...extra });
  return { ws, home, lead, fake, start, stewardHome };
}
const idCalls = (fake) => fake.calls().filter((c) => c.args[0] === "id");

test("mode none or absent on this host, or no human bound on it: nothing, and no aw call", (t) => {
  for (const host of [null, { attribution: "none" }, { human: { id: HUMAN } }, { attribution: "human" }]) {
    const fx = fixture(t, { host });
    assert.equal(fx.start(), null, JSON.stringify(host));
    assert.deepEqual(fx.fake.calls(), [], JSON.stringify(host));
  }
});

test("a grant seat or a home that already has a chain: nothing to attach", (t) => {
  const fx = fixture(t);
  assert.equal(startAttach({ home: fx.home, instance: "dev-1", deployment: fx.ws, local: false, env: {} }), null);
  writeFileSync(join(fx.home, ".aw", "id-chain.json"), "{}");
  assert.deepEqual(fx.start(), { attach: undefined, note: null });
  assert.deepEqual(fx.fake.calls(), []);
});

test("a chainless home under a chained steward is attached at start, with no warning", (t) => {
  const fx = fixture(t);
  assert.deepEqual(fx.start(), { attach: undefined, note: null });
  assert.equal(existsSync(join(fx.home, ".aw", "id-chain.json")), true);
});

test("a parent without a chain yet: the start does nothing and says nothing", (t) => {
  const fx = fixture(t, { record: { spawnedBy: { instance: "lead-1", home: "" } } });
  writeFileSync(join(fx.home, "instance.json"), JSON.stringify({ spawnedBy: { instance: "lead-1", home: fx.lead } }));
  assert.deepEqual(fx.start(), { attach: undefined, note: null });
  assert.deepEqual(idCalls(fx.fake), []);
});

test("a key mismatch is a lasting refusal: recorded, warned once, and not retried at the next start", (t) => {
  const fx = fixture(t, { did: "did:key:zsomeoneelse" });
  const first = fx.start();
  assert.equal(first.attach.refused, "E_ATTACH_KEY_MISMATCH");
  assert.match(first.note, /could not be attached at start \(E_ATTACH_KEY_MISMATCH\).*not retried at start → fix that, then the setup expert runs `oats aweb attribution attach`/);
  assert.equal(readAttachRefusal(fx.home).code, "E_ATTACH_KEY_MISMATCH");
  const calls = idCalls(fx.fake).length;
  const second = fx.start();
  assert.equal(second.attach.refused, "E_ATTACH_KEY_MISMATCH");
  assert.match(second.note, /not attached \(E_ATTACH_KEY_MISMATCH\).*not retried at start/);
  assert.equal(idCalls(fx.fake).length, calls, "no aw call for a recorded refusal");
  assert.equal(existsSync(join(fx.home, ".aw", "id-chain.json")), false);
});

test("the start's attach is bounded: a slow aw ends it within the budget, with a warning, and the next start retries", (t) => {
  const fx = fixture(t);
  const began = Date.now();
  const r = fx.start({ budgetMs: 1500, env: { FAKE_SLOW_INVITE: "5" } });
  assert.ok(Date.now() - began < 3500, `took ${Date.now() - began} ms`);
  assert.equal(r.attach, undefined, JSON.stringify(r));
  assert.match(r.note, /could not be attached at start \(E_ATTACH_FAILED\).*the next start tries again/);
  assert.equal(readAttachRefusal(fx.home), null);
  assert.equal(existsSync(join(fx.home, ".aw", "id-chain.json")), false);
});

test("an exhausted budget never runs aw without a timeout (Node reads a timeout of 0 as none)", (t) => {
  const fx = fixture(t);
  const began = Date.now();
  const r = fx.start({ budgetMs: 0, env: { FAKE_SLOW_INVITE: "3" } });
  assert.ok(Date.now() - began < 1500, `took ${Date.now() - began} ms`);
  assert.match(r.note, /budget of 0 s ran out/);
  assert.deepEqual(idCalls(fx.fake), []);
});

test("the start's budget bounds its lock waits too: a busy lock gate ends it within the budget", (t) => {
  const fx = fixture(t);
  // A gate held by a running process (this one) is waited on, never taken over.
  mkdirSync(attachStateDir(fx.home), { recursive: true });
  writeFileSync(join(attachStateDir(fx.home), "attach.lock.gate"), `${process.pid} held-by-the-test\n`);
  const began = Date.now();
  const r = fx.start({ budgetMs: 4000 });
  assert.ok(Date.now() - began < 4700, `took ${Date.now() - began} ms`);
  assert.match(r.note, /could not be attached at start \(E_ATTACH_FAILED\): the lock .*attach\.lock stayed busy/);
  assert.equal(existsSync(join(fx.home, ".aw", "id-chain.json")), false);
});

// Through the hook's launch event, as the kernel starts a home.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const HOOK = fileURLToPath(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url));
/** The kernel starts the home with the settings its spawn captured: by
 *  default the bound human's, or `captured` (what a spawn before the bind
 *  saw), with `origins` as the kernel records them. */
function launch(fx, { preview = false, attribution = "human", captured, origins } = {}) {
  const settings = { root: fx.ws, ...(captured ?? { ...(attribution ? { attribution } : {}), human: { id: HUMAN, label: "Juan" }, steward: { id: STEWARD, home: join(fx.ws, ".aweb-stewards", "s") } }) };
  const meta = { team: "legacy:example.test", alias: "dev-1", delivery: "channel", runtime: "claude", identity: { mode: "local" }, defaultTeam: { label: "default", team: "legacy:example.test", from: "deployment" } };
  const rows = listAll(fx.ws)().rows;
  const kernel = currentRootQuery(fx.ws, { home: fx.home, deployment: fx.ws, settings, change: `if(args[0]==='status')doc={root:${JSON.stringify(fx.ws)},agents:[{instances:${JSON.stringify(rows)}}]};` });
  const r = spawnSync(process.execPath, [HOOK, "launch"], { cwd: fx.home, encoding: "utf8", timeout: 60000, env: {
    PATH: fx.fake.path, HOME: process.env.HOME, OATS_EVENT: "launch", OATS_HOME: fx.home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: fx.ws, OATS_TEAM_SCOPE: fx.ws, OATS_CLI_BIN: kernel.cli, OATS_RUNTIME: "claude", OATS_PREVIOUS_RUNTIME: "claude",
    OATS_SETTINGS: JSON.stringify(settings), ...(origins ? { OATS_SETTINGS_ORIGINS: JSON.stringify(origins) } : {}), OATS_META: JSON.stringify(meta), OATS_TEAMS: "[]", OATS_TEAMS_SOURCE: "live", ...(preview ? { OATS_LAUNCH_PREVIEW: "1" } : {}),
  } });
  return { status: r.status, doc: JSON.parse(r.stdout.trim().split("\n").pop() || "{}"), stderr: r.stderr };
}

test("launch: the start attaches its chainless home; its preview pass never does", (t) => {
  const fx = fixture(t);
  const preview = launch(fx, { preview: true });
  assert.equal(preview.status, 0, JSON.stringify(preview.doc) + preview.stderr);
  assert.deepEqual(idCalls(fx.fake), []);
  const real = launch(fx);
  assert.equal(real.status, 0, JSON.stringify(real.doc) + real.stderr);
  assert.equal(existsSync(join(fx.home, ".aw", "id-chain.json")), true);
  assert.equal(real.doc.meta.attach, undefined);
  assert.doesNotMatch(real.doc.warning || "", /attach/);
});

test("launch: a recorded lasting refusal is in the start's meta and its one warning, and the start goes ahead", (t) => {
  const fx = fixture(t, { did: "did:key:zsomeoneelse" });
  const r = launch(fx);
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.equal(r.doc.meta.attach.refused, "E_ATTACH_KEY_MISMATCH");
  assert.equal((r.doc.warning.match(/E_ATTACH_KEY_MISMATCH/g) || []).length, 1);
});

test("launch in mode none: no attach call and no attach in the meta", (t) => {
  const fx = fixture(t, { attribution: "none" });
  const r = launch(fx, { attribution: "none" });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.deepEqual(idCalls(fx.fake), []);
  assert.equal(Object.hasOwn(r.doc.meta, "attach"), false);
});

test("launch: the mode is this host's now, not the spawn's: workspace-committed human with nothing on this host is off", (t) => {
  const fx = fixture(t, { host: null });
  const r = launch(fx, { origins: { "/attribution": { kind: "workspace" } } });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.deepEqual(idCalls(fx.fake), []);
  assert.equal(existsSync(join(fx.home, ".aw", "id-chain.json")), false);
  assert.equal(Object.hasOwn(r.doc.meta, "attach"), false);
});

test("launch: a deployment that never opted in looks as it does today: no block on this host, no warning and no attach call", (t) => {
  for (const host of [null, "schemaVersion: 2\nworkspace: fixture\n"]) {
    const fx = fixture(t, { host });
    if (host === null) rmSync(join(fx.ws, "oats-local.yaml"));
    const r = launch(fx, { captured: {} });
    assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
    assert.doesNotMatch(r.doc.warning || "", /attribution|attach|oats-local\.yaml/, String(host));
    assert.deepEqual(idCalls(fx.fake), [], String(host));
    assert.equal(Object.hasOwn(r.doc.meta, "attach"), false);
  }
});

test("launch: a home spawned in mode human whose host has since opted out is issued nothing", (t) => {
  const fx = fixture(t, { host: { attribution: "none", human: { id: HUMAN, label: "Juan" }, steward: { id: STEWARD, home: join(tmpdir(), "unused") } } });
  const r = launch(fx);
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.deepEqual(idCalls(fx.fake), []);
  assert.equal(existsSync(join(fx.home, ".aw", "id-chain.json")), false);
});

test("launch: a home spawned before the bind attaches at its next start, by this host's bound human and steward", (t) => {
  const fx = fixture(t);
  const r = launch(fx, { captured: {} });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.equal(idCalls(fx.fake).find((c) => c.args[1] === "child" && c.args[2] === "invite")?.cwd, fx.stewardHome);
  assert.equal(existsSync(join(fx.home, ".aw", "id-chain.json")), true);
});

test("launch: an oats.aweb block in a form oats.aweb doesn't write counts as off, with one fixed warning", (t) => {
  const fx = fixture(t, { host: "schemaVersion: 2\nworkspace: fixture\nsettings:\n  oats.aweb: {attribution: human}\n" });
  const r = launch(fx);
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.deepEqual(idCalls(fx.fake), []);
  assert.equal((r.doc.warning.match(/attribution counts as off at this start/g) || []).length, 1);
  assert.match(r.doc.warning, /oats-local\.yaml's settings\.oats\.aweb is not in the block style oats\.aweb writes, so attribution counts as off at this start and nothing is attached → write it in block style/);
  assert.equal(r.doc.warning.includes(fx.ws), false, "no path");
});

test("the host read counts against the start's budget", (t) => {
  const fx = fixture(t);
  const began = Date.now();
  const r = fx.start({ budgetMs: 1500, readHost: () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1600); return { settings: { attribution: "human", human: { id: HUMAN }, steward: { id: STEWARD, home: fx.stewardHome } } }; } });
  assert.ok(Date.now() - began < 2500, `took ${Date.now() - began} ms`);
  assert.match(r.note, /budget of 1\.5 s ran out/);
  assert.deepEqual(fx.fake.calls(), []);
});

test("the steward's evidence unavailable at start is a warning for now, never a lasting refusal of the home", (t) => {
  const fx = fixture(t);
  writeFileSync(join(fx.ws, ".aweb-stewards", "s", ".aw", "fake-who.json"), JSON.stringify({ id: STEWARD, outcome: "unavailable", reason: "evidence_unavailable", identity_valid: null }));
  const r = fx.start();
  assert.equal(r.attach, undefined, JSON.stringify(r));
  assert.match(r.note, /\(E_ATTACH_FAILED\).*the next start tries again/);
  assert.equal(readAttachRefusal(fx.home), null);
  assert.deepEqual(idCalls(fx.fake), []);
});

test("launch: a refusal that can't be saved still lets the start go ahead, with one warning", (t) => {
  const fx = fixture(t, { did: "did:key:zsomeoneelse" });
  mkdirSync(join(fx.home, ".oats-aweb"), { mode: 0o500 });
  const r = launch(fx);
  chmodSync(join(fx.home, ".oats-aweb"), 0o700);
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.equal((r.doc.warning.match(/E_ATTACH_KEY_MISMATCH/g) || []).length, 1);
  assert.match(r.doc.warning, /could not be saved/);
});
