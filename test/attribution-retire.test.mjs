// Retire on an opted-in deployment (spec v4.3.18 C-6, C-3d): the root removes
// each membership a home holds, from its copy under admissions/, and an
// unknown admission is resumed first. Acceptance tests 13 and 12; the
// "after the root is fixed" halves, which run --reconcile-admissions, are with
// reconciliation (attribution-reconcile.test.mjs).
import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { inAwebHostedZone, teamCertificateRelativePath } from "../oats-package/capabilities/oats-aweb/lib/aweb-team-id.mjs";
import { POLICY, writeIdentity } from "./helpers/fake-aw-protected.mjs";
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

for (const code of ["receipt_unavailable", "external_effect_unresolved", "registration_unconfirmed", "prepare_unconfirmed", "prepare_answer_lost", "execute_answer_lost", "receipt_invalid", "handoff_result_invalid", "effect_in_progress", "evidence_unavailable", "registry_unavailable", "handoff_http_429", "handoff_http_503"]) {
  test(`acceptance 13: an unconfirmed removal (${code}) exits nonzero, keeps the home and the root's copy, and names --reconcile-admissions`, (t) => {
    const fx = attributionFixture(t);
    const id = spawned(fx);
    fx.fake.setService({ remove: { code } });
    const r = fx.retire("dev-1");
    assert.notEqual(r.status, 0, "the kernel keeps the home");
    assert.equal(r.doc.meta.retired, false);
    assert.ok(warningOf(r).includes(RECONCILE) && warningOf(r).includes(code), warningOf(r));
    assert.ok(existsSync(rootCopy(fx, id)));
    // The workspace delete comes first, while the membership's certificate still authenticates it.
    const v = verbs(fx.fake);
    assert.ok(v.indexOf("workspace delete") >= 0 && v.indexOf("workspace delete") < v.indexOf("id team remove-agent"), v.join(", "));
  });
}

test("C-6: a retire kept by an unconfirmed removal, after its workspace delete, finishes on the rerun: one delete, the membership removed", (t) => {
  const fx = attributionFixture(t);
  const id = spawned(fx);
  fx.fake.setService({ remove: { code: "receipt_unavailable" } });
  assert.notEqual(fx.retire("dev-1").status, 0);
  fx.fake.setService({ remove: "served" });
  const r = fx.retire("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.deepEqual([r.doc.meta.retired, r.doc.meta.aliasReusable, r.doc.meta.aliasReason], [true, true, "admission-removed"]);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [id]);
  assert.equal(verbs(fx.fake).filter((v) => v === "workspace delete").length, 1, "the delete is never sent again");
});

test("C-6: a workspace delete that fails keeps the home and the membership, so its certificate still authenticates the retire's rerun", (t) => {
  const fx = attributionFixture(t);
  const id = spawned(fx);
  fx.fake.setService({ workspaceDelete: { code: "service_unavailable" } });
  const r = fx.retire("dev-1");
  assert.notEqual(r.status, 0);
  assert.equal(r.doc.meta.reason, "self-delete-failed");
  assert.deepEqual(removeCalls(fx), [], "nothing is removed before the delete");
  fx.fake.setService({ workspaceDelete: undefined });
  const again = fx.retire("dev-1");
  assert.equal(again.status, 0, JSON.stringify(again.doc) + again.stderr);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [id]);
});

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

/** The certificate aw installed in the home's identity (aw's own path and encoding). */
const installed = (fx, name = "dev-1") => join(admission(fx, name).identityHome, teamCertificateRelativePath(TEAM));

test("acceptance 13: the root's copy and the --certificate-out file both gone: retire restores the copy from the certificate aw installed, and the removal goes ahead", (t) => {
  const fx = attributionFixture(t);
  const id = spawned(fx);
  rmSync(rootCopy(fx, id));
  rmSync(admission(fx, "dev-1").certificateOut);
  assert.ok(existsSync(installed(fx)), "aw installed the certificate at its own path");
  const r = fx.retire("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [id]);
  assert.ok(!warningOf(r).includes("root-copy-missing"), warningOf(r));
});

test("acceptance 13: an installed certificate for another member doesn't restore the copy", (t) => {
  const fx = attributionFixture(t);
  const id = spawned(fx);
  rmSync(rootCopy(fx, id));
  rmSync(admission(fx, "dev-1").certificateOut);
  const file = installed(fx);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), member_did_key: "did:key:zsomeoneelse" }));
  const r = fx.retire("dev-1");
  assert.ok(warningOf(r).includes("reason: root-copy-missing"), warningOf(r));
  assert.ok(!existsSync(rootCopy(fx, id)));
  assert.deepEqual(removeCalls(fx), []);
});

