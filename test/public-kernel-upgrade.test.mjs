// Real package acquisition, spawn, stop, upgrade and start; fake aw and harness
// only. The scratch deployment owns its HOME, Git configuration and tmux server.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createScratchDeployment } from "./helpers/scratch-deployment.mjs";
import { fakeAw } from "./helpers/fake-aw-grant.mjs";
import { fakeAwWake } from "./helpers/fake-aw-wake.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PINNED = "13f8f133808f5932bf461108703c1bada4b3f3d3"; // OATS v0.68.1 release pin
const kernel = process.env.OATS_PREVIEW_KERNEL_ROOT;
if (process.env.OATS_PREVIEW_KERNEL_REQUIRED === "1") assert.ok(kernel, "required upgrade acceptance needs OATS_PREVIEW_KERNEL_ROOT");
const json = path => JSON.parse(readFileSync(path, "utf8"));
const value = (args, flag) => args.find(arg => arg.startsWith(flag + "="))?.slice(flag.length + 1) ?? args[args.indexOf(flag) + 1];
const skip = !kernel && "requires the pinned public kernel checkout and local historical tags";
const capabilitiesAt = version => version === "1.31.0" ? ["oats.aweb", "oats.aweb-tasks"] : ["oats.aweb"];

/** A scratch deployment whose locked oats.aweb is the local v<version> tag,
 *  with one instance spawned from a soul composing it. `fakeBin` is the fake
 *  aw's directory, `local` and `soul` YAML appended to oats-local.yaml and to
 *  the soul. `upgrade()` re-locks to this checkout's package bytes as v1.32.1,
 *  stops the instance and plans and applies `oats instance upgrade`. */
