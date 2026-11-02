// The attach plan and its apply (oats#1665 §3 slice 2, C2): which homes
// attach and under whom, the plan revision, the idempotency key, and how a
// failed home stops its descendants. The facts about each home are given
// directly; the command is tested through the hook.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyPlan, buildPlan } from "../oats-package/capabilities/oats-aweb/lib/attach.mjs";

const D = "/d";
const SETTINGS = { attribution: "human", human: { id: "did:aw:human1", label: "Juan" }, steward: { id: "did:aw:steward1", home: "/d/.aweb-stewards/s" } };
const STEWARD_OK = { who: { id: "did:aw:steward1", outcome: "nearest_human", human_id: "did:aw:human1", identity_valid: true, kind: "agent", reason: "verified" } };
const home = (instance) => `/d/agents/x/instances/${instance}`;
const spawnedBy = (instance) => ({ spawnedBy: instance ? { instance, home: home(instance) } : null });
const legacy = (instance) => ({ id: `did:key:z${instance}`, outcome: "unknown", human_id: null, identity_valid: null, kind: null, reason: "legacy_no_chain" });
const verified = (id) => ({ id, outcome: "nearest_human", human_id: "did:aw:human1", identity_valid: true, kind: "agent", reason: "verified" });
/** A chainless local home whose key matches its identity. */
const chainless = (instance, record) => ({ instance, home: home(instance), record, grantSeat: false, chainFile: false, who: legacy(instance), keys: { didKey: `did:key:z${instance}`, stableId: `did:aw:${instance}` }, refusal: null });
const plan = (homes, settings = SETTINGS) => buildPlan({ deployment: D, settings, homes, stewardStatus: STEWARD_OK });
const byName = (p) => Object.fromEntries(p.homes.map((h) => [h.instance, h]));
function receipts(t) {
  const dir = mkdtempSync(join(tmpdir(), "oats-aweb-receipts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("no bound human: attribution none, absent or without a recorded steward refuses naming the bind, before any home is read", () => {
  for (const settings of [{}, { attribution: "none" }, { attribution: "human" }, { attribution: "human", human: SETTINGS.human }]) {
    assert.throws(() => buildPlan({ deployment: D, settings, homes: [], stewardStatus: {} }), (e) => e.code === "E_ATTACH_NO_HUMAN" && /bind a human to this deployment/.test(e.message), JSON.stringify(settings));
  }
});

test("a steward whose chain does not verify refuses the whole plan", () => {
  assert.throws(() => buildPlan({ deployment: D, settings: SETTINGS, homes: [], stewardStatus: { who: { ...STEWARD_OK.who, identity_valid: false, outcome: "unknown", reason: "revoked" } } }), (e) => e.code === "E_ATTACH_PARENT_REFUSED");
});

test("plan: each home with what attach does to it, parents first", () => {
  const p = byName(plan([
    chainless("dev", spawnedBy("lead")),
    chainless("lead", spawnedBy(null)),
    { ...chainless("done", spawnedBy(null)), chainFile: true, who: verified("did:key:zdone") },
    { ...chainless("reg", spawnedBy(null)), who: verified("did:aw:reg") },
    { ...chainless("seat", spawnedBy(null)), grantSeat: true, who: undefined },
  ]));
  assert.deepEqual([p.lead.status, p.lead.parent], ["attach", { steward: true, home: SETTINGS.steward.home, id: SETTINGS.steward.id }]);
  assert.deepEqual([p.dev.status, p.dev.parent.instance], ["attach", "lead"]);
  assert.equal(p.done.status, "attached");
  assert.equal(p.reg.status, "attached-registry");
  assert.deepEqual([p.seat.status, p.seat.code], ["skipped", "E_ATTACH_GRANT_SEAT"]);
  const order = plan([chainless("dev", spawnedBy("lead")), chainless("lead", spawnedBy(null))]).homes.map((h) => h.instance);
  assert.deepEqual(order, ["lead", "dev"]);
});

test("plan: a did:aw whose key was rotated is refused as aw's limit (subject_mismatch)", () => {
  const p = byName(plan([{ ...chainless("g", spawnedBy(null)), who: { ...legacy("g"), id: "did:aw:old", reason: "unregistered_identity" }, keys: { didKey: "did:key:zg", stableId: "did:aw:new" } }]));
  assert.deepEqual([p.g.status, p.g.code, p.g.reason], ["refused", "E_ATTACH_PARENT_REFUSED", "subject_mismatch"]);
});

test("plan: a home whose identity is not the key in its signing key is refused at the key boundary", () => {
  const p = byName(plan([{ ...chainless("k", spawnedBy(null)), keys: { didKey: "did:key:zother", stableId: "did:aw:x" } }, { ...chainless("n", spawnedBy(null)), keys: null }]));
  assert.deepEqual([p.k.code, p.n.code], ["E_ATTACH_KEY_MISMATCH", "E_ATTACH_KEY_MISMATCH"]);
});

test("plan: a refused or skipped parent refuses its children, naming the parent", () => {
  const p = byName(plan([
    { ...chainless("seat", spawnedBy(null)), grantSeat: true, who: undefined },
    chainless("under-seat", spawnedBy("seat")),
    { ...chainless("broken", spawnedBy(null)), who: { ...legacy("broken"), outcome: "unavailable", reason: "evidence_unavailable" } },
    chainless("under-broken", spawnedBy("broken")),
  ]));
  assert.deepEqual([p["under-seat"].code, p["under-seat"].reason], ["E_ATTACH_PARENT_REFUSED", "grant_seat_parent"]);
  assert.deepEqual([p["under-broken"].code, p["under-broken"].reason], ["E_ATTACH_PARENT_REFUSED", "parent_not_attached"]);
  assert.equal(p.broken.code, "E_ATTACH_FAILED");
});

test("revision: the same facts give the same revision; a changed home gives another", () => {
  const facts = [chainless("lead", spawnedBy(null))];
  assert.match(plan(facts).planRevision, /^[a-f0-9]{24}$/);
  assert.equal(plan(facts).planRevision, plan([chainless("lead", spawnedBy(null))]).planRevision);
  assert.notEqual(plan(facts).planRevision, plan([{ ...chainless("lead", spawnedBy(null)), chainFile: true, who: verified("did:key:zlead") }]).planRevision);
});

test("apply: a stale revision refuses with the fresh plan, and attaches nothing", (t) => {
  const p = plan([chainless("lead", spawnedBy(null))]);
  const calls = [];
  assert.throws(() => applyPlan({ plan: p, planRevision: "0".repeat(24), idempotencyKey: "k1", receiptsDir: receipts(t), attachOne: (e) => calls.push(e.instance) }),
    (e) => e.code === "E_ATTACH_PLAN_STALE" && e.details.plan.planRevision === p.planRevision);
  assert.deepEqual(calls, []);
});

test("apply: the same idempotency key replays the first result; with another plan it conflicts", (t) => {
  const dir = receipts(t), p = plan([chainless("lead", spawnedBy(null))]);
  const calls = [];
  const first = applyPlan({ plan: p, planRevision: p.planRevision, idempotencyKey: "k1", receiptsDir: dir, attachOne: (e) => calls.push(e.instance) });
  assert.equal(first.homes[0].status, "attached");
  assert.equal(existsSync(join(dir, "receipt.k1.json")), true);
  const again = applyPlan({ plan: plan([{ ...chainless("lead", spawnedBy(null)), chainFile: true, who: verified("did:key:zlead") }]), planRevision: p.planRevision, idempotencyKey: "k1", receiptsDir: dir, attachOne: (e) => calls.push(e.instance) });
  assert.equal(again.replayed, true);
  assert.deepEqual(again.homes, first.homes);
  assert.deepEqual(calls, ["lead"]);
  assert.throws(() => applyPlan({ plan: p, planRevision: "f".repeat(24), idempotencyKey: "k1", receiptsDir: dir, attachOne: () => {} }), (e) => e.code === "E_IDEMPOTENCY_CONFLICT");
  assert.equal(JSON.parse(readFileSync(join(dir, "receipt.k1.json"), "utf8")).planRevision, p.planRevision);
});

test("apply: a home that fails stays as it was, reports its code, and its descendants are skipped", (t) => {
  const p = plan([chainless("lead", spawnedBy(null)), chainless("dev", spawnedBy("lead")), chainless("dev2", spawnedBy("dev")), chainless("other", spawnedBy(null))]);
  const calls = [];
  const r = applyPlan({ plan: p, planRevision: p.planRevision, idempotencyKey: "k2", receiptsDir: receipts(t), attachOne: (e) => {
    calls.push(e.instance);
    if (e.instance === "lead") throw Object.assign(new Error("identity chain issuance failed: key"), { code: "E_ATTACH_KEY_MISMATCH" });
  } });
  const h = byName(r);
  assert.deepEqual(calls, ["lead", "other"]);
  assert.deepEqual([h.lead.status, h.lead.code], ["refused", "E_ATTACH_KEY_MISMATCH"]);
  assert.deepEqual([h.dev.status, h.dev.reason, h.dev2.status], ["skipped", "parent_not_attached", "skipped"]);
  assert.equal(h.other.status, "attached");
  assert.equal(r.failed, 3);
});

test("apply: arguments outside the plan-revision and key formats refuse", (t) => {
  const p = plan([chainless("lead", spawnedBy(null))]);
  for (const [rev, key] of [["abc", "k"], [p.planRevision, "../x"], [p.planRevision, ""]]) assert.throws(() => applyPlan({ plan: p, planRevision: rev, idempotencyKey: key, receiptsDir: receipts(t), attachOne: () => {} }), (e) => e.code === "E_BAD_ARGS");
});

test("host settings only: attribution human from anywhere but oats-local.yaml refuses, naming where to set it", () => {
  for (const kind of ["workspace", "soul", "spawn"]) {
    assert.throws(() => buildPlan({ deployment: D, settings: SETTINGS, origins: { "/attribution": { kind, at: "oats-workspace.yaml#/messaging" } }, homes: [], stewardStatus: STEWARD_OK }),
      (e) => e.code === "E_ATTACH_NO_HUMAN" && /set per deployment in oats-local\.yaml/.test(e.message) && e.message.includes(kind), kind);
  }
  assert.equal(buildPlan({ deployment: D, settings: SETTINGS, origins: { "/attribution": { kind: "host", at: "oats-local.yaml#/settings/oats.aweb" } }, homes: [], stewardStatus: STEWARD_OK }).homes.length, 0);
  assert.equal(buildPlan({ deployment: D, settings: SETTINGS, origins: {}, homes: [], stewardStatus: STEWARD_OK }).homes.length, 0);
});
