// Attach's harder cases: a did:aw whose registration fails after its chain is
// installed, the start choosing the same parent as the plan, a did:aw the
// registry already certifies, and the receipt under concurrent applies.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyPlan, attachHome, awInHome, buildPlan, homeFacts, readPendingImport, startAttach, whoIn } from "../oats-package/capabilities/oats-aweb/lib/attach.mjs";
import { homeKeyIds } from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";
import { fakeAwChain } from "./helpers/fake-aw-chain.mjs";

const HUMAN = "did:aw:human1", STEWARD = "did:aw:steward1";
const cert = (id, kind, parent) => ({ certificate: { id, kind, domain: "awtest-demo.example", parent }, signature: "s" });
const HUMAN_CERT = cert(HUMAN, "human", { kind: "namespace", id: "awtest-demo.example" });
const STEWARD_CERT = cert(STEWARD, "agent", { kind: "identity", id: HUMAN });

/** An identity home with a real key. A did:aw home's id is the stable id of
 *  that key; every home's request names its did:key as subject_key, as aw's
 *  does. `chain`: the certificates above it, to install it as their child. */
function identity(dir, { global = false, chain, who } = {}) {
  mkdirSync(join(dir, ".aw"), { recursive: true });
  const seed = Buffer.from(generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" }).d, "base64url");
  writeFileSync(join(dir, ".aw", "signing.key"), `-----BEGIN ED25519 PRIVATE KEY-----\n${seed.toString("base64")}\n-----END ED25519 PRIVATE KEY-----\n`);
  const keys = homeKeyIds(dir), id = global ? keys.stableId : keys.didKey;
  writeFileSync(join(dir, ".aw", "did"), id);
  writeFileSync(join(dir, ".aw", "did-key"), keys.didKey);
  if (chain) writeFileSync(join(dir, ".aw", "id-chain.json"), JSON.stringify({ v: 1, type: "aweb.id-chain", certificates: [...chain, cert(id, "agent", { kind: "identity", id: chain.at(-1).certificate.id })] }));
  if (who) writeFileSync(join(dir, ".aw", "fake-who.json"), JSON.stringify({ id, domain: "", human_id: null, kind: null, ...who }));
  return { dir, id, certs: chain ? [...chain, cert(id, "agent", { kind: "identity", id: chain.at(-1).certificate.id })] : null };
}
const UNREGISTERED = { outcome: "unknown", identity_valid: null, reason: "unregistered_identity" };

function deployment(t) {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-attach-review-")));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const steward = join(ws, ".aweb-stewards", "s");
  mkdirSync(join(steward, ".aw"), { recursive: true });
  writeFileSync(join(steward, ".aw", "did"), STEWARD);
  writeFileSync(join(steward, ".aw", "id-chain.json"), JSON.stringify({ v: 1, type: "aweb.id-chain", certificates: [HUMAN_CERT, STEWARD_CERT] }));
  const settings = { attribution: "human", human: { id: HUMAN, label: "Juan" }, steward: { id: STEWARD, home: steward } };
  const fake = fakeAwChain(t);
  const instance = (name, record, opts) => {
    const home = join(ws, "agents", "dev", "instances", name);
    const made = identity(home, opts);
    writeFileSync(join(home, "instance.json"), JSON.stringify({ instance: name, ...record }));
    return { ...made, home, name };
  };
  return { ws, steward, settings, fake, instance };
}
const idCalls = (fake) => fake.calls().filter((c) => c.args[0] === "id").map((c) => ({ step: c.args.slice(1, 3).join(" "), cwd: c.cwd }));

test("a did:aw whose registration fails after aw installed its chain is resumed by the next attach, never left half attached", (t) => {
  const fx = deployment(t);
  const g = fx.instance("g", { spawnedBy: null }, { global: true, who: UNREGISTERED });
  const entry = { instance: "g", home: g.home, parent: { steward: true, home: fx.steward } };
  assert.throws(() => attachHome({ entry, run: awInHome({ PATH: fx.fake.path, FAKE_REGISTER_FAIL: "1" }) }),
    (e) => e.code === "E_ATTACH_FAILED" && /installed but not registered/.test(e.message) && /aw id parent import .* --domain awtest-demo\.example/.test(e.message));
  assert.equal(existsSync(join(g.home, ".aw", "id-chain.json")), true);
  assert.ok(readPendingImport(g.home));
  const run = awInHome({ PATH: fx.fake.path });
  const plan = buildPlan({ deployment: fx.ws, settings: fx.settings, homes: [homeFacts(run, { instance: "g", home: g.home })], stewardStatus: whoIn(run, fx.steward) });
  assert.deepEqual([plan.homes[0].status, plan.homes[0].resume], ["attach", true]);
  const before = idCalls(fx.fake).length;
  attachHome({ entry: plan.homes[0], run });
  assert.deepEqual(idCalls(fx.fake).slice(before).map((c) => c.step), ["parent import"]);
  assert.equal(readPendingImport(g.home), null);
});

test("a start resumes a pending import of its own home", (t) => {
  const fx = deployment(t);
  const g = fx.instance("g", { spawnedBy: null }, { global: true, who: UNREGISTERED });
  assert.throws(() => attachHome({ entry: { instance: "g", home: g.home, parent: { steward: true, home: fx.steward } }, run: awInHome({ PATH: fx.fake.path, FAKE_REGISTER_FAIL: "1" }) }));
  const before = idCalls(fx.fake).length;
  assert.deepEqual(startAttach({ home: g.home, instance: "g", settings: fx.settings, deployment: fx.ws, local: true, env: { PATH: fx.fake.path } }), { attach: undefined, note: null });
  assert.deepEqual(idCalls(fx.fake).slice(before).map((c) => c.step), ["parent import"]);
  assert.equal(readPendingImport(g.home), null);
});

test("a start chooses the plan's parent: a did:aw under a chained did:key spawner goes to the steward", (t) => {
  const fx = deployment(t);
  const sp = fx.instance("sp", { spawnedBy: null }, { chain: [HUMAN_CERT, STEWARD_CERT] });
  const g = fx.instance("g", { spawnedBy: { instance: "sp", home: "" } }, { global: true, who: UNREGISTERED });
  writeFileSync(join(g.home, "instance.json"), JSON.stringify({ instance: "g", spawnedBy: { instance: "sp", home: sp.home } }));
  const r = startAttach({ home: g.home, instance: "g", settings: fx.settings, deployment: fx.ws, local: true, env: { PATH: fx.fake.path } });
  assert.deepEqual(r, { attach: undefined, note: null });
  assert.equal(idCalls(fx.fake).find((c) => c.step === "child invite").cwd, fx.steward);
  assert.equal(existsSync(join(g.home, ".aw", "id-chain.json")), true);
});

test("a start chooses the plan's parent: a did:aw under a did:key spawner takes its nearest did:aw ancestor", (t) => {
  const fx = deployment(t);
  const gp = fx.instance("gp", { spawnedBy: null }, { global: true, chain: [HUMAN_CERT, STEWARD_CERT] });
  const sp = fx.instance("sp", { spawnedBy: { instance: "gp", home: gp.home } }, { chain: gp.certs });
  const g = fx.instance("g", { spawnedBy: { instance: "sp", home: sp.home } }, { global: true, who: UNREGISTERED });
  const r = startAttach({ home: g.home, instance: "g", settings: fx.settings, deployment: fx.ws, local: true, env: { PATH: fx.fake.path } });
  assert.deepEqual(r, { attach: undefined, note: null });
  assert.equal(idCalls(fx.fake).find((c) => c.step === "child invite").cwd, gp.home);
});

test("a start leaves a did:aw the registry already certifies untouched", (t) => {
  const fx = deployment(t);
  const g = fx.instance("g", { spawnedBy: null }, { global: true, who: { outcome: "nearest_human", human_id: HUMAN, identity_valid: true, kind: "agent", reason: "verified" } });
  assert.deepEqual(startAttach({ home: g.home, instance: "g", settings: fx.settings, deployment: fx.ws, local: true, env: { PATH: fx.fake.path } }), { attach: undefined, note: null });
  assert.deepEqual(idCalls(fx.fake), []);
});

// The receipt under concurrent applies of one idempotency key.
const SETTINGS = { attribution: "human", human: { id: HUMAN, label: "Juan" }, steward: { id: STEWARD, home: "/d/.aweb-stewards/s" } };
const STEWARD_OK = { who: { id: STEWARD, outcome: "nearest_human", human_id: HUMAN, identity_valid: true, kind: "agent", reason: "verified" } };
const chainless = (name) => ({ instance: name, home: `/d/agents/x/instances/${name}`, record: { spawnedBy: null }, grantSeat: false, chainFile: false, who: { id: `did:key:z${name}`, outcome: "unknown", reason: "legacy_no_chain" }, keys: { didKey: `did:key:z${name}`, stableId: `did:aw:${name}` }, refusal: null });
function receipts(t) {
  const dir = mkdtempSync(join(tmpdir(), "oats-aweb-receipts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("an apply of a key that another apply is running refuses, and writes no receipt", (t) => {
  const dir = receipts(t), plan = buildPlan({ deployment: "/d", settings: SETTINGS, homes: [chainless("a")], stewardStatus: STEWARD_OK });
  writeFileSync(join(dir, "receipt.k.lock"), `${process.pid}\n`);
  const calls = [];
  assert.throws(() => applyPlan({ plan, planRevision: plan.planRevision, idempotencyKey: "k", receiptsDir: dir, attachOne: (e) => calls.push(e) }), (e) => e.code === "E_ATTACH_FAILED" && /already running/.test(e.message));
  assert.deepEqual(calls, []);
  assert.equal(existsSync(join(dir, "receipt.k.json")), false);
});

test("a committed receipt is never replaced: an apply that finds one written meanwhile returns it", (t) => {
  const dir = receipts(t), plan = buildPlan({ deployment: "/d", settings: SETTINGS, homes: [chainless("a")], stewardStatus: STEWARD_OK });
  const first = { action: "attribution-attach", status: "complete", deployment: "/d", idempotencyKey: "k", planRevision: plan.planRevision, at: "then", failed: 0, homes: [] };
  const r = applyPlan({ plan, planRevision: plan.planRevision, idempotencyKey: "k", receiptsDir: dir, attachOne: () => writeFileSync(join(dir, "receipt.k.json"), JSON.stringify(first)) });
  assert.equal(r.replayed, true);
  assert.equal(r.at, "then");
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "receipt.k.json"), "utf8")), first);
  assert.equal(existsSync(join(dir, "receipt.k.lock")), false);
});

