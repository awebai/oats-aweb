// The OATS vocabulary of aweb-acah.3: one home's kernel state and provider
// readiness become reachable, reason and fixing, by the table in
// docs/design/2026-10-14-agent-health-publisher.md §2 (first matching row
// wins). Phrases are fixed per code and language; a readiness message never
// reaches the document.
import test from "node:test";
import assert from "node:assert/strict";
import { assessHealth, combineSeats, PHRASES } from "../oats-package/capabilities/oats-aweb/lib/health-vocabulary.mjs";
import { checkDocument } from "../oats-package/capabilities/oats-aweb/lib/status-document.mjs";

const NOW = Date.parse("2026-10-14T16:00:00Z");
const HOUR = 3600000;
const ready = { status: "ready", problems: [], warnings: [] };
const alive = { state: "alive", lastEvent: "launched" };
const base = { now: NOW, liveness: alive, launchPrompts: { status: "completed" }, readiness: ready, grant: null, identity: { kind: "primary" }, receive: { native: true, receipt: "absent" } };
const problem = (code, status = "unavailable") => ({ status, problems: [{ code, message: `/Users/someone/secret/path ${code}` }], warnings: [] });
const warning = (code) => ({ status: "ready", problems: [], warnings: [{ code, message: `host.example ${code}` }] });
const verdict = (over) => { const h = assessHealth({ ...base, ...over }); return [h.reachable, h.reason?.code ?? null, h.fixing?.by ?? null]; };

const ROWS = [
  ["intended stop", { liveness: { state: "stopped", lastEvent: "stopped" } }, ["no", "oats.stopped", "nobody"]],
  ["never launched", { liveness: { state: "not-launched", lastEvent: null }, launchPrompts: null }, ["no", "oats.not_started", "operator"]],
  ["crashed: fallback shell after launched", { liveness: { state: "shell", lastEvent: "launched" } }, ["no", "oats.not_running", "operator"]],
  ["tmux gone after restart", { liveness: { state: "stopped", lastEvent: "restarted" } }, ["no", "oats.not_running", "operator"]],
  ["session unobservable", { liveness: { state: "unobservable", lastEvent: "launched" } }, ["unknown", "oats.session_unobservable", "unknown"]],
  ["launch prompt blocked", { launchPrompts: { status: "blocked" } }, ["no", "oats.launch_prompt_waiting", "operator"]],
  ["channel flag ignored", { launchPrompts: { status: "flag-ignored" }, readiness: warning("claude-channels-unavailable") }, ["no", "oats.channel_not_loaded", "operator"]],
  ["channel flag ignored says nothing of a joined identity, which the broker wakes", { launchPrompts: { status: "flag-ignored" }, identity: { kind: "joined", receive: "native" }, receive: { native: false, receipt: "absent" } }, ["yes", null, null]],
  ["readiness failed", { readiness: null }, ["unknown", "oats.readiness_unavailable", "unknown"]],
  ["needs configuration", { readiness: problem("needs-configuration", "needs-configuration") }, ["no", "oats.needs_configuration", "operator"]],
  ["authorization required", { readiness: { status: "authorization-required", problems: [], warnings: [] } }, ["no", "oats.authorization_required", "operator"]],
  ["custody", { readiness: problem("custody", "needs-configuration") }, ["no", "oats.custody_down", "operator"]],
  ["grant expired", { readiness: problem("grant-expired") }, ["no", "oats.grant_expired", "operator"]],
  ["grant revoked", { readiness: problem("grant-revoked") }, ["no", "oats.grant_revoked", "operator"]],
  ...["wake-daemon-not-running", "wake-status-unavailable", "wake-stream-unavailable", "wake-worker-unavailable"].map((c) => [c, { readiness: problem(c) }, ["no", "oats.wake_broker_down", "operator"]]),
  ...["wake-target-missing", "wake-stream-missing", "wake-target-inactive", "wake-target-binding", "receive-record-unavailable"].map((c) => [c, { readiness: problem(c) }, ["no", "oats.wake_not_registered", "operator"]]),
  ["wake target paused", { readiness: problem("wake-target-paused") }, ["no", "oats.wake_paused", "operator"]],
  ...["receive-inspection-unproven", "wake-status-stale", "wake-daemon-version-unknown"].map((c) => [c, { readiness: problem(c) }, ["unknown", "oats.receive_unknown", "unknown"]]),
  ["an unknown problem code", { readiness: problem("something-new") }, ["unknown", "oats.unclassified", "unknown"]],
  ["grant expiring within 24 h", { readiness: warning("grant-expiring"), grant: { expiresAt: new Date(NOW + 23 * HOUR).toISOString() } }, ["degraded", "oats.grant_expiring", "operator"]],
  ["grant expiring in 3 days is still yes", { readiness: warning("grant-expiring"), grant: { expiresAt: new Date(NOW + 72 * HOUR).toISOString() } }, ["yes", null, null]],
  ...["receive-ownership-unproven", "receive-observation-aged", "receive-observation-unproven"].map((c) => [c, { readiness: warning(c) }, ["degraded", "oats.receive_unproven", "unknown"]]),
  ["native receive unproven, channel loaded after a confirmed prompt", { readiness: warning("native-receive-unproven") }, ["yes", null, null]],
  ["native receive unproven, approved mode never engages a prompt", { readiness: warning("native-receive-unproven"), launchPrompts: { status: "not-engaged" } }, ["yes", null, null]],
  ["native receive unproven, no record that the channel loaded", { readiness: warning("native-receive-unproven"), launchPrompts: null }, ["unknown", "oats.receive_unknown", "unknown"]],
  ["native receive unproven, prompt incomplete", { readiness: warning("native-receive-unproven"), launchPrompts: { status: "incomplete" } }, ["unknown", "oats.receive_unknown", "unknown"]],
  ["warnings that do not affect receive", { readiness: { status: "ready", problems: [], warnings: ["e2ee-disabled", "wake-daemon-outdated", "grant-revoke-pending", "channel-dev-confirmation", "claude-channel-policy-admitted"].map((code) => ({ code, message: "x" })) } }, ["yes", null, null]],
  ["a joined-team warning does not degrade the primary identity", { readiness: warning("joined-team-poll-only") }, ["yes", null, null]],
  ["a joined identity that polls", { identity: { kind: "joined", receive: "poll" } }, ["degraded", "oats.joined_team_poll_only", "operator"]],
  ["a joined identity with native receive", { identity: { kind: "joined", receive: "native" } }, ["yes", null, null]],
  ["all good", {}, ["yes", null, null]],
  ["a native home with a live receipt has proven receive, even with no record that the channel loaded", { readiness: warning("native-receive-unproven"), launchPrompts: null, receive: { native: true, receipt: "proven" } }, ["yes", null, null]],
  ["a native home whose receipt went stale has lost its stream", { readiness: warning("native-receive-unproven"), receive: { native: true, receipt: "stale" } }, ["no", "oats.channel_stream_down", "operator"]],
  ["session delivery has no receipt, and that proves nothing missing", { launchPrompts: null, receive: { native: false, receipt: "absent" } }, ["yes", null, null]],
  ["session delivery is judged by the broker rows, not by a receipt", { readiness: problem("wake-daemon-not-running"), receive: { native: false, receipt: "absent" } }, ["no", "oats.wake_broker_down", "operator"]],
];

