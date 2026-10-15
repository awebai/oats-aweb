// The publisher's host calls against the real binaries: the kernel on PATH in
// a scratch deployment it runs itself (helpers/scratch-deployment.mjs), and
// the real aw. Opt in with OATS_AWEB_HEALTH_NATIVE=1 (needs oats, tmux and aw
// on PATH). The aw identity reads also need a real identity home and resident
// custody root, given read-only as OATS_AWEB_HEALTH_IDENTITY_HOME and
// OATS_AWEB_HEALTH_RESIDENT_ROOT; nothing here writes to them.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AW_STATUS_MIN, healthHost } from "../oats-package/capabilities/oats-aweb/lib/health-host.mjs";
import { createScratchDeployment } from "./helpers/scratch-deployment.mjs";

const NATIVE = process.env.OATS_AWEB_HEALTH_NATIVE === "1";
const skip = NATIVE ? false : "set OATS_AWEB_HEALTH_NATIVE=1 to run against the real oats, tmux and aw";
const awJson = (args, cwd) => JSON.parse(spawnSync("aw", args, { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, AW_NO_UPDATE_CHECK: "1" } }).stdout);

test("kernel surfaces in a scratch deployment", { skip }, async (t) => {
  const scratch = createScratchDeployment();
  t.after(() => scratch.dispose());
  const live = scratch.spawn("h-live"), crashed = scratch.spawn("h-crash"), stopped = scratch.spawn("h-stop"), idle = scratch.spawn("h-idle", { launch: false });
  scratch.stop("h-stop");
  scratch.crash("h-crash");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const host = healthHost({ deployment: scratch.deployment, env: scratch.env });

  await t.test("status lists every home with its launch record", async () => {
    const rows = (await host.status()).agents.flatMap((a) => a.instances ?? []);
    assert.deepEqual(rows.map((r) => [r.instance, r.home, r.launched]).sort(), [["h-crash", crashed, true], ["h-idle", idle, false], ["h-live", live, true], ["h-stop", stopped, true]]);
  });

  await t.test("liveness tells a live harness, a crash, an intended stop and a home never launched apart", async () => {
    const of = async (instance, home) => host.liveness({ instance, home });
    assert.deepEqual(await of("h-live", live), { state: "alive", lastEvent: "launched" });
    assert.deepEqual(await of("h-crash", crashed), { state: "shell", lastEvent: "launched" });
    assert.deepEqual(await of("h-stop", stopped), { state: "shell", lastEvent: "stopped" });
    assert.deepEqual(await of("h-idle", idle), { state: "not-launched", lastEvent: null });
  });

  await t.test("readiness of a home with no oats.aweb provider item is null", async () => {
    assert.equal(await host.readiness(live), null);
  });

  await t.test("a tmux server that is gone (a reboot) is a session not running, not an unobservable one", async () => {
    scratch.killTmux();
    assert.deepEqual(await host.liveness({ instance: "h-live", home: live }), { state: "stopped", lastEvent: "launched" });
  });
});

test("readiness relays the oats.aweb provider result of a real home", { skip: skip || (!process.env.OATS_AWEB_HEALTH_IDENTITY_HOME && "set OATS_AWEB_HEALTH_IDENTITY_HOME to a real <home>/.aw") }, async () => {
  const home = join(process.env.OATS_AWEB_HEALTH_IDENTITY_HOME, "..");
  const result = await healthHost({ deployment: home, env: { PATH: process.env.PATH, HOME: process.env.HOME } }).readiness(home);
  assert.ok(["ready", "needs-configuration", "authorization-required", "unavailable"].includes(result.status), JSON.stringify(result));
  assert.ok(Array.isArray(result.problems) && Array.isArray(result.warnings));
});

test("identityOf reads a local identity's did:key offline, the same did aw whoami reports", { skip: skip || (!process.env.OATS_AWEB_HEALTH_IDENTITY_HOME && "set OATS_AWEB_HEALTH_IDENTITY_HOME to a real <home>/.aw") }, async () => {
  const identityHome = process.env.OATS_AWEB_HEALTH_IDENTITY_HOME;
  const ids = await healthHost({ deployment: tmpdir(), env: { PATH: process.env.PATH, HOME: process.env.HOME } }).identityOf({ identityHome });
  assert.equal(ids.did, awJson(["--identity-home", identityHome, "whoami", "--json"], tmpdir()).did);
  assert.match(ids.did, /^did:key:z/);
  assert.equal(ids.stable_id, undefined);
});

test("identityOf reads a resident's did:key and did:aw offline from its custody root", { skip: skip || (!process.env.OATS_AWEB_HEALTH_RESIDENT_ROOT && "set OATS_AWEB_HEALTH_RESIDENT_ROOT to a real resident custody root") }, async () => {
  const cwd = process.env.OATS_AWEB_HEALTH_RESIDENT_ROOT;
  const ids = await healthHost({ deployment: tmpdir(), env: { PATH: process.env.PATH, HOME: process.env.HOME } }).identityOf({ cwd });
  const who = awJson(["whoami", "--json"], cwd);
  assert.deepEqual(ids, { did: who.did, stable_id: who.stable_id });
  assert.match(ids.stable_id, /^did:aw:/);
});

test("identityOf answers null for a directory that holds no identity", { skip }, async () => {
  const empty = mkdtempSync(join(tmpdir(), "aweb-health-empty-"));
  try {
    assert.equal(await healthHost({ deployment: empty, env: { PATH: process.env.PATH, HOME: empty } }).identityOf({ cwd: empty }), null);
  } finally { rmSync(empty, { recursive: true, force: true }); }
});

test("awSupportsStatus agrees with the installed aw, and names its version when it cannot publish", { skip }, async () => {
  const help = spawnSync("aw", ["status", "publish", "--help"], { encoding: "utf8" });
  const version = spawnSync("aw", ["version"], { encoding: "utf8" }).stdout.match(/aw (\d+\.\d+\.\d+)/)[1];
  const answer = await healthHost({ deployment: tmpdir(), env: { PATH: process.env.PATH, HOME: process.env.HOME } }).awSupportsStatus();
  assert.equal(answer.ok, help.status === 0);
  if (!answer.ok) assert.equal(answer.message, `aw ${version} has no status publish; needs aw >= ${AW_STATUS_MIN} (aweb-acah.3.1)`);
});

test("the cache is written atomically, owner-only, and read back", { skip: false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "aweb-health-cache-"));
  try {
    const host = healthHost({ deployment: dir, env: {} });
    const file = join(dir, "home", ".oats-aweb", "health.json");
    assert.equal(await host.readCache(file), null);
    await host.writeCache(file, { t: { agent: "did:key:z1", designated: true } });
    assert.deepEqual(await host.readCache(file), { t: { agent: "did:key:z1", designated: true } });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    writeFileSync(file, "{broken");
    assert.equal(await host.readCache(file), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the refusal log appends one JSON line per refusal under the deployment", { skip: false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "aweb-health-log-"));
  try {
    const host = healthHost({ deployment: dir, env: {} });
    await host.log({ at: "2026-10-14T16:00:00Z", alias: "a", status: 409, code: "stale_seq", message: "m", retry_after: null });
    await host.log({ at: "2026-10-14T16:01:00Z", alias: "a", status: 429, code: "rate_limited", message: "m", retry_after: 5 });
    const lines = readFileSync(join(dir, ".oats-aweb", "health", "log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.code), ["stale_seq", "rate_limited"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
