// The retained seat's lock, `.aw-retained-seat.json` beside a retained identity's
// `identity.source` (awebai/oats-aweb#236). It says which seat holds the standing
// identity: spawn creates it, a take-over (`identity.takeOver: true`) replaces it, a
// spawn's success rewrites it, and retire and a spawn's rollback remove it. Every one
// of those changes goes through `swapSeatLock`, so none acts on a lock it did not
// inspect at the moment it acts.
//
// Two private names beside the lock, both written only inside swapSeatLock:
// - `<lock>.guard`: created exclusively (O_CREAT|O_EXCL) for the change and removed
//   after it. One change runs at a time; another waits GUARD_WAIT_MS for it, then
//   refuses. The guarded section is a few file operations and no aw call.
// - `<lock>.held`: the lock, moved aside by rename(2) while it is inspected. The
//   change applies only to what was moved: the expected lock is then removed, or
//   replaced by a fresh exclusive create; any other lock is linked back.
//
// Why this is atomic on a POSIX filesystem: rename(2) moves the name in one step, so
// what is inspected is exactly the file (inode) that was at the lock's name at that
// instant, whatever a writer that ignores the guard does to the name afterwards. A
// writer that overwrites the lock in place before the move changes the moved file
// itself, which is what is compared. link(2) and an O_EXCL create fail with EEXIST
// rather than replace a lock that appeared meanwhile. Among oats.aweb's own changes,
// the exclusive guard serializes them, so the lock's name is never empty in a way
// that lets another spawn create a lock in between.
//
// Where those calls are not atomic (some network and FUSE filesystems: NFS before v3
// has no exclusive create, and a client's retried rename or link can report an
// error for a step that took effect), two changes can both take the guard, or one
// can see a failure for a step that happened. Nothing here detects that. A link that
// the filesystem refuses (no hard links) falls back to an exclusive create of the
// moved lock's bytes.
//
// Nothing here infers age, a pid or liveness. A guard or a moved lock that a killed
// change left behind is found by the next change: it is refused with its whole fix,
// never adopted and never removed automatically.
import { closeSync, linkSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname } from "node:path";

export const GUARD_WAIT_MS = 3000;
const GUARD_POLL_MS = 25;

export const seatGuardPath = (lockPath) => `${lockPath}.guard`;
export const seatHeldPath = (lockPath) => `${lockPath}.held`;

/** A value a lock or guard names, when it is short and printable; the files are
 *  written by whoever runs as this user. */
export const lockField = (v) => typeof v === "string" && v && v.length <= 512 && /^[\x20-\x7e]+$/.test(v) ? v : undefined;
const errorCode = (e) => /^E[A-Z]+$/.test(String(e?.code)) ? e.code : "error";
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** What is at `path`: `{ present: false }`, or `{ present: true, ino, text, doc }`
 *  (`text` null when it cannot be read, `doc` the parsed object or undefined).
 *  Throws an error with `code` when `path` cannot be checked. */
export function readSeatLock(path) {
  let st;
  try { st = lstatSync(path); }
  catch (e) { if (e?.code === "ENOENT") return { present: false }; throw e; }
  let text = null;
  try { text = readFileSync(path, "utf8"); } catch { text = null; }
  let doc; try { doc = text === null ? undefined : JSON.parse(text); } catch { doc = undefined; }
  return { present: true, ino: st.ino, text, doc: doc && typeof doc === "object" && !Array.isArray(doc) ? doc : undefined };
}
/** True when `now` is the very lock `then` was: the same file and the same bytes. */
export const sameSeatLock = (now, then) => !!now?.present && !!then?.present && now.ino === then.ino && now.text === then.text;

/** Who a lock (or a guard) names, each field bounded and printable. */
export const seatLockHolderText = (doc) => ["instance " + (lockField(doc?.instance) || "(not recorded)"), "home " + (lockField(doc?.home) || "(not printable)"), "host " + (lockField(doc?.host) || "(not recorded)"), "since " + (lockField(doc?.takenAt) || lockField(doc?.at) || "(not recorded)")].join(", ");

/** A refusal whose message is its whole fix. `kind`: "guard-held" or "held-stray". */
class SeatLockRefusal extends Error {
  constructor(kind, message, path) { super(message); this.kind = kind; this.path = path; }
}

