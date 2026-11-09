// The aw CLI as `oats aweb setup` drives it: init, team join/invite/list, id team
// create/accept-invite/list, whoami and workspace connect/status/delete, with its
// state in the .aw under the cwd (or --identity-home). Every call is recorded in
// calls.jsonl beside the bin directory; a workspace delete also records whether
// its identity's signing.key existed when it was called.
//
// Like real aw, an init without --do-not-touch-agents-md writes AGENTS.md and
// CLAUDE.md into its cwd.
//
// Opt-in behaviour, selected by env:
//   AW_FAKE_KEYS      every identity it writes holds the private key files real
//                     aw writes (signing.key, encryption-keys/<id>.x25519.key)
//   AW_DELETE_FAIL    workspace delete is refused before it touches anything, as
//                     aw 1.36.23 refuses one: text on stderr, exit 1, no JSON on
//                     stdout even under --json
//   AW_DELETE_FAIL_FOR the same refusal, only for the joined identity home
//                     .aweb-identity-<label>
//   AW_DELETE_FAIL_SUFFIX text appended to that refusal's diagnostic
//   AW_INSPECT_*      `team invite inspect --json` (the token read from stdin, never
//                     argv; refused below AW_FAKE_VERSION 1.36.28 as aw has no such
//                     command): AW_INSPECT_KIND (hosted), AW_INSPECT_TEAM
//                     (AW_FAKE_TEAM), AW_INSPECT_SERVICE (https://app.aweb.ai/api),
//                     AW_INSPECT_SCOPE (local), AW_INSPECT_STATUS (active); or
//                     AW_INSPECT_FAIL=<code>, aw's --json error envelope on stdout
//                     whose message echoes the token, exit 1, with aw's `invite`
//                     (canonical_team_id, server_url) when AW_INSPECT_FAIL_INVITE is set
//   AW_FAKE_VERSION_FILE when it exists, `aw version` (and the inspect gate) read
//                     the version from it, so a fake npm can upgrade aw
//   accept-invite --token-stdin reads the token from stdin; the call records
//                     `stdin: true` and the token's sha256, never the token
//   id team create    as aw 1.36.56 does it for --namespace (BYOT): no invite token;
//                     it writes the team key under team-keys/ beside the bin
//                     directory, and a re-run with that key prints the same team.
//                     AW_CREATE_MODE: no-controller-key (aw's exit 2 usage error,
//                     with RAW-AW-SENTINEL in its text), token (a future aw that
//                     prints an invite token), keyless (the key lands where this
//                     user's aw cannot read it), missing-id, network-error,
//                     token-leak-error, and a name taken under another team key,
//                     replayed byte for byte from test/fixtures/byot-create/
//                     source-derived/: pinned (create-team-pinned) and
//                     registry-409 (create-team-registry-409)
//   id team register  needs the team key; prints created, then synced. With
//                     AW_REGISTER_FAIL_CODE it is refused as aw reports a server
//                     refusal: `aweb: http <AW_REGISTER_FAIL_STATUS, 422> (...): <body>`
//                     whose detail is {code: <that code>, message: RAW-AW-SENTINEL}
//   id team invite    needs the team key ("no team key for D/N"); prints a local
//                     invite as aw 1.36.56 does ({invite_id, status, token},
//                     test/fixtures/byot-create/invite-team-key.stdout) whose
//                     token is SECRET-LOCAL-INVITE__<team>
//   AW_INVITE_FAIL    team invite fails with exit 5, printing AW_INVITE_FAIL_STDERR
//                     (default "403 forbidden") on stderr and AW_INVITE_FAIL_STDOUT,
//                     when set, on stdout (aw's --json error envelope)
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { joinFromFake } from "./fake-aw-join-from.mjs";

