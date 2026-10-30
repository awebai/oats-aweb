// oats.aweb readiness additions: soul-scope readiness checks the host wake
// daemon: delivery: session needs it, with the home-scope codes and messages,
// and a join alone warns which launches need it; and a Claude channel home composed with
// claudeChannelMode unset warns claude-channel-mode-default.
//
// At home scope the kernel passes the home's captured settings payload and its
// captured per-leaf origins (OATS_SETTINGS_ORIGINS, JSON pointer -> {kind,at});
// a manifest-filled claudeChannelMode arrives as "development" with origin
// kind manifest-default.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fakeAwWake } from "./helpers/fake-aw-wake.mjs";
import { AW_MIN } from "../oats-package/capabilities/oats-aweb/lib/binding-wire.mjs";
import { claudeChannelModeUnset, targetReceiveAssessment, wakeDaemonAssessment } from "../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BINDING = join(REPO, "oats-package", "capabilities", "oats-aweb", "bin", "oats-aweb-binding.mjs");
const CHANNEL_FLAG = "--channels plugin:aweb-channel@awebai-marketplace";
const DEV_CHANNEL_FLAG = "--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace";
const MODE_DEFAULT = { code: "claude-channel-mode-default", message: "this Claude home runs in development channel mode because settings.oats.aweb.claudeChannelMode is unset in oats-local.yaml; choose approved (the managed-settings route) or set development explicitly, then respawn" };
const MANIFEST_DEFAULT = JSON.stringify({ "/claudeChannelMode": { kind: "manifest-default" } });
const HOST_ORIGIN = JSON.stringify({ "/claudeChannelMode": { kind: "host", at: "/settings/oats.aweb/claudeChannelMode" } });

function fixture(t) {
  const fake = fakeAwWake(t);
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-128-")));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const home = join(ws, "agents", "dev", "instances", "dev-1");
  mkdirSync(join(home, ".aw"), { recursive: true });
  mkdirSync(join(home, ".oats-aweb"));
  writeFileSync(join(home, ".oats-aweb", "teams.json"), JSON.stringify({ joinedTeams: [] }));
  mkdirSync(join(ws, ".aw"));
  const env = {
    PATH: fake.path, OATS_WORKSPACE: ws, OATS_WORKSPACE_KEY: "github.com/acme/agents", OATS_WORKSPACE_NAME: "acme",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: "legacy:example.test", OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: "legacy:example.test", default: true, from: "local" }]),
  };
  /** The kernel's record of the home's last start. */
  const record = (meta, claude) => writeFileSync(join(home, "instance.json"), JSON.stringify({
    launch: { harness: meta.runtime, hooks: claude ? { launch: { claude } } : {} }, capabilityMeta: { "oats.aweb": meta },
  }));
  /** The binding readiness check; `targetHome: null` is soul scope. */
  const readiness = (settings, { targetHome = home, origins } = {}) => {
    const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: { root: ws, ...settings }, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: env.OATS_WORKSPACE_KEY, deployment: ws, soul: "dev", team: "default", instance: targetHome ? "dev-1" : null, home: targetHome } } };
    const r = spawnSync(process.execPath, [BINDING, "check"], { cwd: ws, input: JSON.stringify(input), env: { ...env, ...(origins !== undefined ? { OATS_SETTINGS_ORIGINS: origins } : {}) }, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout).result;
  };
  const statusCalls = () => fake.readCalls().filter((c) => c.args[0] === "wake" && c.args[1] === "status");
  return { fake, ws, home, record, readiness, statusCalls };
}
const modeDefault = (result) => result.warnings.filter((w) => w.code === MODE_DEFAULT.code);

// ------------------------------------------------ claude-channel-mode-default

test("claude-channel-mode-default fires for a channel Claude home composed with claudeChannelMode unset", (t) => {
  const fx = fixture(t);
  fx.record({ delivery: "channel", runtime: "claude", claudeChannelMode: "development" }, DEV_CHANNEL_FLAG);
  for (const [name, settings, origins] of [
    ["key absent", { delivery: "channel" }, undefined],
    ["key absent, origins {}", { delivery: "channel" }, "{}"],
    ["manifest default", { delivery: "channel", claudeChannelMode: "development" }, MANIFEST_DEFAULT],
  ]) {
    const result = fx.readiness(settings, { origins });
    assert.deepEqual(modeDefault(result), [MODE_DEFAULT], `${name}: ${JSON.stringify(result)}`);
    assert.equal(result.status, "ready", "a warning, never a problem");
    assert.ok(result.warnings.some((w) => w.code === "channel-dev-confirmation"), `${name}: both appear when unset`);
  }
});

