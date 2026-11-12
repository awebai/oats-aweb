// awebai/oats-aweb#227: a retained seat's lock whose holder home is not on this
// host, or that cannot be read, is never released by age or automatically. The
// spawn refuses, naming the holder and the two ways to release it once that seat is
// confirmed gone; identity.takeOver: true is the operator's statement that it is,
// and clears the lock with a warning. Nothing is copied before the lock is ours.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fakeAw } from "./helpers/fake-aw-grant.mjs";

const HOOK = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const TEAM = "t:example.test";

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-227-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "retained"); mkdirSync(home, { recursive: true });
  const source = join(base, "seats", "retained", ".aw");
  write(join(source, "signing.key"), "fixture-signing-key");
  write(join(source, "identity.yaml"), "alias: retained\ndid: did:key:zRetained\naddress: fixture.test/retained\n");
  write(join(source, "teams.yaml"), `active_team: ${TEAM}\n`);
  write(join(source, "workspace.yaml"), "alias: retained\naweb_url: https://fixture.invalid/api\n");
  return { base, root, home, source, lock: join(dirname(source), ".aw-retained-seat.json"), bin: fakeAw(base) };
}
function spawnSeat(fx, identity = {}) {
  const r = spawnSync(process.execPath, [HOOK, "spawn"], { encoding: "utf8", env: {
    ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, OATS_EVENT: "spawn", OATS_INSTANCE: "retained", OATS_HOME: fx.home,
    OATS_WORKSPACE: fx.root, OATS_CONTEXT: fx.root, OATS_RUNTIME: "codex", FAKE_RETAINED: "1",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]),
    OATS_SETTINGS: JSON.stringify({ delivery: "session", identity: { mode: "local", source: fx.source, ...identity } }) } });
  let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
  return { ...r, doc };
}
const awCalls = (fx) => { try { return readFileSync(join(fx.base, "aw.log"), "utf8").trim().split(/\n/).filter(Boolean); } catch { return []; } };
const goneHolder = (fx) => ({ home: join(fx.base, "elsewhere", "agents", "dev", "instances", "old-seat"), instance: "old-seat", team: TEAM, takenAt: "2026-11-01T10:00:00.000Z", host: "container-a" });

test("a lock whose holder home is not on this host refuses, naming the holder and both releases", (t) => {
  const fx = fixture(t);
  const held = goneHolder(fx);
  write(fx.lock, JSON.stringify(held));
  const r = spawnSeat(fx);
  assert.notEqual(r.status, 0);
  const warning = r.doc.warning;
  assert.match(warning, /never released by age or automatically/);
  assert.match(warning, /identity\.takeOver: true/);
  assert.ok(warning.includes(`remove ${fx.lock}`), warning);
  for (const fact of [held.instance, held.home, held.host, held.takenAt]) assert.ok(warning.includes(fact), `names ${fact}: ${warning}`);
  assert.doesNotMatch(warning, /a moment ago/, "no race is claimed");
  assert.deepEqual(JSON.parse(readFileSync(fx.lock, "utf8")), held, "the lock is untouched");
  assert.equal(existsSync(join(fx.home, ".aw")), false, "nothing copied");
  assert.deepEqual(awCalls(fx).filter((l) => !/"argv":\["version"\]/.test(l) && !/"wake"/.test(l)), [], "no aw call acts on the identity");
});

test("a lock that cannot be read refuses the same way", (t) => {
  const fx = fixture(t);
  write(fx.lock, "{ not json");
  const r = spawnSeat(fx);
  assert.notEqual(r.status, 0);
  assert.match(r.doc.warning, /cannot be read/);
  assert.match(r.doc.warning, /identity\.takeOver: true/);
  assert.equal(readFileSync(fx.lock, "utf8"), "{ not json", "the lock is untouched");
  assert.equal(existsSync(join(fx.home, ".aw")), false, "nothing copied");
});

test("identity.takeOver: true clears a lock whose holder home is not on this host, with a warning", (t) => {
  const fx = fixture(t);
  const held = goneHolder(fx);
  write(fx.lock, JSON.stringify(held));
  const r = spawnSeat(fx, { takeOver: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.meta.retained, true);
  assert.equal(r.doc.meta.tookOverFrom, held.home);
  assert.match(r.doc.warning, /took over the retained identity/);
  const lock = JSON.parse(readFileSync(fx.lock, "utf8"));
  assert.equal(lock.home, fx.home);
  assert.equal(lock.tookOverFrom, held.home);
});

test("identity.takeOver: true clears an unreadable lock, with a warning", (t) => {
  const fx = fixture(t);
  write(fx.lock, "{ not json");
  const r = spawnSeat(fx, { takeOver: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.doc.warning, /took over the retained identity from an unreadable lock/);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, fx.home);
});

test("a lock whose holder home exists still refuses without takeOver", (t) => {
  const fx = fixture(t);
  const holder = join(fx.base, "live-holder"); mkdirSync(holder);
  write(fx.lock, JSON.stringify({ home: holder, instance: "live" }));
  const r = spawnSeat(fx);
  assert.notEqual(r.status, 0);
  assert.match(r.doc.warning, /a seat is never taken from a holder whose home exists/);
  assert.equal(JSON.parse(readFileSync(fx.lock, "utf8")).home, holder);
});
