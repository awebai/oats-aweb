import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ROOT = join(REPO, "oats-package");
const CAPABILITY = join(ROOT, "capabilities", "oats-aweb");
const HOOK = join(CAPABILITY, "bin", "oats-aweb.mjs");
const BINDING = join(CAPABILITY, "bin", "oats-aweb-binding.mjs");

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "oats-aweb-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakePath(t, body = "exit 97") {
  const bin = join(tempDir(t), "bin");
  mkdirSync(bin);
  const aw = join(bin, "aw");
  writeFileSync(aw, `#!/bin/sh\n${body}\n`);
  chmodSync(aw, 0o755);
  return bin;
}

function fakeAwSetupPath(t, { activeTeam = "active:example.invalid" } = {}) {
  const dir = tempDir(t);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const calls = join(dir, "calls.jsonl");
  const aw = join(bin, "aw");
  writeFileSync(aw, `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const calls = ${JSON.stringify(calls)};
const args = process.argv.slice(2);
fs.appendFileSync(calls, JSON.stringify({ args, cwd: process.cwd(), hasApiKey: !!process.env.AWEB_API_KEY }) + "\\n");
const awDir = path.join(process.cwd(), ".aw");
const teamsFile = path.join(awDir, "teams.json");
const writeTeams = (team) => { fs.mkdirSync(awDir, { recursive: true }); fs.writeFileSync(path.join(awDir, "identity.yaml"), "did: did:key:zFixture\\n"); fs.writeFileSync(teamsFile, JSON.stringify({ active_team: team, memberships: [{ team_id: team }] })); };
if (args[0] === "team" && args[1] === "list" && args.includes("--json")) {
  if (fs.existsSync(teamsFile)) console.log(fs.readFileSync(teamsFile, "utf8"));
  else console.log(JSON.stringify({ memberships: [] }));
} else if (args[0] === "init") {
  if (args.includes("--do-not-touch-agents-md") && fs.existsSync(path.join(awDir, "identity.yaml"))) { console.log("initialized"); process.exit(0); }
  if (fs.existsSync(path.join(awDir, "identity.yaml"))) { console.error("already holds a bound identity"); process.exit(7); }
  const i = args.indexOf("--username");
  writeTeams(i >= 0 ? "default:" + args[i + 1] + ".aweb.ai" : (process.env.AW_FAKE_TEAM || ${JSON.stringify(activeTeam)}));
  console.log("initialized");
} else if (args[0] === "team" && args[1] === "join") {
  if (fs.existsSync(path.join(awDir, "identity.yaml"))) { console.error("already holds a bound identity"); process.exit(7); }
  writeTeams(process.env.AW_FAKE_TEAM || ${JSON.stringify(activeTeam)});
  console.log(JSON.stringify({ team_id: process.env.AW_FAKE_TEAM || ${JSON.stringify(activeTeam)} }));
} else if (args[0] === "team" && args[1] === "invite") {
  console.log(JSON.stringify({ token: "INVITE-TOKEN" }));
} else if (args[0] === "whoami") {
  console.log(JSON.stringify({ alias: "fixture", did: "did:key:zFixture" }));
} else if (args[0] === "workspace" && args[1] === "status") {
  console.log(JSON.stringify({ selected_team: ${JSON.stringify(activeTeam)}, workspace: { alias: "fixture", workspace_path: process.cwd() } }));
} else if (args[0] === "wake") {
  console.log("ok");
} else {
  console.error("unexpected fake aw " + args.join(" "));
  process.exit(93);
}
`, { mode: 0o755 });
  return { path: bin, calls, readCalls: () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [] };
}

function run(args = [], env = {}, cwd = ROOT) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [HOOK, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

test("manifest resolves the three vendored Agent Skills by expected names", () => {
  const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));
  const expected = ["aweb-messaging", "aweb-team-membership", "aweb-identity"];
  assert.deepEqual(manifest.skills, expected.map((name) => `skills/${name}`));
  for (const name of expected) {
    const skill = readFileSync(join(CAPABILITY, "skills", name, "SKILL.md"), "utf8");
    assert.match(skill, new RegExp(`^---\\nname: ${name}\\n`));
    assert.match(skill, /description:/);
  }
});

