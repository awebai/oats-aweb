// Real package acquisition, spawn, stop, upgrade and start; fake aw and harness
// only. The scratch deployment owns its HOME, Git configuration and tmux server.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createScratchDeployment } from "./helpers/scratch-deployment.mjs";
import { fakeAw } from "./helpers/fake-aw-grant.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PINNED = "593255d945c9039860cfa986f4192499e73cd12f"; // replace with the v0.68.0 release commit
const kernel = process.env.OATS_PREVIEW_KERNEL_ROOT;
if (process.env.OATS_PREVIEW_KERNEL_REQUIRED === "1") assert.ok(kernel, "required upgrade acceptance needs OATS_PREVIEW_KERNEL_ROOT");
const json = path => JSON.parse(readFileSync(path, "utf8"));
const value = (args, flag) => args.find(arg => arg.startsWith(flag + "="))?.slice(flag.length + 1) ?? args[args.indexOf(flag) + 1];

test("a real stopped 1.17.1 grant seat upgrades and starts with registration before old-grant revoke", {
  skip: !kernel && "requires the pinned public kernel checkout and local v1.17.1 tag",
  timeout: 180000,
}, t => {
  assert.equal(execFileSync("git", ["-C", kernel, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), process.env.OATS_KERNEL_COMMIT || PINNED);
  const base = realpathSync(mkdtempSync(join(tmpdir(), "aweb-upgrade-acceptance-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const fake = fakeAw(base), custody = join(base, "custody");
  mkdirSync(join(custody, ".aw"), { recursive: true });
  writeFileSync(join(custody, ".aw/identity.yaml"), "alias: resident-alias\n");
  const scratch = createScratchDeployment({ kernel, path: fake,
    env: { GIT_ALLOW_PROTOCOL: "file", OATS_REMOTE_CACHE: join(base, "remote-cache"), OATS_HOME_DIR: join(base, "oats-host") },
    teams: "teams:\n  default: { team: 't:example.test' }\ndefaultTeam: default\n",
    local: `settings:\n  oats.aweb:\n    residents:\n      merlin: ${JSON.stringify(custody)}\n`,
  });
  t.after(() => scratch.dispose());
  // The only host executables needed after onboarding are Node, Git and tmux.
  // No installed aw, pi extension or model harness can enter the fixture.
  const tmux = execFileSync("which", ["tmux"], { encoding: "utf8" }).trim();
  symlinkSync(tmux, join(scratch.bin, "tmux"));
  scratch.env.PATH = `${fake}:${scratch.bin}:${dirname(process.execPath)}:/usr/bin:/bin`;
  const git = (dir, ...args) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-C", dir, ...args], { env: scratch.env, encoding: "utf8" }).trim();
  const run = args => {
    const r = scratch.oats([...args, "--json"]);
    assert.equal(r.status, 0, `oats ${args.join(" ")}: ${r.stdout}${r.stderr}`);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.ok, true, r.stdout);
    return doc.result;
  };
  const source = join(base, "package-source"); mkdirSync(source);
  // Read the historical tag from this checkout; never fetch in a test.
  const archive = execFileSync("git", ["-C", ROOT, "archive", "v1.17.1", "oats-package"], { env: scratch.env, maxBuffer: 16 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", source], { env: scratch.env, input: archive });
  git(source, "init", "-q", "-b", "main"); git(source, "add", "."); git(source, "commit", "-qm", "v1.17.1 package bytes"); git(source, "tag", "v1.17.1");
  const oldCommit = git(source, "rev-parse", "HEAD");
  const catalog = join(base, "catalog.json");
  writeFileSync(catalog, JSON.stringify({ packages: { "oats.aweb": { url: source, ref: "v1.17.1", path: "oats-package" } } }));
  scratch.env.OATS_PACKAGE_CATALOG = catalog;
  const workspaceFile = join(scratch.workspace, "oats-workspace.yaml");
  appendFileSync(workspaceFile, "packages:\n  oats.aweb: v1.17.1\n");
  appendFileSync(join(scratch.workspace, "souls/plain/soul.yaml"), "  oats.aweb: { from: package }\nmessaging:\n  delivery: session\n  identity:\n    mode: global\n    resident: merlin\n    renew: launch\n");
  git(scratch.workspace, "add", "."); git(scratch.workspace, "commit", "-qm", "declare historical grant seat");
  run(["sync"]);
  const spawned = run(["spawn", "plain", "--name", "upgrade-seat", "--launch-config", "fake"]);
  assert.equal(spawned.launched, true);
  const home = spawned.home, record = () => json(join(home, "instance.json"));
  assert.equal(json(join(home, ".oats/modules/oats.aweb/oats.json")).version, "1.17.1");
  assert.equal(record().modules["oats.aweb"].from.version, "1.17.1");
  assert.equal(record().modules["oats.aweb"].commit, oldCommit);
  const before = record().capabilityMeta["oats.aweb"];
  assert.equal(before.identity.mode, "global");
  assert.equal(before.delivery, "session");
  assert.ok(before.identity.grant.id);
  t.diagnostic("real kernel spawned the v1.17.1 global-grant session seat with the fake harness");

  rmSync(join(source, "oats-package"), { recursive: true });
  cpSync(join(ROOT, "oats-package"), join(source, "oats-package"), { recursive: true });
  git(source, "add", "-A"); git(source, "commit", "-qm", "current branch package bytes"); git(source, "tag", "v1.32.0");
  writeFileSync(workspaceFile, readFileSync(workspaceFile, "utf8").replace("oats.aweb: v1.17.1", "oats.aweb: v1.32.0"));
  git(scratch.workspace, "add", "."); git(scratch.workspace, "commit", "-qm", "select upgrade destination");
  run(["sync"]);
  assert.equal(json(join(scratch.deployment, "oats-lock.json")).packages["oats.aweb"].version, "1.32.0");
  scratch.stop("upgrade-seat");
  const plan = run(["instance", "upgrade", "upgrade-seat", "--plan"]);
  run(["instance", "upgrade", "upgrade-seat", "--plan-revision", plan.planRevision, "--idempotency-key", "historical-grant-upgrade"]);
  const upgraded = record();
  assert.equal(json(join(home, ".oats/modules/oats.aweb/oats.json")).version, "1.32.0");
  assert.equal(upgraded.modules["oats.aweb"].from.version, "1.32.0");
  assert.equal(upgraded.modules["oats.aweb"].previous.from.version, "1.17.1");
  assert.equal(upgraded.modules["oats.aweb"].previous.commit, oldCommit);
  assert.deepEqual(upgraded.capabilityMeta["oats.aweb"], { ...before, delivery: "session", runtime: "pi" });
  const events = readFileSync(join(home, ".oats-events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(events.filter(event => event.kind === "modules-upgraded").length, 1);

  writeFileSync(join(base, "aw.log"), "");
  run(["session", "start", "--home", home]);
  const after = record().capabilityMeta["oats.aweb"], newHome = after.identity.grant.home;
  assert.notEqual(newHome, before.identity.grant.home);
  assert.notEqual(after.identity.grant.id, before.identity.grant.id);
  const calls = readFileSync(join(base, "aw.log"), "utf8").trim().split("\n").map(line => JSON.parse(line).argv);
  const registered = calls.findIndex(args => args[0] === "wake" && args[1] === "register" && value(args, "--identity-home") === newHome);
  const revoked = calls.findIndex(args => args.slice(0, 3).join(" ") === "id grant revoke" && args[3] === before.identity.grant.id);
  assert.ok(registered >= 0, "start registered the new grant home");
  assert.ok(revoked > registered, "new grant registration precedes old grant revocation");
});
