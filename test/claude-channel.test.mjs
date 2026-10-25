// awebai/oats#981: Claude Code keeps a per-account MCP failure cache
// (<CLAUDE_CONFIG_DIR>/mcp-needs-auth-cache.json). One failed aweb-channel start
// stamps plugin:aweb-channel:aweb-channel, and every Claude launched in the next
// 15 minutes skips the channel and never retries: the seat shows the banner but
// is deaf. A Claude channel start removes that one live entry before Claude
// reads it, and readiness counts a home as on the channel only when Claude's
// MCP log for the home's project shows "Channel notifications registered"
// after the home's last start.
//
// Shapes are Claude Code 2.1.300's: a cache entry is {timestamp, id?, ttlMs?},
// live while -60 s < now - timestamp < (ttlMs ?? 15 min); a log line is
// {debug|error, timestamp, sessionId, cwd} under
// <cache>/claude-cli-nodejs/<cwd, non-alphanumerics as "-">/mcp-logs-plugin-aweb-channel-aweb-channel/.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fakeAwWake } from "./helpers/fake-aw-wake.mjs";
import { CHANNEL_SERVER, channelConnection, claudeLogRoot, clearChannelFailure, recordedClaudeConfigDir } from "../oats-package/capabilities/oats-aweb/lib/claude-channel.mjs";
import { assessHealth } from "../oats-package/capabilities/oats-aweb/lib/health-vocabulary.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CAPABILITY = join(REPO, "oats-package", "capabilities", "oats-aweb");
const HOOK = join(CAPABILITY, "bin", "oats-aweb.mjs");
const BINDING = join(CAPABILITY, "bin", "oats-aweb-binding.mjs");
const CHANNEL_FLAG = "--channels plugin:aweb-channel@awebai-marketplace";
const NOW = Date.parse("2026-10-25T20:30:00.000Z");
const MIN = 60000;

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-981-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(file, text) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
const cacheFile = (dir) => join(dir, "mcp-needs-auth-cache.json");
/** A cache file as Claude writes it, with a mode of its own. */
function writeCache(dir, doc, mode = 0o644) { write(cacheFile(dir), JSON.stringify(doc)); chmodSync(cacheFile(dir), mode); return readFileSync(cacheFile(dir), "utf8"); }
const OTHER = { "claude.ai Gmail": { timestamp: NOW - 2 * MIN, id: "srv_1" }, "plugin:other:other": { timestamp: NOW - MIN, id: "abc", ttlMs: 900000 } };

// ------------------------------------------------------------ the failure cache

test("a live aweb-channel failure entry is removed and every other entry is kept, atomically and with the file's mode", (t) => {
  const dir = tempDir(t);
  writeCache(dir, { ...OTHER, [CHANNEL_SERVER]: { timestamp: NOW - 3 * MIN, id: "cfg-hash" } }, 0o640);
  const result = clearChannelFailure(dir, { now: NOW });
  assert.equal(result.state, "cleared");
  assert.equal(result.file, cacheFile(dir));
  assert.equal(result.stampedAt, new Date(NOW - 3 * MIN).toISOString());
  assert.deepEqual(JSON.parse(readFileSync(cacheFile(dir), "utf8")), OTHER);
  assert.equal(statSync(cacheFile(dir)).mode & 0o777, 0o640);
  assert.deepEqual(readdirSync(dir), ["mcp-needs-auth-cache.json"], "no temporary file is left behind");
});

test("an entry's own ttlMs decides whether it is live", (t) => {
  const dir = tempDir(t);
  writeCache(dir, { [CHANNEL_SERVER]: { timestamp: NOW - 60 * MIN, ttlMs: 4 * 60 * MIN } });
  assert.equal(clearChannelFailure(dir, { now: NOW }).state, "cleared");
  assert.deepEqual(JSON.parse(readFileSync(cacheFile(dir), "utf8")), {});
});

