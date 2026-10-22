import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "./helpers/delivery-fixture.mjs";

const fixturesDir = new URL("./fixtures/upgrade/", import.meta.url);
const fixtures = readdirSync(fixturesDir).filter(name => name.endsWith(".json")).map(name => [name, JSON.parse(readFileSync(new URL(name, fixturesDir)))]);
const local = fixtures.find(([name]) => name === "v1.17.1-local.json")[1];
const global = fixtures.find(([name]) => name === "v1.17.1-global.json")[1];
const snapshot = dir => readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? [[path, "directory"], ...snapshot(path)] : [[path, readFileSync(path).toString("base64")]];
});
const upgrade = (fx, phase, meta, extra = {}) => fx.hook("upgrade", { OATS_UPGRADE_PHASE: phase, OATS_META: JSON.stringify(meta), ...extra });

for (const [name, meta] of fixtures) test(`plan adopts ${name} without calls or home writes`, t => {
  const fx = fixture(t);
  writeFileSync(join(fx.home, "keep"), "home bytes\n");
  const before = snapshot(fx.home), r = upgrade(fx, "plan", meta);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.doc, { adopt: true });
  assert.deepEqual(snapshot(fx.home), before);
  assert.deepEqual(fx.fake.readCalls(), []);
});

test("plan refuses missing fields and malformed metadata without echoing values", t => {
  const fx = fixture(t);
  for (const [value, fields] of [[{ alias: "secret" }, /team/], [{ team: "secret" }, /alias/], [{ team: 12, alias: false }, /team.*alias/], [{ identity: local.identity }, /team.*alias/], [[], /object/], [null, /object/], ["secret", /object/], [7, /object/]]) {
    const before = snapshot(fx.home), r = upgrade(fx, "plan", value);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.doc.adopt, false);
    assert.match(r.doc.reason, fields);
    assert.doesNotMatch(JSON.stringify(r.doc), /secret/);
    assert.equal(r.doc.remedy, "respawn the instance: oats retire dev-1, then oats spawn");
    assert.deepEqual(snapshot(fx.home), before);
  }
  const r = upgrade(fx, "plan", null, { OATS_META: "{secret" });
  assert.equal(r.doc.adopt, false);
  assert.match(r.doc.reason, /JSON/);
  assert.doesNotMatch(JSON.stringify(r.doc), /secret/);
  assert.equal(r.doc.remedy, "respawn the instance: oats retire dev-1, then oats spawn");
  assert.deepEqual(fx.fake.readCalls(), []);
});

for (const [name, meta] of fixtures) test(`apply migrates only delivery/runtime for ${name} and is idempotent`, t => {
  for (const delivery of ["session", "channel"]) for (const harness of ["codex", "claude", "pi"]) {
    const fx = fixture(t, { delivery, runtime: "caller-runtime" });
    fx.record(meta, harness);
    const before = snapshot(fx.home), r = upgrade(fx, "apply", meta);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.doc, { meta: { ...meta, delivery, runtime: harness } });
    assert.deepEqual(upgrade(fx, "apply", r.doc.meta).doc, r.doc);
    assert.deepEqual(snapshot(fx.home), before);
    assert.deepEqual(fx.fake.readCalls(), []);
  }
});

test("apply warns for global renewal off only, naming the grant id", t => {
  for (const meta of [local, global, fixtures.find(([name]) => name === "v1.17.1-retained.json")[1]]) for (const renew of ["off", "launch", undefined]) {
    const fx = fixture(t, { settings: { identity: { renew } } });
    fx.record(meta, "claude");
    const r = upgrade(fx, "apply", meta);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.doc.warning, meta.identity.grant && renew === "off" ? "renewal is off: the next start keeps grant grant-old and its expiry" : undefined);
    assert.deepEqual(fx.fake.readCalls(), []);
  }
});

test("runtime comes from launch.harness, with top-level fallback; invalid or unreadable records keep meta runtime", t => {
  const fx = fixture(t, { runtime: "claude" });
  const record = value => writeFileSync(join(fx.home, "instance.json"), JSON.stringify(value));
  record({ harness: "pi", launch: { harness: "codex" } });
  assert.equal(upgrade(fx, "apply", local).doc.meta.runtime, "codex");
  record({ harness: "pi" });
  assert.equal(upgrade(fx, "apply", local).doc.meta.runtime, "pi");
  for (const doc of [{}, { launch: { harness: "secret-unknown" } }, { harness: "secret-unknown" }, { launch: { harness: 123 } }, { launch: { harness: " claude" } }]) {
    record(doc);
    const r = upgrade(fx, "apply", local);
    assert.equal(r.doc.meta.runtime, local.runtime);
    assert.match(r.doc.warning, /harness/);
    assert.doesNotMatch(r.doc.warning, /secret-unknown|123/);
    assert.equal(Object.hasOwn(upgrade(fx, "apply", global).doc.meta, "runtime"), false);
  }
  for (const bad of ["{secret-json", null, "symlink"]) {
    rmSync(join(fx.home, "instance.json"), { force: true });
    if (bad === "symlink") {
      const outside = join(fx.ws, "foreign.json");
      writeFileSync(outside, JSON.stringify({ harness: "codex" }));
      symlinkSync(outside, join(fx.home, "instance.json"));
    } else if (bad) writeFileSync(join(fx.home, "instance.json"), bad);
    const r = upgrade(fx, "apply", local);
    assert.equal(r.doc.meta.runtime, local.runtime);
    assert.match(r.doc.warning, /instance.json/);
    assert.doesNotMatch(r.doc.warning, /secret-json/);
  }
  assert.deepEqual(fx.fake.readCalls(), []);
});

test("upgrade dispatch bypasses captured execution, team settings and channel selection, even without aw", t => {
  const fx = fixture(t, { settings: { team: "obsolete", claudeChannelMode: "invalid" } });
  fx.record(local, "codex");
  const emptyPath = join(fx.ws, "empty-bin"); mkdirSync(emptyPath);
  for (const PATH of [emptyPath, undefined]) for (const phase of ["plan", "apply"]) {
    const r = upgrade(fx, phase, local, { ...(PATH ? { PATH } : {}), OATS_BINDING_FILE: "/missing/captured", OATS_INVOCATION_CONTEXT_FILE: "/missing/context" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.doc, phase === "plan" ? { adopt: true } : { meta: { ...local, delivery: "channel", runtime: "codex" } });
  }
  assert.deepEqual(fx.fake.readCalls(), []);
});

test("apply refuses invalid meta and unknown phases with no side effects", t => {
  const fx = fixture(t);
  const before = snapshot(fx.home);
  for (const [phase, meta] of [["apply", {}], ["apply", []], ["unknown", local], ["", local]]) {
    const r = upgrade(fx, phase, meta);
    assert.notEqual(r.status, 0);
    assert.equal(r.doc.meta, undefined);
  }
  assert.deepEqual(snapshot(fx.home), before);
  assert.deepEqual(fx.fake.readCalls(), []);
});
