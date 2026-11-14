// The root's admission at spawn and its refusals (spec v4.3.10 C-3b, C-3c,
// C-3d), with acceptance test 8 and the spawn half of test 23 (each refusal
// starts with its code and holds its fix within the 300-character cap).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ROOT_ID, TEAM, attributionFixture, capabilityWith, commandArgs } from "./helpers/attribution-fixture.mjs";
import { POLICY } from "./helpers/fake-aw-protected.mjs";

const admits = (fake) => fake.calls().filter((c) => commandArgs(c.args).join(" ").startsWith("id team admit"));
const opOf = (call) => call.args[call.args.indexOf("--operation-id") + 1];
const admission = (fx, name) => JSON.parse(readFileSync(join(fx.homeOf(name), ".oats-aweb", "admission-default.json"), "utf8"));
/** A spawn refusal's own text: its segment of the warning (the hook joins its other warnings after it with " | "), without the provider's prefix, which the 300-character cap doesn't count. */
const refusal = (r) => { assert.equal(r.status, 1, JSON.stringify(r.doc)); return r.doc.warning.split(" | ")[0].replace(/^oats-aweb: /, ""); };
/** The cap holds the whole text, its fix included: nothing was cut. */
const fits = (text, ending) => { assert.ok(text.length <= 300, `${text.length} characters: ${text}`); assert.ok(text.endsWith(ending), `cut or reworded: ${text}`); };

/** A limit refusal after one committed admission, from `capability`. */
function limitText(t, capability) {
  const fx = attributionFixture(t, capability ? { capability } : {});
  assert.equal(fx.spawn("dev-1").status, 0);
  fx.fake.setService({ admit: { code: "admission_limit_reached" } });
  const text = refusal(fx.spawn("dev-2"));
  assert.match(text, /^E_ADMISSION_LIMIT\b/);
  assert.ok(text.includes(`max_active ${POLICY.bounds.max_active}`) && text.includes(`max_per_window ${POLICY.bounds.max_per_window}`) && text.includes(`${POLICY.bounds.rate_window_seconds} s`), text);
  assert.ok(text.includes("OATS's count, not the server's: 1 live"), text);
  return text;
}

test("acceptance 8: admission_limit_reached refuses E_ADMISSION_LIMIT with the policy's bounds and OATS's own count, labelled as OATS's; with remove served, retiring idle instances is a fix", (t) => {
  fits(limitText(t), "wait for the rate window, retire idle instances, or change the policy");
});

test("acceptance 8: while remove is unavailable, E_ADMISSION_LIMIT adds that retiring an instance frees no slot", (t) => {
  fits(limitText(t, capabilityWith(t, { REMOVE_SERVED: false })), "wait for the rate window, or change the policy; retiring an instance frees no slot");
});

for (const code of ["policy_changed", "admission_policy_missing", "subject_ineligible"]) {
  test(`acceptance 8: ${code} refuses E_ADMISSION_REFUSED with its code`, (t) => {
    const fx = attributionFixture(t);
    fx.fake.setService({ admit: { code } });
    const text = refusal(fx.spawn("dev-1"));
    assert.ok(text.startsWith(`E_ADMISSION_REFUSED (code: ${code}): `), text);
    fits(text, 'README, "Human attribution: admission refusals")');
  });
}

test("acceptance 22 (spawn): admission_policy_missing, while the pinned aw can't change the policy, leads with what is true now", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ admit: { code: "admission_policy_missing" } });
  assert.ok(refusal(fx.spawn("dev-1")).startsWith("E_ADMISSION_REFUSED (code: admission_policy_missing): This team is not in the deployment's admission policy, and this aweb release can't add a team to it"));
});

