// oats.aweb 1.20: connecting a deployment on another machine. `setup --invite-stdin`
// takes the invite token on stdin, `setup --install-aw` installs aw where it is
// missing or below the floor, `setup --check-only` answers the host's aw, default
// team and membership as one JSON document, and `connect <server-id>` drives those
// through the kernel's capability route (`oats aweb … --server <id>`) to give the
// host's deployment membership in its default team. The invite token lives only in
// memory and on the routed command's stdin.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fakeAwSetupPath } from "./helpers/fake-aw-setup.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CAPABILITY = join(REPO, "oats-package", "capabilities", "oats-aweb");
const HOOK = join(CAPABILITY, "bin", "oats-aweb.mjs");
const AW_MIN = "1.36.13";
const TEAM = "joined:example.invalid";

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-120-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(args = [], env = {}, cwd = REPO, input) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [HOOK, ...args], { cwd, env: { ...process.env, ...env }, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => done({ code, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
  });
}

/** Every regular file under `dir`, with its contents. */
function filesUnder(dir) {
  const found = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) found.push({ path: p, text: readFileSync(p, "utf8") });
    }
  };
  walk(dir);
  return found;
}

const deploymentEnv = (root, extra = {}) => ({
  AWEB_API_KEY: "",
  AW_FAKE_TEAM: TEAM,
  OATS_EVENT: "setup",
  OATS_WORKSPACE: root,
  OATS_DEFAULT_TEAM: "joined",
  OATS_DEFAULT_TEAM_ID: TEAM,
  OATS_DEFAULT_TEAM_FROM: "deployment",
  OATS_TEAMS: JSON.stringify([{ label: "joined", team: TEAM, default: true, from: "shared" }]),
  OATS_SETTINGS: JSON.stringify({ root }),
  ...extra,
});

// ---------------------------------------------------------------------------
// setup --invite-stdin

test("setup --invite-stdin behaves exactly as --invite, with the token on no argv, output or file", async (t) => {
  const TOKEN = "SECRET-STDIN-TOKEN-7f3a";
  const viaArgv = tempDir(t), viaStdin = tempDir(t);
  for (const root of [viaArgv, viaStdin]) writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const argvFake = fakeAwSetupPath(t, { activeTeam: TEAM });
  const stdinFake = fakeAwSetupPath(t, { activeTeam: TEAM });
  const common = ["--service", "https://owner.example/api", "--name", "host-alias"];
  const a = await run(["setup", "--join", "joined", "--invite", TOKEN, ...common], deploymentEnv(viaArgv, { PATH: argvFake.path }), viaArgv);
  const s = await run(["setup", "--join", "joined", "--invite-stdin", ...common], deploymentEnv(viaStdin, { PATH: stdinFake.path }), viaStdin, `  ${TOKEN}  \nignored second line\n`);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(s.code, 0, s.stderr);
  const normalize = (text, root) => text.split(root).join("<root>");
  assert.equal(normalize(s.stdout, viaStdin), normalize(a.stdout, viaArgv));
  const callsOf = (fake, root) => fake.readCalls().map((c) => ({ args: c.args, cwd: normalize(c.cwd, root), identityHome: c.identityHome && normalize(c.identityHome, root) }));
  assert.deepEqual(callsOf(stdinFake, viaStdin), callsOf(argvFake, viaArgv));
  const stdinCalls = stdinFake.readCalls();
  const accept = stdinCalls.find((c) => c.args.slice(0, 3).join(" ") === "id team accept-invite");
  assert.equal(accept.args[3], TOKEN, "the trimmed first stdin line is the token aw accepts");
  for (const c of stdinCalls) if (c !== accept) assert.ok(!c.args.join(" ").includes(TOKEN), `token on aw argv: ${c.args.join(" ")}`);
  assert.doesNotMatch(s.stdout + s.stderr, /SECRET-STDIN-TOKEN/);
  for (const f of filesUnder(viaStdin)) assert.ok(!f.text.includes(TOKEN), `token written to ${f.path}`);
  assert.match(readFileSync(join(viaStdin, "oats-local.yaml"), "utf8"), /"joined:example\.invalid": ".*\.aweb-roots\/joined"/);
});

test("setup --invite with --invite-stdin is a usage error, and --invite-stdin needs --join", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t, { activeTeam: TEAM });
  const both = await run(["setup", "--join", "joined", "--invite", "SECRET-X", "--invite-stdin"], deploymentEnv(root, { PATH: fake.path }), root, "SECRET-Y\n");
  assert.equal(both.code, 2);
  assert.match(both.stderr, /--invite and --invite-stdin cannot be combined/);
  assert.doesNotMatch(both.stdout + both.stderr, /SECRET-[XY]/);
  const noJoin = await run(["setup", "--invite-stdin"], deploymentEnv(root, { PATH: fake.path }), root, "SECRET-Y\n");
  assert.equal(noJoin.code, 2);
  assert.match(noJoin.stderr, /--invite-stdin requires --join <label>/);
  assert.equal(fake.readCalls().some((c) => c.args.slice(0, 3).join(" ") === "id team accept-invite"), false);
});

