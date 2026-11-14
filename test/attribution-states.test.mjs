// Every cell of lib/admission-states.md, run through the one transition
// function (spec v4.3.26 C-3, C-3d, C-5, C-6; the lead's decided cells, mail
// 18adc37d). The expected values are the table's, written out here: the
// end-to-end tests (attribution-admission, -retire, -join-leave, -reconcile)
// drive the same moves through the hook and a fake aw.
import assert from "node:assert/strict";
import test from "node:test";
import { admitAnswer, awaitsOutcome, holdsMembership, outcomeUnknown, shieldsCertificate, step } from "../oats-package/capabilities/oats-aweb/lib/admission-states.mjs";

/** [event, state, facts, the expected fields of step's answer]. */
const CELLS = [
  // A. Before admit: a spawn, a join and their rerun.
  ["begin", "none", { ours: false }, { to: "keyed", act: "create-key" }],
  ["begin", "keyed", { ours: false }, { to: "keyed", act: "create-key" }],
  ["begin", "refused", { ours: false }, { to: "keyed", act: "create-key" }],
  ["begin", "removed", { ours: false }, { to: "keyed", act: "create-key" }], // decided R
  ["begin", "pending", { ours: false }, { to: "pending", act: "refuse-other-key", exit: 1 }], // decided F
  ["begin", "unknown", { ours: false }, { to: "unknown", act: "refuse-other-key", exit: 1 }],
  ["begin", "committed", { ours: false }, { to: "committed", act: "refuse-other-key", exit: 1 }],
  ["begin", "keyed", { ours: true }, { to: "pending", act: "new-operation" }], // decided K
  ["begin", "refused", { ours: true }, { to: "pending", act: "new-operation" }], // decided Q
  ["begin", "pending", { ours: true, cert: false }, { to: "pending", act: "resend", sent: true }],
  ["begin", "unknown", { ours: true, cert: false }, { to: "unknown", act: "resend", sent: true }],
  ["begin", "pending", { ours: true, cert: true }, { to: "committed", act: "install" }], // decided P
  ["begin", "unknown", { ours: true, cert: true }, { to: "committed", act: "install" }], // decided P
  ["begin", "committed", { ours: true, cert: true }, { to: "committed", act: "install" }],
  ["begin", "committed", { ours: true, cert: false }, { to: "committed", act: "resend" }],
  // A. Admit's answer.
  ["admit", "pending", { answer: "committed" }, { to: "committed", act: "copy-and-install" }],
  ["admit", "committed", { answer: "committed" }, { to: "committed", act: "copy-and-install" }],
  ["admit", "pending", { answer: "unknown", attempt: 1 }, { to: "pending", act: "retry", sent: true }],
  ["admit", "pending", { answer: "requester", attempt: 1 }, { to: "pending", act: "retry", sent: true }],
  ["admit", "pending", { answer: "exists", attempt: 1 }, { to: "pending", act: "retry", sent: true }],
  ["admit", "pending", { answer: "unknown", attempt: 2, sent: true }, { to: "unknown", act: "refuse", exit: 1, write: true }],
  ["admit", "pending", { answer: "requester", attempt: 2, sent: true }, { to: "unknown", act: "refuse", exit: 1, write: true }],
  ["admit", "pending", { answer: "final", attempt: 1, sent: false }, { to: "refused", act: "refuse", exit: 1, write: true }],
  ["admit", "unknown", { answer: "final", attempt: 1, sent: true }, { to: "refused", act: "refuse", exit: 1, write: true }],
  ["admit", "pending", { answer: "requester-refused", attempt: 1, sent: false }, { to: "refused", act: "refuse", exit: 1, write: true }], // decided Q
  ["admit", "pending", { answer: "requester-refused", attempt: 1, sent: true }, { to: "unknown", act: "refuse", exit: 1, write: true }],
  ["admit", "unknown", { answer: "requester-refused", attempt: 2, sent: true }, { to: "unknown", act: "refuse", exit: 1, write: true }],
  ["admit", "committed", { answer: "final", attempt: 1 }, { to: "committed", act: "refuse", exit: 1, write: false }],
  ["admit", "committed", { answer: "requester-refused", attempt: 1 }, { to: "committed", act: "refuse", exit: 1, write: false }],
  ["admit", "committed", { answer: "unknown", attempt: 2, sent: true }, { to: "committed", act: "refuse", exit: 1, write: false }],
  // B. Retire's settle.
  ["settle", "pending", { cert: true, root: null }, { to: "committed", act: "mark-committed" }],
  ["settle", "unknown", { cert: true, root: null }, { to: "committed", act: "mark-committed" }],
  ["settle", "pending", { cert: false, root: null }, { to: "pending", act: "resume" }],
  ["settle", "unknown", { cert: false, root: null }, { to: "unknown", act: "resume" }],
  ["settle", "unknown", { cert: false, root: "root-home-unsafe" }, { to: "unknown", act: "keep", keep: true, exit: 1, warn: "root-home-unsafe" }],
  ["settle", "pending", { cert: false, root: "profile-changed" }, { to: "pending", act: "keep", keep: true, exit: 1, warn: "profile-changed" }],
  ["settle", "unknown", { cert: false, root: "root-revoked" }, { to: "unknown", act: "warn", warn: "root-revoked" }],
  ["settle", "pending", { cert: false, root: "root-home-missing" }, { to: "pending", act: "warn", warn: "root-home-missing" }],
  ["settle", "committed", { copy: false, rootHome: true }, { to: "committed", act: "restore-copy" }],
  ["settle", "committed", { copy: false, rootHome: false }, { to: "committed", act: "none" }],
  ["settle", "committed", { copy: true, rootHome: true }, { to: "committed", act: "none" }],
  ["settle", "none", {}, { to: "none", act: "none" }],
  ["settle", "keyed", {}, { to: "keyed", act: "none" }], // decided K
  ["settle", "refused", {}, { to: "refused", act: "none" }],
  ["settle", "removed", {}, { to: "removed", act: "none" }],
  // B. The resume's answer.
  ["resume", "unknown", { answer: "committed" }, { to: "committed", act: "copy" }],
  ["resume", "pending", { answer: "final" }, { to: "refused", act: "none" }],
  ["resume", "unknown", { answer: "requester-refused" }, { to: "unknown", act: "keep", keep: true, exit: 1, warn: "service-refused" }],
  ["resume", "unknown", { answer: "requester" }, { to: "unknown", act: "keep", keep: true, exit: 1, warn: "service-refused" }],
  ["resume", "unknown", { answer: "exists" }, { to: "unknown", act: "keep", keep: true, exit: 1, warn: "certificate-out-exists" }], // decided X
  ["resume", "pending", { answer: "unknown" }, { to: "pending", act: "keep", keep: true, exit: 1, warn: "admission-unknown" }],
  // C. Retire's remove, for a committed record.
  ["remove", "committed", { served: false, root: null, copy: true }, { to: "committed", act: "warn", warn: "admission-removal-unavailable" }],
  ["remove", "committed", { served: true, root: "root-revoked", copy: true }, { to: "committed", act: "warn", warn: "root-revoked" }],
  ["remove", "committed", { served: true, root: "root-home-missing", copy: true }, { to: "committed", act: "warn", warn: "root-home-missing" }],
  ["remove", "committed", { served: true, root: "root-home-unsafe", copy: true }, { to: "committed", act: "warn", warn: "root-home-unsafe" }],
  ["remove", "committed", { served: true, root: "profile-changed", copy: true }, { to: "committed", act: "warn", warn: "profile-changed" }],
  ["remove", "committed", { served: true, root: null, copy: false }, { to: "committed", act: "warn", warn: "root-copy-missing" }],
  ["remove", "committed", { served: true, root: null, copy: true }, { to: "committed", act: "remove" }],
  ["remove", "unknown", { served: true, root: null, copy: true }, { to: "unknown", act: "none" }],
  ["remove", "refused", { served: true }, { to: "refused", act: "none" }],
  // C. The removal's answer.
  ["removal", "committed", { answer: "removed" }, { to: "removed", act: "delete-copy" }],
  ["removal", "committed", { answer: "unavailable" }, { to: "committed", act: "warn", warn: "admission-removal-unavailable" }],
  ["removal", "committed", { answer: "unconfirmed" }, { to: "committed", act: "keep", keep: true, exit: 1, warn: "admission-removal-unconfirmed" }],
  ["removal", "committed", { answer: "refused" }, { to: "committed", act: "warn", warn: "service-refused" }],
  ["removal", "committed", { answer: "refused", resumed: true }, { to: "committed", act: "warn", warn: "service-refused" }], // decided S
  ["remove", "committed", { served: true, root: "root-home-unsafe", copy: true, resumed: true }, { to: "committed", act: "warn", warn: "root-home-unsafe" }], // decided S
  // D. A leave, once B and C kept nothing.
  ["leave", "removed", {}, { to: "removed", act: "delete-identity-and-certificate" }],
  ["leave", "committed", {}, { to: "committed", act: "delete-identity-and-set-aside" }], // decided L
  ["leave", "refused", {}, { to: "refused", act: "delete-identity" }],
  ["leave", "none", {}, { to: "none", act: "delete-identity" }],
  // E. A start, for a joined team no longer eligible (C-4: no protected call).
  ["start", "committed", {}, { to: "committed", act: "keep-joined" }],
  ["start", "unknown", {}, { to: "unknown", act: "keep-joined" }],
  ["start", "pending", {}, { to: "pending", act: "keep-joined" }],
  ["start", "refused", {}, { to: "refused", act: "keep-joined" }],
  ["start", "removed", {}, { to: "removed", act: "legacy-leave" }],
  ["start", "none", {}, { to: "none", act: "legacy-leave" }],
];

