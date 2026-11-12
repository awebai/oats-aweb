// awebai/oats-aweb#242, part 2: the captured-execution path is removed (decided by both sides,
// 2026-11-12). The kernel runs only `binding.check`, with a workspace context and a readiness
// action; that answer is unchanged. A check with a `binding` or `invocation` input, and normalize
// and bind with any input, answer the one fixed reason in the wire's refusal shape. No event
// reads OATS_BINDING_FILE, OATS_INVOCATION_CONTEXT_FILE or OATS_SOURCE_RECEIPT_FILE: each one
// present gets the fixed warning, naming it only, and never a failure.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fakeAw } from "./helpers/fake-aw-grant.mjs";

const CAPABILITY = resolve(new URL("../oats-package/capabilities/oats-aweb", import.meta.url).pathname);
const HOOK = join(CAPABILITY, "bin", "oats-aweb.mjs");
const BINDING = join(CAPABILITY, "bin", "oats-aweb-binding.mjs");
const TEAM = "t:example.test";
const MARKERS = ["OATS_BINDING_FILE", "OATS_INVOCATION_CONTEXT_FILE", "OATS_SOURCE_RECEIPT_FILE"];
const FIXED = "captured bindings are not supported since oats.aweb 1.42.0; readiness takes a workspace context (oats readiness)";
const ignored = (name) => `oats-aweb: ${name} is ignored: ${FIXED}`;
const FILE_CONTENT = "captured-fixture-content-7f3a";
const teamEnv = { OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]) };

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-242p2-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const cleanEnv = () => { const env = { ...process.env }; for (const k of MARKERS) delete env[k]; return env; };
function wire(phase, body, env = {}) {
  const r = spawnSync(process.execPath, [BINDING, phase], { input: typeof body === "string" ? body : JSON.stringify(body), encoding: "utf8", env: { ...cleanEnv(), ...env } });
  return { status: r.status, doc: JSON.parse(r.stdout), stdout: r.stdout };
}
const refusal = (phase) => ({ schemaVersion: 1, phase, slot: "messaging", capability: "oats.aweb", ok: false, error: { code: "provider-not-qualified", message: FIXED } });

// Pinned acceptance: readiness through the real kernel-shaped request (workspace context,
// readiness action) answers as on main. The two answers below are main's (f6fc5508), recorded
// from this fixture before the removal.
function readinessFixture(t, { root = true } = {}) {
  const base = tempDir(t);
  const dir = join(base, "root"); mkdirSync(root ? join(dir, ".aw") : dir, { recursive: true });
  return { base, root: dir, bin: fakeAw(base) };
}
const kernelRequest = (fx) => ({ schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: { delivery: "session", root: fx.root },
  input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: fx.root, deployment: fx.root, soul: "dev" } } });
test("readiness for the kernel's workspace request answers as on main: a ready root", (t) => {
  const fx = readinessFixture(t);
  const r = wire("check", kernelRequest(fx), { PATH: `${fx.bin}:${process.env.PATH}`, ...teamEnv });
  assert.equal(r.status, 0);
  assert.deepEqual(r.doc, { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", ok: true, result: { status: "ready", problems: [], warnings: [] } });
});
test("readiness for the kernel's workspace request answers as on main: a root with no .aw", (t) => {
  const fx = readinessFixture(t, { root: false });
  const r = wire("check", kernelRequest(fx), { PATH: `${fx.bin}:${process.env.PATH}`, ...teamEnv });
  assert.equal(r.status, 0);
  assert.deepEqual(r.doc, { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", ok: true,
    result: { status: "needs-configuration", problems: [{ code: "needs-configuration", message: `no messaging root at ${fx.root}: run oats aweb setup there or set settings.oats.aweb.root` }], warnings: [] } });
});

// Pinned acceptance: check with a `binding` input, normalize and bind each answer the fixed reason.
test("check with a binding or an invocation input answers the fixed reason", (t) => {
  const fx = readinessFixture(t);
  const request = kernelRequest(fx);
  const binding = { schemaVersion: 1, capability: "oats.aweb", payloadContract: "oats.aweb.messaging", payloadVersion: 1, payload: {}, credentialRefs: {}, provenance: [] };
  for (const extra of [{ binding }, { invocation: {} }, { binding, invocation: {} }]) {
    const r = wire("check", { ...request, input: { ...request.input, ...extra } }, { PATH: `${fx.bin}:${process.env.PATH}`, ...teamEnv });
    assert.equal(r.status, 0, "the wire's exit convention: a refusal is an answer");
    assert.deepEqual(r.doc, refusal("check"), JSON.stringify(Object.keys(extra)));
  }
});
for (const phase of ["normalize", "bind"]) {
  test(`${phase} answers the fixed reason, whatever its input`, () => {
    for (const body of [
      { schemaVersion: 1, phase, slot: "messaging", capability: "oats.aweb", settings: {}, input: {} },
      { schemaVersion: 1, phase, slot: "messaging", capability: "oats.aweb", settings: {}, input: { declarations: [], context: { kind: "standalone", key: "k" } } },
      "{}",
      "not json",
    ]) {
      const r = wire(phase, body);
      assert.equal(r.status, 0);
      assert.deepEqual(r.doc, refusal(phase), JSON.stringify(body));
    }
  });
}

test("the manifest declares the fixed reason and no reason only the removed path returned", () => {
  const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));
  assert.ok(manifest.binding.reasons.includes(FIXED));
  for (const gone of ["an admitted captured instance intent is required for execution", "selected binding and inline captured invocation are required", "messaging binding needs one soul declaration", "Pi strict print does not support session input; retain messaging and configure an input-capable profile"]) {
    assert.equal(manifest.binding.reasons.includes(gone), false, gone);
  }
  assert.deepEqual([manifest.binding.normalize, manifest.binding.bind, manifest.binding.check], ["binding-normalize", "binding-bind", "binding-check"], "the kernel requires all three phase names");
});

