// awebai/oats-aweb#236: spawn, take-over and retire never interleave on a retained
// seat's lock (`.aw-retained-seat.json`). Each change of the lock is one guarded step
// (lib/seat-lock.mjs): a retire removes only a lock it still owns at the moment it
// removes it, and of two take-overs of one lock exactly one wins. A guard or a
// moved-aside lock that a killed change left is reported by the next change with its
// whole fix, never adopted or removed. Each interleaving is driven by a preload, never
// by timing.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fakeAw } from "./helpers/fake-aw-grant.mjs";
import { readSeatLockGuarded } from "../oats-package/capabilities/oats-aweb/lib/seat-lock.mjs";

const HOOK = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const TEAM = "t:example.test";
const CONNECT = `\`aw workspace connect --service=https://fixture.invalid/api --team=${TEAM}\``;

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-236-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const source = join(base, "seats", "retained", ".aw");
  write(join(source, "signing.key"), "fixture-signing-key");
  write(join(source, "identity.yaml"), "alias: retained\ndid: did:key:zRetained\naddress: fixture.test/retained\n");
  write(join(source, "teams.yaml"), `active_team: ${TEAM}\n`);
  write(join(source, "workspace.yaml"), "alias: retained\naweb_url: https://fixture.invalid/api\n");
  const lock = join(dirname(source), ".aw-retained-seat.json");
  const homeOf = (name) => { const h = join(root, "agents", "dev", "instances", name); mkdirSync(h, { recursive: true }); return h; };
  return { base, root, source, lock, guard: `${lock}.guard`, held: `${lock}.held`, homeOf, bin: fakeAw(base) };
}
function hookEnv(fx, event, home, { identity = {}, env = {} } = {}) {
  return {
    ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, OATS_EVENT: event, OATS_INSTANCE: home.split("/").at(-1), OATS_HOME: home,
    OATS_WORKSPACE: fx.root, OATS_CONTEXT: fx.root, OATS_RUNTIME: "codex", FAKE_RETAINED: "1",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]),
    OATS_SETTINGS: JSON.stringify({ delivery: "session", identity: { mode: "local", source: fx.source, ...identity } }), ...env,
  };
}
const answer = (r) => { let doc; try { doc = JSON.parse(String(r.stdout).trim().split(/\n/).at(-1)); } catch { doc = undefined; } return { ...r, doc }; };
function runHook(fx, event, home, opts = {}) {
  return answer(spawnSync(process.execPath, [...(opts.preload ? ["--import", pathToFileURL(opts.preload).href] : []), HOOK, event], { encoding: "utf8", env: hookEnv(fx, event, home, opts) }));
}
function startHook(fx, event, home, opts = {}) {
  const child = spawn(process.execPath, [...(opts.preload ? ["--import", pathToFileURL(opts.preload).href] : []), HOOK, event], { env: hookEnv(fx, event, home, opts) });
  let stdout = "", stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  return new Promise((done) => child.on("close", (status) => done(answer({ status, stdout, stderr }))));
}
const until = async (cond, what) => { for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 25)); assert.ok(cond(), `timed out waiting for ${what}`); };
const goneHolder = (fx) => ({ home: join(fx.base, "elsewhere", "agents", "dev", "instances", "old-seat"), instance: "old-seat", team: TEAM, takenAt: "2026-11-01T10:00:00.000Z", host: "container-a" });

/** The issue's case 1 preload: on the hook's first read of the lock it answers the bytes
 *  that were there (A's lock) and writes a lock naming another home (B's take-over). */
function takeoverPreload(fx) {
  const file = join(fx.base, "takeover.mjs");
  writeFileSync(file, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const read = fs.readFileSync;
let once = false;
fs.readFileSync = function (p, ...args) {
  const result = read.call(this, p, ...args);
  if (!once && String(p) === process.env.LOCK) {
    once = true;
    fs.writeFileSync(p, JSON.stringify({ home: process.env.OTHER_HOME, instance: "other" }));
  }
  return result;
};
syncBuiltinESMExports();
`);
  return file;
}
/** After the hook's first read of the lock: say so (READ_MARK), then wait for GO. */
function pausePreload(fx) {
  const file = join(fx.base, "pause.mjs");
  // The read is made under the guard, so the pause comes once the guard is released.
  writeFileSync(file, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const read = fs.readFileSync, unlink = fs.unlinkSync;
let readIt = false, once = false;
fs.readFileSync = function (p, ...args) {
  const result = read.call(this, p, ...args);
  if (String(p) === process.env.LOCK) readIt = true;
  return result;
};
fs.unlinkSync = function (p, ...args) {
  const result = unlink.call(this, p, ...args);
  if (readIt && !once && String(p) === process.env.LOCK + ".guard") {
    once = true;
    fs.writeFileSync(process.env.READ_MARK, "read");
    while (!fs.existsSync(process.env.GO)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  return result;
};
syncBuiltinESMExports();
`);
  return file;
}
/** Before the hook's third exclusive open of the guard (a spawn's success rewrite, after
 *  its leftover check and its take): say so (PAUSE_MARK), then wait for GO. */