test("claude-channel-mode-default is silent for an explicit mode, a present key with no origin and every other route", (t) => {
  const fx = fixture(t);
  fx.record({ delivery: "channel", runtime: "claude", claudeChannelMode: "development" }, DEV_CHANNEL_FLAG);
  const explicit = fx.readiness({ delivery: "channel", claudeChannelMode: "development" }, { origins: HOST_ORIGIN });
  assert.deepEqual(modeDefault(explicit), [], JSON.stringify(explicit));
  assert.ok(explicit.warnings.some((w) => w.code === "channel-dev-confirmation"), "explicit development keeps the confirmation");
  for (const origins of ["{}", undefined, "not json"]) assert.deepEqual(modeDefault(fx.readiness({ delivery: "channel", claudeChannelMode: "development" }, { origins })), [], String(origins));
  fx.record({ delivery: "channel", runtime: "claude", claudeChannelMode: "approved" }, CHANNEL_FLAG);
  assert.deepEqual(modeDefault(fx.readiness({ delivery: "channel", claudeChannelMode: "approved" }, { origins: HOST_ORIGIN })), []);
  for (const [delivery, runtime] of [["session", "claude"], ["channel", "codex"], ["channel", "pi"]]) {
    fx.record({ delivery, runtime });
    const result = fx.readiness({ delivery }, { origins: MANIFEST_DEFAULT });
    assert.deepEqual(modeDefault(result), [], `${delivery}/${runtime}: ${JSON.stringify(result)}`);
    assert.equal(result.problems.some((p) => p.code === "receive-record-unavailable"), false, "the record is read, not refused");
  }
});

test("claude-channel-mode-default never fires at soul scope", (t) => {
  const fx = fixture(t);
  fx.record({ delivery: "channel", runtime: "claude", claudeChannelMode: "development" }, DEV_CHANNEL_FLAG);
  const result = fx.readiness({ delivery: "channel" }, { targetHome: null, origins: MANIFEST_DEFAULT });
  assert.equal(result.status, "ready", JSON.stringify(result));
  assert.deepEqual(modeDefault(result), []);
});

test("claudeChannelModeUnset: absent key or a manifest-default origin", () => {
  assert.equal(claudeChannelModeUnset({}, undefined), true);
  assert.equal(claudeChannelModeUnset({ claudeChannelMode: "development" }, { "/claudeChannelMode": { kind: "manifest-default" } }), true);
  for (const kind of ["workspace", "soul", "host", "spawn", "anchor"]) assert.equal(claudeChannelModeUnset({ claudeChannelMode: "development" }, { "/claudeChannelMode": { kind } }), false, kind);
  assert.equal(claudeChannelModeUnset({ claudeChannelMode: "development" }, {}), false);
  assert.equal(claudeChannelModeUnset({ claudeChannelMode: "development" }, undefined), false);
});

// ------------------------------------------------- soul-scope broker check

const reported = (version) => ({ daemon_running: true, daemon_version_state: "reported", daemon_version: version });

