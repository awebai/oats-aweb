// Human attribution through an endorsed registered root (spec human-ids-acxy7
// v4.3.7). A deployment's human endorses one registered identity, the root,
// once, at setup; from then on the root issues the identities a person spawns,
// each chained agent issues its own descendants, and the root admits every new
// agent into the deployment's protected teams. aw signs and verifies every
// certificate; this module holds the provider's decisions about them and never
// holds key material.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { REQUEST_BINDING_SERVED } from "./protected-client.mjs";
import { canonicalTeamServerURL } from "./team-server-url.mjs";

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
 *    root: {id, home}, human: {id, label}, service: {id, profile, profileDigest, url},
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
  exactly(a.service, "attribution.service", ["id", "profile", "profileDigest", "url"]);
  exactly(a.endorsement, "attribution.endorsement", ["operationId", "policy"]);
  exactly(a.endorsement.policy, "attribution.endorsement.policy", ["version", "digest"]);
  if (typeof a.root.id !== "string" || !DID_AW.test(a.root.id)) bad("attribution.root.id", "must be the root's did:aw");
  if (!absolutePath(a.root.home)) bad("attribution.root.home", "must be the root home's absolute, normalized directory");
  if (typeof a.human.id !== "string" || !DID_AW.test(a.human.id)) bad("attribution.human.id", "must be the human's did:aw");
  if (!validLabel(a.human.label)) bad("attribution.human.label", `must be one line of 1 to ${LABEL_MAX} characters with no control character, line break or bidi control`);
  if (typeof a.service.id !== "string" || !a.service.id.trim() || REFUSED_TEXT.test(a.service.id)) bad("attribution.service.id", "must be the protected service's id");
  if (!absolutePath(a.service.profile)) bad("attribution.service.profile", "must be the protected profile's absolute, normalized path");
  if (typeof a.service.profileDigest !== "string" || !SHA256_DIGEST.test(a.service.profileDigest)) bad("attribution.service.profileDigest", "must be sha256: and 64 lowercase hex digits");
  if (typeof a.service.url !== "string" || canonicalTeamServerURL(a.service.url).url !== a.service.url) bad("attribution.service.url", "must be the aweb coordination server's canonical URL (https outside loopback, no query, fragment or trailing slash)");
  if (!Array.isArray(a.teams) || !a.teams.length || !a.teams.every((t) => typeof t === "string" && TEAM_ID.test(t)) || new Set(a.teams).size !== a.teams.length) bad("attribution.teams", "must list each protected team (name:namespace) once, at least one");
  if (typeof a.endorsement.operationId !== "string" || !UUID.test(a.endorsement.operationId)) bad("attribution.endorsement.operationId", "must be the endorsement's lowercase UUID");
  if (!Number.isSafeInteger(a.endorsement.policy.version) || a.endorsement.policy.version < 1) bad("attribution.endorsement.policy.version", "must be a positive integer");
  if (typeof a.endorsement.policy.digest !== "string" || !SHA256_DIGEST.test(a.endorsement.policy.digest)) bad("attribution.endorsement.policy.digest", "must be sha256: and 64 lowercase hex digits");
  return {
    root: { id: a.root.id, home: a.root.home },
    human: { id: a.human.id, label: a.human.label },
    service: { id: a.service.id, profile: a.service.profile, profileDigest: a.service.profileDigest, url: a.service.url },
    teams: [...a.teams],
    endorsement: { operationId: a.endorsement.operationId, policy: { version: a.endorsement.policy.version, digest: a.endorsement.policy.digest } },
  };
}

/** The fields a setup refresh never rewrites, by the key that names each. */
const FIXED_AT_SPAWN = {
  "attribution.root.id": (a) => a.root.id,
  "attribution.root.home": (a) => a.root.home,
  "attribution.human.id": (a) => a.human.id,
  "attribution.human.label": (a) => a.human.label,
  "attribution.service.id": (a) => a.service.id,
  "attribution.service.url": (a) => a.service.url,
  "attribution.service.profile": (a) => a.service.profile,
  "attribution.service.profileDigest": (a) => a.service.profileDigest,
  "attribution.endorsement.operationId": (a) => a.endorsement.operationId,
};
/** What an existing home's own join admits under (acceptance 18, 22): `captured`, the setting the
 *  home was spawned with, with the teams and the endorsement's policy of `live`, the deployment's
 *  setting now: what `setup --endorse-root`'s refresh rewrites, and nothing else. Every other field
 *  must equal the captured one, or this refuses `setting-diverged`, naming the key: the home's
 *  retire still acts with its captured root, service and profile, and a changed profile takes a new
 *  setup and respawned homes (C-1). Both are attributionSetting's answers; `live` may be null. */
