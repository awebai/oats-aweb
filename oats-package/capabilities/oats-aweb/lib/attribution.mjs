// Spawn attribution (aweb-acmj.21, oats#1665): with settings.oats.aweb.attribution
// "human", every spawned instance gets an aw identity chain back to the
// deployment's bound human. The chain's rules are aw's (docs/id-certificates.md
// in awebai/aweb); these are the provider's decisions about them: who issues,
// when a spawn refuses, when a child is created chainless, and what the spawn
// meta records. No OATS code signs as a human: the human signs once, at a
// terminal, when `oats aweb setup --steward` issues the deployment's steward.
import { basename, isAbsolute } from "node:path";

/** The kernel feature that makes an absent OATS_SPAWNER_HOME mean a person's spawn. */
export const SPAWN_ATTRIBUTION_FEATURE = "spawn-attribution";
/** aw's chain limits (id-certificates §5): certificates, and canonical decoded bytes. */
export const CHAIN_MAX_CERTIFICATES = 8;
export const CHAIN_MAX_BYTES = 6144;
const LABEL_MAX_BYTES = 120;

export const STEWARD_SETUP_COMMAND = 'oats aweb setup --steward --human <did:aw> --label "<name>" --domain <domain> --name <alias>';

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
  return `attribution: human needs an OATS kernel that lists the ${SPAWN_ATTRIBUTION_FEATURE} feature; this kernel (${v}) does not: upgrade OATS with \`npm install -g @awebai/oats@latest\`, or set attribution: none`;
}

/** Who issues the child: the instance that ran the spawn, else the steward
 *  that the bound human issued at setup. */
export function issuerSelection({ spawnerHome, steward }) {
  if (spawnerHome) {
    if (!isAbsolute(spawnerHome)) throw new Error(`OATS_SPAWNER_HOME must be an absolute path (got ${JSON.stringify(spawnerHome)})`);
    return { kind: "spawner", home: spawnerHome };
  }
  if (!steward?.home || !steward?.id) throw new Error(`attribution: human but no human is bound to this deployment: a human runs \`${STEWARD_SETUP_COMMAND}\` at a terminal`);
  return { kind: "steward", home: steward.home, id: steward.id };
}

const REVOKED = new Set(["revoked", "subject_revoked", "parent_revoked"]);
const NO_CHAIN = new Set(["legacy_no_chain", "unregistered_identity"]);

/** The fix a failing issuer chain names, by who the issuer is. */
const fixFor = (issuer) => issuer.kind === "steward"
  ? `a human reruns \`${STEWARD_SETUP_COMMAND}\` at a terminal`
  : "retire the spawner and spawn from a valid instance, or from a shell so the deployment's steward issues";

/** One line saying why a chain refuses, then its fix after an arrow. */
function refusalFor(issuer, reason) {
  const who = issuer.kind === "steward" ? "the deployment's steward" : "the spawner";
  if (REVOKED.has(reason)) return `${who}'s identity chain is revoked (${reason}) → ${fixFor(issuer)}`;
  if (reason === "root_replaced") return `the namespace root was replaced after ${who}'s chain was registered (root_replaced) → the namespace owner re-admits it; ${fixFor(issuer)}`;
  if (reason === "superseded_certificate") return `${who}'s certificate was replaced by a newer certificate (superseded_certificate) → install the current chain, or ${fixFor(issuer)}`;
  if (reason === "stale_issuer_key") return `${who}'s chain is stale after its parent rotated its key → re-sign with your parent first: \`aw id parent request --resign\` in its home, the parent approves, then \`aw id parent import\``;
  return `${who}'s identity chain is malformed or fails verification (${reason || "no reason"}) → ${fixFor(issuer)}`;
}

const unavailable = (detail) => `registry evidence for the issuer's chain is unavailable (${detail}) → retry once the identity registry answers; chained spawning stops while it has been unreachable for over 60 s`;

/**
 * What the spawn does with this issuer, from its `aw who --json` (aw's cached
 * status client: evidence up to 60 s old is reused, older is refreshed once):
 * - issue: a verified chain (with or without a human) signs its child;
 * - chainless: a spawner with no chain, where that absence is evidence, gets a
 *   chainless child and a warning;
 * - refuse: everything else. A chain that exists but fails never falls back
 *   to a chainless child.
 * Absence counts as evidence only when the spawner holds no chain files, its
 * own spawn meta does not record that a chain was installed, and, for a
 * did:aw, the registry says authoritatively that it has no enrollment. A local
 * did:key is never enrolled, so its files and meta are all there is.
 */
