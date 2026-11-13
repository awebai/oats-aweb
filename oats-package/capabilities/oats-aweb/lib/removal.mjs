// Retire on an opted-in deployment (spec v4.3.18 C-6, C-3d): each membership
// a home holds is removed by the root, through the protected controller
// (`team.agent.remove`, root mode), from the root's copy under admissions/;
// an unknown admission is resumed first. Retire is never blocked by a root
// that can't act: it warns `admission-removal-blocked`, keeps the membership
// and the root's copy, and the home goes. Only an outcome OATS can still learn
// (an unknown admission, an unconfirmed removal) keeps the home.
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { README_ADMISSION, REMOVAL_UNAVAILABLE, UNKNOWN_CODES, admittedCertificate, keepRootCopy, recordAdmission, writePrivate } from "./admission.mjs";
import { profileDigest, profileProblem, readWho, rootHomeProblem } from "./attribution.mjs";
import { REMOVE_SERVED, admitArgv, awJson, removeAgentArgv } from "./protected-client.mjs";

export const RECONCILE = "oats aweb setup --reconcile-admissions";

// aw's remove-agent codes at aweb 44158f1bb (the hand-back lists this table).
// aw's handoff client names a refusal by the server's `detail` code, else
// `handoff_http_<status>` (cli/go/internal/handoff/client.go refusal()), so a
// server that doesn't serve the act is told apart by its HTTP status alone.
const NOT_SERVED = new Set(["handoff_http_404", "handoff_http_405", "handoff_http_501"]);
const UNCONFIRMED = new Set(["receipt_unavailable", "external_effect_unresolved", "prepare_unconfirmed", "execute_answer_lost", "effect_in_progress", "evidence_unavailable", "handoff_http_429"]);

/** What a remove-agent refusal code means: "unavailable" (the server doesn't
 *  serve the act), "unconfirmed" (the outcome may still change), or
 *  "refused" (the service's final no). No code at all is unconfirmed. */
export function removeOutcome(code) {
  if (!code) return "unconfirmed";
  if (NOT_SERVED.has(code)) return "unavailable";
  if (UNCONFIRMED.has(code) || /_unavailable$/.test(code) || /^handoff_http_5\d\d$/.test(code)) return "unconfirmed";
  return "refused";
}

const FIX_ROOT = `fix the root, then run \`${RECONCILE}\``;
/** What to do for each reason the root can't act (C-6). */
export const BLOCKED_FIX = {
  "root-home-missing": FIX_ROOT,
  "root-home-unsafe": FIX_ROOT,
  "profile-changed": FIX_ROOT,
  "service-refused": FIX_ROOT,
  "root-revoked": "no OATS path removes this membership in v1; it counts only in the revoked root's bucket, never in the new root's",
  "root-copy-missing": "no certificate for this membership is left, so OATS can't remove it; check-only lists it under `leakedMemberships`",
};
/** The reasons a retire that resumes an unknown admission keeps the home for. */
const FIXABLE = new Set(["root-home-unsafe", "profile-changed", "service-refused"]);

export const blockedText = ({ reason, why, team }) => `admission-removal-blocked (reason: ${reason}, team ${team}): ${why}; the membership is kept → ${BLOCKED_FIX[reason]}`;
export const notServedText = ({ code, team }) => `admission-removal-unavailable (team ${team}): the service's server answered ${code} to team.agent.remove, so it may not serve removal yet; the membership is kept → its operator upgrades the server, then run \`${RECONCILE}\``;
const unconfirmedText = ({ team, operationId, code }) => `the removal of ${team}'s membership wasn't confirmed (operation ${operationId}, ${code || "no code"}), so this home is kept → retire it again once the service answers, or run \`${RECONCILE}\``;
const stillUnknownText = ({ team, operationId }) => `the admission's outcome is unknown (operation ${operationId}, team ${team}), so this home is kept → retire it again once the service answers (${README_ADMISSION})`;

