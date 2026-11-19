// A launch whose OATS_BACKEND names a session provider (anything but `tmux`
// or unset) is delivered by the host wake broker, whatever `delivery` and the
// runtime say: the provider starts the session, so no channel launch argument
// reaches it. `aw wake register --backend` takes only aw's own terminal
// backends (tmux, herdr), so a provider's name is never passed there.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "./helpers/delivery-fixture.mjs";
import { brokerDelivers, joinedTeamsPolled, recordedBackend, runtimeDeliveryFor, sessionProviderBackend, wakeBackendHint, wakeRegistration } from "../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs";

const CHANNEL_ARGUMENT = /plugin:aweb-channel@awebai-marketplace/;
const SESSION_BRIEF = /Notification delivery: external \(AWEB_DELIVERY=session\): the host wake broker presents/;
// The session-delivery recovery rule, as every session-delivery home is briefed.
const RECOVERY_RULE = /recover by reconciling STATE and your own records against exact delivered ids: use `aw mail show --message-id <id> --json`.*Read state is not completion/;
const registers = (fx) => fx.fake.readCalls().filter((c) => c.args[0] === "wake" && c.args[1] === "register").map((c) => c.args);
const BB = { OATS_BACKEND: "bb" };
/** A broker status in aw's released fields whose target row for this home is
 *  active and streaming, built from the home's stored registration. */
function streamingStatus(fx) {
  const now = new Date().toISOString();
  const reg = fx.registered();
  const receive = (reg.receive_identities || [{ identity_home: reg.identity_home, controls: true }]).map((r) => ({ ...r, delivery_owner: "session-hints", stream_admitted: true, stream_phase: "streaming" }));
  return { updated_at: now, daemon_running: true, daemon_version_state: "reported", daemon_version: "1.36.33", instances: [{
    ...reg, identity_home: receive[0].identity_home, runtime_delivery: "external-session", phase: "active", paused: false, last_inspect_at: now, last_state: "unknown",
    channel_core: { running: true, readiness_state: "unknown", readiness_waiting: "inspect_done" }, receive_identities: receive,
  }] };
}

// ---------------------------------------------------------------- the rule

test("a session provider is any backend but tmux or none", () => {
  for (const backend of ["bb", "fake", "herdr"]) assert.equal(sessionProviderBackend(backend), true, backend);
  for (const backend of ["tmux", "", undefined, null, 7]) assert.equal(sessionProviderBackend(backend), false, String(backend));
});

test("the broker delivers to a session provider's launch, whatever delivery and runtime say", () => {
  for (const delivery of ["channel", "session"]) for (const runtime of ["claude", "pi", "codex", ""]) {
    assert.equal(brokerDelivers({ delivery, runtime, backend: "bb" }), true, `${delivery} ${runtime}`);
    assert.equal(runtimeDeliveryFor({ delivery, runtime, backend: "bb" }), "external-session", `${delivery} ${runtime}`);
    assert.equal(joinedTeamsPolled({ delivery, runtime, backend: "bb" }), false, `${delivery} ${runtime}`);
  }
});

test("tmux and no backend decide exactly as before", () => {
  for (const delivery of ["channel", "session"]) for (const runtime of ["claude", "pi", "codex", ""]) for (const backend of ["tmux", "", undefined]) {
    const label = `${delivery} ${runtime} ${backend}`;
    assert.equal(brokerDelivers({ delivery, runtime, backend }), brokerDelivers({ delivery, runtime }), label);
    assert.equal(runtimeDeliveryFor({ delivery, runtime, backend }), runtimeDeliveryFor({ delivery, runtime }), label);
    assert.equal(joinedTeamsPolled({ delivery, runtime, backend }), joinedTeamsPolled({ delivery, runtime }), label);
  }
  assert.equal(brokerDelivers({ delivery: "channel", runtime: "claude", backend: "tmux" }), false);
  assert.equal(brokerDelivers({ delivery: "channel", runtime: "pi" }), false);
});