test("a lock left by an apply that is no longer running is taken over", (t) => {
  const dir = receipts(t), plan = buildPlan({ deployment: "/d", settings: SETTINGS, homes: [chainless("a")], stewardStatus: STEWARD_OK });
  writeFileSync(join(dir, "receipt.k.lock"), "999999999\n");
  const r = applyPlan({ plan, planRevision: plan.planRevision, idempotencyKey: "k", receiptsDir: dir, attachOne: () => {} });
  assert.equal(r.homes[0].status, "attached");
});

test("a start reaches a did:aw ancestor however long the line of local parents before it", (t) => {
  const fx = deployment(t);
  const gp = fx.instance("gp", { spawnedBy: null }, { global: true, chain: [HUMAN_CERT, STEWARD_CERT] });
  let above = gp;
  for (let i = 0; i < 20; i++) above = fx.instance(`l${i}`, { spawnedBy: { instance: above.name, home: above.home } }, {});
  const g = fx.instance("g", { spawnedBy: { instance: above.name, home: above.home } }, { global: true, who: UNREGISTERED });
  const r = startAttach({ home: g.home, instance: "g", settings: fx.settings, deployment: fx.ws, local: true, env: { PATH: fx.fake.path } });
  assert.deepEqual(r, { attach: undefined, note: null });
  assert.equal(idCalls(fx.fake).find((c) => c.step === "child invite").cwd, gp.home);
});

