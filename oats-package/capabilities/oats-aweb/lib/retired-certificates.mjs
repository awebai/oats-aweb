// The host's record of certificates that retires left in a people-controlled team.
// `aw workspace delete` cannot remove the member certificate of a team whose controller
// key is held by people (alias_released_reason team_not_hosted): only that controller
// can, with the command retire prints. Retire records each such certificate here, at
// <deployment>/.oats-aweb/retired-certificates.json, so `oats aweb roster` on this host
// can mark the leftover member and print that command. The record holds certificate ids
// and commands only, never a secret, and lives only on the host where the retire ran.
//
// Writers (retire) serialise on a lock file beside the record: each re-reads the record
// under the lock, merges its entries, writes a temp file in the same directory, checks it
// still holds the lock and renames the temp file over the record. Readers (roster) never
// lock: the rename is atomic, so they always see a whole file.
//
// The lock names its holder ({pid, host, token}) and appears whole: it is written to a
// temp file and hard-linked into place, which fails when a lock exists. Only a lock whose
// holder is dead on this host (or whose content is not a holder) is removed, never one
// that is merely old: a paused writer still holds it. Two writers may find the same dead
// lock; each moves the lock aside and removes it only if it is the lock it inspected,
// putting back a live lock it moved by mistake. A holder that finds its lock gone before
// it renames gives up with a warning rather than overwrite another writer's merge.
import { chmodSync, linkSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";

export const RETIRED_RECORD_MAX = 500;
const LOCK_WAIT_MS = 5000;
const LOCK_POLL_MS = 20;

export const retiredRecordDir = (deployment) => join(deployment, ".oats-aweb");
export const retiredRecordFile = (deployment) => join(retiredRecordDir(deployment), "retired-certificates.json");

const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";
const nullableString = (v) => v === null || typeof v === "string";
/** An entry the record may hold: everything roster shows is present and typed. */
const validEntry = (e) => !!e && typeof e === "object" && !Array.isArray(e)
  && nonEmpty(e.team) && nonEmpty(e.certificateId) && nonEmpty(e.command)
  && typeof e.retiredAt === "string" && !Number.isNaN(Date.parse(e.retiredAt))
  && nullableString(e.alias) && nullableString(e.instance);
const keyOf = (e) => `${e.team}\u0000${e.certificateId}`;

/** The record's entries, or null when the text is not a version-1 record whose every
 *  entry is valid: a record with one bad entry is malformed as a whole. */
function parseRecord(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || typeof doc !== "object" || doc.version !== 1 || !Array.isArray(doc.entries)) return null;
  return doc.entries.every(validEntry) ? doc.entries : null;
}

/** The record's entries for roster. `missing` when there is no file; `problem` (a fixed
 *  message) when it cannot be read or is malformed, and then no entries. */
