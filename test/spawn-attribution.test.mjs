// Spawn attribution (acmj.21): in mode human each spawned instance gets an aw
// identity chain back to the deployment's bound human. These are the rules,
// one test per rule; the hook wiring is tested in spawn-attribution-hook.
import assert from "node:assert/strict";
import test from "node:test";
import {
  SPAWN_ATTRIBUTION_FEATURE,
  attributionMode,
  attributionHomeReadiness,
  attributionReadiness,
  attributionRecord,
  chainLimitProblem,
  classifyIssuer,
  issuerSelection,
  kernelRefusal,
  oneLineLabel,
} from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";

const HUMAN = "did:aw:human1";
const STEWARD = "did:aw:steward1";
const SPAWNER = "did:key:z6MkSpawner";
const verified = (humanId = HUMAN) => ({ id: SPAWNER, outcome: "nearest_human", human_id: humanId, identity_valid: true, kind: "agent", reason: "verified" });
const failed = (reason, outcome = "unknown") => ({ id: SPAWNER, outcome, human_id: null, identity_valid: outcome === "unavailable" ? null : false, kind: null, reason });

test("mode: absent means none, human and none are accepted, anything else refuses naming both", () => {
  assert.equal(attributionMode({}), "none");
  assert.equal(attributionMode({ attribution: "" }), "none");
  assert.equal(attributionMode({ attribution: "none" }), "none");
  assert.equal(attributionMode({ attribution: "human" }), "human");
  assert.throws(() => attributionMode({ attribution: "humans" }), /attribution must be "human" or "none" \(got "humans"\)/);
});

test("kernel gate: a kernel without spawn-attribution refuses bound mode and names the upgrade", () => {
  assert.equal(SPAWN_ATTRIBUTION_FEATURE, "spawn-attribution");
  assert.equal(kernelRefusal({ features: ["x", "spawn-attribution"] }), null);
  assert.match(kernelRefusal({ version: "0.70.0", features: [] }), /attribution: human needs an OATS kernel that lists the spawn-attribution feature; this kernel \(0\.70\.0\) does not: upgrade OATS with `npm install -g @awebai\/oats@latest`/);
  assert.match(kernelRefusal(undefined), /this kernel \(unknown\) does not/);
});

test("issuer: the spawner when OATS_SPAWNER_HOME is set, else the steward; no steward refuses with the binding act", () => {
  assert.deepEqual(issuerSelection({ spawnerHome: "/d/a/h", steward: { id: STEWARD, home: "/d/.aweb-stewards/s" } }), { kind: "spawner", home: "/d/a/h" });
  assert.deepEqual(issuerSelection({ spawnerHome: "", steward: { id: STEWARD, home: "/d/.aweb-stewards/s" } }), { kind: "steward", home: "/d/.aweb-stewards/s", id: STEWARD });
  assert.throws(() => issuerSelection({ spawnerHome: undefined, steward: undefined }), /attribution: human but no human is bound to this deployment: a human runs `oats aweb setup --steward --human <did:aw> --label "<name>" --domain <domain> --name <alias>` at a terminal/);
  assert.throws(() => issuerSelection({ spawnerHome: "relative/home" }), /OATS_SPAWNER_HOME must be an absolute path/);
});

test("issuer: a verified chain issues and names the nearest human", () => {
  assert.deepEqual(classifyIssuer({ issuer: { kind: "spawner" }, who: verified(), chainFiles: true }), { action: "issue", outcome: "nearest_human", humanId: HUMAN, issuerId: SPAWNER });
});

test("issuer: a verified chain with no human still signs its child (a chain is never discarded)", () => {
  const who = { id: SPAWNER, outcome: "no_human", human_id: null, identity_valid: true, kind: "agent", reason: "verified" };
  assert.deepEqual(classifyIssuer({ issuer: { kind: "spawner" }, who, chainFiles: true }), { action: "issue", outcome: "no_human", humanId: null, issuerId: SPAWNER });
});

for (const [reason, fix] of [
  ["revoked", /revoked/],
  ["subject_revoked", /revoked/],
  ["parent_revoked", /revoked/],
  ["root_replaced", /namespace root was replaced/],
  ["superseded_certificate", /replaced by a newer certificate/],
  ["invalid_signature", /malformed or fails verification \(invalid_signature\)/],
  ["invalid_shape", /malformed or fails verification \(invalid_shape\)/],
  ["subject_mismatch", /malformed or fails verification \(subject_mismatch\)/],
]) {
  test(`refuse: a ${reason} chain refuses, names its fix, and never falls back to a chainless child`, () => {
    const verdict = classifyIssuer({ issuer: { kind: "spawner" }, who: failed(reason), chainFiles: true });
    assert.equal(verdict.action, "refuse");
    assert.match(verdict.message, fix);
    assert.match(verdict.message, /→ /, "each refusal names its fix after an arrow");
  });
}