test("an expired entry, or one stamped more than a minute in the future, is not live and the file is not touched", (t) => {
  for (const entry of [{ timestamp: NOW - 15 * MIN }, { timestamp: NOW - 20 * MIN, id: "x" }, { timestamp: NOW - 2 * MIN, ttlMs: MIN }, { timestamp: NOW + MIN }]) {
    const dir = tempDir(t);
    const before = writeCache(dir, { ...OTHER, [CHANNEL_SERVER]: entry });
    const mtime = statSync(cacheFile(dir)).mtimeMs;
    assert.equal(clearChannelFailure(dir, { now: NOW }).state, "none", JSON.stringify(entry));
    assert.equal(readFileSync(cacheFile(dir), "utf8"), before);
    assert.equal(statSync(cacheFile(dir)).mtimeMs, mtime);
  }
});

test("a file with no aweb-channel entry, and a missing file, are left as they are", (t) => {
  const dir = tempDir(t);
  const before = writeCache(dir, OTHER);
  assert.equal(clearChannelFailure(dir, { now: NOW }).state, "none");
  assert.equal(readFileSync(cacheFile(dir), "utf8"), before);
  const empty = tempDir(t);
  assert.equal(clearChannelFailure(empty, { now: NOW }).state, "absent");
  assert.equal(existsSync(cacheFile(empty)), false, "nothing is created");
});

test("a file in any other shape is never touched and is reported", (t) => {
  const shapes = [
    ["not JSON", "{not json"],
    ["an array", JSON.stringify([{ [CHANNEL_SERVER]: { timestamp: NOW } }])],
    ["a string timestamp", JSON.stringify({ [CHANNEL_SERVER]: { timestamp: String(NOW - MIN) } })],
    ["an unknown key on our entry", JSON.stringify({ [CHANNEL_SERVER]: { timestamp: NOW - MIN, reason: "x" } })],
    ["an unknown key on another entry", JSON.stringify({ ...OTHER, x: { timestamp: NOW, extra: 1 }, [CHANNEL_SERVER]: { timestamp: NOW - MIN } })],
    ["a non-object entry", JSON.stringify({ x: 1, [CHANNEL_SERVER]: { timestamp: NOW - MIN } })],
    ["a non-string id", JSON.stringify({ [CHANNEL_SERVER]: { timestamp: NOW - MIN, id: 7 } })],
    ["a non-positive ttlMs", JSON.stringify({ [CHANNEL_SERVER]: { timestamp: NOW - MIN, ttlMs: 0 } })],
  ];
  for (const [name, text] of shapes) {
    const dir = tempDir(t);
    write(cacheFile(dir), text);
    const result = clearChannelFailure(dir, { now: NOW });
    assert.equal(result.state, "unrecognized", name);
    assert.ok(result.detail, name);
    assert.equal(readFileSync(cacheFile(dir), "utf8"), text, `${name}: untouched`);
  }
});

test("the launch's config dir is the home's recorded literal CLAUDE_CONFIG_DIR, else HOME's .claude; anything else is unknown", (t) => {
  const home = tempDir(t);
  const record = (launch) => writeFileSync(join(home, "instance.json"), JSON.stringify({ launch }));
  assert.equal(recordedClaudeConfigDir(home, { HOME: "/u" }), undefined, "no record");
  record({ harness: "claude", env: { CLAUDE_CONFIG_DIR: "/u/.claude-work" } });
  assert.equal(recordedClaudeConfigDir(home, { HOME: "/u" }), "/u/.claude-work");
  record({ harness: "claude" });
  assert.equal(recordedClaudeConfigDir(home, { HOME: "/u" }), "/u/.claude");
  assert.equal(recordedClaudeConfigDir(home, {}), undefined, "no HOME");
  assert.equal(recordedClaudeConfigDir(home, { HOME: "relative" }), undefined);
  for (const value of [{ fromEnv: "WORK_CLAUDE" }, "relative/dir", ""]) {
    record({ harness: "claude", env: { CLAUDE_CONFIG_DIR: value } });
    assert.equal(recordedClaudeConfigDir(home, { HOME: "/u" }), undefined, JSON.stringify(value));
  }
});

