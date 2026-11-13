// awebai/oats-aweb#256: a retained seat's spawn refuses before any effect when its source
// records no membership of the team it chose (the default team id, else teams.yaml's active
// team), and soul readiness reports the same text, from the one predicate both call
// (lib/retained-seat-service.mjs retainedSeatCheck). It decides as aw 1.36.58's
// `aw workspace connect --team` does: teams.yaml absent is aw's refusal; a memberships list with
// no membership of the team is aw's refusal (awconfig/team_state.go:100-113: trimmed,
// case-folded). teams.yaml present but outside the grammar aw writes, or with no memberships
// list, is not decided here: aw decides it at connect, as it does a membership's certificate.
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
const SEAT_TEAM = "seat:example.test";
const RECORD = "https://record.invalid/api";
const teamEnv = (team) => ({ OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: team, OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: JSON.stringify([{ label: "default", team, default: true, from: "local" }]) });
const DEFAULT_TEAM = teamEnv(TEAM);
const NO_DEFAULT_TEAM = { OATS_DEFAULT_TEAM: "", OATS_DEFAULT_TEAM_ID: "", OATS_DEFAULT_TEAM_FROM: "", OATS_TEAMS: "[]" };
/** teams.yaml as aw 1.36.58 writes it (yaml.v3; see test/aw-record-memberships-256.test.mjs). */
const teamsYaml = (active, ...ids) => `${active ? `active_team: ${active}\n` : ""}memberships:\n${ids.map((id) => `    - team_id: ${id}\n      alias: retained\n      cert_path: team-certs/${id.replace(/:/g, "__")}.pem\n`).join("")}`;

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function fixture(t, { teams = teamsYaml(TEAM, TEAM), signingKey = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-256-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "retained"); mkdirSync(home, { recursive: true });
  const source = join(base, "seats", "retained", ".aw");
  write(join(source, "identity.yaml"), "alias: retained\ndid: did:key:zRetained\naddress: fixture.test/retained\n");
  write(join(source, "workspace.yaml"), `aweb_url: ${RECORD}\n`);
  if (signingKey) write(join(source, "signing.key"), "fixture-signing-key");
  if (teams !== null) write(join(source, "teams.yaml"), teams);
  return { base, root, home, source, lock: join(dirname(source), ".aw-retained-seat.json"), bin: fakeAw(base) };
}
function cleanEnv() { const env = { ...process.env }; delete env.OATS_AWEB_URL; return env; }
function spawnHook(fx, env = DEFAULT_TEAM) {
  const r = spawnSync(process.execPath, [HOOK, "spawn"], { encoding: "utf8", env: {
    ...cleanEnv(), PATH: `${fx.bin}:${process.env.PATH}`, OATS_EVENT: "spawn", OATS_INSTANCE: "retained", OATS_HOME: fx.home,
    OATS_WORKSPACE: fx.root, OATS_CONTEXT: fx.root, OATS_RUNTIME: "codex", FAKE_RETAINED: "1", FAKE_RETAINED_MEMBERSHIP: "1",
    OATS_SETTINGS: JSON.stringify({ delivery: "session", identity: { mode: "local", source: fx.source } }), ...env } });
  let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
  return { ...r, doc };
}
function readiness(fx, env = DEFAULT_TEAM) {
  const context = { kind: "workspace", workspace: fx.root, deployment: fx.root, soul: "dev" };
  const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: { delivery: "session", identity: { mode: "local", source: fx.source } }, input: { action: { kind: "readiness" }, context } };
  const r = spawnSync(process.execPath, [BINDING, "check"], { input: JSON.stringify(input), encoding: "utf8", env: { ...cleanEnv(), PATH: `${fx.bin}:${process.env.PATH}`, ...env } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout).result;
}
const awCalls = (fx) => { try { return readFileSync(join(fx.base, "aw.log"), "utf8").trim().split(/\n/).filter(Boolean).map(JSON.parse); } catch { return []; } };
const connects = (fx) => awCalls(fx).filter((c) => c.argv[0] === "workspace" && c.argv[1] === "connect");
function assertNoEffect(fx, refused) {
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.equal(refused.doc?.meta, undefined, "no seat is reported");
  assert.equal(existsSync(fx.lock), false, "no lock is taken");
  assert.equal(existsSync(join(fx.home, ".aw")), false, "nothing is copied");
  assert.deepEqual(awCalls(fx).map((c) => c.argv.join(" ")).filter((a) => !["version", "wake status --json"].includes(a)), [], "no aw command runs but the read-only preflight probes");
}
const FIXES = /`aw id team accept-invite`.*`aw id team fetch-cert`.*default team/;