for (const code of ["scope_refused", "profile_scope_refused", "profile_scope_ambiguous"]) {
  test(`acceptance 8: ${code} refuses E_ADMISSION_REFUSED naming the operator's binding, the root's did:aw and the team`, (t) => {
    const fx = attributionFixture(t);
    fx.fake.setService({ admit: { code } });
    const text = refusal(fx.spawn("dev-1"));
    assert.ok(text.startsWith(`E_ADMISSION_REFUSED (code: ${code}): `), text);
    assert.ok(text.includes(`ask the protected service's operator to run bind-root for this root (${ROOT_ID}) and ${TEAM}`), text);
    fits(text, 'README, "Human attribution: admission refusals")');
  });
}

test("acceptance 8: a receipt that stays unknown refuses E_ADMISSION_UNKNOWN with the operation id and team, and records the admission unknown", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ admit: { code: "receipt_unavailable" } });
  const text = refusal(fx.spawn("dev-1"));
  const record = admission(fx, "dev-1");
  assert.match(text, /^E_ADMISSION_UNKNOWN\b/);
  assert.ok(text.includes(`(operation ${record.operationId}, team ${TEAM})`), text);
  assert.equal(record.state, "unknown");
  fits(text, 'README, "Human attribution: admission refusals")');
});

// C-9 (v4.3.23, v4.3.24): aw's unconfirmed row, and any code in no row, never establish a refusal.
for (const code of ["prepare_unconfirmed", "prepare_answer_lost", "execute_answer_lost", "receipt_invalid", "handoff_result_invalid", "effect_in_progress", "evidence_unavailable", "service_unavailable", "handoff_http_429", "handoff_http_503", "signed_certificate_invalid", "signed_request_invalid", "a_code_aw_adds_later"]) {
  test(`acceptance 8, 12: ${code} at admit is E_ADMISSION_UNKNOWN, retried once under the same operation id, and the admission is recorded unknown`, (t) => {
    const fx = attributionFixture(t);
    fx.fake.setService({ admit: { code } });
    const text = refusal(fx.spawn("dev-1"));
    const record = admission(fx, "dev-1");
    assert.ok(text.startsWith(`E_ADMISSION_UNKNOWN (code: ${code}): `), text);
    assert.equal(record.state, "unknown");
    assert.deepEqual(admits(fx.fake).map(opOf), [record.operationId, record.operationId]);
  });
}

for (const code of ["operation_expired", "approval_expired", "operation_conflict"]) {
  test(`acceptance 8: ${code} refuses E_ADMISSION_REFUSED, never retried, and the admission is recorded refused`, (t) => {
    const fx = attributionFixture(t);
    fx.fake.setService({ admit: { code } });
    const text = refusal(fx.spawn("dev-1"));
    assert.ok(text.startsWith(`E_ADMISSION_REFUSED (code: ${code}): `), text);
    assert.equal(admission(fx, "dev-1").state, "refused");
    assert.equal(admits(fx.fake).length, 1);
    fits(text, 'README, "Human attribution: admission refusals")');
  });
}

test("acceptance 8: a retry after the execute's answer was lost gives one certificate under the same operation id", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ admit: { lostOnce: true } });
  const r = fx.spawn("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  const calls = admits(fx.fake);
  assert.equal(calls.length, 2);
  assert.equal(opOf(calls[0]), opOf(calls[1]));
  assert.equal(opOf(calls[0]), admission(fx, "dev-1").operationId);
  assert.deepEqual(Object.keys(fx.fake.charges()), [opOf(calls[0])]);
  assert.equal(admission(fx, "dev-1").state, "committed");
});

test("C-3b: the operation id is persisted, pending, before the admit runs", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ admit: { code: "subject_ineligible" } });
  refusal(fx.spawn("dev-1"));
  const record = admission(fx, "dev-1");
  assert.equal(opOf(admits(fx.fake)[0]), record.operationId);
  assert.equal(record.state, "refused");
});

