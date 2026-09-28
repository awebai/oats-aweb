import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertKernelCheckAnswerRule } from "./helpers/kernel-check-answer-rule.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ROOT = join(REPO, "oats-package");
const CAPABILITY = join(ROOT, "capabilities", "oats-aweb");
const HOOK = join(CAPABILITY, "bin", "oats-aweb.mjs");
const BINDING = join(CAPABILITY, "bin", "oats-aweb-binding.mjs");
const teamName = (value) => String(value || "").toLowerCase().replace(/[_.]+/g, "-").replace(/^-+|-+$/g, "");

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "oats-aweb-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakePath(t, body = "exit 97") {
  const bin = join(tempDir(t), "bin");
  mkdirSync(bin);
  const aw = join(bin, "aw");
  writeFileSync(aw, `#!/bin/sh\nif [ "$1" = "version" ]; then echo "aw 1.36.13"; exit 0; fi\n${body}\n`);
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
let args = process.argv.slice(2);
let identityHome = null;
if (args[0] === "--identity-home") { identityHome = args[1]; args = args.slice(2); }
if (args[0] === "version") { console.log("aw 1.36.13"); process.exit(0); }
fs.appendFileSync(calls, JSON.stringify({ args, cwd: process.cwd(), identityHome, hasApiKey: !!process.env.AWEB_API_KEY }) + "\\n");
const awDir = identityHome || path.join(process.cwd(), ".aw");
const teamsFile = path.join(awDir, "teams.json");
const writeTeams = (team) => { fs.mkdirSync(awDir, { recursive: true }); fs.writeFileSync(path.join(awDir, "identity.yaml"), "did: did:key:zFixture\\n"); fs.writeFileSync(teamsFile, JSON.stringify({ active_team: team, memberships: [{ team_id: team }] })); };
const flag = (n) => args.find((a) => a.startsWith(n + "="))?.slice(n.length + 1) ?? (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
if (args[0] === "team" && args[1] === "list" && args.includes("--json")) {
  if (process.env.AW_LIST_TEAMS) console.log(process.env.AW_LIST_TEAMS);
  else if (fs.existsSync(teamsFile)) console.log(fs.readFileSync(teamsFile, "utf8"));
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
  const team = process.env.AW_FAKE_TEAM || args[3].replace(/^TOKEN__/, "");
  writeTeams(team);
  console.log(JSON.stringify({ team_id: team, alias: flag("--name") || "root", ...(process.env.AW_ACCEPT_OMIT_SERVICE ? {} : { aweb_url: "https://app.aweb.ai/api" }) }));
} else if (args[0] === "whoami") {
  console.log(JSON.stringify({ alias: "fixture", did: "did:key:zFixture" }));
} else if (args[0] === "workspace" && args[1] === "delete") {
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

function fakeOatsCli(t) {
  const dir = tempDir(t);
  const calls = join(dir, "oats-calls.jsonl");
  const cli = join(dir, "oats");
  writeFileSync(cli, `#!${process.execPath}\nconst fs = require("node:fs");\nfs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + "\\n");\n`, { mode: 0o755 });
  return { cli, calls, readCalls: () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [] };
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

test("manifest resolves the OATS playbook and the three vendored Agent Skills by expected names", () => {
  const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));
  const expected = ["oats-aweb", "aweb-messaging", "aweb-team-membership", "aweb-identity"];
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
  t.diagnostic(`aw version fixture: ${(version.stdout + version.stderr).trim()}`);
  if (!atLeast("1.36.6")) {
    t.skip(`aw ${parsed?.[0] || "unknown"} is older than published 1.36.6; skipped verb help validation for: ${[...verbs].sort().join(", ")}`);
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

test("spawn is fatal when aw version cannot be read", async (t) => {
  const home = tempDir(t);
  const bin = tempDir(t);
  const aw = join(bin, "aw");
  writeFileSync(aw, `#!/bin/sh\nif [ "$1" = "version" ]; then exit 42; fi\necho unexpected >&2\nexit 93\n`);
  chmodSync(aw, 0o755);
  const result = await run(["spawn"], {
    PATH: bin,
    OATS_EVENT: "spawn",
    OATS_HOME: home,
    OATS_INSTANCE: "developer-api-1",
  }, home);
  assert.notEqual(result.code, 0, result.stdout);
  assert.match(JSON.parse(result.stdout).warning, /aw version could not be read/);
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
    OATS_WORKSPACE_KEY: "repo:fixture",
    OATS_DEFAULT_TEAM: "active",
    OATS_DEFAULT_TEAM_ID: "active:example.invalid",
    OATS_DEFAULT_TEAM_FROM: "deployment",
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
  const result = await run(["roster", "--soul", "dev"], {
    PATH: fakePath(t, `printf '%s\\n' '{"team_id":"default:test","members":[]}'`),
    OATS_EVENT: "roster",
    OATS_HOME: root,
    OATS_DEFAULT_TEAM: "default",
    OATS_DEFAULT_TEAM_ID: "default:test",
    OATS_DEFAULT_TEAM_FROM: "deployment",
  }, root);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /aw mail send --to <alias>/);
  assert.doesNotMatch(result.stdout, /aw mail send <alias>/);
});

test("setup --username initializes a missing root and reports the hosted default team mapping", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t, { activeTeam: "default:alice.aweb.ai" });
  for (const args of [["setup", "--soul", "dev", "--username", "alice"], ["setup", "--username=alice", "--soul=dev"]]) {
    const result = await run(args, {
      PATH: fake.path,
      AWEB_API_KEY: "",
      OATS_EVENT: "setup",
      OATS_DEFAULT_TEAM: "default",
      OATS_DEFAULT_TEAM_ID: "default:alice.aweb.ai",
      OATS_DEFAULT_TEAM_FROM: "deployment",
      OATS_SETTINGS: JSON.stringify({ root }),
    }, root);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /default:alice\.aweb\.ai/);
    assert.match(result.stdout, /readiness: ready/);
    rmSync(join(root, ".aw"), { recursive: true, force: true });
  }
  assert.deepEqual(fake.readCalls().map((c) => c.args), [["init", "--new-account", "--username", "alice"], ["team", "list", "--json"], ["init", "--new-account", "--username", "alice"], ["team", "list", "--json"]]);
});

