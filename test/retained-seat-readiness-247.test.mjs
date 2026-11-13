// awebai/oats-aweb#247: soul-scope readiness reports each refusal a retained seat's spawn
// (identity.source) makes that the soul's settings and the source directory decide, with the
// spawn's own text, from the one predicate both call (lib/retained-seat-service.mjs
// retainedSeatCheck): the source is not an absolute path; it holds no signing.key; it records
// no usable aweb_url; no team can be determined (no default team id and no active team in
// <source>/teams.yaml). A lock another seat holds is live state at spawn time, not
// configuration, and is not a readiness problem. A seated home's readiness is unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fakeAw } from "./helpers/fake-aw-grant.mjs";

const HOOK = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const BINDING = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb-binding.mjs", import.meta.url).pathname);
const TEAM = "t:example.test";
const RECORD = "https://record.invalid/api";
const DEFAULT_TEAM = { OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]) };
/** No default team id: none at all, or a label the deployment has not mapped to an id yet. */
const NO_DEFAULT_TEAM = { OATS_DEFAULT_TEAM: "", OATS_DEFAULT_TEAM_ID: "", OATS_DEFAULT_TEAM_FROM: "", OATS_TEAMS: "[]" };
const UNMAPPED_DEFAULT_TEAM = { OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: "", OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: JSON.stringify([{ label: "default", default: true, from: "local" }]) };

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function fixture(t, { teams = `active_team: ${TEAM}\n`, workspace = `aweb_url: ${RECORD}\n`, signingKey = true, deploymentRoot = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-247-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root"); mkdirSync(deploymentRoot ? join(root, ".aw") : root, { recursive: true });
  const home = join(root, "agents", "dev", "instances", "retained"); mkdirSync(home, { recursive: true });
  const source = join(base, "seats", "retained", ".aw");
  write(join(source, "identity.yaml"), "alias: retained\ndid: did:key:zRetained\naddress: fixture.test/retained\n");
  if (signingKey) write(join(source, "signing.key"), "fixture-signing-key");
  if (teams !== null) write(join(source, "teams.yaml"), teams);
  if (workspace !== null) write(join(source, "workspace.yaml"), workspace);
  return { base, root, home, source, lock: join(dirname(source), ".aw-retained-seat.json"), bin: fakeAw(base) };
}
function cleanEnv() { const env = { ...process.env }; delete env.OATS_AWEB_URL; return env; }
function spawnHook(fx, { source = fx.source, env = DEFAULT_TEAM } = {}) {
  const r = spawnSync(process.execPath, [HOOK, "spawn"], { encoding: "utf8", env: {
    ...cleanEnv(), PATH: `${fx.bin}:${process.env.PATH}`, OATS_EVENT: "spawn", OATS_INSTANCE: "retained", OATS_HOME: fx.home,
    OATS_WORKSPACE: fx.root, OATS_CONTEXT: fx.root, OATS_RUNTIME: "codex", FAKE_RETAINED: "1",
    OATS_SETTINGS: JSON.stringify({ delivery: "session", identity: { mode: "local", source } }), ...env } });
  let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
  return { ...r, doc };
}
function readiness(fx, { source = fx.source, home, env = DEFAULT_TEAM } = {}) {
  const context = { kind: "workspace", workspace: fx.root, deployment: fx.root, soul: "dev", ...(home ? { instance: "retained", home } : {}) };
  const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: { delivery: "session", identity: { mode: "local", source } }, input: { action: { kind: "readiness" }, context } };
  const r = spawnSync(process.execPath, [BINDING, "check"], { input: JSON.stringify(input), encoding: "utf8", env: { ...cleanEnv(), PATH: `${fx.bin}:${process.env.PATH}`, ...env } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout).result;
}
const awCalls = (fx) => { try { return readFileSync(join(fx.base, "aw.log"), "utf8").trim().split(/\n/).filter(Boolean).map(JSON.parse); } catch { return []; } };
function assertNoEffect(fx, refused) {
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.equal(refused.doc?.meta, undefined, "no seat is reported");
  assert.equal(existsSync(fx.lock), false, "no lock is taken");
  assert.equal(existsSync(join(fx.home, ".aw")), false, "nothing is copied");
  assert.deepEqual(awCalls(fx).map((c) => c.argv.join(" ")).filter((a) => !["version", "wake status --json"].includes(a)), [], "no aw command runs but the read-only preflight probes");
}

// Pinned acceptance: for each refusal, soul readiness reports the spawn's text, and the spawn
// refuses with the same text before any effect.
const refusals = [
  ["a source that is not an absolute path", { source: "seats/retained/.aw" }, /identity\.source must be the absolute path/],
  ["a source that is not a path at all", { source: 42 }, /identity\.source must be the absolute path/],
  ["a source with no signing.key", { fixture: { signingKey: false } }, /holds no signing\.key/],
  ["a source with no aweb_url", { fixture: { workspace: "role_name: reviewer\n" } }, /aweb service is unknown/],
  ["no default team and no active team in teams.yaml", { fixture: { teams: "" }, env: NO_DEFAULT_TEAM }, /cannot determine the team for the retained identity \(no teams configured/],
  ["no teams.yaml and no default team", { fixture: { teams: null }, env: NO_DEFAULT_TEAM }, /cannot determine the team/],
  ["an unmapped default team and no active team", { fixture: { teams: "" }, env: UNMAPPED_DEFAULT_TEAM }, /cannot determine the team for the retained identity \(the default team default has no provider id yet/],
  ["an active team that is not a team id, and no default team", { fixture: { teams: "active_team: default\n" }, env: NO_DEFAULT_TEAM }, /cannot determine the team/],
  // The first refusal in the spawn's order is the one both report.
  ["no signing.key and no team", { fixture: { signingKey: false, teams: "" }, env: NO_DEFAULT_TEAM }, /holds no signing\.key/],
];
for (const [name, { fixture: shape = {}, source, env = DEFAULT_TEAM }, text] of refusals) {
  test(`${name}: soul readiness reports the spawn's refusal, which comes before any effect`, (t) => {
    const fx = fixture(t, shape);
    const seatSource = source ?? fx.source;
    const refused = spawnHook(fx, { source: seatSource, env });
    assertNoEffect(fx, refused);
    assert.match(refused.doc.warning, text);
    const result = readiness(fx, { source: seatSource, env });
    assert.equal(result.status, "needs-configuration", JSON.stringify(result));
    assert.deepEqual(result.problems.map((p) => [p.code, `oats-aweb: ${p.message}`]), [["needs-configuration", refused.doc.warning]]);
  });
}

// Pinned acceptance: a valid seat reads no problem, and spawns.
for (const [name, shape, env] of [
  ["a default team", {}, DEFAULT_TEAM],
  ["no default team but an active team in teams.yaml", {}, NO_DEFAULT_TEAM],
  ["no messaging root in the deployment, which a retained seat does not use", { deploymentRoot: false }, DEFAULT_TEAM],
]) {
  test(`a valid seat with ${name} reads no problem, and spawns`, (t) => {
    const fx = fixture(t, shape);
    assert.deepEqual(readiness(fx, { env }), { status: "ready", problems: [], warnings: [] });
    const spawned = spawnHook(fx, { env });
    assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
    assert.equal(spawned.doc.meta.retained, true);
  });
}

test("a lock another seat holds is not a readiness problem: it is live state the spawn checks", (t) => {
  const fx = fixture(t);
  const holder = join(fx.base, "holder-home"); mkdirSync(holder);
  writeFileSync(fx.lock, JSON.stringify({ home: holder, instance: "holder" }));
  assert.deepEqual(readiness(fx), { status: "ready", problems: [], warnings: [] });
  const refused = spawnHook(fx);
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.match(refused.doc?.warning ?? refused.stdout, /already held by/);
});

test("a seat that cannot determine its team refuses on the team, not on a lock another seat holds", (t) => {
  const fx = fixture(t, { teams: "" });
  const holder = join(fx.base, "holder-home"); mkdirSync(holder);
  writeFileSync(fx.lock, JSON.stringify({ home: holder, instance: "holder" }));
  const refused = spawnHook(fx, { env: NO_DEFAULT_TEAM });
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.match(refused.doc.warning, /cannot determine the team/);
  assert.deepEqual(readiness(fx, { env: NO_DEFAULT_TEAM }).problems.map((p) => `oats-aweb: ${p.message}`), [refused.doc.warning]);
});

// Pinned acceptance: a seated home's readiness is unchanged; its start does not read the
// source again.
test("a seated home's readiness does not report its source's refusals", (t) => {
  const fx = fixture(t);
  const spawned = spawnHook(fx);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const before = readiness(fx, { home: fx.home });
  rmSync(join(fx.source, "signing.key")); writeFileSync(join(fx.source, "teams.yaml"), ""); writeFileSync(join(fx.source, "workspace.yaml"), "");
  const after = readiness(fx, { home: fx.home });
  assert.deepEqual(after, before);
  assert.ok(!after.problems.some((p) => /identity\.source|signing\.key|retained identity|aweb service is unknown/.test(p.message)), JSON.stringify(after));
});
