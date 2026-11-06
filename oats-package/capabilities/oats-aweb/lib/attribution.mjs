// Spawn attribution (aweb-acmj.21, oats#1665): with settings.oats.aweb.attribution
// "human", every spawned instance gets an aw identity chain back to the
// deployment's bound human. The chain's rules are aw's (docs/id-certificates.md
// in awebai/aweb); these are the provider's decisions about them: who issues,
// when a spawn refuses, when a child is created chainless, and what the spawn
// meta records. No OATS code signs as a human. The bound human and the
// steward are read from host settings (`human`, `steward`); the bind that
// records them is the person's own approval and is not part of this package.
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { atomicWrite } from "./local-settings.mjs";
import { CONTROL_CHARACTER } from "./status-document.mjs";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** base58btc, the alphabet aw's did:key and did:aw use. */
function base58(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`), out = "";
  while (n > 0n) { out = BASE58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = `1${out}`; }
  return out;
}
/** An Ed25519 public key's did:key, as aw computes it (awid/didkey.go). */
export function didKeyFromPublicKey(publicKey) {
  return `did:key:z${base58(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(publicKey)]))}`;
}
/** The identity's current key, read from its own `.aw/signing.key` (a PEM
 *  block holding the 32-byte Ed25519 seed, as aw writes it): its did:key and
 *  the did:aw stable id that key would have. A did:aw that no longer equals
 *  `stableId` has rotated its key. Null when there is no readable key. Reading
 *  it signs nothing. */
export function homeKeyIds(home) {
  let seed;
  try {
    const pem = /-----BEGIN ED25519 PRIVATE KEY-----\r?\n([\s\S]+?)\r?\n-----END ED25519 PRIVATE KEY-----/.exec(readFileSync(join(home, ".aw", "signing.key"), "utf8"));
    seed = pem && Buffer.from(pem[1].replace(/\s+/g, ""), "base64");
  } catch { return null; }
  if (!seed || seed.length !== 32) return null;
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  const publicKey = Buffer.from(createPublicKey(key).export({ format: "jwk" }).x, "base64url");
  return { didKey: didKeyFromPublicKey(publicKey), stableId: `did:aw:${base58(createHash("sha256").update(publicKey).digest().subarray(0, 20))}` };
}

/** The kernel feature that makes an absent OATS_SPAWNER_HOME mean a person's spawn. */
export const SPAWN_ATTRIBUTION_FEATURE = "spawn-attribution";
/** aw's chain limits (id-certificates §5): certificates, and canonical decoded bytes. */
export const CHAIN_MAX_CERTIFICATES = 8;
export const CHAIN_MAX_BYTES = 6144;
const LABEL_MAX_BYTES = 120;
/** The first aw release with identity chains (`aw who`, the agent-child exchange). */
export const ATTRIBUTION_AW_UPGRADE = "upgrade aw to 1.36.53 or later (`npm i -g @awebai/aw@latest`)";

/** The act that binds a human: the person approves the steward in aweb Cloud. */
export const BIND_ACT = "bind a human to this deployment (`oats aweb setup --steward --name <alias>`, run by the setup expert; the person approves the steward in aweb Cloud)";

/** settings.oats.aweb.attribution: absent means none, today's behaviour. */
export function attributionMode(settings = {}) {
  const value = settings.attribution;
  if (value === undefined || value === null || value === "") return "none";
  if (value === "human" || value === "none") return value;
  throw new Error(`attribution must be "human" or "none" (got ${JSON.stringify(value)})`);
}

/** On a kernel without spawn-attribution, OATS_SPAWNER_HOME is always absent,
 *  so absence cannot be read as a person's spawn: bound mode refuses. */
export function kernelRefusal(version) {
  if (Array.isArray(version?.features) && version.features.includes(SPAWN_ATTRIBUTION_FEATURE)) return null;
  const v = typeof version?.version === "string" ? version.version : "unknown";
  return `attribution: human needs an OATS kernel that lists the ${SPAWN_ATTRIBUTION_FEATURE} feature; this kernel (${v}) does not → upgrade OATS (\`npm install -g @awebai/oats@latest\`), or set attribution: none`;
}

/** Who issues the child: the instance that ran the spawn, else the steward
 *  that the bound human issued at setup. */