test("manifest declares the aligned requirements and a required spawn hook", () => {
  const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));
  // Host CLI requirement plus the two runtime-scoped channel requirements —
  // pi (npm) and Claude (marketplace plugin) — never installed at spawn.
  const aw = manifest.requires.find((r) => r.command === "aw");
  assert.ok(aw, "the aw host CLI stays a consented requirement");
  const pi = manifest.requires.find((r) => r.runtime === "pi");
  assert.equal(pi?.package, "npm:@awebai/pi");
  const claude = manifest.requires.find((r) => r.runtime === "claude");
  assert.equal(claude?.package, "aweb-channel@awebai-marketplace");
  assert.equal(claude?.marketplace, "awebai/claude-plugins");
  // Only the spawn hook is required (messaging is the whole point); retire is a
  // plain string. The schema forbids `required` on retire.
  assert.equal(manifest.hooks.spawn.required, true);
  assert.equal(typeof manifest.hooks.retire, "string");
});

test("package has no npm runtime dependency closure", () => {
  const foundLocks = [];
  const foundModules = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.name === "package-lock.json") foundLocks.push(path);
      if (entry.name === "node_modules") foundModules.push(path);
      if (entry.isDirectory()) walk(path);
      if (entry.name === "package.json") {
        const pkg = JSON.parse(readFileSync(path, "utf8"));
        for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
          assert.equal(pkg[field], undefined, `${path} contains ${field}`);
        }
      }
    }
  };
  walk(ROOT);
  assert.deepEqual(foundLocks, []);
  assert.deepEqual(foundModules, []);
});

test("vendored skills carry exact upstream provenance and MIT license", () => {
  const vendored = readFileSync(join(CAPABILITY, "skills", "VENDORED.md"), "utf8");
  const license = readFileSync(join(CAPABILITY, "skills", "LICENSE"), "utf8");
  const sync = readFileSync(join(REPO, "scripts", "sync-vendored-skills.mjs"), "utf8");
  for (const value of ["pi-v0.2.3", "812bdeb1be8ed99dbd339a910a153e7b802501d4", "https://github.com/awebai/aweb.git"]) {
    assert.ok(vendored.includes(value));
    assert.ok(sync.includes(value));
  }
  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2025 Juan Reyero/);
});