test("setup uses AWEB_API_KEY without printing the secret", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t, { activeTeam: "hosted:example.invalid" });
  const result = await run(["setup"], {
    PATH: fake.path,
    AWEB_API_KEY: "SECRET-API-KEY",
    AW_FAKE_TEAM: "hosted:example.invalid",
    OATS_EVENT: "setup",
    OATS_DEFAULT_TEAM: "hosted",
    OATS_DEFAULT_TEAM_ID: "hosted:example.invalid",
    OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(fake.readCalls().map((c) => c.args), [["init"], ["team", "list", "--json"]]);
  assert.equal(fake.readCalls()[0].hasApiKey, true);
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET-API-KEY/);
  assert.match(result.stdout, /readiness: ready/);
});

test("setup refuses a missing shared default root with the invite remedy", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t);
  const teams = [{ label: "oats-shared", team: "shared:reh.test", default: true, from: "shared" }];
  const result = await run(["setup", "--soul", "dev"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    OATS_EVENT: "setup",
    OATS_SOUL: "/must/not/use/path-soul",
    OATS_DEFAULT_TEAM: "oats-shared",
    OATS_DEFAULT_TEAM_ID: "shared:reh.test",
    OATS_DEFAULT_TEAM_FROM: "shared",
    OATS_TEAMS: JSON.stringify(teams),
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /team oats-shared \(shared:reh\.test\) is shared: ask its owner for an invite, then run `oats aweb setup --soul dev --join oats-shared --invite <token>`/);
  assert.doesNotMatch(result.stdout, /--username|AWEB_API_KEY/);
  assert.equal(existsSync(join(root, ".aw")), false);
});

