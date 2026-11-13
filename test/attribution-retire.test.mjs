// Retire on an opted-in deployment (spec v4.3.18 C-6, C-3d): the root removes
// each membership a home holds, from its copy under admissions/, and an
// unknown admission is resumed first. Acceptance tests 13 and 12; the
// "after the root is fixed" halves, which run --reconcile-admissions, are with
// reconciliation (attribution-reconcile.test.mjs).
import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ROOT_ID, TEAM, attributionFixture, capabilityWith, commandArgs, verbs } from "./helpers/attribution-fixture.mjs";

const RECONCILE = "oats aweb setup --reconcile-admissions";
const admission = (fx, name, label = "default") => JSON.parse(readFileSync(join(fx.homeOf(name), ".oats-aweb", `admission-${label}.json`), "utf8"));
const rootCopy = (fx, id) => join(fx.rootHome, "admissions", `${id}.cert`);
const removeCalls = (fx) => fx.fake.calls().filter((c) => commandArgs(c.args).join(" ").startsWith("id team remove-agent"));
const warningOf = (r) => String(r.doc?.warning || "");
/** A spawned home and its admitted certificate id. */
function spawned(fx, name = "dev-1") {
  const r = fx.spawn(name);
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  return admission(fx, name).certificateId;
}

// ---------------------------------------------------------------------------
// Acceptance 13: retire.

test("acceptance 13: with remove, retire removes the membership with the root's remove, from the root's copy and the root's home, and deletes the copy", (t) => {
  const fx = attributionFixture(t);
  const id = spawned(fx);
  assert.ok(existsSync(rootCopy(fx, id)));
  const r = fx.retire("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  const [call] = removeCalls(fx);
  assert.equal(call.cwd, fx.rootHome, "from the root's identity home");
  const argv = commandArgs(call.args);
  assert.equal(argv[argv.indexOf("--certificate") + 1], rootCopy(fx, id));
  assert.equal(argv[argv.indexOf("--protected-profile") + 1], fx.profile);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [id]);
  assert.ok(!existsSync(rootCopy(fx, id)), "a confirmed removal deletes the root's copy");
  assert.ok(!warningOf(r).includes("admission-removal"), warningOf(r));
});

test("acceptance 13: the removal's operation id is persisted in the home before prepare, and a retry reuses it", (t) => {
  const fx = attributionFixture(t);
  spawned(fx);
  fx.fake.setService({ remove: [{ code: "receipt_unavailable" }, "served"] });
  const first = fx.retire("dev-1");
  assert.notEqual(first.status, 0);
  const persisted = JSON.parse(readFileSync(join(first.home, ".oats-aweb", "removal-default.json"), "utf8"));
  const second = fx.retire("dev-1");
  assert.equal(second.status, 0, JSON.stringify(second.doc));
  const ops = removeCalls(fx).map((c) => { const a = commandArgs(c.args); return a[a.indexOf("--operation-id") + 1]; });
  assert.deepEqual(ops, [persisted.operationId, persisted.operationId]);
});

for (const code of ["receipt_unavailable", "external_effect_unresolved", "prepare_unconfirmed", "execute_answer_lost", "effect_in_progress", "evidence_unavailable", "registry_unavailable", "handoff_http_429", "handoff_http_503"]) {
  test(`acceptance 13: an unconfirmed removal (${code}) exits nonzero, keeps the home and the root's copy, and names --reconcile-admissions`, (t) => {
    const fx = attributionFixture(t);
    const id = spawned(fx);
    fx.fake.setService({ remove: { code } });
    const r = fx.retire("dev-1");
    assert.notEqual(r.status, 0, "the kernel keeps the home");
    assert.equal(r.doc.meta.retired, false);
    assert.ok(warningOf(r).includes(RECONCILE) && warningOf(r).includes(code), warningOf(r));
    assert.ok(existsSync(rootCopy(fx, id)));
    assert.ok(!verbs(fx.fake).includes("workspace delete"), "before the workspace is deleted");
  });
}

test("acceptance 13: an answer that isn't committed is unconfirmed too", (t) => {
  const fx = attributionFixture(t);
  spawned(fx);
  fx.fake.setService({ remove: "pending" });
  const r = fx.retire("dev-1");
  assert.notEqual(r.status, 0);
  assert.ok(warningOf(r).includes(RECONCILE), warningOf(r));
});