/** Why the root can't act now, or null: {reason, why}. Read once per retire. */
export function rootCannotAct({ aw, setting, deployment }) {
  const home = setting.root.home;
  if (!existsSync(join(home, ".aw"))) return { reason: "root-home-missing", why: `the root home ${home} is gone` };
  if (!deployment) return { reason: "root-home-unsafe", why: "the root home's deployment can't be confirmed" };
  const unsafe = rootHomeProblem(home, { deployment });
  if (unsafe) return { reason: "root-home-unsafe", why: `the root home ${home} fails its safety rules (${unsafe.details?.problem})` };
  const profile = setting.service.profile;
  let changed;
  try { changed = !!profileProblem(profile, { key: "settings.oats.aweb.attribution.service.profile" }) || profileDigest(profile) !== setting.service.profileDigest; } catch { changed = true; }
  if (changed) return { reason: "profile-changed", why: `the protected profile ${profile} doesn't match the one setup recorded` };
  // An unreadable verdict isn't a reason: the service decides, and says so.
  if (readWho((args) => aw(["aw", ...args], home, 30000), join(home, ".aw")).kind === "revoked") return { reason: "root-revoked", why: "the root's endorsement is revoked" };
  return null;
}

const removalFile = (providerDir, label) => join(providerDir, `removal-${label}.json`);
const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };

/** One removal, from the root's home: `{operation_id, state, certificate_id}`
 *  committed, or a refusal's outcome. The UUID is persisted at `file` before
 *  prepare, and a retry of the same certificate reuses it. */
export function removeMembership({ aw, setting, certificateId, team, file }) {
  let op = readJson(file);
  if (!op || op.certificateId !== certificateId) {
    op = { team, certificateId, operationId: randomUUID(), state: "pending", at: new Date().toISOString() };
    writePrivate(file, `${JSON.stringify(op, null, 2)}\n`);
  }
  const copy = join(setting.root.home, "admissions", `${certificateId}.cert`);
  let answer;
  try { answer = awJson(aw, "id team remove-agent", removeAgentArgv({ certificate: copy, operationId: op.operationId, profile: setting.service.profile }), setting.root.home, 60000); }
  catch (e) {
    if (e.code) throw e;
    return { outcome: removeOutcome(e.awCode), code: e.awCode || null, operationId: op.operationId };
  }
  if (answer?.state !== "committed" || answer.certificate_id !== certificateId) return { outcome: "unconfirmed", code: `state ${String(answer?.state).slice(0, 40)}`, operationId: op.operationId };
  rmSync(copy, { force: true });
  writePrivate(file, `${JSON.stringify({ ...op, state: "committed" }, null, 2)}\n`);
  return { outcome: "removed", operationId: op.operationId };
}

/** Retire's part for every admission recorded in `providerDir`. `aw(argv,
 *  cwd, timeout)` runs aw and returns its stdout. Returns {warnings, keep,
 *  memberships}: `keep` is {reason, text} when the home must stay for a
 *  retry; `memberships` [{team, label, removed}] once it needn't. */