export function issuerSelection({ spawnerHome, steward }) {
  if (spawnerHome) {
    if (!isAbsolute(spawnerHome)) throw new Error(`OATS_SPAWNER_HOME must be an absolute path (got ${JSON.stringify(spawnerHome)})`);
    return { kind: "spawner", home: spawnerHome };
  }
  if (!steward?.home || !steward?.id) throw new Error(`attribution: human but no human is bound to this deployment → ${BIND_ACT}, or set attribution: none`);
  return { kind: "steward", home: steward.home, id: steward.id };
}

/** A revoked steward's limit: aweb Cloud certifies an agent once, and replacing the steward is awebai/oats-aweb#204. */
export const REVOKED_STEWARD_LIMIT = "aweb Cloud certifies an agent once, so this deployment can't be bound again yet (awebai/oats-aweb#204), and spawns refuse while its steward is revoked";

/** The spawner the kernel recorded, read as the kernel reads it: exactly
 *  {instance, home}, else none. */
const recordedSpawner = (s) => (s && typeof s === "object" && typeof s.instance === "string" && typeof s.home === "string" ? s : null);

/**
 * The parent attach gives each of a deployment's homes: the issuer its spawn
 * would have chosen (oats#1665 C1), so an attached tree equals a spawned one.
 * - `spawnedBy` recorded: that instance; `null` is a person's spawn, issued by
 *   the steward, whatever its `parentInstance`;
 * - no `spawnedBy` key (a home spawned before the kernel recorded spawners):
 *   its `parentInstance`, else the steward;
 * - a parent that is not one of `nodes` (retired, or another deployment's) is
 *   no parent: the steward issues;
 * - a did:aw needs a registered parent: under a local (did:key) parent it
 *   takes its nearest did:aw ancestor, else the steward.
 * nodes: [{instance, home, record (its instance.json), did}]. Returns the
 * nodes in attach order, parents first, each with `parent` (a node, or null
 * for the steward) and `spawnParent`: the node its record names, before the
 * did:aw rule (a rule about who spawned it, such as a grant seat's children
 * never being issued, looks there), and `parentChosenFrom`: the ancestors
 * whose ids chose `parent`.
 */
export function attachParents(nodes) {
  // Paths compare resolved, so a recorded `..` can't name a home it isn't.
  const byHome = new Map(nodes.map((n) => [resolve(n.home), n])), byName = new Map(nodes.map((n) => [n.instance, n]));
  const spawnParent = (n) => {
    const record = n.record || {};
    if (Object.hasOwn(record, "spawnedBy")) { const s = recordedSpawner(record.spawnedBy); return (s && byHome.get(resolve(s.home))) || null; }
    return (typeof record.parentInstance === "string" && byName.get(record.parentInstance)) || null;
  };
  // The parent, and the ancestors whose ids chose it: a did:aw's walk; a
  // did:key's parent is its spawner whatever its id.
  const parentOf = (n) => {
    let p = spawnParent(n);
    if (!String(n.did).startsWith("did:aw:")) return { parent: p, read: [] };
    const read = [];
    for (const seen = new Set([n]); p && !String(p.did).startsWith("did:aw:"); p = spawnParent(p)) {
      if (seen.has(p)) return { parent: null, read };
      seen.add(p);
      read.push(p);
    }
    return { parent: p, read: p ? [...read, p] : read };
  };
  const choices = new Map(nodes.map((n) => [n, parentOf(n)]));
  const parents = new Map([...choices].map(([n, c]) => [n, c.parent]));
  // Parents first. A record that loops back on itself has no real spawner,
  // so the steward issues where the loop closes.
  const ordered = [], placed = new Set();
  const place = (n, path = new Set()) => {
    if (placed.has(n) || path.has(n)) return;
    path.add(n);
    const p = parents.get(n);
    if (p) place(p, path);
    placed.add(n);
    ordered.push({ ...n, parent: p && placed.has(p) && p !== n ? p : null, spawnParent: spawnParent(n), parentChosenFrom: choices.get(n).read });
  };
  for (const n of nodes) place(n);
  return ordered;
}

const REVOKED = new Set(["revoked", "subject_revoked", "parent_revoked"]);
const NO_CHAIN = new Set(["legacy_no_chain", "unregistered_identity"]);