export function classifyIssuer({ issuer, who, whoError, chainFiles, recordedChainInstalled = false, enrollment }) {
  if (whoError) return { action: "refuse", message: `could not read the issuer's chain status (${whoError}) → retry once the identity registry answers` };
  if (who?.identity_valid === true && (who.outcome === "nearest_human" || who.outcome === "no_human")) {
    return { action: "issue", outcome: who.outcome, humanId: who.outcome === "nearest_human" ? who.human_id : null, issuerId: who.id };
  }
  if (who?.outcome === "unavailable") return { action: "refuse", message: unavailable(who.reason || "no reason") };
  if (!NO_CHAIN.has(who?.reason) || chainFiles) return { action: "refuse", message: refusalFor(issuer, who?.reason) };
  if (issuer.kind === "steward") return { action: "refuse", message: `the deployment's steward has no verified chain (${who.reason}) → ${fixFor(issuer)}` };
  if (recordedChainInstalled) return { action: "refuse", message: "the spawner's spawn meta records an installed chain but its chain files are gone → respawn the spawner; missing files never make a chained instance chainless" };
  if (String(who.id || "").startsWith("did:aw:") && enrollment?.enrolled !== false) {
    return { action: "refuse", message: `the registry does not establish that the spawner has no enrollment (${who.id}) → retry once the identity registry answers, or respawn the spawner` };
  }
  return { action: "chainless", warning: "the spawner has no identity chain (it predates the human binding), so this child is created without one and reports unknown; respawn the spawner to give its children a chain" };
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

/** A human's label: one line, at most 120 bytes, no control characters. */
export function oneLineLabel(text) {
  const label = String(text ?? "").trim();
  if (!label) throw new Error("--label is required: the bound human's name, one line");
  if (/[\r\n]/.test(label)) throw new Error("--label must be one line");
  if (/[\u0000-\u001f\u007f]/.test(label)) throw new Error("--label must not contain control characters");
  if (Buffer.byteLength(label, "utf8") > LABEL_MAX_BYTES) throw new Error(`--label must be at most ${LABEL_MAX_BYTES} bytes`);
  return label;
}

/** identity.attribution for the spawn meta: opaque ids, a one-line label.
 *  The bound human's label applies to its own id; another human's id is its
 *  own label, since this deployment holds no name for it. */
export function attributionRecord(verdict, boundHuman) {
  if (verdict.action === "chainless") return { mode: "unknown", human: null, parent: null };
  const parent = { id: verdict.issuerId };
  if (verdict.outcome !== "nearest_human") return { mode: "none", human: null, parent };
  const label = verdict.humanId === boundHuman?.id ? boundHuman.label : verdict.humanId;
  return { mode: "human", human: { id: verdict.humanId, label }, parent };
}

/** Readiness information about attribution: the mode, never a failure. In
 *  mode none it names the one act that binds a human; in mode human it names
 *  the human and counts the local instances without a chain, whose children
 *  are created chainless until they are respawned. A resident-grant instance
 *  is not counted: it holds no identity key and never issues. */
export function attributionReadiness({ settings, homes, hasChain, isLocal }) {
  let mode;
  try { mode = attributionMode(settings); } catch (e) { return { mode: null, human: null, steward: null, chainlessSpawners: null, status: "info", message: `attribution: ${e.message}` }; }
  if (mode === "none") return { mode, human: null, steward: null, chainlessSpawners: null, status: "info", message: `attribution: none — no human bound; one act binds one: a human runs \`${STEWARD_SETUP_COMMAND}\` at a terminal` };
  const human = settings.human?.id ? { id: settings.human.id, label: settings.human.label ?? settings.human.id } : null;
  const steward = settings.steward?.id ? { id: settings.steward.id } : null;
  const bound = human && steward ? `bound to ${human.label} (${human.id}) through steward ${steward.id}` : `no human bound yet: a human runs \`${STEWARD_SETUP_COMMAND}\` at a terminal`;
  if (!homes?.known) return { mode, human, steward, chainlessSpawners: null, status: "info", message: `attribution: human — ${bound}; instances without a chain: unknown (${homes?.reason || "no deployment homes"})` };
  const chainless = homes.rows.filter((r) => isLocal(r.home) && !hasChain(r.home));
  const names = chainless.map((r) => (typeof r.instance === "string" ? r.instance : basename(r.home))).join(", ");
  const count = chainless.length === 1 ? `1 instance has no chain (${names}), so its children are created chainless and report unknown until it is respawned`
    : chainless.length ? `${chainless.length} instances have no chain (${names}), so their children are created chainless and report unknown until they are respawned`
    : "every instance has a chain";
  return { mode, human, steward, chainlessSpawners: chainless.length, status: "info", message: `attribution: human — ${bound}; ${count}` };
}