function pauseBeforeRewritePreload(fx) {
  const file = join(fx.base, "pause-rewrite.mjs");
  writeFileSync(file, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const open = fs.openSync;
let opens = 0;
fs.openSync = function (p, flags, ...args) {
  if (String(p) === process.env.GUARD && flags === "wx" && ++opens === 3) {
    fs.writeFileSync(process.env.PAUSE_MARK, "paused");
    while (!fs.existsSync(process.env.GO)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  return open.call(this, p, flags, ...args);
};
syncBuiltinESMExports();
`);
  return file;
}
/** Once the hook has read LOCK under the guard and released it (a spawn's rollback, when it held a fresh lock),
 *  or creates PAUSE_DIR (a spawn's copy, right after its take): say so (PAUSE_MARK),
 *  then wait for GO. */
function pauseAtPreload(fx) {
  const file = join(fx.base, "pause-at.mjs");
  writeFileSync(file, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const wait = () => { fs.writeFileSync(process.env.PAUSE_MARK, "paused"); while (!fs.existsSync(process.env.GO)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); };
const read = fs.readFileSync, mkdir = fs.mkdirSync, unlink = fs.unlinkSync;
let readIt = false, readOnce = false, mkdirOnce = false;
// The read is made under the guard, so the pause comes once the guard is released.
fs.readFileSync = function (p, ...args) {
  const result = read.call(this, p, ...args);
  if (process.env.LOCK && String(p) === process.env.LOCK) readIt = true;
  return result;
};
fs.unlinkSync = function (p, ...args) {
  const result = unlink.call(this, p, ...args);
  if (process.env.LOCK && readIt && !readOnce && String(p) === process.env.LOCK + ".guard") { readOnce = true; wait(); }
  return result;
};
fs.mkdirSync = function (p, ...args) {
  if (process.env.PAUSE_DIR && !mkdirOnce && String(p) === process.env.PAUSE_DIR) { mkdirOnce = true; wait(); }
  return mkdir.call(this, p, ...args);
};
syncBuiltinESMExports();
`);
  return file;
}
/** SIGKILLs the hook right after it moves the lock aside (a change killed mid-way). */
function killAfterMovePreload(fx) {
  const file = join(fx.base, "kill.mjs");
  writeFileSync(file, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const rename = fs.renameSync;
fs.renameSync = function (from, to, ...args) {
  const result = rename.call(this, from, to, ...args);
  if (String(to).endsWith(".held")) process.kill(process.pid, "SIGKILL");
  return result;
};
syncBuiltinESMExports();
`);
  return file;
}

test("1. a take-over that lands between a retire's read and its removal keeps its lock, and the retire says it did not remove it", (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a"), other = join(fx.base, "seat-b-home");
  const spawned = runHook(fx, "spawn", a);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const retired = runHook(fx, "retire", a, { preload: takeoverPreload(fx), env: { OATS_META: JSON.stringify(spawned.doc.meta), LOCK: fx.lock, OTHER_HOME: other } });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, other, "B's lock is in place");
  assert.match(retired.doc.warning, /left in place: this seat no longer owns it/);
  assert.match(retired.doc.warning, /so retire did not remove it/);
  assert.doesNotMatch(retired.doc.warning, /removed\)/);
  assert.equal(existsSync(fx.held), false);
  assert.equal(existsSync(fx.guard), false);
});

test("2. two take-overs of one lock: exactly one wins, and the other refuses naming the holder", async (t) => {
  const fx = fixture(t);
  write(fx.lock, JSON.stringify(goneHolder(fx)));
  const first = fx.homeOf("seat-one"), second = fx.homeOf("seat-two");
  const readMark = join(fx.base, "second-read"), go = join(fx.base, "go");
  // The second reads the lock, then waits while the first takes it over.
  const pending = startHook(fx, "spawn", second, { identity: { takeOver: true }, preload: pausePreload(fx), env: { LOCK: fx.lock, READ_MARK: readMark, GO: go } });
  let won;
  try {
    await until(() => existsSync(readMark), "the second take-over's read");
    won = runHook(fx, "spawn", first, { identity: { takeOver: true } });
  } finally {
    // Release the paused take-over however the first went, and let it end, before the fixture is removed.
    writeFileSync(go, "go");
  }
  const lost = await pending;
  assert.equal(won.status, 0, won.stdout + won.stderr);
  assert.notEqual(lost.status, 0, lost.stdout + lost.stderr);
  assert.match(lost.doc.warning, /changed after this spawn read it/);
  assert.ok(lost.doc.warning.includes(`home ${first}`), lost.doc.warning);
  assert.equal(lost.doc.meta, undefined);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, first, "the winner holds the lock");
  assert.equal(existsSync(join(second, ".aw")), false, "the loser copied nothing");
  assert.equal(existsSync(fx.held), false);
  assert.equal(existsSync(fx.guard), false);
});

test("3. the holder's retire, with no interleaving, removes its lock", (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a");
  const spawned = runHook(fx, "spawn", a);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, a);
  const retired = runHook(fx, "retire", a, { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(existsSync(fx.lock), false);
  assert.match(retired.doc.warning, /released the retained identity "retained" \(lock .* removed\)/);
  assert.equal(existsSync(fx.held), false);
  assert.equal(existsSync(fx.guard), false);
});

test("4. a retire killed while it changed the lock: the next spawn refuses, naming the guard, then the moved lock, and the fix for each", (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a"), b = fx.homeOf("seat-b");
  const spawned = runHook(fx, "spawn", a);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const killed = runHook(fx, "retire", a, { preload: killAfterMovePreload(fx), env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
  assert.equal(killed.signal, "SIGKILL");
  assert.equal(existsSync(fx.lock), false, "the lock was moved aside");
  const heldText = readFileSync(fx.held, "utf8"), guardText = readFileSync(fx.guard, "utf8");

  const first = runHook(fx, "spawn", b);
  assert.notEqual(first.status, 0, first.stdout + first.stderr);
  assert.ok(first.doc.warning.includes(`${fx.guard} exists`), first.doc.warning);
  assert.ok(first.doc.warning.includes(`remove ${fx.guard} and retry`), first.doc.warning);
  assert.match(first.doc.warning, /never removed automatically or by age/);
  assert.equal(readFileSync(fx.guard, "utf8"), guardText, "the guard is not adopted or removed");

  rmSync(fx.guard); // the operator's fix, once nothing runs
  const second = runHook(fx, "spawn", b);
  assert.notEqual(second.status, 0, second.stdout + second.stderr);
  assert.ok(second.doc.warning.includes(`${fx.held} is this retained identity's lock, moved aside`), second.doc.warning);
  assert.ok(second.doc.warning.includes(`home ${a}`), second.doc.warning);
  assert.ok(second.doc.warning.includes(`\`mv -- '${fx.held}' '${fx.lock}'\``), second.doc.warning);
  assert.ok(second.doc.warning.includes(`otherwise remove ${fx.held}`), second.doc.warning);
  assert.equal(readFileSync(fx.held, "utf8"), heldText, "the moved lock is not adopted or removed");
  assert.equal(existsSync(fx.lock), false, "no lock was taken");
  assert.equal(existsSync(join(b, ".aw")), false, "nothing copied");
});

test("a moved-aside lock is reported by a take-over and by a retire too", (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a"), b = fx.homeOf("seat-b");
  const spawned = runHook(fx, "spawn", a);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  write(fx.held, JSON.stringify(goneHolder(fx)));
  const takeover = runHook(fx, "spawn", b, { identity: { takeOver: true } });
  assert.notEqual(takeover.status, 0, takeover.stdout + takeover.stderr);
  assert.ok(takeover.doc.warning.includes(`${fx.held} is this retained identity's lock, moved aside`), takeover.doc.warning);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, a, "the lock is untouched");
  const retired = runHook(fx, "retire", a, { env: { OATS_META: JSON.stringify(spawned.doc.meta) } });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.ok(retired.doc.warning.includes(`left in place: ${fx.held} is this retained identity's lock, moved aside`), retired.doc.warning);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, a);
  assert.ok(existsSync(fx.held));
});