test("setup refuses a shared default root without that membership", async (t) => {
  const root = tempDir(t);
  mkdirSync(join(root, ".aw"), { recursive: true });
  const fake = fakeAwSetupPath(t);
  const teams = [{ label: "oats-shared", team: "shared:reh.test", default: true, from: "shared" }];
  const result = await run(["setup", "--soul", "dev"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    AW_LIST_TEAMS: JSON.stringify({ memberships: [{ team_id: "other:reh.test" }] }),
    OATS_EVENT: "setup",
    OATS_AGENT: "dev",
    OATS_DEFAULT_TEAM: "oats-shared",
    OATS_DEFAULT_TEAM_ID: "shared:reh.test",
    OATS_DEFAULT_TEAM_FROM: "shared",
    OATS_TEAMS: JSON.stringify(teams),
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /team oats-shared \(shared:reh\.test\) is shared/);
});

test("setup reports non-default shared teams missing from this host", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t);
  const teams = [
    { label: "personal", team: "default:reh.test", default: true, from: "local" },
    { label: "oats-shared", team: "shared:reh.test", default: false, from: "shared" },
  ];
  const result = await run(["setup", "--soul", "dev"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    OATS_EVENT: "setup",
    OATS_AGENT: "dev",
    OATS_DEFAULT_TEAM: "personal",
    OATS_DEFAULT_TEAM_ID: "default:reh.test",
    OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify(teams),
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /team oats-shared \(shared:reh\.test\) is shared/);
});

test("setup local default with no root keeps the onboarding menu", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t);
  const result = await run(["setup"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    OATS_EVENT: "setup",
    OATS_DEFAULT_TEAM: "personal",
    OATS_DEFAULT_TEAM_ID: "default:reh.test",
    OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "personal", team: "default:reh.test", default: true, from: "local" }]),
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /No aweb workspace/);
  assert.match(result.stdout, /--username <u>/);
});

