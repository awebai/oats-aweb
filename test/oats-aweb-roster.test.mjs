// oats.aweb 1.20.0: `oats aweb roster` is the union of the team's certificate members
// (`aw id team members`) and its workspace presence (`aw workspace status`), one row per
// alias with a kind and a status (awebai/oats-aweb#46). The fixtures are shaped like the real
// aw 1.36.23 answers for aweb:example.aweb.ai: the coordinator is a global identity with a
// workspace and no listed certificate, deployment roots hold certificates like agents, and
// retired instances keep certificates with no workspace.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HOOK = join(REPO, "oats-package", "capabilities", "oats-aweb", "bin", "oats-aweb.mjs");
const TEAM = "aweb:example.aweb.ai";

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-roster-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const cert = (alias, scope = "local", address) => ({ certificate_id: `c-${alias}`, team_id: TEAM, alias, name: alias, member_did_key: `did:key:z${alias}`, identity_scope: scope, issued_at: "2026-09-01T00:00:00Z", ...(address ? { member_address: address, member_did_aw: `did:aw:${alias}` } : {}) });
const workspace = (alias, { scope = "local", ctx = "manual", path, status = "active", host = "harbor", role = "", seen = hoursAgo(0.1) } = {}) => ({ agent_id: `a-${alias}`, alias, name: alias, agent_identity_scope: scope, context_kind: ctx, workspace_path: path, hostname: host, status, human_name: "pat", program: "", role, model: "", last_seen: seen, workspace_id: `w-${alias}` });

/** The real shape: the root acting as the coordinator `aweb` (self, not in `team`), two
 *  deployment roots, an OATS instance, a dashboard human, a hosted global agent, a global
 *  identity with a certificate, and a retired reviewer holding only a certificate. */
function realShape(root) {
  return {
    certificates: { team_id: TEAM, members: [
      cert("builder-aweb"), cert("harbor-aweb"), cert("oats-expert-pat"), cert("idle-reviewer"),
      cert("atlas", "global", "aweb.ai/atlas"),
    ] },
    presence: {
      selected_team: TEAM, team_has_more: false, team_limit: 200,
      workspace: workspace("aweb", { scope: "global", path: "/Users/pat/Agents/aweb/agents/coordinator/instances/aweb" }),
      team: [
        workspace("builder-aweb", { path: "/Users/pat/Agents/aweb/.aweb-roots/aweb/.aw", status: "offline", host: "builder", seen: hoursAgo(3) }),
        workspace("harbor-aweb", { path: "/Users/pat/Agents/aweb/.aweb-roots/aweb/.aw" }),
        workspace("oats-expert-pat", { path: "/Users/pat/Agents/oats/agents/oats-expert/instances/oats-expert-pat" }),
        workspace("atlas", { scope: "global", path: "/home/pat/prj/example/agents/instances/atlas", host: "cloud-small", role: "coordinator" }),
        workspace("pat-operator", { ctx: "dashboard_browser", path: null, status: "offline", host: null, seen: hoursAgo(50) }),
        workspace("support", { scope: "global", ctx: "hosted_mcp", path: "", status: "offline", host: "", seen: hoursAgo(30) }),
        workspace("local-root", { path: root }),
      ],
    },
  };
}

/** A fake aw: `id team members` and `workspace status` answer the given documents (status
 *  followed by aw's "Gone workspace checks" text, as the real command prints it), or fail. */
function fakeAw(t, { certificates, presence, presenceFails = false, certificatesFail = false }) {
  const dir = tempDir(t);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(dir, "certs.json"), JSON.stringify(certificates));
  writeFileSync(join(dir, "presence.json"), JSON.stringify(presence, null, 2) + "\nGone workspace checks:\n  old-one (~/x) — gone_local_path_only, left workspace record intact\n");
  writeFileSync(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(dir, "calls.jsonl"))}, JSON.stringify({ args, cwd: process.cwd(), identityHome: process.env.AWEB_IDENTITY_HOME || null }) + "\\n");