test("setup --invite-stdin with nothing on stdin refuses before accepting", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t, { activeTeam: TEAM });
  const result = await run(["setup", "--join", "joined", "--invite-stdin", "--name", "host-alias"], deploymentEnv(root, { PATH: fake.path }), root, "\n");
  assert.equal(result.code, 1);
  assert.match(result.stderr, /--invite-stdin read no invite token from stdin/);
  assert.equal(fake.readCalls().some((c) => c.args.slice(0, 3).join(" ") === "id team accept-invite"), false);
});

// ---------------------------------------------------------------------------
// setup --install-aw and setup --check-only

/** A bin directory holding a fake `npm` and, unless `aw` is false, a fake `aw` reporting
 *  `version`. A successful `npm install -g @awebai/aw@…` (re)writes the fake aw at 1.36.23. */
function fakeNpmPath(t, { aw = undefined } = {}) {
  const dir = tempDir(t);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "npm-calls.jsonl");
  const versionFile = join(dir, "aw-version");
  const awScript = `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "version") { console.log("aw " + fs.readFileSync(${JSON.stringify(versionFile)}, "utf8").trim()); process.exit(0); }
if (args[0] === "team" && args[1] === "list") { console.log(JSON.stringify({ memberships: [] })); process.exit(0); }
console.error("unexpected fake aw " + args.join(" ")); process.exit(93);
`;
  if (aw) { writeFileSync(versionFile, aw); writeFileSync(join(bin, "aw"), awScript, { mode: 0o755 }); }
  writeFileSync(join(bin, "npm"), `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.NPM_FAIL) { console.error("npm ERR! 404 Not Found - GET https://registry.npmjs.org/@awebai%2faw"); process.exit(3); }
if (!process.env.NPM_INSTALLS_OLD) fs.writeFileSync(${JSON.stringify(versionFile)}, "1.36.23\\n");
else fs.writeFileSync(${JSON.stringify(versionFile)}, "1.30.0\\n");
fs.writeFileSync(${JSON.stringify(join(bin, "aw"))}, ${JSON.stringify(awScript)}, { mode: 0o755 });
console.log("added 1 package");
`, { mode: 0o755 });
  chmodSync(join(bin, "npm"), 0o755);
  return { path: bin, readCalls: () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [] };
}

const checkOnly = (stdout) => JSON.parse(stdout.trim().split("\n").pop());

test("setup --install-aw with aw missing installs aw at AW_MIN's release line, re-checks the floor and continues", async (t) => {
  const root = tempDir(t);
  const npm = fakeNpmPath(t);
  const result = await run(["setup", "--check-only", "--install-aw", "--json"], deploymentEnv(root, { PATH: npm.path }), root);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(npm.readCalls(), [["install", "-g", `@awebai/aw@^${AW_MIN}`]]);
  const doc = checkOnly(result.stdout);
  assert.equal(doc.aw.status, "done");
  assert.equal(doc.aw.version, "1.36.23");
  assert.match(doc.aw.detail, /installed aw 1\.36\.23 \(was missing\)/);
  assert.deepEqual(doc.defaultTeam, { label: "joined", team: TEAM });
  assert.equal(doc.member, false);
});

test("setup --install-aw below the floor installs, and --aw-version picks the version", async (t) => {
  const root = tempDir(t);
  const npm = fakeNpmPath(t, { aw: "1.30.0" });
  const result = await run(["setup", "--check-only", "--install-aw", "--aw-version", "1.36.23", "--json"], deploymentEnv(root, { PATH: npm.path }), root);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(npm.readCalls(), [["install", "-g", "@awebai/aw@1.36.23"]]);
  const doc = checkOnly(result.stdout);
  assert.equal(doc.aw.status, "done");
  assert.match(doc.aw.detail, /installed aw 1\.36\.23 \(was 1\.30\.0\)/);
});

test("setup --install-aw at or above the floor does not run npm", async (t) => {
  const root = tempDir(t);
  const npm = fakeNpmPath(t, { aw: "1.36.20" });
  const result = await run(["setup", "--check-only", "--install-aw", "--json"], deploymentEnv(root, { PATH: npm.path }), root);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(npm.readCalls(), []);
  assert.deepEqual(checkOnly(result.stdout).aw, { status: "ok", version: "1.36.20" });
});