export function readRetiredRecord(deployment) {
  let text;
  try { text = readFileSync(retiredRecordFile(deployment), "utf8"); }
  catch (e) {
    if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return { entries: [], missing: true };
    return { entries: [], problem: "the record of certificates OATS retired on this host could not be read; nothing from it is shown" };
  }
  const entries = parseRecord(text);
  if (!entries) return { entries: [], problem: "the record of certificates OATS retired on this host is malformed; nothing from it is shown" };
  return { entries };
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const fixed = (cause) => Object.assign(new Error(cause), { fixed: true });
const quietly = (fn) => { try { fn(); } catch { /* best effort */ } };

/** Whether the lock text names a writer that is gone: a holder on this host whose process
 *  no longer exists, or text that names no holder (never written by takeLock). */
function lockAbandoned(text) {
  let holder;
  try { holder = JSON.parse(text); } catch { return true; }
  if (!holder || typeof holder.token !== "string" || !Number.isInteger(holder.pid) || holder.pid <= 0) return true;
  if (holder.host !== hostname()) return false; // no way to tell from here
  try { process.kill(holder.pid, 0); return false; }
  catch (e) { return e?.code === "ESRCH"; }
}

/** Removes the abandoned lock `observed` read. The lock is moved aside first; if what moved
 *  is not that lock (another writer replaced it meanwhile), it is linked back. */
function breakLock(lock, observed, token) {
  const aside = `${lock}.${token}.abandoned`;
  try { renameSync(lock, aside); } catch { return; /* already gone */ }
  let moved;
  try { moved = readFileSync(aside, "utf8"); } catch { moved = undefined; }
  if (moved !== observed) quietly(() => linkSync(aside, lock)); // a live lock: put it back
  quietly(() => unlinkSync(aside));
}

/** Takes the writers' lock and returns its token, or throws a fixed-cause error. */
function takeLock(lock, { waitMs = LOCK_WAIT_MS, hooks = {} } = {}) {
  const token = randomBytes(12).toString("hex");
  const mine = `${lock}.${token}`;
  try { writeFileSync(mine, `${JSON.stringify({ pid: process.pid, host: hostname(), token })}\n`, { mode: 0o600, flag: "wx" }); }
  catch { throw fixed("the record directory is not writable"); }
  try {
    const deadline = Date.now() + waitMs;
    for (;;) {
      try { linkSync(mine, lock); hooks.locked?.(); return token; }
      catch (e) { if (e?.code !== "EEXIST") throw fixed("the record's lock could not be taken"); }
      let observed;
      try { observed = readFileSync(lock, "utf8"); }
      catch (e) { if (e?.code === "ENOENT") continue; throw fixed("the record's lock could not be read"); }
      if (lockAbandoned(observed)) { hooks.abandoned?.(); breakLock(lock, observed, token); hooks.broken?.(); continue; }
      if (Date.now() >= deadline) throw fixed("another retire held the record's lock");
      sleep(LOCK_POLL_MS);
    }
  } finally {
    quietly(() => unlinkSync(mine));
  }
}

function holdsLock(lock, token) {
  try { return JSON.parse(readFileSync(lock, "utf8"))?.token === token; } catch { return false; }
}

/** Records `entries` ({team, certificateId, alias, instance, retiredAt, command}) at the
 *  deployment, replacing any entry with the same team and certificate id and keeping the
 *  newest RETIRED_RECORD_MAX. Entries without a certificate id are skipped: nothing can
 *  match them. Never throws: returns `cause`, the fixed cause of what went wrong, if
 *  anything did (an unreadable or malformed record is replaced, and said so).
 *  `testHooks` ({abandoned, broken, locked}) are seams for tests to order two writers. */
export function recordRetiredCertificates(deployment, entries, { lockWaitMs, testHooks } = {}) {
  try {
    const fresh = entries
      .map((e) => ({ team: e?.team, certificateId: e?.certificateId, alias: e?.alias ?? null, instance: e?.instance ?? null, retiredAt: e?.retiredAt, command: e?.command }))
      .filter(validEntry);
    if (!fresh.length) return {};
    return writeRecord(deployment, fresh, { lockWaitMs, hooks: testHooks || {} });
  } catch {
    return { cause: "the record could not be written" };
  }
}

function writeRecord(deployment, fresh, { lockWaitMs, hooks }) {
  const dir = retiredRecordDir(deployment), file = retiredRecordFile(deployment), lock = `${file}.lock`;
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  catch { return { cause: "the record directory could not be created" }; }
  // A directory that already existed keeps its mode: take group and other access away,
  // leaving the owner's (a directory the owner cannot write stays unwritable).
  try { const { mode } = statSync(dir); if (mode & 0o077) chmodSync(dir, mode & 0o700); }
  catch { return { cause: "the record directory's mode could not be set to 0700" }; }
  let token;
  try { token = takeLock(lock, { waitMs: lockWaitMs, hooks }); }
  catch (e) { return { cause: e?.fixed ? e.message : "the record's lock could not be taken" }; }
  const tmp = join(dir, `.retired-certificates.${token}.tmp`);
  try {
    let existing = [], cause;
    try {
      existing = parseRecord(readFileSync(file, "utf8"));
      if (!existing) { existing = []; cause = "the previous record was malformed and was replaced"; }
    } catch (e) { if (e?.code !== "ENOENT") cause = "the previous record was unreadable and was replaced"; }
    const replaced = new Set(fresh.map(keyOf));
    const merged = [...existing.filter((e) => !replaced.has(keyOf(e))), ...fresh].slice(-RETIRED_RECORD_MAX);
    try {
      writeFileSync(tmp, `${JSON.stringify({ version: 1, entries: merged }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      chmodSync(tmp, 0o600);
    } catch { return { cause: "the record could not be written" }; }
    // Another writer may have taken the lock from under this one; its merge must stand.
    if (!holdsLock(lock, token)) return { cause: "another retire took the record's lock" };
    try { renameSync(tmp, file); } catch { return { cause: "the record could not be written" }; }
    return cause ? { cause } : {};
  } finally {
    quietly(() => unlinkSync(tmp));
    if (holdsLock(lock, token)) quietly(() => unlinkSync(lock));
  }
}