test("soul scope with delivery session reads aw wake status once and reports the daemon with the home-scope codes", (t) => {
  const fx = fixture(t);
  for (const [name, status, outcome, problems, warnings] of [
    ["down", { daemon_running: false, daemon_version_state: "not_running", instances: [] }, "unavailable", ["wake-daemon-not-running"], []],
    ["unknown version", { daemon_running: true, daemon_version_state: "unknown" }, "unavailable", ["wake-daemon-version-unknown"], []],
    ["outdated", reported("1.36.31"), "ready", [], ["wake-daemon-outdated"]],
    ["healthy, no instances list", reported(AW_MIN), "ready", [], []],
    ["unreadable", "not json", "unavailable", ["wake-status-unavailable"], []],
    ["not an object", "[]", "unavailable", ["wake-status-unavailable"], []],
  ]) {
    fx.fake.setStatus(status);
    const before = fx.statusCalls().length;
    const result = fx.readiness({ delivery: "session" }, { targetHome: null });
    const calls = fx.statusCalls().slice(before);
    assert.equal(calls.length, 1, name);
    assert.equal(realpathSync(calls[0].cwd), fx.ws, `${name}: runs in the deployment`);
    assert.equal(result.status, outcome, `${name}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.problems.map((p) => p.code), problems, name);
    assert.deepEqual(result.warnings.filter((w) => w.code.startsWith("wake-")).map((w) => w.code), warnings, name);
    // One assessment, one wording: the soul-scope items equal the home-scope ones.
    const home = targetReceiveAssessment(typeof status === "string" ? undefined : { instances: [], ...status }, { home: "/nonexistent", runtimeDelivery: "external-session", bindings: [] }, { minimumVersion: AW_MIN });
    if (problems.length) assert.deepEqual(result.problems, home.problems, name);
    assert.deepEqual(result.warnings.filter((w) => w.code.startsWith("wake-")), home.warnings, name);
  }
});

test("soul scope with a non-empty join reads aw wake status once; channel without a join, or a blank join, reads none", (t) => {
  const fx = fixture(t);
  fx.fake.setStatus({ daemon_running: false, daemon_version_state: "not_running" });
  let before = fx.statusCalls().length;
  const joined = fx.readiness({ delivery: "channel", join: "alpha, beta" }, { targetHome: null });
  assert.equal(fx.statusCalls().length - before, 1);
  assert.equal(joined.status, "ready", JSON.stringify(joined));
  assert.deepEqual(joined.problems, []);
  const unconfirmed = joined.warnings.find((w) => w.code === "joined-team-broker-unconfirmed");
  assert.match(unconfirmed.message, /needs it on a pi or Codex home\./);
  assert.match(unconfirmed.message, /needs no broker/);
  for (const settings of [{ delivery: "channel" }, {}, { delivery: "channel", join: " , " }, { join: "" }]) {
    before = fx.statusCalls().length;
    const result = fx.readiness(settings, { targetHome: null });
    assert.equal(fx.statusCalls().length - before, 0, JSON.stringify(settings));
    assert.equal(result.status, "ready", JSON.stringify(result));
  }
});

test("soul scope: a join reads ready whatever the daemon says, and session delivery still needs it", (t) => {
  const fx = fixture(t);
  const session = { delivery: "session", join: "alpha" };
  fx.fake.setStatus({ daemon_running: false, daemon_version_state: "not_running" });
  assert.deepEqual(fx.readiness(session, { targetHome: null }).problems.map((p) => p.code), ["wake-daemon-not-running"]);
  fx.fake.setStatus("not json");
  const unreadable = fx.readiness({ delivery: "channel", join: "alpha" }, { targetHome: null });
  assert.equal(unreadable.status, "ready", JSON.stringify(unreadable));
  assert.ok(unreadable.warnings.some((w) => w.code === "joined-team-broker-unconfirmed"));
  fx.fake.setStatus({ daemon_running: true, daemon_version_state: "reported", daemon_version: AW_MIN });
  const running = fx.readiness({ delivery: "channel", join: "alpha" }, { targetHome: null });
  assert.equal(running.status, "ready", JSON.stringify(running));
  assert.equal(running.warnings.some((w) => w.code === "joined-team-broker-unconfirmed"), false);
});

test("soul scope reads no broker when configuration prerequisites already fail", (t) => {
  const fx = fixture(t);
  rmSync(join(fx.ws, ".aw"), { recursive: true });
  const result = fx.readiness({ delivery: "session" }, { targetHome: null });
  assert.equal(result.status, "needs-configuration", JSON.stringify(result));
  assert.equal(fx.statusCalls().length, 0);
});

test("wakeDaemonAssessment keeps the home-scope order: an instances-less status is unavailable at home scope only", () => {
  const down = { daemon_running: false, daemon_version_state: "not_running" };
  assert.deepEqual(targetReceiveAssessment(down, { home: "/x", bindings: [] }, { minimumVersion: AW_MIN }).problems.map((p) => p.code), ["wake-status-unavailable"]);
  assert.deepEqual(wakeDaemonAssessment(down, { minimumVersion: AW_MIN }).problems.map((p) => p.code), ["wake-daemon-not-running"]);
  assert.deepEqual(wakeDaemonAssessment(reported(AW_MIN), { minimumVersion: AW_MIN }), { problems: [], warnings: [] });
  assert.deepEqual(wakeDaemonAssessment(undefined, { minimumVersion: AW_MIN }).problems, [{ code: "wake-status-unavailable", message: "aw wake status is unavailable or malformed" }]);
});