test("aw's backend hint is tmux or nothing, never a provider's name", () => {
  assert.equal(wakeBackendHint("tmux"), "tmux");
  for (const backend of ["bb", "herdr", "", undefined]) assert.equal(wakeBackendHint(backend), undefined, String(backend));
  const joined = [{ identityHome: "/h/.aweb-identity-alpha", label: "alpha" }];
  const doc = (backend) => wakeRegistration({ home: "/h", primaryIdentityHome: "/h/.aw", delivery: "channel", runtime: "claude", joined, backend });
  assert.equal(doc("tmux").backend, "tmux");
  assert.equal(doc("tmux").runtime_delivery, "native-channel");
  assert.equal("backend" in doc("bb"), false);
  assert.equal(doc("bb").runtime_delivery, "external-session");
  assert.equal(doc("bb").delivery, "session");
  assert.deepEqual(doc("bb").receive_identities.map((r) => r.label), ["default", "alpha"]);
});

test("the recorded backend is the provider's own record, else the kernel's", () => {
  assert.equal(recordedBackend({ backend: "bb" }, "tmux"), "bb");
  assert.equal(recordedBackend({}, "bb"), "bb");
  assert.equal(recordedBackend(undefined, undefined), undefined);
});

// ---------------------------------------------------------------- acceptance

test("acceptance: OATS_BACKEND=bb, claude, delivery: channel spawns on the broker with no channel argument and no --backend", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude" });
  const r = fx.hook("spawn", BB);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // (a) the launch contributes no channel argument
  assert.equal(r.doc.launch, undefined);
  assert.doesNotMatch(r.stdout, CHANNEL_ARGUMENT);
  // (b) aw wake register ... --delivery session, without --backend
  const calls = registers(fx);
  assert.equal(calls.length, 1, JSON.stringify(calls));
  assert.deepEqual(calls[0], ["wake", "register", "--home", fx.home, "--identity-home", join(fx.home, ".aw"), "--delivery", "session"]);
  assert.deepEqual(fx.registered(), { home: fx.home, identity_home: join(fx.home, ".aw"), delivery: "session" });
  // the launch environment and the brief of a session-delivery home
  assert.equal(r.doc.env.AWEB_DELIVERY, "session");
  assert.match(r.doc.brief, SESSION_BRIEF);
  assert.match(r.doc.brief, RECOVERY_RULE);
  assert.doesNotMatch(r.doc.brief, /aweb channel plugin/);
  // the start's record: the setting, the runtime, the provider; no channel mode
  assert.equal(r.doc.meta.delivery, "channel");
  assert.equal(r.doc.meta.runtime, "claude");
  assert.equal(r.doc.meta.backend, "bb");
  assert.equal("claudeChannelMode" in r.doc.meta, false);
});

test("a session provider's spawn is the broker's for pi, for approved channel mode and for delivery: session too", (t) => {
  for (const [runtime, settings] of [["pi", {}], ["claude", { claudeChannelMode: "approved" }], ["claude", { delivery: "session" }], ["codex", {}]]) {
    const fx = fixture(t, { delivery: "channel", runtime, settings });
    const r = fx.hook("spawn", BB);
    const label = `${runtime} ${JSON.stringify(settings)}`;
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.doc.launch, undefined, label);
    assert.equal(r.doc.env.AWEB_DELIVERY, "session", label);
    assert.match(r.doc.brief, SESSION_BRIEF, label);
    assert.deepEqual(registers(fx), [["wake", "register", "--home", fx.home, "--identity-home", join(fx.home, ".aw"), "--delivery", "session"]], label);
    assert.equal(r.doc.meta.backend, "bb", label);
  }
});

