import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { joinFromFake } from "./fake-aw-join-from.mjs";

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-wake-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

/** A fake aw 1.36.13 modelling the 1.15 surface: multi-identity wake
 *  registration and wake status derived from the stored registration. Any
 *  `aw auth …` or `aw team ensure` call is recorded as forbidden, exits 97, and
 *  fails the test: 1.15 defers default-team enrollment to 1.16.
 *  FAKE_WAKE_FAIL=register|deregister makes that `aw wake` subcommand fail;
 *  FAKE_WAKE_DEREGISTER_LATE makes deregister exit 0 and keep the registration,
 *  as aw does when the daemon does not answer in time. */
export function fakeAwWake(t, { daemon = true, version = "1.36.13", daemonVersion = "1.36.13" } = {}) {
  // Registered before tempDir's cleanup so it still sees the call log.
  let readCalls = () => [];
  t.after(() => assert.deepEqual(readCalls().filter((c) => c.forbidden).map((c) => c.args.join(" ")), [], "oats.aweb 1.15 must not call aw auth or aw team ensure"));
  const base = tempDir(t);
  const bin = join(base, "bin");
  const calls = join(base, "calls.jsonl");
  const reg = join(base, "registrations.json");
  const statusFile = join(base, "status.json");
  write(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
let args = process.argv.slice(2), identityHome = null;
if (args[0] === "--identity-home") { identityHome = args[1]; args = args.slice(2); }
let stdin = "";
if (args.includes("--registration-json")) { try { stdin = fs.readFileSync(0, "utf8"); } catch {} }
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, cwd: process.cwd(), identityHome, stdin }) + "\\n");
(${joinFromFake})(args);
const emit = (o) => console.log(JSON.stringify(o));
const regs = () => { try { return JSON.parse(fs.readFileSync(${JSON.stringify(reg)}, "utf8")); } catch { return {}; } };
const saveRegs = (r) => fs.writeFileSync(${JSON.stringify(reg)}, JSON.stringify(r));
const flag = (n) => args.find((a) => a.startsWith(n + "="))?.slice(n.length + 1) ?? (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const home = () => identityHome || path.join(process.cwd(), ".aw");
// aw 1.36.13: an AWEB_IDENTITY_HOME in the environment is an external identity
// home exactly like --identity-home; commands off the allowlist are refused.
const ALLOWED = ["id team accept-invite", "mail inbox", "mail send", "mail reply", "chat pending", "workspace connect", "workspace delete", "wake register", "wake deregister", "wake status", "whoami", "version"];
if (process.env.AWEB_IDENTITY_HOME && !identityHome) {
  const p2 = args.slice(0, 2).join(" "), p3 = args.slice(0, 3).join(" ");
  if (!ALLOWED.includes(p2) && !ALLOWED.includes(p3) && args[0] !== "version") { console.error('command "aw ' + (args[0] === "id" ? p3 : p2) + '" is not yet identity-home-aware; refusing to use an external identity home'); process.exit(2); }
  if (args[0] === "workspace" && args[1] === "delete") { fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, cwd: process.cwd(), identityHome: process.env.AWEB_IDENTITY_HOME, viaEnv: true }) + "\\n"); console.error("permission denied: not this identity's workspace"); process.exit(8); }
}
if (args[0] === "version") { console.log("aw ${version} 44786439"); process.exit(0); }
if (args[0] === "auth" || (args[0] === "team" && args[1] === "ensure")) { fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, cwd: process.cwd(), identityHome, forbidden: true }) + "\\n"); console.error("FORBIDDEN in oats.aweb 1.15: aw " + args.join(" ")); process.exit(97); }
if (args[0] === "team" && args[1] === "list") { emit({ active_team: "legacy:example.test", memberships: [{ team_id: "legacy:example.test" }, { team_id: "alpha:example.test" }, { team_id: "beta:example.test" }] }); process.exit(0); }
if (args[0] === "team" && args[1] === "invite") { if (identityHome) { console.error('command "aw team invite" is not yet identity-home-aware'); process.exit(2); } emit({ token: "TOKEN__" + flag("--team-id") }); process.exit(0); }
if (args[0] === "team" && args[1] === "join") { const team = args[2].replace(/^TOKEN__/, ""), alias = flag("--name"); fs.mkdirSync(home(), { recursive: true }); fs.writeFileSync(path.join(home(), "identity.yaml"), "alias: " + alias + "\\n"); emit({ alias, team_id: team }); process.exit(0); }
if (args[0] === "id" && args[1] === "team" && args[2] === "accept-invite") { const team = args[3].replace(/^TOKEN__/, ""), alias = flag("--name"); fs.mkdirSync(path.join(home(), "team-certs"), { recursive: true }); fs.writeFileSync(path.join(home(), "identity.yaml"), "alias: " + alias + "\\nteam_id: " + team + "\\n"); emit({ status: "accepted", team_id: team, alias, aweb_url: "https://app.aweb.ai/api" }); process.exit(0); }
if (args[0] === "id" && args[1] === "team" && args[2] === "members") { emit({ team_id: flag("--team-id"), members: [{ alias: "dev-1" }, { alias: "alice" }] }); process.exit(0); }
if (args[0] === "init") { console.log("initialized"); process.exit(0); }
if (args[0] === "workspace" && args[1] === "connect") { const team = flag("--team"), service = flag("--service") || "https://app.aweb.ai/api"; fs.mkdirSync(home(), { recursive: true }); fs.writeFileSync(path.join(home(), "workspace.yaml"), "alias: connected\\nteam_id: " + team + "\\naweb_url: " + service + "\\n"); emit({ status: "connected", team_id: team, aweb_url: service }); process.exit(0); }
if (args[0] === "workspace" && args[1] === "delete") { if (process.env.FAKE_DELETE_FAIL_FOR && String(identityHome || "").endsWith(".aweb-identity-" + process.env.FAKE_DELETE_FAIL_FOR)) { console.error("delete failed"); process.exit(7); } fs.rmSync(home(), { recursive: true, force: true }); emit({ alias: args[2], alias_released: true, alias_released_reason: "released" }); process.exit(0); }
if (args[0] === "wake" && process.env.FAKE_WAKE_FAIL === args[1]) { console.error("wake " + args[1] + " failed"); process.exit(5); }
if (args[0] === "wake" && args[1] === "register") {
  const r = regs();
  if (args.includes("--registration-json")) { const doc = JSON.parse(stdin); if (process.env.FAKE_WAKE_REFUSE) { console.error("refused"); process.exit(2); } r[doc.home] = doc; }
  else r[flag("--home")] = { home: flag("--home"), identity_home: flag("--identity-home"), delivery: flag("--delivery") };
  saveRegs(r); console.log("registered"); process.exit(0);
}
if (args[0] === "wake" && args[1] === "deregister" && process.env.FAKE_WAKE_DEREGISTER_LATE) { console.log("deregistered"); process.exit(0); }
if (args[0] === "wake" && args[1] === "deregister") { const r = regs(); delete r[flag("--home")]; saveRegs(r); console.log("deregistered"); process.exit(0); }
if (args[0] === "wake" && args[1] === "status") {
  if (fs.existsSync(${JSON.stringify(statusFile)})) { console.log(fs.readFileSync(${JSON.stringify(statusFile)}, "utf8")); process.exit(0); }
  const running = !process.env.FAKE_DAEMON_DOWN && ${JSON.stringify(daemon)};
  const instances = Object.values(regs()).map((doc) => ({ home: doc.home, identity_home: doc.identity_home || doc.receive_identities?.[0]?.identity_home, primary_identity_home: doc.primary_identity_home, delivery: doc.delivery, runtime_delivery: doc.runtime_delivery || "external-session", phase: running ? "active" : "pending", paused: false, receive_identities: (doc.receive_identities || [{ identity_home: doc.identity_home, controls: true }]).map((ri) => ({ ...ri, delivery_owner: "session-hints", stream_admitted: running, stream_phase: running ? "streaming" : "daemon-down" })) }));
  emit({ daemon_running: running, daemon_version_state: running ? "reported" : "not_running", daemon_version: running ? ${JSON.stringify(daemonVersion)} : undefined, instances });
  process.exit(0);
}
console.error("unexpected fake aw " + args.join(" ")); process.exit(93);
`);
  spawnSync("chmod", ["755", join(bin, "aw")]);
  readCalls = () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  return {
    path: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    readCalls,
    setStatus: (status) => writeFileSync(statusFile, typeof status === "string" ? status : JSON.stringify(status)),
    registrations: () => { try { return JSON.parse(readFileSync(reg, "utf8")); } catch { return {}; } },
  };
}
