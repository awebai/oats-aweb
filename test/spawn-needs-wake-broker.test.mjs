// A home the host wake broker delivers to is woken only by a running broker.
// `aw wake register` stores the registration and exits 0 with none running, so
// a start there would succeed and the agent would never hear a message.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./helpers/delivery-fixture.mjs";
import { WAKE_BROKER_RECHECK_MS, wakeBrokerRefusal, wakeDaemonAssessment, wakeDaemonRunning } from "../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs";

const REFUSAL = /^oats-aweb: wake-daemon-not-running: /;
const awCalls = (fx) => fx.fake.readCalls().map((c) => c.args.slice(0, 2).join(" "));

test("the refusal and readiness read one fact from the same status", () => {
  for (const status of [undefined, null, "up", {}, { daemon_running: false }, { daemon_running: "true" }, { daemon_version_state: "reported" }, { daemon_running: true }]) {
    const readiness = wakeDaemonAssessment(status, { minimumVersion: "1.36.33" }).problems.map((p) => p.code);
    assert.equal(wakeDaemonRunning(status), !readiness.some((code) => ["wake-daemon-not-running", "wake-status-unavailable"].includes(code)), JSON.stringify(status));
  }
});

test("a running broker is not refused, and is read once", () => {
  const waits = [];
  let reads = 0;
  assert.equal(wakeBrokerRefusal({ readStatus: () => { reads++; return { daemon_running: true }; }, wait: (ms) => waits.push(ms), serviceManager: true }), undefined);
  assert.deepEqual([reads, waits], [1, []]);
});

test("a broker that is down is read again once, after the bounded wait", () => {
  const waits = [];
  let reads = 0;
  const up = wakeBrokerRefusal({ readStatus: () => ({ daemon_running: ++reads > 1 }), wait: (ms) => waits.push(ms), serviceManager: true });
  assert.equal(up, undefined);
  assert.deepEqual([reads, waits], [2, [WAKE_BROKER_RECHECK_MS]]);
  assert.ok(WAKE_BROKER_RECHECK_MS <= 5000, "a few seconds, not a retry loop");

  reads = 0;
  const down = wakeBrokerRefusal({ readStatus: () => { reads++; return undefined; }, wait: () => {}, serviceManager: true });
  assert.equal(reads, 2, "one re-check only");
  assert.match(down, /^wake-daemon-not-running: /);
});

test("the refusal names the start for this host inside the hook's 300 characters", () => {
  const down = { readStatus: () => ({ daemon_running: false }), wait: () => {} };
  const managed = wakeBrokerRefusal({ ...down, serviceManager: true });
  const bare = wakeBrokerRefusal({ ...down, serviceManager: false });
  assert.match(managed, /`oats aweb wake install`/);
  assert.doesNotMatch(managed, /aw wake run/);
  assert.match(bare, /`aw wake run`/);
  assert.doesNotMatch(bare, /wake install/);
  for (const text of [managed, bare]) assert.ok(text.length <= 300, `${text.length}: ${text}`);
});

test("session delivery: a spawn with no broker running is refused before any identity exists", (t) => {
  for (const runtime of ["claude", "codex"]) {
    const fx = fixture(t, { delivery: "session", runtime, daemon: false });
    const r = fx.hook("spawn");
    assert.notEqual(r.status, 0, runtime);
    assert.match(r.doc.warning, REFUSAL, runtime);
    assert.deepEqual(awCalls(fx).filter((c) => c !== "version"), ["wake status", "wake status"], `${runtime}: nothing but the two status reads`);
    assert.equal(fx.registered(), undefined, runtime);
  }
});

test("channel delivery: a runtime with no channel of its own is refused the same way", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "codex", daemon: false });
  const r = fx.hook("spawn");
  assert.notEqual(r.status, 0);
  assert.match(r.doc.warning, REFUSAL);
});

test("channel delivery: a runtime with its own channel never asks about the broker", (t) => {
  for (const runtime of ["claude", "pi"]) {
    const fx = fixture(t, { delivery: "channel", runtime, daemon: false });
    const r = fx.hook("spawn");
    assert.equal(r.status, 0, runtime + r.stdout + r.stderr);
    assert.doesNotMatch(String(r.doc.warning || ""), /wake-daemon-not-running/, runtime);
    assert.deepEqual(fx.wakeCalls(), [], runtime);
  }
});

test("a broker that comes up within the re-check is not refused", (t) => {
  const fx = fixture(t, { delivery: "session", runtime: "codex" });
  const r = fx.hook("spawn", { FAKE_DAEMON_DOWN_READS: "1" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fx.wakeCalls().slice(0, 3), ["status", "status", "register"]);
  assert.ok(fx.registered());
});

test("a start of an existing home is refused the same way, and its preview changes and asks nothing", (t) => {
  const fx = fixture(t, { delivery: "session", runtime: "codex" });
  const meta = fx.spawn().meta;
  const before = fx.fake.readCalls().length;

  const preview = fx.launch(meta, "codex", { extra: { FAKE_DAEMON_DOWN: "1", OATS_LAUNCH_PREVIEW: "1" } });
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.equal(fx.fake.readCalls().length, before, "a preview makes no aw call");

  const r = fx.launch(meta, "codex", { extra: { FAKE_DAEMON_DOWN: "1" } });
  assert.notEqual(r.status, 0);
  assert.match(r.doc.warning, REFUSAL);

  const channel = fixture(t, { delivery: "channel", runtime: "claude" });
  const started = channel.launch(channel.spawn().meta, "claude", { extra: { FAKE_DAEMON_DOWN: "1" } });
  assert.equal(started.status, 0, started.stdout + started.stderr);
});