for (const code of ["handoff_http_404", "handoff_http_405", "handoff_http_501"]) {
  test(`acceptance 13: a server that doesn't serve the act (${code}) warns admission-removal-unavailable naming the service's server, never service-refused, keeps the root's copy and removes the home`, (t) => {
    const fx = attributionFixture(t);
    const id = spawned(fx);
    fx.fake.setService({ remove: { code } });
    const r = fx.retire("dev-1");
    assert.equal(r.status, 0, JSON.stringify(r.doc));
    const w = warningOf(r);
    assert.ok(w.includes("admission-removal-unavailable") && w.includes(`the service's server answered ${code} to team.agent.remove`) && w.includes("its operator upgrades the server") && w.includes(RECONCILE), w);
    assert.ok(!w.includes("service-refused") && !w.includes("admission-removal-blocked"), w);
    assert.ok(existsSync(rootCopy(fx, id)));
  });
}

const FIX_ROOT = `fix the root, then run \`${RECONCILE}\``;
const CANT_ACT = [
  ["root-home-missing", (fx) => rmSync(fx.rootHome, { recursive: true, force: true }), FIX_ROOT],
  ["root-home-unsafe", (fx) => chmodSync(fx.rootHome, 0o755), FIX_ROOT],
  ["profile-changed", (fx) => appendFileSync(fx.profile, " "), FIX_ROOT],
  ["root-revoked", (fx) => fx.fake.revoke(ROOT_ID), "no OATS path removes this membership in v1; it counts only in the revoked root's bucket, never in the new root's"],
  ["service-refused", (fx) => fx.fake.setService({ remove: { code: "scope_refused" } }), FIX_ROOT],
];
for (const [reason, cause, fix] of CANT_ACT) {
  test(`acceptance 13: the root can't act (${reason}): retire keeps the membership, warns admission-removal-blocked with that reason and its fix, keeps the root's copy and removes the home`, (t) => {
    const fx = attributionFixture(t);
    const id = spawned(fx);
    cause(fx);
    const r = fx.retire("dev-1");
    assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
    const w = warningOf(r);
    assert.ok(w.includes("admission-removal-blocked") && w.includes(`reason: ${reason}`) && w.includes(fix), w);
    assert.ok(!/\bremoved\b/.test(w.replace(/removes/g, "")), `never says it was removed: ${w}`);
    assert.deepEqual(fx.fake.removed(), [], "the membership is kept");
    if (reason !== "root-home-missing") assert.ok(existsSync(rootCopy(fx, id)), "the root's copy is kept");
    if (reason !== "service-refused") assert.deepEqual(removeCalls(fx), [], "nothing is sent");
  });
}

