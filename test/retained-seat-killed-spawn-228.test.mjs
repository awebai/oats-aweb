// awebai/oats-aweb#228: a retained seat's spawn that fails or is killed never
// deletes the standing identity's workspace. A compensating retire that has no meta
// (a hook killed, or a failure after `aw workspace connect`) still has the home's
// captured settings, whose identity.source is what made spawn take the retained
// route: it retires the home as a retained seat, never runs `aw workspace delete`,
// releases the lock only when the lock names this home, and names the way to point
// the identity's binding back at its source.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fakeAw } from "./helpers/fake-aw-grant.mjs";

const HOOK = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const TEAM = "t:example.test";

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-228-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "retained"); mkdirSync(home, { recursive: true });
  const source = join(base, "seats", "retained", ".aw");
  write(join(source, "signing.key"), "fixture-signing-key");
  write(join(source, "identity.yaml"), "alias: retained\ndid: did:key:zRetained\naddress: fixture.test/retained\n");
  write(join(source, "teams.yaml"), `active_team: ${TEAM}\n`);
  write(join(source, "workspace.yaml"), "alias: retained\naweb_url: https://fixture.invalid/api\n");
  return { base, root, home, source, legacyHome: dirname(source), lock: join(dirname(source), ".aw-retained-seat.json"), bin: fakeAw(base) };
}
function runHook(fx, event, env = {}) {
  const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: {
    ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, OATS_EVENT: event, OATS_INSTANCE: "retained", OATS_HOME: fx.home,
    OATS_WORKSPACE: fx.root, OATS_CONTEXT: fx.root, OATS_RUNTIME: "codex", FAKE_RETAINED: "1",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]),
    OATS_SETTINGS: JSON.stringify({ delivery: "session", identity: { mode: "local", source: fx.source } }), ...env } });
  let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
  return { ...r, doc };
}
/** The kernel's compensation for a spawn that answered no meta: retire with empty meta. */
const compensate = (fx) => runHook(fx, "retire", { OATS_META: "{}" });
const deletes = (fx) => { try { return readFileSync(join(fx.base, "aw.log"), "utf8").trim().split(/\n/).filter(Boolean).map((l) => JSON.parse(l).argv).filter((a) => a[0] === "workspace" && a[1] === "delete"); } catch { return []; } };

test("a retained spawn killed after connect: the compensating retire deletes no workspace and releases its own lock", (t) => {
  const fx = fixture(t);
  const spawned = runHook(fx, "spawn", { FAKE_RETAINED_KILL: "after-connect" });
  assert.equal(spawned.signal, "SIGKILL", "the hook was killed");
  assert.ok(existsSync(join(fx.home, ".aw", "workspace.yaml")), "the binding was made in the home");
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, fx.home);
  const retired = compensate(fx);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.deepEqual(deletes(fx), [], "no aw workspace delete with the standing identity's key");
  assert.equal(retired.doc.meta.retained, true);
  assert.equal(existsSync(fx.lock), false, "the lock this home took is released");
  assert.ok(retired.doc.warning.includes(`run \`aw workspace connect --service=https://fixture.invalid/api --team=${TEAM}\` from ${fx.legacyHome}`), `names the restore from the source: ${retired.doc.warning}`);
  assert.equal(readFileSync(join(fx.source, "signing.key"), "utf8"), "fixture-signing-key", "the source is untouched");
});

test("a retained spawn killed mid-connect, before aw writes the local binding: the retire still names the rebind", (t) => {
  const fx = fixture(t);
  const spawned = runHook(fx, "spawn", { FAKE_RETAINED_KILL: "mid-connect" });
  assert.equal(spawned.signal, "SIGKILL", "the hook was killed");
  assert.equal(existsSync(join(fx.home, ".aw", "workspace.yaml")), false, "no local binding was written");
  const retired = compensate(fx);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.deepEqual(deletes(fx), []);
  assert.equal(existsSync(fx.lock), false, "the lock this home took is released");
  assert.ok(retired.doc.warning.includes(`run \`aw workspace connect --service=https://fixture.invalid/api --team=${TEAM}\` from ${fx.legacyHome}`), `names the rebind: ${retired.doc.warning}`);
});