test("refuse: a chain stale after its parent's rotation says to re-sign with the parent first", () => {
  const verdict = classifyIssuer({ issuer: { kind: "spawner" }, who: failed("stale_issuer_key"), chainFiles: true });
  assert.equal(verdict.action, "refuse");
  assert.match(verdict.message, /stale after its parent rotated its key → re-sign with your parent first: `aw id parent request --resign`/);
});

for (const reason of ["status_expired", "evidence_unavailable", "rate_limited"]) {
  test(`refuse: unavailable evidence (${reason}) for a known chain refuses, saying spawning stops while the registry is unreachable`, () => {
    const verdict = classifyIssuer({ issuer: { kind: "spawner" }, who: failed(reason, "unavailable"), chainFiles: true });
    assert.equal(verdict.action, "refuse");
    assert.match(verdict.message, /registry evidence for the issuer's chain is unavailable \(.+\) → retry once the identity registry answers; chained spawning stops while the registry is unreachable/);
  });
}

test("refuse: the issuer's status could not be read at all", () => {
  const verdict = classifyIssuer({ issuer: { kind: "spawner" }, whoError: "exit 1: lookup failed", chainFiles: true });
  assert.equal(verdict.action, "refuse");
  assert.match(verdict.message, /could not read the issuer's chain status \(exit 1: lookup failed\) → retry once the identity registry answers/);
});

test("chainless: a local spawner with no chain files and no recorded chain creates a chainless child with a warning", () => {
  const verdict = classifyIssuer({ issuer: { kind: "spawner" }, who: { ...failed("legacy_no_chain"), identity_valid: null }, chainFiles: false, recordedChainInstalled: false });
  assert.equal(verdict.action, "chainless");
  assert.match(verdict.warning, /the spawner has no identity chain \(it predates the human binding\), so this child is created without one and reports unknown; respawn the spawner to give its children a chain/);
});

test("refuse: a spawner whose spawn meta says a chain was installed but whose chain files are gone", () => {
  const verdict = classifyIssuer({ issuer: { kind: "spawner" }, who: { ...failed("legacy_no_chain"), identity_valid: null }, chainFiles: false, recordedChainInstalled: true });
  assert.equal(verdict.action, "refuse");
  assert.match(verdict.message, /the spawner's spawn meta records an installed chain but its chain files are gone → respawn the spawner; missing files never make a chained instance chainless/);
});

test("chainless needs authoritative absence: legacy_no_chain from a did:key, unregistered_identity from a did:aw", () => {
  const chainless = (who) => classifyIssuer({ issuer: { kind: "spawner" }, who: { outcome: "unknown", human_id: null, identity_valid: null, kind: null, ...who }, chainFiles: false });
  assert.equal(chainless({ id: "did:key:z6Mk", reason: "legacy_no_chain" }).action, "chainless");
  assert.equal(chainless({ id: "did:aw:global1", reason: "unregistered_identity" }).action, "chainless");
  // A did:aw is always looked up, so legacy_no_chain there is not evidence of absence.
  const unlooked = chainless({ id: "did:aw:global1", reason: "legacy_no_chain" });
  assert.equal(unlooked.action, "refuse");
  assert.match(unlooked.message, /the registry does not establish that the spawner has no enrollment \(did:aw:global1, legacy_no_chain\)/);
  // A did:key is never enrolled: an unregistered_identity answer for one is not the legacy path.
  assert.equal(chainless({ id: "did:key:z6Mk", reason: "unregistered_identity" }).action, "refuse");
  // A did:aw without a domain cannot be looked up.
  assert.equal(chainless({ id: "did:aw:global1", outcome: "unavailable", reason: "evidence_unavailable" }).action, "refuse");
});

test("chainless never applies when chain files are present: a present chain that fails refuses", () => {
  const verdict = classifyIssuer({ issuer: { kind: "spawner" }, who: { ...failed("legacy_no_chain"), identity_valid: null }, chainFiles: true });
  assert.equal(verdict.action, "refuse");
});

test("the steward never issues chainless: a steward without a verified chain refuses, naming the setup rerun", () => {
  const verdict = classifyIssuer({ issuer: { kind: "steward" }, who: { ...failed("legacy_no_chain"), identity_valid: null }, chainFiles: false });
  assert.equal(verdict.action, "refuse");
  assert.match(verdict.message, /the deployment's steward has no verified chain .* → a human reruns `oats aweb setup --steward/);
});

test("limits: a resulting chain over 8 certificates or 6144 canonical bytes refuses", () => {
  const cert = (i, pad = "") => ({ certificate: { id: `did:key:z${i}${pad}`, kind: "agent" }, signature: "s" });
  const bundle = (n, pad) => ({ v: 1, type: "aweb.id-chain", certificates: Array.from({ length: n }, (_, i) => cert(i, pad)) });
  assert.equal(chainLimitProblem(bundle(8)), null);
  assert.match(chainLimitProblem(bundle(9)), /the resulting chain has 9 certificates, over the limit of 8/);
  assert.match(chainLimitProblem(bundle(2, "x".repeat(3100))), /the resulting chain is \d+ bytes, over the limit of 6144/);
  assert.match(chainLimitProblem(undefined), /no chain/);
});

test("labels: one line, bounded, control characters refused", () => {
  assert.equal(oneLineLabel("  Juan Reyero  "), "Juan Reyero");
  assert.throws(() => oneLineLabel("a\nb"), /one line/);
  assert.throws(() => oneLineLabel("a\u0007b"), /control characters/);
  assert.throws(() => oneLineLabel(""), /required/);
  assert.throws(() => oneLineLabel("x".repeat(121)), /at most 120 bytes/);
});

test("meta: identity.attribution records mode, human and parent, with opaque ids", () => {
  const bound = { id: HUMAN, label: "Juan" };
  assert.deepEqual(attributionRecord({ action: "issue", outcome: "nearest_human", humanId: HUMAN, issuerId: STEWARD }, bound), { mode: "human", human: { id: HUMAN, label: "Juan" }, parent: { id: STEWARD } });
  assert.deepEqual(attributionRecord({ action: "issue", outcome: "nearest_human", humanId: "did:aw:other", issuerId: SPAWNER }, bound), { mode: "human", human: { id: "did:aw:other", label: "did:aw:other" }, parent: { id: SPAWNER } });
  assert.deepEqual(attributionRecord({ action: "issue", outcome: "no_human", humanId: null, issuerId: SPAWNER }, bound), { mode: "none", human: null, parent: { id: SPAWNER } });
  assert.deepEqual(attributionRecord({ action: "chainless" }, bound), { mode: "unknown", human: null, parent: null });
});

test("readiness: no human bound is information naming the one binding act, never a failure", () => {
  const r = attributionReadiness({ settings: {}, homes: { known: true, rows: [] }, hasChain: () => false, isLocal: () => true });
  assert.deepEqual(r, { mode: "none", human: null, steward: null, chainlessSpawners: null, status: "info", message: 'attribution: none — no human bound; one act binds one: a human runs `oats aweb setup --steward --human <did:aw> --label "<name>" --domain <domain> --name <alias>` at a terminal' });
});

test("readiness: bound mode names the human and counts the local spawners without a chain", () => {
  const settings = { attribution: "human", human: { id: HUMAN, label: "Juan" }, steward: { id: STEWARD, home: "/d/.aweb-stewards/s" } };
  const homes = { known: true, rows: [{ instance: "a", home: "/h/a" }, { instance: "b", home: "/h/b" }, { instance: "g", home: "/h/g" }] };
  const r = attributionReadiness({ settings, homes, hasChain: (h) => h === "/h/a", isLocal: (h) => h !== "/h/g" });
  assert.equal(r.status, "info");
  assert.equal(r.chainlessSpawners, 1);
  assert.deepEqual(r.human, { id: HUMAN, label: "Juan" });
  assert.deepEqual(r.steward, { id: STEWARD });
  assert.equal(r.message, "attribution: human — bound to Juan (did:aw:human1) through steward did:aw:steward1; 1 instance has no chain (b), so its children are created chainless and report unknown until it is respawned");
  const unknown = attributionReadiness({ settings, homes: { known: false, reason: "oats status timed out" }, hasChain: () => true, isLocal: () => true });
  assert.equal(unknown.chainlessSpawners, null);
  assert.match(unknown.message, /instances without a chain: unknown \(oats status timed out\)/);
});

test("home readiness: one attribution warning, information only, naming the binding act or this home's chain", () => {
  assert.deepEqual(attributionHomeReadiness({ settings: {}, home: "/h/a", hasChain: () => false, isLocal: () => true }), { code: "attribution", message: 'attribution: none — no human bound; one act binds one: a human runs `oats aweb setup --steward --human <did:aw> --label "<name>" --domain <domain> --name <alias>` at a terminal' });
  const settings = { attribution: "human", human: { id: HUMAN, label: "Juan" }, steward: { id: STEWARD, home: "/d/.aweb-stewards/s" } };
  assert.deepEqual(attributionHomeReadiness({ settings, home: "/h/a", hasChain: () => true, isLocal: () => true }), { code: "attribution", message: "attribution: human — bound to Juan (did:aw:human1) through steward did:aw:steward1; this instance has a chain" });
  assert.equal(attributionHomeReadiness({ settings, home: "/h/a", hasChain: () => false, isLocal: () => true }).message, "attribution: human — bound to Juan (did:aw:human1) through steward did:aw:steward1; this instance has no chain, so its children are created chainless and report unknown until it is respawned");
  assert.equal(attributionHomeReadiness({ settings, home: "/h/g", hasChain: () => false, isLocal: () => false }).message, "attribution: human — bound to Juan (did:aw:human1) through steward did:aw:steward1; this instance acts through a session grant and issues no children's chains");
  assert.equal(attributionHomeReadiness({ settings, home: undefined, hasChain: () => false, isLocal: () => true }).message, "attribution: human — bound to Juan (did:aw:human1) through steward did:aw:steward1");
});