/** The fix a failing issuer chain names, by who the issuer is. */
const fixFor = (issuer) => issuer.kind === "steward"
  ? "bind the human again (`oats aweb setup --steward --name <alias>`, run by the setup expert, continues an unfinished bind)"
  : "retire the spawner and spawn from a valid instance, or from a shell so the deployment's steward issues";

/** One line saying why a chain refuses, then its fix after an arrow. */
function refusalFor(issuer, reason) {
  const who = issuer.kind === "steward" ? "the deployment's steward" : "the spawner";
  if (REVOKED.has(reason) && issuer.kind === "steward") return `${who}'s identity chain is revoked (${reason}) → ${REVOKED_STEWARD_LIMIT}; set attribution: none on this host to spawn without chains meanwhile`;
  if (REVOKED.has(reason)) return `${who}'s identity chain is revoked (${reason}) → ${fixFor(issuer)}`;
  if (reason === "root_replaced") return `the namespace root was replaced after ${who}'s chain was registered (root_replaced) → the namespace owner re-admits it; ${fixFor(issuer)}`;
  if (reason === "superseded_certificate") return `${who}'s certificate was replaced by a newer certificate (superseded_certificate) → install the current chain, or ${fixFor(issuer)}`;
  if (reason === "stale_issuer_key") return `${who}'s chain is stale after its parent rotated its key → re-sign it with its parent first (\`aw id parent request --resign\` in its home, the parent approves, then \`aw id parent import\`)`;
  return `${who}'s identity chain is malformed or fails verification (${reason || "no reason"}) → ${fixFor(issuer)}`;
}

const unavailable = (detail) => `registry evidence for the issuer's chain is unavailable (${detail}) → retry once the identity registry answers; chained spawning stops while the registry is unreachable, or set attribution: none on this host to spawn without chains meanwhile`;

/**
 * What the spawn does with this issuer, from its `aw who --json` (aw's cached
 * status client; its cache lives in one process, so every spawn reads fresh
 * evidence and a registry outage refuses at once):
 * - issue: a verified chain (with or without a human) signs its child;
 * - chainless: a spawner with no chain, where that absence is evidence, gets a
 *   chainless child and a warning;
 * - refuse: everything else. A chain that exists but fails never falls back
 *   to a chainless child.
 * Absence counts as evidence only when the spawner holds no chain files, its
 * own spawn meta does not record that a chain was installed, and `aw who`
 * says so: legacy_no_chain for a did:key (never enrolled, so aw looks nothing
 * up), unregistered_identity for a did:aw (the registry's authoritative "no
 * enrollment"). Any other answer for a chainless spawner refuses.
 */
export function classifyIssuer({ issuer, who, whoError, chainFiles, recordedChainInstalled = false }) {
  if (whoError && /unknown command "who"/.test(whoError)) return { action: "refuse", message: `this aw has no \`aw who\` → ${ATTRIBUTION_AW_UPGRADE}, then spawn again` };
  if (whoError) return { action: "refuse", message: `could not read the issuer's chain status (${whoError}) → retry once the identity registry answers` };
  if (who?.identity_valid === true && (who.outcome === "nearest_human" || who.outcome === "no_human")) {
    // aw issues children only from an installed chain, never from the registry.
    if (!chainFiles) return { action: "refuse", message: `${issuer.kind === "steward" ? "the deployment's steward" : "the spawner"} is certified by the registry but holds no installed chain, so it can't issue → ${fixFor(issuer)}` };
    return { action: "issue", outcome: who.outcome, humanId: who.outcome === "nearest_human" ? who.human_id : null, issuerId: who.id };
  }
  if (who?.outcome === "unavailable") return { action: "refuse", message: unavailable(who.reason || "no reason") };
  if (!NO_CHAIN.has(who?.reason) || chainFiles) return { action: "refuse", message: refusalFor(issuer, who?.reason) };
  if (issuer.kind === "steward") return { action: "refuse", message: `the deployment's steward has no verified chain (${who.reason}) → ${fixFor(issuer)}` };
  if (recordedChainInstalled) return { action: "refuse", message: "the spawner's spawn meta records an installed chain but its chain files are gone → respawn the spawner; missing files never make a chained instance chainless" };
  const id = String(who.id || "");
  const absent = (id.startsWith("did:key:") && who.reason === "legacy_no_chain") || (id.startsWith("did:aw:") && who.reason === "unregistered_identity");
  if (!absent) return { action: "refuse", message: `the registry does not establish that the spawner has no enrollment (${id}, ${who.reason}) → retry once the identity registry answers, or respawn the spawner` };
  return { action: "chainless", warning: "the spawner has no identity chain (it predates the human binding), so this child is created without one and reports unknown; attach the spawner (the setup expert runs `oats aweb attribution attach`) to give its children a chain" };
}

