// A spawned identity on an opted-in deployment (spec v4.3.10 C-3): its key,
// its chain, its admission by the root, the root's copy of the certificate,
// the install and the connect, and the refusals of each (C-3c, C-9). One call
// makes one identity: the primary, or a joined team's.
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { CHAINLESS, UUID, attributionError, issueChain } from "./attribution.mjs";
import { POLICY_CHANGE_SERVED, REMOVE_SERVED, admissionPolicyArgv, admitArgv, awJson, createLocalArgv, installCertArgv, serviceInitArgv } from "./protected-client.mjs";

/** The README section each spawn refusal names for what doesn't fit its 300 characters. */
export const README_ADMISSION = 'README, "Human attribution: admission refusals"';

// aw's admit codes (C-9's admit column).
export const UNKNOWN_CODES = new Set(["receipt_unavailable", "external_effect_unresolved", "registration_unconfirmed", "signed_certificate_invalid"]);
const SCOPE_CODES = new Set(["scope_refused", "profile_scope_refused", "profile_scope_ambiguous"]);
// install-cert's listed codes (C-9); any other refuses the same way, never retried.
const INSTALL_EVIDENCE = "registry_unavailable";

/** The first sentence of C-3c's admission_policy_missing text, keyed to the pinned aw (v4.3.7). */
export const policyMissingText = (team, root) => POLICY_CHANGE_SERVED
  ? `This team is not in the deployment's admission policy. Its owner must approve adding it (team.admission-policy.change, a live approval); then the operator runs bind-root for this root and ${team}.`
  : `This team is not in the deployment's admission policy, and this aweb release can't add a team to it: the policy stays as provisioned. Once aweb serves team.admission-policy.change, the team's owner approves adding it, and then the operator runs bind-root for this root (${root}) and ${team}.`;
/** C-3c's scope text: the team is in the policy and this root isn't bound for its controller. */
export const bindRootText = (team, root) => `ask the protected service's operator to run bind-root for this root (${root}) and ${team}`;
/** C-3's connect text, naming both causes. */
export const connectText = (url) => `check that the aweb service at ${url} is reachable; if the URL itself is wrong, rerun oats aweb setup --endorse-root --service <the correct url>`;
/** Retire and readiness while the pinned aw lacks team.agent.remove (C-5, C-6). */
export const REMOVAL_UNAVAILABLE = "admission-removal-unavailable — the pinned aw doesn't serve team.agent.remove yet, so this membership stays on the protected team: retiring an instance frees no admission slot";

/** The first sentence of a longer text: what a 300-character spawn refusal carries. */
const firstSentence = (text) => { const i = text.indexOf(". "); return i < 0 ? text : text.slice(0, i + 1); };

/** The refusal for aw's admit refusal `e` (an AwRefusal). `bounds()` reads the
 *  policy's bounds (or throws); `count` is OATS's own count of live homes
 *  holding a committed admission for the team. */
export function admitRefusal(e, { team, root, bounds, count, operationId }) {
  const code = e.awCode;
  if (!code || UNKNOWN_CODES.has(code)) return attributionError("E_ADMISSION_UNKNOWN", `the admission's outcome is unknown (operation ${operationId}, team ${team}), so this home is kept → retire it once the service answers (${README_ADMISSION})`, { code: code || null, operationId, team });
  if (code === "admission_limit_reached") {
    let b; try { b = bounds(); } catch { b = null; }
    const limits = b ? `max_active ${b.max_active}, max_per_window ${b.max_per_window} per ${b.rate_window_seconds} s` : "bounds unreadable";
    return attributionError("E_ADMISSION_LIMIT", `${team} is at its admission bounds (${limits}; OATS's count, not the server's: ${count} live) → ${REMOVE_SERVED ? "wait for the rate window, retire idle instances, or change the policy" : "wait for the rate window, or change the policy; retiring an instance frees no slot"}`, { code, team, bounds: b, oatsCount: count });
  }
  const refused = (text) => attributionError("E_ADMISSION_REFUSED", text, { code, team });
  if (code === "admission_policy_missing") return refused(`${firstSentence(policyMissingText(team, root))} (${team}; ${README_ADMISSION})`);
  if (SCOPE_CODES.has(code)) return refused(`this root likely isn't bound for ${team}'s controller → ${bindRootText(team, root)} (${README_ADMISSION})`);
  if (code === "policy_changed") return refused(`${team}'s admission policy changed since the endorsement → rerun \`oats aweb setup --endorse-root\` to refresh it, then rerun the spawn (${README_ADMISSION})`);
  return refused(`the protected service refused the admission to ${team} with ${code}, a final refusal among the contract's receipt codes (${README_ADMISSION})`);
}