function takeGuard(guard, who) {
  const mine = { ...who, host: hostname(), at: new Date().toISOString(), token: randomUUID() };
  const deadline = Date.now() + GUARD_WAIT_MS;
  for (;;) {
    let fd;
    try { fd = openSync(guard, "wx", 0o600); }
    catch (e) {
      if (e?.code !== "EEXIST") throw e;
      if (Date.now() >= deadline) {
        let held; try { held = JSON.parse(readFileSync(guard, "utf8")); } catch { held = undefined; }
        const by = held && typeof held === "object" ? ` (${lockField(held.op) || "a change"} by ${seatLockHolderText(held)})` : "";
        throw new SeatLockRefusal("guard-held", `${guard} exists${by}: another spawn, take-over or retire of this retained identity is changing its lock, or one was killed while it did; the guard is never removed automatically or by age. Once no spawn, take-over or retire of this identity runs on any host that shares ${dirname(guard)}, remove ${guard} and retry`, guard);
      }
      sleep(GUARD_POLL_MS);
      continue;
    }
    try { writeSync(fd, JSON.stringify(mine) + "\n"); } finally { closeSync(fd); }
    return mine;
  }
}
function releaseGuard(guard, mine) {
  let now; try { now = JSON.parse(readFileSync(guard, "utf8")); } catch { now = undefined; }
  if (now?.token === mine.token) { try { unlinkSync(guard); } catch { /* left: the next change reports it */ } }
}

/** Put the moved lock back at its name, never over a lock that is there now.
 *  → `{ restored: true }`, or `{ restored: false, problem }` with the moved lock kept. */
function restoreHeld(lock, held, captured) {
  try { linkSync(held, lock); }
  catch (e) {
    if (e?.code === "EEXIST") return { restored: false, problem: `a new lock appeared at ${lock} while it was moved aside` };
    // A filesystem with no hard links: the moved lock's bytes, created exclusively.
    if (captured.text === null) return { restored: false, problem: `it could not be linked back (${errorCode(e)})` };
    try { writeFileSync(lock, captured.text, { flag: "wx", mode: 0o600 }); }
    catch (e2) { return { restored: false, problem: e2?.code === "EEXIST" ? `a new lock appeared at ${lock} while it was moved aside` : `it could not be put back (${errorCode(e2)})` }; }
  }
  try { unlinkSync(held); } catch (e) { return { restored: true, problem: `its moved-aside copy ${held} could not be removed (${errorCode(e)})` }; }
  return { restored: true };
}

/** Inspect the lock and change it in one guarded step. `expect(captured)` says
 *  whether the lock now at its name is the one this change may act on (`captured` as
 *  readSeatLock answers). If it is, `next` (the new lock's text) replaces it, or it is
 *  removed when `next` is null; if it is not, it is put back untouched.
 *  → `{ done: true, captured }`, or `{ done: false, captured, restore }` (`restore` as
 *  restoreHeld answers, absent when nothing was there). Throws a SeatLockRefusal for a
 *  guard or a moved lock left by another change, and an error with `code` (and
 *  `stage`) when a step fails for any other reason. `who` ({op, instance, home}) is
 *  written into the guard, for the refusal another change prints. */
export function swapSeatLock(lock, { who, expect, next }) {
  const guard = seatGuardPath(lock), held = seatHeldPath(lock);
  const mine = takeGuard(guard, who);
  try {
    const stray = readSeatLock(held);
    if (stray.present) {
      throw new SeatLockRefusal("held-stray", `${held} is this retained identity's lock, moved aside by a spawn, take-over or retire that did not finish (${stray.doc ? seatLockHolderText(stray.doc) : "it cannot be read"}); it is never adopted or removed automatically. Once no spawn, take-over or retire of this identity runs on any host that shares ${dirname(lock)}: if the seat it names still holds the identity and ${lock} does not exist, move it back (\`mv ${held} ${lock}\`); otherwise remove ${held}; then retry`, held);
    }
    try { renameSync(lock, held); }
    catch (e) { if (e?.code !== "ENOENT") throw Object.assign(e, { stage: "move" }); }
    const captured = readSeatLock(held);
    if (!expect(captured)) return { done: false, captured, ...(captured.present ? { restore: restoreHeld(lock, held, captured) } : {}) };
    if (next !== null) {
      try { writeFileSync(lock, next, { flag: "wx", mode: 0o600 }); }
      catch (e) {
        // Our moved lock stays at its private name, where the next change finds it.
        if (e?.code === "EEXIST") return { done: false, captured: readSeatLock(lock), restore: { restored: false, problem: `a new lock appeared at ${lock} while it was moved aside; the one this change inspected is kept at ${held}` } };
        if (captured.present) restoreHeld(lock, held, captured);
        throw Object.assign(e, { stage: "write" });
      }
    }
    if (captured.present) { try { unlinkSync(held); } catch (e) { throw Object.assign(e, { stage: "remove" }); } }
    return { done: true, captured };
  } finally { releaseGuard(guard, mine); }
}
export const isSeatLockRefusal = (e) => e instanceof SeatLockRefusal;