test("acceptance (c): OATS_BACKEND=tmux and unset behave as today", (t) => {
  for (const extra of [{ OATS_BACKEND: "tmux" }, {}, { OATS_BACKEND: "" }]) {
    const label = JSON.stringify(extra);
    let fx = fixture(t, { delivery: "channel", runtime: "claude" });
    let r = fx.hook("spawn", extra);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.doc.launch.claude, CHANNEL_ARGUMENT, label);
    assert.deepEqual(fx.wakeCalls(), [], label);
    assert.equal(r.doc.env.AWEB_DELIVERY, undefined, label);
    assert.match(r.doc.brief, /aweb channel plugin/, label);
    assert.equal("backend" in r.doc.meta, false, label);
    assert.equal(r.doc.meta.claudeChannelMode, "development", label);

    fx = fixture(t, { delivery: "channel", runtime: "codex" });
    r = fx.hook("spawn", extra);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const hint = extra.OATS_BACKEND === "tmux" ? ["--backend", "tmux"] : [];
    assert.deepEqual(registers(fx), [["wake", "register", "--home", fx.home, "--identity-home", join(fx.home, ".aw"), "--delivery", "session", ...hint]], label);
    assert.equal("backend" in r.doc.meta, false, label);
  }
});

// ---------------------------------------------------------------- launch

test("a start on a session provider puts a channel home on the broker, in the preview pass and the real one", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude" });
  const meta = fx.spawn().meta;
  assert.equal(fx.registered(), undefined, "the tmux Claude home starts on its channel");
  const preview = fx.launch(meta, "claude", { extra: { ...BB, OATS_LAUNCH_PREVIEW: "1" } });
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.equal(preview.doc.launch, undefined);
  assert.equal(preview.doc.env.AWEB_DELIVERY, "session");
  assert.deepEqual(registers(fx), [], "a preview registers nothing");
  const r = fx.launch(meta, "claude", { extra: BB });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.launch, undefined);
  assert.equal(r.doc.env.AWEB_DELIVERY, "session");
  assert.deepEqual(registers(fx), [["wake", "register", "--home", fx.home, "--identity-home", join(fx.home, ".aw"), "--delivery", "session"]]);
  assert.equal(r.doc.meta.backend, "bb");
  assert.equal("claudeChannelMode" in r.doc.meta, false, "the previous start's channel mode is not this start's");
});

test("a later start on tmux returns the home to its channel and forgets the provider", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude" });
  const spawned = fx.hook("spawn", BB);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  assert.ok(fx.registered());
  for (const extra of [{ OATS_BACKEND: "tmux" }, {}]) {
    const r = fx.launch(spawned.doc.meta, "claude", { extra });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.doc.launch.claude, CHANNEL_ARGUMENT);
    assert.equal(r.doc.env.AWEB_DELIVERY, undefined);
    assert.equal(fx.registered(), undefined, "one path only: the broker registration is removed");
    assert.equal("backend" in r.doc.meta, false);
    assert.equal(r.doc.meta.claudeChannelMode, "development");
  }
});

test("a session provider's start needs the broker running, like any broker-delivered home", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", daemon: false });
  const r = fx.hook("spawn", BB);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /wake-daemon-not-running/);
  assert.deepEqual(registers(fx), []);
});

// ---------------------------------------------------------------- joined teams

test("a session provider's Claude home receives its joined teams through the broker, not by polling", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings: { join: "alpha" } });
  const r = fx.hook("spawn", BB);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doc = fx.registered();
  assert.equal(doc.runtime_delivery, "external-session");
  assert.equal(doc.delivery, "session");
  assert.equal(doc.identity_home, join(fx.home, ".aw"));
  assert.deepEqual(doc.receive_identities.map((x) => [x.label, x.controls === true]), [["default", true], ["alpha", false]]);
  assert.equal("backend" in doc, false, "aw takes no provider name as its backend hint");
  assert.equal(r.doc.meta.wakeJoined, true);
  assert.deepEqual(r.doc.meta.joinedTeams.map(({ receive, expectedPoll }) => ({ receive, expectedPoll })), [{ receive: "native", expectedPoll: undefined }]);
  for (const argv of registers(fx)) assert.equal(argv.includes("--backend"), false, argv.join(" "));
});