test("a take-over with no interleaving still takes over, and leaves no private file", (t) => {
  const fx = fixture(t);
  write(fx.lock, JSON.stringify(goneHolder(fx)));
  const b = fx.homeOf("seat-b");
  const r = runHook(fx, "spawn", b, { identity: { takeOver: true } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lock = JSON.parse(readFileSync(fx.lock, "utf8"));
  assert.equal(lock.home, b);
  assert.equal(lock.alias, "retained", "the success rewrite went through the guard");
  assert.equal(existsSync(fx.held), false);
  assert.equal(existsSync(fx.guard), false);
});

test("a retire retried after one killed mid-way reports the guard, then the moved lock, with the lock's name empty", (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a");
  const spawned = runHook(fx, "spawn", a);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const meta = { OATS_META: JSON.stringify(spawned.doc.meta) };
  assert.equal(runHook(fx, "retire", a, { preload: killAfterMovePreload(fx), env: meta }).signal, "SIGKILL");
  assert.equal(existsSync(fx.lock), false);
  const first = runHook(fx, "retire", a, { env: meta });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.ok(first.doc.warning.includes(`left in place: ${fx.guard} exists`), first.doc.warning);
  assert.ok(first.doc.warning.includes(`remove ${fx.guard} and retry`), first.doc.warning);
  assert.doesNotMatch(first.doc.warning, /already gone/);
  rmSync(fx.guard);
  const second = runHook(fx, "retire", a, { env: meta });
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.ok(second.doc.warning.includes(`left in place: ${fx.held} is this retained identity's lock, moved aside`), second.doc.warning);
  assert.doesNotMatch(second.doc.warning, /already gone/);
  assert.ok(existsSync(fx.held), "the moved lock is not removed");
});

test("a spawn that would refuse the holder reports a moved-aside lock first", (t) => {
  const fx = fixture(t);
  const live = fx.homeOf("seat-a");
  write(fx.lock, JSON.stringify({ home: live, instance: "seat-a" }));
  write(fx.held, JSON.stringify(goneHolder(fx)));
  const r = runHook(fx, "spawn", fx.homeOf("seat-b"));
  assert.notEqual(r.status, 0);
  assert.ok(r.doc.warning.includes(`${fx.held} is this retained identity's lock, moved aside`), r.doc.warning);
});

test("a take-over killed between a spawn's take and its success rewrite: the spawn fails with the guard's whole fix", async (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a"), b = fx.homeOf("seat-b");
  const paused = join(fx.base, "a-paused"), go = join(fx.base, "go");
  const pending = startHook(fx, "spawn", a, { preload: pauseBeforeRewritePreload(fx), env: { GUARD: fx.guard, PAUSE_MARK: paused, GO: go } });
  let killed;
  try {
    await until(() => existsSync(paused), "the first spawn's pause before its rewrite");
    killed = runHook(fx, "spawn", b, { identity: { takeOver: true }, preload: killAfterMovePreload(fx) });
  } finally { writeFileSync(go, "go"); }
  const r = await pending;
  assert.equal(killed.signal, "SIGKILL", killed.stdout + killed.stderr);
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.doc.warning.includes(`remove ${fx.guard} and retry`), r.doc.warning);
  // The rollback cannot read the lock under its guard either: who holds it is unknown, so nothing is reconnected and the copy stays.
  assert.match(r.doc.warning, /whether another seat took the identity over is unknown/);
  assert.equal(existsSync(join(a, ".aw")), true, "the copy is kept while ownership is unknown");
});

test("a take-over that completes while a spawn is seated: the spawn leaves the successor's binding and lock alone", async (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a"), b = fx.homeOf("seat-b");
  const paused = join(fx.base, "a-paused"), go = join(fx.base, "go");
  const pending = startHook(fx, "spawn", a, { preload: pauseBeforeRewritePreload(fx), env: { GUARD: fx.guard, PAUSE_MARK: paused, GO: go } });
  let won;
  try {
    await until(() => existsSync(paused), "the first spawn's pause before its rewrite");
    won = runHook(fx, "spawn", b, { identity: { takeOver: true } });
  } finally { writeFileSync(go, "go"); }
  const lost = await pending;
  assert.equal(won.status, 0, won.stdout + won.stderr);
  assert.notEqual(lost.status, 0, lost.stdout + lost.stderr);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, b);
  const connects = readFileSync(join(fx.base, "aw.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    .filter((c) => c.argv[0] === "workspace" && c.argv[1] === "connect").map((c) => c.cwd);
  assert.deepEqual(connects, [a, b], "the binding is not taken back to the legacy home");
  assert.match(lost.doc.warning, /was not restored to the legacy home/);
  assert.ok(lost.doc.warning.includes(`the binding may point at this home, if this spawn's connect ran after that seat's: run ${CONNECT} from ${b}`), lost.doc.warning);
  assert.equal(existsSync(join(a, ".aw")), false, "the losing seat's copy was removed");
});

test("the moved-aside lock's recovery command works for a path with spaces and quotes", (t) => {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-236-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const lock = join(base, "seat with 'spaces'", ".aw-retained-seat.json");
  write(`${lock}.held`, JSON.stringify({ home: "/elsewhere/seat-a", instance: "seat-a" }));
  let message = "";
  try { readSeatLockGuarded(lock, { who: { op: "spawn", instance: "seat-b", home: "/elsewhere/seat-b" } }); } catch (e) { message = e.message; }
  const command = message.match(/`(mv [^`]+)`/)?.[1];
  assert.ok(command, message);
  const r = spawnSync("/bin/sh", ["-c", command], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(`${lock}.held`), false);
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).instance, "seat-a");
});

const connectsIn = (fx) => readFileSync(join(fx.base, "aw.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  .filter((c) => c.argv[0] === "workspace" && c.argv[1] === "connect").map((c) => c.cwd);

test("a take-over that lands while a spawn's rollback reconnects the legacy home: the spawn says the binding may be the legacy home's, and names the fix", async (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a"), b = fx.homeOf("seat-b");
  const paused = join(fx.base, "a-paused"), go = join(fx.base, "go");
  // A connects, fails its check, and pauses at its rollback's read of its own lock.
  const pending = startHook(fx, "spawn", a, { preload: pauseAtPreload(fx), env: { LOCK: fx.lock, PAUSE_MARK: paused, GO: go, FAKE_RETAINED_FAIL: "check" } });
  let won;
  try {
    await until(() => existsSync(paused), "the rollback's read");
    won = runHook(fx, "spawn", b, { identity: { takeOver: true } });
  } finally { writeFileSync(go, "go"); }
  const lost = await pending;
  assert.equal(won.status, 0, won.stdout + won.stderr);
  assert.equal(lost.status, 1, lost.stdout + lost.stderr);
  assert.deepEqual(connectsIn(fx), [a, b, dirname(fx.source)]);
  assert.ok(lost.doc.warning.includes("the server binding was restored to the legacy home and the copy removed, but another seat took the identity over while that ran"), lost.doc.warning);
  assert.ok(lost.doc.warning.includes(`so the binding may point at the legacy home, not at that seat: run ${CONNECT} from ${b}`), lost.doc.warning);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, b, "the successor's lock is left alone");
});

test("a take-over that lands between a spawn's take and its connect: the spawn fails, saying the binding may be this home's, and names the fix", async (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a"), b = fx.homeOf("seat-b");
  const paused = join(fx.base, "a-paused"), go = join(fx.base, "go");
  const pending = startHook(fx, "spawn", a, { preload: pauseAtPreload(fx), env: { PAUSE_DIR: join(a, ".aw"), PAUSE_MARK: paused, GO: go } });
  let won;
  try {
    await until(() => existsSync(paused), "the spawn's copy, after its take");
    won = runHook(fx, "spawn", b, { identity: { takeOver: true } });
  } finally { writeFileSync(go, "go"); }
  const lost = await pending;
  assert.equal(won.status, 0, won.stdout + won.stderr);
  assert.equal(lost.status, 1, lost.stdout + lost.stderr);
  assert.deepEqual(connectsIn(fx), [b, a], "the legacy home is not reconnected");
  assert.ok(lost.doc.warning.includes(`the binding may point at this home, if this spawn's connect ran after that seat's: run ${CONNECT} from ${b}`), lost.doc.warning);
  assert.equal(existsSync(join(a, ".aw")), false);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, b);
});

test("a take-over that lands while a spawn's failed reconnect of the legacy home runs: the spawn names the holder and its fix, uncut", async (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a"), b = fx.homeOf("seat-b");
  const paused = join(fx.base, "a-paused"), go = join(fx.base, "go");
  // A connects, fails its check, reads its own lock in rollback, and its reconnect of the legacy home fails.
  const pending = startHook(fx, "spawn", a, { preload: pauseAtPreload(fx), env: { LOCK: fx.lock, PAUSE_MARK: paused, GO: go, FAKE_RETAINED_FAIL: "check", FAKE_RETAINED_RESTORE_FAIL: "1" } });
  let won;
  try {
    await until(() => existsSync(paused), "the rollback's read");
    won = runHook(fx, "spawn", b, { identity: { takeOver: true } });
  } finally { writeFileSync(go, "go"); }
  const lost = await pending;
  assert.equal(won.status, 0, won.stdout + won.stderr);
  assert.equal(lost.status, 1, lost.stdout + lost.stderr);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, b);
  assert.ok(lost.doc.warning.includes("the reconnect of the legacy home failed, and another seat took the identity over while it ran"), lost.doc.warning);
  assert.ok(lost.doc.warning.includes(`the binding may point at the legacy home or at this home, not at that seat; this seat's copy was kept at ${join(a, ".aw")}: run ${CONNECT} from ${b}`), lost.doc.warning);
  assert.doesNotMatch(lost.doc.warning, /binding still points at/);
  assert.equal(existsSync(join(a, ".aw")), true, "the copy is kept: the restore did not succeed");
});

test("a take-over that lands while a spawn registers with the host wake broker: the spawn fails, deregisters the home and names the fix", async (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a"), b = fx.homeOf("seat-b");
  const paused = join(fx.base, "a-paused"), go = join(fx.base, "go");
  const preload = join(fx.base, "pause-wake.mjs");
  writeFileSync(preload, `import cp from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const exec = cp.execFileSync;
let once = false;
cp.execFileSync = function (file, args, ...rest) {
  if (!once && file === "aw" && args[0] === "wake" && args[1] === "register") {
    once = true;
    fs.writeFileSync(process.env.PAUSE_MARK, "paused");
    while (!fs.existsSync(process.env.GO)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  return exec.call(this, file, args, ...rest);
};
syncBuiltinESMExports();
`);
  const pending = startHook(fx, "spawn", a, { preload, env: { PAUSE_MARK: paused, GO: go } });
  let won;
  try {
    await until(() => existsSync(paused), "the wake registration");
    won = runHook(fx, "spawn", b, { identity: { takeOver: true } });
  } finally { writeFileSync(go, "go"); }
  const lost = await pending;
  assert.equal(won.status, 0, won.stdout + won.stderr);
  assert.equal(lost.status, 1, lost.stdout + lost.stderr);
  assert.equal(lost.doc.brief, undefined, "the losing seat is not briefed");
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, b);
  assert.ok(lost.doc.warning.includes(`the binding may point at this home, if this spawn's connect ran after that seat's: run ${CONNECT} from ${b}`), lost.doc.warning);
  const awCalls = readFileSync(join(fx.base, "aw.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const deregistered = awCalls.findIndex((c) => c.argv[0] === "wake" && c.argv[1] === "deregister" && c.argv.includes(a));
  assert.ok(deregistered > awCalls.findIndex((c) => c.argv[0] === "wake" && c.argv[1] === "register" && c.argv.includes(a)), "the new registration is removed");
  assert.equal(existsSync(join(a, ".aw")), false);
});

/** Before the hook's first `aw <PAUSE_AW>` (words joined by spaces): say so (PAUSE_MARK),
 *  then wait for GO. */
function pauseAtAwPreload(fx) {
  const file = join(fx.base, "pause-aw.mjs");
  writeFileSync(file, `import cp from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const exec = cp.execFileSync;
let once = false;
cp.execFileSync = function (f, args, ...rest) {
  if (!once && f === "aw" && args.slice(0, process.env.PAUSE_AW.split(" ").length).join(" ") === process.env.PAUSE_AW) {
    once = true;
    fs.writeFileSync(process.env.PAUSE_MARK, "paused");
    while (!fs.existsSync(process.env.GO)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  return exec.call(this, f, args, ...rest);
};
syncBuiltinESMExports();
`);
  return file;
}
/** Right after the hook's second move of the lock aside (a take-over's success rewrite,
 *  holding the guard, with the lock's name empty): say so (PAUSE_MARK), wait for GO. */
function pauseInRewritePreload(fx) {
  const file = join(fx.base, "pause-held.mjs");
  writeFileSync(file, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const rename = fs.renameSync;
let moved = 0;
fs.renameSync = function (from, to, ...args) {
  const result = rename.call(this, from, to, ...args);
  if (String(to) === process.env.HELD && ++moved === 2) {
    fs.writeFileSync(process.env.PAUSE_MARK, "paused");
    while (!fs.existsSync(process.env.GO)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  return result;
};
syncBuiltinESMExports();
`);
  return file;
}
/** A pauses before `aw <step>`; B takes over and pauses inside its success rewrite, with
 *  the lock moved aside; A resumes and ends; then B. */
async function midRewriteRace(fx, step, envA = {}) {
  const a = fx.homeOf("seat-a"), b = fx.homeOf("seat-b");
  const pausedA = join(fx.base, "a-paused"), goA = join(fx.base, "go-a"), pausedB = join(fx.base, "b-paused"), goB = join(fx.base, "go-b");
  const pendingA = startHook(fx, "spawn", a, { preload: pauseAtAwPreload(fx), env: { PAUSE_AW: step, PAUSE_MARK: pausedA, GO: goA, ...envA } });
  let pendingB, lost;
  try {
    await until(() => existsSync(pausedA), `A's aw ${step}`);
    pendingB = startHook(fx, "spawn", b, { identity: { takeOver: true }, preload: pauseInRewritePreload(fx), env: { HELD: fx.held, PAUSE_MARK: pausedB, GO: goB } });
    await until(() => existsSync(pausedB), "B's rewrite, with the lock moved aside");
    assert.equal(existsSync(fx.lock), false);
    writeFileSync(goA, "go");
    lost = await pendingA;
  } finally { writeFileSync(goA, "go"); writeFileSync(goB, "go"); }
  const won = await pendingB;
  return { a, b, lost, won };
}

test("a take-over mid-rewrite while a spawn registers with the wake broker: the spawn's read waits for the guard, and the spawn fails saying the holder is unknown", async (t) => {
  const fx = fixture(t);
  const { a, b, lost, won } = await midRewriteRace(fx, "wake register");
  assert.equal(won.status, 0, won.stdout + won.stderr);
  assert.equal(lost.status, 1, lost.stdout + lost.stderr);
  assert.equal(lost.doc.brief, undefined, "the losing seat is not briefed");
  assert.match(lost.doc.warning, /who holds the retained identity's lock .* is unknown after this spawn's last aw call/);
  assert.match(lost.doc.warning, /whether another seat took the identity over is unknown/);
  assert.ok(lost.doc.warning.includes(`kept at ${join(a, ".aw")}`), lost.doc.warning);
  const awCalls = readFileSync(join(fx.base, "aw.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(awCalls.some((c) => c.argv[0] === "wake" && c.argv[1] === "deregister" && c.argv.includes(a)), "the new registration is removed");
  assert.deepEqual(connectsIn(fx), [a, b], "the legacy home is not reconnected while the holder is unknown");
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, b);
});

test("a take-over mid-rewrite while a failing spawn rolls back: the rollback's read waits for the guard, and nothing is reconnected while the holder is unknown", async (t) => {
  const fx = fixture(t);
  const { a, b, lost, won } = await midRewriteRace(fx, "check", { FAKE_RETAINED_FAIL: "check" });
  assert.equal(won.status, 0, won.stdout + won.stderr);
  assert.equal(lost.status, 1, lost.stdout + lost.stderr);
  assert.match(lost.doc.warning, /whether another seat took the identity over is unknown/);
  assert.ok(lost.doc.warning.includes(`run ${CONNECT} from the home of the seat that holds it, or from ${dirname(fx.source)} if none does`), lost.doc.warning);
  assert.deepEqual(connectsIn(fx), [a, b]);
  assert.equal(existsSync(join(a, ".aw")), true, "the copy is kept while ownership is unknown");
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, b);
});

/** Pauses twice: before the hook's `aw check` (MARK1/GO1), and before it removes
 *  PAUSE_REMOVE, its copy, in rollback (MARK2/GO2). */
function pauseCheckAndRemovePreload(fx) {
  const file = join(fx.base, "pause-check-remove.mjs");
  writeFileSync(file, `import fs from "node:fs";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const wait = (mark, go) => { fs.writeFileSync(mark, "paused"); while (!fs.existsSync(go)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); };
const exec = cp.execFileSync, rm = fs.rmSync;
let checked = false, removed = false;
cp.execFileSync = function (f, args, ...rest) {
  if (process.env.MARK1 && !checked && f === "aw" && args[0] === "check") { checked = true; wait(process.env.MARK1, process.env.GO1); }
  return exec.call(this, f, args, ...rest);
};
fs.rmSync = function (p, ...args) {
  if (!removed && String(p) === process.env.PAUSE_REMOVE) { removed = true; wait(process.env.MARK2, process.env.GO2); }
  return rm.call(this, p, ...args);
};
syncBuiltinESMExports();
`);
  return file;
}

test("a second take-over that lands in a rollback's cleanup: the exit names the holder from its last guarded read, not the first successor", async (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a"), b = fx.homeOf("seat-b"), c = fx.homeOf("seat-c");
  const m1 = join(fx.base, "m1"), g1 = join(fx.base, "g1"), m2 = join(fx.base, "m2"), g2 = join(fx.base, "g2");
  // A connects and pauses at its check; B takes over. A's check fails, its rollback reads
  // B and pauses before removing its copy; C takes over from B. A then releases.
  const pending = startHook(fx, "spawn", a, { preload: pauseCheckAndRemovePreload(fx), env: { FAKE_RETAINED_FAIL: "check", PAUSE_REMOVE: join(a, ".aw"), MARK1: m1, GO1: g1, MARK2: m2, GO2: g2 } });
  let wonB, wonC;
  try {
    await until(() => existsSync(m1), "A's check");
    wonB = runHook(fx, "spawn", b, { identity: { takeOver: true } });
    writeFileSync(g1, "go");
    await until(() => existsSync(m2), "A's cleanup");
    wonC = runHook(fx, "spawn", c, { identity: { takeOver: true } });
  } finally { writeFileSync(g1, "go"); writeFileSync(g2, "go"); }
  const lost = await pending;
  assert.equal(wonB.status, 0, wonB.stdout + wonB.stderr);
  assert.equal(wonC.status, 0, wonC.stdout + wonC.stderr);
  assert.equal(lost.status, 1, lost.stdout + lost.stderr);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, c);
  assert.ok(lost.doc.warning.includes(`run ${CONNECT} from ${c}`), lost.doc.warning);
  assert.doesNotMatch(lost.doc.warning, new RegExp(`from ${b.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`), "the displaced seat is not named");
});

test("a take-over that lands after a rollback's reconnect and before its cleanup: the exit names that holder", async (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a"), b = fx.homeOf("seat-b");
  const m2 = join(fx.base, "m2"), g2 = join(fx.base, "g2");
  // A's check fails; its rollback finds its own lock, reconnects the legacy home, and pauses
  // before removing its copy; B takes over then.
  const pending = startHook(fx, "spawn", a, { preload: pauseCheckAndRemovePreload(fx), env: { FAKE_RETAINED_FAIL: "check", PAUSE_REMOVE: join(a, ".aw"), MARK2: m2, GO2: g2 } });
  let won;
  try {
    await until(() => existsSync(m2), "A's cleanup");
    won = runHook(fx, "spawn", b, { identity: { takeOver: true } });
  } finally { writeFileSync(g2, "go"); }
  const lost = await pending;
  assert.equal(won.status, 0, won.stdout + won.stderr);
  assert.equal(lost.status, 1, lost.stdout + lost.stderr);
  assert.deepEqual(connectsIn(fx), [a, dirname(fx.source), b]);
  assert.ok(lost.doc.warning.includes("but another seat took the identity over while that ran"), lost.doc.warning);
  assert.ok(lost.doc.warning.includes(`run ${CONNECT} from ${b}`), lost.doc.warning);
});

test("a take-over during a spawn's success rewrite, then another during its cleanup: only the holder of the last guarded read is named anywhere", async (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a"), b = fx.homeOf("seat-b"), c = fx.homeOf("seat-c");
  const m1 = join(fx.base, "m1"), g1 = join(fx.base, "g1"), m2 = join(fx.base, "m2"), g2 = join(fx.base, "g2");
  const preload = join(fx.base, "pause-rewrite-remove.mjs");
  // Pauses before the hook's third exclusive open of the guard (its success rewrite), and
  // before it removes its copy in rollback.
  writeFileSync(preload, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const wait = (mark, go) => { fs.writeFileSync(mark, "paused"); while (!fs.existsSync(go)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); };
const open = fs.openSync, rm = fs.rmSync;
let opens = 0, removed = false;
fs.openSync = function (p, flags, ...args) {
  if (String(p) === process.env.GUARD && flags === "wx" && ++opens === 3) wait(process.env.MARK1, process.env.GO1);
  return open.call(this, p, flags, ...args);
};
fs.rmSync = function (p, ...args) {
  if (!removed && String(p) === process.env.PAUSE_REMOVE) { removed = true; wait(process.env.MARK2, process.env.GO2); }
  return rm.call(this, p, ...args);
};
syncBuiltinESMExports();
`);
  const pending = startHook(fx, "spawn", a, { preload, env: { GUARD: fx.guard, PAUSE_REMOVE: join(a, ".aw"), MARK1: m1, GO1: g1, MARK2: m2, GO2: g2 } });
  let wonB, wonC;
  try {
    await until(() => existsSync(m1), "A's success rewrite");
    wonB = runHook(fx, "spawn", b, { identity: { takeOver: true } });
    writeFileSync(g1, "go");
    await until(() => existsSync(m2), "A's cleanup");
    wonC = runHook(fx, "spawn", c, { identity: { takeOver: true } });
  } finally { writeFileSync(g1, "go"); writeFileSync(g2, "go"); }
  const lost = await pending;
  assert.equal(wonB.status, 0, wonB.stdout + wonB.stderr);
  assert.equal(wonC.status, 0, wonC.stdout + wonC.stderr);
  assert.equal(lost.status, 1, lost.stdout + lost.stderr);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, c);
  assert.ok(lost.doc.warning.includes(`run ${CONNECT} from ${c}`), lost.doc.warning);
  assert.equal(lost.doc.warning.includes(b), false, `the displaced seat is named nowhere: ${lost.doc.warning}`);
});

/** The take-over's exclusive create of the lock writes 20 bytes, then fails with ENOSPC
 *  (a full disk); with STUCK_UNLINK set, removing that partial file fails too. */
function partialWritePreload(fx) {
  const file = join(fx.base, "partial-write.mjs");
  writeFileSync(file, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const write = fs.writeFileSync, unlink = fs.unlinkSync;
const lock = ${JSON.stringify(fx.lock)};
fs.writeFileSync = function (path, data, options, ...rest) {
  if (String(path) === lock && options?.flag === "wx") {
    write.call(this, path, String(data).slice(0, 20), options);
    throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
  }
  return write.call(this, path, data, options, ...rest);
};
fs.unlinkSync = function (path, ...rest) {
  if (process.env.STUCK_UNLINK && String(path) === lock) throw Object.assign(new Error("EACCES: permission denied, unlink"), { code: "EACCES" });
  return unlink.call(this, path, ...rest);
};
syncBuiltinESMExports();
`);
  return file;
}

test("a take-over whose lock write fails part-way removes its own partial write and puts the holder's lock back", (t) => {
  const fx = fixture(t);
  write(fx.lock, JSON.stringify(goneHolder(fx)));
  const before = readFileSync(fx.lock, "utf8");
  const b = fx.homeOf("seat-b");
  const r = runHook(fx, "spawn", b, { identity: { takeOver: true }, preload: partialWritePreload(fx) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.doc.warning.includes(`the retained identity's lock ${fx.lock} could not be taken (ENOSPC); nothing copied`), r.doc.warning);
  assert.equal(readFileSync(fx.lock, "utf8"), before, "the holder's lock is back at its name");
  assert.equal(existsSync(fx.held), false);
  assert.equal(existsSync(fx.guard), false);
  assert.equal(existsSync(join(b, ".aw")), false, "nothing copied");
});

test("a take-over whose partial lock write can't be removed names the moved lock and the whole fix, uncut", (t) => {
  const fx = fixture(t);
  write(fx.lock, JSON.stringify(goneHolder(fx)));
  const before = readFileSync(fx.lock, "utf8");
  const b = fx.homeOf("seat-b");
  const r = runHook(fx, "spawn", b, { identity: { takeOver: true }, preload: partialWritePreload(fx), env: { STUCK_UNLINK: "1" } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(readFileSync(fx.held, "utf8"), before, "the holder's lock is kept at the private name");
  assert.equal(existsSync(fx.guard), false);
  const w = r.doc.warning;
  assert.ok(w.includes(`could not be taken (ENOSPC); nothing copied`), w);
  assert.ok(w.includes(`${fx.held} is this retained identity's lock, moved aside`), w);
  assert.ok(w.includes(`${fx.lock}, which is not a lock that can be read`), w);
  assert.ok(w.includes(`\`mv -f -- '${fx.held}' '${fx.lock}'\``), w);
  assert.ok(w.includes(`otherwise remove ${fx.held}`), w);
  assert.ok(w.endsWith("then retry"), w);
  // The next spawn reports the same pair with the same fix.
  const next = runHook(fx, "spawn", fx.homeOf("seat-c"), { identity: { takeOver: true } });
  assert.notEqual(next.status, 0, next.stdout + next.stderr);
  assert.ok(next.doc.warning.includes(`\`mv -f -- '${fx.held}' '${fx.lock}'\``), next.doc.warning);
});

/** Failures at the guard's record and at the moved lock's removal, by env:
 *  GUARD_WRITE_FAIL=<n> fails the write into the n-th guard this hook creates (ENOSPC);
 *  STUCK_GUARD makes removing the guard fail once that write failed; HELD_UNLINK_FAIL makes removing the moved
 *  lock fail (EIO); STUCK_RENAME makes moving it back to the lock's name fail;
 *  GUARD_UNLINK_FAIL=<n> fails the n-th removal of a guard (EIO); INSPECT_FAIL fails the
 *  first check of the moved lock after it is moved (EIO); CLOSE_FAIL=<n> makes closing
 *  the n-th guard report EIO after it closed. */
function stageFailPreload(fx) {
  const file = join(fx.base, "stage-fail.mjs");
  writeFileSync(file, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const open = fs.openSync, write = fs.writeSync, unlink = fs.unlinkSync, rename = fs.renameSync;
const lock = ${JSON.stringify(fx.lock)}, guard = lock + ".guard", held = lock + ".held";
const fail = (code) => Object.assign(new Error(code + ": injected"), { code });
let guards = 0, failed = false; const failing = new Set();
fs.openSync = function (path, ...rest) {
  const fd = open.call(this, path, ...rest);
  if (String(path) === guard && ++guards === Number(process.env.GUARD_WRITE_FAIL)) failing.add(fd);
  return fd;
};
fs.writeSync = function (fd, ...rest) { if (failing.has(fd)) { failed = true; throw fail("ENOSPC"); } return write.call(this, fd, ...rest); };
let guardUnlinks = 0, moved = false, guardFd, guardOpens = 0;
const lstat = fs.lstatSync, close = fs.closeSync;
fs.lstatSync = function (path, ...rest) {
  if (process.env.INSPECT_FAIL && moved && String(path) === held) { moved = false; throw fail("EIO"); }
  return lstat.call(this, path, ...rest);
};
const openGuard = fs.openSync;
fs.openSync = function (path, ...rest) { const fd = openGuard.call(this, path, ...rest); if (String(path) === guard && ++guardOpens === Number(process.env.CLOSE_FAIL)) guardFd = fd; return fd; };
fs.closeSync = function (fd, ...rest) { const r = close.call(this, fd, ...rest); if (fd === guardFd) { guardFd = undefined; throw fail("EIO"); } return r; };
fs.unlinkSync = function (path, ...rest) {
  if (process.env.STUCK_GUARD && failed && String(path) === guard) throw fail("EACCES");
  if (String(path) === guard && ++guardUnlinks === Number(process.env.GUARD_UNLINK_FAIL)) throw fail("EIO");
  if (process.env.HELD_UNLINK_FAIL && String(path) === held) throw fail("EIO");
  return unlink.call(this, path, ...rest);
};
fs.renameSync = function (from, to, ...rest) {
  if (process.env.STUCK_RENAME && String(from) === held) throw fail("EIO");
  const r = rename.call(this, from, to, ...rest);
  if (String(to) === held) moved = true;
  return r;
};
syncBuiltinESMExports();
`);
  return file;
}
function takeOverWith(t, env) {
  const fx = fixture(t);
  write(fx.lock, JSON.stringify(goneHolder(fx)));
  const before = readFileSync(fx.lock, "utf8");
  const b = fx.homeOf("seat-b");
  const r = runHook(fx, "spawn", b, { identity: { takeOver: true }, preload: stageFailPreload(fx), env });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(existsSync(join(b, ".aw")), false, "nothing copied");
  return { fx, before, b, r, w: r.doc.warning };
}

test("a take-over whose guard can't be recorded removes the guard it created, and the lock is as it was", (t) => {
  const { fx, before, w } = takeOverWith(t, { GUARD_WRITE_FAIL: "2" });
  assert.ok(w.includes(`the retained identity's lock ${fx.lock} could not be taken (ENOSPC); nothing copied`), w);
  assert.equal(existsSync(fx.guard), false, "no guard left");
  assert.equal(readFileSync(fx.lock, "utf8"), before);
});

test("a take-over whose unrecorded guard can't be removed names it and its fix", (t) => {
  const { fx, w } = takeOverWith(t, { GUARD_WRITE_FAIL: "2", STUCK_GUARD: "1" });
  assert.ok(w.includes(`could not be taken (ENOSPC); nothing copied; ${fx.guard} is this change's guard, left by a step that failed (ENOSPC)`), w);
  assert.ok(w.includes(`remove ${fx.guard} and retry`), w);
  assert.equal(existsSync(fx.guard), true);
});

test("a take-over that can't remove the moved lock after writing its own puts the moved lock back", (t) => {
  const { fx, before, w } = takeOverWith(t, { HELD_UNLINK_FAIL: "1" });
  assert.ok(w.includes(`the retained identity's lock ${fx.lock} could not be taken (EIO); nothing copied`), w);
  assert.equal(readFileSync(fx.lock, "utf8"), before, "the holder's lock is back at its name");
  assert.equal(existsSync(fx.held), false);
  assert.equal(existsSync(fx.guard), false);
});

test("a take-over that can neither remove nor put back the moved lock names both files and the fix", (t) => {
  const { fx, before, b, w } = takeOverWith(t, { HELD_UNLINK_FAIL: "1", STUCK_RENAME: "1" });
  assert.equal(readFileSync(fx.held, "utf8"), before);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, b, "the lock's name holds the failed take-over's lock");
  assert.ok(w.includes(`could not be taken (EIO); nothing copied`), w);
  assert.ok(w.includes(`${fx.held} is this retained identity's lock, moved aside`), w);
  assert.ok(w.includes(`move it back over ${fx.lock}, which holds the lock of the change that failed (\`mv -f -- '${fx.held}' '${fx.lock}'\`)`), w);
  assert.ok(w.endsWith("then retry"), w);
});

test("a retire that can't remove its moved lock puts it back and says it is left in place", (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a");
  const spawned = runHook(fx, "spawn", a);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const before = readFileSync(fx.lock, "utf8");
  const r = runHook(fx, "retire", a, { preload: stageFailPreload(fx), env: { OATS_META: JSON.stringify(spawned.doc.meta), HELD_UNLINK_FAIL: "1" } });
  assert.ok(r.doc.warning.includes(`lock ${fx.lock} left in place: it could not be removed (EIO)`), r.doc.warning);
  assert.equal(readFileSync(fx.lock, "utf8"), before, "the lock is back at its name");
  assert.equal(existsSync(fx.held), false);
  assert.equal(existsSync(fx.guard), false);
});

const awCalls = (fx) => existsSync(join(fx.base, "aw.log")) ? readFileSync(join(fx.base, "aw.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

test("a take-over whose guard can't be removed after it took the lock stops before any aw call, naming the guard and the lock", (t) => {
  const fx = fixture(t);
  write(fx.lock, JSON.stringify(goneHolder(fx)));
  const b = fx.homeOf("seat-b");
  const r = runHook(fx, "spawn", b, { identity: { takeOver: true }, preload: stageFailPreload(fx), env: { GUARD_UNLINK_FAIL: "2" } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const w = r.doc.warning;
  assert.ok(w.includes(`the retained identity's lock ${fx.lock} was taken for this spawn, but that step left files it could not clean, so nothing was copied`), w);
  assert.ok(w.includes(`${fx.guard} is this change's guard, and it could not be removed (EIO)`), w);
  assert.ok(w.includes(`remove ${fx.guard} and retry; then remove ${fx.lock} if it still names ${b}`), w);
  assert.equal(awCalls(fx).some((c) => c.argv[0] === "workspace"), false, "no aw call after the step");
  assert.equal(existsSync(join(b, ".aw")), false, "nothing copied");
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, b);
});

test("a spawn whose guard can't be removed after its last guarded read is not briefed, and names the guard", (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a");
  const r = runHook(fx, "spawn", a, { preload: stageFailPreload(fx), env: { GUARD_UNLINK_FAIL: "4" } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.doc.brief, undefined, "the seat is not briefed");
  const w = r.doc.warning;
  assert.ok(w.includes("is unknown after this spawn's last aw call (a lock step of this spawn left files it could not clean, named in this failure)"), w);
  assert.ok(w.includes(`${fx.guard} is this change's guard, and it could not be removed (EIO)`), w);
  assert.ok(w.includes(`remove ${fx.guard} and retry`), w);
  assert.ok(w.includes("the seat is not briefed"), w);
  assert.equal(existsSync(fx.guard), true);
});

test("a retire that links another seat's lock back but can't remove the moved name names it and its fix, exit unchanged", (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a"), other = join(fx.base, "seat-b-home");
  const spawned = runHook(fx, "spawn", a);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const both = join(fx.base, "takeover-and-stuck-held.mjs");
  writeFileSync(both, `import ${JSON.stringify(pathToFileURL(takeoverPreload(fx)).href)};\nimport ${JSON.stringify(pathToFileURL(stageFailPreload(fx)).href)};\n`);
  const retired = runHook(fx, "retire", a, { preload: both, env: { OATS_META: JSON.stringify(spawned.doc.meta), LOCK: fx.lock, OTHER_HOME: other, HELD_UNLINK_FAIL: "1" } });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, other, "B's lock is in place");
  const w = retired.doc.warning;
  assert.match(w, /left in place: this seat no longer owns it/);
  assert.ok(w.includes(`that step left files it could not clean: ${fx.held} is a second name of the lock now at ${fx.lock}, left because it could not be removed (EIO)`), w);
  assert.ok(w.includes(`remove ${fx.held}; then retry`), w);
  assert.equal(existsSync(fx.guard), false);
});

test("a rollback whose read after its reconnect leaves the guard stops there, keeping the copy and the lock, and names the guard", (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a");
  const r = runHook(fx, "spawn", a, { preload: stageFailPreload(fx), env: { GUARD_UNLINK_FAIL: "4", FAKE_RETAINED_FAIL: "check" } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const w = r.doc.warning;
  assert.ok(w.includes("the server binding was restored to the legacy home, but the lock's read after that left files it could not clean"), w);
  assert.ok(w.includes(`${fx.guard} is this change's guard, and it could not be removed (EIO)`), w);
  assert.ok(w.includes(`remove ${fx.guard} and retry`), w);
  assert.equal(existsSync(join(a, ".aw")), true, "the copy is kept");
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, a, "the lock is left in place");
});

test("a take-over that can't inspect the lock it moved aside puts it back untouched", (t) => {
  const fx = fixture(t);
  write(fx.lock, JSON.stringify(goneHolder(fx)));
  const before = readFileSync(fx.lock, "utf8");
  const b = fx.homeOf("seat-b");
  const r = runHook(fx, "spawn", b, { identity: { takeOver: true }, preload: stageFailPreload(fx), env: { INSPECT_FAIL: "1" } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.doc.warning.includes(`the retained identity's lock ${fx.lock} could not be taken (EIO); nothing copied`), r.doc.warning);
  assert.equal(readFileSync(fx.lock, "utf8"), before);
  assert.equal(existsSync(fx.held), false);
  assert.equal(existsSync(fx.guard), false);
});

test("a guard whose close reports an error is removed, and the spawn says the guard could not be taken", (t) => {
  const fx = fixture(t);
  const a = fx.homeOf("seat-a");
  const r = runHook(fx, "spawn", a, { preload: stageFailPreload(fx), env: { CLOSE_FAIL: "1" } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.doc.warning.includes(`the guard ${fx.guard} could not be taken (EIO), so the lock was not read`), r.doc.warning);
  assert.doesNotMatch(r.doc.warning, /takeOver/);
  assert.equal(existsSync(fx.guard), false);
  assert.equal(existsSync(fx.lock), false);
});
