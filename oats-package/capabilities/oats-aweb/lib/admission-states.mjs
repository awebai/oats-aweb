// The states of an opted-in home's admission records, and every move between
// them (spec human-ids-acxy7 C-3, C-3d, C-5, C-6; the table is
// admission-states.md beside this file). Every path that reads or writes a
// record asks `step` what comes next: admit at spawn and join, retire's settle
// and remove phases, leave and start. `step` decides and does nothing: the
// caller runs aw, writes files and keeps or removes the home as it answers.

/** The operation's own final codes: they establish the operation was refused (C-3d). */
export const FINAL_CODES = new Set(["admission_policy_missing", "policy_changed", "admission_limit_reached", "subject_ineligible", "operation_expired", "approval_expired"]);
export const SCOPE_CODES = new Set(["scope_refused", "profile_scope_refused", "profile_scope_ambiguous"]);
/** Requester-side codes C-9 refuses at a first send. */
const REQUESTER_REFUSED = new Set([...SCOPE_CODES, "operation_conflict"]);
/** Requester-side codes in no row of C-9's admit column: unknown at a first send. */
const REQUESTER_OTHER = new Set(["signed_request_invalid", "authority_changed", "operation_mismatch"]);
/** The root can't act for a reason that can be fixed: an outcome OATS can still learn keeps the home. */
export const FIXABLE = new Set(["root-home-unsafe", "profile-changed", "service-refused"]);

/** aw's admit answer, classed: "committed", "final", "requester-refused" (refused at a first send),
 *  "requester" (unknown at a first send), "exists" (certificate_out_exists) or "unknown". */
export function admitAnswer(code, { committed = false } = {}) {
  if (committed) return "committed";
  if (!code) return "unknown";
  if (FINAL_CODES.has(code)) return "final";
  if (REQUESTER_REFUSED.has(code)) return "requester-refused";
  if (REQUESTER_OTHER.has(code)) return "requester";
  if (code === "certificate_out_exists") return "exists";
  return "unknown";
}

/** What comes next. `on` names the event, `state` the record's state ("none" for no record),
 *  `facts` what the caller read. Returns {to, act, exit?, keep?, warn?}: `to` the record's next
 *  state (unchanged when it is `state`), `act` what the caller does now, `keep` true when the
 *  home (or a leave's joined identity) must stay, `warn` the warning's reason, `write` whether a
 *  failed admit writes the record, `sent` whether the operation may now have been sent. */
export function step(on, state, facts = {}) {
  const same = { to: state };
  switch (on) {
    // A: before admit, at a spawn, a join and their rerun. facts: {ours, cert}
    case "begin": {
      if (!facts.ours) return ["pending", "unknown", "committed"].includes(state) ? { ...same, act: "refuse-other-key", exit: 1 } : { to: "keyed", act: "create-key" };
      if (state === "keyed" || state === "refused") return { to: "pending", act: "new-operation" };
      // A verified --certificate-out is a signed result: committed, at every resume (decided P).
      if (state === "pending" || state === "unknown") return facts.cert ? { to: "committed", act: "install" } : { ...same, act: "resend", sent: true };
      if (state === "committed") return facts.cert ? { ...same, act: "install" } : { ...same, act: "resend" };
      return { to: "keyed", act: "create-key" };
    }
    // A: admit's answer. facts: {answer, attempt, sent}; `state` is the record's before admit.
    case "admit": {
      if (facts.answer === "committed") return { to: "committed", act: "copy-and-install" };
      if (facts.attempt < 2 && ["requester", "exists", "unknown"].includes(facts.answer)) return { ...same, act: "retry", sent: true };
      // A committed admission stays committed: nothing a retry of it answers undoes it.
      if (state === "committed") return { ...same, act: "refuse", exit: 1, write: false };
      const refused = facts.answer === "final" || (facts.answer === "requester-refused" && !facts.sent);
      return { to: refused ? "refused" : "unknown", act: "refuse", exit: 1, write: true };
    }
    // B: retire's settle, before any delete. facts: {cert, root (null or a reason), rootHome, copy}
    case "settle": {
      if (state === "pending" || state === "unknown") {
        if (facts.cert) return { to: "committed", act: "mark-committed" };
        if (facts.root && FIXABLE.has(facts.root)) return { ...same, act: "keep", keep: true, exit: 1, warn: facts.root };
        if (facts.root) return { ...same, act: "warn", warn: facts.root };
        return { ...same, act: "resume" };
      }
      if (state === "committed") return !facts.copy && facts.rootHome ? { ...same, act: "restore-copy" } : { ...same, act: "none" };
      return { ...same, act: "none" };
    }
    // B: the resume's answer.
    case "resume": {
      if (facts.answer === "committed") return { to: "committed", act: "copy" };
      if (facts.answer === "final") return { to: "refused", act: "none" };
      if (facts.answer === "requester" || facts.answer === "requester-refused") return { ...same, act: "keep", keep: true, exit: 1, warn: "service-refused" };
      return { ...same, act: "keep", keep: true, exit: 1, warn: facts.answer === "exists" ? "certificate-out-exists" : "admission-unknown" };
    }
    // C: retire's remove, for a committed record, however it committed: a resume that committed
    // is committed (C-3d "as committed above"; decided S). facts: {served, root, copy}
    case "remove": {
      if (state !== "committed") return { ...same, act: "none" };
      if (!facts.served) return { ...same, act: "warn", warn: "admission-removal-unavailable" };
      if (facts.root) return { ...same, act: "warn", warn: facts.root };
      if (!facts.copy) return { ...same, act: "warn", warn: "root-copy-missing" };
      return { ...same, act: "remove" };
    }
    // C: the removal's answer. facts: {answer: "removed"|"unavailable"|"unconfirmed"|"refused"}
    case "removal": {
      if (facts.answer === "removed") return { to: "removed", act: "delete-copy" };
      if (facts.answer === "unavailable") return { ...same, act: "warn", warn: "admission-removal-unavailable" };
      if (facts.answer === "unconfirmed") return { ...same, act: "keep", keep: true, exit: 1, warn: "admission-removal-unconfirmed" };
      return { ...same, act: "warn", warn: "service-refused" };
    }
    // D: a leave, once B and C kept nothing: what becomes of the joined identity and the record.
    case "leave": {
      if (state === "removed") return { ...same, act: "delete-identity-and-certificate" };
      if (state === "committed") return { ...same, act: "delete-identity-and-set-aside" };
      return { ...same, act: "delete-identity" };
    }
    // E: a start, for a joined team that is no longer eligible (C-4: no protected call).
    case "start":
      return state !== "none" && state !== "removed" ? { ...same, act: "keep-joined" } : { ...same, act: "legacy-leave" };
    default:
      throw new Error(`no such admission event: ${on}`);
  }
}

/** Whether a record counts as a membership OATS holds: OATS's count, and check-only's reader. */
export const holdsMembership = (record) => record?.state === "committed";
/** Whether a record awaits its admission's outcome: retire settles it first (table B). */
export const awaitsOutcome = (record) => record?.state === "pending" || record?.state === "unknown";
/** Whether a record's outcome is unknown: readiness's `admission-leaked`. */
export const outcomeUnknown = (record) => record?.state === "unknown";
