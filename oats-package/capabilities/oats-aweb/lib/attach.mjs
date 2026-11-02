// `oats aweb attribution attach` (oats#1665 §3 slice 2): an existing deployment
// switches to human attribution in place. Each local instance without a chain
// gets one for its EXISTING identity (its key, address, identity.yaml and
// memberships stay as they are), from the parent its spawn would have chosen
// (attachParents), parents first, through the same agent-child exchange as a
// spawn. Plan, then apply with the plan's revision and an idempotency key, as
// `oats instance upgrade` does. The setup expert runs it with
// `--dir <deployment>`; it acts only on the homes `oats status` lists for that
// deployment. The launch hook attaches one home at its start the same way.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ATTRIBUTION_AW_UPGRADE, BIND_ACT, attachParents, attributionMode, classifyIssuer, exchangeChain, homeKeyIds } from "./attribution.mjs";
import { parseAwJson } from "./aw-json.mjs";
import { selectedDeployment } from "./team-roots.mjs";
import { deploymentHomes } from "./wake-service.mjs";

export const ATTACH_USAGE = "usage: oats aweb attribution attach --plan [--dir <deployment>] [--json]\n       oats aweb attribution attach --plan-revision <rev> --idempotency-key <key> [--dir <deployment>] [--json]";
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REVISION_RE = /^[a-f0-9]{24}$/;
/** Refusals that last: retrying at the next start changes nothing until
 *  someone acts, so a start does not retry them; an attach apply does. */
const LASTING = new Set(["E_ATTACH_KEY_MISMATCH", "E_ATTACH_PARENT_REFUSED", "E_ATTACH_GRANT_SEAT"]);
export const isLastingRefusal = (code) => LASTING.has(code);

const failure = (code, message, details) => Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);

/** A home's lasting attach refusal, kept in the provider's own home state
 *  (`.oats-aweb/attach.json`): the start reads it and records it in its meta,
 *  and only an attach apply clears it. */
const refusalFile = (home) => join(home, ".oats-aweb", "attach.json");
export function readAttachRefusal(home) {
  try { const r = JSON.parse(readFileSync(refusalFile(home), "utf8")); return r && typeof r.code === "string" ? r : null; } catch { return null; }
}
export function recordAttachRefusal(home, refusal) {
  mkdirSync(join(home, ".oats-aweb"), { recursive: true, mode: 0o700 });
  writeFileSync(refusalFile(home), `${JSON.stringify(refusal)}\n`, { mode: 0o600 });
}
export const clearAttachRefusal = (home) => rmSync(refusalFile(home), { force: true });

/** Attach needs mode human with a recorded human and steward; it depends on
 *  nothing else of the bind. */
export function requireBoundHuman(settings) {
  let mode;
  try { mode = attributionMode(settings); } catch (e) { throw failure("E_ATTACH_NO_HUMAN", `${e.message} → set attribution: human once a human is bound`); }
  if (mode !== "human" || !settings.human?.id || !settings.steward?.id || !settings.steward?.home) throw failure("E_ATTACH_NO_HUMAN", `no human is bound to this deployment (attribution: ${mode}) → ${BIND_ACT}`);
}

/** What `aw who` says of a home's own identity, as attach reads it. */
function ownStatus(f) {
  if (f.grantSeat) return { status: "skipped", code: "E_ATTACH_GRANT_SEAT", message: "it acts through a session grant and holds no identity key → its resident's owner attaches the resident through aw" };
  if (f.whoError) return /unknown command "who"/.test(f.whoError)
    ? { status: "refused", code: "E_ATTACH_FAILED", message: `this aw has no \`aw who\` → ${ATTRIBUTION_AW_UPGRADE}` }
    : { status: "refused", code: "E_ATTACH_FAILED", message: `its chain status could not be read (${f.whoError}) → retry once the identity registry answers` };
  const who = f.who || {};
  if (who.identity_valid === true) return { status: f.chainFile ? "attached" : "attached-registry" };
  if (f.chainFile) return { status: "attached", verified: false, reason: who.reason || null, message: "it carries a chain that does not verify; attach never replaces an installed chain" };
  if (who.outcome === "unavailable") return { status: "refused", code: "E_ATTACH_FAILED", reason: who.reason || null, message: `registry evidence is unavailable (${who.reason || "no reason"}) → retry once the identity registry answers` };
  const id = String(who.id || "");
  const chainless = (id.startsWith("did:key:") && who.reason === "legacy_no_chain") || (id.startsWith("did:aw:") && who.reason === "unregistered_identity");
  if (!chainless) return { status: "refused", code: "E_ATTACH_FAILED", reason: who.reason || null, message: `aw who reports ${who.reason || "no reason"} for ${id || "its identity"} → retry once the identity registry answers` };
  if (!f.keys) return { status: "refused", code: "E_ATTACH_KEY_MISMATCH", message: "it has no readable signing key, so there is no key to certify → check the home's .aw" };
  if (id.startsWith("did:aw:") && id !== f.keys.stableId) return { status: "refused", code: "E_ATTACH_PARENT_REFUSED", reason: "subject_mismatch", message: `its key was rotated after ${id} was made, and aw certifies a did:aw only for the key it was made from (subject_mismatch): aw's limit, with no OATS fix` };
  if (id.startsWith("did:key:") && id !== f.keys.didKey) return { status: "refused", code: "E_ATTACH_KEY_MISMATCH", message: `its identity ${id} is not the key in its signing key (${f.keys.didKey}) → check the home's .aw` };
  return { status: "attach" };
}