test("capability guidance names only real first-level aw verbs", (t) => {
  const files = [
    join(CAPABILITY, "bin", "oats-aweb.mjs"),
    join(CAPABILITY, "injects", "aweb.md"),
    join(REPO, "README.md"),
  ];
  const verbs = new Set();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /aw team create\b/, `${file} must not recommend the nonexistent aw team create command`);
    for (const match of text.matchAll(/\["aw",\s*"([a-z][a-z0-9-]*)"/g)) verbs.add(match[1]);
    for (const match of text.matchAll(/`aw\s+([a-z][a-z0-9-]*)\b/g)) verbs.add(match[1]);
  }
  assert.ok(verbs.size > 0, "the test must enumerate printed/run aw verbs");
  const found = spawnSync("aw", ["--help"], { encoding: "utf8" });
  if (found.error?.code === "ENOENT") {
    t.skip(`aw CLI not on PATH; skipped verb help validation for: ${[...verbs].sort().join(", ")}`);
    return;
  }
  assert.equal(found.status, 0, found.stderr || found.stdout);
  const version = spawnSync("aw", ["version"], { encoding: "utf8" });
  const parsed = /aw\s+v?(\d+)\.(\d+)\.(\d+)/.exec(version.stdout + version.stderr);
  const atLeast = (floor) => {
    if (!parsed) return false;
    const a = parsed.slice(1, 4).map(Number), b = floor.split(".").map(Number);
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return true;
  };
  if (!atLeast("1.36.1")) {
    t.skip(`aw ${parsed?.[0] || "unknown"} is older than 1.36.1; skipped verb help validation for: ${[...verbs].sort().join(", ")}`);
    return;
  }
  for (const verb of [...verbs].sort()) {
    const help = spawnSync("aw", [verb, "--help"], { encoding: "utf8", timeout: 10000 });
    assert.equal(help.status, 0, `aw ${verb} --help failed\nstdout=${help.stdout}\nstderr=${help.stderr}`);
  }
});

test("declared commands and hooks have no npm package imports", () => {
  const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));
  const entrypointOf = (spec) => (typeof spec === "string" ? spec : spec.command);
  const commands = [
    ...Object.values(manifest.commands || {}),
    ...Object.values(manifest.hooks || {}).map(entrypointOf),
  ];
  const entrypoints = new Set(commands.map((command) => command.trim().split(/\s+/)[0]));
  assert.ok(entrypoints.size > 0);
  for (const entrypoint of entrypoints) {
    const source = readFileSync(join(CAPABILITY, entrypoint), "utf8");
    assert.doesNotMatch(source, /node_modules|from ["']@awebai|require\(["']@awebai/);
    // Host CLI calls go through execFile/argv, never a shell string (no
    // execSync, no `command -v`), so hostile team names, aliases, or tokens can
    // never be interpolated into a command.
    if (entrypoint === "bin/oats-aweb.mjs") {
      assert.match(source, /execFileSync/);
      assert.match(source, /aw team|aw workspace|aw id team/);
    } else {
      // The binding entrypoint delegates bounded JSON transport, not native aw.
      assert.equal(entrypoint, "bin/oats-aweb-binding.mjs");
      assert.match(source, /runBindingWire/);
    }
    assert.doesNotMatch(source, /\bexecSync\b/);
    // The Claude channel plugin is a DECLARED, consented runtime requirement —
    // the hook must never imperatively install it (or add a marketplace) at spawn.
    assert.doesNotMatch(source, /claude plugin (install|marketplace)/);
  }
});

test("spawn is fatal when aw is absent (required-hook contract)", async (t) => {
  const home = tempDir(t);
  const result = await run(["spawn"], {
    PATH: tempDir(t),
    OATS_EVENT: "spawn",
    OATS_HOME: home,
    OATS_INSTANCE: "developer-api-1",
  }, home);
  // A required spawn hook that cannot mint an identity must fail the spawn:
  // an instance that believes it can be woken by mail and cannot is worse than
  // one that never started.
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(JSON.parse(result.stdout).warning, /aw CLI not on PATH/);
});

test("authority discovery does not walk above the workspace", async (t) => {
  const outer = tempDir(t);
  const workspace = join(outer, "workspace");
  const home = join(workspace, "agents", "example", "instances", "example-1");
  mkdirSync(join(outer, ".aw"));
  mkdirSync(home, { recursive: true });
  const result = await run(["spawn"], {
    PATH: fakePath(t),
    OATS_EVENT: "spawn",
    OATS_HOME: home,
    OATS_INSTANCE: "example-1",
    OATS_CONTEXT: workspace,
    OATS_WORKSPACE: workspace,
    OATS_TEAM_SCOPE: workspace,
  }, home);
  // Bounded discovery finds no `.aw` within the workspace, so no identity can be
  // minted — fatal for a required spawn hook.
  assert.notEqual(result.code, 0, result.stdout);
  const warning = JSON.parse(result.stdout).warning;
  assert.match(warning, new RegExp(`no messaging root at ${workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "reports the deployment root it checked");
  assert.match(warning, /run oats aweb setup there or set settings\.oats\.aweb\.root/, "gives the reviewed v2 root remedy");
});

test("roster guidance uses the required --to recipient flag", async (t) => {
  const root = tempDir(t);
  mkdirSync(join(root, ".aw"));
  const result = await run(["roster"], {
    PATH: fakePath(t, `printf '%s\\n' '{"team_id":"default:test","members":[]}'`),
    OATS_EVENT: "roster",
    OATS_HOME: root,
    OATS_TEAM_SCOPE: root,
    OATS_TEAM_ID: "default:test",
  }, root);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /aw mail send --to <alias>/);
  assert.doesNotMatch(result.stdout, /aw mail send <alias>/);
});

test("setup --username initializes a missing root and reports the hosted default team mapping", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t, { activeTeam: "default:alice.aweb.ai" });
  const result = await run(["setup", "--username", "alice"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    OATS_EVENT: "setup",
    OATS_SETTINGS: JSON.stringify({ root, team: "configured:example.invalid" }),
  }, root);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(fake.readCalls().map((c) => c.args), [["init", "--username", "alice"], ["team", "list", "--json"]]);
  assert.match(result.stdout, /default:alice\.aweb\.ai/);
  assert.match(result.stdout, /settings\.oats\.aweb\.team/);
});