/** aw's install-cert refusal (C-9): registry_unavailable is worth a retry,
 *  every other code refuses step install and is never retried. */
export function installRefusal(e) {
  if (e.awCode === INSTALL_EVIDENCE) return attributionError("E_ATTRIBUTION_EVIDENCE", `the registry couldn't be read to install the admitted certificate (${e.awCode}) → retry the spawn`, { code: e.awCode, step: "install" });
  return attributionError("E_ATTRIBUTION_EXCHANGE", `the admitted certificate couldn't be installed (${e.awCode || "no code"}) → respawn; the admission is retired with this home (${README_ADMISSION})`, { code: e.awCode || null, step: "install" });
}

// ---------------------------------------------------------------------------
// The admission's record in the new home, written before prepare (C-3 step 3).

export const admissionFile = (providerDir, label) => join(providerDir, `admission-${label}.json`);
export const certificateOutFile = (providerDir, label) => join(providerDir, `admission-${label}.cert`);
export function writePrivate(file, text) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}
export function readAdmission(providerDir, label) {
  try { return JSON.parse(readFileSync(admissionFile(providerDir, label), "utf8")); } catch { return null; }
}
export const recordAdmission = (providerDir, label, doc) => writePrivate(admissionFile(providerDir, label), `${JSON.stringify(doc, null, 2)}\n`);

/** The certificate id aw wrote in the --certificate-out file it verified,
 *  checked before it becomes a filename (v4.3.4): a lowercase UUID, and its
 *  copy's path stays under the root's admissions/. Throws step install. */
export function admittedCertificate(file, rootHome) {
  const bad = (why) => attributionError("E_ATTRIBUTION_EXCHANGE", `the admitted certificate ${why} → respawn (${README_ADMISSION})`, { step: "install" });
  let cert;
  try { cert = JSON.parse(readFileSync(file, "utf8")); } catch { throw bad(`at ${file} can't be read`); }
  const id = cert?.certificate_id;
  if (typeof id !== "string" || !UUID.test(id)) throw bad(`names a certificate id that isn't aw's form (${JSON.stringify(String(id).slice(0, 60))})`);
  const dir = join(rootHome, "admissions"), copy = resolve(dir, `${id}.cert`);
  const rel = relative(dir, copy);
  if (!rel || rel.startsWith("..") || rel.includes(sep)) throw bad("would be copied outside the root's admissions/");
  return { id, copy, text: readFileSync(file, "utf8"), team: cert.team_id, alias: cert.alias };
}

/** Writes the root's copy (0600) unless it is already there, byte for byte. */
export function keepRootCopy({ copy, text }) {
  if (existsSync(copy)) {
    let same = false;
    try { same = lstatSync(copy).isFile() && readFileSync(copy, "utf8") === text; } catch { same = false; }
    if (!same) throw attributionError("E_ATTRIBUTION_EXCHANGE", `the root's admissions/ already holds another file for this certificate (${copy}) → move it aside and respawn`, { step: "install" });
    return;
  }
  writePrivate(copy, text);
}

/** One identity of a spawn, on an opted-in deployment. `aw(argv, cwd, timeout)`
 *  runs aw; `plan` is chooseIssuer's; `registry` the profile's registry
 *  origin; `count()` OATS's count of committed admissions for the team.
 *  Returns {didKey, attribution, certificateId}, or throws a refusal; a
 *  refusal after the key exists carries `minted: true`. */