export function joinSetting(captured, live) {
  const respawn = (why, key) => attributionError("E_ATTRIBUTION_SETTING", `${why} → respawn this home to use the current setting`, { problem: "setting-diverged", ...(key ? { key: `settings.oats.aweb.${key}` } : {}) });
  if (!live) throw respawn("the deployment's live settings carry no attribution, and this home was spawned with it");
  for (const [key, field] of Object.entries(FIXED_AT_SPAWN)) {
    if (field(live) !== field(captured)) throw respawn(`the deployment's live settings.oats.aweb.${key} differs from the one this home was spawned with`, key);
  }
  return { ...captured, teams: [...live.teams], endorsement: { ...captured.endorsement, policy: { ...live.endorsement.policy } } };
}

// ---------------------------------------------------------------------------
// The protected profile (C-1, Pepe's side 8f5bc6a3): it pins the origins,
// registry and keys every protected call trusts, so whoever can rewrite it
// redirects every later endorse and admit.

/** The profile's problem, or null: a regular file, not a symlink, owned by
 *  the running user (`uid`) or by root, which group and others can't write.
 *  `key` names where the path came from (a flag or the setting's key). */
export function profileProblem(path, { key, uid = process.getuid() }) {
  const fail = (why) => attributionError("E_ATTRIBUTION_SETTING", `the protected profile ${path} ${why} → have the service's operator provision it as a regular file, owned by you or by root, that only its owner can write`, { key, problem: "profile-mode", file: path });
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

/** The recorded profile's problem before any call that relies on it (C-1): its mode, then
 *  whether its bytes still match the digest setup recorded. Null when it may be used. */
export function recordedProfileProblem(setting) {
  const key = "settings.oats.aweb.attribution.service.profile";
  const problem = profileProblem(setting.service.profile, { key });
  if (problem) return problem;
  let digest = null;
  try { digest = profileDigest(setting.service.profile); } catch { digest = null; }
  if (digest !== setting.service.profileDigest) return attributionError("E_ATTRIBUTION_SETTING", `the protected profile ${setting.service.profile} changed since setup recorded it → rerun setup if the operator changed the profile`, { key, problem: "profile-changed" });
  return null;
}

// ---------------------------------------------------------------------------
// The root's home (v3.3's rules, carried over): owner-only, directly in D's
// .aweb-endorsed-root, never in a Git work tree, an instance home or a team
// container's /state/deploy.

export const ROOT_DIR = ".aweb-endorsed-root";
export const CONTAINER_DEPLOYMENT = "/state/deploy";
const inside = (dir, base) => dir === base || dir.startsWith(base.endsWith(sep) ? base : base + sep);

/** The root home's problem, or null: container, placement and mode, checked
 *  in that order, before any effect. `deployment` is D. */
export function rootHomeProblem(rootHome, { deployment }) {
  const fail = (problem, message) => attributionError("E_ATTRIBUTION_ROOT_HOME", message, { problem, home: rootHome });
  let realD = deployment;
  try { realD = realpathSync(deployment); } catch { /* the checks below use the path as given */ }
  if (inside(realD, CONTAINER_DEPLOYMENT) || inside(rootHome, CONTAINER_DEPLOYMENT)) return fail("container", `this deployment is a team container's (${CONTAINER_DEPLOYMENT}); attribution isn't supported in a team container in v1 → don't opt in on this deployment`);
  const expected = join(realD, ROOT_DIR);
  let real;
  try { real = realpathSync(rootHome); } catch { return fail("placement", `the root home ${rootHome} doesn't exist → rerun setup with the root under ${expected}/`); }
  if (dirname(real) !== expected) return fail("placement", `the root home ${rootHome} is not directly under ${expected}/ → rerun setup with the root there`);
  for (let dir = real; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return fail("placement", `the root home ${rootHome} is inside a Git work tree (${dir}), where its key could be committed → move the deployment's root out of any work tree`);
    if (existsSync(join(dir, "instance.json"))) return fail("placement", `the root home ${rootHome} is under an instance home (${dir}) → rerun setup with the root under ${expected}/`);
    if (dirname(dir) === dir) break;
  }
  const wide = [];
  const walk = (p) => {
    const s = lstatSync(p);
    if (s.isSymbolicLink()) { wide.push(p); return; }
    if (s.mode & 0o077) wide.push(p);
    if (s.isDirectory()) for (const name of readdirSync(p)) walk(join(p, name));
  };
  walk(real);
  // Each open path relative to the root, so the fix, which names the root, fits the cap.
  const named = wide.slice(0, 2).map((p) => relative(real, p) || ".");
  if (wide.length) return fail("mode", `the root home ${rootHome} is open to other users (${named.join(", ")}${wide.length > 2 ? ", …" : ""}) → \`chmod -R go-rwx ${rootHome}\`, then try again`);
  return null;
}

// ---------------------------------------------------------------------------
// What aw says about an identity (aw who --json, aw 1.36.58 who.go).

/** The kernel feature that makes an absent OATS_SPAWNER_HOME mean a person's spawn. */
export const SPAWN_ATTRIBUTION_FEATURE = "spawn-attribution";
export const KERNEL_FLOOR = "0.69.8";
/** aw's chain limits (id-certificates §5): certificates counting humans and agents. */
export const CHAIN_MAX_CERTIFICATES = 8;
const REVOKED_REASONS = new Set(["revoked", "parent_revoked", "root_replaced", "superseded_certificate"]);

/** One `aw who --json` answer as: verified {id, humanId, chain: [ids, root
 *  side first]}, chainless (a did:key aw never enrolled, or a did:aw the
 *  registry says is not enrolled), revoked, unavailable, or invalid. */
export function whoVerdict(who) {
  if (!object(who)) return { kind: "invalid", reason: "no answer" };
  const id = typeof who.id === "string" ? who.id : "";
  const reason = typeof who.reason === "string" && who.reason ? who.reason : "no reason";
  if (who.identity_valid === true && (who.outcome === "nearest_human" || who.outcome === "no_human")) {
    const chain = Array.isArray(who.chain) ? who.chain.map((c) => c?.id).filter((c) => typeof c === "string") : [];
    return { kind: "verified", id, humanId: who.outcome === "nearest_human" && typeof who.human_id === "string" ? who.human_id : null, chain };
  }
  if (who.outcome === "unavailable") return { kind: "unavailable", id, reason };
  if (who.identity_valid === null && ((id.startsWith("did:key:") && reason === "legacy_no_chain") || (id.startsWith("did:aw:") && reason === "unregistered_identity"))) return { kind: "chainless", id };
  if (REVOKED_REASONS.has(reason)) return { kind: "revoked", id, reason };
  return { kind: "invalid", id, reason };
}

/** `aw who --json` as `identityHome`, as a verdict; `aw(argv)` returns stdout or throws. */
export function readWho(aw, identityHome) {
  if (!existsSync(join(identityHome, "signing.key")) && !existsSync(join(identityHome, "grant.yaml"))) return { kind: "error", reason: `${identityHome} holds no aw identity` };
  let text;
  try { text = aw(["--identity-home", identityHome, "who", "--json"]); }
  catch (e) { return { kind: "error", reason: String(e.message || e).replace(/\s+/g, " ").slice(0, 200) }; }
  try { return whoVerdict(JSON.parse(String(text).trim())); } catch { return { kind: "invalid", reason: "aw who answered no JSON" }; }
}

/** The README section that holds the whole revocation path. */
export const README_REVOCATION = 'README, "Human attribution: revocation"';
/** The revocation path within the spawn's 300 characters (C-3c): with the
 *  binding act served, the whole path; while it isn't, the first step and
 *  that no path works yet, with no other fix. The README section holds it all. */
export const REVOKED_FIX = REQUEST_BINDING_SERVED
  ? `remove settings.oats.aweb.attribution, run \`oats aweb setup --endorse-root --new-root\`, have the operator bind-root it, then rerun setup; re-endorsing this root is outside v1 (${README_REVOCATION})`
  : `remove settings.oats.aweb.attribution; a new root then needs the operator's binding, which isn't available yet, so no working path exists yet (${README_REVOCATION})`;

/** The refusal for an identity whose chain doesn't verify: revoked, unavailable (retry), else the exchange step that read it. */
export function chainRefusal(verdict, { who, step }) {
  if (verdict.kind === "revoked") return attributionError("E_ATTRIBUTION_REVOKED", `${who}'s chain is revoked or replaced → ${REVOKED_FIX}`, { reason: verdict.reason });
  if (verdict.kind === "unavailable") return attributionError("E_ATTRIBUTION_EVIDENCE", `registry evidence for ${who}'s chain is unavailable (${verdict.reason}) → retry once the identity registry answers; spawns stop while evidence is unavailable`, { reason: verdict.reason });
  return attributionError("E_ATTRIBUTION_EXCHANGE", `${who}'s chain doesn't verify (${verdict.reason ?? verdict.kind}) → respawn it from a person`, { step, reason: verdict.reason ?? verdict.kind });
}

/** Who issues the child (C-3a). `spawner` is null for a person's spawn, else
 *  {home, identityHome, grant, verdict, recordedChain}; `root` is the root's
 *  verdict, read for every spawn: a root that no longer verifies to the
 *  recorded human stops every spawn here, a chainless one's too, before any
 *  key. Returns {action: "issue", issuer: {identityHome, id, certificates}}
 *  or {action: "chainless"}, or throws. */
export function chooseIssuer({ setting, spawner, root }) {
  if (root.kind === "error") throw attributionError("E_ATTRIBUTION_EXCHANGE", `the endorsed root's identity can't be read (${root.reason}) → check the root home ${setting.root.home}`, { step: "issuer", reason: root.reason });
  if (root.kind !== "verified") throw chainRefusal(root, { who: "the endorsed root", step: "issuer" });
  if (root.id !== setting.root.id) throw attributionError("E_ATTRIBUTION_SETTING", `settings.oats.aweb.attribution.root names ${setting.root.id}, but its home holds ${root.id} → ${SETTING_FIX}`, { key: "settings.oats.aweb.attribution.root" });
  if (root.humanId !== setting.human.id) throw attributionError("E_ATTRIBUTION_REVOKED", `the endorsed root no longer verifies to the recorded human → ${REVOKED_FIX}`, { reason: "another_human", humanId: root.humanId ?? null });
  if (!spawner) return depthChecked({ identityHome: join(setting.root.home, ".aw"), id: root.id, certificates: root.chain.length });
  const v = spawner.verdict;
  if (spawner.grant) {
    if (v.kind === "chainless") return { action: "chainless" };
    if (v.kind === "unavailable" || v.kind === "error") throw attributionError("E_ATTRIBUTION_EVIDENCE", `the registry can't establish that the grant-seat spawner has no chain (${v.reason}) → retry once the identity registry answers`, { reason: v.reason });
    throw attributionError("E_ATTRIBUTION_ISSUER_OUTSIDE_ROOT", "the spawner is a grant seat: a grant seat doesn't issue → spawn it from a person or from a chained local instance", { spawner: spawner.home });
  }
  if (v.kind === "error") throw attributionError("E_ATTRIBUTION_EXCHANGE", `the spawner's identity can't be read (${v.reason}) → spawn from a person or from another instance`, { step: "issuer", reason: v.reason });
  if (v.kind === "chainless") {
    // Missing files never make a chained instance chainless.
    if (spawner.recordedChain) throw attributionError("E_ATTRIBUTION_EXCHANGE", "the spawner's meta records a chain, but aw finds none in its home → respawn the spawner; a chained instance never becomes chainless", { step: "issuer", reason: "chain_missing" });
    return { action: "chainless" };
  }
  if (v.kind !== "verified") throw chainRefusal(v, { who: "the spawner", step: "issuer" });
  if (!v.chain.includes(setting.root.id) || v.humanId !== setting.human.id) throw attributionError("E_ATTRIBUTION_ISSUER_OUTSIDE_ROOT", `the spawner's chain doesn't run through this deployment's endorsed root ${setting.root.id} (its human: ${v.humanId ?? "none"}) → respawn the spawner from a person, or spawn from a shell`, { spawner: spawner.home });
  return depthChecked({ identityHome: spawner.identityHome, id: v.id, certificates: v.chain.length });
}
function depthChecked(issuer) {
  if (issuer.certificates + 1 > CHAIN_MAX_CERTIFICATES) throw attributionError("E_ATTRIBUTION_DEPTH", `the child's chain would hold ${issuer.certificates + 1} certificates, over aw's limit of ${CHAIN_MAX_CERTIFICATES} → spawn from an instance nearer the human, or from a shell`, { certificates: issuer.certificates + 1 });
  return { action: "issue", issuer };
}

/** aw 1.36.58's agent-child exchange (id-certificates §6) between the
 *  issuer's identity home and the new one, then the verify (C-3 steps 2, 4).
 *  It is local, with no server call. Transient failures of invite, request,
 *  receive and import are retried once; approve, which signs, never is. A
 *  failure after the issuer received the request refuses it, best effort.
 *  `dir` holds the request and the response (owner-only, removed after).
 *  Returns the meta's identity.attribution. */
/** Whether aw who's verdict `v` is a chain to the recorded human, through the root, with `issuer` as its parent. */
const issuedBy = (v, { issuer, setting }) => v.kind === "verified" && v.humanId === setting.human.id && v.chain.includes(setting.root.id) && v.chain.at(-2) === issuer.id && v.chain.at(-1) === v.id;
const humanAttribution = ({ issuer, setting }) => ({ mode: "human", human: { id: setting.human.id, label: setting.human.label }, parent: { id: issuer.id } });
/** The attribution of a resumed identity whose chain `issuer` already installed, or null: aw's
 *  exchange issues only a first certificate, so a rerun never asks for a second one. */
export function installedChain({ aw, issuer, identityHome, setting }) {
  return issuedBy(readWho(aw, identityHome), { issuer, setting }) ? humanAttribution({ issuer, setting }) : null;
}
export function issueChain({ aw, issuer, identityHome, instance, setting, dir }) {
  const fail = (step, why) => attributionError("E_ATTRIBUTION_EXCHANGE", `the chain exchange failed at ${step}: ${String(why).replace(/\s+/g, " ").slice(0, 160)} → retry the spawn`, { step });
  const attempt = (step, f, tries) => {
    for (let i = 1; ; i++) {
      try { return f(); }
      catch (e) { if (e.code || i >= tries) throw e.code ? e : fail(step, e.message || e); }
    }
  };
  const json = (text, what) => { try { return JSON.parse(String(text).trim()); } catch { throw new Error(`${what} answered no JSON`); } };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const requestFile = join(dir, "request.json"), responseFile = join(dir, "response.json");
  const clear = () => { for (const f of [requestFile, responseFile]) rmSync(f, { force: true }); };
  const asIssuer = (args) => aw(["--identity-home", issuer.identityHome, ...args]);
  const asChild = (args) => aw(["--identity-home", identityHome, ...args]);
  clear();
  let received;
  try {
    const invite = attempt("invite", () => json(asIssuer(["id", "child", "invite", "--kind", "agent", "--recipient", instance, "--expires", "10m", "--json"]), "aw id child invite"), 2);
    if (typeof invite?.invitation_id !== "string" || invite?.parent?.id !== issuer.id || typeof invite?.domain !== "string") throw fail("invite", "aw id child invite answered no invitation from the issuer");
    attempt("request", () => { rmSync(requestFile, { force: true }); asChild(["id", "parent", "request", "--invitation-id", invite.invitation_id, "--parent", invite.parent.id, "--domain", invite.domain, "--out", requestFile]); }, 2);
    received = attempt("receive", () => json(asIssuer(["id", "child", "receive", requestFile, "--json"]), "aw id child receive"), 2);
    if (typeof received?.request_id !== "string") { received = undefined; throw fail("receive", "aw id child receive answered no request id"); }
    attempt("approve", () => asIssuer(["id", "child", "approve", received.request_id, "--out", responseFile]), 1);
    let response;
    try { response = JSON.parse(readFileSync(responseFile, "utf8")); } catch { throw fail("approve", "the issuer's response is not readable JSON"); }
    const certificates = response?.chain?.certificates;
    if (!Array.isArray(certificates)) throw fail("approve", "the issuer's response carries no chain");
    depthChecked({ certificates: certificates.length - 1 });
    // A chainless requester names its domain again: aw resolves it anew at import.
    attempt("import", () => asChild(["id", "parent", "import", responseFile, "--domain", invite.domain, "--json"]), 2);
  } catch (e) {
    if (received) { try { asIssuer(["id", "child", "refuse", received.request_id, "--json"]); } catch { /* best effort: the invitation expires at 10 minutes */ } }
    throw e;
  } finally { clear(); }
  const v = readWho(aw, identityHome);
  if (issuedBy(v, { issuer, setting })) return humanAttribution({ issuer, setting });
  if (v.kind === "revoked" || v.kind === "unavailable") throw chainRefusal(v, { who: "the new identity", step: "verify" });
  throw fail("verify", `the new identity doesn't verify to the recorded human through the root with ${issuer.id} as its parent (aw who: ${v.kind}${v.reason ? `, ${v.reason}` : ""})`);
}

/** The meta of a child that is chainless by the protocol's own rule (§6). */
export const CHAINLESS = Object.freeze({ mode: "unknown", human: null, parent: null });
export const SPAWNER_UNCHAINED = "attribution-spawner-unchained — the spawner has no identity chain (it predates the endorsement), so this child is admitted with none and is attributed to nobody; respawn the spawner to attribute its children";

// ---------------------------------------------------------------------------
// Start and restart (C-4): a home recorded `mode: human` is checked with
// `aw who` at each start; start never calls the protected server.
export const UNATTRIBUTED = Object.freeze({ mode: "unknown", human: null, parent: null });
/** The attribution a start records for `recorded`, from its identity's `aw
 *  who` verdict, with the warning when it changes. Unchanged unless recorded
 *  `mode: human`. */
export function startAttribution(recorded, verdict) {
  if (recorded?.mode !== "human") return { attribution: recorded };
  if (verdict.kind === "verified" && verdict.humanId === recorded.human?.id) return { attribution: recorded };
  if (verdict.kind === "revoked") return { attribution: { ...UNATTRIBUTED }, warning: `attribution-revoked — this home's chain is revoked or replaced (${verdict.reason}), so it no longer acts for ${recorded.human?.label || "its human"} and is recorded unattributed; respawn it once the deployment has a new root (${README_REVOCATION})` };
  const why = verdict.kind === "verified" ? `it now verifies to ${verdict.humanId ?? "no human"}` : `${verdict.kind}: ${verdict.reason ?? "no reason"}`;
  return { attribution: { ...UNATTRIBUTED }, warning: `attribution-unverified — this home's chain couldn't be verified at start (${why}), so it is recorded unattributed; respawn to attribute it` };
}

// ---------------------------------------------------------------------------
// A deployment that never opted in, on a team aweb has protected (C-8).

/** True when aw's --json error envelope on `stdout` is the 403 a protected
 *  team answers a member-invite mint with: aw at 44158f1bb reports a server
 *  refusal as {"error": {"code": "http_error", "http_status": 403, ...}}, the
 *  server's code as `reason` (a coded detail) or `detail` (a plain one). */
export function protectedAdmissionRequired(stdout) {
  for (const line of String(stdout ?? "").trim().split("\n").reverse()) {
    let doc;
    try { doc = JSON.parse(line); } catch { continue; }
    const e = doc?.error;
    if (!object(e)) continue;
    return e.http_status === 403 && (e.reason === "protected_admission_required" || e.detail === "protected_admission_required");
  }
  return false;
}
/** C-8's refusal, in its order: why, the whole fix, the docs, and the step that gets a human ID. */
export const PROTECTED_ADMISSION_REQUIRED = attributionError("E_PROTECTED_ADMISSION_REQUIRED", 'this team now admits agents only through an endorsed root → oats aweb setup --endorse-root --new-root --name <alias> --human <your human did:aw> (README, "Human attribution"; oats onboarding); no human ID yet: passkey enrollment', { code: "protected_admission_required" });
