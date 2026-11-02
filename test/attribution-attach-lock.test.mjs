// The exclusive lock attach uses for a home's exchange and for an
// idempotency key's receipt: one holder at a time, a dead holder's lock is
// taken over, and only the holder's own lock is ever removed, under
// concurrent recovery too.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { exclusiveLock } from "../oats-package/capabilities/oats-aweb/lib/attach.mjs";

const ATTACH = fileURLToPath(new URL("../oats-package/capabilities/oats-aweb/lib/attach.mjs", import.meta.url));
function dir(t) { const d = mkdtempSync(join(tmpdir(), "oats-aweb-lock-")); t.after(() => rmSync(d, { recursive: true, force: true })); return d; }
const busy = (pid) => `held by ${pid}`;

test("a dead holder's lock is taken over; a live one refuses; release removes only the holder's own lock", (t) => {
  const d = dir(t), lock = join(d, "attach.lock");
  writeFileSync(lock, "999999999 dead\n");
  const release = exclusiveLock(lock, busy);
  assert.match(readFileSync(lock, "utf8"), new RegExp(`^${process.pid} `));
  assert.throws(() => exclusiveLock(lock, busy), (e) => e.code === "E_ATTACH_FAILED" && /held by/.test(e.message));
  writeFileSync(lock, `${process.pid} someone-else\n`);
  release();
  assert.equal(readFileSync(lock, "utf8"), `${process.pid} someone-else\n`, "a lock that is no longer ours is left alone");
});

// One contender as its own process: it takes the lock (pausing inside the
// lock's gate until `go` exists, when asked), holds it for holdMs, and
// records what happened.
const CONTENDER = `
import { existsSync, appendFileSync } from "node:fs";
import { exclusiveLock } from ${JSON.stringify(ATTACH)};
const [lock, log, name, pause, go, holdMs] = process.argv.slice(2);
const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const onGate = pause === "1" ? () => { appendFileSync(log, name + " in-gate\\n"); while (!existsSync(go)) wait(20); } : undefined;
let release;
try { release = exclusiveLock(lock, (pid) => "busy " + pid, { onGate }); }
catch (e) { appendFileSync(log, name + " refused\\n"); process.exit(0); }
appendFileSync(log, name + " enter\\n"); wait(Number(holdMs)); appendFileSync(log, name + " exit\\n");
release();
`;
function contender(d, args) {
  const script = join(d, "contender.mjs");
  if (!existsSync(script)) writeFileSync(script, CONTENDER);
  return new Promise((done) => spawn(process.execPath, [script, ...args], { stdio: "ignore" }).on("exit", done));
}
const lines = (log) => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);

test("concurrent recovery of a dead lock: a contender paused mid-recovery never removes the lock another took, so never two holders", async (t) => {
  const d = dir(t), lock = join(d, "attach.lock"), log = join(d, "log"), go = join(d, "go");
  writeFileSync(lock, "999999999 dead\n");
  const a = contender(d, [lock, log, "A", "1", go, "800"]);
  for (let i = 0; i < 200 && !lines(log).includes("A in-gate"); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(lines(log).includes("A in-gate"), "A reached the gate");
  const b = contender(d, [lock, log, "B", "0", go, "800"]);
  await new Promise((r) => setTimeout(r, 400));
  writeFileSync(go, "");
  await Promise.all([a, b]);
  const events = lines(log).filter((l) => !l.endsWith("in-gate"));
  let inside = 0, most = 0;
  for (const e of events) { if (e.endsWith(" enter")) most = Math.max(most, ++inside); if (e.endsWith(" exit")) inside--; }
  assert.equal(most, 1, `never two holders at once: ${events.join(", ")}`);
  assert.ok(events.includes("A enter"), events.join(", "));
  assert.ok(events.includes("B refused") || events.indexOf("B enter") > events.indexOf("A exit"), events.join(", "));
  assert.equal(existsSync(lock), false, "the last holder released its lock");
});

test("an abandoned gate (its holder ended inside it) is never recovered automatically: attach refuses, naming the gate and the remedy", (t) => {
  const d = dir(t), lock = join(d, "attach.lock"), gate = `${lock}.gate`;
  writeFileSync(lock, "999999999 dead\n");
  writeFileSync(gate, "999999998 dead\n");
  const old = new Date(Date.now() - 3600 * 1000);
  utimesSync(gate, old, old);
  assert.throws(() => exclusiveLock(lock, busy), (e) => e.code === "E_ATTACH_FAILED" && e.message.includes(gate) && /no attach is running/.test(e.message) && /remove/.test(e.message));
  assert.equal(readFileSync(gate, "utf8"), "999999998 dead\n", "the gate is left for the person who checks");
  assert.equal(readFileSync(lock, "utf8"), "999999999 dead\n");
});

test("concurrent contenders meeting an abandoned gate both refuse: never two holders", async (t) => {
  const d = dir(t), lock = join(d, "attach.lock"), log = join(d, "log"), go = join(d, "go");
  writeFileSync(lock, "999999999 dead\n");
  writeFileSync(`${lock}.gate`, "999999998 dead\n");
  const old = new Date(Date.now() - 3600 * 1000);
  utimesSync(`${lock}.gate`, old, old);
  writeFileSync(go, "");
  await Promise.all([contender(d, [lock, log, "A", "0", go, "300"]), contender(d, [lock, log, "B", "0", go, "300"])]);
  assert.deepEqual(lines(log).sort(), ["A refused", "B refused"]);
});