test("setup --join --invite accepts into a per-team root without printing the token", async (t) => {
  const root = tempDir(t);
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const fake = fakeAwSetupPath(t, { activeTeam: "joined:example.invalid" });
  const result = await run(["setup", "--join", "joined", "--invite", "SECRET-INVITE-TOKEN"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    AW_FAKE_TEAM: "joined:example.invalid",
    OATS_EVENT: "setup",
    OATS_WORKSPACE: root,
    OATS_DEFAULT_TEAM: "joined",
    OATS_DEFAULT_TEAM_ID: "joined:example.invalid",
    OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET-INVITE-TOKEN/);
  assert.match(result.stdout, /per-team root/);
  const accept = fake.readCalls().find((c) => c.args.slice(0, 3).join(" ") === "id team accept-invite");
  assert.equal(accept.identityHome, join(root, ".aweb-roots", "joined", ".aw"));
  const connect = fake.readCalls().find((c) => c.args.slice(0, 2).join(" ") === "workspace connect");
  assert.equal(connect.identityHome, join(root, ".aweb-roots", "joined", ".aw"));
  assert.ok(connect.args.includes("--service=https://app.aweb.ai/api"));
  assert.ok(connect.args.includes("--team=joined:example.invalid"));
  assert.equal(existsSync(join(root, ".aweb-roots", "joined", ".aw", "workspace.yaml")), true);
  assert.match(readFileSync(join(root, "oats-local.yaml"), "utf8"), /"joined:example\.invalid": ".*\.aweb-roots\/joined"/);

  const afterJoin = await run(["setup", "--soul", "dev"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    OATS_EVENT: "setup",
    OATS_DEFAULT_TEAM: "joined",
    OATS_DEFAULT_TEAM_ID: "joined:example.invalid",
    OATS_DEFAULT_TEAM_FROM: "shared",
    OATS_TEAMS: JSON.stringify([{ label: "joined", team: "joined:example.invalid", default: true, from: "shared" }]),
    OATS_SETTINGS: JSON.stringify({ root, roots: { "joined:example.invalid": join(root, ".aweb-roots", "joined") } }),
  }, root);
  assert.equal(afterJoin.code, 0, afterJoin.stderr);
  assert.doesNotMatch(afterJoin.stdout, /is shared: ask its owner/);
  assert.match(afterJoin.stdout, /readiness: ready/);
});

test("setup --join fails without a service from aw or the root and records nothing", async (t) => {
  const root = tempDir(t);
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const fake = fakeAwSetupPath(t, { activeTeam: "joined:example.invalid" });
  const result = await run(["setup", "--join", "joined", "--invite", "SECRET-INVITE-TOKEN"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    AW_FAKE_TEAM: "joined:example.invalid",
    AW_ACCEPT_OMIT_SERVICE: "1",
    OATS_EVENT: "setup",
    OATS_WORKSPACE: root,
    OATS_DEFAULT_TEAM: "joined",
    OATS_DEFAULT_TEAM_ID: "joined:example.invalid",
    OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /cannot determine the aweb service for joined team joined from/);
  assert.match(result.stderr, /no aweb_url in its \.aw\/workspace\.yaml and aw returned none/);
  assert.equal(fake.readCalls().some((c) => c.args.slice(0, 2).join(" ") === "workspace connect"), false);
  assert.equal(existsSync(join(root, ".aweb-roots", "joined")), false, "failed setup join removes the per-team root after cleanup");
  assert.doesNotMatch(readFileSync(join(root, "oats-local.yaml"), "utf8"), /joined:example\.invalid/);
});

test("setup --join connect failure records nothing and removes the unusable root", async (t) => {
  const root = tempDir(t);
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const fake = fakeAwSetupPath(t, { activeTeam: "joined:example.invalid" });
  const result = await run(["setup", "--join", "joined", "--invite", "SECRET-INVITE-TOKEN"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    AW_FAKE_TEAM: "joined:example.invalid",
    AW_CONNECT_FAIL: "1",
    OATS_EVENT: "setup",
    OATS_WORKSPACE: root,
    OATS_DEFAULT_TEAM: "joined",
    OATS_DEFAULT_TEAM_ID: "joined:example.invalid",
    OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /workspace connect\/verification failed/);
  assert.equal(fake.readCalls().some((c) => c.args.slice(0, 2).join(" ") === "workspace connect"), true);
  assert.equal(existsSync(join(root, ".aweb-roots", "joined")), false, "failed connect removes the per-team root after cleanup");
  assert.doesNotMatch(readFileSync(join(root, "oats-local.yaml"), "utf8"), /joined:example\.invalid/);
});

test("setup --create with namespace creates a local BYOT team, accepts it into a per-team root, and records it with the kernel", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t);
  const kernel = fakeOatsCli(t);
  const label = "My_Team";
  const namespace = "example.invalid";
  const team = `${teamName(label)}:${namespace}`;
  const result = await run(["setup", "--create", label, "--namespace", namespace], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    OATS_EVENT: "setup",
    OATS_CLI_BIN: kernel.cli,
    OATS_DEFAULT_TEAM: label,
    OATS_DEFAULT_TEAM_ID: team,
    OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`created ${team}`));
  assert.deepEqual(fake.readCalls().map((c) => c.args), [
    ["id", "team", "create", `--name=${teamName(label)}`, `--namespace=${namespace}`, "--json"],
    ["whoami", "--json"],
    ["id", "team", "accept-invite", `TOKEN__${team}`, "--name=fixture", "--local", "--json"],
    ["workspace", "connect", "--service=https://app.aweb.ai/api", `--team=${team}`, "--json"],
    ["team", "list", "--json"],
  ]);
  assert.deepEqual(kernel.readCalls().map((c) => c.args), [["teams", "add", label, `--team=${team}`]]);
  assert.match(readFileSync(join(root, "oats-local.yaml"), "utf8"), /"my-team:example\.invalid": ".*\.aweb-roots\/my-team"/);
});

test("setup --create without namespace refuses hosted team creation until the aweb-abkh floor", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t);
  const kernel = fakeOatsCli(t);
  const result = await run(["setup", "--create", "hosted"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    OATS_EVENT: "setup",
    OATS_CLI_BIN: kernel.cli,
    OATS_DEFAULT_TEAM: "hosted",
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /creating an additional hosted team needs hosted team creation \(aweb-abkh\), not yet released in aw or aweb Cloud; use --namespace <domain> for a team you control, or ask the aweb team/);
  assert.deepEqual(fake.readCalls(), []);
  assert.deepEqual(kernel.readCalls(), []);
});

