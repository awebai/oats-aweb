// Retire on an opted-in deployment (spec v4.3.18 C-6, C-3d): each membership
// a home holds is removed by the root, through the protected controller
// (`team.agent.remove`, root mode), from the root's copy under admissions/;
// an unknown admission is resumed first. Retire is never blocked by a root
// that can't act: it warns `admission-removal-blocked`, keeps the membership
// and the root's copy, and the home goes. Only an outcome OATS can still learn
// (an unknown admission, an unconfirmed removal) keeps the home.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { README_ADMISSION, REMOVAL_UNAVAILABLE, admittedCertificate, keepRootCopy, providerRecords, recordsUnreadable, verifiedCertificate, writePrivate } from "./admission.mjs";
import { lockedRetireText, withAdmissionLocks } from "./admission-lock.mjs";
import { admitAnswer, awaitsOutcome, holdsMembership, step, unconfirmedCode } from "./admission-states.mjs";
import { profileDigest, profileProblem, readWho, rootHomeProblem } from "./attribution.mjs";
import { teamCertificateRelativePath } from "./aweb-team-id.mjs";
import { REMOVE_SERVED, admitArgv, awJson, removeAgentArgv } from "./protected-client.mjs";

export const RECONCILE = "oats aweb setup --reconcile-admissions";

// aw's remove-agent codes at aweb 44158f1bb (the hand-back lists this table).
// aw's handoff client names a refusal by the server's `detail` code, else
// `handoff_http_<status>` (cli/go/internal/handoff/client.go refusal()), so a
// server that doesn't serve the act is told apart by its HTTP status alone.
const NOT_SERVED = new Set(["handoff_http_404", "handoff_http_405", "handoff_http_501"]);

/** What a remove-agent refusal code means: "unavailable" (the server doesn't
 *  serve the act), "unconfirmed" (the outcome may still change), or
 *  "refused" (the service's final no). No code at all is unconfirmed. */