/**
 * The attach plan for a deployment: every listed home, in attach order
 * (parents first), with what attach does to it. `homes` are the facts
 * gathered for each home `oats status` lists: {instance, home, record (its
 * instance.json), grantSeat, chainFile, who, whoError, keys, refusal}.
 * `stewardStatus` is `aw who` in the steward's home: {who, whoError}.
 */
export function buildPlan({ deployment, settings, homes, stewardStatus }) {
  requireBoundHuman(settings);
  const steward = classifyIssuer({ issuer: { kind: "steward", home: settings.steward.home, id: settings.steward.id }, who: stewardStatus.who, whoError: stewardStatus.whoError, chainFiles: true });
  if (steward.action !== "issue") throw failure("E_ATTACH_PARENT_REFUSED", steward.message);
  const entries = new Map();
  const nodes = homes.map((f) => ({ instance: f.instance, home: f.home, record: f.record, did: f.who?.id || f.keys?.didKey || "", facts: f }));
  for (const n of attachParents(nodes)) {
    const f = n.facts, own = ownStatus(f);
    const entry = { instance: n.instance, home: n.home, did: n.did || null, ...own };
    if (own.status === "attach") {
      const parent = n.parent ? entries.get(n.parent.home) : null;
      entry.parent = parent ? { instance: parent.instance, home: parent.home, id: parent.did } : { steward: true, home: settings.steward.home, id: settings.steward.id };
      if (parent?.code === "E_ATTACH_GRANT_SEAT") Object.assign(entry, { status: "refused", code: "E_ATTACH_PARENT_REFUSED", reason: "grant_seat_parent", message: `its spawner ${parent.instance} acts through a session grant and holds no key to issue with → its resident's owner attaches the resident through aw; then plan again` });
      else if (parent && !["attach", "attached", "attached-registry"].includes(parent.status)) Object.assign(entry, { status: "refused", code: "E_ATTACH_PARENT_REFUSED", reason: "parent_not_attached", message: `its parent ${parent.instance} is not attached (${parent.code || parent.status}) → attach its parent first, then plan again` });
      else if (parent?.verified === false) Object.assign(entry, { status: "refused", code: "E_ATTACH_PARENT_REFUSED", reason: parent.reason, message: `its parent ${parent.instance} carries a chain that does not verify (${parent.reason || "no reason"}) → repair the parent's chain, then plan again` });
      if (f.refusal) entry.lastRefusal = { code: f.refusal.code, reason: f.refusal.reason ?? null };
    }
    entries.set(n.home, entry);
  }
  const plan = {
    action: "attribution-attach", deployment,
    human: { id: settings.human.id, label: settings.human.label ?? settings.human.id },
    steward: { id: settings.steward.id },
    homes: [...entries.values()],
  };
  return { ...plan, planRevision: hash(plan) };
}

/**
 * Apply a plan by its revision. `plan` is the plan built now; `planRevision`
 * is the one the caller reviewed. The same idempotency key replays the first
 * result. Homes are attached in plan order; one that fails stays as it was,
 * and its descendants are skipped. attachOne(entry) attaches one home or
 * throws an error with its E_ code.
 */