export function retireAdmissions({ aw, setting, providerDir, deployment, removeServed = REMOVE_SERVED }) {
  const warnings = [];
  let names = [];
  try { names = readdirSync(providerDir).filter((f) => /^admission-.+\.json$/.test(f)).sort(); } catch { names = []; }
  let root;
  const cannot = () => (root === undefined ? (root = rootCannotAct({ aw, setting, deployment })) : root);
  for (const name of names) {
    let record = readJson(join(providerDir, name));
    if (!record || typeof record.label !== "string") continue;
    const { team, label } = record;
    const save = (fields) => { record = { ...record, ...fields }; recordAdmission(providerDir, label, record); };
    let resumed = false;
    // A pending record is a spawn killed at its admit (v4.3.19). With a --certificate-out file
    // that verifies (aw's id form, this record's team and member key) the admission committed;
    // with none, its outcome is unknown, and it is resumed as an unknown one is.
    if (record.state === "pending") {
      let cert = null;
      try { cert = typeof record.certificateOut === "string" && existsSync(record.certificateOut) ? admittedCertificate(record.certificateOut, setting.root.home) : null; } catch { cert = null; }
      if (cert && cert.team === team && cert.memberKey === record.memberKey) save({ state: "committed", certificateId: cert.id });
    }
    if (record.state === "unknown" || record.state === "pending") {
      // C-3d: the same admit, its persisted operation id and inputs, from the root's home.
      const blocked = cannot();
      if (blocked && FIXABLE.has(blocked.reason)) return { warnings, keep: { reason: "admission-unknown", text: `${blocked.why} (${blocked.reason}), and the admission's outcome is unknown (operation ${record.operationId}, team ${team}), so this home is kept → fix the root, then retire again, which resumes the admission` } };
      if (blocked) { warnings.push(`admission-removal-blocked (reason: ${blocked.reason}, team ${team}): ${blocked.why}, and the admission's outcome is unknown (operation ${record.operationId}); nothing in OATS can resume it without the root's key, so a membership it made stays → check-only lists it under \`leakedMemberships\``); continue; }
      try { awJson(aw, "id team admit", admitArgv({ team, memberKey: record.memberKey, alias: record.alias, policy: record.policy, operationId: record.operationId, certificateOut: record.certificateOut, profile: setting.service.profile }), setting.root.home, 60000); }
      catch (e) {
        if (e.code) throw e;
        if (!e.awCode || UNKNOWN_CODES.has(e.awCode)) return { warnings, keep: { reason: "admission-unknown", text: stillUnknownText({ team, operationId: record.operationId }) } };
        // The service holds this operation's certificate, and aw won't write it over another file.
        if (e.awCode === "certificate_out_exists") return { warnings, keep: { reason: "admission-unknown", text: `the admission (operation ${record.operationId}, team ${team}) committed, but ${record.certificateOut} holds another file, so its certificate can't be read → move that file aside, then retire again, which resumes the admission` } };
        save({ state: "refused", code: e.awCode });
        continue;
      }
      const cert = admittedCertificate(record.certificateOut, setting.root.home);
      keepRootCopy(cert);
      save({ state: "committed", certificateId: cert.id });
      resumed = true;
    }
    if (record.state !== "committed") continue;
    // The root's copy missing: written again from this home's certificate when it is the
    // one admitted, whenever the root home is there, so a removal blocked below stays
    // reconcilable. With neither, nothing left can remove the membership.
    const copy = join(setting.root.home, "admissions", `${record.certificateId}.cert`);
    let copyMissing = false;
    if (!existsSync(copy) && existsSync(join(setting.root.home, ".aw"))) {
      let cert = null;
      try { cert = admittedCertificate(record.certificateOut, setting.root.home); } catch { cert = null; }
      if (cert && cert.id === record.certificateId) { try { keepRootCopy(cert); } catch { copyMissing = true; } }
      else copyMissing = true;
    }
    if (!removeServed) { warnings.push(`${REMOVAL_UNAVAILABLE} (team ${team})`); continue; }
    const blocked = cannot();
    const block = ({ reason, why }) => {
      if (resumed && FIXABLE.has(reason)) return { reason: "admission-unknown", text: `${why} (${reason}); the resumed admission committed and its removal didn't, so this home is kept → fix the root, then retire again, which resumes the admission` };
      warnings.push(blockedText({ reason, why, team }));
      return null;
    };
    if (blocked) { const keep = block(blocked); if (keep) return { warnings, keep }; continue; }
    if (copyMissing) { warnings.push(blockedText({ reason: "root-copy-missing", why: `the root's copy ${copy} is gone, and this home's certificate doesn't carry ${record.certificateId}`, team })); continue; }
    const done = removeMembership({ aw, setting, certificateId: record.certificateId, team, file: removalFile(providerDir, label) });
    if (done.outcome === "removed") { save({ state: "removed" }); continue; }
    if (done.outcome === "unavailable") { warnings.push(notServedText({ code: done.code, team })); continue; }
    if (done.outcome === "unconfirmed") return { warnings, keep: { reason: "admission-removal-unconfirmed", text: unconfirmedText({ team, operationId: done.operationId, code: done.code }) } };
    const keep = block({ reason: "service-refused", why: `the protected service refused the removal (${done.code})` });
    if (keep) return { warnings, keep };
  }
  // Each team this home was admitted to, and whether the root removed it: the
  // membership, not the workspace delete, says whether the alias is free.
  const memberships = names.map((name) => readJson(join(providerDir, name))).filter((r) => r && (r.state === "committed" || r.state === "removed")).map(({ team, label, state }) => ({ team, label, removed: state === "removed" }));
  return { warnings, keep: null, memberships };
}
