// aweb-adbl: `oats aweb roster` lists the members this host's retires handed to their team's
// owner (<deployment>/.oats-aweb/owner-removals.json), with the owner's command rebuilt from
// the entry's validated team and alias. It keeps listing an entry until the roster's own
// reads prove the member gone; roster never writes the record.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(resolve(fileURLToPath(new URL("..", import.meta.url))), "oats-package", "capabilities", "oats-aweb", "bin", "oats-aweb.mjs");
const TEAM = "default:example.test";
const COMMAND = "aw team admin remove-agent example.test/dev-1 --team-id default:example.test";
const ENTRY = { team: TEAM, alias: "dev-1", certificateId: "cert-dev-1", instance: "dev-1", retiredAt: "2026-11-15T10:00:00.000Z" };

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
/** A deployment whose owner-removals record holds `entries`, and a fake aw whose
 *  `id team members` answers members.json and whose `workspace status` answers presence.json,
 *  or fails when there is none. */
function fixture(t, entries = [ENTRY]) {
  const ws = mkdtempSync(join(tmpdir(), "oats-aweb-owner-roster-"));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const root = join(ws, "root"), home = join(ws, "agents", "dev", "instances", "reader");
  write(join(ws, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  write(join(root, ".aw", "identity.yaml"), "alias: root\n");
  mkdirSync(home, { recursive: true });
  const recordFile = join(ws, ".oats-aweb", "owner-removals.json");
  write(recordFile, JSON.stringify({ version: 1, entries }));
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
  const members = (list) => writeFileSync(join(ws, "members.json"), JSON.stringify({ team_id: TEAM, members: list }));
  const presence = (team) => writeFileSync(join(ws, "presence.json"), JSON.stringify({ selected_team: TEAM, team_has_more: false, team }));
  const roster = () => {
    const json = hook(["--json"]), text = hook([]);
    const doc = JSON.parse(json);
    return { doc, member: doc.members.find((m) => m.alias === "dev-1"), text, lines: text.split("\n"), json };
  };
  members([]);
  return { ws, members, presence, roster, recordFile };
}
const certificate = (fields = {}) => ({ certificate_id: "cert-dev-1", team_id: TEAM, alias: "dev-1", identity_scope: "local", ...fields });
const workspace = (fields) => ({ alias: "dev-1", hostname: "host-a", workspace_path: "/srv/agents/dev/instances/dev-1", ...fields });
const HANDED = `; handed to the team owner by OATS on this host 2026-11-15 (its certificate was revoked); the team owner removes it with: ${COMMAND}`;

test("a member handed to the team owner shows the owner's command, rebuilt from the record's team and alias", (t) => {
  const fx = fixture(t);
  const before = readFileSync(fx.recordFile, "utf8");
  fx.members([certificate()]);
  fx.presence([workspace({ status: "offline", last_seen: "2026-11-15T09:00:00.000Z" })]);
  const { doc, member, text, lines } = fx.roster();
  assert.deepEqual(member.ownerRemoval, { at: "2026-11-15T10:00:00.000Z", instance: "dev-1", command: COMMAND });
  assert.equal(doc.ownerRemovalsUnseen, undefined);
  assert.ok(lines.some((l) => l.startsWith("  dev-1 — instance (from its workspace path), seen ") && l.endsWith(`, host-a [certificate, presence]${HANDED}`)), text);
  assert.ok(lines.includes("1 member was handed to the team owner by OATS on this host; only the team owner can remove it."), text);
  assert.equal(readFileSync(fx.recordFile, "utf8"), before, "roster never writes the record");
});

test("a member seen only in presence is matched by its alias", (t) => {
  const fx = fixture(t);
  fx.presence([workspace({ status: "offline", last_seen: "2026-11-15T09:00:00.000Z" })]);
  const { member } = fx.roster();
  assert.deepEqual(member.ownerRemoval, { at: "2026-11-15T10:00:00.000Z", instance: "dev-1", command: COMMAND });
});

test("a member handed to the owner whose workspace is active shows the conflict and no command", (t) => {
  const fx = fixture(t);
  fx.members([certificate()]);
  fx.presence([workspace({ status: "active", last_seen: new Date().toISOString() })]);
  const { doc, member, text, json } = fx.roster();
  assert.deepEqual(member.ownerRemoval, { at: "2026-11-15T10:00:00.000Z", instance: "dev-1", command: null, conflict: "workspace-active" });
  assert.deepEqual(doc.problems, [{ source: "owner-removals-record", message: "the record entry for dev-1 marks it handed to the team owner, but its workspace is active: check before removing; no command to remove it is shown" }]);
  assert.match(text, /dev-1 — .*; recorded as handed to the team owner, but its workspace is active: check before removing/);
  assert.doesNotMatch(json, /remove-agent/);
  assert.doesNotMatch(text, /remove-agent|members? (was|were) handed/);
});

test("an alias now held by another certificate is not the member the record names", (t) => {
  const fx = fixture(t);
  fx.members([certificate({ certificate_id: "cert-dev-1-successor" })]);
  fx.presence([workspace({ status: "offline", last_seen: "2026-11-15T12:00:00.000Z" })]);
  const { doc, member, text } = fx.roster();
  assert.equal(member.ownerRemoval, undefined);
  assert.equal(doc.ownerRemovalsUnseen, undefined, "the alias's new holder proves the recorded member gone");
  assert.doesNotMatch(text, /remove-agent/);
});

test("a recorded member that complete reads do not show is gone and is not listed", (t) => {
  const fx = fixture(t);
  const before = readFileSync(fx.recordFile, "utf8");
  fx.presence([]);
  const { doc, text } = fx.roster();
  assert.equal(doc.ownerRemovalsUnseen, undefined);
  assert.doesNotMatch(text, /remove-agent/);
  assert.equal(readFileSync(fx.recordFile, "utf8"), before, "roster never removes an entry");
});

test("a recorded member that incomplete reads do not show is still listed, with the owner's command", (t) => {
  const fx = fixture(t);
  // No presence.json: presence cannot be read.
  const { doc, lines, text } = fx.roster();
  assert.deepEqual(doc.ownerRemovalsUnseen, [{ alias: "dev-1", at: "2026-11-15T10:00:00.000Z", instance: "dev-1", command: COMMAND }]);
  assert.ok(lines.includes(`Not seen in this roster, which is incomplete: dev-1, handed to the team owner by OATS on this host 2026-11-15 (its certificate was revoked); if it is still a member, the team owner removes it with: ${COMMAND}`), text);
});

test("a record with a malformed entry is reported and nothing built from it is shown", (t) => {
  const fx = fixture(t, [ENTRY, { ...ENTRY, alias: "dev-2; aw id team remove-member --cert-id x" }]);
  fx.members([certificate()]);
  fx.presence([workspace({ status: "offline", last_seen: "2026-11-15T09:00:00.000Z" })]);
  const { doc, member, text, json } = fx.roster();
  assert.equal(member.ownerRemoval, undefined);
  assert.deepEqual(doc.problems, [{ source: "owner-removals-record", message: "the record of members OATS handed to their team's owner on this host is malformed; nothing from it is shown" }]);
  assert.doesNotMatch(json, /remove-agent/);
  assert.doesNotMatch(text, /remove-agent/);
});

test("an entry for another team is not this roster's", (t) => {
  const fx = fixture(t, [{ ...ENTRY, team: "other:example.test" }]);
  const { doc, json } = fx.roster();
  assert.equal(doc.ownerRemovalsUnseen, undefined);
  assert.doesNotMatch(json, /remove-agent/);
});