test("setup uses AWEB_API_KEY without printing the secret", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t, { activeTeam: "hosted:example.invalid" });
  const result = await run(["setup"], {
    PATH: fake.path,
    AWEB_API_KEY: "SECRET-API-KEY",
    AW_FAKE_TEAM: "hosted:example.invalid",
    OATS_EVENT: "setup",
    OATS_SETTINGS: JSON.stringify({ root, team: "hosted:example.invalid" }),
  }, root);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(fake.readCalls().map((c) => c.args), [["init"], ["team", "list", "--json"]]);
  assert.equal(fake.readCalls()[0].hasApiKey, true);
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET-API-KEY/);
  assert.match(result.stdout, /readiness: ready/);
});

test("setup --invite joins without printing the token", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t, { activeTeam: "joined:example.invalid" });
  const result = await run(["setup", "--invite", "SECRET-INVITE-TOKEN"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    AW_FAKE_TEAM: "joined:example.invalid",
    OATS_EVENT: "setup",
    OATS_SETTINGS: JSON.stringify({ root, team: "joined:example.invalid" }),
  }, root);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(fake.readCalls().map((c) => c.args), [["team", "join", "SECRET-INVITE-TOKEN"], ["team", "list", "--json"]]);
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET-INVITE-TOKEN/);
  assert.match(result.stdout, /readiness: ready/);
});

test("no-team readiness follows spawn's active-team fallback", async (t) => {
  const root = tempDir(t), home = join(root, "home");
  mkdirSync(join(root, ".aw"));
  mkdirSync(home);
  writeFileSync(join(root, ".aw", "teams.yaml"), "active_team: active:example.invalid\n");
  writeFileSync(join(root, ".aw", "teams.json"), JSON.stringify({ active_team: "active:example.invalid", memberships: [{ team_id: "active:example.invalid" }] }));
  const fake = fakeAwSetupPath(t, { activeTeam: "active:example.invalid" });
  const binding = { schemaVersion: 1, capability: "oats.aweb", payloadContract: "oats.aweb.messaging", payloadVersion: 1, payload: { responsibleHuman: { provider: "oats.aweb", id: "human" }, context: { kind: "standalone", key: "fixture" }, privateTeam: { provider: "oats.aweb", id: "private:example.invalid" }, wider: [] }, credentialRefs: {}, provenance: [] };
  const request = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: { delivery: "session", root }, input: { binding, context: binding.payload.context, action: { kind: "inspect" } } };
  const checked = spawnSync(process.execPath, [BINDING, "check"], { cwd: root, env: { ...process.env, OATS_WORKSPACE: root, OATS_TEAM_ID: "", OATS_TEAM_NAME: "" }, input: JSON.stringify(request), encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  assert.deepEqual(JSON.parse(checked.stdout).result, { status: "ready", problems: [] });
  const spawned = await run(["spawn"], { PATH: fake.path, AWEB_API_KEY: "", OATS_EVENT: "spawn", OATS_HOME: home, OATS_INSTANCE: "fixture-1", OATS_WORKSPACE: root, OATS_TEAM_ID: "", OATS_TEAM_NAME: "", OATS_SETTINGS: JSON.stringify({ root }) }, home);
  assert.equal(spawned.code, 0, spawned.stdout + spawned.stderr);
  assert.equal(JSON.parse(spawned.stdout).meta.team, "active:example.invalid");
});

test("retire without persisted identity is an idempotent no-op", async (t) => {
  const home = tempDir(t);
  const result = await run(["retire"], {
    PATH: fakePath(t),
    OATS_EVENT: "retire",
    OATS_HOME: home,
    OATS_META: "{}",
  }, home);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { meta: { retired: false, reason: "nothing-to-delete" } });
});