test("acceptance 13: the root's copy missing, and neither the home's --certificate-out file nor its installed certificate carries it: admission-removal-blocked root-copy-missing, and the home is removed", (t) => {
  const fx = attributionFixture(t);
  const id = spawned(fx);
  rmSync(rootCopy(fx, id));
  rmSync(admission(fx, "dev-1").certificateOut);
  rmSync(installed(fx));
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
  writeFileSync(installed(fx), JSON.stringify(changed));
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
  assert.ok(warningOf(r).includes("the joined identity's workspace on ops:acme.example stays at the service until it goes stale"), warningOf(r));
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

test("acceptance 12 (v4.3.23): an admission aw committed but answered prepare_unconfirmed is unknown at spawn; the rollback retire resumes it as committed and removes it", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ admit: { code: "prepare_unconfirmed", charge: true } });
  const r0 = fx.hook("spawn", "dev-1");
  assert.ok(warningOf(r0).startsWith("oats-aweb: E_ADMISSION_UNKNOWN"), warningOf(r0));
  const { operationId, state } = admission(fx, "dev-1");
  assert.equal(state, "unknown");
  fx.fake.setService({ admit: undefined });
  const r = fx.retire("dev-1", { fromMeta: r0.doc.meta });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.deepEqual(Object.keys(fx.fake.charges()), [operationId]);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [fx.fake.charges()[operationId].certificate_id]);
});

test("acceptance 12 (v4.3.24): an admit answered with a code in no row keeps the admission unknown, and the rollback retire resumes it", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ admit: { code: "a_code_aw_adds_later" } });
  const r0 = fx.hook("spawn", "dev-1");
  assert.ok(warningOf(r0).startsWith("oats-aweb: E_ADMISSION_UNKNOWN (code: a_code_aw_adds_later)"), warningOf(r0));
  const { operationId } = admission(fx, "dev-1");
  const kept = fx.retire("dev-1", { fromMeta: r0.doc.meta });
  assert.notEqual(kept.status, 0, "still unknown: the home is kept");
  assert.ok(warningOf(kept).includes(`the admission's outcome is unknown (operation ${operationId}, team ${TEAM}), ${STILL_UNKNOWN}`), warningOf(kept));
  fx.fake.setService({ admit: undefined });
  const r = fx.retire("dev-1", { fromMeta: r0.doc.meta });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [fx.fake.charges()[operationId].certificate_id]);
});

// v4.3.23: a requester-side refusal at the resume says nothing of the earlier operation's outcome.
for (const code of ["scope_refused", "profile_scope_refused", "profile_scope_ambiguous", "signed_request_invalid", "authority_changed", "operation_conflict", "operation_mismatch"]) {
  test(`acceptance 12 (v4.3.23): an unknown admission whose resume is refused ${code} keeps the home: fix the root, then retire again`, (t) => {
    const fx = attributionFixture(t);
    const meta = unknownAdmission(fx);
    const { operationId } = admission(fx, "dev-1");
    fx.fake.setService({ admit: { code } });
    const r = fx.retire("dev-1", { fromMeta: meta });
    assert.notEqual(r.status, 0, "the home is kept");
    const w = warningOf(r);
    assert.ok(w.includes(code) && w.includes(operationId) && w.includes("service-refused") && w.includes("fix the root, then retire again, which resumes the admission"), w);
    assert.equal(admission(fx, "dev-1").state, "unknown");
    assert.ok(!verbs(fx.fake).includes("workspace delete"));
  });
}