test("acceptance 13: the root's copy missing, and the home's certificate carries the persisted certificate_id: retire restores the copy (0600) and the removal goes ahead", (t) => {
  const fx = attributionFixture(t);
  const id = spawned(fx);
  rmSync(rootCopy(fx, id));
  const r = fx.retire("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [id]);
  assert.equal(commandArgs(removeCalls(fx)[0].args).includes(rootCopy(fx, id)), true, "removed from the restored copy");
});

test("acceptance 13: a blocked removal after the restore keeps the restored copy, owner-only, so it stays reconcilable", (t) => {
  const fx = attributionFixture(t);
  const id = spawned(fx);
  rmSync(rootCopy(fx, id));
  fx.fake.setService({ remove: { code: "scope_refused" } });
  const r = fx.retire("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.ok(warningOf(r).includes("reason: service-refused"), warningOf(r));
  assert.equal(statSync(rootCopy(fx, id)).mode & 0o777, 0o600);
});

test("acceptance 13: the root's copy missing, and the home's certificate doesn't carry it: admission-removal-blocked root-copy-missing, and the home is removed", (t) => {
  const fx = attributionFixture(t);
  const id = spawned(fx);
  rmSync(rootCopy(fx, id));
  rmSync(admission(fx, "dev-1").certificateOut);
  const r = fx.retire("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  const w = warningOf(r);
  assert.ok(w.includes("admission-removal-blocked") && w.includes("reason: root-copy-missing") && w.includes("no certificate for this membership is left, so OATS can't remove it; check-only lists it under `leakedMemberships`"), w);
  assert.deepEqual(removeCalls(fx), []);
});

test("acceptance 13: the home's certificate naming another certificate_id doesn't restore the copy", (t) => {
  const fx = attributionFixture(t);
  const id = spawned(fx);
  rmSync(rootCopy(fx, id));
  const out = admission(fx, "dev-1").certificateOut;
  const changed = { ...JSON.parse(readFileSync(out, "utf8")), certificate_id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f" };
  writeFileSync(out, JSON.stringify(changed));
  const r = fx.retire("dev-1");
  assert.ok(warningOf(r).includes("reason: root-copy-missing"), warningOf(r));
  assert.ok(!existsSync(rootCopy(fx, id)) && !existsSync(rootCopy(fx, changed.certificate_id)));
});

test("acceptance 13: without remove, retire keeps the membership, warns admission-removal-unavailable and removes the home", (t) => {
  const fx = attributionFixture(t, { capability: capabilityWith(t, { REMOVE_SERVED: false }) });
  const id = spawned(fx);
  const r = fx.retire("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.ok(warningOf(r).includes("admission-removal-unavailable") && warningOf(r).includes("retiring an instance frees no admission slot"), warningOf(r));
  assert.deepEqual(removeCalls(fx), []);
  assert.ok(existsSync(rootCopy(fx, id)));
});

test("acceptance 13: each joined team's membership is removed too, from its own record", (t) => {
  const fx = attributionFixture(t, { settings: { join: "ops" } });
  const r0 = fx.spawn("dev-1");
  assert.equal(r0.status, 0, JSON.stringify(r0.doc) + r0.stderr);
  const ids = [admission(fx, "dev-1").certificateId, admission(fx, "dev-1", "ops").certificateId];
  const r = fx.retire("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id).sort(), [...ids].sort());
});

test("C-6: once the root removed the memberships, retire gives no controller-cleanup advice and says the alias is reusable", (t) => {
  const fx = attributionFixture(t, { settings: { join: "ops" } });
  assert.equal(fx.spawn("dev-1").status, 0);
  const r = fx.retire("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.ok(!warningOf(r).includes("controller cleanup") && !warningOf(r).includes("team_not_hosted"), warningOf(r));
  assert.deepEqual([r.doc.meta.retired, r.doc.meta.aliasReusable, r.doc.meta.aliasReason], [true, true, "admission-removed"]);
  assert.equal(r.doc.meta.pendingControllerCleanup, undefined);
});

test("C-6: a membership the root couldn't remove leaves the alias held, with only C-6's warning to say why", (t) => {
  const fx = attributionFixture(t);
  spawned(fx);
  fx.fake.setService({ remove: { code: "scope_refused" } });
  const r = fx.retire("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.deepEqual([r.doc.meta.aliasReusable, r.doc.meta.aliasReason], [false, "admission-kept"]);
  assert.ok(!warningOf(r).includes("controller cleanup"), warningOf(r));
});

// ---------------------------------------------------------------------------
// Acceptance 12: compensation, the rollback retire after a failed spawn.

/** A spawn that fails after its admission committed (the install refuses), and its rollback meta. */
function failedAfterAdmission(fx) {
  fx.fake.setService({ install: { code: "member_mismatch" } });
  const r = fx.hook("spawn", "dev-1");
  assert.notEqual(r.status, 0);
  fx.fake.setService({ install: undefined });
  return r.doc.meta;
}
/** A spawn whose admission stays unknown, and its rollback meta. */
function unknownAdmission(fx) {
  fx.fake.setService({ admit: { code: "receipt_unavailable" } });
  const r = fx.hook("spawn", "dev-1");
  assert.ok(warningOf(r).startsWith("oats-aweb: E_ADMISSION_UNKNOWN"), warningOf(r));
  assert.equal(admission(fx, "dev-1").state, "unknown");
  return r.doc.meta;
}
const STILL_UNKNOWN = "so this home is kept → retire it again once the service answers (README, \"Human attribution: admission refusals\")";

test("acceptance 12: after a failure post-admission, the rollback retire removes the committed membership", (t) => {
  const fx = attributionFixture(t);
  const meta = failedAfterAdmission(fx);
  const id = admission(fx, "dev-1").certificateId;
  const r = fx.retire("dev-1", { fromMeta: meta });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [id]);
});

test("acceptance 12: an unknown admission is resumed first, with the persisted operation id from the root home; committed is removed", (t) => {
  const fx = attributionFixture(t);
  const meta = unknownAdmission(fx);
  const { operationId } = admission(fx, "dev-1");
  fx.fake.setService({ admit: undefined });
  const r = fx.retire("dev-1", { fromMeta: meta });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  const admits = fx.fake.calls().filter((c) => commandArgs(c.args).join(" ").startsWith("id team admit"));
  const resume = admits.at(-1);
  assert.equal(resume.cwd, fx.rootHome);
  const argv = commandArgs(resume.args);
  assert.equal(argv[argv.indexOf("--operation-id") + 1], operationId);
  assert.equal(Object.keys(fx.fake.charges()).length, 1, "one certificate, no second charge");
  const id = fx.fake.charges()[operationId].certificate_id;
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [id]);
  assert.ok(!existsSync(rootCopy(fx, id)), "the copy written from --certificate-out went with the removal");
});

test("acceptance 12: an unknown admission resumed as refused records refused and does nothing more", (t) => {
  const fx = attributionFixture(t);
  const meta = unknownAdmission(fx);
  fx.fake.setService({ admit: { code: "subject_ineligible" } });
  const r = fx.retire("dev-1", { fromMeta: meta });
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.equal(admission(fx, "dev-1").state, "refused");
  assert.deepEqual(removeCalls(fx), []);
});

test("acceptance 12: an unknown admission that stays unknown keeps the home, with the operation id and team", (t) => {
  const fx = attributionFixture(t);
  const meta = unknownAdmission(fx);
  const { operationId } = admission(fx, "dev-1");
  const r = fx.retire("dev-1", { fromMeta: meta });
  assert.notEqual(r.status, 0);
  const w = warningOf(r);
  assert.ok(w.includes(`the admission's outcome is unknown (operation ${operationId}, team ${TEAM}), ${STILL_UNKNOWN}`), w);
  assert.ok(!verbs(fx.fake).includes("workspace delete"));
});

const FIXABLE = [
  ["root-home-unsafe", (fx) => chmodSync(fx.rootHome, 0o755), (fx) => chmodSync(fx.rootHome, 0o700)],
  ["profile-changed", (fx) => { renameSync(fx.profile, `${fx.profile}.kept`); appendFileSync(fx.profile, readFileSync(`${fx.profile}.kept`, "utf8") + " "); chmodSync(fx.profile, 0o600); }, (fx) => renameSync(`${fx.profile}.kept`, fx.profile)],
  ["service-refused", (fx) => fx.fake.setService({ remove: { code: "scope_refused" } }), (fx) => fx.fake.setService({ remove: "served" })],
];
for (const [reason, cause, fix] of FIXABLE) {
  test(`acceptance 12: the root can't act during the resume (${reason}): retire exits nonzero and keeps the home, naming the reason and "fix the root, then retire again"; once fixed, a second retire resumes and finishes`, (t) => {
    const fx = attributionFixture(t);
    const meta = unknownAdmission(fx);
    fx.fake.setService({ admit: undefined });
    cause(fx);
    const r = fx.retire("dev-1", { fromMeta: meta });
    assert.notEqual(r.status, 0, JSON.stringify(r.doc));
    const w = warningOf(r);
    assert.ok(w.includes(reason) && w.includes("fix the root, then retire again, which resumes the admission"), w);
    assert.deepEqual(fx.fake.removed(), []);
    fix(fx);
    const again = fx.retire("dev-1", { fromMeta: meta });
    assert.equal(again.status, 0, JSON.stringify(again.doc) + again.stderr);
    assert.equal(fx.fake.removed().length, 1, "resumed and removed");
    assert.equal(Object.keys(fx.fake.charges()).length, 1, "one certificate, no second charge");
  });
}

for (const [reason, cause] of [["root-revoked", (fx) => fx.fake.revoke(ROOT_ID)], ["root-home-missing", (fx) => rmSync(fx.rootHome, { recursive: true, force: true })]]) {
  test(`acceptance 12: the root can't act during the resume (${reason}): admission-removal-blocked, saying nothing in OATS can resume it, and the home is removed`, (t) => {
    const fx = attributionFixture(t);
    const meta = unknownAdmission(fx);
    fx.fake.setService({ admit: undefined });
    cause(fx);
    const r = fx.retire("dev-1", { fromMeta: meta });
    assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
    const w = warningOf(r);
    assert.ok(w.includes("admission-removal-blocked") && w.includes(`reason: ${reason}`) && w.includes("nothing in OATS can resume"), w);
    assert.equal(Object.keys(fx.fake.charges()).length, 0, "not resumed");
  });
}

test("acceptance 12: a refused admission needs nothing at retire", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ admit: { code: "subject_ineligible" } });
  const r0 = fx.hook("spawn", "dev-1");
  assert.equal(admission(fx, "dev-1").state, "refused");
  const r = fx.retire("dev-1", { fromMeta: r0.doc.meta });
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.equal(verbs(fx.fake).filter((v) => v === "id team admit").length, 1, "the spawn's admit only: nothing is resumed");
  assert.deepEqual(removeCalls(fx), []);
});

/** A spawn hook killed during its admit: the record pending, no --certificate-out file, and
 *  nothing prepared at the service. Its rollback meta is empty: the hook never answered. */
function killedDuringAdmit(fx) {
  fx.fake.setService({ admit: { code: "receipt_unavailable" } });
  fx.hook("spawn", "dev-1");
  fx.fake.setService({ admit: undefined });
  const file = join(fx.homeOf("dev-1"), ".oats-aweb", "admission-default.json");
  const record = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...record, state: "pending" }));
  return record;
}