test("plain setup with an unmapped default asks for the owner id or invite and creates nothing", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t);
  const kernel = fakeOatsCli(t);
  const label = "Shared.Team";
  const result = await run(["setup"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    OATS_EVENT: "setup",
    OATS_CLI_BIN: kernel.cli,
    OATS_DEFAULT_TEAM: label,
    OATS_DEFAULT_TEAM_FROM: "soul",
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /ask its owner/);
  assert.deepEqual(fake.readCalls(), []);
  assert.deepEqual(kernel.readCalls(), []);
});

test("setup --create suffixes only on 409 conflicts", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t);
  const kernel = fakeOatsCli(t);
  const label = "My.Team";
  const namespace = "example.invalid";
  const team = `${teamName(label)}-2:${namespace}`;
  const result = await run(["setup", "--create", label, "--namespace", namespace], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    AW_CREATE_MODE: "conflict-once",
    OATS_EVENT: "setup",
    OATS_CLI_BIN: kernel.cli,
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(result.code, 0, result.stderr);
  const createCalls = fake.readCalls().filter((c) => c.args.slice(0, 3).join(" ") === "id team create").map((c) => c.args);
  assert.deepEqual(createCalls, [
    ["id", "team", "create", `--name=${teamName(label)}`, `--namespace=${namespace}`, "--json"],
    ["id", "team", "create", `--name=${teamName(label)}-2`, `--namespace=${namespace}`, "--json"],
  ]);
  assert.deepEqual(kernel.readCalls().map((c) => c.args), [["teams", "add", label, `--team=${team}`]]);
});

test("setup --create reports non-409 create errors once without leaking minted tokens", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t);
  const result = await run(["setup", "--create", "My.Team", "--namespace", "example.invalid"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    AW_CREATE_MODE: "token-leak-error",
    OATS_EVENT: "setup",
    OATS_CLI_BIN: fakeOatsCli(t).cli,
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /aw id team failed \(exit 73\) \(output withheld: this command handles credentials\)/);
  assert.doesNotMatch(result.stderr, /SECRET-FRESH-INVITE|network unavailable/);
  assert.equal(fake.readCalls().filter((c) => c.args.slice(0, 3).join(" ") === "id team create").length, 1);
});

test("setup --create fails when aw create omits team_id or invite token", async (t) => {
  for (const [mode, message] of [["missing-id", /aw id team create returned no team_id/], ["missing-token", /aw id team create returned no invite token/]]) {
    const root = tempDir(t);
    const fake = fakeAwSetupPath(t);
    const result = await run(["setup", "--create", "missing", "--namespace", "example.invalid"], {
      PATH: fake.path,
      AWEB_API_KEY: "",
      AW_CREATE_MODE: mode,
      OATS_EVENT: "setup",
      OATS_CLI_BIN: fakeOatsCli(t).cli,
      OATS_SETTINGS: JSON.stringify({ root }),
    }, root);
    assert.equal(result.code, 1, mode);
    assert.match(result.stderr, message, mode);
  }
});