test("a start whose parents' status can't all be read waits, warning, rather than choose another parent", (t) => {
  const fx = deployment(t);
  const gp = fx.instance("gp", { spawnedBy: null }, { global: true, chain: [HUMAN_CERT, STEWARD_CERT] });
  writeFileSync(join(gp.home, ".aw", "fake-who.json"), "not json");
  const sp = fx.instance("sp", { spawnedBy: { instance: "gp", home: gp.home } }, {});
  const g = fx.instance("g", { spawnedBy: { instance: "sp", home: sp.home } }, { global: true, who: UNREGISTERED });
  const r = startAttach({ home: g.home, instance: "g", settings: fx.settings, deployment: fx.ws, local: true, env: { PATH: fx.fake.path } });
  assert.equal(r.attach, undefined);
  assert.match(r.note, /\(E_ATTACH_FAILED\).*gp.*the next start tries again/);
  assert.deepEqual(idCalls(fx.fake), []);
});

test("a start under a refused parent warns with the parent's reason and its fix, recording nothing for the home", (t) => {
  const fx = deployment(t);
  const sp = fx.instance("sp", { spawnedBy: null }, { chain: [HUMAN_CERT, STEWARD_CERT] });
  writeFileSync(join(sp.home, ".aw", "fake-who.json"), JSON.stringify({ id: sp.id, outcome: "unknown", human_id: null, identity_valid: false, kind: null, reason: "revoked" }));
  const c = fx.instance("c", { spawnedBy: { instance: "sp", home: sp.home } }, {});
  const r = startAttach({ home: c.home, instance: "c", settings: fx.settings, deployment: fx.ws, local: true, env: { PATH: fx.fake.path } });
  assert.equal(r.attach, undefined, JSON.stringify(r));
  assert.match(r.note, /\(E_ATTACH_PARENT_REFUSED\).*revoked.*repair the parent's chain/);
  assert.equal(existsSync(join(c.home, ".oats-aweb", "attach.json")), false);
  assert.deepEqual(idCalls(fx.fake), []);
});

test("a refusal that can't be saved never stops the start: one warning says so", (t) => {
  const fx = deployment(t);
  const c = fx.instance("c", { spawnedBy: null }, {});
  writeFileSync(join(c.home, ".aw", "did-key"), "did:key:zsomeoneelse");
  writeFileSync(join(c.home, ".aw", "did"), "did:key:zsomeoneelse");
  mkdirSync(join(c.home, ".oats-aweb"), { mode: 0o500 });
  const r = startAttach({ home: c.home, instance: "c", settings: fx.settings, deployment: fx.ws, local: true, env: { PATH: fx.fake.path } });
  chmodSync(join(c.home, ".oats-aweb"), 0o700);
  assert.equal(r.attach.refused, "E_ATTACH_KEY_MISMATCH");
  assert.match(r.note, /could not be saved/);
});

test("a start under a grant-seat spawner records a lasting refusal naming the respawn, and never tries again", (t) => {
  const fx = deployment(t);
  const seat = fx.instance("seat", { spawnedBy: null, capabilityMeta: { "oats.aweb": { identity: { mode: "global", grant: { id: "g1" } } } } }, {});
  const c = fx.instance("c", { spawnedBy: { instance: "seat", home: seat.home } }, {});
  const first = startAttach({ home: c.home, instance: "c", settings: fx.settings, deployment: fx.ws, local: true, env: { PATH: fx.fake.path } });
  assert.deepEqual([first.attach?.refused, first.attach?.reason], ["E_ATTACH_PARENT_REFUSED", "grant_seat_parent"]);
  assert.match(first.note, /respawn it from an instance that holds its own key, or from a shell/);
  assert.doesNotMatch(first.note, /tries again|then the setup expert runs/);
  const calls = fx.fake.calls().length;
  const second = startAttach({ home: c.home, instance: "c", settings: fx.settings, deployment: fx.ws, local: true, env: { PATH: fx.fake.path } });
  assert.equal(second.attach.refused, "E_ATTACH_PARENT_REFUSED");
  assert.equal(fx.fake.calls().length, calls, "no aw call for a recorded refusal");
  assert.deepEqual(idCalls(fx.fake), []);
});