test("acceptance 12 (v4.3.19): a hook killed during admit, never prepared: the rollback retire resumes it, the resume admits it now, and retire removes it at once", (t) => {
  const fx = attributionFixture(t);
  const { operationId } = killedDuringAdmit(fx);
  const r = fx.retire("dev-1", { fromMeta: {} });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.deepEqual(Object.keys(fx.fake.charges()), [operationId]);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [fx.fake.charges()[operationId].certificate_id]);
});

test("acceptance 12 (v4.3.19): a hook killed during admit, resumed as refused: nothing more, and the home goes", (t) => {
  const fx = attributionFixture(t);
  killedDuringAdmit(fx);
  fx.fake.setService({ admit: { code: "subject_ineligible" } });
  const r = fx.retire("dev-1", { fromMeta: {} });
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.equal(admission(fx, "dev-1").state, "refused");
  assert.deepEqual(removeCalls(fx), []);
});

test("acceptance 12 (v4.3.19): a hook killed during admit, still unknown at the resume: the home is kept", (t) => {
  const fx = attributionFixture(t);
  const { operationId } = killedDuringAdmit(fx);
  fx.fake.setService({ admit: { code: "receipt_unavailable" } });
  const r = fx.retire("dev-1", { fromMeta: {} });
  assert.notEqual(r.status, 0);
  assert.ok(warningOf(r).includes(`the admission's outcome is unknown (operation ${operationId}, team ${TEAM}), ${STILL_UNKNOWN}`), warningOf(r));
});