const sourceDerived = fileURLToPath(new URL("../fixtures/byot-create/source-derived", import.meta.url));

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "oats-aweb-fake-aw-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function fakeAwSetupPath(t, { activeTeam = "active:example.invalid" } = {}) {
  const dir = tempDir(t);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const calls = join(dir, "calls.jsonl");
  const aw = join(bin, "aw");
  writeFileSync(aw, `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const calls = ${JSON.stringify(calls)};
const teamKeys = ${JSON.stringify(join(dir, "team-keys"))};
if (process.env.AWEB_IDENTITY_HOME) { console.error("unexpected ambient identity home"); process.exit(94); }
let args = process.argv.slice(2);
let identityHome = null;
if (args[0] === "--identity-home") { identityHome = args[1]; args = args.slice(2); }
const fakeVersion = () => (process.env.AW_FAKE_VERSION_FILE && fs.existsSync(process.env.AW_FAKE_VERSION_FILE) ? fs.readFileSync(process.env.AW_FAKE_VERSION_FILE, "utf8").trim() : process.env.AW_FAKE_VERSION) || "1.36.33";
if (args[0] === "version") { console.log("aw " + fakeVersion()); process.exit(0); }
const awDir = identityHome || path.join(process.cwd(), ".aw");
const deleting = args[0] === "workspace" && args[1] === "delete";
const readsStdin = (args[0] === "team" && args[1] === "invite" && args[2] === "inspect") || (args[0] === "id" && args[1] === "team" && args[2] === "accept-invite" && args.includes("--token-stdin"));
const stdinToken = readsStdin ? fs.readFileSync(0, "utf8").trim() : undefined;
fs.appendFileSync(calls, JSON.stringify({ args, cwd: process.cwd(), identityHome, hasApiKey: !!process.env.AWEB_API_KEY, ...(deleting ? { signingKey: fs.existsSync(path.join(awDir, "signing.key")) } : {}), ...(readsStdin ? { stdin: !!stdinToken, stdinSha256: stdinToken ? require("node:crypto").createHash("sha256").update(stdinToken).digest("hex") : null } : {}) }) + "\\n");
const writeKeys = (dir) => { if (!process.env.AW_FAKE_KEYS) return; fs.mkdirSync(path.join(dir, "encryption-keys"), { recursive: true }); fs.writeFileSync(path.join(dir, "signing.key"), "FIXTURE-PRIVATE-SIGNING-KEY\\n"); fs.writeFileSync(path.join(dir, "encryption-keys", "fixture.x25519.key"), "FIXTURE-PRIVATE-X25519-KEY\\n"); };
if (args[0] === "init" && args.some((a) => a.startsWith("--join-from"))) process.on("exit", (code) => { if (code === 0) writeKeys(awDir); });
(${joinFromFake})(args);
const teamsFile = path.join(awDir, "teams.json");
const writeTeams = (team, facts = {}) => { fs.mkdirSync(awDir, { recursive: true }); writeKeys(awDir); fs.writeFileSync(path.join(awDir, "identity.yaml"), "did: did:key:zFixture\\n"); fs.writeFileSync(teamsFile, JSON.stringify({ active_team: team, memberships: [{ team_id: team, ...facts }] })); };
const flag = (n) => args.find((a) => a.startsWith(n + "="))?.slice(n.length + 1) ?? (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
if (args[0] === "team" && args[1] === "list" && args.includes("--json")) {
  if (process.env.AW_LIST_TEAMS) console.log(process.env.AW_LIST_TEAMS);
  else if (fs.existsSync(teamsFile)) console.log(fs.readFileSync(teamsFile, "utf8"));
  else console.log(JSON.stringify({ memberships: [] }));
} else if (args[0] === "init") {
  if (args.includes("--new-account") && !flag("--name")) { console.error("missing required flag: --name"); process.exit(2); }
  if (args.includes("--new-account") && process.env.AW_SIGNUP_FAIL) { console.error("fixture signup failure SECRET-SIGNUP-CREDENTIAL"); process.exit(19); }
  if (args.includes("--do-not-touch-agents-md") && fs.existsSync(path.join(awDir, "identity.yaml"))) { console.log("initialized"); process.exit(0); }
  if (fs.existsSync(path.join(awDir, "identity.yaml"))) { console.error("already holds a bound identity"); process.exit(7); }
  const i = args.indexOf("--username");
  writeTeams(i >= 0 ? "default:" + args[i + 1] + ".aweb.ai" : (process.env.AW_FAKE_TEAM || ${JSON.stringify(activeTeam)}), args.includes("--new-account") ? { alias: flag("--name"), identity_scope: "local" } : {});
  if (!args.includes("--do-not-touch-agents-md")) { fs.writeFileSync("AGENTS.md", "aweb rules\\n"); fs.writeFileSync("CLAUDE.md", "@AGENTS.md\\n"); }
  console.log("initialized");
} else if (args[0] === "team" && args[1] === "join") {
  if (fs.existsSync(path.join(awDir, "identity.yaml"))) { console.error("already holds a bound identity"); process.exit(7); }
  writeTeams(process.env.AW_FAKE_TEAM || ${JSON.stringify(activeTeam)});
  console.log(JSON.stringify({ team_id: process.env.AW_FAKE_TEAM || ${JSON.stringify(activeTeam)} }));
} else if (args[0] === "team" && args[1] === "invite" && args[2] === "inspect") {
  const v = fakeVersion().split(/[.-]/).map(Number);
  if (v[0] === 1 && v[1] === 36 && v[2] < 28) { console.error("unknown command 'inspect' for 'aw team invite'"); process.exit(1); }
  if (process.env.AW_INSPECT_FAIL) { console.log(JSON.stringify({ error: { code: process.env.AW_INSPECT_FAIL, message: "refused " + stdinToken }, ...(process.env.AW_INSPECT_FAIL_INVITE ? { invite: { kind: "hosted", canonical_team_id: process.env.AW_INSPECT_TEAM || process.env.AW_FAKE_TEAM, identity_scope: "local", server_url: process.env.AW_INSPECT_SERVICE ?? "https://app.aweb.ai/api", expires_at: null, status: process.env.AW_INSPECT_FAIL } } : {}) })); process.exit(1); }
  const kind = process.env.AW_INSPECT_KIND || "hosted";
  console.log(JSON.stringify({ kind, canonical_team_id: process.env.AW_INSPECT_TEAM || process.env.AW_FAKE_TEAM || ${JSON.stringify(activeTeam)}, identity_scope: kind === "hosted" ? (process.env.AW_INSPECT_SCOPE || "local") : "unknown", server_url: process.env.AW_INSPECT_SERVICE ?? "https://app.aweb.ai/api", ...(kind === "hosted" ? { expires_at: null } : {}), status: kind === "hosted" ? (process.env.AW_INSPECT_STATUS || "active") : "unverified" }));
} else if (args[0] === "team" && args[1] === "invite") {
  if (process.env.AW_INVITE_FAIL) { if (process.env.AW_INVITE_FAIL_STDOUT) console.log(process.env.AW_INVITE_FAIL_STDOUT); console.error(process.env.AW_INVITE_FAIL_STDERR || "403 forbidden"); process.exit(5); }
  console.log(JSON.stringify({ token: process.env.AW_INVITE_TOKEN || "INVITE-TOKEN" }));
} else if (args[0] === "id" && args[1] === "team" && args[2] === "list") {
  if (fs.existsSync(teamsFile)) console.log(fs.readFileSync(teamsFile, "utf8"));
  else console.log(JSON.stringify({ memberships: [] }));
} else if (args[0] === "id" && args[1] === "team" && args[2] === "invite") {
  const name = flag("--team"), namespace = flag("--namespace");
  if (!fs.existsSync(path.join(teamKeys, namespace, name + ".key"))) { const m = "no team key for " + namespace + "/" + name + "; run \`aw id team create\` first"; console.error(m); console.log(JSON.stringify({ error: { code: "error", message: m } })); process.exit(2); }
  console.log(JSON.stringify({ invite_id: "00000000-0000-4000-8000-000000000208", status: "created", token: "SECRET-LOCAL-INVITE__" + name + ":" + namespace }));
} else if (args[0] === "id" && args[1] === "team" && args[2] === "register") {
  const team = flag("--team"), [name, namespace] = team.split(":");
  if (!fs.existsSync(path.join(teamKeys, namespace, name + ".key"))) { const m = "local team controller key for " + team + " was not found: open " + path.join(teamKeys, namespace, name + ".key") + ": no such file or directory RAW-AW-SENTINEL"; console.error(m); console.log(JSON.stringify({ error: { code: "error", message: m } })); process.exit(1); }
  if (process.env.AW_REGISTER_FAIL_CODE !== undefined) { console.error("aweb: http " + (process.env.AW_REGISTER_FAIL_STATUS || "422") + " (Content-Type: application/json; X-Fixture: RAW-AW-SENTINEL): " + JSON.stringify({ detail: { code: process.env.AW_REGISTER_FAIL_CODE, message: "RAW-AW-SENTINEL " + flag("--service") } })); process.exit(1); }
  const registered = path.join(teamKeys, namespace, name + ".registered");
  const status = fs.existsSync(registered) ? "synced" : "created";
  fs.writeFileSync(registered, flag("--service"));
  console.log(JSON.stringify({ status, team_id: team, service: flag("--service") }));
} else if (args[0] === "id" && args[1] === "team" && args[2] === "create") {
  const name = flag("--name");
  const namespace = flag("--namespace") || "aweb.ai";
  const team = name + ":" + namespace;
  if (process.env.AW_CREATE_MODE === "no-controller-key") { const m = "no local controller key for --namespace " + namespace + "; pass --hosted for a hosted sibling, or install the namespace controller key for BYOT (aw id namespace prepare-controller --domain " + namespace + ") RAW-AW-SENTINEL"; console.error(m); console.log(JSON.stringify({ error: { code: "error", message: m } })); process.exit(2); }
  if (process.env.AW_CREATE_MODE === "network-error") { console.error("network unavailable"); process.exit(73); }
  if (process.env.AW_CREATE_MODE === "token-leak-error") { console.error("network unavailable token=SECRET-FRESH-INVITE"); process.exit(73); }
  const taken = { pinned: "create-team-pinned", "registry-409": "create-team-registry-409" }[process.env.AW_CREATE_MODE];
  if (taken) { const f = (ext) => fs.readFileSync(path.join(${JSON.stringify(sourceDerived)}, taken + "." + ext), "utf8"); process.stderr.write(f("stderr")); process.stdout.write(f("stdout")); process.exit(Number(f("exit"))); }
  if (process.env.AW_CREATE_MODE === "missing-id") { console.log(JSON.stringify({ invite_token: "TOKEN__" + team })); process.exit(0); }
  const key = path.join(teamKeys, namespace, name + ".key");
  if (process.env.AW_CREATE_MODE !== "keyless") { fs.mkdirSync(path.dirname(key), { recursive: true }); if (!fs.existsSync(key)) fs.writeFileSync(key, "FIXTURE-TEAM-KEY\\n"); }
  if (process.env.AW_CREATE_MODE === "token") { console.log(JSON.stringify({ team_id: team, invite_token: "TOKEN__" + team, aweb_url: "https://app.aweb.ai/api" })); process.exit(0); }
  console.log(JSON.stringify({ status: "created", team_id: team, team_did_key: "did:key:zFixtureTeam", team_key_path: key, registry_url: "https://api.awid.ai" }));
} else if (args[0] === "id" && args[1] === "team" && args[2] === "accept-invite") {
  if (process.env.AW_ACCEPT_FAIL) {
    if (process.env.AW_ACCEPT_FAIL_ADDITION) fs.writeFileSync(path.join(path.dirname(awDir), "concurrent-data"), "keep addition");
    if (process.env.AW_ACCEPT_FAIL_PARTIAL) { fs.mkdirSync(awDir, { recursive: true }); fs.writeFileSync(path.join(awDir, "identity.yaml"), "partial identity"); }
    console.error("fixture acceptance failure"); process.exit(17);
  }
  const team = process.env.AW_FAKE_TEAM || (stdinToken ?? args[3]).replace(/^(?:TOKEN__|SECRET-LOCAL-INVITE__)/, "");
  writeTeams(team, { alias: flag("--name") || "root", identity_scope: "local" });
  console.log(JSON.stringify({ team_id: team, alias: flag("--name") || "root", ...(process.env.AW_ACCEPT_OMIT_SERVICE ? {} : { aweb_url: "https://app.aweb.ai/api" }) }));
} else if (args[0] === "whoami") {
  if (process.env.AW_WHOAMI_FAIL) { console.error("no identity"); process.exit(6); }
  console.log(JSON.stringify({ alias: "fixture", did: "did:key:zFixture" }));
} else if (deleting) {
  if (process.env.AW_DELETE_FAIL || (process.env.AW_DELETE_FAIL_FOR && path.basename(awDir) === ".aweb-identity-" + process.env.AW_DELETE_FAIL_FOR)) { console.error("Error: delete workspace " + args[2] + ": 503 Service Unavailable: team controller unavailable" + (process.env.AW_DELETE_FAIL_SUFFIX || "")); process.exit(1); }
  fs.rmSync(awDir, { recursive: true, force: true });
  console.log(JSON.stringify({ alias_released: true, alias_released_reason: "released" }));
} else if (args[0] === "workspace" && args[1] === "connect") {
  if (process.env.AW_CONNECT_FAIL) { console.error("connect refused by fixture"); process.exit(11); }
  fs.mkdirSync(awDir, { recursive: true });
  fs.writeFileSync(path.join(awDir, "workspace.yaml"), "team_id: " + flag("--team") + "\\naweb_url: " + flag("--service") + "\\nalias: fixture\\n");
  console.log(JSON.stringify({ status: "connected" }));
} else if (args[0] === "workspace" && args[1] === "status") {
  console.log(JSON.stringify({ selected_team: ${JSON.stringify(activeTeam)}, workspace: { alias: "fixture", workspace_path: process.cwd() } }));
} else if (args[0] === "wake") {
  console.log("ok");
} else {
  console.error("unexpected fake aw " + args.join(" "));
  process.exit(93);
}
`, { mode: 0o755 });
  chmodSync(aw, 0o755);
  return { path: bin, calls, readCalls: () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [] };
}