for (const code of ["admission_policy_missing", "policy_changed", "operation_expired", "approval_expired"]) {
  test(`acceptance 12 (v4.3.23): an unknown admission resumed as ${code}, the operation's own final code, records refused and the home goes`, (t) => {
    const fx = attributionFixture(t);
    const meta = unknownAdmission(fx);
    fx.fake.setService({ admit: { code } });
    const r = fx.retire("dev-1", { fromMeta: meta });
    assert.equal(r.status, 0, JSON.stringify(r.doc));
    assert.equal(admission(fx, "dev-1").state, "refused");
    assert.deepEqual(removeCalls(fx), []);
  });
}

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

// ---------------------------------------------------------------------------
// Acceptance 13 (v4.3.25): an admitted team in aweb's hosted zone. There aw's workspace delete
// is hosted self-retirement, a second removal act, so retire and leave never run it.

const HOSTED = { default: "backend:review.aweb.ai", ops: "ops:review.aweb.ai" };
const hostedFixture = (t, ids = HOSTED, opts = {}) => attributionFixture(t, { teamIds: ids, service: { policy: { ...POLICY, teams: [ids.default, ids.ops] } }, ...opts });
const STALE = "stays at the service until it goes stale";

test("acceptance 13 (v4.3.25): on admitted teams in aweb's hosted zone, retire runs no workspace delete, for the primary or a joined identity; the root removes both, and the home goes", (t) => {
  const fx = hostedFixture(t, HOSTED, { settings: { join: "ops" } });
  assert.equal(fx.spawn("dev-1").status, 0);
  const ids = ["default", "ops"].map((label) => admission(fx, "dev-1", label).certificateId);
  const r = fx.retire("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.ok(!verbs(fx.fake).includes("workspace delete"), verbs(fx.fake).join(", "));
  assert.deepEqual(fx.fake.selfRetired(), []);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id).sort(), ids.sort());
  assert.ok(warningOf(r).includes(`the workspace on ${HOSTED.default} ${STALE}`) && warningOf(r).includes(`on ${HOSTED.ops} ${STALE}`), warningOf(r));
  // v4.3.26: no delete ran, so the alias isn't said to be free, whatever the root's removal did.
  assert.deepEqual([r.doc.meta.retired, r.doc.meta.aliasReusable, r.doc.meta.aliasReason], [true, false, "hosted-workspace-kept"]);
  const marker = JSON.parse(readFileSync(join(fx.homeOf("dev-1"), ".oats-aweb", "default-retire.json"), "utf8"));
  assert.deepEqual([marker.kind, marker.workspaceDeleted], ["default-workspace-delete", false]);
  // A rerun reads the marker: the workspace was left to go stale, never "deleted".
  const again = fx.retire("dev-1");
  assert.equal(again.status, 0, JSON.stringify(again.doc));
  assert.deepEqual([again.doc.meta.aliasReusable, again.doc.meta.aliasReason], [false, "hosted-workspace-kept"]);
  assert.ok(warningOf(again).includes(`workspace "dev-1" was left at the service to go stale`) && warningOf(again).includes("--name"), warningOf(again));
  assert.ok(!/deleted/.test(warningOf(again)), warningOf(again));
});

test("acceptance 13 (v4.3.25): the rollback retire on a hosted-zone team runs no workspace delete either", (t) => {
  const fx = hostedFixture(t);
  fx.fake.setService({ install: { code: "member_mismatch" } });
  const r0 = fx.hook("spawn", "dev-1");
  assert.notEqual(r0.status, 0);
  fx.fake.setService({ install: undefined });
  const r = fx.retire("dev-1", { fromMeta: r0.doc.meta });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.ok(!verbs(fx.fake).includes("workspace delete"));
  assert.equal(fx.fake.removed().length, 1);
});