test("setup --install-aw relays npm's failure with its exit status", async (t) => {
  const root = tempDir(t);
  const npm = fakeNpmPath(t);
  const checked = await run(["setup", "--check-only", "--install-aw", "--json"], deploymentEnv(root, { PATH: npm.path, NPM_FAIL: "1" }), root);
  assert.equal(checked.code, 1);
  const doc = checkOnly(checked.stdout);
  assert.equal(doc.aw.status, "failed");
  assert.equal(doc.aw.code, "E_AW_INSTALL");
  assert.match(doc.aw.detail, /npm install -g @awebai\/aw@\^1\.36\.13 failed \(exit 3\): npm ERR! 404 Not Found/);
  const plain = await run(["setup", "--install-aw"], deploymentEnv(root, { PATH: npm.path, NPM_FAIL: "1" }), root);
  assert.equal(plain.code, 1);
  assert.match(plain.stderr, /oats aweb setup: npm install -g @awebai\/aw@\^1\.36\.13 failed \(exit 3\): npm ERR! 404 Not Found/);
});

test("setup --install-aw whose install still leaves aw below the floor fails", async (t) => {
  const root = tempDir(t);
  const npm = fakeNpmPath(t);
  const result = await run(["setup", "--check-only", "--install-aw", "--json"], deploymentEnv(root, { PATH: npm.path, NPM_INSTALLS_OLD: "1" }), root);
  assert.equal(result.code, 1);
  const doc = checkOnly(result.stdout);
  assert.equal(doc.aw.status, "failed");
  assert.equal(doc.aw.code, "E_AW_FLOOR");
  assert.match(doc.aw.detail, /aw 1\.30\.0 is older than required 1\.36\.13/);
});

test("setup --install-aw without --check-only continues into the ordinary setup", async (t) => {
  const root = tempDir(t);
  const npm = fakeNpmPath(t);
  const localTeam = JSON.stringify([{ label: "joined", team: TEAM, default: true, from: "local" }]);
  const result = await run(["setup", "--install-aw"], deploymentEnv(root, { PATH: npm.path, OATS_TEAMS: localTeam }), root);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /installed aw 1\.36\.23 \(was missing\)/);
  assert.match(result.stdout, /aweb onboarding — messaging root/);
  assert.match(result.stdout, /No aweb workspace at the messaging root yet/);
});

test("setup without --install-aw keeps today's message when aw is missing; --check-only reports it", async (t) => {
  const root = tempDir(t);
  const npm = fakeNpmPath(t);
  const plain = await run(["setup"], deploymentEnv(root, { PATH: npm.path }), root);
  assert.equal(plain.code, 1);
  assert.match(plain.stderr, /oats aweb setup: aw CLI not on PATH — install the aw CLI first/);
  const checked = await run(["setup", "--check-only", "--json"], deploymentEnv(root, { PATH: npm.path }), root);
  assert.equal(checked.code, 0, checked.stderr);
  const doc = checkOnly(checked.stdout);
  assert.equal(doc.aw.status, "needs-human");
  assert.match(doc.aw.detail, /aw CLI not on PATH; install aw >= 1\.36\.13/);
  assert.match(doc.aw.remedy, /oats aweb setup --install-aw/);
  assert.equal(doc.member, null);
  assert.deepEqual(npm.readCalls(), []);
});

test("setup --check-only reports membership of the default team from its root", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t, { activeTeam: TEAM });
  const before = await run(["setup", "--check-only", "--json"], deploymentEnv(root, { PATH: fake.path }), root);
  assert.equal(before.code, 0, before.stderr);
  assert.deepEqual(checkOnly(before.stdout), { aw: { status: "ok", version: "1.36.13" }, defaultTeam: { label: "joined", team: TEAM }, member: false, root: null });
  const teamRoot = join(root, ".aweb-roots", "joined");
  mkdirSync(join(teamRoot, ".aw"), { recursive: true });
  writeFileSync(join(teamRoot, ".aw", "teams.json"), JSON.stringify({ active_team: TEAM, memberships: [{ team_id: TEAM }] }));
  const after = await run(["setup", "--check-only", "--json"], deploymentEnv(root, { PATH: fake.path, OATS_SETTINGS: JSON.stringify({ root, roots: { [TEAM]: teamRoot } }) }), root);
  assert.equal(after.code, 0, after.stderr);
  assert.deepEqual(checkOnly(after.stdout), { aw: { status: "ok", version: "1.36.13" }, defaultTeam: { label: "joined", team: TEAM }, member: true, root: teamRoot });
});

test("setup --check-only cannot be combined with an onboarding action", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t, { activeTeam: TEAM });
  const result = await run(["setup", "--check-only", "--join", "joined"], deploymentEnv(root, { PATH: fake.path }), root);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--check-only cannot be combined with --username, --create, --join or --invite/);
});
