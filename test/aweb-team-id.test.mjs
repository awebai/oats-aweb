// lib/aweb-team-id.mjs reads team ids the way aw does. Every expected value below comes from
// aw's own rule at aw-compat's tested version (aw 1.36.58, cli/go):
//   - awid/team_id.go:8-32, BuildTeamID and ParseTeamID: the id is trimmed and split at its
//     first ":"; the name is trimmed and lowercased; neither part may be empty;
//   - awid/registry_dns.go:162-164, canonicalizeDomain: the domain is trimmed, lowercased,
//     then loses one trailing "." (strings.TrimSuffix removes a single suffix);
//   - awconfig/team_certs.go:23-32, EncodeTeamIDForCertificatePath: aw names a team's
//     certificate file team-certs/<id>.pem from the canonical id, with each "__" written as
//     "____", then each ":" as "__" (test/joined-certificate-file-262.test.mjs covers "__").
// The expected values are written out by hand from that rule, never computed by the code.
// membershipTeamMatch has its own tests (test/aw-record-memberships-256.test.mjs).
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CAPABILITY = join(REPO, "oats-package", "capabilities", "oats-aweb");
const HOOK = join(CAPABILITY, "bin", "oats-aweb.mjs");
const { canonicalAwebTeamId, sameAwebTeamId, teamKeyIn } = await import(pathToFileURL(join(CAPABILITY, "lib", "aweb-team-id.mjs")).href);

const NOT_STRINGS = [undefined, null, 42, true, {}, ["team:example.test"], { toString: () => "team:example.test" }];

test("canonicalAwebTeamId: whitespace around the name and around the domain is trimmed", () => {
  assert.equal(canonicalAwebTeamId("  team  :  example.test  "), "team:example.test");
  assert.equal(canonicalAwebTeamId("\tteam\n:\texample.test\n"), "team:example.test");
  assert.equal(canonicalAwebTeamId(" team:example.test"), "team:example.test");
  assert.equal(canonicalAwebTeamId("team:example.test "), "team:example.test");
});

test("canonicalAwebTeamId: one trailing dot on the domain is dropped; of two, one stays", () => {
  assert.equal(canonicalAwebTeamId("team:example.test."), "team:example.test");
  assert.equal(canonicalAwebTeamId("team: example.test. "), "team:example.test");
  // TrimSuffix drops one ".", so "example.test.." keeps one.
  assert.equal(canonicalAwebTeamId("team:example.test.."), "team:example.test.");
  // A dot is dropped only from the domain, never from the name.
  assert.equal(canonicalAwebTeamId("team.:example.test"), "team.:example.test");
  // A domain that is only "." is empty once its dot is dropped.
  assert.equal(canonicalAwebTeamId("team:."), undefined);
});

test("canonicalAwebTeamId: mixed case is lowercased in the name and the domain", () => {
  assert.equal(canonicalAwebTeamId("Team:Example.TEST"), "team:example.test");
  assert.equal(canonicalAwebTeamId("TEAM:EXAMPLE.TEST."), "team:example.test");
  assert.equal(canonicalAwebTeamId("team:example.test"), "team:example.test");
});

test("canonicalAwebTeamId: no colon, or an empty name or domain, is undefined", () => {
  for (const value of ["", "team", "example.test", " ", ":", ":example.test", "   :example.test", "team:", "team:   ", " : "]) {
    assert.equal(canonicalAwebTeamId(value), undefined, JSON.stringify(value));
  }
  // The id splits at its first ":": the rest is the domain.
  assert.equal(canonicalAwebTeamId("team:example:test"), "team:example:test");
});

test("canonicalAwebTeamId: a value that is not a string is undefined", () => {
  for (const value of NOT_STRINGS) assert.equal(canonicalAwebTeamId(value), undefined, String(value));
});