export function admitIdentity({ aw, setting, team, label, alias, identityHome, providerDir, plan, registry, count, instance, exchangeDir }) {
  const run = (argv, cwd, timeout) => aw(argv, cwd, timeout);
  const chainAw = (args) => aw(["aw", ...args], dirname(identityHome), 60000);
  const minted = (e) => Object.assign(e, { minted: true });
  // 1. The key (A5(b)): a rerun on the same key-only home answers already_exists.
  let key;
  try { key = awJson(run, "id create --local", createLocalArgv({ identityHome }), dirname(identityHome), 60000); }
  catch (e) {
    if (e.code) throw e;
    throw attributionError("E_ATTRIBUTION_EXCHANGE", `the new identity's key couldn't be created in ${identityHome} (${e.awCode || e.message}) → respawn into an empty home`, { step: "key", code: e.awCode || null });
  }
  if (!["created", "resumed", "already_exists"].includes(key.status) || typeof key.did_key !== "string" || !key.did_key.startsWith("did:key:")) throw attributionError("E_ATTRIBUTION_EXCHANGE", "aw id create --local answered no key → respawn", { step: "key" });
  try {
    // 2. The chain (C-3a): aw 1.36.58's exchange, local, between the issuer's home and this one.
    const attribution = plan.action === "issue" ? issueChain({ aw: chainAw, issuer: plan.issuer, identityHome, instance, setting, dir: exchangeDir }) : CHAINLESS;
    // 3. The admission (C-3b): its operation id persisted before prepare; a retry reuses it.
    let record = readAdmission(providerDir, label);
    if (!record || record.team !== team || record.state === "refused") {
      // The admit's inputs too, so a retire can resume an unknown outcome with C-3b's exact retry (C-3d).
      record = { team, label, alias, operationId: randomUUID(), state: "pending", identityHome, certificateOut: certificateOutFile(providerDir, label), memberKey: key.did_key, policy: setting.endorsement.policy, at: new Date().toISOString() };
      recordAdmission(providerDir, label, record);
    }
    const argv = admitArgv({ team, memberKey: key.did_key, alias, policy: record.policy ?? setting.endorsement.policy, operationId: record.operationId, certificateOut: record.certificateOut, profile: setting.service.profile });
    const bounds = () => awJson(run, "id team admission-policy", admissionPolicyArgv({ team, profile: setting.service.profile }), setting.root.home, 30000).policy.bounds;
    let admitted;
    for (let attempt = 1; ; attempt++) {
      try { admitted = awJson(run, "id team admit", argv, setting.root.home, 60000); break; }
      catch (e) {
        if (e.code) throw e;
        // An exact retry of an unknown outcome returns the original certificate, with no second charge.
        if (attempt < 2 && (!e.awCode || UNKNOWN_CODES.has(e.awCode))) continue;
        const refusal = admitRefusal(e, { team, root: setting.root.id, bounds, count: count(), operationId: record.operationId });
        recordAdmission(providerDir, label, { ...record, state: refusal.code === "E_ADMISSION_UNKNOWN" ? "unknown" : "refused", code: e.awCode || null });
        throw refusal;
      }
    }
    if (admitted.state !== "committed") throw attributionError("E_ADMISSION_UNKNOWN", `aw id team admit answered ${admitted.state}, operation ${record.operationId}, team ${team} → retire this home (${README_ADMISSION})`, { operationId: record.operationId, team });
    // The root's copy, written right after admit's verified certificate and before install.
    const cert = admittedCertificate(record.certificateOut, setting.root.home);
    keepRootCopy(cert);
    record = { ...record, state: "committed", certificateId: cert.id };
    recordAdmission(providerDir, label, record);
    // The install (A5(b)), its certificate_id the one the root keeps.
    let installed;
    try { installed = awJson(run, "id team install-cert", installCertArgv({ identityHome, certificate: record.certificateOut, registry }), dirname(identityHome), 60000); }
    catch (e) { if (e.code) throw e; throw installRefusal(e); }
    if (installed.certificate_id !== cert.id || installed.team_id !== team || installed.alias !== alias) throw attributionError("E_ATTRIBUTION_EXCHANGE", `aw installed certificate ${String(installed.certificate_id).slice(0, 40)} for ${String(installed.team_id).slice(0, 80)}, not the admitted ${cert.id} → respawn (${README_ADMISSION})`, { step: "install" });
    // The connect, to the recorded service URL.
    try { aw(["aw", ...serviceInitArgv({ identityHome, service: setting.service.url, team })], dirname(identityHome), 60000); }
    catch { throw attributionError("E_ATTRIBUTION_EXCHANGE", connectText(setting.service.url), { step: "connect", url: setting.service.url }); }
    return { didKey: key.did_key, attribution, certificateId: cert.id };
  } catch (e) { throw minted(e.code ? e : attributionError("E_ATTRIBUTION_EXCHANGE", `the spawn failed after its key was created: ${String(e.message || e).slice(0, 160)} → respawn`, { step: "verify" })); }
}
