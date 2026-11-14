// The per-label admission lock: `.oats-aweb/admission-<label>.lock`, one per home and
// team label. Spawn's and join's admission (admitIdentity, its resume included), leave and
// retire take it for each label they act on, and hold it across their aw calls until a
// `finally` releases it, so no two commands move one label's admission record at once
// (admission-states.md, "Concurrent commands"). Reconcile takes none.
//
// - Take: the holder's {pid, nonce} is written to a private temporary file and hard-linked
//   to the lock's name, so the lock appears whole or not at all, and only one taker's link
//   succeeds.
// - A holder whose pid no longer runs is taken over, only under the takeover's own guard
//   (`<lock>.takeover`, created the same way): the taker reads the lock again under the
//   guard and removes it only when it is still the stale one it read, then takes it like
//   any taker. So exactly one taker wins, and no taker removes a lock a live holder took
//   after it read the stale one.
// - A live holder, a lock that can't be read, or a takeover's guard refuses
//   E_ATTRIBUTION_EXCHANGE step lock, naming the lock and its fix: it fails safe. A pid
//   reused by another process only makes the refusal wrong, never the records.
// - A release removes the lock only while it is still its own.
import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { attributionError } from "./attribution.mjs";

export const admissionLockPath = (providerDir, label) => join(providerDir, `admission-${label}.lock`);
/** The labels whose locks are in `providerDir`: a join that hasn't written its first record holds one. */
export function lockedLabels(providerDir) {
  try { return readdirSync(providerDir).map((name) => /^admission-(.+)\.lock$/.exec(name)?.[1]).filter(Boolean); } catch { return []; }
}

/** Whether a process runs as `pid` here (one another user runs counts). */
function running(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === "EPERM"; }
}
/** The lock's holder: {doc} when it reads as one, {missing} when there is none, else {unreadable}. */
function holder(path) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch (e) { return e?.code === "ENOENT" ? { missing: true } : { unreadable: true }; }
  try { const doc = JSON.parse(text); return doc && Number.isInteger(doc.pid) && typeof doc.nonce === "string" ? { doc } : { unreadable: true }; } catch { return { unreadable: true }; }
}
/** Creates `path` holding `doc`, whole, or answers false when it exists. */
function create(path, doc) {
  const tmp = `${path}.${doc.nonce}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc)}\n`, { mode: 0o600 });
  try { linkSync(tmp, path); return true; }
  catch (e) { if (e?.code === "EEXIST") return false; throw e; }
  finally { unlinkSync(tmp); }
}
// The refusal names the lock within the home (`.oats-aweb/admission-<label>.lock`), so its whole fix
// fits a spawn's 300 characters however long the home's path is.
const within = (path) => `${basename(dirname(path))}/${basename(path)} in this home`;
const held = (label, path, pid) => attributionError("E_ATTRIBUTION_EXCHANGE", pid === undefined
  ? `${label}'s admission lock can't be read, so it counts as held → rerun later; if no oats aweb command acts on ${label} here, remove ${within(path)}`
  : `another command holds ${label}'s admission lock (pid ${pid}) → rerun when it ends; if no oats aweb command runs as pid ${pid}, remove ${within(path)}`, { step: "lock", label, pid: pid ?? null, path, shown: within(path) });

/** Takes `label`'s lock under `providerDir`, or throws the step lock refusal. → {nonce, release()}.
 *  `onStale` and `onGuarded` run when a stale lock was read, and while its takeover's guard is
 *  held: the seams the takeover's tests interleave a second taker at. */
export function takeAdmissionLock(providerDir, label, { onStale, onGuarded } = {}) {
  mkdirSync(providerDir, { recursive: true, mode: 0o700 });
  const path = admissionLockPath(providerDir, label), guard = `${path}.takeover`;
  const mine = { pid: process.pid, nonce: randomUUID(), at: new Date().toISOString() };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (create(path, mine)) return { nonce: mine.nonce, release: () => release(path, mine.nonce) };
    const seen = holder(path);
    if (seen.missing) continue; // released between the two: take it again
    if (seen.unreadable || running(seen.doc.pid)) throw held(label, path, seen.doc?.pid);
    onStale?.();
    const taking = { ...mine, nonce: randomUUID() };
    if (!create(guard, taking)) { const g = holder(guard); throw held(label, guard, g.doc?.pid); }
    try {
      onGuarded?.();
      const again = holder(path);
      if (again.doc && again.doc.nonce === seen.doc.nonce) unlinkSync(path);
    } finally { release(guard, taking.nonce); }
  }
  const last = holder(path);
  throw held(label, path, last.doc?.pid);
}
function release(path, nonce) {
  const now = holder(path);
  if (now.doc?.nonce === nonce) { try { unlinkSync(path); } catch (e) { if (e?.code !== "ENOENT") throw e; } }
}

// The locks this command holds, by path: a nested take of one (leave's own retire) is the same hold.
// A command that exits holding any (an exit no `finally` reaches) releases them on its way out.
const holding = new Map();
process.once("exit", () => { for (const lock of holding.values()) lock.release(); holding.clear(); });
/** Takes, or enters again, `label`'s lock for this command. → its exit, which releases it at the last. */
function enter(providerDir, label) {
  const path = admissionLockPath(providerDir, label);
  let lock = holding.get(path);
  if (lock) lock.depth++;
  else { lock = { ...takeAdmissionLock(providerDir, label), depth: 1 }; holding.set(path, lock); }
  let exited = false;
  return () => { if (exited) return; exited = true; if (--lock.depth === 0) { holding.delete(path); lock.release(); } };
}
/** Holds each of `labels`' locks, taken in order, until `release()`; a refusal releases those taken
 *  and throws. Within this command, a later take of a held label enters the same hold. */
export function holdAdmissionLocks(providerDir, labels) {
  const exits = [];
  try { for (const label of labels) exits.push(enter(providerDir, label)); }
  catch (e) { for (const exit of exits.reverse()) exit(); throw e; }
  return { release: () => { for (const exit of exits.reverse()) exit(); } };
}
/** Runs `fn` holding `label`'s lock, re-entrant within this command; releases it after, a throw included. */
export const withAdmissionLock = (providerDir, label, fn) => withAdmissionLocks(providerDir, [label], fn);
/** Runs `fn` holding each of `labels`' locks; releases them after, a throw included. */
export function withAdmissionLocks(providerDir, labels, fn) {
  const held = holdAdmissionLocks(providerDir, labels);
  try { return fn(); } finally { held.release(); }
}
/** A retire's text for a label another command holds (a lock refusal's details): it acts on nothing
 *  and keeps the home, as an unconfirmed removal does. */
export const lockedRetireText = ({ label, pid, shown }) => `${label}'s admission lock is held by ${pid === null ? "a command whose lock can't be read" : `pid ${pid}`}, so this retire acted on nothing and the home is kept → rerun the retire when it ends; if no oats aweb command ${pid === null ? `acts on ${label} here` : `runs as pid ${pid}`}, remove ${shown}`;