export function applyPlan({ plan, planRevision, idempotencyKey, receiptsDir, attachOne, now = () => new Date().toISOString() }) {
  if (!REVISION_RE.test(planRevision || "") || !KEY_RE.test(idempotencyKey || "")) throw failure("E_BAD_ARGS", `attach needs --plan-revision <rev> (24 hex characters) and --idempotency-key <key> (1–128 safe characters)\n${ATTACH_USAGE}`);
  const receiptFile = join(receiptsDir, `receipt.${idempotencyKey}.json`);
  if (existsSync(receiptFile)) {
    let stored;
    try { stored = JSON.parse(readFileSync(receiptFile, "utf8")); } catch { throw failure("E_ATTACH_FAILED", `the receipt ${receiptFile} is unreadable → use another idempotency key`); }
    if (stored.planRevision !== planRevision || stored.deployment !== plan.deployment) throw failure("E_IDEMPOTENCY_CONFLICT", "this idempotency key belongs to another attach plan; use its original arguments or another key");
    return { ...stored, replayed: true };
  }
  if (plan.planRevision !== planRevision) throw failure("E_ATTACH_PLAN_STALE", `the attach plan changed (${planRevision} → ${plan.planRevision}); review the fresh plan`, { plan });
  const failed = new Set(), homes = [];
  for (const entry of plan.homes) {
    if (entry.status !== "attach") { homes.push(entry); continue; }
    if (entry.parent?.home && failed.has(entry.parent.home)) {
      failed.add(entry.home);
      homes.push({ ...entry, status: "skipped", code: "E_ATTACH_PARENT_REFUSED", reason: "parent_not_attached", message: `its parent ${entry.parent.instance} was not attached by this apply → fix its parent, then plan again` });
      continue;
    }
    try { attachOne(entry); homes.push({ ...entry, status: "attached" }); }
    catch (e) { failed.add(entry.home); homes.push({ ...entry, status: "refused", code: e.code || "E_ATTACH_FAILED", reason: e.reason ?? null, message: String(e.message || e) }); }
  }
  const receipt = { action: "attribution-attach", status: "complete", deployment: plan.deployment, idempotencyKey, planRevision, at: now(), failed: failed.size, homes };
  mkdirSync(receiptsDir, { recursive: true, mode: 0o700 });
  const temp = `${receiptFile}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, receiptFile);
  return receipt;
}

/** aw in one identity's home: the identity is the home's own `.aw`, never an
 *  inherited AWEB_IDENTITY_HOME (the setup expert's session carries its own),
 *  and no ambient service credentials. */
export function awInHome(env) {
  const childEnv = { ...env, AW_NO_UPDATE_CHECK: "1" };
  for (const name of ["AWEB_IDENTITY_HOME", "AWEB_URL", "AWEB_API_KEY", "AWEB_ROLE_NAME", "AWEB_ROLE"]) delete childEnv[name];
  return (argv, cwd, timeout = 60000) => {
    try { return execFileSync(argv[0], argv.slice(1), { cwd, env: childEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout }).trim(); }
    catch (e) { throw new Error(`${argv.slice(0, 4).join(" ")} failed${e.status != null ? ` (exit ${e.status})` : ""}: ${String(e.stderr || e.message || "").trim().slice(0, 300)}`); }
  };
}

/** `aw who --json` in a home, as {who} or {whoError}. */
export function whoIn(run, home, timeout) {
  try { return { who: parseAwJson(run(["aw", "who", "--json"], home, timeout), "aw who") }; } catch (e) { return { whoError: String(e.message || e).slice(0, 200) }; }
}

/** The facts attach needs about one home. */
export function homeFacts(run, row, timeout) {
  let record = {};
  try { record = JSON.parse(readFileSync(join(row.home, "instance.json"), "utf8")); } catch { record = {}; }
  const meta = record?.capabilityMeta?.["oats.aweb"] || {};
  const grantSeat = meta.identity?.mode === "global" && !!meta.identity?.grant;
  const base = { instance: typeof row.instance === "string" ? row.instance : record.instance, home: row.home, record, grantSeat, chainFile: existsSync(join(row.home, ".aw", "id-chain.json")), keys: homeKeyIds(row.home), refusal: readAttachRefusal(row.home) };
  return grantSeat ? base : { ...base, ...whoIn(run, row.home, timeout) };
}

/** One home's attach: the exchange with its parent, under the home's own
 *  lock; success clears a recorded refusal, a lasting refusal is recorded. */
export function attachHome({ entry, run, keys, recipient = entry.instance }) {
  const stateDir = join(entry.home, ".oats-aweb", "attribution");
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const lock = join(stateDir, "attach.lock");
  try { writeFileSync(lock, `${process.pid}\n`, { flag: "wx" }); }
  catch { throw failure("E_ATTACH_FAILED", `another attach of ${entry.instance} is running (${lock}) → retry once it has finished`); }
  try {
    const current = keys ?? homeKeyIds(entry.home);
    if (!current) throw failure("E_ATTACH_KEY_MISMATCH", "it has no readable signing key, so there is no key to certify → check the home's .aw");
    exchangeChain({ issuerHome: entry.parent.home, childHome: entry.home, recipient, stateDir, run, parseJson: parseAwJson, expectedSubjectKey: current.didKey });
    clearAttachRefusal(entry.home);
  } catch (e) {
    if (isLastingRefusal(e.code)) recordAttachRefusal(entry.home, { code: e.code, reason: e.reason ?? null, message: String(e.message || e).slice(0, 300), at: new Date().toISOString() });
    throw e;
  } finally { rmSync(lock, { force: true }); }
}

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => { if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) throw failure("E_BAD_ARGS", `${a} needs a value\n${ATTACH_USAGE}`); return argv[++i]; };
    if (a === "--json") out.json = true;
    else if (a === "--plan") out.plan = true;
    else if (a === "--plan-revision") out.planRevision = value();
    else if (a === "--idempotency-key") out.idempotencyKey = value();
    else if (a === "--dir") out.dir = value();
    else throw failure("E_BAD_ARGS", `unknown argument ${JSON.stringify(a)}\n${ATTACH_USAGE}`);
  }
  if (out.plan === (out.planRevision !== undefined || out.idempotencyKey !== undefined)) throw failure("E_BAD_ARGS", ATTACH_USAGE);
  return out;
}

function describe(result) {
  const lines = [];
  for (const h of result.homes) {
    const parent = h.parent ? (h.parent.steward ? `the steward ${h.parent.id}` : `${h.parent.instance} (${h.parent.id})`) : "";
    const what = { attach: `attach under ${parent}`, attached: h.verified === false ? `has a chain that does not verify (${h.reason || "?"})` : "attached", "attached-registry": "already attached (registry)", skipped: "skipped", refused: "refused" }[h.status] || h.status;
    lines.push(`${h.instance}: ${what}${h.code ? ` [${h.code}] ${h.message}` : ""}`);
  }
  return lines.join("\n");
}

/** `oats aweb attribution attach`, run by the kernel's command dispatch. */
export async function attachMain(argv, env = process.env) {
  let args = { json: argv.includes("--json") };
  const emit = (doc, code) => {
    if (args.json) console.log(JSON.stringify({ schemaVersion: 1, ...doc }));
    else if (doc.ok) console.log(doc.result.planRevision && !doc.result.idempotencyKey ? `${describe(doc.result)}\nplan revision: ${doc.result.planRevision}` : `${describe(doc.result)}${doc.result.replayed ? "\n(replayed: this idempotency key's first result)" : ""}`);
    else console.error(`${doc.error.code}: ${doc.error.message}`);
    return code;
  };
  try {
    args = parseArgs(argv);
    let deployment;
    try { deployment = selectedDeployment(env, args.dir); } catch (e) { throw failure("E_ATTACH_DEPLOYMENT", e.message); }
    let settings = {};
    try { settings = JSON.parse(env.OATS_SETTINGS || "{}"); } catch { settings = {}; }
    // Refuse without a bound human before any aw call or home read.
    requireBoundHuman(settings);
    const listed = deploymentHomes(env, deployment);
    if (!listed.known) throw failure("E_ATTACH_DEPLOYMENT", `the deployment's homes could not be read: ${listed.reason}`);
    const run = awInHome(env);
    const homes = listed.rows.map((row) => homeFacts(run, row));
    const plan = buildPlan({ deployment, settings, homes, stewardStatus: whoIn(run, settings.steward.home) });
    if (args.plan) return emit({ ok: true, result: plan }, 0);
    const keysByHome = new Map(homes.map((h) => [h.home, h.keys]));
    const receipt = applyPlan({ plan, planRevision: args.planRevision, idempotencyKey: args.idempotencyKey, receiptsDir: join(deployment, ".oats-aweb", "attach"), attachOne: (entry) => attachHome({ entry, run, keys: keysByHome.get(entry.home) }) });
    return emit({ ok: true, result: receipt }, receipt.failed ? 1 : 0);
  } catch (e) {
    const code = e.code || "E_ATTACH_FAILED";
    return emit({ ok: false, error: { code, message: String(e.message || e), ...(e.details ? { details: e.details } : {}) } }, code === "E_BAD_ARGS" ? 2 : 1);
  }
}
