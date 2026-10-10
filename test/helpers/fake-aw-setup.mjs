// The aw CLI as `oats aweb setup` drives it: init, team join/invite/list, id team
// create/accept-invite/list, whoami and workspace connect/status/delete, with its
// state in the .aw under the cwd (or --identity-home). Every call is recorded in
// calls.jsonl beside the bin directory; a workspace delete also records whether
// its identity's signing.key existed when it was called.
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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { joinFromFake } from "./fake-aw-join-from.mjs";

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
if (process.env.AWEB_IDENTITY_HOME) { console.error("unexpected ambient identity home"); process.exit(94); }
let args = process.argv.slice(2);
let identityHome = null;
if (args[0] === "--identity-home") { identityHome = args[1]; args = args.slice(2); }
if (args[0] === "version") { console.log("aw " + (process.env.AW_FAKE_VERSION || "1.36.30")); process.exit(0); }
const awDir = identityHome || path.join(process.cwd(), ".aw");
const deleting = args[0] === "workspace" && args[1] === "delete";
fs.appendFileSync(calls, JSON.stringify({ args, cwd: process.cwd(), identityHome, hasApiKey: !!process.env.AWEB_API_KEY, ...(deleting ? { signingKey: fs.existsSync(path.join(awDir, "signing.key")) } : {}) }) + "\\n");
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
  console.log("initialized");
} else if (args[0] === "team" && args[1] === "join") {
  if (fs.existsSync(path.join(awDir, "identity.yaml"))) { console.error("already holds a bound identity"); process.exit(7); }
  writeTeams(process.env.AW_FAKE_TEAM || ${JSON.stringify(activeTeam)});
  console.log(JSON.stringify({ team_id: process.env.AW_FAKE_TEAM || ${JSON.stringify(activeTeam)} }));
} else if (args[0] === "team" && args[1] === "invite") {
  if (process.env.AW_INVITE_FAIL) { console.error("403 forbidden"); process.exit(5); }
  console.log(JSON.stringify({ token: process.env.AW_INVITE_TOKEN || "INVITE-TOKEN" }));
} else if (args[0] === "id" && args[1] === "team" && args[2] === "list") {
  if (fs.existsSync(teamsFile)) console.log(fs.readFileSync(teamsFile, "utf8"));
  else console.log(JSON.stringify({ memberships: [] }));
} else if (args[0] === "id" && args[1] === "team" && args[2] === "create") {
  const name = flag("--name");
  const namespace = flag("--namespace") || "aweb.ai";
  const team = name + ":" + namespace;
  if (process.env.AW_CREATE_MODE === "network-error") { console.error("network unavailable"); process.exit(73); }
  if (process.env.AW_CREATE_MODE === "token-leak-error") { console.error("network unavailable token=SECRET-FRESH-INVITE"); process.exit(73); }
  if (process.env.AW_CREATE_MODE === "conflict") { console.error("409 conflict: team exists"); process.exit(9); }
  if (process.env.AW_CREATE_MODE === "conflict-once") { const creates = fs.readFileSync(calls, "utf8").trim().split("\\n").filter((l) => JSON.parse(l).args.slice(0,3).join(" ") === "id team create").length; if (creates === 1) { console.error("409 conflict: team exists"); process.exit(9); } }
  if (process.env.AW_CREATE_MODE === "missing-id") { console.log(JSON.stringify({ invite_token: "TOKEN__" + team })); process.exit(0); }
  if (process.env.AW_CREATE_MODE === "missing-token") { console.log(JSON.stringify({ team_id: team })); process.exit(0); }
  console.log(JSON.stringify({ team_id: team, invite_token: "TOKEN__" + team, aweb_url: "https://app.aweb.ai/api" }));
} else if (args[0] === "id" && args[1] === "team" && args[2] === "accept-invite") {
  if (process.env.AW_ACCEPT_FAIL) {
    if (process.env.AW_ACCEPT_FAIL_ADDITION) fs.writeFileSync(path.join(path.dirname(awDir), "concurrent-data"), "keep addition");
    if (process.env.AW_ACCEPT_FAIL_PARTIAL) { fs.mkdirSync(awDir, { recursive: true }); fs.writeFileSync(path.join(awDir, "identity.yaml"), "partial identity"); }
    console.error("fixture acceptance failure"); process.exit(17);
  }
  const team = process.env.AW_FAKE_TEAM || args[3].replace(/^TOKEN__/, "");
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