for (const [on, state, facts, expected] of CELLS) {
  test(`table ${on}: ${state} with ${JSON.stringify(facts)} → ${expected.to}, ${expected.act}`, () => {
    const got = step(on, state, facts);
    for (const [field, value] of Object.entries(expected)) assert.deepEqual(got[field], value, `${field}: ${JSON.stringify(got)}`);
    for (const field of ["keep", "exit", "warn", "sent", "write"]) if (!(field in expected)) assert.ok(!got[field], `no ${field}: ${JSON.stringify(got)}`);
  });
}

test("table: aw's admit codes, classed as C-9's admit column reads them", () => {
  const rows = [
    [undefined, "unknown"], ["", "unknown"],
    ...["admission_policy_missing", "policy_changed", "admission_limit_reached", "subject_ineligible", "operation_expired", "approval_expired"].map((c) => [c, "final"]),
    ...["scope_refused", "profile_scope_refused", "profile_scope_ambiguous", "operation_conflict"].map((c) => [c, "requester-refused"]),
    ...["signed_request_invalid", "authority_changed", "operation_mismatch"].map((c) => [c, "requester"]),
    ["certificate_out_exists", "exists"],
    ...["receipt_unavailable", "prepare_unconfirmed", "execute_answer_lost", "handoff_http_503", "a_code_aw_adds_later"].map((c) => [c, "unknown"]),
  ];
  for (const [code, expected] of rows) assert.equal(admitAnswer(code), expected, String(code));
  assert.equal(admitAnswer("scope_refused", { committed: true }), "committed");
});

test("table E: only a committed record holds a membership, only pending and unknown await an outcome, only unknown is admission-leaked", () => {
  const states = ["none", "keyed", "pending", "unknown", "committed", "refused", "removed"];
  assert.deepEqual(states.filter((state) => holdsMembership({ state })), ["committed"]);
  assert.deepEqual(states.filter((state) => awaitsOutcome({ state })), ["pending", "unknown"]);
  assert.deepEqual(states.filter((state) => outcomeUnknown({ state })), ["unknown"]);
  assert.equal(holdsMembership(null), false);
});

test("table E: a live home's committed, pending or unknown record keeps its certificate out of reconciliation, and one a leave set aside keeps nothing (decided L)", () => {
  const states = ["none", "keyed", "pending", "unknown", "committed", "refused", "removed"];
  assert.deepEqual(states.filter((state) => shieldsCertificate({ state })), ["pending", "unknown", "committed"]);
  assert.deepEqual(states.filter((state) => shieldsCertificate({ state }, { left: true })), []);
});

test("table: an event the table doesn't name is an error, never a guess", () => {
  assert.throws(() => step("renew", "committed"), /no such admission event/);
});
