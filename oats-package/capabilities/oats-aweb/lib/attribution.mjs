// Human attribution through an endorsed registered root (spec human-ids-acxy7
// v4.3.7). A deployment's human endorses one registered identity, the root,
// once, at setup; from then on the root issues the identities a person spawns,
// each chained agent issues its own descendants, and the root admits every new
// agent into the deployment's protected teams. aw signs and verifies every
// certificate; this module holds the provider's decisions about them and never
// holds key material.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";

/** A refusal of this feature: a code from C-9, a message that names the fix,
 *  and its details (key, problem, step, code, …). */
export const attributionError = (code, message, details) => Object.assign(new Error(message), { code, ...(details ? { details } : {}) });

/** The characters the kernel never stores or prints in text it did not write
 *  (OATS lib/refused-text.mjs): control characters, line and paragraph
 *  separators, bidi embeddings, overrides and isolates, U+200B, U+2060,
 *  U+FEFF and the tag characters. */
const REFUSED_TEXT = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF\u{E0000}-\u{E007F}]/u;
export const LABEL_MAX = 200;
/** A human's label, by the kernel's waiting-message rule: one line of 1 to
 *  200 characters with none of the refused characters, so it always displays. */
export const validLabel = (label) => typeof label === "string" && label.length > 0 && [...label].length <= LABEL_MAX && !REFUSED_TEXT.test(label);

const DID_AW = /^did:aw:\S+$/;
export const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A canonical aweb team id, name:namespace, lowercase, as aw's --team takes it. */
export const TEAM_ID = /^[a-z0-9][a-z0-9_-]*:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const absolutePath = (v) => typeof v === "string" && isAbsolute(v) && normalize(v) === v && !v.includes("\0");
export const SETTING_KEY = "settings.oats.aweb.attribution";
const SETTING_FIX = "rerun `oats aweb setup --endorse-root`, which writes it, or remove settings.oats.aweb.attribution from this deployment's oats-local.yaml";

/** settings.oats.aweb.attribution, host-only (C-1):
 *    root: {id, home}, human: {id, label}, service: {id, profile, profileDigest},
 *    teams: [team ids], endorsement: {operationId, policy: {version, digest}}.
 *  null when absent, which is today's behaviour; anything malformed refuses
 *  E_ATTRIBUTION_SETTING, naming the key. */
export function attributionSetting(settings = {}) {
  if (!object(settings) || !Object.hasOwn(settings, "attribution")) return null;
  const bad = (key, why) => { throw attributionError("E_ATTRIBUTION_SETTING", `settings.oats.aweb.${key} ${why} in oats-local.yaml → ${SETTING_FIX}`, { key: `settings.oats.aweb.${key}` }); };
  const exactly = (value, key, names) => {
    if (!object(value)) bad(key, `must be a mapping of ${names.join(", ")}`);
    for (const k of Object.keys(value)) if (!names.includes(k)) bad(`${key}.${k}`, `is not a key of ${key}; it takes ${names.join(", ")}`);
    for (const k of names) if (!Object.hasOwn(value, k)) bad(`${key}.${k}`, "is missing");
  };
  const { attribution: a } = settings;
  exactly(a, "attribution", ["root", "human", "service", "teams", "endorsement"]);
  exactly(a.root, "attribution.root", ["id", "home"]);
  exactly(a.human, "attribution.human", ["id", "label"]);
  exactly(a.service, "attribution.service", ["id", "profile", "profileDigest"]);
  exactly(a.endorsement, "attribution.endorsement", ["operationId", "policy"]);
  exactly(a.endorsement.policy, "attribution.endorsement.policy", ["version", "digest"]);
  if (typeof a.root.id !== "string" || !DID_AW.test(a.root.id)) bad("attribution.root.id", "must be the root's did:aw");
  if (!absolutePath(a.root.home)) bad("attribution.root.home", "must be the root home's absolute, normalized directory");
  if (typeof a.human.id !== "string" || !DID_AW.test(a.human.id)) bad("attribution.human.id", "must be the human's did:aw");
  if (!validLabel(a.human.label)) bad("attribution.human.label", `must be one line of 1 to ${LABEL_MAX} characters with no control character, line break or bidi control`);
  if (typeof a.service.id !== "string" || !a.service.id.trim() || REFUSED_TEXT.test(a.service.id)) bad("attribution.service.id", "must be the protected service's id");
  if (!absolutePath(a.service.profile)) bad("attribution.service.profile", "must be the protected profile's absolute, normalized path");
  if (typeof a.service.profileDigest !== "string" || !SHA256_DIGEST.test(a.service.profileDigest)) bad("attribution.service.profileDigest", "must be sha256: and 64 lowercase hex digits");
  if (!Array.isArray(a.teams) || !a.teams.length || !a.teams.every((t) => typeof t === "string" && TEAM_ID.test(t)) || new Set(a.teams).size !== a.teams.length) bad("attribution.teams", "must list each protected team (name:namespace) once, at least one");
  if (typeof a.endorsement.operationId !== "string" || !UUID.test(a.endorsement.operationId)) bad("attribution.endorsement.operationId", "must be the endorsement's lowercase UUID");
  if (!Number.isSafeInteger(a.endorsement.policy.version) || a.endorsement.policy.version < 1) bad("attribution.endorsement.policy.version", "must be a positive integer");
  if (typeof a.endorsement.policy.digest !== "string" || !SHA256_DIGEST.test(a.endorsement.policy.digest)) bad("attribution.endorsement.policy.digest", "must be sha256: and 64 lowercase hex digits");
  return {
    root: { id: a.root.id, home: a.root.home },
    human: { id: a.human.id, label: a.human.label },
    service: { id: a.service.id, profile: a.service.profile, profileDigest: a.service.profileDigest },
    teams: [...a.teams],
    endorsement: { operationId: a.endorsement.operationId, policy: { version: a.endorsement.policy.version, digest: a.endorsement.policy.digest } },
  };
}

// ---------------------------------------------------------------------------
// The protected profile (C-1, Pepe's side 8f5bc6a3): it pins the origins,
// registry and keys every protected call trusts, so whoever can rewrite it
// redirects every later endorse and admit.

/** The profile's problem, or null: a regular file, not a symlink, owned by
 *  the running user (`uid`) or by root, which group and others can't write.
 *  `key` names where the path came from (a flag or the setting's key). */
export function profileProblem(path, { key, uid = process.getuid() }) {
  const fail = (why) => attributionError("E_ATTRIBUTION_SETTING", `the protected profile ${path} (${key}) ${why}; it pins every origin and key a protected call trusts → have the service's operator provision it as a regular file, owned by you or by root, that only its owner can write`, { key, problem: "profile-mode", file: path });
  let s;
  try { s = lstatSync(path); } catch (e) { return fail(`can't be read (${e.code || "error"})`); }
  if (s.isSymbolicLink()) return fail("is a symlink");
  if (!s.isFile()) return fail("is not a regular file");
  if (s.uid !== uid && s.uid !== 0) return fail(`is owned by uid ${s.uid}, not by you or by root`);
  if (s.mode & 0o022) return fail(`is writable by ${s.mode & 0o020 ? "its group" : "others"} (mode ${(s.mode & 0o777).toString(8)})`);
  return null;
}

/** sha256:<hex> of the profile file's bytes, as setup records it. */
export const profileDigest = (path) => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
