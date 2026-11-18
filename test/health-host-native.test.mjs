// The publisher's host calls against the real binaries: the kernel on PATH in
// a scratch deployment it runs itself (helpers/scratch-deployment.mjs), and
// the real aw. Opt in with OATS_AWEB_HEALTH_NATIVE=1 and the pinned kernel
// and aw paths CI supplies. Identity observations live in the disposable
// real-stack journeys; signing vectors live in health-status-native.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AW_STATUS_MIN, healthHost } from "../oats-package/capabilities/oats-aweb/lib/health-host.mjs";
import { versionAtLeast } from "../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs";
import { createScratchDeployment } from "./helpers/scratch-deployment.mjs";

const NATIVE = process.env.OATS_AWEB_HEALTH_NATIVE === "1";
const skip = NATIVE ? false : "set OATS_AWEB_HEALTH_NATIVE=1 to run against the real oats, tmux and aw";
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

  await t.test("liveness tells a live harness, a crash, an intended stop and a home never launched apart; a live one's events are not read", async () => {
    const of = async (instance, home) => host.liveness({ instance, home });
    assert.deepEqual(await of("h-live", live), { state: "alive", lastEvent: null });
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

// Real local/global identity and provider-readiness checks use the disposable
// homes minted by resident-journey.test.mjs, never external live paths.

test("identityOf answers null for a directory that holds no identity", { skip }, async () => {
  const empty = mkdtempSync(join(tmpdir(), "aweb-health-empty-"));
  try {
    assert.equal(await healthHost({ deployment: empty, env: { PATH: process.env.PATH, HOME: empty } }).identityOf({ cwd: empty }), null);
  } finally { rmSync(empty, { recursive: true, force: true }); }
});

test("awSupportsStatus agrees with the installed aw's version, and names it when it cannot publish", { skip }, async () => {
  const version = spawnSync("aw", ["version"], { encoding: "utf8" }).stdout.match(/^aw (\S+)$/m)?.[1] ?? "unknown";
  const answer = await healthHost({ deployment: tmpdir(), env: { PATH: process.env.PATH, HOME: process.env.HOME } }).awSupportsStatus();
  assert.equal(answer.ok, versionAtLeast(version, AW_STATUS_MIN));
  if (answer.ok) assert.equal(spawnSync("aw", ["status", "publish", "--help"]).status, 0, "an aw at the floor has status publish");
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

test("the refusal log keeps one older generation once it passes 1 MiB, so it never grows without bound", { skip: false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "aweb-health-log-"));
  try {
    const host = healthHost({ deployment: dir, env: {} });
    const log = join(dir, ".oats-aweb", "health", "log.jsonl");
    await host.log({ at: "2026-10-14T16:00:00Z", code: "first" });
    writeFileSync(log, `${readFileSync(log, "utf8")}${"x".repeat(1024 * 1024)}\n`);
    await host.log({ at: "2026-10-14T16:01:00Z", code: "after" });
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l).code), ["after"]);
    assert.match(readFileSync(`${log}.1`, "utf8"), /"code":"first"/);
    assert.equal(statSync(log).mode & 0o777, 0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("refusals logged at once while the log crosses its cap all land, and the older generation survives", { skip: false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "aweb-health-log-"));
  try {
    const host = healthHost({ deployment: dir, env: {} });
    const log = join(dir, ".oats-aweb", "health", "log.jsonl");
    await host.log({ at: "2026-10-14T16:00:00Z", code: "first" });
    writeFileSync(log, `${readFileSync(log, "utf8")}${"x".repeat(1024 * 1024)}\n`);
    await Promise.all(["a", "b", "c", "d"].map((code) => host.log({ at: "2026-10-14T16:01:00Z", code })));
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l).code).sort(), ["a", "b", "c", "d"]);
    assert.match(readFileSync(`${log}.1`, "utf8"), /"code":"first"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("receipt reads <identity dir>/receive/stream.json, null when absent or unreadable; pidAlive asks the process table", { skip: false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "aweb-health-receipt-"));
  try {
    const host = healthHost({ deployment: dir, env: {} });
    assert.equal(await host.receipt(dir), null);
    mkdirSync(join(dir, "receive"));
    const receipt = { v: 1, kind: "claude-channel", did: "did:key:z6MkX", pid: process.pid, opened_at: "2026-10-14T15:00:00Z", heartbeat_at: "2026-10-14T16:00:00Z" };
    writeFileSync(join(dir, "receive", "stream.json"), JSON.stringify(receipt));
    assert.deepEqual(await host.receipt(dir), receipt);
    writeFileSync(join(dir, "receive", "stream.json"), "{half");
    assert.equal(await host.receipt(dir), null);
    assert.equal(host.pidAlive(process.pid), true);
    const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout;
    assert.equal(host.pidAlive(Number(gone)), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