export function removeOutcome(code) {
  if (!code) return "unconfirmed";
  if (NOT_SERVED.has(code)) return "unavailable";
  if (unconfirmedCode(code)) return "unconfirmed";
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

/** Each admission record's removal record, beside it: admission-<x>.json's is removal-<x>.json. */
const removalFile = (providerDir, name) => join(providerDir, name.replace(/^admission-/, "removal-"));
/** Where a record a leave couldn't remove is kept (C-6): the joined identity went, and the record
 *  stays for retire and reconciliation, under a name no label can take ("~" is in none). */
export const leftAdmissionName = (label, certificateId) => `admission-${label}~left-${certificateId}.json`;
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
 *  retry; `memberships` [{team, label, removed}] once it needn't.
 *  `phase` "settle" only resumes unknown admissions and restores missing root copies, with no
 *  removal; "remove" then removes. A retire runs them around its workspace delete, which the
 *  member's certificate authenticates and the removal revokes (C-6). Without `phase`, both. */
export function retireAdmissions(options) {
  // Every label it acts on is locked before any is acted on (admission-lock.mjs): a live holder
  // means this retire acts on nothing, keeps the home and names the rerun, as an unconfirmed
  // removal does.
  const { providerDir } = options;
  const checked = checkedRecords(options);
  if (checked.keep) return { warnings: [], keep: checked.keep };
  const locked = [...new Set(checked.all.map((r) => r.label))].sort();
  try { return withAdmissionLocks(providerDir, locked, () => retireLocked(options)); }
  catch (e) {
    if (e?.details?.step !== "lock") throw e;
    return { warnings: [], keep: { reason: "admission-locked", text: lockedRetireText(e.details) } };
  }
}
/** The records a retire or a leave acts on, each one of the table's ({all, acted}), or {keep}: a
 *  record of its labels that can't be read, or isn't one of the table's, could hold any membership
 *  or operation, so this retire acts on nothing and keeps the home, naming it (records-unreadable).
 *  A leave acts on its own labels' records only (`labels`), set-aside ones aside; retire on every one. */
function checkedRecords({ providerDir, labels, then = "retire again" }) {
  const { records, unreadable } = providerRecords(providerDir);
  const bad = unreadable.find((u) => !labels || u.label === null || labels.includes(u.label));
  if (bad) { const e = recordsUnreadable(bad, then); return { keep: { reason: "records-unreadable", text: `${e.code} (problem: records-unreadable): ${e.message}` } }; }
  const all = labels ? records.filter((r) => labels.includes(r.label)) : records;
  return { all, acted: labels ? all.filter((r) => !r.left) : all };
}
function retireLocked(options) {
  const { aw, setting, providerDir, deployment, removeServed = REMOVE_SERVED, phase } = options;
  const warnings = [];
  // Read again under the locks: what this retire acts on is what no other command can change now.
  const checked = checkedRecords(options);
  if (checked.keep) return { warnings, keep: checked.keep };
  const finals = new Map(checked.acted.map(({ file, record }) => [file, record]));
  let root;
  const cannot = () => (root === undefined ? (root = rootCannotAct({ aw, setting, deployment })) : root);
  for (const { file, record: read } of checked.acted) {
    let record = read;
    const name = basename(file);
    const { team } = record;
    const save = (fields) => { record = { ...record, ...fields }; finals.set(file, record); writePrivate(file, `${JSON.stringify(record, null, 2)}\n`); };
    // Each move is admission-states.md's tables B and C, decided by `step`.
    if (awaitsOutcome(record)) {
      // A pending record is a spawn killed at its admit (v4.3.19); an unknown one, an admit whose
      // answer was lost. A --certificate-out file that verifies (aw's id form, this record's team
      // and member key) says the admission committed, before a root that can't act is asked anything.
      const cert = verifiedCertificate(record, setting.root.home);
      const blocked = cert ? null : cannot();
      const settle = step("settle", record.state, { cert: !!cert, root: blocked?.reason ?? null });
      if (settle.act === "mark-committed") save({ state: settle.to, certificateId: cert.id });
      else if (settle.act === "keep") return { warnings, keep: { reason: "admission-unknown", text: `${blocked.why} (${blocked.reason}), and the admission's outcome is unknown (operation ${record.operationId}, team ${team}), so this home is kept → fix the root, then retire again, which resumes the admission` } };
      else if (settle.act === "warn") { warnings.push(`admission-removal-blocked (reason: ${blocked.reason}, team ${team}): ${blocked.why}, and the admission's outcome is unknown (operation ${record.operationId}); nothing in OATS can resume it without the root's key, so a membership it made stays → check-only lists it under \`leakedMemberships\``); continue; }
      else {
        // C-3d: the same admit, its persisted operation id and inputs, from the root's home.
        let resumed;
        try { awJson(aw, "id team admit", admitArgv({ team, memberKey: record.memberKey, alias: record.alias, policy: record.policy, operationId: record.operationId, certificateOut: record.certificateOut, profile: setting.service.profile }), setting.root.home, 60000); resumed = step("resume", record.state, { answer: "committed" }); }
        catch (e) {
          if (e.code) throw e;
          // Only the operation's own final codes establish a refusal (v4.3.23, v4.3.24).
          const next = step("resume", record.state, { answer: admitAnswer(e.awCode) });
          if (next.to === "refused") { save({ state: next.to, code: e.awCode }); continue; }
          if (next.warn === "service-refused") return { warnings, keep: { reason: "admission-unknown", text: `the protected service refused the root's resume (${e.awCode}) (service-refused), and the admission's outcome is unknown (operation ${record.operationId}, team ${team}), so this home is kept → fix the root, then retire again, which resumes the admission` } };
          // The service holds this operation's certificate, and aw won't write it over another file.
          if (next.warn === "certificate-out-exists") return { warnings, keep: { reason: "admission-unknown", text: `the admission (operation ${record.operationId}, team ${team}) committed, but ${record.certificateOut} holds another file, so its certificate can't be read → move that file aside, then retire again, which resumes the admission` } };
          return { warnings, keep: { reason: "admission-unknown", text: stillUnknownText({ team, operationId: record.operationId }) } };
        }
        const admitted = admittedCertificate(record.certificateOut, setting.root.home);
        keepRootCopy(admitted);
        save({ state: resumed.to, certificateId: admitted.id });
      }
    }
    if (!holdsMembership(record)) continue;
    // The root's copy missing: written again from this home's certificate when it is the
    // one admitted, whenever the root home is there, so a removal blocked below stays
    // reconcilable. The home holds it twice: admit's --certificate-out file, and the copy
    // aw installed in the identity. With neither, nothing left can remove the membership.
    const copy = join(setting.root.home, "admissions", `${record.certificateId}.cert`);
    let copyMissing = false;
    if (step("settle", record.state, { copy: existsSync(copy), rootHome: existsSync(join(setting.root.home, ".aw")) }).act === "restore-copy") {
      const installedFile = typeof record.identityHome === "string" && teamCertificateRelativePath(team) ? join(record.identityHome, teamCertificateRelativePath(team)) : null;
      const theOne = (file) => {
        let cert = null;
        try { cert = typeof file === "string" && existsSync(file) ? admittedCertificate(file, setting.root.home) : null; } catch { cert = null; }
        return cert && cert.id === record.certificateId && cert.team === team && (!record.memberKey || cert.memberKey === record.memberKey) ? cert : null;
      };
      const cert = theOne(record.certificateOut) || theOne(installedFile);
      if (cert) { try { keepRootCopy(cert); } catch { copyMissing = true; } }
      else copyMissing = true;
    }
    if (phase === "settle") continue;
    const blocked = removeServed ? cannot() : null;
    const remove = step("remove", record.state, { served: removeServed, root: blocked?.reason ?? null, copy: !copyMissing });
    if (remove.warn === "admission-removal-unavailable") { warnings.push(`${REMOVAL_UNAVAILABLE} (team ${team})`); continue; }
    if (remove.warn === "root-copy-missing") { warnings.push(blockedText({ reason: "root-copy-missing", why: `the root's copy ${copy} is gone, and this home's certificate doesn't carry ${record.certificateId}`, team })); continue; }
    if (remove.act === "warn") { warnings.push(blockedText({ reason: blocked.reason, why: blocked.why, team })); continue; }
    const done = removeMembership({ aw, setting, certificateId: record.certificateId, team, file: removalFile(providerDir, name) });
    const after = step("removal", record.state, { answer: done.outcome });
    if (after.to === "removed") { save({ state: after.to }); continue; }
    if (after.warn === "admission-removal-unavailable") { warnings.push(notServedText({ code: done.code, team })); continue; }
    if (after.warn === "admission-removal-unconfirmed") return { warnings, keep: { reason: "admission-removal-unconfirmed", text: unconfirmedText({ team, operationId: done.operationId, code: done.code }) } };
    warnings.push(blockedText({ reason: "service-refused", why: `the protected service refused the removal (${done.code})`, team }));
  }
  // Each team this home was admitted to, and whether the root removed it: the
  // membership, not the workspace delete, says whether the alias is free.
  const memberships = [...finals.values()].filter((r) => holdsMembership(r) || r.state === "removed").map(({ team, label, state }) => ({ team, label, removed: state === "removed" }));
  return { warnings, keep: null, memberships };
}