for (const [name, over, expected] of ROWS) test(`row: ${name}`, () => assert.deepEqual(verdict(over), expected));

test("the first matching row wins: a stopped home with a custody problem is stopped", () => {
  assert.deepEqual(verdict({ liveness: { state: "stopped", lastEvent: "stopped" }, readiness: problem("custody") }), ["no", "oats.stopped", "nobody"]);
});

test("texts come from the phrase table, never from a readiness message", () => {
  const h = assessHealth({ ...base, readiness: problem("custody") });
  assert.deepEqual(h, { reachable: "no", reason: { code: "oats.custody_down", text: PHRASES.en.reasons["oats.custody_down"] }, fixing: { by: "operator", text: "Its operator" } });
  assert.ok(!JSON.stringify(h).includes("/Users/"));
});

test("fixing.text names the deployment's operator role; unknown carries no text; nobody says it was on purpose", () => {
  assert.deepEqual(assessHealth({ ...base, readiness: problem("custody"), operator: "Nactiva's operator" }).fixing, { by: "operator", text: "Nactiva's operator" });
  assert.deepEqual(assessHealth({ ...base, readiness: null }).fixing, { by: "unknown" });
  assert.deepEqual(assessHealth({ ...base, liveness: { state: "stopped", lastEvent: "stopped" } }).fixing, { by: "nobody", text: PHRASES.en.nobody });
});

test("an unknown language falls back to en", () => {
  assert.deepEqual(assessHealth({ ...base, readiness: problem("custody"), language: "xx-YY" }).reason.text, PHRASES.en.reasons["oats.custody_down"]);
});

test("every phrase fits the document's caps, and every code the table can produce has a phrase", () => {
  const doc = (reason, fixing) => ({ v: 1, type: "agent_status", team_id: "t:example.test", agent: "did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd", publisher_did: "did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd", seq: NOW, reachable: "no", reason, fixing, observed_at: "2026-10-14T16:00:00Z", valid_until: "2026-10-14T16:05:00Z" });
  for (const [code, text] of Object.entries(PHRASES.en.reasons)) assert.deepEqual(checkDocument(doc({ code, text }, { by: "nobody", text: PHRASES.en.nobody }), { now: NOW }), { ok: true }, code);
  const produced = new Set(ROWS.map(([, over]) => assessHealth({ ...base, ...over }).reason?.code).filter(Boolean));
  for (const code of produced) assert.ok(PHRASES.en.reasons[code], code);
});

test("a resident's seats combine to the best seat: yes, then degraded, then no, then unknown", () => {
  const no = assessHealth({ ...base, readiness: problem("custody") });
  const unknown = assessHealth({ ...base, readiness: null });
  const degraded = assessHealth({ ...base, readiness: warning("receive-observation-aged") });
  const yes = assessHealth(base);
  assert.equal(combineSeats([unknown, no, degraded]), degraded);
  assert.equal(combineSeats([unknown, no]), no);
  assert.equal(combineSeats([no, yes, degraded]), yes);
  assert.equal(combineSeats([unknown]), unknown);
});

test("authorization-required comes before custody and the wake rows, as the table orders them", () => {
  assert.deepEqual(verdict({ readiness: { status: "authorization-required", problems: [{ code: "custody", message: "x" }], warnings: [] } }), ["no", "oats.authorization_required", "operator"]);
});