const connects = (fx) => { try { return readFileSync(join(fx.base, "aw.log"), "utf8").trim().split(/\n/).filter(Boolean).map(JSON.parse).filter((c) => c.argv[0] === "workspace" && c.argv[1] === "connect"); } catch { return []; } };

test("a connect the server accepted but that failed before aw wrote the local binding is restored from the source", (t) => {
  const fx = fixture(t);
  const spawned = runHook(fx, "spawn", { FAKE_RETAINED_FAIL: "connect" });
  assert.equal(spawned.status, 1, spawned.stdout + spawned.stderr);
  assert.deepEqual(connects(fx).map((c) => c.cwd), [fx.home, fx.legacyHome], "the binding is put back from the source");
  assert.equal(existsSync(fx.lock), false, "restored, so the lock is released");
});

test("such a connect whose restore fails keeps the seat, and the retire names the rebind", (t) => {
  const fx = fixture(t);
  const spawned = runHook(fx, "spawn", { FAKE_RETAINED_FAIL: "connect", FAKE_RETAINED_RESTORE_FAIL: "1" });
  assert.equal(spawned.status, 1, spawned.stdout + spawned.stderr);
  assert.match(spawned.doc.warning, /KEPT/);
  const retired = compensate(fx);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.deepEqual(deletes(fx), []);
  assert.ok(retired.doc.warning.includes(`run \`aw workspace connect --service=https://fixture.invalid/api --team=${TEAM}\` from ${fx.legacyHome}`), retired.doc.warning);
});

// awebai/oats-aweb#229: the hook's deadline can cut a retained spawn after its connect, and then
// leaves its rollback no time to restore the binding, so the spawn answers no meta.
test("a retained spawn the hook's deadline cuts after connect: the compensating retire deletes no workspace", (t) => {
  const fx = fixture(t);
  const spawned = runHook(fx, "spawn", { FAKE_RETAINED_HANG: "check", OATS_AWEB_HOOK_BUDGET_MS: "1500" });
  assert.equal(spawned.status, 1, spawned.stdout + spawned.stderr);
  assert.equal(spawned.doc.meta, undefined, "the cut spawn answers no meta");
  assert.match(spawned.doc.warning, /aw check timed out.*KEPT/, "the deadline cut the check and left the rollback no time");
  const retired = compensate(fx);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.deepEqual(deletes(fx), [], "no aw workspace delete with the standing identity's key");
  assert.equal(retired.doc.meta.retained, true);
  assert.ok(retired.doc.warning.includes(`run \`aw workspace connect --service=https://fixture.invalid/api --team=${TEAM}\` from ${fx.legacyHome}`), retired.doc.warning);
});

test("a retained spawn that fails after connect and cannot restore: the compensating retire deletes no workspace", (t) => {
  const fx = fixture(t);
  const spawned = runHook(fx, "spawn", { FAKE_RETAINED_FAIL: "check", FAKE_RETAINED_RESTORE_FAIL: "1" });
  assert.equal(spawned.status, 1, spawned.stdout + spawned.stderr);
  assert.match(spawned.doc.warning, /KEPT/);
  const retired = compensate(fx);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.deepEqual(deletes(fx), []);
  assert.equal(existsSync(fx.lock), false);
});

test("a retained spawn refused at the lock: the compensating retire leaves the other seat's lock", (t) => {
  const fx = fixture(t);
  const other = join(fx.base, "other-home"); mkdirSync(other);
  write(fx.lock, JSON.stringify({ home: other, instance: "other" }));
  const spawned = runHook(fx, "spawn");
  assert.equal(spawned.status, 1);
  const retired = compensate(fx);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.deepEqual(deletes(fx), []);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, other, "a lock held by another home is never removed");
  assert.doesNotMatch(retired.doc.warning, /released the retained identity/, "this home released nothing");
  assert.match(retired.doc.warning, /released nothing: this home does not hold the retained identity's lock/);
});

test("an identity.source that is not a string is refused before the lock, and its retire deletes nothing", (t) => {
  const fx = fixture(t);
  const settings = JSON.stringify({ delivery: "session", identity: { mode: "local", source: [fx.source] } });
  const spawned = runHook(fx, "spawn", { OATS_SETTINGS: settings });
  assert.equal(spawned.status, 1, spawned.stdout + spawned.stderr);
  assert.match(spawned.doc.warning, /identity\.source must be the absolute path/);
  assert.equal(existsSync(fx.lock), false, "no lock is taken");
  assert.equal(existsSync(join(fx.home, ".aw")), false, "nothing is copied");
  const retired = runHook(fx, "retire", { OATS_SETTINGS: settings, OATS_META: "{}" });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.deepEqual(deletes(fx), []);
});

