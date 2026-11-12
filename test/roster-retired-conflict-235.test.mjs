// awebai/oats-aweb#235: the retired-certificates record is writable by any agent running as the
// deployment's user, so its mark is a claim. When a member it marks retired has a workspace that
// reads `active` in presence, `oats aweb roster` shows the conflict instead of the mark and the
// controller's command: "recorded as retired, but its workspace is active: check before
// removing", and no command. The record is untouched. A member whose workspace is offline, that
// has none, or whose presence could not be read keeps the existing mark and command.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(resolve(fileURLToPath(new URL("..", import.meta.url))), "oats-package", "capabilities", "oats-aweb", "bin", "oats-aweb.mjs");
const TEAM = "default:example.test";
const COMMAND = "aw id team remove-member --namespace example.test --team default --cert-id cert-dev-1 --registry https://api.awid.ai --json";
const CONFLICT = "recorded as retired, but its workspace is active: check before removing";

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
/** A deployment whose record marks dev-1's certificate retired, and a fake aw whose
 *  `id team members` lists dev-1 and whose `workspace status` answers presence.json, or fails
 *  when there is none. */
function fixture(t) {
  const ws = mkdtempSync(join(tmpdir(), "oats-aweb-235-"));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const root = join(ws, "root"), home = join(ws, "agents", "dev", "instances", "reader");
  write(join(ws, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  write(join(root, ".aw", "identity.yaml"), "alias: root\n");
  mkdirSync(home, { recursive: true });
  const recordFile = join(ws, ".oats-aweb", "retired-certificates.json");
  write(recordFile, JSON.stringify({ version: 1, entries: [{ team: TEAM, certificateId: "cert-dev-1", registry: "https://api.awid.ai", alias: "dev-1", instance: "dev-1", retiredAt: "2026-11-04T10:00:00.000Z", command: COMMAND }] }));
  write(join(ws, "members.json"), JSON.stringify({ team_id: TEAM, members: [{ certificate_id: "cert-dev-1", team_id: TEAM, alias: "dev-1", identity_scope: "local" }] }));
  const bin = join(ws, "bin");
  write(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2), cmd = args.slice(0, 3).join(" ");
if (args[0] === "version") { console.log("aw 1.36.33 abcdef"); process.exit(0); }
if (cmd === "id team members") { process.stdout.write(fs.readFileSync(${JSON.stringify(join(ws, "members.json"))}, "utf8")); process.exit(0); }
if (args[0] === "workspace" && args[1] === "status") {
  let text; try { text = fs.readFileSync(${JSON.stringify(join(ws, "presence.json"))}, "utf8"); } catch { console.error("presence unavailable"); process.exit(1); }
  process.stdout.write(text); process.exit(0);
}
console.error("fake aw: unexpected " + args.join(" ")); process.exit(93);
`);
  chmodSync(join(bin, "aw"), 0o755);
  const env = { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, OATS_HOME: home, OATS_INSTANCE: "reader", OATS_WORKSPACE: ws,
    OATS_DEFAULT_TEAM: "personal", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "personal", team: TEAM, default: true, from: "local" }]), OATS_TEAMS_SOURCE: "live",
    OATS_SETTINGS: JSON.stringify({ roots: { [TEAM]: root } }) };
  const hook = (args) => {
    const r = spawnSync(process.execPath, [HOOK, "roster", ...args], { cwd: home, env: { ...env, OATS_EVENT: "roster" }, encoding: "utf8", timeout: 30000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return r.stdout;
  };
  const presence = (team) => writeFileSync(join(ws, "presence.json"), JSON.stringify({ selected_team: TEAM, team_has_more: false, team }));
  const roster = () => {
    const json = hook(["--json"]), text = hook([]);
    const doc = JSON.parse(json);
    return { doc, member: doc.members.find((m) => m.alias === "dev-1"), text, lines: text.split("\n"), json };
  };
  return { ws, presence, roster, recordFile };
}
const workspace = (fields) => ({ alias: "dev-1", hostname: "host-a", workspace_path: "/srv/agents/dev/instances/dev-1", ...fields });

// Pinned acceptance: marked + active → conflict text, no command, JSON as specified.
test("a member marked retired whose workspace is active shows the conflict and no command", (t) => {
  const fx = fixture(t);
  const before = readFileSync(fx.recordFile, "utf8");
  fx.presence([workspace({ status: "active", last_seen: new Date().toISOString() })]);
  const { doc, member, text, lines, json } = fx.roster();
  assert.deepEqual(member.retired, { at: "2026-11-04T10:00:00.000Z", instance: "dev-1", command: null, conflict: "workspace-active" });
  assert.deepEqual(doc.problems, [{ source: "retired-record", message: "the record entry for dev-1's certificate marks it retired, but its workspace is active: check before removing; no command to remove it is shown" }]);
  assert.ok(lines.includes(`  dev-1 — instance (from its workspace path), active, host-a [certificate, presence]; ${CONFLICT}`), text);
  assert.doesNotMatch(text, /retired by OATS on this host|remove-member/);
  assert.doesNotMatch(json, /remove-member/);
  assert.doesNotMatch(text, /certificates? belongs? to an? instances? OATS retired/, "a conflict is not counted as a leftover for the controller");
  assert.equal(readFileSync(fx.recordFile, "utf8"), before, "the record is untouched");
});

// Pinned acceptance: marked + `seen <when>` or no workspace → the existing mark and command unchanged.
test("a member marked retired whose workspace was last seen keeps the mark and the command", (t) => {
  const fx = fixture(t);
  fx.presence([workspace({ status: "offline", last_seen: new Date(Date.now() - 3 * 3600 * 1000).toISOString() })]);
  const { doc, member, text, lines } = fx.roster();
  assert.deepEqual(member.retired, { at: "2026-11-04T10:00:00.000Z", instance: "dev-1", command: COMMAND });
  assert.deepEqual(doc.problems, []);
  assert.ok(lines.includes(`  dev-1 — instance (from its workspace path), seen 3h ago, host-a [certificate, presence]; retired by OATS on this host 2026-11-04; the team controller removes it with: ${COMMAND}`), text);
  assert.ok(lines.includes("1 certificate belongs to an instance OATS retired on this host; only the team's controller can remove it."), text);
});

test("a member marked retired with no workspace record keeps the mark and the command", (t) => {
  const fx = fixture(t);
  fx.presence([]);
  const { doc, member, text, lines } = fx.roster();
  assert.deepEqual(member.retired, { at: "2026-11-04T10:00:00.000Z", instance: "dev-1", command: COMMAND });
  assert.deepEqual(doc.problems, []);
  assert.ok(lines.includes(`  dev-1 — unknown, certificate only: no workspace record [certificate]; retired by OATS on this host 2026-11-04; the team controller removes it with: ${COMMAND}`), text);
});

// Pinned acceptance: marked + presence unreadable (`Incomplete:`) → the existing mark, with no
// claim that it is inactive.
test("a member marked retired whose presence could not be read keeps the mark, claiming nothing about its workspace", (t) => {
  const fx = fixture(t);
  const { doc, member, text, lines } = fx.roster();
  assert.deepEqual(member.retired, { at: "2026-11-04T10:00:00.000Z", instance: "dev-1", command: COMMAND });
  assert.equal(member.status, "presence-unknown");
  assert.deepEqual(doc.problems.map((p) => p.source), ["presence"]);
  assert.ok(lines.some((l) => l.startsWith("Incomplete: presence: ")), text);
  assert.ok(lines.includes(`  dev-1 — unknown, certificate only: presence incomplete [certificate]; retired by OATS on this host 2026-11-04; the team controller removes it with: ${COMMAND}`), text);
  assert.doesNotMatch(text, /inactive|not active|offline|workspace is active/);
});