/** aw's canonical JSON: keys sorted recursively, no whitespace. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** The resulting chain's limits, checked before the child installs it. */
export function chainLimitProblem(bundle) {
  const certificates = bundle?.certificates;
  if (!Array.isArray(certificates)) return "the issuer's response carries no chain";
  if (certificates.length > CHAIN_MAX_CERTIFICATES) return `the resulting chain has ${certificates.length} certificates, over the limit of ${CHAIN_MAX_CERTIFICATES} → spawn from an instance nearer the human, or from a shell`;
  const bytes = Buffer.byteLength(canonicalJson(bundle), "utf8");
  if (bytes > CHAIN_MAX_BYTES) return `the resulting chain is ${bytes} bytes, over the limit of ${CHAIN_MAX_BYTES} → spawn from an instance nearer the human, or from a shell`;
  return null;
}

/** The reasons aw and its registry refuse a certificate (id-certificates
 *  §5–6), found in a failed step's error text. */
const AW_REFUSALS = ["subject_mismatch", "unregistered_parent", "parent_revoked", "subject_revoked", "domain_mismatch", "identity_kind_immutable", "head_conflict", "issuer_key_not_current", "superseded_certificate", "human_issuer_is_agent", "request_binding_mismatch", "invitation_conflict", "invitation_mode_mismatch", "depth_exceeded", "stale_issuer_key", "unregistered_identity", "revoked"];
const awRefusal = (text) => AW_REFUSALS.find((r) => new RegExp(`\\b${r}\\b`).test(text)) || null;

/** A failed exchange: `code` is E_ATTACH_KEY_MISMATCH, E_ATTACH_PARENT_REFUSED
 *  (with aw's `reason`) or E_ATTACH_FAILED. */
function exchangeError(code, message, reason = null) {
  return Object.assign(new Error(`identity chain issuance failed: ${String(message).slice(0, 300)}`), { code, reason });
}

/** An import that may be left half done: aw saves the chain before it
 *  registers a did:aw's certificate (cmd/aw/id_parent.go), and asks for the
 *  import to be run again. The response and its domain are recorded before aw
 *  runs, so an attach killed meanwhile is found again, and kept until that
 *  import ends. */
const pendingFile = (stateDir) => join(stateDir, "pending-import.json");
export function pendingImport(stateDir) {
  try { const p = JSON.parse(readFileSync(pendingFile(stateDir), "utf8")); return p && typeof p.response === "string" && typeof p.domain === "string" ? p : null; } catch { return null; }
}
const importArgv = (response, domain) => ["aw", "id", "parent", "import", response, "--domain", domain, "--json"];
const resumeHint = (childHome, p) => `the chain is installed but not registered → the next attach resumes it (\`${importArgv(p.response, p.domain).slice(0, 7).join(" ")}\` in ${childHome})`;

/** Runs the pending import again; the pending record goes once it succeeds. */
export function resumeImport({ childHome, stateDir, run }) {
  const p = pendingImport(stateDir);
  if (!p) return false;
  try { run(importArgv(p.response, p.domain), childHome); }
  catch (e) {
    // No chain installed: nothing is half done, and the next attach exchanges anew.
    if (!existsSync(join(childHome, ".aw", "id-chain.json"))) rmSync(pendingFile(stateDir), { force: true });
    const text = String(e.message || e), reason = awRefusal(text);
    throw exchangeError(reason ? "E_ATTACH_PARENT_REFUSED" : "E_ATTACH_FAILED", `${resumeHint(childHome, p)}; aw id parent import: ${text.slice(0, 120)}`, reason);
  }
  for (const f of [pendingFile(stateDir), p.response, join(stateDir, "request.json")]) rmSync(f, { force: true });
  return true;
}