function historicalSeat(t, { base, version, fakeBin, local = "", soul, launchConfig, env = {} }) {
  const capabilities = capabilitiesAt(version);
  assert.equal(execFileSync("git", ["-C", kernel, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), process.env.OATS_KERNEL_COMMIT || PINNED);
  const scratch = createScratchDeployment({ kernel, path: fakeBin,
    env: { GIT_ALLOW_PROTOCOL: "file", OATS_REMOTE_CACHE: join(base, "remote-cache"), OATS_HOME_DIR: join(base, "oats-host"), ...env },
    teams: "teams:\n  default: { team: 't:example.test' }\ndefaultTeam: default\n",
    local,
  });
  t.after(() => scratch.dispose());
  // The only host executables needed after onboarding are Node, Git and tmux.
  // No installed aw, pi extension or model harness can enter the fixture.
  const tmux = execFileSync("which", ["tmux"], { encoding: "utf8" }).trim();
  symlinkSync(tmux, join(scratch.bin, "tmux"));
  scratch.env.PATH = `${fakeBin}:${scratch.bin}:${dirname(process.execPath)}:/usr/bin:/bin`;
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
  const archive = execFileSync("git", ["-C", ROOT, "archive", `v${version}`, "oats-package"], { env: scratch.env, maxBuffer: 16 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", source], { env: scratch.env, input: archive });
  git(source, "init", "-q", "-b", "main"); git(source, "add", "."); git(source, "commit", "-qm", `v${version} package bytes`); git(source, "tag", `v${version}`);
  const oldCommit = git(source, "rev-parse", "HEAD");
  const catalog = join(base, "catalog.json");
  writeFileSync(catalog, JSON.stringify({ packages: { "oats.aweb": { url: source, ref: `v${version}`, path: "oats-package" } } }));
  scratch.env.OATS_PACKAGE_CATALOG = catalog;
  const workspaceFile = join(scratch.workspace, "oats-workspace.yaml");
  appendFileSync(workspaceFile, `packages:\n  oats.aweb: v${version}\n`);
  appendFileSync(join(scratch.workspace, "souls/plain/soul.yaml"), capabilities.map(name => `  ${name}: { from: package }\n`).join("") + soul);
  git(scratch.workspace, "add", "."); git(scratch.workspace, "commit", "-qm", `declare historical v${version} seat`);
  run(["sync"]);
  const spawned = run(["spawn", "plain", "--name", "upgrade-seat", "--launch-config", launchConfig]);
  assert.equal(spawned.launched, true);
  const home = spawned.home, record = () => json(join(home, "instance.json"));
  for (const name of capabilities) {
    assert.equal(json(join(home, '.oats/modules', name, 'oats.json')).version, version);
    assert.equal(record().modules[name].from.version, version);
    assert.equal(record().modules[name].commit, oldCommit);
  }
  t.diagnostic(`real kernel spawned v${version} with ${capabilities.join(" and ")} using the ${launchConfig} launch config`);

  const upgrade = (awCalls) => {
    rmSync(join(source, "oats-package"), { recursive: true });
    cpSync(join(ROOT, "oats-package"), join(source, "oats-package"), { recursive: true });
    git(source, "add", "-A"); git(source, "commit", "-qm", "current branch package bytes"); git(source, "tag", "v1.32.1");
    writeFileSync(workspaceFile, readFileSync(workspaceFile, "utf8").replace(`oats.aweb: v${version}`, "oats.aweb: v1.32.1"));
    git(scratch.workspace, "add", "."); git(scratch.workspace, "commit", "-qm", "select upgrade destination");
    run(["sync"]);
    assert.equal(json(join(scratch.deployment, "oats-lock.json")).packages["oats.aweb"].version, "1.32.1");
    scratch.stop("upgrade-seat");
    const callsBeforeUpgrade = awCalls();
    const plan = run(["instance", "upgrade", "upgrade-seat", "--plan"]);
    run(["instance", "upgrade", "upgrade-seat", "--plan-revision", plan.planRevision, "--idempotency-key", `historical-${version}-upgrade`]);
    const upgraded = record();
    for (const name of capabilities) {
      assert.equal(json(join(home, '.oats/modules', name, 'oats.json')).version, '1.32.1');
      assert.equal(upgraded.modules[name].from.version, '1.32.1');
      assert.equal(upgraded.modules[name].previous.from.version, version);
      assert.equal(upgraded.modules[name].previous.commit, oldCommit);
    }
    assert.deepEqual(awCalls(), callsBeforeUpgrade, 'neither upgrade hook calls aw');
    const events = readFileSync(join(home, ".oats-events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(events.filter(event => event.kind === "modules-upgraded").length, 1);
    return upgraded;
  };
  return { scratch, run, home, record, capabilities, upgrade };
}

for (const version of ["1.17.1", "1.31.0"]) test(`a real stopped ${version} grant seat upgrades and every start registers the newest grant home before revoking the previous grant`, {
  skip,
  timeout: 240000,
}, t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "aweb-upgrade-acceptance-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const fake = fakeAw(base), custody = join(base, "custody");
  mkdirSync(join(custody, ".aw"), { recursive: true });
  writeFileSync(join(custody, ".aw/identity.yaml"), "alias: resident-alias\n");
  const { run, home, record, capabilities, upgrade } = historicalSeat(t, { base, version, fakeBin: fake, launchConfig: "fake",
    local: `settings:\n  oats.aweb:\n    residents:\n      merlin: ${JSON.stringify(custody)}\n`,
    soul: "messaging:\n  delivery: session\n  identity:\n    mode: global\n    resident: merlin\n    renew: launch\n",
  });
  const beforeTasks = record().capabilityMeta['oats.aweb-tasks'] ?? {};
  const before = record().capabilityMeta["oats.aweb"];
  assert.equal(before.identity.mode, "global");
  assert.equal(before.delivery, "session");
  assert.ok(before.identity.grant.id);

  const awLog = join(base, "aw.log");
  const upgraded = upgrade(() => readFileSync(awLog, "utf8"));
  if (capabilities.includes('oats.aweb-tasks')) assert.deepEqual(upgraded.capabilityMeta['oats.aweb-tasks'], beforeTasks);
  assert.deepEqual(upgraded.capabilityMeta["oats.aweb"], { ...before, delivery: "session", runtime: "pi" });

  // Each start renews: it mints a grant, registers that grant's home with the
  // broker, and only then revokes the grant the previous start registered.
  let previous = before.identity.grant;
  for (const [start, args] of [["first start", ["session", "start", "--home", home]], ["restart", ["session", "restart", "--home", home]]]) {
    writeFileSync(awLog, "");
    run(args);
    const grant = record().capabilityMeta["oats.aweb"].identity.grant;
    assert.notEqual(grant.home, previous.home, `${start} minted a new grant home`);
    assert.notEqual(grant.id, previous.id, `${start} minted a new grant`);
    const calls = readFileSync(awLog, "utf8").trim().split("\n").map(line => JSON.parse(line).argv);
    const registrations = calls.filter(args => args[0] === "wake" && args[1] === "register");
    const registered = calls.findIndex(args => args[0] === "wake" && args[1] === "register" && value(args, "--identity-home") === grant.home);
    const revoked = calls.findIndex(args => args.slice(0, 3).join(" ") === "id grant revoke" && args[3] === previous.id);
    assert.ok(registered >= 0, `${start} registered the new grant home`);
    assert.ok(revoked > registered, `${start}: new grant registration precedes revocation of the previous grant`);
    assert.equal(value(registrations.at(-1), "--identity-home"), grant.home, `${start}: the final registration names the newest grant home`);
    previous = grant;
  }
});

for (const version of ["1.17.1", "1.31.0"]) test(`a real stopped ${version} local Codex seat under delivery: channel upgrades and every start registers <home>/.aw with the broker`, {
  skip,
  timeout: 240000,
}, t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "aweb-upgrade-codex-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const fake = fakeAwWake(t), fakeBin = fake.path.split(":")[0];
  // The minting root: the fake aw invites from any directory holding a .aw.
  const mintRoot = join(base, "mint-root");
  mkdirSync(join(mintRoot, ".aw"), { recursive: true });
  // Each launch appends its argv and environment, then sleeps like a session.
  const launches = join(base, "launches.jsonl"), harness = join(base, "codex-harness");
  writeFileSync(harness, `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(launches)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env }) + "\\n");\nsetTimeout(() => {}, 3600000);\n`);
  chmodSync(harness, 0o755);
  const launchRecords = () => existsSync(launches) ? readFileSync(launches, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
  // The harness runs in its tmux pane after oats returns: wait for its record.
  const launchedAfter = (count) => {
    for (let waited = 0; launchRecords().length <= count && waited < 15000; waited += 100) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    return launchRecords().slice(count);
  };
  const { run, home, record, upgrade } = historicalSeat(t, { base, version, fakeBin, launchConfig: "codex-fake",
    local: `  codex-fake:\n    harness: codex\n    executable: ${JSON.stringify(harness)}\nsettings:\n  oats.aweb:\n    root: ${JSON.stringify(mintRoot)}\n`,
    soul: "messaging:\n  delivery: channel\n",
  });
  const identityHome = join(home, ".aw");
  const before = record().capabilityMeta["oats.aweb"];
  assert.equal(before.identity.mode, "local");
  assert.equal(before.delivery, "channel");
  assert.equal(before.runtime, "codex");
  assert.ok(existsSync(identityHome), "spawn minted the local identity in <home>/.aw");
  const registersHome = args => args[0] === "wake" && args[1] === "register" && value(args, "--home") === home;
  if (version === "1.17.1") assert.equal(fake.readCalls().some(c => registersHome(c.args)), false, "1.17.1 never registers a Codex home under delivery: channel");

  upgrade(() => fake.readCalls());
  // Every start of the upgraded seat hands <home>/.aw to the broker as a
  // session home, and launches Codex with session delivery and no channel.
  for (const [start, args] of [["first start", ["session", "start", "--home", home]], ["restart", ["session", "restart", "--home", home]]]) {
    const callsBefore = fake.readCalls().length, launchesBefore = launchRecords().length;
    run(args);
    const registrations = fake.readCalls().slice(callsBefore).map(c => c.args).filter(registersHome);
    assert.ok(registrations.length >= 1, `${start} registered the home with the broker`);
    for (const registration of registrations) {
      assert.equal(value(registration, "--identity-home"), identityHome, `${start} registers <home>/.aw`);
      assert.equal(value(registration, "--delivery"), "session", `${start} registers a session home`);
    }
    const launched = launchedAfter(launchesBefore);
    assert.equal(launched.length, 1, `${start} launched the harness once`);
    assert.equal(launched[0].env.AWEB_DELIVERY, "session", `${start} launches with AWEB_DELIVERY=session`);
    assert.equal(launched[0].argv.some(arg => /channels/.test(arg)), false, `${start} passes no channel launch flag: ${launched[0].argv.join(" ")}`);
    assert.equal(record().capabilityMeta["oats.aweb"].runtime, "codex");
  }
});