test("C-3d: a refusal after the key exists reports the minted identity, so the kernel rolls the child back", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ admit: { code: "subject_ineligible" } });
  const r = fx.spawn("dev-1");
  assert.equal(r.status, 1);
  assert.equal(r.doc.meta.team, TEAM);
  assert.equal(r.doc.meta.alias, "dev-1");
});

test("C-3c: an install-cert code outside C-9's table refuses step install, with no retry", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ install: { code: "certificate_from_the_future" } });
  const text = refusal(fx.spawn("dev-1"));
  assert.ok(text.startsWith("E_ATTRIBUTION_EXCHANGE (step: install): "), text);
  assert.equal(fx.fake.calls().filter((c) => commandArgs(c.args).join(" ").startsWith("id team install-cert")).length, 1);
});

// Acceptance 12: aw's certificate_id becomes the root's copy's filename, so one with "/", ".",
// ".." or outside aw's id pattern refuses before anything is written from it.
const afterAdmit = (fx) => fx.fake.calls().map((c) => commandArgs(c.args).join(" ")).filter((v) => /^id team (install-cert|connect)|^init\b|^workspace /.test(v));
const rootAdmissions = (fx) => { try { return readdirSync(join(fx.rootHome, "admissions")); } catch { return []; } };
for (const id of ["../escape", "a/b", ".", "..", "not-a-uuid", "8B1C45E7-61AC-42D3-9544-E5303E6F2E7E"]) {
  test(`acceptance 12: an admitted certificate_id ${JSON.stringify(id)} refuses E_ATTRIBUTION_EXCHANGE step install before the root's copy, the install or the connect`, (t) => {
    const fx = attributionFixture(t);
    fx.fake.setService({ certificateId: id });
    const text = refusal(fx.spawn("dev-1"));
    assert.ok(text.startsWith("E_ATTRIBUTION_EXCHANGE (step: install): "), text);
    assert.deepEqual(rootAdmissions(fx), [], "no root copy");
    assert.ok(!existsSync(join(fx.rootHome, "escape.cert")), "nothing written outside admissions/");
    assert.deepEqual(afterAdmit(fx), [], "no install or connect");
  });
}

test("acceptance 12: an admitted certificate_id of aw's form is the root's copy's name, and the spawn admits", (t) => {
  const fx = attributionFixture(t);
  const id = "8b1c45e7-61ac-42d3-9544-e5303e6f2e7e";
  fx.fake.setService({ certificateId: id });
  const r = fx.spawn("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.deepEqual(rootAdmissions(fx), [`${id}.cert`]);
  assert.equal(admission(fx, "dev-1").certificateId, id);
});

test("C-3c: install-cert's registry_unavailable refuses E_ATTRIBUTION_EVIDENCE, worth a retry", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ install: { code: "registry_unavailable" } });
  assert.match(refusal(fx.spawn("dev-1")), /^E_ATTRIBUTION_EVIDENCE \(step: install\): /);
});

test("C-3d: an admission whose answer was lost, then refused by a requester-side code on the retry, refuses as C-9 says but stays unknown, and the rollback retire removes it", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ admit: { lostOnce: true, then: "scope_refused" } });
  const r = fx.hook("spawn", "dev-1");
  assert.ok(r.doc.warning.startsWith("oats-aweb: E_ADMISSION_REFUSED (code: scope_refused): "), r.doc.warning);
  assert.equal(admission(fx, "dev-1").state, "unknown", "the retry's refusal says nothing of the first send's outcome");
  fx.fake.setService({ admit: undefined });
  const retired = fx.retire("dev-1", { fromMeta: r.doc.meta });
  assert.equal(retired.status, 0, JSON.stringify(retired.doc) + retired.stderr);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), Object.values(fx.fake.charges()).map((c) => c.certificate_id));
});

test("C-3d: a lost answer then the operation's own final code on the retry still records refused", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ admit: { lostOnce: true, then: "subject_ineligible" } });
  fx.hook("spawn", "dev-1");
  assert.equal(admission(fx, "dev-1").state, "refused");
});