// ------------------------------------------------------------ the launch hook

function hookFixture(t, { delivery = "channel", launchEnv } = {}) {
  const fake = fakeAwWake(t);
  const ws = tempDir(t), home = join(ws, "agents", "dev", "instances", "dev-1"), user = join(ws, "user");
  mkdirSync(join(home, ".aw"), { recursive: true });
  mkdirSync(join(ws, ".aw"), { recursive: true });
  writeFileSync(join(ws, ".aw", "teams.yaml"), "active_team: legacy:example.test\n");
  const configDir = launchEnv === undefined ? join(user, ".claude") : join(ws, "claude-work");
  writeFileSync(join(home, "instance.json"), JSON.stringify({ launch: { harness: "claude", ...(launchEnv === undefined ? {} : { env: { CLAUDE_CONFIG_DIR: configDir } }) } }));
  const env = {
    PATH: fake.path, HOME: user, OATS_HOME: home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: ws, OATS_WORKSPACE_KEY: "github.com/acme/agents", OATS_WORKSPACE_NAME: "acme",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: "legacy:example.test", OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: "legacy:example.test", default: true, from: "local" }]), OATS_TEAMS_SOURCE: "live",
    OATS_SETTINGS: JSON.stringify({ root: ws, delivery, claudeChannelMode: "approved" }),
  };
  const hook = (event, extra = {}) => {
    const r = spawnSync(process.execPath, [HOOK, event], { cwd: home, env: { ...env, ...extra, OATS_EVENT: event }, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout.trim().split("\n").pop());
  };
  const launch = (runtime = "claude", extra = {}) => hook("launch", { OATS_META: JSON.stringify({ delivery, runtime }), OATS_RUNTIME: runtime, OATS_PREVIOUS_RUNTIME: runtime, ...extra });
  return { home, configDir, hook, launch };
}
const live = () => ({ ...OTHER, [CHANNEL_SERVER]: { timestamp: Date.now() - MIN, id: "cfg-hash" } });

test("a Claude channel start removes a live aweb-channel failure from the recorded config dir and says so", (t) => {
  const fx = hookFixture(t, { launchEnv: true });
  writeCache(fx.configDir, live());
  const doc = fx.launch();
  assert.equal(doc.launch.claude, CHANNEL_FLAG);
  assert.deepEqual(JSON.parse(readFileSync(cacheFile(fx.configDir), "utf8")), OTHER);
  assert.match(doc.warning, /channel-failure-cleared/);
  assert.ok(doc.warning.includes(cacheFile(fx.configDir)), doc.warning);
});

test("without a recorded CLAUDE_CONFIG_DIR the start reads HOME's .claude", (t) => {
  const fx = hookFixture(t);
  writeCache(fx.configDir, live());
  fx.launch();
  assert.deepEqual(JSON.parse(readFileSync(cacheFile(fx.configDir), "utf8")), OTHER);
});

test("the launch preview, a broker runtime and session delivery leave the cache alone", (t) => {
  for (const [name, fx, run] of [
    ["preview", hookFixture(t, { launchEnv: true }), (f) => f.launch("claude", { OATS_LAUNCH_PREVIEW: "1" })],
    ["codex", hookFixture(t, { launchEnv: true }), (f) => f.launch("codex")],
    ["session", hookFixture(t, { launchEnv: true, delivery: "session" }), (f) => f.launch("claude")],
  ]) {
    const before = writeCache(fx.configDir, live());
    const doc = run(fx);
    assert.equal(readFileSync(cacheFile(fx.configDir), "utf8"), before, name);
    assert.doesNotMatch(doc.warning || "", /channel-failure-cleared|channel-cache-/, name);
  }
});

