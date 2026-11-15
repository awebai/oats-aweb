// A host record: a version-1 JSON file of entries at <deployment>/.oats-aweb/<name>, which
// retires on this host append to and `oats aweb roster` reads. Each record (its entries'
// shape, its key, its cap) is defined by its own module; this one only reads and writes the
// file, the same way for every record.
//
// Writers serialise on an exclusive lock file beside the record (<name>.lock): each re-reads
// the record under the lock, merges its entries, writes a temp file in the same directory
// and renames it over the record. Readers never lock: the rename is atomic, so they always
// see a whole file.
//
// No writer ever removes another's lock, however old or whoever held it: a lock path that
// is moved or removed can be taken by a third writer at once, and no later step can undo
// what it did meanwhile. A lock left by a writer that died is reported instead: each later
// writer waits LOCK_WAIT_MS, records nothing and returns a cause naming the file to remove.
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCK_WAIT_MS = 5000;
const LOCK_POLL_MS = 20;

export const hostRecordDir = (deployment) => join(deployment, ".oats-aweb");
export const hostRecordFile = (deployment, name) => join(hostRecordDir(deployment), name);

/** The entries of a record's text, or null when it is not a version-1 record whose every
 *  entry passes `valid`: a record with one bad entry is malformed as a whole. */
export function parseHostRecord(text, valid) {
  let doc;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || typeof doc !== "object" || doc.version !== 1 || !Array.isArray(doc.entries)) return null;
  return doc.entries.every(valid) ? doc.entries : null;
}

/** The record's entries. `missing` when there is no file; `problem` when it cannot be read
 *  (`unreadable`) or is malformed (`malformed`), and then no entries. */
export function readHostRecord(deployment, name, valid, { unreadable, malformed }) {
  let text;
  try { text = readFileSync(hostRecordFile(deployment, name), "utf8"); }
  catch (e) {
    if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return { entries: [], missing: true };
    return { entries: [], problem: unreadable };
  }
  const entries = parseHostRecord(text, valid);
  if (!entries) return { entries: [], problem: malformed };
  return { entries };
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const fixed = (cause) => Object.assign(new Error(cause), { fixed: true });
const quietly = (fn) => { try { fn(); } catch { /* best effort */ } };

/** Takes the writers' lock, or throws a fixed-cause error. */
function takeLock(lock, lockRelative, { waitMs = LOCK_WAIT_MS } = {}) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try { closeSync(openSync(lock, "wx", 0o600)); return; }
    catch (e) {
      if (e?.code !== "EEXIST") throw fixed("the record directory is not writable");
    }
    if (Date.now() >= deadline) throw fixed(`another retire holds the record's lock (if none is running, remove ${lockRelative})`);
    sleep(LOCK_POLL_MS);
  }
}

/** Merges `fresh` (already valid entries) into the record `name` under its lock: an existing
 *  entry with the key of a fresh one is replaced, and the newest `max` are kept. An unreadable
 *  or malformed record is replaced, and said so. Returns `{}` or `{ cause }`, a fixed text. */
export function writeHostRecord(deployment, name, fresh, { valid, keyOf, max, lockWaitMs }) {
  const dir = hostRecordDir(deployment), file = hostRecordFile(deployment, name), lock = `${file}.lock`;
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  catch { return { cause: "the record directory could not be created" }; }
  // A directory that already existed keeps its mode: take group and other access away,
  // leaving the owner's (a directory the owner cannot write stays unwritable).
  try { const { mode } = statSync(dir); if (mode & 0o077) chmodSync(dir, mode & 0o700); }
  catch { return { cause: "the record directory's mode could not be set to 0700" }; }
  try { takeLock(lock, `.oats-aweb/${name}.lock`, { waitMs: lockWaitMs }); }
  catch (e) { return { cause: e?.fixed ? e.message : "the record's lock could not be taken" }; }
  // Under the lock no other writer runs, so this process's temp name is free unless a
  // crashed writer left it: that one fails this write, is reported, and is removed.
  const tmp = join(dir, `.${name.replace(/\.json$/, "")}.${process.pid}.tmp`);
  try {
    let existing = [], cause;
    try {
      existing = parseHostRecord(readFileSync(file, "utf8"), valid);
      if (!existing) { existing = []; cause = "the previous record was malformed and was replaced"; }
    } catch (e) { if (e?.code !== "ENOENT") cause = "the previous record was unreadable and was replaced"; }
    const replaced = new Set(fresh.map(keyOf));
    const merged = [...existing.filter((e) => !replaced.has(keyOf(e))), ...fresh].slice(-max);
    try {
      writeFileSync(tmp, `${JSON.stringify({ version: 1, entries: merged }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      chmodSync(tmp, 0o600);
    } catch { return { cause: "the record could not be written" }; }
    try { renameSync(tmp, file); } catch { return { cause: "the record could not be written" }; }
    return cause ? { cause } : {};
  } finally {
    quietly(() => unlinkSync(tmp));
    quietly(() => unlinkSync(lock));
  }
}
