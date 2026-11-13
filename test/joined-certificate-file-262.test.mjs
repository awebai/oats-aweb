// A joined team's certificate file is found under the name aw gives it (awebai/oats-aweb#262).
// aw 1.36.58 (cli/go), at aw-compat's tested version:
//   - the writer: `aw id team accept-invite` and `aw id team fetch-cert` both name the team by
//     its canonical id, awid.BuildTeamID (cmd/aw/id_team.go:1906 and :2837), and save its
//     certificate through saveAcceptedTeamCertificate (:2000, :2920; :3983-3988), which names
//     the file TeamCertificateRelativePath(teamID) (awconfig/team_certs.go:71-84);
//   - the name: EncodeTeamIDForCertificatePath (awconfig/team_certs.go:23-28) trims the id,
//     writes each "__" as "____", then each ":" as "__", and the file is team-certs/<that>.pem
//     (:30-32).
// The expected names below are written out by hand from that rule.
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
const { teamCertificateRelativePath } = await import(pathToFileURL(join(CAPABILITY, "lib", "aweb-team-id.mjs")).href);

test("teamCertificateRelativePath names the file aw writes for a team id", () => {
  for (const [team, file] of [
    ["team:example.test", "team-certs/team__example.test.pem"],
    ["my__team:example.test", "team-certs/my____team__example.test.pem"],
    // Go's strings.ReplaceAll replaces left to right without overlap: "___" is "__" then "_".
    ["a___b:example.test", "team-certs/a_____b__example.test.pem"],
    ["a____b:example.test", "team-certs/a________b__example.test.pem"],
    ["team:ex__ample.test", "team-certs/team__ex____ample.test.pem"],
    // aw writes the canonical id's file, so a team spelled another way finds the same file.
    ["My__Team:Example.TEST.", "team-certs/my____team__example.test.pem"],
    ["  team : example.test  ", "team-certs/team__example.test.pem"],
  ]) assert.equal(teamCertificateRelativePath(team), file, team);
});

test("teamCertificateRelativePath names no file for a value that is not a team id", () => {
  for (const value of ["team", ":example.test", "team:", "", undefined, null, 42, {}]) {
    assert.equal(teamCertificateRelativePath(value), undefined, String(value));
  }
});

/** A deployment and an instance home whose joined team `shared` is recorded as `joinedTeam`,
 *  while aw holds that team's certificate in `certFile` under the canonical id `canonical`. aw
 *  answers every `workspace delete` with team_not_hosted, so the retire reads the joined
 *  identity's certificate id for the controller cleanup. aw's `id team list` lists the
 *  membership without its certificate id: only the certificate file can give it. */
function retire(t, { joinedTeam, canonical, certFile }) {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-certfile-")));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const write = (p, c) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
  const DEFAULT = "default:example.test";
  const home = join(ws, "agents", "dev", "instances", "dev-1"), sharedHome = join(home, ".aweb-identity-shared"), root = join(ws, "root");
  write(join(ws, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  write(join(root, ".aw", "identity.yaml"), "alias: root\n");
  write(join(home, ".aw", "identity.yaml"), `alias: dev-1\nteam_id: ${DEFAULT}\n`);
  write(join(home, ".aw", "team-certs", "default__example.test.pem"), JSON.stringify({ version: 1, certificate_id: "cert-default-123", team_id: DEFAULT, alias: "dev-1" }));
  write(join(sharedHome, "identity.yaml"), `alias: dev-1\nteam_id: ${canonical}\n`);
  write(join(sharedHome, "team-certs", certFile), JSON.stringify({ version: 1, certificate_id: "cert-shared-123", team_id: canonical, alias: "dev-1" }));
  const bin = join(ws, "bin");
  write(join(bin, "aw"), `#!${process.execPath}
let args = process.argv.slice(2), identityHome = "";
if (args[0] === "--identity-home") { identityHome = args[1]; args = args.slice(2); }
const emit = (o) => console.log(JSON.stringify(o));
const cmd = args.slice(0, 3).join(" ");
if (args[0] === "version") { console.log("aw 1.36.58 abcdef"); process.exit(0); }
if (args[0] === "workspace" && args[1] === "delete") { emit({ alias_released: false, alias_released_reason: "team_not_hosted" }); process.exit(0); }
if (cmd === "id team list") { emit({ memberships: [{ team_id: identityHome.includes(".aweb-identity-shared") ? ${JSON.stringify(canonical)} : ${JSON.stringify(DEFAULT)}, registry_origin: "https://api.awid.ai" }] }); process.exit(0); }
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
  const doc = JSON.parse(r.stdout);
  return { doc, shared: doc.meta.pendingControllerCleanup.find((e) => e.label === "shared") };
}

test("a retire reads the certificate id from aw's file for a team whose name holds \"__\", and records its controller command", (t) => {
  const { doc, shared } = retire(t, { joinedTeam: "my__team:example.test", canonical: "my__team:example.test", certFile: "my____team__example.test.pem" });
  assert.equal(shared?.certificateId, "cert-shared-123", doc.warning);
  assert.equal(shared?.command, "aw id team remove-member --namespace example.test --team my__team --cert-id cert-shared-123 --registry https://api.awid.ai --json", doc.warning);
});

test("a retire finds that file for the team recorded in mixed case", (t) => {
  const { doc, shared } = retire(t, { joinedTeam: "My__Team:Example.TEST", canonical: "my__team:example.test", certFile: "my____team__example.test.pem" });
  assert.equal(shared?.certificateId, "cert-shared-123", doc.warning);
});