if (args[0] === "version") { console.log("aw 1.36.33"); process.exit(0); }
if (args.slice(0, 3).join(" ") === "id team members") {
  if (${JSON.stringify(certificatesFail)}) { console.error("list team members for aweb:example.aweb.ai: registry unavailable"); process.exit(1); }
  fs.writeSync(1, fs.readFileSync(${JSON.stringify(join(dir, "certs.json"))}, "utf8")); process.exit(0); }
if (args.slice(0, 2).join(" ") === "workspace status") {
  if (${JSON.stringify(presenceFails)}) { console.error("aweb: http 503"); process.exit(1); }
  fs.writeSync(1, fs.readFileSync(${JSON.stringify(join(dir, "presence.json"))}, "utf8")); process.exit(0);
}
console.error("fake aw: unexpected " + args.join(" ")); process.exit(93);
`, { mode: 0o755 });
  const calls = join(dir, "calls.jsonl");
  return { path: bin, calls: () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [] };
}

function fixture(t, shape) {
  const ws = tempDir(t);
  const root = join(ws, "root");
  mkdirSync(join(root, ".aw"), { recursive: true });
  writeFileSync(join(root, ".aw", "identity.yaml"), "stable_id: did:aw:2q1v\naddress: example.aweb.ai/aweb\nidentity_scope: global\n");
  const home = join(ws, "agents", "dev", "instances", "dev-1");
  mkdirSync(home, { recursive: true });
  const fake = fakeAw(t, typeof shape === "function" ? shape(root) : shape);
  const env = { ...process.env, PATH: fake.path, OATS_EVENT: "roster", OATS_HOME: home, OATS_DEFAULT_TEAM: "example", OATS_DEFAULT_TEAM_ID: TEAM, OATS_SETTINGS: JSON.stringify({ roots: { [TEAM]: root } }), AWEB_IDENTITY_HOME: join(home, ".aw") };
  const roster = (args = []) => spawnSync(process.execPath, [HOOK, "roster", ...args], { cwd: home, env, encoding: "utf8", timeout: 20000 });
  return { root, home, fake, roster };
}
const doc = (r) => { assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout); };
const byAlias = (d) => Object.fromEntries(d.members.map((m) => [m.alias, m]));

test("roster --json is the union of certificates and presence, every alias labelled with its sources", (t) => {
  const fx = fixture(t, realShape);
  const d = doc(fx.roster(["--json"]));
  assert.equal(d.team, TEAM);
  assert.equal(d.certificatesComplete, true);
  assert.equal(d.presenceComplete, true);
  assert.deepEqual(d.problems, []);
  const m = byAlias(d);
  assert.deepEqual(Object.keys(m).sort(), ["atlas", "aweb", "builder-aweb", "harbor-aweb", "idle-reviewer", "local-root", "oats-expert-pat", "pat-operator", "support"]);
  assert.deepEqual(m.aweb, { alias: "aweb", kind: "global identity", kindFrom: "identity scope", identityScope: "global", address: "example.aweb.ai/aweb", role: null, status: "active", sources: ["presence"], presence: { status: "active", hostname: "harbor", lastSeen: m.aweb.presence.lastSeen } });
  assert.equal(m.atlas.kind, "global identity");
  assert.equal(m.atlas.address, "aweb.ai/atlas");
  assert.equal(m.atlas.role, "coordinator");
  assert.deepEqual(m.atlas.sources, ["certificate", "presence"]);
  assert.equal(m.support.kind, "global identity", "a hosted global identity is a global identity");
  assert.deepEqual([m["builder-aweb"].kind, m["builder-aweb"].kindFrom, m["builder-aweb"].status], ["deployment root", "workspace path", "offline"]);
  assert.equal(m["harbor-aweb"].kind, "deployment root");
  assert.equal(m["local-root"].kind, "deployment root", "a configured root of this deployment");
  assert.deepEqual([m["oats-expert-pat"].kind, m["oats-expert-pat"].kindFrom], ["instance", "workspace path"]);
  assert.deepEqual([m["pat-operator"].kind, m["pat-operator"].kindFrom], ["human", "session context"]);
  assert.deepEqual(m["idle-reviewer"], { alias: "idle-reviewer", kind: "unknown", kindFrom: null, identityScope: "local", address: null, role: null, status: "no-workspace-record", sources: ["certificate"], presence: null });
  assert.doesNotMatch(JSON.stringify(d), /historical|retired/);
  // Global identities first, then by kind, then alias.
  assert.deepEqual(d.members.slice(0, 3).map((x) => x.alias), ["atlas", "aweb", "support"]);
});

test("roster prints each alias with its kind and status, global identities first", (t) => {
  const fx = fixture(t, realShape);
  const r = fx.roster();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lines = r.stdout.split("\n");
  assert.match(lines[0], /^aweb team aweb:example\.aweb\.ai — 9 entries \(membership certificates and workspaces\):$/);
  assert.match(r.stdout, /^ {2}aweb — global identity, active, harbor, example\.aweb\.ai\/aweb \[presence\]$/m);
  assert.match(r.stdout, /^ {2}atlas — global identity, active, cloud-small, aweb\.ai\/atlas, role coordinator \[certificate, presence\]$/m);
  assert.match(r.stdout, /^ {2}builder-aweb — deployment root \(from its workspace path\), seen 3h ago, builder \[certificate, presence\]$/m);
  assert.match(r.stdout, /^ {2}pat-operator — human \(from its session context\), seen 2d ago \[presence\]$/m);
  assert.match(r.stdout, /^ {2}oats-expert-pat — instance \(from its workspace path\), active, harbor \[certificate, presence\]$/m);
  assert.match(r.stdout, /^ {2}idle-reviewer — unknown, certificate only: no workspace record \[certificate\]$/m);
  assert.doesNotMatch(r.stdout, /historical|retired/);
  assert.ok(lines.findIndex((l) => l.startsWith("  aweb ")) < lines.findIndex((l) => l.startsWith("  oats-expert-pat ")), "global identities come first");
  assert.match(r.stdout, /aw does not mark the team's coordinator \(a workspace's role is its own setting\): look among the global identities and ask your expert or coordinator which one coordinates/);
  assert.match(r.stdout, /`aw workspace status` is the presence view/);
});

test("roster reads both views from the root, never as the caller's identity", (t) => {
  const fx = fixture(t, realShape);
  doc(fx.roster(["--json"]));
  const calls = fx.fake.calls().filter((c) => c.args[0] !== "version");
  assert.deepEqual(calls.map((c) => c.args), [["id", "team", "members", `--team-id=${TEAM}`, "--json"], ["workspace", "status", "--limit=200", "--json"]]);
  for (const c of calls) { assert.equal(c.cwd, fx.root); assert.equal(c.identityHome, null); }
});

test("roster at the presence cap says presence is incomplete and claims no missing workspace", (t) => {
  const fx = fixture(t, (root) => { const s = realShape(root); s.presence.team_has_more = true; return s; });
  const d = doc(fx.roster(["--json"]));
  assert.equal(d.presenceComplete, false);
  assert.deepEqual(d.problems, [{ source: "presence", message: "aw workspace status reports more than 200 workspaces; only the first 200 were read" }]);
  assert.equal(byAlias(d)["idle-reviewer"].status, "presence-unknown");
  const text = fx.roster();
  assert.match(text.stdout, /^Incomplete: presence: aw workspace status reports more than 200 workspaces; only the first 200 were read\.$/m);
  assert.match(text.stdout, /^ {2}idle-reviewer — unknown, certificate only: presence incomplete \[certificate\]$/m);
});

test("roster with exactly 200 presence rows treats presence as possibly capped", (t) => {
  const fx = fixture(t, (root) => { const s = realShape(root); while (s.presence.team.length < 200) s.presence.team.push(workspace(`w-${s.presence.team.length}`, { path: `/x/agents/s/instances/w-${s.presence.team.length}` })); return s; });
  const d = doc(fx.roster(["--json"]));
  assert.equal(d.presenceComplete, false);
  assert.equal(d.problems[0].source, "presence");
});

test("roster without presence still lists the certificates and says presence is missing", (t) => {
  const fx = fixture(t, (root) => ({ ...realShape(root), presenceFails: true }));
  const d = doc(fx.roster(["--json"]));
  assert.equal(d.certificatesComplete, true);
  assert.equal(d.presenceComplete, false);
  assert.equal(d.problems.length, 1);
  assert.equal(d.problems[0].source, "presence");
  assert.match(d.problems[0].message, /aw workspace status failed \(exit 1\): aweb: http 503/);
  assert.deepEqual(d.members.map((m) => m.alias).sort(), ["atlas", "builder-aweb", "harbor-aweb", "idle-reviewer", "oats-expert-pat"]);
  assert.equal(byAlias(d)["oats-expert-pat"].kind, "unknown");
  assert.equal(byAlias(d)["oats-expert-pat"].status, "presence-unknown");
  assert.equal(byAlias(d).atlas.kind, "global identity");
  const text = fx.roster();
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^Incomplete: presence: aw workspace status failed/m);
});

test("roster without certificates still lists presence and says certificates are missing", (t) => {
  const fx = fixture(t, (root) => ({ ...realShape(root), certificatesFail: true }));
  const d = doc(fx.roster(["--json"]));
  assert.equal(d.certificatesComplete, false);
  assert.equal(d.presenceComplete, true);
  assert.equal(d.problems[0].source, "certificates");
  assert.match(d.problems[0].message, /aw id team members failed \(exit 1\): list team members for aweb:example\.aweb\.ai: registry unavailable/);
  assert.ok(byAlias(d).aweb, "presence entries are listed");
  assert.equal(byAlias(d)["idle-reviewer"], undefined);
  const text = fx.roster();
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^Incomplete: certificates: aw id team members failed/m);
});

test("roster refuses an indented object inside cut-off output as aw's answer", (t) => {
  const fx = fixture(t, (root) => realShape(root));
  writeFileSync(join(fx.fake.path, "..", "presence.json"), JSON.stringify(realShape(fx.root).presence, null, 2).slice(0, 2000));
  const d = doc(fx.roster(["--json"]));
  assert.equal(d.presenceComplete, false);
  assert.equal(d.problems[0].source, "presence");
  assert.match(d.problems[0].message, /aw workspace status returned no JSON result/);
});

test("1.20.0 documents the roster: CHANGELOG, README, skill and inject", () => {
  const changelog = readFileSync(join(REPO, "CHANGELOG.md"), "utf8");
  assert.match(changelog, /\n## 1\.20\.0\n/);
  const entry = changelog.slice(changelog.indexOf("## 1.20.0"), changelog.indexOf("## 1.19.0"));
  const readme = readFileSync(join(REPO, "README.md"), "utf8");
  const skill = readFileSync(join(REPO, "oats-package", "capabilities", "oats-aweb", "skills", "oats-aweb", "SKILL.md"), "utf8");
  for (const [name, text] of [["CHANGELOG 1.20.0", entry], ["README", readme], ["skill", skill]]) {
    for (const needle of ["aw workspace status", "global identit", "Incomplete:", "coordinator"]) assert.ok(text.includes(needle), `${name} lacks ${needle}`);
  }
  assert.match(entry, /--json/);
  assert.doesNotMatch(skill, /their alias is on the roster|will not resolve/);
  const inject = readFileSync(join(REPO, "oats-package", "capabilities", "oats-aweb", "injects", "aweb.md"), "utf8");
  assert.doesNotMatch(inject, /who you can reach/);
});