/**
 * aw's agent-child exchange (id-certificates §6), between the issuer's home
 * and the child's: the issuer fixes an invitation, the child exports its
 * request, the issuer receives and approves it, and the child imports the
 * response once the resulting chain is within aw's limits. Each aw runs in its
 * identity's own directory. It certifies the child's existing key, so it
 * serves a fresh spawn and an attach alike.
 * expectedSubjectKey: when given, the did:key of the child's current key; a
 * request for any other key is refused before the issuer receives it, so the
 * issuer approves only the key in the home OATS manages (Athena, oats#1665).
 * run(argv, cwd): runs one aw step, returning stdout or throwing.
 */
export function exchangeChain({ issuerHome, childHome, recipient, stateDir, run, parseJson, expectedSubjectKey }) {
  const step = (what, f) => {
    try { return f(); } catch (e) {
      const text = String(e.message || e), reason = awRefusal(text);
      throw reason ? exchangeError("E_ATTACH_PARENT_REFUSED", `${what}: ${text}`, reason) : exchangeError("E_ATTACH_FAILED", `${what}: ${text}`);
    }
  };
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  if (pendingImport(stateDir)) throw exchangeError("E_ATTACH_FAILED", `an earlier import into ${childHome} is pending → resume it before a new exchange`);
  const requestFile = join(stateDir, "request.json"), responseFile = join(stateDir, "response.json");
  for (const f of [requestFile, responseFile]) rmSync(f, { force: true });
  const invite = step("aw id child invite", () => parseJson(run(["aw", "id", "child", "invite", "--kind", "agent", "--recipient", recipient, "--expires", "10m", "--json"], issuerHome), "aw id child invite"));
  if (typeof invite?.invitation_id !== "string" || typeof invite?.parent?.id !== "string" || typeof invite?.domain !== "string") throw exchangeError("E_ATTACH_FAILED", "aw id child invite answered no invitation");
  step("aw id parent request", () => run(["aw", "id", "parent", "request", "--invitation-id", invite.invitation_id, "--parent", invite.parent.id, "--domain", invite.domain, "--out", requestFile], childHome));
  if (expectedSubjectKey !== undefined) {
    let subjectKey;
    try { subjectKey = JSON.parse(readFileSync(requestFile, "utf8"))?.request?.subject_key; } catch { subjectKey = undefined; }
    if (subjectKey !== expectedSubjectKey) throw exchangeError("E_ATTACH_KEY_MISMATCH", `the request's subject_key (${typeof subjectKey === "string" ? subjectKey : "none"}) is not this home's key (${expectedSubjectKey}), so it was never approved → check the home's .aw: its identity must be the one in its signing key`);
  }
  const received = step("aw id child receive", () => parseJson(run(["aw", "id", "child", "receive", requestFile, "--json"], issuerHome), "aw id child receive"));
  if (typeof received?.request_id !== "string") throw exchangeError("E_ATTACH_FAILED", "aw id child receive answered no request id");
  step("aw id child approve", () => run(["aw", "id", "child", "approve", received.request_id, "--out", responseFile], issuerHome));
  let response;
  try { response = JSON.parse(readFileSync(responseFile, "utf8")); } catch { throw exchangeError("E_ATTACH_FAILED", "the issuer's response is not readable JSON"); }
  const problem = chainLimitProblem(response?.chain);
  if (problem) throw exchangeError("E_ATTACH_PARENT_REFUSED", problem, "chain_limit");
  // A chainless requester names its domain again: aw resolves it anew at import.
  const p = { response: responseFile, domain: invite.domain, at: new Date().toISOString() };
  atomicWrite(pendingFile(stateDir), `${JSON.stringify(p)}\n`);
  try { run(importArgv(responseFile, invite.domain), childHome); }
  catch (e) {
    if (!existsSync(join(childHome, ".aw", "id-chain.json"))) { rmSync(pendingFile(stateDir), { force: true }); return step("aw id parent import", () => { throw e; }); }
    throw exchangeError("E_ATTACH_FAILED", `${resumeHint(childHome, p)}; aw id parent import: ${String(e.message || e).slice(0, 120)}`);
  }
  rmSync(pendingFile(stateDir), { force: true });
}