test("a cache in another shape is left alone and the start reports it", (t) => {
  const fx = hookFixture(t, { launchEnv: true });
  write(cacheFile(fx.configDir), "[]");
  const doc = fx.launch();
  assert.equal(readFileSync(cacheFile(fx.configDir), "utf8"), "[]");
  assert.match(doc.warning, /channel-cache-unrecognized/);
  assert.match(doc.warning, /left it alone/);
});

test("a start whose config dir cannot be established does not look and says so", (t) => {
  const fx = hookFixture(t, { launchEnv: true });
  writeFileSync(join(fx.home, "instance.json"), JSON.stringify({ launch: { harness: "claude", env: { CLAUDE_CONFIG_DIR: { fromEnv: "WORK_CLAUDE" } } } }));
  const before = writeCache(fx.configDir, live());
  const doc = fx.launch();
  assert.equal(readFileSync(cacheFile(fx.configDir), "utf8"), before);
  assert.match(doc.warning, /channel-cache-unchecked/);
});

test("a Claude channel spawn cannot know the launch's config dir: it does not look and says so", (t) => {
  const fx = hookFixture(t, { launchEnv: true });
  rmSync(join(fx.home, ".aw"), { recursive: true, force: true });
  rmSync(join(fx.home, "instance.json"));
  const before = writeCache(fx.configDir, live());
  const doc = fx.hook("spawn", { OATS_RUNTIME: "claude" });
  assert.equal(doc.launch.claude, CHANNEL_FLAG);
  assert.equal(readFileSync(cacheFile(fx.configDir), "utf8"), before);
  assert.match(doc.warning, /channel-cache-unchecked/);
});

// ------------------------------------------------------------ proof of connection

const KEY = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, "-");
const line = (debug, at, cwd, extra = {}) => JSON.stringify({ debug, timestamp: new Date(at).toISOString(), sessionId: "s-1", cwd, ...extra });
const REGISTERED = "Channel notifications registered";
/** One Claude process's channel log for project `cwd`, under `root`. */
function writeLog(root, cwd, startedAt, lines, { dir = KEY(cwd) } = {}) {
  const name = new Date(startedAt).toISOString().replace(/:/g, "-").replace(".", "-");
  write(join(root, dir, "mcp-logs-plugin-aweb-channel-aweb-channel", `${name}.jsonl`), lines.join("\n") + "\n");
}

test("Claude's log root follows its platform's cache directory", () => {
  assert.equal(claudeLogRoot({ HOME: "/u" }, "darwin"), "/u/Library/Caches/claude-cli-nodejs");
  assert.equal(claudeLogRoot({ HOME: "/u" }, "linux"), "/u/.cache/claude-cli-nodejs");
  assert.equal(claudeLogRoot({ HOME: "/u", XDG_CACHE_HOME: "/x" }, "linux"), "/x/claude-cli-nodejs");
  assert.equal(claudeLogRoot({}, "linux"), undefined);
  assert.equal(claudeLogRoot({ HOME: "/u" }, "win32"), undefined);
});

function proofFixture(t) {
  const base = tempDir(t), home = join(base, "agents", "dev", "instances", "dev-1"), user = join(base, "user");
  mkdirSync(home, { recursive: true });
  const env = { HOME: user, XDG_CACHE_HOME: join(user, "cache") };
  const root = claudeLogRoot(env, "linux");
  const check = (startedAt, now = NOW) => channelConnection({ home, startedAt, now, env, platform: "linux" });
  return { home, root, check };
}

test("a registration after the last start puts the home on the channel", (t) => {
  const fx = proofFixture(t);
  const start = NOW - 10 * MIN;
  writeLog(fx.root, fx.home, start + 1000, [
    line("Starting connection with timeout of 30000ms", start + 1000, fx.home),
    line(REGISTERED, start + 2000, fx.home),
  ]);
  assert.deepEqual(fx.check(start), { state: "registered", at: new Date(start + 2000).toISOString() });
});