// Pinned acceptance: spawn and retire with each variable set run normally and warn with the
// fixed text naming the variable.
function seat(t) {
  const base = tempDir(t);
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "retained"); mkdirSync(home, { recursive: true });
  const source = join(base, "seats", "retained", ".aw");
  write(join(source, "signing.key"), "fixture-signing-key");
  write(join(source, "identity.yaml"), "alias: retained\ndid: did:key:zRetained\naddress: fixture.test/retained\n");
  write(join(source, "teams.yaml"), `active_team: ${TEAM}\n`);
  write(join(source, "workspace.yaml"), "alias: retained\naweb_url: https://fixture.invalid/api\n");
  const files = Object.fromEntries(MARKERS.map((k) => { const p = join(base, "captured", `${k.toLowerCase()}.json`); write(p, FILE_CONTENT); return [k, p]; }));
  return { base, root, home, source, lock: join(dirname(source), ".aw-retained-seat.json"), bin: fakeAw(base), files };
}
function hook(fx, event, env = {}) {
  const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: { ...cleanEnv(), PATH: `${fx.bin}:${process.env.PATH}`, OATS_EVENT: event, OATS_INSTANCE: "retained",
    OATS_HOME: fx.home, OATS_WORKSPACE: fx.root, OATS_CONTEXT: fx.root, OATS_RUNTIME: "codex", FAKE_RETAINED: "1", ...teamEnv,
    OATS_SETTINGS: JSON.stringify({ delivery: "session", identity: { mode: "local", source: fx.source } }), ...env } });
  let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
  return { ...r, doc };
}
const marked = (fx, names) => Object.fromEntries(names.map((k) => [k, fx.files[k]]));
const own = (fx, text) => String(text).split(fx.base).join("<base>");
const notes = (warning) => String(warning || "").split(" | ").filter((n) => n && !MARKERS.some((k) => n.startsWith(`oats-aweb: ${k} is ignored:`)));