test("a retained seat's retire leaves a lock another seat has taken over, and says so", (t) => {
  const fx = fixture(t);
  const spawned = runHook(fx, "spawn");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const other = join(fx.base, "other-home");
  write(fx.lock, JSON.stringify({ home: other, instance: "other", tookOverFrom: fx.home }));
  const retired = runHook(fx, "retire", { OATS_META: JSON.stringify(spawned.doc.meta) });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, other);
  assert.match(retired.doc.warning, /left in place/);
  assert.deepEqual(deletes(fx), []);
});

test("a killed retained spawn's home never reaches the self-delete, however often it is retired", (t) => {
  const fx = fixture(t);
  runHook(fx, "spawn", { FAKE_RETAINED_KILL: "after-connect" });
  for (let i = 0; i < 2; i++) assert.equal(compensate(fx).status, 0);
  rmSync(join(fx.home, ".oats-aweb"), { recursive: true, force: true });
  assert.equal(compensate(fx).status, 0, "nothing in the home's provider state decides it");
  assert.deepEqual(deletes(fx), []);
});

test("a lock that cannot be read is left in place by a retained retire, and the retire says why", (t) => {
  for (const content of ["null", "[]", "{ not json", JSON.stringify({ home: 7 })]) {
    const fx = fixture(t);
    const spawned = runHook(fx, "spawn");
    assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
    write(fx.lock, content);
    const retired = runHook(fx, "retire", { OATS_META: JSON.stringify(spawned.doc.meta) });
    assert.equal(retired.status, 0, retired.stdout + retired.stderr);
    assert.equal(readFileSync(fx.lock, "utf8"), content, `lock ${content} left in place`);
    assert.match(retired.doc.warning, /left in place: it cannot be read/, content);
  }
});

test("a lock this home holds but cannot remove is reported as left in place", (t) => {
  const fx = fixture(t);
  const spawned = runHook(fx, "spawn");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  chmodSync(dirname(fx.lock), 0o500); // readable, but nothing in it can be unlinked
  let retired;
  try { retired = runHook(fx, "retire", { OATS_META: JSON.stringify(spawned.doc.meta) }); }
  finally { chmodSync(dirname(fx.lock), 0o700); }
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, fx.home, "the lock is still there");
  assert.match(retired.doc.warning, /left in place: it could not be removed \(EACCES\)/);
  assert.doesNotMatch(retired.doc.warning, /removed\)/);
});

test("a lock that cannot be checked is not reported as gone", (t) => {
  const fx = fixture(t);
  const spawned = runHook(fx, "spawn");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  chmodSync(dirname(fx.lock), 0o000);
  let retired;
  try { retired = runHook(fx, "retire", { OATS_META: JSON.stringify(spawned.doc.meta) }); }
  finally { chmodSync(dirname(fx.lock), 0o700); }
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.ok(existsSync(fx.lock), "the lock is still there");
  assert.doesNotMatch(retired.doc.warning, /already gone/);
  assert.match(retired.doc.warning, /left in place: it cannot be checked \(EACCES\)/);
});

test("the restore command is printed only from values of their own shapes", (t) => {
  const fx = fixture(t);
  // A spawn refuses such a record before it takes the seat (#241), so the record is
  // changed after the spawn took the seat: the retire reads the source again.
  const spawned = runHook(fx, "spawn", { FAKE_RETAINED_KILL: "after-connect" });
  assert.equal(spawned.signal, "SIGKILL");
  write(join(fx.source, "workspace.yaml"), "alias: retained\naweb_url: https://fixture.invalid/$(touch pwned)\n");
  const retired = compensate(fx);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.deepEqual(deletes(fx), []);
  assert.doesNotMatch(retired.doc.warning, /touch pwned/);
  assert.ok(retired.doc.warning.includes(`run \`aw workspace connect\` with the service, team and role in its workspace.yaml from ${fx.legacyHome}`), retired.doc.warning);
});