// Pinned acceptance 1 (and the absent teams.yaml aw refuses): the spawn refuses with no effect,
// and readiness gives the same text.
const refusals = [
  ["the default team is not the seat's only membership", { teams: teamsYaml(SEAT_TEAM, SEAT_TEAM) }, DEFAULT_TEAM, new RegExp(`no membership of the team ${TEAM}.*the seat's active team is ${SEAT_TEAM}`)],
  ["the chosen team is the seat's active team, with no membership of it", { teams: teamsYaml(TEAM, SEAT_TEAM) }, DEFAULT_TEAM, new RegExp(`no membership of the team ${TEAM}`)],
  ["no teams.yaml, with a default team", { teams: null }, DEFAULT_TEAM, /teams\.yaml does not exist/],
  ["memberships with no value: no membership at all", { teams: `active_team: ${SEAT_TEAM}\nmemberships:\n` }, DEFAULT_TEAM, new RegExp(`no membership of the team ${TEAM}`)],
  ["a membership whose domain has a trailing dot, which aw does not take for the team", { teams: teamsYaml(null, `${TEAM}.`) }, DEFAULT_TEAM, new RegExp(`no membership of the team ${TEAM}`)],
];
for (const [name, shape, env, text] of refusals) {
  test(`${name}: the spawn refuses before any effect, and soul readiness reports the same text`, (t) => {
    const fx = fixture(t, shape);
    const refused = spawnHook(fx, env);
    assertNoEffect(fx, refused);
    assert.match(refused.doc.warning, text);
    assert.match(refused.doc.warning, FIXES);
    const result = readiness(fx, env);
    assert.equal(result.status, "needs-configuration", JSON.stringify(result));
    assert.deepEqual(result.problems.map((p) => [p.code, `oats-aweb: ${p.message}`]), [["needs-configuration", refused.doc.warning]]);
  });
}

test("the seat's active team is not named when it is the chosen team", (t) => {
  const fx = fixture(t, { teams: teamsYaml(TEAM, SEAT_TEAM) });
  assert.doesNotMatch(spawnHook(fx).doc.warning, /the seat's active team is/);
});

// Pinned acceptance 2 and 3: a membership aw takes for the chosen team, in any case; a valid seat.
for (const [name, shape, env] of [
  ["a membership of the default team", {}, DEFAULT_TEAM],
  ["a membership of the default team in another case", { teams: teamsYaml("T:Example.Test", "T:Example.Test") }, DEFAULT_TEAM],
  ["the default team among several memberships", { teams: teamsYaml(SEAT_TEAM, SEAT_TEAM, TEAM) }, DEFAULT_TEAM],
  ["no default team, and a membership of the seat's active team", { teams: teamsYaml(SEAT_TEAM, SEAT_TEAM) }, NO_DEFAULT_TEAM],
]) {
  test(`${name}: reads ready, and spawns`, (t) => {
    const fx = fixture(t, shape);
    assert.deepEqual(readiness(fx, env), { status: "ready", problems: [], warnings: [] });
    const spawned = spawnHook(fx, env);
    assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
    assert.equal(spawned.doc.meta.retained, true);
  });
}

// Not decided here: aw decides it at connect, after the copy, as it did before.
for (const [name, teams] of [
  ["no memberships list", `active_team: ${TEAM}\n`],
  ["a teams.yaml outside the grammar aw writes", `active_team: ${TEAM}\nmemberships: [${SEAT_TEAM}]\n`],
  ["a membership id that is not ASCII", teamsYaml(TEAM, "tä:example.test")],
]) {
  test(`${name}: not decided before the spawn, so readiness reads ready and aw refuses at connect`, (t) => {
    const fx = fixture(t, { teams });
    assert.deepEqual(readiness(fx), { status: "ready", problems: [], warnings: [] });
    const spawned = spawnHook(fx);
    assert.equal(spawned.status, 1, spawned.stdout + spawned.stderr);
    assert.equal(connects(fx).length >= 1, true, "the spawn reached aw's connect");
    assert.doesNotMatch(spawned.doc.warning, /no membership of the team/);
  });
}

test("a membership's certificate is not checked here: aw checks it at connect", (t) => {
  const fx = fixture(t);
  assert.equal(existsSync(join(fx.source, "team-certs")), false, "the fixture holds no certificate file");
  assert.deepEqual(readiness(fx), { status: "ready", problems: [], warnings: [] });
});

// Pinned acceptance 4: the earlier refusals win.
for (const [name, shape, env, text] of [
  ["no team", { teams: `memberships:\n    - team_id: ${SEAT_TEAM}\n` }, NO_DEFAULT_TEAM, /cannot determine the team/],
  ["no signing.key", { signingKey: false, teams: teamsYaml(SEAT_TEAM, SEAT_TEAM) }, DEFAULT_TEAM, /holds no signing\.key/],
]) {
  test(`${name} is refused ahead of a missing membership`, (t) => {
    const fx = fixture(t, shape);
    const refused = spawnHook(fx, env);
    assertNoEffect(fx, refused);
    assert.match(refused.doc.warning, text);
    assert.deepEqual(readiness(fx, env).problems.map((p) => `oats-aweb: ${p.message}`), [refused.doc.warning]);
  });
}

test("a seat whose team has no membership refuses on it, not on a lock another seat holds", (t) => {
  const fx = fixture(t, { teams: teamsYaml(SEAT_TEAM, SEAT_TEAM) });
  const holder = join(fx.base, "holder-home"); mkdirSync(holder);
  writeFileSync(fx.lock, JSON.stringify({ home: holder, instance: "holder" }));
  const refused = spawnHook(fx);
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.match(refused.doc.warning, /no membership of the team/);
});
