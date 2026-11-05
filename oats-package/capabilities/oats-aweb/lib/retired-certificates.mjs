// The host's record of certificates that retires left in a people-controlled team.
// `aw workspace delete` cannot remove the member certificate of a team whose controller
// key is held by people (alias_released_reason team_not_hosted): only that controller
// can, with the command retire prints. Retire records each such certificate here, at
// <deployment>/.oats-aweb/retired-certificates.json, so `oats aweb roster` on this host
// can mark the leftover member and print that command. The record holds certificate ids
// and commands only, never a secret, and lives only on the host where the retire ran.
//
// Writers (retire) serialise on an exclusive lock file beside the record: each re-reads
// the record under the lock, merges its entries, writes a temp file in the same
// directory and renames it over the record. Readers (roster) never lock: the rename is
// atomic, so they always see a whole file.
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RETIRED_RECORD_MAX = 500;
const LOCK_WAIT_MS = 5000;
const LOCK_POLL_MS = 20;
/** A lock older than this is a crashed writer's: a live one holds it for milliseconds. */
const LOCK_STALE_MS = 30000;

export const retiredRecordDir = (deployment) => join(deployment, ".oats-aweb");
export const retiredRecordFile = (deployment) => join(retiredRecordDir(deployment), "retired-certificates.json");

const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";
const validEntry = (e) => !!e && typeof e === "object" && nonEmpty(e.team) && nonEmpty(e.certificateId) && nonEmpty(e.command);
const keyOf = (e) => `${e.team}\u0000${e.certificateId}`;

/** Parses the record's text: its valid entries, or null when it is not a version-1 record. */
function parseRecord(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || typeof doc !== "object" || doc.version !== 1 || !Array.isArray(doc.entries)) return null;
  return doc.entries.filter(validEntry);
}

/** The record's entries for roster. `missing` when there is no file; `problem` (a fixed
 *  message) when it cannot be read or is not a version-1 record, and then no entries. */
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

/** Takes the writers' lock, or throws a fixed-cause error. A lock left by a writer that
 *  died (older than LOCK_STALE_MS) is removed once and the take retried. */
function takeLock(lock, { waitMs = LOCK_WAIT_MS } = {}) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try { closeSync(openSync(lock, "wx", 0o600)); return; }
    catch (e) {
      if (e?.code !== "EEXIST") throw Object.assign(new Error("the record directory is not writable"), { fixed: true });
    }
    try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { rmSync(lock, { force: true }); continue; } }
    catch { continue; /* released between the take and the stat */ }
    if (Date.now() >= deadline) throw Object.assign(new Error("another retire held the record's lock"), { fixed: true });
    sleep(LOCK_POLL_MS);
  }
}

/** Records `entries` ({team, certificateId, alias, instance, retiredAt, command}) at the
 *  deployment, replacing any entry with the same team and certificate id and keeping the
 *  newest RETIRED_RECORD_MAX. Entries without a certificate id are skipped: nothing can
 *  match them. Never throws: returns `cause`, the fixed cause of what went wrong, if
 *  anything did (an unreadable or malformed record is replaced, and said so). */
export function recordRetiredCertificates(deployment, entries, { lockWaitMs } = {}) {
  const fresh = entries.filter(validEntry).map((e) => ({ team: e.team, certificateId: e.certificateId, alias: e.alias ?? null, instance: e.instance ?? null, retiredAt: e.retiredAt, command: e.command }));
  if (!fresh.length) return {};
  const dir = retiredRecordDir(deployment), file = retiredRecordFile(deployment), lock = `${file}.lock`;
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  catch { return { cause: "the record directory could not be created" }; }
  try { takeLock(lock, { waitMs: lockWaitMs }); }
  catch (e) { return { cause: e.fixed ? e.message : "the record's lock could not be taken" }; }
  try {
    let existing = [], cause;
    try {
      existing = parseRecord(readFileSync(file, "utf8"));
      if (!existing) { existing = []; cause = "the previous record was malformed and was replaced"; }
    } catch (e) { if (e?.code !== "ENOENT") cause = "the previous record was unreadable and was replaced"; }
    const replaced = new Set(fresh.map(keyOf));
    const merged = [...existing.filter((e) => !replaced.has(keyOf(e))), ...fresh].slice(-RETIRED_RECORD_MAX);
    const tmp = join(dir, `.retired-certificates.${process.pid}.${Date.now()}.tmp`);
    try {
      writeFileSync(tmp, `${JSON.stringify({ version: 1, entries: merged }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      chmodSync(tmp, 0o600);
      renameSync(tmp, file);
    } catch {
      rmSync(tmp, { force: true });
      return { cause: "the record could not be written" };
    }
    return cause ? { cause } : {};
  } finally {
    rmSync(lock, { force: true });
  }
}
