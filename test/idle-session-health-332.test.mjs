// #332: under session delivery an idle, healthy home stays `yes`, and every
// broken precondition still reads not-yes with its reason. The broker
// inspects a session only at startup and before a delivery (aw v1.36.59,
// wake/channel_core_runner_entry.ts:131-143), so an idle home's inspection
// ages without a fault, while its snapshot is rewritten every 2 s
// (wake/broker.go:32). Each case here runs a broker status through readiness
// (targetReceiveAssessment) and then the publisher's vocabulary, with the
// home's inspection 10 minutes old.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { targetReceiveAssessment } from "../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs";
import { assessHealth } from "../oats-package/capabilities/oats-aweb/lib/health-vocabulary.mjs";

const NOW = Date.parse("2026-11-25T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const IDLE = NOW - 10 * 60 * 1000;

function home(t) {
  const dir = mkdtempSync(join(tmpdir(), "oats-aweb-332-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const primary = join(dir, ".aw");
  mkdirSync(primary);
  return { dir, primary };
}

/** aw wake status for one healthy idle home: snapshot just written, its one
 *  inspection made at start, ten minutes ago, and nothing since. */
function idleStatus({ dir, primary }) {
  return {
    updated_at: iso(NOW - 1000), daemon_running: true, daemon_version_state: "reported", daemon_version: "1.36.59",
    instances: [{
      home: dir, identity_home: primary, runtime_delivery: "external-session", delivery: "session", phase: "active", paused: false,
      receive_identities: [{ identity_home: primary, delivery_owner: "session-hints", controls: true, stream_admitted: true, stream_phase: "streaming" }],
      last_state: "unknown", last_inspect_at: iso(IDLE),
      channel_core: { running: true, readiness_state: "unknown", readiness_waiting: "inspect_done" },
    }],
  };
}

const expected = ({ dir, primary }) => ({ home: dir, runtimeDelivery: "external-session", capturedDelivery: "session", primary, bindings: [{ identity_home: primary, controls: true, event_classes: [] }] });

/** The provider's readiness answer for that status, as the publisher reads it. */
function readiness(status, h) {
  const { problems, warnings } = targetReceiveAssessment(status, expected(h), { minimumVersion: "1.36.33", now: NOW });
  return { status: problems.length ? "unavailable" : "ready", problems, warnings };
}

const alive = { state: "alive", lastEvent: "launched" };
const sessionHome = { now: NOW, liveness: alive, launchPrompts: null, grant: null, identity: { kind: "primary" }, receive: { native: false, receipt: "absent" } };
const verdict = (over) => { const h = assessHealth({ ...sessionHome, ...over }); return [h.reachable, h.reason?.code ?? null]; };

test("an idle, healthy home's inspection ages under its own code, and the snapshot stays fresh", (t) => {
  const h = home(t);
  const answer = readiness(idleStatus(h), h);
  assert.deepEqual(answer.problems, []);
  assert.deepEqual(answer.warnings.map((w) => w.code), ["receive-inspection-aged"]);
  assert.match(answer.warnings[0].message, /broker inspection is 600 seconds old .*at startup and before each delivery/);
});

test("an idle, healthy home is published yes past 30 s, however long it stays idle", (t) => {
  const h = home(t);
  for (const minutes of [0.6, 10, 600]) {
    const status = idleStatus(h);
    status.instances[0].last_inspect_at = iso(NOW - minutes * 60 * 1000);
    assert.deepEqual(verdict({ readiness: readiness(status, h) }), ["yes", null], String(minutes));
  }
});

test("a broker that stops writing its snapshot still reads degraded: the snapshot ages against its 2 s cadence", (t) => {
  const h = home(t);
  const status = idleStatus(h);
  status.updated_at = iso(NOW - 31000);
  const answer = readiness(status, h);
  assert.ok(answer.warnings.some((w) => w.code === "receive-observation-aged" && /broker snapshot observation is 31 seconds old/.test(w.message)), JSON.stringify(answer));
  assert.deepEqual(verdict({ readiness: answer }), ["degraded", "oats.receive_unproven"]);
});

// Each broken precondition, on a home whose inspection has aged: the reason
// is the precondition's own, never hidden behind the idle home's age.
const BROKEN = [
  ["broker down", (s) => { s.daemon_running = false; }, ["no", "oats.wake_broker_down"]],
  ["broker version unknown", (s) => { s.daemon_version_state = "unknown"; delete s.daemon_version; }, ["unknown", "oats.receive_unknown"]],
  ["broker worker stopped", (s) => { s.instances[0].channel_core.running = false; }, ["no", "oats.wake_broker_down"]],
  ["receive stream not admitted", (s) => { s.instances[0].receive_identities[0].stream_admitted = false; }, ["no", "oats.wake_broker_down"]],
  ["receive stream not streaming", (s) => { s.instances[0].receive_identities[0].stream_phase = "stopped"; }, ["no", "oats.wake_broker_down"]],
  ["registration missing", (s) => { s.instances = []; }, ["no", "oats.wake_not_registered"]],
  ["registration inactive", (s) => { s.instances[0].phase = "inactive"; }, ["no", "oats.wake_not_registered"]],
  ["registration stale: another identity", (s) => { s.instances[0].identity_home = "/elsewhere/.aw"; }, ["no", "oats.wake_not_registered"]],
  ["registration stale: another receive set", (s) => { s.instances[0].receive_identities[0].identity_home = "/elsewhere/.aw"; }, ["no", "oats.wake_not_registered"]],
  ["registration paused", (s) => { s.instances[0].paused = true; }, ["no", "oats.wake_paused"]],
  ["broker's last inspection found the session stopped", (s) => { s.instances[0].last_state = "stopped"; s.instances[0].channel_core.readiness_state = "stopped"; }, ["unknown", "oats.receive_unknown"]],
  ["broker's last inspection failed", (s) => { s.instances[0].channel_core.readiness_waiting = "inspect_error"; }, ["unknown", "oats.receive_unknown"]],
];

for (const [name, breakIt, want] of BROKEN) test(`an idle home with a broken precondition still reads its reason: ${name}`, (t) => {
  const h = home(t);
  const status = idleStatus(h);
  breakIt(status);
  assert.deepEqual(verdict({ readiness: readiness(status, h) }), want);
});

test("an outdated broker still receives and stays yes, as the design records, idle or not", (t) => {
  const h = home(t);
  const status = idleStatus(h);
  status.daemon_version = "1.36.20";
  const answer = readiness(status, h);
  assert.deepEqual(answer.warnings.map((w) => w.code).sort(), ["receive-inspection-aged", "wake-daemon-outdated"]);
  assert.deepEqual(verdict({ readiness: answer }), ["yes", null]);
});

test("a session that is gone reads no from the publisher's own fresh inspection, whatever the broker retained", (t) => {
  const h = home(t);
  const answer = readiness(idleStatus(h), h);
  assert.deepEqual(verdict({ liveness: { state: "stopped", lastEvent: "launched" }, readiness: answer }), ["no", "oats.not_running"]);
  assert.deepEqual(verdict({ liveness: { state: "shell", lastEvent: "restarted" }, readiness: answer }), ["no", "oats.not_running"]);
  assert.deepEqual(verdict({ liveness: { state: "stopped", lastEvent: "stopped" }, readiness: answer }), ["no", "oats.stopped"]);
  assert.deepEqual(verdict({ liveness: { state: "unobservable", lastEvent: "launched" }, readiness: answer }), ["unknown", "oats.session_unobservable"]);
});

test("a grant condition on an idle seat still reads its reason", (t) => {
  const h = home(t);
  const idle = readiness(idleStatus(h), h);
  const withProblem = (code) => ({ ...idle, status: "unavailable", problems: [{ code, message: code }] });
  assert.deepEqual(verdict({ readiness: withProblem("grant-expired") }), ["no", "oats.grant_expired"]);
  assert.deepEqual(verdict({ readiness: withProblem("grant-revoked") }), ["no", "oats.grant_revoked"]);
  assert.deepEqual(verdict({ readiness: withProblem("custody") }), ["no", "oats.custody_down"]);
  const expiring = { ...idle, warnings: [...idle.warnings, { code: "grant-expiring", message: "x" }] };
  assert.deepEqual(verdict({ readiness: expiring, grant: { expiresAt: iso(NOW + 3600 * 1000) } }), ["degraded", "oats.grant_expiring"]);
});