test("acceptance 12 (v4.3.20): a resume refused admission_limit_reached counts as refused: no membership exists, and the home is removed", (t) => {
  const fx = attributionFixture(t);
  const meta = unknownAdmission(fx);
  fx.fake.setService({ admit: { code: "admission_limit_reached" } });
  const r = fx.retire("dev-1", { fromMeta: meta });
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.equal(admission(fx, "dev-1").state, "refused");
  assert.deepEqual(removeCalls(fx), []);
});

test("C-3d (v4.3.19): a pending record whose --certificate-out names another member key isn't read as committed", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  const file = join(fx.homeOf("dev-1"), ".oats-aweb", "admission-default.json");
  const { certificateId, ...record } = JSON.parse(readFileSync(file, "utf8"));
  rmSync(rootCopy(fx, certificateId));
  const cert = JSON.parse(readFileSync(record.certificateOut, "utf8"));
  writeFileSync(record.certificateOut, JSON.stringify({ ...cert, member_did_key: "did:key:zsomeone-else" }));
  writeFileSync(file, JSON.stringify({ ...record, state: "pending" }));
  const r = fx.retire("dev-1", { fromMeta: {} });
  // Resumed as unknown: the service holds the operation's certificate, and aw won't write it over the foreign file.
  assert.notEqual(r.status, 0, "kept");
  assert.ok(warningOf(r).includes("holds another file") && warningOf(r).includes("retire again"), warningOf(r));
  assert.ok(!existsSync(rootCopy(fx, certificateId)), "no copy from a certificate for another key");
});
