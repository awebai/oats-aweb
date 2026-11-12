// awebai/oats-aweb#226: a retained seat keeps AWEB_IDENTITY_HOME at every start.
// The kernel drops a provider's earlier env names before it merges a launch answer,
// so the launch answer alone must carry the identity home: a spawn's env does not
// survive a start. A retained seat holds its identity locally in the home's .aw, so
// spawn records it as identity mode "local"; a seat recorded before that fix (mode
// "global" with no grant, retained: true) is normalised at its next start, and only
// that recorded field changes.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fakeAw } from "./helpers/fake-aw-grant.mjs";

const HOOK = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const TEAM = "t:example.test";

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-226-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "retained"); mkdirSync(home, { recursive: true });
  const source = join(base, "legacy", ".aw");
  write(join(source, "signing.key"), "fixture-signing-key");
  write(join(source, "identity.yaml"), "alias: retained\ndid: did:key:zRetained\naddress: fixture.test/retained\n");
  write(join(source, "teams.yaml"), `active_team: ${TEAM}\n`);
  write(join(source, "workspace.yaml"), "alias: retained\naweb_url: https://fixture.invalid/api\n");
  return { base, root, home, source, bin: fakeAw(base) };
}
function runHook(fx, event, env) {
  const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: {
    ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, OATS_EVENT: event, OATS_INSTANCE: "retained", OATS_HOME: fx.home,
    OATS_WORKSPACE: fx.root, OATS_CONTEXT: fx.root, OATS_RUNTIME: "codex", FAKE_RETAINED: "1",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]), ...env } });
  let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
  return { ...r, doc };
}
const retainedSettings = (fx) => JSON.stringify({ delivery: "session", identity: { mode: "local", source: fx.source } });
const awCalls = (fx) => { try { return readFileSync(join(fx.base, "aw.log"), "utf8").trim().split(/\n/).filter(Boolean).map((l) => JSON.parse(l).argv.join(" ")); } catch { return []; } };
/** A retained seat's meta as providers before the #226 fix recorded it. */
const recordedBeforeFix = (fx) => ({
  team: TEAM, alias: "retained", retained: true, source: fx.source, lock: join(dirname(fx.source), ".aw-retained-seat.json"),
  delivery: "session", runtime: "codex",
  identity: { mode: "global", alias: "retained", team: TEAM, address: "fixture.test/retained", resident: null },
});

test("a retained seat's spawn records its identity as local, and every start answers its identity home", (t) => {
  const fx = fixture(t);
  const spawned = runHook(fx, "spawn", { OATS_SETTINGS: retainedSettings(fx) });
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  assert.equal(spawned.doc.meta.retained, true);
  assert.equal(spawned.doc.meta.identity.mode, "local");
  for (const preview of ["1", undefined]) {
    const launched = runHook(fx, "launch", { OATS_SETTINGS: retainedSettings(fx), OATS_META: JSON.stringify(spawned.doc.meta), ...(preview ? { OATS_LAUNCH_PREVIEW: preview } : {}) });
    assert.equal(launched.status, 0, launched.stdout + launched.stderr);
    // The launch answer alone: the kernel does not keep the spawn's value.
    assert.equal(launched.doc.env?.AWEB_IDENTITY_HOME, join(fx.home, ".aw"), `launch${preview ? " preview" : ""} answers the identity home`);
  }
});

test("a start normalises a retained seat recorded as global with no grant, changing only its recorded mode", (t) => {
  const fx = fixture(t);
  const old = recordedBeforeFix(fx);
  const before = awCalls(fx).length;
  const launched = runHook(fx, "launch", { OATS_SETTINGS: retainedSettings(fx), OATS_META: JSON.stringify(old) });
  assert.equal(launched.status, 0, launched.stdout + launched.stderr);
  assert.equal(launched.doc.env?.AWEB_IDENTITY_HOME, join(fx.home, ".aw"));
  assert.deepEqual(launched.doc.meta.identity, { ...old.identity, mode: "local" });
  for (const key of ["team", "alias", "retained", "source", "lock"]) assert.deepEqual(launched.doc.meta[key], old[key], key);
  assert.ok(!awCalls(fx).slice(before).some((c) => /^(id grant|custody)/.test(c)), "a retained seat's start runs no grant or custody call");

  const preview = runHook(fx, "launch", { OATS_SETTINGS: retainedSettings(fx), OATS_META: JSON.stringify(old), OATS_LAUNCH_PREVIEW: "1" });
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.equal(preview.doc.env?.AWEB_IDENTITY_HOME, join(fx.home, ".aw"), "the preview answers what the real start answers");
});

test("normalising a retained seat is idempotent", (t) => {
  const fx = fixture(t);
  const first = runHook(fx, "launch", { OATS_SETTINGS: retainedSettings(fx), OATS_META: JSON.stringify(recordedBeforeFix(fx)) });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const second = runHook(fx, "launch", { OATS_SETTINGS: retainedSettings(fx), OATS_META: JSON.stringify(first.doc.meta) });
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.deepEqual(second.doc.meta, first.doc.meta);
  assert.deepEqual(second.doc.env, first.doc.env);
});

test("a retained seat recorded with a grant keeps its recorded mode", (t) => {
  const fx = fixture(t);
  const custody = join(fx.base, "custody", "merlin");
  write(join(custody, ".aw", "identity.yaml"), "alias: resident-alias\n");
  write(join(custody, ".aw", "teams.yaml"), `active_team: ${TEAM}\n`);
  const grantHome = join(fx.home, ".aweb-identity");
  write(join(grantHome, "grant.yaml"), "fixture grant\n");
  const meta = { ...recordedBeforeFix(fx), identity: { mode: "global", alias: "retained", team: TEAM, address: null, resident: "merlin", grant: { id: "grant-fixture", home: grantHome, expiresAt: "never" } } };
  const settings = JSON.stringify({ delivery: "session", identity: { mode: "global", resident: "merlin", renew: "off" }, residents: { merlin: custody } });
  const launched = runHook(fx, "launch", { OATS_SETTINGS: settings, OATS_META: JSON.stringify(meta) });
  assert.equal(launched.status, 0, launched.stdout + launched.stderr);
  assert.deepEqual(launched.doc.meta.identity, meta.identity);
  assert.equal(launched.doc.env?.AWEB_IDENTITY_HOME, grantHome);
});

test("a retained seat recorded as local, with no joined teams, has a known receive set", async (t) => {
  const { expectedReceive } = await import("../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs");
  const fx = fixture(t);
  const spawned = runHook(fx, "spawn", { OATS_SETTINGS: retainedSettings(fx) });
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  // What the kernel records for the home: the provider meta and the launch env.
  writeFileSync(join(fx.home, "instance.json"), JSON.stringify({ capabilityMeta: { "oats.aweb": spawned.doc.meta }, launch: { hooks: { env: { AWEB_IDENTITY_HOME: join(fx.home, ".aw") } } } }));
  const answer = expectedReceive(fx.home, { delivery: "session" });
  assert.deepEqual(answer.problems, []);
  assert.equal(answer.bindings[0].identity_home, join(fx.home, ".aw"));
});