test("recording per-team roots refuses flow-style oats-local but updates block roots atomically with comments", async (t) => {
  const flowRoot = tempDir(t);
  writeFileSync(join(flowRoot, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\nsettings: { \"oats.aweb\": { roots: {} } }\n");
  const flowFake = fakeAwSetupPath(t);
  const refused = await run(["setup", "--join", "flow", "--invite", "SECRET"], {
    PATH: flowFake.path,
    AWEB_API_KEY: "",
    AW_FAKE_TEAM: "flow:example.invalid",
    OATS_EVENT: "setup",
    OATS_WORKSPACE: flowRoot,
    OATS_DEFAULT_TEAM: "flow",
    OATS_DEFAULT_TEAM_ID: "flow:example.invalid",
    OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_SETTINGS: JSON.stringify({ root: flowRoot }),
  }, flowRoot);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /cannot safely update settings\.oats\.aweb\.roots automatically/);
  assert.match(refused.stderr, /add this line by hand/);

  const root = tempDir(t);
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n# keep me\nsettings:\n  oats.aweb:\n    roots:\n      \"old:example.invalid\": \"/old\"\n");
  const fake = fakeAwSetupPath(t);
  const ok = await run(["setup", "--join", "old", "--invite", "SECRET"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    AW_FAKE_TEAM: "old:example.invalid",
    OATS_EVENT: "setup",
    OATS_WORKSPACE: root,
    OATS_DEFAULT_TEAM: "old",
    OATS_DEFAULT_TEAM_ID: "old:example.invalid",
    OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(ok.code, 0, ok.stderr);
  const text = readFileSync(join(root, "oats-local.yaml"), "utf8");
  assert.match(text, /# keep me/);
  assert.equal((text.match(/\"old:example\.invalid\"/g) || []).length, 1);
  assert.match(text, /"old:example\.invalid": ".*\.aweb-roots\/old"/);
  assert.deepEqual(readdirSync(root).filter((name) => name.includes(".tmp")), []);
});

test("oats aweb teams text mode handles null defaults and no unmapped field", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t);
  const result = await run(["teams"], {
    PATH: fake.path,
    OATS_EVENT: "teams",
    OATS_HOME: root,
    OATS_SETTINGS: JSON.stringify({ root }),
    OATS_META: JSON.stringify({}),
    OATS_TEAMS: JSON.stringify([]),
  }, root);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /default team: none/);
});

test("setup argument parse errors never echo token-shaped input", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t);
  for (const args of [["setup", "--invite="], ["setup", "SECRET-PROBE-TOKEN"]]) {
    const result = await run(args, { PATH: fake.path, AWEB_API_KEY: "", OATS_EVENT: "setup", OATS_SETTINGS: JSON.stringify({ root }) }, root);
    assert.equal(result.code, 2, result.stdout + result.stderr);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /SECRET-PROBE-TOKEN|--invite=/);
    assert.match(result.stderr, /^oats aweb setup: usage: oats aweb setup/);
  }
  assert.deepEqual(fake.readCalls(), []);
});

test("spawn accepts a 64-character alias and rejects 65 before aw", async (t) => {
  const root = tempDir(t), okHome = join(root, "ok-home"), badHome = join(root, "bad-home");
  mkdirSync(join(root, ".aw"));
  mkdirSync(okHome);
  mkdirSync(badHome);
  const fake = fakeAwSetupPath(t, { activeTeam: "active:example.invalid" });
  const alias64 = `a${"b".repeat(63)}`;
  const accepted = await run(["spawn"], { PATH: fake.path, OATS_EVENT: "spawn", OATS_HOME: okHome, OATS_INSTANCE: alias64, OATS_WORKSPACE: root, OATS_DEFAULT_TEAM: "active", OATS_DEFAULT_TEAM_ID: "active:example.invalid", OATS_DEFAULT_TEAM_FROM: "deployment", OATS_SETTINGS: JSON.stringify({ root }) }, okHome);
  assert.equal(accepted.code, 0, accepted.stdout + accepted.stderr);
  assert.ok(fake.readCalls().some((call) => call.args[0] === "team" && call.args[1] === "join" && (call.args.includes(`--name=${alias64}`) || (call.args.includes("--name") && call.args[call.args.indexOf("--name") + 1] === alias64))));

  const callsBefore = fake.readCalls().length;
  const alias65 = `a${"b".repeat(64)}`;
  const refused = await run(["spawn"], { PATH: fake.path, OATS_EVENT: "spawn", OATS_HOME: badHome, OATS_INSTANCE: alias65, OATS_WORKSPACE: root, OATS_DEFAULT_TEAM: "active", OATS_DEFAULT_TEAM_ID: "active:example.invalid", OATS_DEFAULT_TEAM_FROM: "deployment", OATS_SETTINGS: JSON.stringify({ root }) }, badHome);
  assert.notEqual(refused.code, 0, refused.stdout);
  assert.match(JSON.parse(refused.stdout).warning, /invalid alias/i);
  assert.equal(fake.readCalls().length, callsBefore, "invalid alias must be refused before any aw call");
});

test("alias conflict remedy names --name and --purpose", async (t) => {
  const root = tempDir(t), home = join(root, "home");
  mkdirSync(join(root, ".aw"));
  mkdirSync(home);
  const fake = fakeAwSetupPath(t);
  const aw = join(fake.path, "aw");
  writeFileSync(aw, `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (args[0] === "version") { console.log("aw 1.36.13"); process.exit(0); }\nif (args[0] === "team" && args[1] === "list" && args.includes("--json")) { console.log(JSON.stringify({ active_team: "active:example.invalid", memberships: [{ team_id: "active:example.invalid" }] })); process.exit(0); }\nif (args[0] === "team" && args[1] === "invite") { console.log(JSON.stringify({ token: "INVITE-TOKEN" })); process.exit(0); }\nif (args[0] === "team" && args[1] === "join") { console.error("alias already exists"); process.exit(7); }\nconsole.error("unexpected fake aw " + args.join(" ")); process.exit(93);\n`, { mode: 0o755 });
  const result = await run(["spawn"], { PATH: fake.path, OATS_EVENT: "spawn", OATS_HOME: home, OATS_INSTANCE: "developer-api-1", OATS_WORKSPACE: root, OATS_DEFAULT_TEAM: "active", OATS_DEFAULT_TEAM_ID: "active:example.invalid", OATS_DEFAULT_TEAM_FROM: "deployment", OATS_SETTINGS: JSON.stringify({ root }) }, home);
  assert.notEqual(result.code, 0, result.stdout);
  const warning = JSON.parse(result.stdout).warning;
  assert.match(warning, /spawn with a different --name \(kernels 0\.26\.0\+\) or a different --purpose/);
  assert.doesNotMatch(warning, /fresh --purpose/);
});

test("no-team readiness and spawn refuse without kernel default", async (t) => {
  const root = tempDir(t), home = join(root, "home");
  mkdirSync(join(root, ".aw"));
  mkdirSync(home);
  writeFileSync(join(root, ".aw", "teams.yaml"), "active_team: active:example.invalid\n");
  writeFileSync(join(root, ".aw", "teams.json"), JSON.stringify({ active_team: "active:example.invalid", memberships: [{ team_id: "active:example.invalid" }] }));
  const fake = fakeAwSetupPath(t, { activeTeam: "active:example.invalid" });
  const binding = { schemaVersion: 1, capability: "oats.aweb", payloadContract: "oats.aweb.messaging", payloadVersion: 1, payload: { responsibleHuman: { provider: "oats.aweb", id: "human" }, context: { kind: "standalone", key: "fixture" }, privateTeam: { provider: "oats.aweb", id: "private:example.invalid" }, wider: [] }, credentialRefs: {}, provenance: [] };
  const request = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: { delivery: "session", root }, input: { binding, context: binding.payload.context, action: { kind: "inspect" } } };
  const checked = spawnSync(process.execPath, [BINDING, "check"], { cwd: root, env: { ...process.env, PATH: fake.path, OATS_WORKSPACE: root }, input: JSON.stringify(request), encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  assertKernelCheckAnswerRule(checked.stdout, request, "oats-aweb captured binding check");
  assert.deepEqual(JSON.parse(checked.stdout).result, { status: "needs-configuration", problems: [{ code: "needs-configuration", message: "no teams configured: run `oats aweb setup`" }] });
  const spawned = await run(["spawn"], { PATH: fake.path, AWEB_API_KEY: "", OATS_EVENT: "spawn", OATS_HOME: home, OATS_INSTANCE: "fixture-1", OATS_WORKSPACE: root, OATS_SETTINGS: JSON.stringify({ root }) }, home);
  assert.notEqual(spawned.code, 0, spawned.stdout + spawned.stderr);
  assert.match(JSON.parse(spawned.stdout).warning, /no teams configured/);
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