// ---------------------------------------------------------------- retire

test("retire reads the recorded backend: it deregisters a session provider's Claude home under no OATS_BACKEND of its own", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude" });
  const spawned = fx.hook("spawn", BB);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  fx.record(spawned.doc.meta, "claude");
  const r = fx.hook("retire", { OATS_META: JSON.stringify(spawned.doc.meta) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fx.registered(), undefined);
  assert.ok(fx.wakeCalls().includes("deregister"));
});

test("retire follows the kernel's instance.json backend for a meta that recorded none, and never a caller's OATS_BACKEND", (t) => {
  let fx = fixture(t, { delivery: "channel", runtime: "claude" });
  let spawned = fx.hook("spawn", BB);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const { backend: _recorded, ...meta } = spawned.doc.meta;
  writeFileSync(join(fx.home, "instance.json"), JSON.stringify({ harness: "claude", launch: { harness: "claude" }, backend: "bb", capabilityMeta: { "oats.aweb": meta } }));
  let r = fx.hook("retire", { OATS_META: JSON.stringify(meta) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fx.registered(), undefined);
  assert.ok(fx.wakeCalls().includes("deregister"));

  fx = fixture(t, { delivery: "channel", runtime: "claude" });
  spawned = fx.hook("spawn");
  fx.record(spawned.doc.meta, "claude");
  r = fx.hook("retire", { OATS_META: JSON.stringify(spawned.doc.meta), ...BB });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fx.wakeCalls(), [], "a tmux channel home was never the broker's");
});

// ---------------------------------------------------------------- readiness

test("readiness expects the broker for a session provider's Claude home, from the provider's record or the kernel's", (t) => {
  for (const kernelOnly of [false, true]) {
    const fx = fixture(t, { delivery: "channel", runtime: "claude" });
    const spawned = fx.hook("spawn", BB);
    assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
    const { backend, ...rest } = spawned.doc.meta;
    const meta = kernelOnly ? rest : spawned.doc.meta;
    writeFileSync(join(fx.home, "instance.json"), JSON.stringify({ harness: "claude", launch: { harness: "claude" }, ...(kernelOnly ? { backend } : {}), capabilityMeta: { "oats.aweb": meta } }));
    fx.fake.setStatus(streamingStatus(fx));
    const result = fx.readiness();
    assert.equal(result.status, "ready", JSON.stringify(result));
    assert.deepEqual(result.problems, []);
    // Nothing about a Claude channel: this home has none to admit, confirm or choose a mode for.
    assert.deepEqual(result.warnings.filter((w) => /channel|native|polled/.test(w.code)), [], JSON.stringify(result));
    // The broker is its only path: with no target row for the home it is not ready.
    fx.fake.setStatus({ ...streamingStatus(fx), instances: [] });
    const gone = fx.readiness();
    assert.notEqual(gone.status, "ready", JSON.stringify(gone));
    assert.deepEqual(gone.problems.map((p) => p.code), ["wake-target-missing"], JSON.stringify(gone));
  }
});

test("readiness refuses a record whose backend is not a name, or that pairs a provider with a Claude channel mode", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude" });
  const spawned = fx.hook("spawn", BB);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  for (const doc of [
    { backend: 7, capabilityMeta: { "oats.aweb": spawned.doc.meta } },
    { capabilityMeta: { "oats.aweb": { ...spawned.doc.meta, backend: " " } } },
    { capabilityMeta: { "oats.aweb": { ...spawned.doc.meta, claudeChannelMode: "development" } } },
  ]) {
    writeFileSync(join(fx.home, "instance.json"), JSON.stringify({ harness: "claude", launch: { harness: "claude" }, ...doc }));
    const result = fx.readiness();
    assert.ok(result.problems.some((p) => p.code === "receive-record-unavailable"), JSON.stringify(result));
  }
});
