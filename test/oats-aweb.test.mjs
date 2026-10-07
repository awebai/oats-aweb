import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertKernelCheckAnswerRule } from "./helpers/kernel-check-answer-rule.mjs";
import { joinFromCalls } from "./helpers/fake-aw-join-from.mjs";
import { fakeAwSetupPath } from "./helpers/fake-aw-setup.mjs";

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

/** A recording `oats` CLI. `oats teams --json` answers `teams` (the kernel's teams document, as 0.36
 *  gives it by default: teamsApi 1, no localTeams), or exits 1 when `teams` is "fail". */
const TEAMS_0_36 = { teamsApi: 1, deployment: "/fixture", defaultTeam: null, teams: [], souls: { teams: {}, default: {} }, problems: [] };
function fakeOatsCli(t, { teams = TEAMS_0_36 } = {}) {
  const dir = tempDir(t);
  const calls = join(dir, "oats-calls.jsonl");
  const cli = join(dir, "oats");
  const answer = teams === "fail" ? `console.error("oats: E_WORKSPACE_SCHEMA fixture refusal"); process.exit(1);` : `console.log(${JSON.stringify(JSON.stringify({ schemaVersion: 1, ok: true, result: teams }))});`;
  writeFileSync(cli, `#!${process.execPath}\nconst fs = require("node:fs");\nconst args = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");\nif (args[0] === "teams" && args[1] === "--json") { ${answer} }\n`, { mode: 0o755 });
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
  assert.match(result.stdout, /team oats-shared \(shared:reh\.test\) is shared: ask its owner for an appropriate invite, then run `oats aweb setup --dir .* --soul dev --join oats-shared --invite-stdin --name <alias> --service <url>`/);
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
  const result = await run(["setup", "--join", "joined", "--invite", "SECRET-INVITE-TOKEN", "--service", "https://owner.example/api"], {
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
  assert.ok(connect.args.includes("--service=https://owner.example/api"));
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

test("setup --join can source service from AWEB_URL or a sibling root", async (t) => {
  const root = tempDir(t);
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const fake = fakeAwSetupPath(t, { activeTeam: "joined:example.invalid" });
  const fromEnv = await run(["setup", "--join", "envteam", "--invite", "TOKEN__envteam:example.invalid", "--name", "env-alias"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    AWEB_URL: "https://env.example/api",
    AW_FAKE_TEAM: "envteam:example.invalid",
    OATS_EVENT: "setup",
    OATS_WORKSPACE: root,
    OATS_DEFAULT_TEAM: "envteam",
    OATS_DEFAULT_TEAM_ID: "envteam:example.invalid",
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(fromEnv.code, 0, fromEnv.stderr);
  assert.ok(fake.readCalls().find((c) => c.identityHome === join(root, ".aweb-roots", "envteam", ".aw") && c.args.includes("--service=https://env.example/api")));

  const sibling = join(root, ".aweb-roots", "envteam");
  const fromSibling = await run(["setup", "--join", "sibling", "--invite", "TOKEN__sibling:example.invalid", "--name", "sib-alias"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    AW_FAKE_TEAM: "sibling:example.invalid",
    OATS_EVENT: "setup",
    OATS_WORKSPACE: root,
    OATS_DEFAULT_TEAM: "sibling",
    OATS_DEFAULT_TEAM_ID: "sibling:example.invalid",
    OATS_SETTINGS: JSON.stringify({ root, roots: { "envteam:example.invalid": sibling } }),
  }, root);
  assert.equal(fromSibling.code, 0, fromSibling.stderr);
  assert.ok(fake.readCalls().find((c) => c.identityHome === join(root, ".aweb-roots", "sibling", ".aw") && c.args.includes("--service=https://env.example/api")));
});

test("setup --join requires --name when no root identity can supply an alias", async (t) => {
  const root = tempDir(t);
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const fake = fakeAwSetupPath(t, { activeTeam: "joined:example.invalid" });
  const refused = await run(["setup", "--join", "joined", "--invite", "SECRET-INVITE-TOKEN", "--service", "https://owner.example/api"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    AW_WHOAMI_FAIL: "1",
    AW_FAKE_TEAM: "joined:example.invalid",
    OATS_EVENT: "setup",
    OATS_WORKSPACE: root,
    OATS_DEFAULT_TEAM: "joined",
    OATS_DEFAULT_TEAM_ID: "joined:example.invalid",
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /--name <alias> is required when no root identity is available/);
  assert.equal(fake.readCalls().some((c) => c.args.slice(0, 3).join(" ") === "id team accept-invite"), false);

  const joined = await run(["setup", "--join", "joined", "--invite", "SECRET-INVITE-TOKEN", "--service", "https://owner.example/api", "--name", "dev-alias"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    AW_WHOAMI_FAIL: "1",
    AW_FAKE_TEAM: "joined:example.invalid",
    OATS_EVENT: "setup",
    OATS_WORKSPACE: root,
    OATS_DEFAULT_TEAM: "joined",
    OATS_DEFAULT_TEAM_ID: "joined:example.invalid",
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(joined.code, 0, joined.stderr);
  const accept = fake.readCalls().find((c) => c.args.slice(0, 3).join(" ") === "id team accept-invite");
  assert.ok(accept.args.includes("--name=dev-alias"));
  assert.equal(accept.args.includes("--name=root"), false);
});

test("setup --join fails in one line without an explicit, environment, or sibling-root service", async (t) => {
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
  assert.match(result.stderr, /pass --service <url> \(ask the team owner; hosted aweb is https:\/\/app\.aweb\.ai\/api\)/);
  assert.equal(fake.readCalls().some((c) => c.args.slice(0, 2).join(" ") === "workspace connect"), false);
  assert.equal(existsSync(join(root, ".aweb-roots", "joined", ".aw", "identity.yaml")), true, "accepted identity is kept for resume");
  assert.doesNotMatch(readFileSync(join(root, "oats-local.yaml"), "utf8"), /joined:example\.invalid/);
});

test("setup --join connect failure keeps the root and can resume without a new invite", async (t) => {
  const root = tempDir(t);
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const fake = fakeAwSetupPath(t, { activeTeam: "joined:example.invalid" });
  const result = await run(["setup", "--join", "joined", "--invite", "SECRET-INVITE-TOKEN", "--service", "https://owner.example/api"], {
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
  assert.equal(existsSync(join(root, ".aweb-roots", "joined", ".aw", "identity.yaml")), true, "failed connect keeps the accepted identity for resume");
  assert.match(result.stderr, /resume with: oats aweb setup --dir .* --soul '<soul>' --join joined --service <url>/);
  assert.doesNotMatch(readFileSync(join(root, "oats-local.yaml"), "utf8"), /joined:example\.invalid/);

  const resumed = await run(["setup", "--join", "joined", "--service", "https://owner.example/api"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    AW_FAKE_TEAM: "joined:example.invalid",
    OATS_EVENT: "setup",
    OATS_WORKSPACE: root,
    OATS_DEFAULT_TEAM: "joined",
    OATS_DEFAULT_TEAM_ID: "joined:example.invalid",
    OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "joined", team: "joined:example.invalid", default: true, from: "shared" }]),
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.equal(fake.readCalls().filter((c) => c.args.slice(0, 3).join(" ") === "id team accept-invite").length, 1, "resume does not spend the invite again");
  assert.equal(existsSync(join(root, ".aweb-roots", "joined", ".aw", "workspace.yaml")), true);
  assert.match(readFileSync(join(root, "oats-local.yaml"), "utf8"), /"joined:example\.invalid": ".*\.aweb-roots\/joined"/);
});

test("setup --create with namespace creates a local BYOT team, accepts it into a per-team root, and records it with the kernel", async (t) => {
  const root = tempDir(t);
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const fake = fakeAwSetupPath(t);
  const kernel = fakeOatsCli(t);
  const label = "My_Team";
  const namespace = "example.invalid";
  const team = `${teamName(label)}:${namespace}`;
  const result = await run(["setup", "--create", label, "--namespace", namespace], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    OATS_EVENT: "setup", OATS_WORKSPACE: root,
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
  assert.deepEqual(kernel.readCalls().map((c) => c.args), [["teams", "--json"], ["teams", "add", label, `--team=${team}`]]);
  assert.match(readFileSync(join(root, "oats-local.yaml"), "utf8"), /"my-team:example\.invalid": ".*\.aweb-roots\/my-team"/);
});

// Team model 3 (OATS 0.38): a workspace without `localTeams: true` refuses `oats teams add|default`.
const TEAMS_CLOSED = { teamsApi: 2, deployment: "/fixture", localTeams: false, defaultTeam: null, teams: [], souls: {}, problems: [] };
const setupCreateEnv = (root, kernel, fake) => ({ OATS_WORKSPACE: root, PATH: fake.path, AWEB_API_KEY: "", OATS_EVENT: "setup", OATS_WORKSPACE: root, OATS_CLI_BIN: kernel.cli, OATS_SETTINGS: JSON.stringify({ root }) });

test("setup --create on a closed workspace creates the team, records nothing local, and prints what to commit", async (t) => {
  const root = tempDir(t);
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const fake = fakeAwSetupPath(t);
  const kernel = fakeOatsCli(t, { teams: TEAMS_CLOSED });
  const team = "eng:example.invalid";
  const result = await run(["setup", "--create", "eng", "--namespace", "example.invalid"], setupCreateEnv(root, kernel, fake), root);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(fake.readCalls().some((c) => c.args.slice(0, 3).join(" ") === "id team create"), "the aweb team is created");
  assert.deepEqual(kernel.readCalls().map((c) => c.args), [["teams", "--json"]], "no oats teams add on a closed workspace");
  assert.match(readFileSync(join(root, "oats-local.yaml"), "utf8"), /"eng:example\.invalid": ".*\.aweb-roots\/eng"/, "the per-team root is still recorded");
  assert.match(result.stdout, new RegExp(`teams:\\n\\s+"eng": \\{ team: "${team}" \\}\\n\\s+defaultTeam: "eng"\\n`), "the workspace form, with a default since none is set");
  assert.match(result.stdout, /to let souls join it \(rather than default to it\), list it in a `souls:` entry's teams/i);
  assert.match(result.stdout, /localTeams: true/);
  assert.doesNotMatch(result.stdout, /recorded local team|oats teams add/);
});

test("setup --create on a closed workspace with a default team prints no defaultTeam line", async (t) => {
  const root = tempDir(t);
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const fake = fakeAwSetupPath(t);
  const kernel = fakeOatsCli(t, { teams: { ...TEAMS_CLOSED, defaultTeam: { label: "main", team: "main:example.invalid", from: "workspace" } } });
  const result = await run(["setup", "--create", "eng", "--namespace", "example.invalid"], setupCreateEnv(root, kernel, fake), root);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /"eng": \{ team: "eng:example\.invalid" \}/);
  assert.doesNotMatch(result.stdout, /defaultTeam:/);
});

test("setup --create on a closed workspace quotes a label YAML would read as a number or boolean", async (t) => {
  for (const label of ["01", "true", "123"]) {
    const root = tempDir(t);
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
    const fake = fakeAwSetupPath(t);
    const kernel = fakeOatsCli(t, { teams: TEAMS_CLOSED });
    const result = await run(["setup", "--create", label, "--namespace", "example.invalid"], setupCreateEnv(root, kernel, fake), root);
    assert.equal(result.code, 0, result.stderr);
    // A JSON string is a YAML string: the committed label and default stay exactly the label.
    const entry = result.stdout.match(/^\s+(".*"): \{ team: (".*") \}$/m);
    const defaultTeam = result.stdout.match(/^\s+defaultTeam: (".*")$/m);
    assert.ok(entry && defaultTeam, `${label}: ${result.stdout}`);
    assert.equal(JSON.parse(entry[1]), label);
    assert.equal(JSON.parse(defaultTeam[1]), label);
    assert.match(JSON.parse(entry[2]), /:example\.invalid$/);
  }
});

test("setup --create refuses before creating anything when it cannot tell whether local teams are allowed", async (t) => {
  for (const kernel of [fakeOatsCli(t, { teams: "fail" }), undefined]) {
    const root = tempDir(t);
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
    const fake = fakeAwSetupPath(t);
    const env = setupCreateEnv(root, kernel ?? { cli: "" }, fake);
    if (!kernel) delete env.OATS_CLI_BIN;
    const result = await run(["setup", "--create", "eng", "--namespace", "example.invalid"], env, root);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stderr, /could not tell whether this workspace allows local teams .*; nothing was created/);
    assert.deepEqual(fake.readCalls(), [], "no aw call: nothing half-done");
    if (kernel) assert.deepEqual(kernel.readCalls().map((c) => c.args), [["teams", "--json"]]);
  }
});

test("setup on a closed workspace advises the workspace form instead of local team verbs", async (t) => {
  const root = tempDir(t);
  const fake = fakeAwSetupPath(t, { activeTeam: "default:alice.aweb.ai" });
  const kernel = fakeOatsCli(t, { teams: TEAMS_CLOSED });
  const result = await run(["setup", "--username", "alice"], { PATH: fake.path, AWEB_API_KEY: "", OATS_EVENT: "setup", OATS_CLI_BIN: kernel.cli, OATS_SETTINGS: JSON.stringify({ root }) }, root);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /teams:\n\s+"<label>": \{ team: "default:alice\.aweb\.ai" \}\n\s+defaultTeam: "<label>"/);
  assert.match(result.stdout, /localTeams: true/);
  assert.doesNotMatch(result.stdout, /oats teams add|oats teams default/);
  // Open or unknown (0.36: no localTeams; or no kernel to ask): today's advice.
  for (const env of [{ OATS_CLI_BIN: fakeOatsCli(t).cli }, {}]) {
    rmSync(join(root, ".aw"), { recursive: true, force: true });
    const open = await run(["setup", "--username", "alice"], { PATH: fake.path, AWEB_API_KEY: "", OATS_EVENT: "setup", OATS_SETTINGS: JSON.stringify({ root }), ...env }, root);
    assert.equal(open.code, 0, open.stderr);
    assert.match(open.stdout, /record it with `oats teams add <label> --team default:alice\.aweb\.ai` and `oats teams default <label>`/);
  }
});

test("setup --create without namespace distinguishes unsupported provider from native hosted creation", async (t) => {
  const root = tempDir(t);
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const fake = fakeAwSetupPath(t);
  const kernel = fakeOatsCli(t);
  const result = await run(["setup", "--create", "hosted"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    OATS_EVENT: "setup", OATS_WORKSPACE: root,
    OATS_CLI_BIN: kernel.cli,
    OATS_DEFAULT_TEAM: "hosted",
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /provider setup --create without --namespace is not supported; native aw 1\.36\.24 supports id team create --hosted/);
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
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const fake = fakeAwSetupPath(t);
  const kernel = fakeOatsCli(t);
  const label = "My.Team";
  const namespace = "example.invalid";
  const team = `${teamName(label)}-2:${namespace}`;
  const result = await run(["setup", "--create", label, "--namespace", namespace], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    AW_CREATE_MODE: "conflict-once",
    OATS_EVENT: "setup", OATS_WORKSPACE: root,
    OATS_CLI_BIN: kernel.cli,
    OATS_SETTINGS: JSON.stringify({ root }),
  }, root);
  assert.equal(result.code, 0, result.stderr);
  const createCalls = fake.readCalls().filter((c) => c.args.slice(0, 3).join(" ") === "id team create").map((c) => c.args);
  assert.deepEqual(createCalls, [
    ["id", "team", "create", `--name=${teamName(label)}`, `--namespace=${namespace}`, "--json"],
    ["id", "team", "create", `--name=${teamName(label)}-2`, `--namespace=${namespace}`, "--json"],
  ]);
  assert.deepEqual(kernel.readCalls().map((c) => c.args), [["teams", "--json"], ["teams", "add", label, `--team=${team}`]]);
});

test("setup --create reports non-409 create errors once without leaking minted tokens", async (t) => {
  const root = tempDir(t);
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const fake = fakeAwSetupPath(t);
  const result = await run(["setup", "--create", "My.Team", "--namespace", "example.invalid"], {
    PATH: fake.path,
    AWEB_API_KEY: "",
    AW_CREATE_MODE: "token-leak-error",
    OATS_EVENT: "setup", OATS_WORKSPACE: root,
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
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
    const fake = fakeAwSetupPath(t);
    const result = await run(["setup", "--create", "missing", "--namespace", "example.invalid"], {
      PATH: fake.path,
      AWEB_API_KEY: "",
      AW_CREATE_MODE: mode,
      OATS_EVENT: "setup", OATS_WORKSPACE: root,
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
  const originalFlowLocal = readFileSync(join(flowRoot, "oats-local.yaml"), "utf8");
  const flowFake = fakeAwSetupPath(t);
  const refused = await run(["setup", "--join", "flow", "--invite", "SECRET", "--service", "https://owner.example/api"], {
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
  assert.equal(readFileSync(join(flowRoot, "oats-local.yaml"), "utf8"), originalFlowLocal, "flow-style oats-local.yaml is byte-identical after refusal");
  assert.equal(existsSync(join(flowRoot, ".aweb-roots", "flow")), false, "refusal happens before creating the per-team root");
  assert.equal(flowFake.readCalls().some((c) => c.args.slice(0, 3).join(" ") === "id team accept-invite"), false, "refusal happens before accepting the invite");

  const root = tempDir(t);
  writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n# keep me\nsettings:\n  oats.aweb:\n    roots:\n      \"old:example.invalid\": \"/old\"\n");
  const fake = fakeAwSetupPath(t);
  const ok = await run(["setup", "--join", "old", "--invite", "SECRET", "--service", "https://owner.example/api"], {
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
  assert.ok(joinFromCalls(fake.readCalls()).some((call) => call.args.includes(`--name=${alias64}`)));

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
  writeFileSync(aw, `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (args[0] === "version") { console.log("aw 1.36.13"); process.exit(0); }\nif (args[0] === "team" && args[1] === "list" && args.includes("--json")) { console.log(JSON.stringify({ active_team: "active:example.invalid", memberships: [{ team_id: "active:example.invalid" }] })); process.exit(0); }\nif (args[0] === "team" && args[1] === "invite") { console.log(JSON.stringify({ token: "INVITE-TOKEN" })); process.exit(0); }\nif (args[0] === "team" && args[1] === "join") { console.error("alias already exists"); process.exit(7); }\nif (args[0] === "init" && args.some((a) => a.startsWith("--join-from"))) { console.error("alias already exists"); process.exit(7); }\nconsole.error("unexpected fake aw " + args.join(" ")); process.exit(93);\n`, { mode: 0o755 });
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
