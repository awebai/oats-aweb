import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
function write(p,c) {mkdirSync(dirname(p),{recursive:true});writeFileSync(p,c);}
export function fakeAw(base) {
  const bin = join(base, "bin"); mkdirSync(bin, { recursive: true });
  write(join(bin, "aw"), `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const a = process.argv.slice(2);
const s = a.join(" ");
const log = ${JSON.stringify(join(base, "aw.log"))};
const j = (obj) => JSON.stringify(obj, null, 2);
function versionTuple(v) { return String(v || "0.0.0").replace(/^aw\\s+v?/, "").replace(/^v/, "").split(".").slice(0, 3).map(n => Number(n) || 0); }
function atLeast(v, f) { const A = versionTuple(v), B = versionTuple(f); for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] > B[i]; return true; }
function val(flag) { const eq = a.find((x) => x.startsWith(flag + "=")); if (eq) return eq.slice(flag.length + 1); const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; }
// The resident's grants, as the server keeps them: every grant ever minted, newest
// first, with label, status and expiry (aw id grant list --json, aw 1.36.32).
const registry = ${JSON.stringify(join(base, "grants.json"))};
const grants = () => { try { return JSON.parse(fs.readFileSync(registry, "utf8")); } catch { return []; } };
const saveGrants = (g) => fs.writeFileSync(registry, JSON.stringify(g));
function csv(name, fallback) { return String(process.env[name] || fallback).split(",").map(s => s.trim()).filter(Boolean); }
fs.appendFileSync(log, JSON.stringify({ argv: a, cwd: process.cwd(), identityHome: process.env.AWEB_IDENTITY_HOME || null }) + "\\n");
if (a[0] === "id" && a[1] === "grant" && process.env.AWEB_IDENTITY_HOME) { console.error("grant command refuses external identity home"); process.exit(2); }
if (s === "version") { console.log("aw " + (process.env.FAKE_AW_VERSION || "1.36.32")); process.exit(0); }
if (s.startsWith("wake status")) { console.log(j({ instances: [] })); process.exit(0); }
if (a[0] === "wake" && a[1] === "register" && process.env.FAKE_WAKE_REGISTER_FAIL) { console.error("broker socket refused"); process.exit(1); }
if (s.startsWith("wake ")) process.exit(0);
// Retained-seat responses are opt-in and stay inside the temporary fixture.
if (process.env.FAKE_RETAINED === "1") {
  if (a[0] === "workspace" && a[1] === "connect") process.exit(0);
  if (a[0] === "check" || a[0] === "heartbeat") process.exit(0);
  if (s === "workspace status --json") { console.log(j({workspace:{alias:"retained",workspace_path:process.cwd()}})); process.exit(0); }
  if (s === "whoami --json") { console.log(j({did:"did:key:zRetained",address:"fixture.test/retained"})); process.exit(0); }
}

if (a[0] === "team" && a[1] === "list" && a.includes("--json")) {
  let active = process.env.FAKE_ACTIVE_TEAM || "";
  try { active = fs.readFileSync(path.join(process.cwd(), ".aw", "teams.yaml"), "utf8").split(/\\n/).find(l => l.startsWith("active_team:"))?.split("active_team:")[1].trim() || active; } catch {}
  console.log(j({ active_team: active || null, memberships: active ? [{ team_id: active }] : [] })); process.exit(0);
}
// custody status ops follow aw 1.36.32 (derived from its source at df6bb193,
// cmd/aw/custody.go:306): grant_never_ttl.v1 is always listed; the E2EE ops and
// mail_reply_continuation.v1 come together, only with E2EE keys.
if (a[0] === "custody" && a[1] === "status" && a.includes("--json")) {
  const team = process.env.FAKE_CUSTODY_TEAM || "t:example.test";
  if (process.env.AWEB_IDENTITY_HOME) {
    if (process.env.FAKE_VERIFY_ERROR) { console.error(process.env.FAKE_VERIFY_ERROR); process.exit(1); }
    let text = ""; try { text = fs.readFileSync(path.join(process.env.AWEB_IDENTITY_HOME, "grant.yaml"), "utf8"); } catch {}
    const line = text.split("\\n").find((l) => l.trim().startsWith("socket_path:"));
    if (!line) { console.error("grant home has no custody.socket_path locator"); process.exit(1); }
    const socket = line.split("socket_path:")[1].trim();
    console.log(j({ status: process.env.FAKE_VERIFY_STATUS || "running", service_id: "custody-fake-4c353d6d", socket_path: process.env.FAKE_VERIFY_SOCKET || socket, resident: { did_aw: "did:aw:resident", did_key: "did:key:resident", address: "oats.aweb.ai/resident-alias", alias: process.env.FAKE_VERIFY_ALIAS || "resident-alias" }, teams: [{ team_id: team, ready: process.env.FAKE_VERIFY_TEAM_READY !== "0", certificate_present: true }], keys: { signing_ready: true, encryption_ready: true }, ops: ["status.v1", "sign_plain_message.v1", "sign_app_request.v1", "grant_never_ttl.v1", "create_e2ee_envelope.v1", "unwrap_e2ee_message.v1", "mail_reply_continuation.v1"] }));
    process.exit(0);
  }
  const doc = {
    status: process.env.FAKE_CUSTODY_STATUS || "running",
    service_id: "custody-fake-4c353d6d",
    ...(process.env.FAKE_NO_PREFLIGHT_SOCKET ? {} : { socket_path: process.env.FAKE_CUSTODY_SOCKET || path.join(process.cwd(), "custody.sock") }),
    resident: { did_aw: "did:aw:resident", did_key: "did:key:resident", address: "oats.aweb.ai/resident-alias", alias: "resident-alias" },
    teams: process.env.FAKE_CUSTODY_TEAMS ? JSON.parse(process.env.FAKE_CUSTODY_TEAMS) : [{ team_id: team, ready: process.env.FAKE_TEAM_READY !== "0", certificate_present: process.env.FAKE_CERTIFICATE_PRESENT !== "0", grant_status_endpoint_ready: process.env.FAKE_GRANT_STATUS_ENDPOINT_READY !== "0" }],
    keys: { signing_ready: process.env.FAKE_SIGNING_READY !== "0", encryption_ready: process.env.FAKE_ENCRYPTION_READY !== "0", encryption_key_id: "enc-1" },
    ops: csv("FAKE_CUSTODY_OPS", "status.v1,sign_plain_message.v1,sign_app_request.v1,grant_never_ttl.v1,create_e2ee_envelope.v1,unwrap_e2ee_message.v1,mail_reply_continuation.v1"),
    freshness: { source: "fake", last_checked_at: "2026-09-24T00:00:00Z", max_cache_age_seconds: 30 },
    errors: process.env.FAKE_CUSTODY_ERRORS ? JSON.parse(process.env.FAKE_CUSTODY_ERRORS) : []
  };
  console.log(j(doc)); process.exit(0);
}
if (a[0] === "id" && a[1] === "grant" && a[2] === "mint") {
  if (process.env.FAKE_MINT_FAIL) { console.error("mint unavailable"); process.exit(1); }
  // An aweb server without never-grants refuses the mint (aw exits 1, error on
  // stderr, nothing on stdout, no grant minted); aw has already made --out.
  if (process.env.FAKE_MINT_STDERR) { if (val("--out")) fs.mkdirSync(val("--out"), { recursive: true, mode: 0o700 }); console.error(process.env.FAKE_MINT_STDERR); process.exit(1); }
  const out = val("--out");
  const socket = val("--custody-socket");
  if (!out) { console.error("missing --out"); process.exit(2); }
  if (!socket) { console.error("missing --custody-socket"); process.exit(2); }
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const suffix = path.basename(out).replace(/^\\.aweb-identity-?/, "") || "spawn";
  // Grant ids are unique, as the server's are, even when a grant home name is reused.
  let grant = "grant-" + suffix;
  for (let n = 2; grants().some(g => g.grant_id === grant); n++) grant = "grant-" + suffix + "-" + n;
  const team = process.env.FAKE_GRANT_TEAM || val("--team") || "t:example.test";
  const written = process.env.FAKE_GRANT_SOCKET === "missing" ? null : (process.env.FAKE_GRANT_SOCKET || socket);
  const subjectAlias = process.env.FAKE_GRANT_SUBJECT_ALIAS === "missing" ? null : (process.env.FAKE_GRANT_SUBJECT_ALIAS || "resident-alias");
  // aw 1.36.32 renders a never-grant's expiry as the string "never" (mint JSON and grant.yaml).
  const expires = process.env.FAKE_MINT_EXPIRES !== undefined ? process.env.FAKE_MINT_EXPIRES : (val("--ttl") === "never" ? "never" : "2026-09-24T07:00:00Z");
  // A grant created on the server whose receipt is unreadable and whose grant home was never written.
  if (process.env.FAKE_MINT_GARBAGE) { saveGrants([{ grant_id: grant, team_id: team, label: val("--label") || "", status: "active", expires_at: expires }, ...grants()]); console.log("minted, but no receipt"); process.exit(0); }
  fs.writeFileSync(path.join(out, "grant.yaml"), "version: 1\\ngrant_id: " + grant + "\\nteam_id: " + team + "\\nexpires_at: " + expires + "\\n" + (subjectAlias ? "subject:\\n  alias: " + subjectAlias + "\\n" : "") + (written ? "custody:\\n  socket_path: " + written + "\\n" : ""));
  saveGrants([{ grant_id: grant, team_id: team, label: val("--label") || "", status: "active", expires_at: expires }, ...grants()]);
  // aw creates the grant on the server first, then writes the grant home: a
  // failure there (or a timeout) exits 1 with the grant already live.
  if (process.env.FAKE_MINT_FAIL_AFTER_REGISTER) { console.error(process.env.FAKE_MINT_FAIL_AFTER_REGISTER); process.exit(1); }
  const reply = { grant_id: grant, expires_at: expires, team_id: team, address: "oats.aweb.ai/resident-alias", out };
  if (process.env.FAKE_MINT_ALIAS !== "missing") reply.alias = process.env.FAKE_MINT_ALIAS || "resident-alias";
  if (process.env.FAKE_APP_INVENTORY) Object.assign(reply, JSON.parse(process.env.FAKE_APP_INVENTORY));
  console.log(j(reply));
  process.exit(0);
}
if (a[0] === "id" && a[1] === "grant" && a[2] === "revoke") {
  // FAKE_REVOKE_FAIL: "1" fails every revoke, a grant id fails only that grant's.
  if (process.env.FAKE_REVOKE_FAIL && (process.env.FAKE_REVOKE_FAIL === "1" || process.env.FAKE_REVOKE_FAIL.split(",").includes(a[3]))) { console.error("revoke unavailable"); process.exit(1); }
  saveGrants(grants().map(g => g.grant_id === a[3] ? { ...g, status: "revoked" } : g));
  console.log(j({ grant_id: a[3], status: "revoked" })); process.exit(0);
}
if (a[0] === "id" && a[1] === "grant" && a[2] === "list") {
  if (process.env.FAKE_GRANT_LIST_FAIL) { console.error(process.env.FAKE_GRANT_LIST_FAIL); process.exit(1); }
  if (process.env.FAKE_GRANT_LIST_SLEEP_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.FAKE_GRANT_LIST_SLEEP_MS));
  const team = val("--team");
  console.log(j({ grants: grants().filter(g => !team || g.team_id === team) })); process.exit(0);
}
if (a[0] === "id" && a[1] === "grant" && a[2] === "show") { console.log(j({ grant_id: a[3], status: "revoked" })); process.exit(0); }
console.error("fake aw: unexpected " + s); process.exit(2);
`);
  chmodSync(join(bin, "aw"), 0o755);
  return bin;
}
