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
