// The per-label admission lock (the lead's decision on round 18, mail
// 24e49058-3946-4389-a959-89dbdf301e15): one lock per home and label, taken by
// spawn's and join's admission, leave and retire, held across their aw calls.
// A holder whose pid no longer runs is taken over by exactly one taker; a live
// holder refuses E_ATTRIBUTION_EXCHANGE step lock, naming its fix.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { admissionLockPath, takeAdmissionLock, withAdmissionLock } from "../oats-package/capabilities/oats-aweb/lib/admission-lock.mjs";

const scratch = (t) => { const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-lock-"))); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
/** A pid that ran and has ended. */
const deadPid = () => Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);
const holderOf = (path) => JSON.parse(readFileSync(path, "utf8"));
const lockRefusal = (fn) => { try { fn(); } catch (e) { return e; } assert.fail("expected a refusal"); };

test("the lock is .oats-aweb/admission-<label>.lock, taken whole, and its release removes it", (t) => {
  const dir = scratch(t);
  const path = admissionLockPath(dir, "ops");
  assert.equal(path, join(dir, "admission-ops.lock"));
  const held = takeAdmissionLock(dir, "ops");
  assert.equal(holderOf(path).pid, process.pid);
  assert.equal(typeof holderOf(path).nonce, "string");
  held.release();
  assert.equal(existsSync(path), false);
  assert.deepEqual(readdirSync(dir), [], "no temporary file is left");
});

test("a live holder refuses E_ATTRIBUTION_EXCHANGE step lock, naming the label, the pid and the lock path, then the fix, within 300 characters", (t) => {
  const dir = scratch(t);
  const path = admissionLockPath(dir, "ops");
  writeFileSync(path, JSON.stringify({ pid: process.pid, nonce: "another-command" }));
  const e = lockRefusal(() => takeAdmissionLock(dir, "ops"));
  assert.equal(e.code, "E_ATTRIBUTION_EXCHANGE");
  assert.equal(e.details.step, "lock");
  assert.ok(e.message.includes("ops") && e.message.includes(`pid ${process.pid}`), e.message);
  assert.ok(e.message.endsWith(`rerun when it ends; if no oats aweb command runs as pid ${process.pid}, remove ${path}`), e.message);
  assert.ok(`E_ATTRIBUTION_EXCHANGE (step: lock): ${e.message}`.length <= 300, e.message);
  assert.equal(holderOf(path).nonce, "another-command", "the holder's lock is untouched");
});

test("a lock that can't be read refuses as held, never as free: it names the path to remove", (t) => {
  const dir = scratch(t);
  const path = admissionLockPath(dir, "ops");
  writeFileSync(path, "");
  const e = lockRefusal(() => takeAdmissionLock(dir, "ops"));
  assert.equal(e.details.step, "lock");
  assert.ok(e.message.includes(`remove ${path}`), e.message);
  assert.equal(readFileSync(path, "utf8"), "");
});

test("a holder whose pid no longer runs is taken over", (t) => {
  const dir = scratch(t);
  const path = admissionLockPath(dir, "ops");
  writeFileSync(path, JSON.stringify({ pid: deadPid(), nonce: "killed" }));
  const held = takeAdmissionLock(dir, "ops");
  assert.equal(holderOf(path).pid, process.pid);
  held.release();
  assert.equal(existsSync(path), false);
});

test("two takers that read the same stale lock: the one that takes it over proceeds, and the other refuses as live without removing it", (t) => {
  const dir = scratch(t);
  const path = admissionLockPath(dir, "ops");
  writeFileSync(path, JSON.stringify({ pid: deadPid(), nonce: "killed" }));
  let first;
  // The second taker reads the stale lock; the first takes it over before the second goes on.
  const e = lockRefusal(() => takeAdmissionLock(dir, "ops", { onStale: () => { first = takeAdmissionLock(dir, "ops"); } }));
  assert.equal(e.details.step, "lock");
  assert.equal(holderOf(path).nonce, first.nonce, "the first taker's lock stays");
  first.release();
  assert.equal(existsSync(path), false);
});

test("two takers that read the same stale lock: one mid-takeover makes the other refuse, and it then holds the lock", (t) => {
  const dir = scratch(t);
  const path = admissionLockPath(dir, "ops");
  writeFileSync(path, JSON.stringify({ pid: deadPid(), nonce: "killed" }));
  let refused;
  // The other taker comes while this one holds the takeover's guard.
  const held = takeAdmissionLock(dir, "ops", { onGuarded: () => { refused = lockRefusal(() => takeAdmissionLock(dir, "ops")); } });
  assert.equal(refused.details.step, "lock");
  assert.equal(holderOf(path).nonce, held.nonce);
  held.release();
  assert.deepEqual(readdirSync(dir), []);
});

test("a release never removes a lock that is no longer its own", (t) => {
  const dir = scratch(t);
  const path = admissionLockPath(dir, "ops");
  const held = takeAdmissionLock(dir, "ops");
  writeFileSync(path, JSON.stringify({ pid: process.pid, nonce: "someone-else" }));
  held.release();
  assert.equal(holderOf(path).nonce, "someone-else");
});

test("withAdmissionLock holds the lock across its function, releases it when the function throws, and is re-entrant within one command", (t) => {
  const dir = scratch(t);
  const path = admissionLockPath(dir, "ops");
  const inner = withAdmissionLock(dir, "ops", () => {
    assert.ok(existsSync(path));
    return withAdmissionLock(dir, "ops", () => "nested"); // leave's own retireAdmissions
  });
  assert.equal(inner, "nested");
  assert.equal(existsSync(path), false);
  assert.throws(() => withAdmissionLock(dir, "ops", () => { throw new Error("aw failed"); }), /aw failed/);
  assert.equal(existsSync(path), false, "released on the way out of a failure");
});

test("the lock's directory is created owner-only when the home has none yet", (t) => {
  const dir = join(scratch(t), ".oats-aweb");
  withAdmissionLock(dir, "default", () => assert.ok(existsSync(admissionLockPath(dir, "default"))));
  assert.equal(existsSync(admissionLockPath(dir, "default")), false);
});

test("a command that exits holding a lock, on a path no finally reaches, releases it on its way out", (t) => {
  const dir = scratch(t);
  const lock = new URL("../oats-package/capabilities/oats-aweb/lib/admission-lock.mjs", import.meta.url).href;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `import { holdAdmissionLocks } from ${JSON.stringify(lock)}; holdAdmissionLocks(${JSON.stringify(dir)}, ["ops"]); process.exit(3);`], { encoding: "utf8" });
  assert.equal(r.status, 3, r.stderr);
  assert.equal(existsSync(admissionLockPath(dir, "ops")), false);
});