/** A human's label: one line, at most 120 bytes, no control characters. */
export function oneLineLabel(text) {
  const label = String(text ?? "").trim();
  if (!label) throw new Error("the human's label is required: their name, one line");
  if (/[\r\n\u0085\u2028\u2029]/.test(label)) throw new Error("the human's label must be one line");
  if (CONTROL_CHARACTER.test(label)) throw new Error("the human's label must not contain control characters");
  if (Buffer.byteLength(label, "utf8") > LABEL_MAX_BYTES) throw new Error(`the human's label must be at most ${LABEL_MAX_BYTES} bytes`);
  return label;
}

/** identity.attribution for the spawn meta: opaque ids, a one-line label.
 *  The bound human's label applies to its own id; another human's id is its
 *  own label, since this deployment holds no name for it. */
export function attributionRecord(verdict, boundHuman) {
  if (verdict.action === "chainless") return { mode: "unknown", human: null, parent: null };
  const parent = { id: verdict.issuerId };
  if (verdict.outcome !== "nearest_human") return { mode: "none", human: null, parent };
  let label = verdict.humanId;
  if (verdict.humanId === boundHuman?.id) { try { label = oneLineLabel(boundHuman.label); } catch { /* not one safe line: the id stands */ } }
  return { mode: "human", human: { id: verdict.humanId, label }, parent };
}

/** The mode and the binding, as readiness reports them: never a failure. */
function attributionSummary(settings) {
  let mode;
  try { mode = attributionMode(settings); } catch (e) { return { mode: null, human: null, steward: null, text: `attribution: ${e.message}` }; }
  if (mode === "none") return { mode, human: null, steward: null, text: `attribution: none — no human bound; one act binds one: ${BIND_ACT}` };
  const human = settings.human?.id ? { id: settings.human.id, label: settings.human.label ?? settings.human.id } : null;
  const steward = settings.steward?.id ? { id: settings.steward.id } : null;
  const bound = human && steward ? `bound to ${human.label} (${human.id}) through steward ${steward.id}` : `no human bound yet: ${BIND_ACT}, or set attribution: none`;
  return { mode, human, steward, text: `attribution: human — ${bound}` };
}

/** Deployment readiness (`setup --check-only`): null for a deployment that
 *  has not opted in (absent or none), so its answer carries no attribution
 *  key; otherwise the summary, and in mode
 *  human the local instances without a chain, whose children are created
 *  chainless until they are attached. A resident-grant instance is not
 *  counted: it holds no identity key and never issues. */
export function attributionReadiness({ settings, homes, hasChain, isLocal }) {
  const { mode, human, steward, text } = attributionSummary(settings);
  const base = { mode, human, steward, chainlessSpawners: null, status: "info" };
  if (mode === "none") return null;
  if (mode !== "human") return { ...base, message: text };
  if (!homes?.known) return { ...base, message: `${text}; instances without a chain: unknown (${homes?.reason || "no deployment homes"})` };
  const chainless = homes.rows.filter((r) => isLocal(r.home) && !hasChain(r.home));
  const names = chainless.map((r) => (typeof r.instance === "string" ? r.instance : basename(r.home))).join(", ");
  const count = chainless.length === 1 ? `1 instance has no chain (${names}), so its children are created chainless and report unknown until it is attached: \`oats aweb attribution attach\``
    : chainless.length ? `${chainless.length} instances have no chain (${names}), so their children are created chainless and report unknown until they are attached: \`oats aweb attribution attach\``
    : "every instance has a chain";
  return { ...base, chainlessSpawners: chainless.length, message: `${text}; ${count}` };
}

/** Home readiness: a warning with code `attribution` only when someone has
 *  something to do (readiness warns only about what someone must act on):
 *  mode human with no human bound, or this instance without a chain, whose
 *  children are created chainless until it is attached. Otherwise null; the
 *  informational report is `setup --check-only`'s. */
export function attributionHomeReadiness({ settings, home, hasChain, isLocal }) {
  const { mode, human, steward, text } = attributionSummary(settings);
  if (mode === null) return { code: "attribution", message: text };
  if (mode !== "human") return null;
  if (!human || !steward) return { code: "attribution", message: text };
  if (!home || !isLocal(home) || hasChain(home)) return null;
  return { code: "attribution", message: `${text}; this instance has no chain, so its children are created chainless and report unknown until it is attached: \`oats aweb attribution attach\`` };
}