test("only this start's registration, for this home, in that exact line, counts", (t) => {
  const fx = proofFixture(t);
  const start = NOW - 10 * MIN, earlier = start - 60 * MIN;
  writeLog(fx.root, fx.home, earlier, [line(REGISTERED, earlier + 1000, fx.home)]);
  writeLog(fx.root, fx.home, start + 1000, [
    line("Channel notifications skipped: server did not declare claude/channel capability", start + 2000, fx.home),
    line(`notifications/claude/channel: ${REGISTERED}`, start + 3000, fx.home),
    JSON.stringify({ error: REGISTERED, timestamp: new Date(start + 4000).toISOString(), cwd: fx.home }),
    line(REGISTERED, start + 5000, "/somewhere/else"),
    "not json",
  ]);
  assert.equal(fx.check(start).state, "not-connected");
});

test("no registration: pending inside two minutes of the start, not connected after", (t) => {
  const fx = proofFixture(t);
  assert.deepEqual(fx.check(NOW - MIN), { state: "pending", since: new Date(NOW - MIN).toISOString() });
  assert.deepEqual(fx.check(NOW - 3 * MIN), { state: "not-connected", since: new Date(NOW - 3 * MIN).toISOString() });
  writeLog(fx.root, fx.home, NOW - 3 * MIN, [line("Starting connection with timeout of 30000ms", NOW - 3 * MIN, fx.home)]);
  assert.equal(fx.check(NOW - 3 * MIN).state, "not-connected");
});

test("no recorded start or no log root is unproven, never on the channel", (t) => {
  const fx = proofFixture(t);
  assert.equal(fx.check(undefined).state, "unproven");
  assert.equal(channelConnection({ home: fx.home, startedAt: NOW - 10 * MIN, now: NOW, env: {}, platform: "linux" }).state, "unproven");
});

test("a project key longer than Claude's 200 characters is found by its prefix and the line's cwd", (t) => {
  const base = tempDir(t), home = join(base, "a".repeat(120), "b".repeat(120), "dev-1"), user = join(base, "user");
  mkdirSync(home, { recursive: true });
  const env = { HOME: user, XDG_CACHE_HOME: join(user, "cache") };
  const root = claudeLogRoot(env, "linux"), start = NOW - 10 * MIN;
  writeLog(root, home, start + 1000, [line(REGISTERED, start + 2000, home)], { dir: `${KEY(home).slice(0, 200)}-1x2y3z` });
  assert.equal(channelConnection({ home, startedAt: start, now: NOW, env, platform: "linux" }).state, "registered");
});

// ------------------------------------------------------------ readiness