for (const names of [...MARKERS.map((k) => [k]), MARKERS]) {
  test(`spawn and retire with ${names.join(" and ")} set run normally and warn naming ${names.length === 1 ? "it" : "each"}`, (t) => {
    const control = seat(t);
    const controlSpawn = hook(control, "spawn");
    assert.equal(controlSpawn.status, 0, controlSpawn.stdout + controlSpawn.stderr);
    const controlRetire = hook(control, "retire", { OATS_META: JSON.stringify(controlSpawn.doc.meta) });
    assert.equal(controlRetire.status, 0, controlRetire.stdout + controlRetire.stderr);

    const fx = seat(t);
    const spawned = hook(fx, "spawn", marked(fx, names));
    assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
    assert.deepEqual(JSON.parse(own(fx, JSON.stringify(spawned.doc.meta))), JSON.parse(own(control, JSON.stringify(controlSpawn.doc.meta))), "the normal spawn's meta");
    for (const k of names) assert.ok(spawned.doc.warning.split(" | ").includes(ignored(k)), spawned.doc.warning);
    assert.deepEqual(notes(spawned.doc.warning).map((n) => own(fx, n)), notes(controlSpawn.doc.warning).map((n) => own(control, n)), "the normal spawn's other warnings");

    const retired = hook(fx, "retire", { OATS_META: JSON.stringify(spawned.doc.meta), ...marked(fx, names) });
    assert.equal(retired.status, 0, retired.stdout + retired.stderr);
    assert.deepEqual(retired.doc.meta, controlRetire.doc.meta, "the normal retire's meta");
    assert.equal(existsSync(fx.lock), false, "the normal retire releases the lock");
    for (const k of names) assert.ok(retired.doc.warning.split(" | ").includes(ignored(k)), retired.doc.warning);
    assert.deepEqual(notes(retired.doc.warning).map((n) => own(fx, n)), notes(controlRetire.doc.warning).map((n) => own(control, n)), "the normal retire's other warnings");

    for (const out of [spawned.stdout, retired.stdout]) {
      for (const k of names) assert.ok(!out.includes(fx.files[k]), "a variable's value is never printed");
      assert.ok(!out.includes(FILE_CONTENT), "a file's content is never printed");
    }
  });
}

test("a launch and an upgrade with a variable set warn the same way and run normally", (t) => {
  const fx = seat(t);
  const spawned = hook(fx, "spawn");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const launched = hook(fx, "launch", { OATS_META: JSON.stringify(spawned.doc.meta), OATS_BINDING_FILE: fx.files.OATS_BINDING_FILE });
  assert.equal(launched.status, 0, launched.stdout + launched.stderr);
  assert.ok(launched.doc.warning.split(" | ").includes(ignored("OATS_BINDING_FILE")), launched.doc.warning);
  const upgraded = hook(fx, "upgrade", { OATS_META: JSON.stringify(spawned.doc.meta), OATS_UPGRADE_PHASE: "plan", OATS_INSTANCE_HOME: fx.home, OATS_SOURCE_RECEIPT_FILE: fx.files.OATS_SOURCE_RECEIPT_FILE });
  assert.equal(upgraded.status, 0, upgraded.stdout + upgraded.stderr);
  assert.equal(upgraded.doc.adopt, true);
  assert.ok(upgraded.doc.warning.split(" | ").includes(ignored("OATS_SOURCE_RECEIPT_FILE")), JSON.stringify(upgraded.doc));
});

test("a text command with a variable set warns on stderr and answers as without it", (t) => {
  const fx = seat(t);
  const plain = hook(fx, "roster");
  const r = hook(fx, "roster", { OATS_INVOCATION_CONTEXT_FILE: fx.files.OATS_INVOCATION_CONTEXT_FILE });
  assert.equal(r.status, plain.status);
  assert.equal(r.stdout, plain.stdout);
  assert.ok(r.stderr.split("\n").includes(ignored("OATS_INVOCATION_CONTEXT_FILE")), r.stderr);
});

// Pinned acceptance: no remaining import of a removed module.
test("nothing imports a removed module, and the removed files are gone", () => {
  const removed = ["captured-execution.mjs", "captured-native.mjs", "invocation-shape.mjs", "portable-binding.mjs"];
  const files = [];
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { if (e.name === "node_modules" || e.name === ".git") continue; const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(m?js|json)$/.test(e.name)) files.push(p); } };
  const repo = resolve(CAPABILITY, "../../..");
  for (const dir of ["oats-package", "test", "scripts"]) walk(join(repo, dir));
  for (const name of removed) assert.equal(existsSync(join(CAPABILITY, "lib", name)), false, name);
  assert.equal(existsSync(join(repo, "PORTABLE-PROFILE-STATUS.md")), false);
  const self = new URL(import.meta.url).pathname;
  for (const file of files.filter((f) => f !== self)) {
    const text = readFileSync(file, "utf8");
    for (const name of removed) assert.doesNotMatch(text, new RegExp(`['"][^'"]*/${name.replace(".", "\\.")}['"]`), `${file} names ${name}`);
    assert.doesNotMatch(text, /assessCapturedSessionReadiness|kernelMeetsHomeRouteFloor/, file);
  }
});
