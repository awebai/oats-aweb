// awebai/oats-aweb#242, part 1: the captured-execution block is entered when OATS_BINDING_FILE,
// OATS_INVOCATION_CONTEXT_FILE or OATS_SOURCE_RECEIPT_FILE is present in the environment, and any
// error in it exits 1. A retire never enters it: with any of them set it runs the normal retire,
// with its effects and exit status, and warns naming the variables present (names only, never
// their values or the files' contents). Spawn, launch and the other events are unchanged
// (test/captured-execution.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fakeAw } from "./helpers/fake-aw-grant.mjs";

const HOOK = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const TEAM = "t:example.test";
const MARKERS = ["OATS_BINDING_FILE", "OATS_INVOCATION_CONTEXT_FILE", "OATS_SOURCE_RECEIPT_FILE"];
const FILE_CONTENT = "captured-fixture-content-7f3a";

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
/** A retained seat, spawned without any marker, so its retire has effects: it releases the
 *  lock. Each marker names a file of its own in the fixture. */
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-242-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "retained"); mkdirSync(home, { recursive: true });
  const source = join(base, "seats", "retained", ".aw");
  write(join(source, "signing.key"), "fixture-signing-key");
  write(join(source, "identity.yaml"), "alias: retained\ndid: did:key:zRetained\naddress: fixture.test/retained\n");
  write(join(source, "teams.yaml"), `active_team: ${TEAM}\n`);
  write(join(source, "workspace.yaml"), "alias: retained\naweb_url: https://fixture.invalid/api\n");
  const files = Object.fromEntries(MARKERS.map((k) => { const p = join(base, "captured", `${k.toLowerCase()}.json`); write(p, FILE_CONTENT); return [k, p]; }));
  const fx = { base, root, home, source, lock: join(dirname(source), ".aw-retained-seat.json"), bin: fakeAw(base), files };
  const spawned = runHook(fx, "spawn");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  fx.meta = spawned.doc.meta;
  return fx;
}
function runHook(fx, event, env = {}) {
  const base = { ...process.env };
  for (const k of MARKERS) delete base[k];
  const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: {
    ...base, PATH: `${fx.bin}:${process.env.PATH}`, OATS_EVENT: event, OATS_INSTANCE: "retained", OATS_HOME: fx.home,
    OATS_WORKSPACE: fx.root, OATS_CONTEXT: fx.root, OATS_RUNTIME: "codex", FAKE_RETAINED: "1",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]),
    OATS_SETTINGS: JSON.stringify({ delivery: "session", identity: { mode: "local", source: fx.source } }), ...env } });
  let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
  return { ...r, doc };
}
/** The aw calls a fixture ran, with its own directory written as <base> so two fixtures compare. */
const awEffects = (fx) => { try { return readFileSync(join(fx.base, "aw.log"), "utf8").trim().split(/\n/).filter(Boolean).map((l) => JSON.parse(l).argv.join(" ").split(fx.base).join("<base>")); } catch { return []; } };
const ignoredWarning = (names) => `oats-aweb: ${names.join(", ")} ${names.length === 1 ? "is" : "are"} set in the environment and ignored for retire, which runs its normal path`;

/** Text with a fixture's own directory written as <base>, so two fixtures' outputs compare. */
const own = (fx, text) => String(text).split(fx.base).join("<base>");
/** The normal retire of a fixture's seat, with no marker set: what each marked retire must equal. */
function control(t) {
  const fx = fixture(t);
  const before = awEffects(fx).length;
  const r = runHook(fx, "retire", { OATS_META: JSON.stringify(fx.meta) });
  return { status: r.status, meta: r.doc.meta, warning: own(fx, r.doc.warning), effects: awEffects(fx).slice(before), lockGone: !existsSync(fx.lock) };
}

for (const names of [...MARKERS.map((k) => [k]), MARKERS]) {
  test(`a retire with ${names.join(" and ")} set runs the normal retire and warns naming ${names.length === 1 ? "it" : "them"}`, (t) => {
    const expected = control(t);
    assert.equal(expected.status, 0, "the control retire succeeds");
    assert.equal(expected.lockGone, true, "the control retire releases the lock");
    const fx = fixture(t);
    const before = awEffects(fx).length;
    const r = runHook(fx, "retire", { OATS_META: JSON.stringify(fx.meta), ...Object.fromEntries(names.map((k) => [k, fx.files[k]])) });
    assert.equal(r.status, expected.status, r.stdout + r.stderr);
    assert.deepEqual(r.doc.meta, expected.meta, "the normal retire's meta");
    assert.deepEqual(awEffects(fx).slice(before), expected.effects, "the normal retire's aw calls");
    assert.equal(existsSync(fx.lock), false, "the lock is released, as the normal retire does");
    assert.equal(own(fx, r.doc.warning), `${expected.warning} | ${ignoredWarning(names)}`);
    for (const k of names) assert.ok(!r.stdout.includes(fx.files[k]), "a variable's value is never printed");
    assert.ok(!r.stdout.includes(FILE_CONTENT), "a file's content is never printed");
  });
}

test("a retire that fails on its normal path keeps its exit status and reason with a marker set", (t) => {
  const fx = fixture(t);
  rmSync(join(fx.home, ".aw"), { recursive: true, force: true });
  // A minted identity (no identity.source) whose key is gone: the normal retire exits 1.
  const meta = JSON.stringify({ alias: "retained", team: TEAM });
  const settings = { OATS_SETTINGS: JSON.stringify({ delivery: "session" }) };
  const expected = runHook(fx, "retire", { OATS_META: meta, ...settings });
  assert.equal(expected.status, 1, expected.stdout + expected.stderr);
  assert.equal(expected.doc.meta.reason, "no-local-identity-key");
  const r = runHook(fx, "retire", { OATS_META: meta, ...settings, OATS_BINDING_FILE: fx.files.OATS_BINDING_FILE });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(r.doc.meta, expected.doc.meta);
  assert.equal(r.doc.warning, `${expected.doc.warning} | ${ignoredWarning(["OATS_BINDING_FILE"])}`);
});

test("a retire with no marker set says nothing about them", (t) => {
  assert.doesNotMatch(String(control(t).warning), /OATS_BINDING_FILE|OATS_INVOCATION_CONTEXT_FILE|OATS_SOURCE_RECEIPT_FILE/);
});