test("sameAwebTeamId: whitespace, one trailing dot and case don't make another team", () => {
  for (const [a, b] of [
    ["  team  :  example.test  ", "team:example.test"],
    ["team:example.test.", "team:example.test"],
    ["Team:Example.TEST", "team:example.test"],
    [" TEAM : Example.Test. ", "team:example.test"],
    ["team:example.test..", "Team:Example.TEST.."],
  ]) {
    assert.equal(sameAwebTeamId(a, b), true, `${a} / ${b}`);
    assert.equal(sameAwebTeamId(b, a), true, `${b} / ${a}`);
  }
});

test("sameAwebTeamId: another name, another domain, or a second trailing dot is another team", () => {
  for (const [a, b] of [
    ["team:example.test..", "team:example.test"],
    ["team:example.test..", "team:example.test."],
    ["team:example.test", "other:example.test"],
    ["team:example.test", "team:example.other"],
    ["team.:example.test", "team:example.test"],
  ]) {
    assert.equal(sameAwebTeamId(a, b), false, `${a} / ${b}`);
    assert.equal(sameAwebTeamId(b, a), false, `${b} / ${a}`);
  }
});

test("sameAwebTeamId: a value that is not a team id matches nothing, not even itself", () => {
  for (const value of ["team", ":example.test", "team:", "", " : ", ...NOT_STRINGS]) {
    assert.equal(sameAwebTeamId(value, value), false, String(value));
    assert.equal(sameAwebTeamId(value, "team:example.test"), false, String(value));
    assert.equal(sameAwebTeamId("team:example.test", value), false, String(value));
  }
  assert.equal(sameAwebTeamId(undefined, undefined), false);
  assert.equal(sameAwebTeamId(), false);
});

test("teamKeyIn: an exact key wins over a case variant of it", () => {
  const map = { "team:example.test": "lower", "Team:Example.TEST": "mixed" };
  assert.equal(teamKeyIn(map, "Team:Example.TEST"), "Team:Example.TEST");
  assert.equal(teamKeyIn(map, "team:example.test"), "team:example.test");
});

test("teamKeyIn: one variant key and no exact key gives that key, as it is spelled", () => {
  const map = { " Team:Example.TEST. ": "root", "other:example.test": "elsewhere" };
  assert.equal(teamKeyIn(map, "team:example.test"), " Team:Example.TEST. ");
  assert.equal(teamKeyIn(map, "TEAM:EXAMPLE.TEST"), " Team:Example.TEST. ");
  assert.equal(teamKeyIn(map, "other:example.test"), "other:example.test");
  assert.equal(teamKeyIn(map, "third:example.test"), undefined);
});

test("teamKeyIn: two variant keys and no exact key give no key", () => {
  assert.equal(teamKeyIn({ "Team:example.test": 1, "TEAM:example.test.": 2 }, "team:example.test"), undefined);
});

test("teamKeyIn: a map that is not a plain object, or a team that is not a string, gives no key", () => {
  for (const map of [undefined, null, "team:example.test", 42, true, ["team:example.test"], ["root"]]) {
    assert.equal(teamKeyIn(map, "team:example.test"), undefined, JSON.stringify(map));
    // An array's own keys are its indexes; "0" is still no key of a team-keyed map.
    assert.equal(teamKeyIn(map, "0"), undefined, JSON.stringify(map));
  }
  // 42 is not the key "42": a non-string team matches no key, not even one spelled like it.
  for (const team of [undefined, null, 42, true, {}, ["team:example.test"]]) {
    assert.equal(teamKeyIn({ "team:example.test": 1, "42": 2, "true": 3, "null": 4, "undefined": 5 }, team), undefined, String(team));
  }
});

test("teamKeyIn: an inherited key is never a match", () => {
  for (const team of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.equal(teamKeyIn({}, team), undefined, team);
    assert.equal(teamKeyIn({ "team:example.test": 1 }, team), undefined, team);
  }
  // A key on the map's prototype is not one of its own.
  assert.equal(teamKeyIn(Object.create({ "team:example.test": 1 }), "team:example.test"), undefined);
});

