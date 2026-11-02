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
import { createHash, randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ATTRIBUTION_AW_UPGRADE, BIND_ACT, attachParents, attributionMode, classifyIssuer, exchangeChain, homeKeyIds, pendingImport, resumeImport } from "./attribution.mjs";
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
/** Records a lasting refusal; a write that fails never stops anything, and
 *  the returned phrase says so ("" when saved). */
function saveRefusal(home, refusal) {
  try { recordAttachRefusal(home, refusal); return ""; } catch (e) { return ` (this refusal could not be saved: ${String(e.message || e).slice(0, 120)}; it is checked again at the next start)`; }
}
/** Where a home's exchange keeps its request, response and pending import. */
export const attachStateDir = (home) => join(home, ".oats-aweb", "attribution");
export const readPendingImport = (home) => pendingImport(attachStateDir(home));

/** A per-deployment setting read from anywhere but this host: a kernel that
 *  enforces hostOnly never passes one, an older one may. */
export function hostOnlyViolation(origins) {
  const origin = origins?.["/attribution"];
  return origin && origin.kind !== "host" && origin.kind !== "manifest-default" ? origin : null;
}

/** Attach needs mode human, set on this host, with a recorded human and
 *  steward; it depends on nothing else of the bind. */
export function requireBoundHuman(settings, origins) {
  let mode;
  try { mode = attributionMode(settings); } catch (e) { throw failure("E_ATTACH_NO_HUMAN", `${e.message} → set attribution: human once a human is bound`); }
  const origin = hostOnlyViolation(origins);
  if (mode === "human" && origin) throw failure("E_ATTACH_NO_HUMAN", `attribution: human came from ${origin.kind}${origin.at ? ` (${origin.at})` : ""}, and attribution is set per deployment in oats-local.yaml only → set it in this deployment's oats-local.yaml`);
  if (mode !== "human" || !settings.human?.id || !settings.steward?.id || !settings.steward?.home) throw failure("E_ATTACH_NO_HUMAN", `no human is bound to this deployment (attribution: ${mode}) → ${BIND_ACT}`);
}