function readinessFixture(t, { createdAt, restarts, registeredAt } = {}) {
  const fake = fakeAwWake(t);
  const ws = tempDir(t), home = join(ws, "agents", "dev", "instances", "dev-1"), user = join(ws, "user");
  mkdirSync(join(home, ".aw"), { recursive: true });
  mkdirSync(join(home, ".oats-aweb"));
  writeFileSync(join(home, ".oats-aweb", "teams.json"), JSON.stringify({ joinedTeams: [] }));
  mkdirSync(join(ws, ".aw"));
  writeFileSync(join(home, "instance.json"), JSON.stringify({
    launch: { harness: "claude", hooks: { launch: { claude: CHANNEL_FLAG } } },
    capabilityMeta: { "oats.aweb": { delivery: "channel", runtime: "claude", claudeChannelMode: "approved" } },
    ...(createdAt ? { launched: true, createdAt } : {}), ...(restarts ? { restarts } : {}),
  }));
  const env = {
    PATH: fake.path, HOME: user, XDG_CACHE_HOME: join(user, "cache"), OATS_WORKSPACE: ws, OATS_WORKSPACE_KEY: "github.com/acme/agents", OATS_WORKSPACE_NAME: "acme",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: "legacy:example.test", OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: "legacy:example.test", default: true, from: "local" }]),
  };
  if (registeredAt) writeLog(claudeLogRoot(env, process.platform), home, Date.parse(registeredAt) - 1000, [line(REGISTERED, Date.parse(registeredAt), home)]);
  const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: { root: ws, delivery: "channel", claudeChannelMode: "approved" }, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: env.OATS_WORKSPACE_KEY, deployment: ws, soul: "dev", team: "default", instance: "dev-1", home } } };
  const r = spawnSync(process.execPath, [BINDING, "check"], { cwd: ws, input: JSON.stringify(input), env, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { home, result: JSON.parse(r.stdout).result };
}
const codes = (items) => items.map((i) => i.code);
const iso = (ms) => new Date(ms).toISOString();

test("readiness reports channel-not-connected, with the restart remedy, when no registration followed the last start", (t) => {
  const { home, result } = readinessFixture(t, { createdAt: iso(Date.now() - 10 * MIN) });
  assert.equal(result.status, "unavailable", JSON.stringify(result));
  const problem = result.problems.find((p) => p.code === "channel-not-connected");
  assert.ok(problem, JSON.stringify(result));
  assert.match(problem.message, /Channel notifications registered/);
  assert.match(problem.message, /mcp-needs-auth-cache\.json/);
  assert.ok(problem.message.includes(`oats session restart --home ${home}`), problem.message);
});

test("readiness reads the last restart, not the spawn, as the start", (t) => {
  const spawnedAt = Date.now() - 60 * MIN, restartedAt = Date.now() - 10 * MIN;
  const { result } = readinessFixture(t, { createdAt: iso(spawnedAt), restarts: [{ startedAt: iso(restartedAt) }], registeredAt: iso(spawnedAt + 2000) });
  assert.ok(codes(result.problems).includes("channel-not-connected"), JSON.stringify(result));
});

test("a registered home has no channel problem, and its receive warning says registration is not stream proof", (t) => {
  const start = Date.now() - 10 * MIN;
  const { result } = readinessFixture(t, { createdAt: iso(start), registeredAt: iso(start + 2000) });
  assert.deepEqual(codes(result.problems), [], JSON.stringify(result));
  assert.equal(result.status, "ready");
  const unproven = result.warnings.find((w) => w.code === "native-receive-unproven");
  assert.ok(unproven, JSON.stringify(result));
  assert.match(unproven.message, /registered the aweb channel/);
  assert.match(unproven.message, /not proof that the plugin's aweb event stream is up/);
  assert.ok(!codes(result.warnings).some((c) => c.startsWith("channel-connection-")), JSON.stringify(result));
});

test("inside the window readiness warns pending; with no recorded start it warns unproven; neither is a problem", (t) => {
  const pending = readinessFixture(t, { createdAt: iso(Date.now() - 20000) }).result;
  assert.equal(pending.status, "ready", JSON.stringify(pending));
  assert.ok(codes(pending.warnings).includes("channel-connection-pending"), JSON.stringify(pending));
  const unproven = readinessFixture(t).result;
  assert.equal(unproven.status, "ready", JSON.stringify(unproven));
  assert.ok(codes(unproven.warnings).includes("channel-connection-unproven"), JSON.stringify(unproven));
});

test("the agent status reads channel-not-connected as a channel that did not load", () => {
  const health = assessHealth({ now: NOW, liveness: { state: "alive", lastEvent: "started" }, launchPrompts: { status: "not-engaged" }, readiness: { status: "unavailable", problems: [{ code: "channel-not-connected", message: "x" }], warnings: [] }, identity: { kind: "primary" }, receive: { native: true, receipt: "absent" } });
  assert.equal(health.reachable, "no");
  assert.equal(health.reason.code, "oats.channel_not_loaded");
  assert.equal(health.fixing.by, "operator");
});