/** A deployment and an instance home whose joined team is recorded with a mixed-case team id,
 *  while aw holds that team's certificate under the canonical id, in the file it names from it.
 *  aw answers every `workspace delete` with team_not_hosted, so the retire reads the joined
 *  identity's certificate id for the controller cleanup. aw's `id team list` lists the
 *  membership without its certificate id: only the certificate file can give it. */
function retireFixture(t, joinedTeam) {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-team-id-")));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const write = (p, c) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
  const DEFAULT = "default:example.test", SHARED = "shared:example.test";
  const home = join(ws, "agents", "dev", "instances", "dev-1"), sharedHome = join(home, ".aweb-identity-shared"), root = join(ws, "root");
  write(join(ws, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  write(join(root, ".aw", "identity.yaml"), "alias: root\n");
  write(join(home, ".aw", "identity.yaml"), `alias: dev-1\nteam_id: ${DEFAULT}\n`);
  write(join(home, ".aw", "team-certs", "default__example.test.pem"), JSON.stringify({ version: 1, certificate_id: "cert-default-123", team_id: DEFAULT, alias: "dev-1" }));
  write(join(sharedHome, "identity.yaml"), `alias: dev-1\nteam_id: ${SHARED}\n`);
  write(join(sharedHome, "team-certs", "shared__example.test.pem"), JSON.stringify({ version: 1, certificate_id: "cert-shared-123", team_id: SHARED, alias: "dev-1" }));
  const bin = join(ws, "bin");
  write(join(bin, "aw"), `#!${process.execPath}
let args = process.argv.slice(2), identityHome = "";
if (args[0] === "--identity-home") { identityHome = args[1]; args = args.slice(2); }
const emit = (o) => console.log(JSON.stringify(o));
const cmd = args.slice(0, 3).join(" ");
if (args[0] === "version") { console.log("aw 1.36.58 abcdef"); process.exit(0); }
if (args[0] === "workspace" && args[1] === "delete") { emit({ alias_released: false, alias_released_reason: "team_not_hosted" }); process.exit(0); }
if (cmd === "id team list") { emit({ memberships: [{ team_id: identityHome.includes(".aweb-identity-shared") ? ${JSON.stringify(SHARED)} : ${JSON.stringify(DEFAULT)}, registry_origin: "https://api.awid.ai" }] }); process.exit(0); }
if (args[0] === "wake") { console.log("ok"); process.exit(0); }
console.error("fake aw: unexpected " + args.join(" ")); process.exit(93);
`);
  chmodSync(join(bin, "aw"), 0o755);
  const meta = { alias: "dev-1", team: DEFAULT, identity: { mode: "local", alias: "dev-1", team: DEFAULT }, joinedTeams: [{ label: "shared", team: joinedTeam, identityHome: sharedHome, alias: "dev-1", receive: "poll", since: "2026-11-01T00:00:00.000Z" }] };
  const teams = [{ label: "personal", team: DEFAULT, default: true, from: "local" }, { label: "shared", team: joinedTeam, default: false, from: "shared" }];
  const env = {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, OATS_HOME: home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: ws,
    OATS_DEFAULT_TEAM: "personal", OATS_DEFAULT_TEAM_ID: DEFAULT, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify(teams), OATS_TEAMS_SOURCE: "live", OATS_RUNTIME: "claude",
    OATS_SETTINGS: JSON.stringify({ roots: { [DEFAULT]: root } }), OATS_EVENT: "retire", OATS_META: JSON.stringify(meta),
  };
  const r = spawnSync(process.execPath, [HOOK, "retire"], { cwd: home, env, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
}

test("a retire reads a joined team's certificate id from aw's file when the team is recorded in mixed case", (t) => {
  const doc = retireFixture(t, "Shared:Example.TEST");
  const shared = doc.meta.pendingControllerCleanup.find((e) => e.label === "shared");
  assert.equal(shared?.certificateId, "cert-shared-123", doc.warning);
  assert.doesNotMatch(doc.warning, /joined team shared cleanup failed: team_not_hosted; controller cleanup needs the certificate id/);
});