/** What `aw who` says of a home's own identity, as attach reads it. */
function ownStatus(f) {
  if (f.pendingImport) return { status: "attach", resume: true, message: "its import is pending (the chain is installed but not registered); attach resumes it" };
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
export function buildPlan({ deployment, settings, origins, homes, stewardStatus }) {
  requireBoundHuman(settings, origins);
  const steward = classifyIssuer({ issuer: { kind: "steward", home: settings.steward.home, id: settings.steward.id }, who: stewardStatus.who, whoError: stewardStatus.whoError, chainFiles: true });
  // An unreadable or unavailable status is for now; a steward chain that fails is not.
  const transient = stewardStatus.whoError || stewardStatus.who?.outcome === "unavailable";
  if (steward.action !== "issue") throw failure(transient ? "E_ATTACH_FAILED" : "E_ATTACH_PARENT_REFUSED", steward.message);
  const entries = new Map();
  const nodes = homes.map((f) => ({ instance: f.instance, home: f.home, record: f.record, did: f.who?.id || f.keys?.didKey || "", facts: f }));
  for (const n of attachParents(nodes)) {
    const f = n.facts, own = ownStatus(f);
    const entry = { instance: n.instance, home: n.home, did: n.did || null, ...own };
    if (own.status === "attach") {
      const parent = n.parent ? entries.get(n.parent.home) : null;
      entry.parent = parent ? { instance: parent.instance, home: parent.home, id: parent.did } : { steward: true, home: settings.steward.home, id: settings.steward.id };
      // The spawner the record names, not the certificate parent: a did:aw
      // child's ancestor rule would skip a keyless seat.
      if (n.spawnParent?.facts?.grantSeat) Object.assign(entry, { status: "refused", code: "E_ATTACH_PARENT_REFUSED", reason: "grant_seat_parent", message: `its spawner ${n.spawnParent.instance} acts through a session grant and holds no key, so it can never issue: this instance stays chainless and reports unknown → respawn it from an instance that holds its own key, or from a shell` });
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

const checkApplyArgs = (planRevision, idempotencyKey) => {
  if (!REVISION_RE.test(planRevision || "") || !KEY_RE.test(idempotencyKey || "")) throw failure("E_BAD_ARGS", `attach needs --plan-revision <rev> (24 hex characters) and --idempotency-key <key> (1–128 safe characters)\n${ATTACH_USAGE}`);
};

/** The first result of an idempotency key, replayed, or null when the key is
 *  new. The same key with another plan conflicts. Reads no aw and no home,
 *  so a replay never depends on the registry. */
export function storedReceipt({ receiptsDir, idempotencyKey, planRevision, deployment }) {
  checkApplyArgs(planRevision, idempotencyKey);
  const receiptFile = join(receiptsDir, `receipt.${idempotencyKey}.json`);
  if (!existsSync(receiptFile)) return null;
  let stored;
  try { stored = JSON.parse(readFileSync(receiptFile, "utf8")); } catch { throw failure("E_ATTACH_FAILED", `the receipt ${receiptFile} is unreadable → use another idempotency key`); }
  if (stored.planRevision !== planRevision || stored.deployment !== deployment) throw failure("E_IDEMPOTENCY_CONFLICT", "this idempotency key belongs to another attach plan; use its original arguments or another key");
  return { ...stored, replayed: true };
}

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const processAlive = (pid) => { try { if (pid > 0) { process.kill(pid, 0); return true; } } catch (e) { return e.code === "EPERM"; } return false; };
/** A lock or gate file's holder, from its `<pid> <token>` line; null once gone. */
function holderOf(file) {
  try { const raw = readFileSync(file, "utf8"); return { raw, pid: Number.parseInt(raw, 10) }; }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}
/** Runs f while holding the lock's gate: `<lock>.gate`, created exclusively.
 *  Every change to the lock happens under it, so a contender acting on what
 *  it saw of the lock can't meet another's change in between. A gate is held
 *  only for those few file operations; one whose holder has ended was left by
 *  a process killed inside it, and is never removed automatically (without
 *  an OS lock, recovering it can't exclude a second recoverer): the caller
 *  refuses, naming the gate, until someone who has checked removes it. A
 *  gate is created before its holder is written, so an empty or unparseable
 *  holder is busy and waited on; one that stays so for the whole wait was
 *  left the same way. */
function underGate(lockFile, f, onGate) {
  const gate = `${lockFile}.gate`, token = `${process.pid} ${randomUUID()}\n`;
  for (const until = Date.now() + 5000; ;) {
    try { writeFileSync(gate, token, { flag: "wx", mode: 0o600 }); break; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      const h = holderOf(gate), recorded = h && Number.isInteger(h.pid) && h.pid > 0;
      if (recorded && !processAlive(h.pid)) throw failure("E_ATTACH_FAILED", `the lock gate ${gate} was left by process ${h.pid}, which has ended → check that no attach is running for it, remove ${gate}, then run it again`);
      if (Date.now() > until) {
        if (h && !recorded) throw failure("E_ATTACH_FAILED", `the lock gate ${gate} records no holder → check that no attach is running for it, remove ${gate}, then run it again`);
        throw failure("E_ATTACH_FAILED", `the lock ${lockFile} stayed busy → run it again`);
      }
      sleepMs(25);
    }
  }
  try { onGate?.(); return f(); } finally { if (holderOf(gate)?.raw === token) rmSync(gate, { force: true }); }
}
/**
 * An exclusive lock file holding its owner's pid and a token: one holder at a
 * time. A lock whose process has ended (a start or apply that was killed) is
 * taken over; one held by a running process refuses with `busy(pid)`.
 * Taking, taking over and releasing all happen under the lock's gate, so two
 * contenders recovering the same dead lock never both hold it, and release
 * removes only the caller's own lock. Returns the release function.
 */
export function exclusiveLock(lockFile, busy, { onGate } = {}) {
  const token = `${process.pid} ${randomUUID()}\n`;
  underGate(lockFile, () => {
    const holder = holderOf(lockFile);
    if (holder && processAlive(holder.pid)) throw failure("E_ATTACH_FAILED", busy(holder.pid));
    writeFileSync(lockFile, token, { mode: 0o600 });
  }, onGate);
  return () => underGate(lockFile, () => { if (holderOf(lockFile)?.raw === token) rmSync(lockFile, { force: true }); });
}

/**
 * Apply a plan by its revision. `plan` is the plan built now; `planRevision`
 * is the one the caller reviewed. The same idempotency key replays the first
 * result, and one apply of a key runs at a time; a receipt once written is
 * never replaced. Homes are attached in plan order; one that fails stays as
 * it was, and its descendants are skipped. attachOne(entry) attaches one
 * home or throws an error with its E_ code.
 */
export function applyPlan({ plan, planRevision, idempotencyKey, receiptsDir, attachOne, now = () => new Date().toISOString() }) {
  checkApplyArgs(planRevision, idempotencyKey);
  mkdirSync(receiptsDir, { recursive: true, mode: 0o700 });
  const receiptFile = join(receiptsDir, `receipt.${idempotencyKey}.json`), lockFile = join(receiptsDir, `receipt.${idempotencyKey}.lock`);
  const release = exclusiveLock(lockFile, (pid) => `an apply with this idempotency key is already running (pid ${pid}) → run it again once it has finished, to get its result`);
  try {
    const replay = storedReceipt({ receiptsDir, idempotencyKey, planRevision, deployment: plan.deployment });
    if (replay) return replay;
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
    const temp = `${receiptFile}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    try { linkSync(temp, receiptFile); }
    catch (e) { if (e.code !== "EEXIST") throw e; return storedReceipt({ receiptsDir, idempotencyKey, planRevision, deployment: plan.deployment }); }
    finally { rmSync(temp, { force: true }); }
    return receipt;
  } finally { release(); }
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
  const base = { instance: typeof row.instance === "string" ? row.instance : record.instance, home: row.home, record, grantSeat, chainFile: existsSync(join(row.home, ".aw", "id-chain.json")), keys: homeKeyIds(row.home), refusal: readAttachRefusal(row.home), pendingImport: readPendingImport(row.home) };
  return grantSeat ? base : { ...base, ...whoIn(run, row.home, timeout) };
}

/** One home's attach: the exchange with its parent, under the home's own
 *  lock; success clears a recorded refusal, a lasting refusal is recorded. */
export function attachHome({ entry, run, keys, recipient = entry.instance }) {
  const stateDir = attachStateDir(entry.home);
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const lock = join(stateDir, "attach.lock");
  const release = exclusiveLock(lock, (pid) => `another attach of ${entry.instance} is running (pid ${pid}, ${lock}) → retry once it has finished`);
  try {
    if (resumeImport({ childHome: entry.home, stateDir, run })) { clearAttachRefusal(entry.home); return; }
    const current = keys ?? homeKeyIds(entry.home);
    if (!current) throw failure("E_ATTACH_KEY_MISMATCH", "it has no readable signing key, so there is no key to certify → check the home's .aw");
    exchangeChain({ issuerHome: entry.parent.home, childHome: entry.home, recipient, stateDir, run, parseJson: parseAwJson, expectedSubjectKey: current.didKey });
    clearAttachRefusal(entry.home);
  } catch (e) {
    if (isLastingRefusal(e.code)) e.message += saveRefusal(entry.home, { code: e.code, reason: e.reason ?? null, message: String(e.message || e).slice(0, 300), at: new Date().toISOString() });
    throw e;
  } finally { release(); }
}

/** Starts never wait longer than this for an attach (oats#1665 C3): well
 *  inside the kernel's 120 s launch-hook budget. */
export const START_ATTACH_BUDGET_MS = 30000;
const ATTACH_ACT = "the setup expert runs `oats aweb attribution attach`";

/** An instance home's record, if `home` is one of the deployment's. */
function instanceRecord(home) {
  try { return JSON.parse(readFileSync(join(home, "instance.json"), "utf8")); } catch { return null; }
}

/** The instance a home's record names as its parent by the spawn's rule,
 *  among the homes `oats status` lists for the deployment (as the plan reads
 *  them): `spawnedBy`, or, for a home spawned before kernels recorded
 *  spawners, `parentInstance`. A parent it doesn't list is none. */
function recordedParent(record, listed) {
  let row = null;
  if (Object.hasOwn(record, "spawnedBy")) {
    const s = record.spawnedBy;
    if (s && typeof s.home === "string" && typeof s.instance === "string") row = listed.byHome.get(resolve(s.home)) || null;
  } else if (typeof record.parentInstance === "string") row = listed.byName.get(record.parentInstance) || null;
  const r = row && instanceRecord(row.home);
  return r ? { instance: row.instance, home: row.home, record: r } : null;
}
/** A line of recorded parents longer than any deployment holds is read as
 *  damaged: the start waits rather than guess. */
const MAX_ANCESTRY = 1000;
/** The home's line of recorded parents among the listed homes, nearest
 *  first, to its end or a loop; `complete` is false when it stopped at the
 *  bound. */
function ancestorRows(home, listed) {
  const rows = [], seen = new Set([resolve(home)]);
  let record = instanceRecord(home) || {};
  for (let next; (next = recordedParent(record, listed)) && !seen.has(resolve(next.home)); record = next.record) {
    if (rows.length === MAX_ANCESTRY) return { rows, complete: false };
    seen.add(resolve(next.home));
    rows.push({ instance: next.instance, home: next.home });
  }
  return { rows, complete: true };
}

/**
 * The attach a start makes for its own home (C3, C4), by the same plan as
 * `oats aweb attribution attach`, over the home and its line of parents: in
 * mode human with a recorded human and steward, a local home the plan would
 * attach is attached once its parent holds a chain; a pending import is
 * resumed. A failure never stops the start: it gives one warning with its
 * reason. A lasting refusal of the home itself is recorded and not retried at
 * later starts, only by an attach apply. Returns null when the start has
 * nothing to do with attribution (mode none included: no aw call, no file
 * read); otherwise {attach (the meta's record of a lasting refusal, or
 * undefined), note (the warning, or null)}.
 */
export function startAttach({ home, instance, settings, origins, deployment, local, env, budgetMs = START_ATTACH_BUDGET_MS, listHomes = () => deploymentHomes(env, deployment) }) {
  let mode;
  try { mode = attributionMode(settings); } catch { return null; }
  if (hostOnlyViolation(origins)) return null;
  if (mode !== "human" || !settings.human?.id || !settings.steward?.id || !settings.steward?.home || !local) return null;
  const nothing = { attach: undefined, note: null };
  const recorded = readAttachRefusal(home);
  if (recorded) return { attach: { refused: recorded.code, reason: recorded.reason ?? null, at: recorded.at ?? null }, note: `this home is not attached (${recorded.code}): ${recorded.message} (recorded ${recorded.at || "earlier"}; not retried at start)${recorded.reason === "grant_seat_parent" ? "" : ` → fix that, then ${ATTACH_ACT}`}` };
  const pending = readPendingImport(home);
  if (!pending && existsSync(join(home, ".aw", "id-chain.json"))) return nothing;
  try { deployment = realpathSync(deployment); } catch { return nothing; }
  const deadline = Date.now() + budgetMs, base = awInHome(env);
  const run = (argv, cwd) => {
    const left = deadline - Date.now();
    if (left < 1000) throw new Error(`the start's attach budget of ${budgetMs / 1000} s ran out`);
    return base(argv, cwd, left);
  };
  const failed = (e) => {
    const code = e.code || "E_ATTACH_FAILED", message = String(e.message || e).slice(0, 300);
    // A respawn, not an attach, gives a grant seat's child its chain.
    const then = e.reason === "grant_seat_parent" ? "" : ` → fix that, then ${ATTACH_ACT}`;
    if (isLastingRefusal(code)) return { attach: { refused: code, reason: e.reason ?? null, at: new Date().toISOString() }, note: `this home could not be attached at start (${code}): ${message}; not retried at start${then}` };
    return { attach: undefined, note: `this home could not be attached at start (${code}): ${message}; the next start tries again, or ${ATTACH_ACT}` };
  };
  const later = (code, message) => ({ attach: undefined, note: `this home could not be attached at start (${code}): ${String(message).slice(0, 300)}; the next start tries again, or ${ATTACH_ACT}` });
  let entry, plan;
  try {
    // The parents the plan would see: the homes `oats status` lists.
    const listing = listHomes();
    if (!listing?.known) return later("E_ATTACH_FAILED", `the deployment's homes could not be read (${listing?.reason || "no listing"}), so its parent can't be chosen`);
    const listed = { byHome: new Map(listing.rows.map((r) => [resolve(r.home), r])), byName: new Map(listing.rows.map((r) => [r.instance, r])) };
    const line = ancestorRows(home, listed);
    if (!line.complete) return later("E_ATTACH_FAILED", `its line of recorded parents is longer than ${MAX_ANCESTRY}, so its parent can't be chosen`);
    const facts = [{ instance, home }, ...line.rows].map((row) => homeFacts(run, row));
    // The parent is chosen from every recorded parent's id: one that can't be
    // read could change it, so the start waits rather than choose another.
    const unread = facts.slice(1).filter((f) => f.whoError || f.who?.outcome === "unavailable").map((f) => f.instance);
    if (unread.length) return later("E_ATTACH_FAILED", `the status of its recorded parents ${unread.join(", ")} could not be read, so its parent can't be chosen yet`);
    plan = buildPlan({ deployment, settings, origins, homes: facts, stewardStatus: whoIn(run, settings.steward.home) });
    entry = plan.homes.find((h) => h.home === home);
  } catch (e) {
    // A refusal of the whole plan (no steward to issue, the registry
    // unreachable) is not this home's own, so it is never recorded for it.
    return { attach: undefined, note: `this home could not be attached at start (${e.code || "E_ATTACH_FAILED"}): ${String(e.message || e).slice(0, 300)}; the next start tries again, or ${ATTACH_ACT}` };
  }
  if (entry.status === "refused" || entry.status === "skipped") {
    // Only a refusal of the home itself lasts; a refused parent or a status
    // that can't be read now is checked again at the next start.
    // Lasting: its key, a rotated did:aw, or a spawner that can never issue.
    if (entry.code !== "E_ATTACH_KEY_MISMATCH" && !["subject_mismatch", "grant_seat_parent"].includes(entry.reason)) return later(entry.code, entry.message);
    const saved = saveRefusal(home, { code: entry.code, reason: entry.reason ?? null, message: entry.message, at: new Date().toISOString() });
    return failed(Object.assign(new Error(`${entry.message}${saved}`), { code: entry.code, reason: entry.reason }));
  }
  if (entry.status !== "attach") return nothing;
  // Not before its parent holds a chain: the parent attaches first.
  const parent = entry.parent.steward ? null : plan.homes.find((h) => h.home === entry.parent.home);
  if (!entry.resume && parent && parent.status === "attach") return nothing;
  try { attachHome({ entry, run, keys: homeKeyIds(home) }); return nothing; } catch (e) { return failed(e); }
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
    let settings = {}, origins;
    try { settings = JSON.parse(env.OATS_SETTINGS || "{}"); } catch { settings = {}; }
    try { origins = JSON.parse(env.OATS_SETTINGS_ORIGINS || "{}"); } catch { origins = undefined; }
    // Refuse without a bound human before any aw call or home read.
    requireBoundHuman(settings, origins);
    const receiptsDir = join(deployment, ".oats-aweb", "attach");
    if (!args.plan) {
      const replay = storedReceipt({ receiptsDir, idempotencyKey: args.idempotencyKey, planRevision: args.planRevision, deployment });
      if (replay) return emit({ ok: true, result: replay }, replay.failed ? 1 : 0);
    }
    const listed = deploymentHomes(env, deployment);
    if (!listed.known) throw failure("E_ATTACH_DEPLOYMENT", `the deployment's homes could not be read: ${listed.reason}`);
    const run = awInHome(env);
    const homes = listed.rows.map((row) => homeFacts(run, row));
    const plan = buildPlan({ deployment, settings, origins, homes, stewardStatus: whoIn(run, settings.steward.home) });
    if (args.plan) return emit({ ok: true, result: plan }, 0);
    const keysByHome = new Map(homes.map((h) => [h.home, h.keys]));
    const receipt = applyPlan({ plan, planRevision: args.planRevision, idempotencyKey: args.idempotencyKey, receiptsDir, attachOne: (entry) => attachHome({ entry, run, keys: keysByHome.get(entry.home) }) });
    return emit({ ok: true, result: receipt }, receipt.failed ? 1 : 0);
  } catch (e) {
    const code = e.code || "E_ATTACH_FAILED";
    return emit({ ok: false, error: { code, message: String(e.message || e), ...(e.details ? { details: e.details } : {}) } }, code === "E_BAD_ARGS" ? 2 : 1);
  }
}