test("acceptance 13 (v4.3.25): with the root unable to act on a hosted-zone team, retire still runs no workspace delete: the membership is kept, never self-retired", (t) => {
  const fx = hostedFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  fx.fake.revoke(ROOT_ID);
  const r = fx.retire("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.ok(warningOf(r).includes("reason: root-revoked"), warningOf(r));
  assert.ok(!verbs(fx.fake).includes("workspace delete"));
  assert.deepEqual(fx.fake.selfRetired(), []);
});

for (const domain of ["evil-aweb.ai", "aweb.ai.example.com"]) {
  test(`acceptance 13 (v4.3.25): ${domain} is outside aweb's hosted zone: retire deletes the workspace first, then the root removes`, (t) => {
    const ids = { default: `backend:${domain}`, ops: `ops:${domain}` };
    const fx = hostedFixture(t, ids);
    assert.equal(fx.spawn("dev-1").status, 0);
    const r = fx.retire("dev-1");
    assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
    const v = verbs(fx.fake);
    assert.ok(v.includes("workspace delete") && v.indexOf("workspace delete") < v.indexOf("id team remove-agent"), v.join(", "));
  });
}

test("C-6 (v4.3.25): aw's hosted zone, as isAwebHostedNamespace reads a team id's domain", () => {
  const rows = [["a:aweb.ai", true], ["a:review.aweb.ai", true], ["a: Review.AWEB.ai. ", true], ["a:evil-aweb.ai", false], ["a:aweb.ai.example.com", false], ["a:.aweb.ai", false], ["a:x..aweb.ai", false], ["a:acme.example", false], ["not-a-team", false], ["a:", false]];
  for (const [team, inZone] of rows) assert.equal(inAwebHostedZone(team), inZone, team);
});

/** A recorded retained local seat, seat-1, on the deployment's own identity, that joined ops
 *  through the root. Returns the settings it runs under and its lock's path. */
function retainedSeatJoined(fx) {
  const source = join(fx.ws, ".aw"), home = fx.homeOf("seat-1");
  mkdirSync(home, { recursive: true });
  const settings = { ...fx.settings, identity: { mode: "local", source } };
  writeIdentity(join(home, ".aw"));
  for (const identityHome of [source, join(home, ".aw")]) writeFileSync(join(identityHome, "workspace.yaml"), `alias: legacy-agent\nteam_id: ${TEAM}\naweb_url: https://aweb.acme.example/api\n`);
  const lock = join(fx.ws, ".aweb-seat.lock");
  writeFileSync(lock, JSON.stringify({ home, instance: "seat-1", team: TEAM, takenAt: new Date().toISOString() }));
  fx.record("seat-1", { team: TEAM, alias: "legacy-agent", delivery: "channel", retained: true, source, lock, defaultTeam: { label: "default", team: TEAM, from: "deployment" }, identity: { mode: "local", alias: "legacy-agent", team: TEAM } });
  const joined = fx.command("seat-1", "join", ["--labels", "ops", "--json"], { live: settings });
  assert.equal(joined.status, 0, joined.stdout + joined.stderr);
  return { settings, lock, source };
}

test("C-6: retiring a retained seat removes the membership it joined through the root, and leaves its source identity untouched", (t) => {
  const fx = attributionFixture(t);
  const { settings, source } = retainedSeatJoined(fx);
  const { certificateId } = admission(fx, "seat-1", "ops");
  const r = fx.retire("seat-1", { captured: settings });
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.equal(r.doc.meta.retained, true);
  assert.deepEqual(removeCalls(fx).length, 1);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [certificateId]);
  assert.ok(!existsSync(rootCopy(fx, certificateId)));
  assert.ok(existsSync(join(source, "signing.key")));
});

test("C-6: a retained seat's retire kept by an unconfirmed removal keeps the seat and its lock, for the rerun", (t) => {
  const fx = attributionFixture(t);
  const { settings, lock } = retainedSeatJoined(fx);
  const { certificateId } = admission(fx, "seat-1", "ops");
  fx.fake.setService({ remove: { code: "receipt_unavailable" } });
  const r = fx.retire("seat-1", { captured: settings });
  assert.equal(r.status, 1, JSON.stringify(r.doc));
  assert.equal(r.doc.meta.retired, false);
  assert.ok(existsSync(lock), "the seat's lock is kept");
  assert.ok(existsSync(rootCopy(fx, certificateId)));
  assert.ok(warningOf(r).includes(RECONCILE) || warningOf(r).includes("retire"), warningOf(r));
});
