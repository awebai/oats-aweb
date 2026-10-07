// oats.aweb 1.18: delivery by harness. Under `delivery: channel` Claude Code
// takes mail through its channel plugin and pi through its extension; every
// other runtime (Codex, unknown) goes through the host wake broker, exactly as
// `delivery: session` sends every runtime. A home is delivered by one path
// only: a start on the channel path deregisters the home from the broker, a
// start on the broker path registers it.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fakeAwWake } from "./helpers/fake-aw-wake.mjs";
import { assertKernelCheckAnswerRule } from "./helpers/kernel-check-answer-rule.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CAPABILITY = join(REPO, "oats-package", "capabilities", "oats-aweb");
const HOOK = join(CAPABILITY, "bin", "oats-aweb.mjs");
const BINDING = join(CAPABILITY, "bin", "oats-aweb-binding.mjs");
const CHANNEL_FLAG = "--channels plugin:aweb-channel@awebai-marketplace";
const DEV_CHANNEL_FLAG = "--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace";

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-118-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const teamsEnv = JSON.stringify([
  { label: "default", team: "legacy:example.test", default: true, from: "local" },
  { label: "alpha", team: "alpha:example.test", default: false, from: "shared" },
]);

function fixture(t, { delivery, runtime = "claude", settings = {}, daemon = true, daemonVersion } = {}) {
  const fake = fakeAwWake(t, { daemon, ...(daemonVersion ? { daemonVersion } : {}) });
  const ws = tempDir(t), home = join(ws, "agents", "dev", "instances", "dev-1");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(ws, ".aw"), { recursive: true });
  writeFileSync(join(ws, ".aw", "teams.yaml"), "active_team: legacy:example.test\n");
  const merged = { root: ws, ...(delivery ? { delivery } : {}), ...settings };
  const env = {
    PATH: fake.path, OATS_HOME: home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: ws, OATS_WORKSPACE_KEY: "github.com/acme/agents", OATS_WORKSPACE_NAME: "acme",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: "legacy:example.test", OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: teamsEnv, OATS_TEAMS_SOURCE: "live",
    OATS_RUNTIME: runtime, OATS_SETTINGS: JSON.stringify(merged),
  };
  const hook = (event, extra = {}) => {
    const r = spawnSync(process.execPath, [HOOK, event], { cwd: home, env: { ...env, ...extra, OATS_EVENT: event }, encoding: "utf8", timeout: 20000 });
    const last = r.stdout.trim().split("\n").pop();
    return { ...r, doc: last ? JSON.parse(last) : undefined };
  };
  /** Spawn under one runtime; return the meta the kernel records. */
  const spawn = () => { const r = hook("spawn"); assert.equal(r.status, 0, r.stdout + r.stderr); return r.doc; };
  /** Start the spawned home under `runtime`, as the kernel does: the recorded
   *  meta, the captured settings, the previous runtime. */
  const launch = (meta, runtime, { previous, delivery: launchDelivery, extra = {} } = {}) => hook("launch", {
    OATS_META: JSON.stringify(meta), OATS_RUNTIME: runtime, OATS_PREVIOUS_RUNTIME: previous ?? meta.runtime ?? "",
    ...(launchDelivery ? { OATS_SETTINGS: JSON.stringify({ ...merged, delivery: launchDelivery }) } : {}), ...extra,
  });
  const wakeCalls = () => fake.readCalls().filter((c) => c.args[0] === "wake").map((c) => c.args[1]);
  /** The kernel's record of the home's last start: the harness it launched
   *  and the meta this provider returned. */
  const record = (meta, harness) => writeFileSync(join(home, "instance.json"), JSON.stringify({ harness, launch: { harness }, capabilityMeta: { "oats.aweb": meta } }));
  /** The binding readiness check for this home, as the kernel asks it. */
  const readiness = ({ extra = {}, targetHome = home } = {}) => {
    const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: merged, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: env.OATS_WORKSPACE_KEY, deployment: ws, soul: "dev", team: "default", instance: "dev-1", home: targetHome } } };
    const { OATS_SETTINGS, OATS_HOME, OATS_RUNTIME, ...rest } = env;
    const r = spawnSync(process.execPath, [BINDING, "check"], { cwd: home, input: JSON.stringify(input), env: { ...rest, OATS_INSTANCE_HOME: home, ...extra }, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return assertKernelCheckAnswerRule(r.stdout, input, "oats-aweb binding check").result;
  };
  return { fake, ws, home, hook, spawn, launch, wakeCalls, record, readiness, registered: () => fake.registrations()[home] };
}

// ---------------------------------------------------------------- spawn

test("channel: a Codex spawn is registered with the wake broker and briefed for it", (t) => {
  for (const runtime of ["codex", "", "some-new-harness"]) {
    const fx = fixture(t, { delivery: "channel", runtime });
    const doc = fx.spawn();
    assert.deepEqual(fx.registered(), { home: fx.home, identity_home: join(fx.home, ".aw"), delivery: "session" }, `runtime ${JSON.stringify(runtime)}`);
    assert.equal(doc.env.AWEB_DELIVERY, "session");
    assert.equal(doc.launch, undefined);
    assert.match(doc.brief, /Notification delivery: external \(AWEB_DELIVERY=session\): the host wake broker presents/);
    assert.equal(doc.meta.delivery, "channel", "meta records the setting; the path follows the runtime at every start");
  }
});

test("channel: Claude and pi spawns are not registered with the broker and are briefed for their channel", (t) => {
  for (const [runtime, surface] of [["claude", /aweb channel plugin/], ["pi", /aweb pi extension \(@awebai\/pi\)/]]) {
    const fx = fixture(t, { delivery: "channel", runtime });
    const doc = fx.spawn();
    assert.equal(fx.registered(), undefined, runtime);
    assert.deepEqual(fx.wakeCalls(), [], `${runtime}: a channel spawn never touches the broker`);
    assert.equal(doc.env.AWEB_DELIVERY, undefined, runtime);
    assert.match(doc.brief, surface, runtime);
    assert.match(doc.brief, /the host wake broker does not deliver to this home/, runtime);
    assert.doesNotMatch(doc.brief, /AWEB_DELIVERY=session/, runtime);
    assert.deepEqual(doc.launch, runtime === "claude" ? { claude: DEV_CHANNEL_FLAG } : undefined, runtime);
  }
});

test("session keeps its meaning: every runtime is registered with the broker, no channel flag", (t) => {
  for (const runtime of ["claude", "pi", "codex"]) {
    const fx = fixture(t, { delivery: "session", runtime });
    const doc = fx.spawn();
    assert.deepEqual(fx.registered(), { home: fx.home, identity_home: join(fx.home, ".aw"), delivery: "session" }, runtime);
    assert.equal(doc.env.AWEB_DELIVERY, "session", runtime);
    assert.equal(doc.launch, undefined, runtime);
    assert.match(doc.brief, /host wake broker presents/, runtime);
  }
});

// ---------------------------------------------------------------- launch

test("launch codex -> claude under channel: the broker registration is removed, the channel takes over", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "codex" });
  const meta = fx.spawn().meta;
  assert.ok(fx.registered(), "the codex home starts on the broker");
  const r = fx.launch(meta, "claude");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fx.registered(), undefined, "exactly one path: the broker no longer delivers to this home");
  assert.deepEqual(r.doc.launch, { claude: DEV_CHANNEL_FLAG });
  assert.equal(r.doc.env?.AWEB_DELIVERY, undefined);
  assert.equal(r.doc.meta.runtime, "claude");
  assert.equal(r.doc.meta.delivery, "channel");
});

test("launch codex -> pi under channel: the broker registration is removed", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "codex" });
  const meta = fx.spawn().meta;
  assert.ok(fx.registered(), "the codex home starts on the broker");
  const r = fx.launch(meta, "pi");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fx.registered(), undefined);
  assert.equal(r.doc.launch, undefined);
  assert.equal(r.doc.env?.AWEB_DELIVERY, undefined);
});

test("launch claude -> codex under channel: the home is registered with the broker", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude" });
  const meta = fx.spawn().meta;
  assert.equal(fx.registered(), undefined);
  const r = fx.launch(meta, "codex");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fx.registered(), { home: fx.home, identity_home: join(fx.home, ".aw"), delivery: "session" });
  assert.equal(r.doc.env.AWEB_DELIVERY, "session");
  assert.equal(r.doc.launch, undefined);
  assert.equal(r.doc.meta.runtime, "codex");
});

test("launch of a session-spawned home under channel settings: the setting wins and leaves one path", (t) => {
  const fx = fixture(t, { delivery: "session", runtime: "claude" });
  const meta = fx.spawn().meta;
  assert.equal(meta.delivery, "session");
  assert.ok(fx.registered());
  const r = fx.launch(meta, "claude", { delivery: "channel" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fx.registered(), undefined);
  assert.deepEqual(r.doc.launch, { claude: DEV_CHANNEL_FLAG });
  assert.equal(r.doc.env?.AWEB_DELIVERY, undefined);
  assert.equal(r.doc.meta.delivery, "channel");
});

test("launch under session is unchanged: the home stays registered, no channel flag", (t) => {
  for (const runtime of ["claude", "codex"]) {
    const fx = fixture(t, { delivery: "session", runtime });
    const meta = fx.spawn().meta;
    const r = fx.launch(meta, runtime);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(fx.registered(), { home: fx.home, identity_home: join(fx.home, ".aw"), delivery: "session" }, runtime);
    assert.equal(r.doc.env.AWEB_DELIVERY, "session", runtime);
    assert.equal(r.doc.launch, undefined, runtime);
  }
});

test("a start that cannot leave exactly one path is refused", (t) => {
  let fx = fixture(t, { delivery: "channel", runtime: "codex" });
  let meta = fx.spawn().meta;
  let r = fx.launch(meta, "claude", { extra: { FAKE_WAKE_FAIL: "deregister" } });
  assert.notEqual(r.status, 0, "a channel start with a broker registration still in place would deliver twice");
  assert.match(r.doc.warning, /could not remove this home from the host wake broker.*aw wake deregister --home/);

  // aw exits 0 when it falls back to deleting files while the daemon still
  // presents; the start trusts only a status that no longer lists the home.
  fx = fixture(t, { delivery: "channel", runtime: "codex" });
  meta = fx.spawn().meta;
  r = fx.launch(meta, "claude", { extra: { FAKE_WAKE_DEREGISTER_LATE: "1" } });
  assert.notEqual(r.status, 0, "a deregister the status does not confirm leaves two paths");
  assert.match(r.doc.warning, /check `aw wake status` no longer lists it/);

  fx = fixture(t, { delivery: "channel", runtime: "claude" });
  meta = fx.spawn().meta;
  r = fx.launch(meta, "codex", { extra: { FAKE_WAKE_FAIL: "register" } });
  assert.notEqual(r.status, 0, "a codex start the broker cannot deliver to would hear nothing");
  assert.match(r.doc.warning, /aw wake register/);
});

// ---------------------------------------------------------------- retire

test("retire deregisters a codex home under channel, and leaves a claude channel home's broker alone", (t) => {
  let fx = fixture(t, { delivery: "channel", runtime: "codex" });
  let meta = fx.spawn().meta;
  let r = fx.hook("retire", { OATS_META: JSON.stringify(meta) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fx.registered(), undefined);
  assert.ok(fx.wakeCalls().includes("deregister"));

  fx = fixture(t, { delivery: "channel", runtime: "claude" });
  meta = fx.spawn().meta;
  r = fx.hook("retire", { OATS_META: JSON.stringify(meta) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fx.wakeCalls(), []);
});

// ---------------------------------------------------------------- joined teams

test("channel: a codex home's joined team receives through the broker with the primary", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "codex", settings: { join: "alpha" } });
  const doc = fx.spawn();
  const reg = fx.registered();
  assert.equal(reg.runtime_delivery, "external-session");
  assert.deepEqual(reg.receive_identities.map((r) => r.label), ["default", "alpha"]);
  assert.equal(doc.meta.joinedTeams[0].receive, "native");
});

test("launch codex -> claude with a joined team: the broker keeps only the joined identity", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "codex", settings: { join: "alpha" } });
  const meta = fx.spawn().meta;
  assert.equal(fx.registered()?.runtime_delivery, "external-session", "the codex home starts on the broker with its primary");
  const r = fx.launch(meta, "claude");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const reg = fx.registered();
  assert.equal(reg.runtime_delivery, "native-channel");
  assert.equal(reg.primary_identity_home, join(fx.home, ".aw"));
  assert.deepEqual(reg.receive_identities.map((x) => x.label), ["alpha"], "the primary is the channel's, never the broker's");
});

// ---------------------------------------------------------------- launch preview (1.18.1)

/** Everything a launch may change: the aw calls it makes, the broker's
 *  registrations and the provider's own team state. */
function launchEffects(fx) {
  let teamsState;
  try { teamsState = readFileSync(join(fx.home, ".oats-aweb", "teams.json"), "utf8"); } catch { teamsState = undefined; }
  return { calls: fx.fake.readCalls().length, registrations: fx.fake.registrations(), teamsState };
}
/** The part of a launch answer the kernel compares between the preview and
 *  the real pass: the env it sets and the launch arguments. */
const contribution = (doc) => ({ env: doc.env ?? {}, launch: doc.launch ?? {} });

test("a launch preview makes no aw call, writes no meta, and contributes what the real start does", (t) => {
  for (const [delivery, spawned, previewed] of [["channel", "claude", "codex"], ["channel", "codex", "claude"], ["channel", "codex", "pi"], ["session", "claude", "codex"]]) {
    const label = `${delivery}: ${spawned} home previewed as ${previewed}`;
    const fx = fixture(t, { delivery, runtime: spawned, settings: { join: "alpha" } });
    const meta = fx.spawn().meta;
    const before = launchEffects(fx);
    const preview = fx.launch(meta, previewed, { extra: { OATS_LAUNCH_PREVIEW: "1" } });
    assert.equal(preview.status, 0, `${label}: ${preview.stdout}${preview.stderr}`);
    assert.deepEqual(launchEffects(fx), before, `${label}: a preview changes nothing`);
    assert.equal(preview.doc.meta, undefined, `${label}: a preview records nothing`);
    const real = fx.launch(meta, previewed);
    assert.equal(real.status, 0, `${label}: ${real.stdout}${real.stderr}`);
    assert.deepEqual(contribution(preview.doc), contribution(real.doc), `${label}: the kernel refuses a start whose passes differ`);
  }
});

test("the manifest declares the launch hook preview-aware", () => {
  const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));
  assert.equal(manifest.launchPreview, true, "without it the kernel runs the hook once, for real");
});

test("a launch preview leaves a joined team the workspace no longer maps", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "codex", settings: { join: "alpha" } });
  const meta = fx.spawn().meta;
  const before = launchEffects(fx);
  const unmapped = { OATS_TEAMS: JSON.stringify([{ label: "default", team: "legacy:example.test", default: true, from: "local" }]) };
  const preview = fx.launch(meta, "codex", { extra: { ...unmapped, OATS_LAUNCH_PREVIEW: "1" } });
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.deepEqual(launchEffects(fx), before, "the preview neither leaves the team nor re-registers");
  const real = fx.launch(meta, "codex", { extra: unmapped });
  assert.equal(real.status, 0, real.stdout + real.stderr);
  assert.match(real.doc.warning, /left joined team alpha/);
  assert.deepEqual(contribution(preview.doc), contribution(real.doc));
});

test("a launch preview refuses what the real start refuses before any aw call", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings: { identity: { mode: "global", resident: "ops", renew: "sometimes" } } });
  const meta = { identity: { mode: "global", grant: { id: "grant-1" } } };
  const preview = fx.launch(meta, "claude", { extra: { OATS_LAUNCH_PREVIEW: "1" } });
  assert.notEqual(preview.status, 0);
  assert.match(preview.doc.warning, /identity\.renew must be "off" or "launch"/);
  assert.equal(fx.fake.readCalls().length, 0);
  const real = fx.launch(meta, "claude");
  assert.notEqual(real.status, 0);
  assert.match(real.doc.warning, /identity\.renew must be "off" or "launch"/);
});

// ---------------------------------------------------------------- docs

test("agent-facing text and docs state the per-runtime delivery rule", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (...p) => readFileSync(join(...p), "utf8");
  for (const [name, text] of [["inject", read(CAPABILITY, "injects", "aweb.md")], ["oats-aweb skill", read(CAPABILITY, "skills", "oats-aweb", "SKILL.md")]]) {
    assert.match(text, /Claude Code[\s\S]{0,80}channel plugin/, name);
    assert.match(text, /pi[\s\S]{0,40}extension/, name);
    assert.match(text, /Codex[\s\S]{0,200}host wake broker/, name);
    assert.doesNotMatch(text, /Codex \/ no channel \| nothing/, name);
  }
  const manifest = JSON.parse(read(CAPABILITY, "oats.json"));
  assert.match(manifest.settings.delivery.description, /Codex/);
  const readme = read(REPO, "README.md");
  assert.match(readme, /Codex/);
  assert.match(readme, /aweb-abmy/);
  assert.match(readme, /existing homes keep the delivery/i);
  const changelog = read(REPO, "CHANGELOG.md");
  const entry = changelog.split("\n## ").find((section) => section.startsWith("1.18.0\n"));
  assert.ok(entry, "CHANGELOG has a 1.18.0 entry");
  assert.match(entry, /Codex/);
  assert.match(entry, /aweb-abmy/);
  assert.match(entry, /existing homes keep the delivery/i);
  assert.match(entry, /docs\/terminal-wake-broker\.md/, "the aw duplicate window is stated with its citation");
});

test("docs state the launch preview contract and what the deregister guard proves", async () => {
  const { readFileSync } = await import("node:fs");
  const readme = readFileSync(join(REPO, "README.md"), "utf8");
  const changelog = readFileSync(join(REPO, "CHANGELOG.md"), "utf8");
  const entry = changelog.split("\n## ").find((section) => section.startsWith("1.18.1\n"));
  assert.ok(entry, "CHANGELOG has a 1.18.1 entry");
  for (const [name, text] of [["README", readme], ["CHANGELOG 1.18.1", entry]]) {
    assert.match(text, /OATS_LAUNCH_PREVIEW=1/, name);
    assert.match(text, /volatileEnv/, name);
    assert.match(text, /confirms that the home is deregistered, not that terminal input\s+has finished/, name);
    assert.match(text, /aweb-abna/, name);
    assert.doesNotMatch(text, /stopped typing/, name);
  }
});

// A home on the channel path hears nothing without its channel package. The
// kernel verifies these rows for the target runtime at spawn and at every start
// and refuses with the install steps; codex has no row because it takes the
// broker path.
test("channel delivery requires the channel package for Claude and pi only, naming its install command", async () => {
  const { readFileSync } = await import("node:fs");
  const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));
  const channelRows = manifest.requires.filter((r) => r.when?.delivery === "channel");
  assert.deepEqual(channelRows.map((r) => r.runtime).sort(), ["claude", "pi"]);
  for (const row of channelRows) assert.equal(row.ifInstalled, undefined, `${row.runtime}: absence must fail, not pass`);
  const claude = channelRows.find((r) => r.runtime === "claude");
  assert.equal(claude.install, "claude plugin marketplace add awebai/claude-plugins && claude plugin install aweb-channel@awebai-marketplace");
  const pi = channelRows.find((r) => r.runtime === "pi");
  assert.equal(pi.install, "pi install npm:@awebai/pi");
  assert.equal(manifest.requires.some((r) => r.runtime === "codex"), false);
});

// ---------------------------------------------------------------- empty runtime

test("a start under an empty runtime is a broker start, recorded as such, even after a native one", (t) => {
  let fx = fixture(t, { delivery: "channel", runtime: "claude", settings: { join: "alpha" } });
  let meta = fx.spawn().meta;
  let r = fx.launch(meta, "");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.meta.runtime, "", "the start records the runtime it ran under, not the previous one");
  assert.equal(fx.registered().runtime_delivery, "external-session", "the broker owns the primary when no channel runs");
  assert.deepEqual(fx.registered().receive_identities.map((x) => x.label), ["default", "alpha"]);

  fx = fixture(t, { delivery: "channel", runtime: "claude" });
  meta = fx.spawn().meta;
  r = fx.launch(meta, "");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fx.registered());
  fx.record(r.doc.meta, "claude");
  const retired = fx.hook("retire", { OATS_META: JSON.stringify(r.doc.meta), OATS_RUNTIME: "claude" });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(fx.registered(), undefined, "retire follows the recorded runtime, not an ambient or kernel one");
});

// ---------------------------------------------------------------- readiness

test("readiness requires the wake daemon for a home the broker delivers to, by its recorded runtime", (t) => {
  for (const [delivery, runtime, relies] of [["channel", "codex", true], ["session", "claude", true], ["channel", "claude", false], ["channel", "pi", false]]) {
    const fx = fixture(t, { delivery, runtime, daemon: false });
    fx.record(fx.spawn().meta, runtime);
    const result = fx.readiness();
    const problem = result.problems.find((p) => p.code === "wake-daemon-not-running");
    assert.equal(!!problem, relies, `${delivery}/${runtime}: ${JSON.stringify(result)}`);
    assert.equal(result.status, relies ? "unavailable" : "ready");
    if (!relies) assert.ok(result.warnings.some(w => w.code === "native-receive-unproven"));
  }
});

test("readiness reports an outdated wake daemon for a codex channel home", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "codex", daemonVersion: "1.36.6" });
  fx.record(fx.spawn().meta, "codex");
  const result = fx.readiness();
  assert.ok([...result.problems, ...(result.warnings || [])].some((p) => /wake-daemon-outdated/.test(p.code)), JSON.stringify(result));
});

// ------------------------------------------- channel-dev-confirmation (1.21.1)
// Development selection carries consent-boundary guidance through spawn,
// launch and readiness; actual prompt outcomes belong to the kernel.
const DEV_CONFIRMATION_MESSAGE = /Claude Code may stop at its development-channels confirmation .*only a compatible kernel, during its own launch with explicit per-home consent and a qualified exact fixture, may answer; the provider, broker and ordinary agents must never answer/;
const DEV_CONFIRMATION = new RegExp(`channel-dev-confirmation — ${DEV_CONFIRMATION_MESSAGE.source}`);

test("a development Claude start explains bounded kernel confirmation, preview and real alike", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings: {claudeChannelMode:"development"} });
  const meta = fx.spawn().meta;
  const preview = fx.launch(meta, "claude", { extra: { OATS_LAUNCH_PREVIEW: "1" } });
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.match(preview.doc.warning, DEV_CONFIRMATION);
  const real = fx.launch(meta, "claude");
  assert.equal(real.status, 0, real.stdout + real.stderr);
  assert.deepEqual(real.doc.launch, { claude: DEV_CHANNEL_FLAG });
  assert.match(real.doc.warning, DEV_CONFIRMATION);
  assert.match(real.doc.warning, /^oats-aweb: /);
});

test("the confirmation line joins the start's other warnings", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings: { join: "alpha", claudeChannelMode:"development" } });
  const meta = fx.spawn().meta;
  const unmapped = { OATS_TEAMS: JSON.stringify([{ label: "default", team: "legacy:example.test", default: true, from: "local" }]) };
  const r = fx.launch(meta, "claude", { extra: unmapped });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.doc.warning, /left joined team alpha/);
  assert.match(r.doc.warning, DEV_CONFIRMATION);
});

test("a Claude spawn under channel says it too: the spawn's own start carries the flag", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings: {claudeChannelMode:"development"} });
  const r = fx.hook("spawn");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.doc.launch, { claude: DEV_CHANNEL_FLAG });
  assert.match(r.doc.warning, DEV_CONFIRMATION);
});

test("spawns and starts without the Claude channel flag carry no confirmation line", (t) => {
  for (const [delivery, runtime] of [["channel", "codex"], ["channel", "pi"], ["session", "claude"]]) {
    const fx = fixture(t, { delivery, runtime, settings:{claudeChannelMode:"development"} });
    const spawned = fx.hook("spawn");
    assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
    assert.doesNotMatch(spawned.doc.warning || "", /channel-dev-confirmation/, `${delivery}/${runtime} spawn`);
    for (const extra of [{ OATS_LAUNCH_PREVIEW: "1" }, {}]) {
      const r = fx.launch(spawned.doc.meta, runtime, { extra });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.doesNotMatch(r.doc.warning || "", /channel-dev-confirmation/, `${delivery}/${runtime}`);
    }
  }
});

test("readiness warns channel-dev-confirmation for a home whose last start was Claude under channel", (t) => {
  for (const [delivery, runtime, warns] of [["channel", "claude", true], ["channel", "codex", false], ["channel", "pi", false], ["session", "claude", false]]) {
    const fx = fixture(t, { delivery, runtime, settings:{claudeChannelMode:"development"} });
    fx.record(fx.spawn().meta, runtime);
    const result = fx.readiness();
    const warning = (result.warnings || []).find((w) => w.code === "channel-dev-confirmation");
    assert.equal(!!warning, warns, `${delivery}/${runtime}: ${JSON.stringify(result)}`);
    if (delivery === "channel" && runtime === "pi") {
      assert.equal(result.status, "ready", "configured Pi native route carries uncertainty without a broker primary");
      assert.ok(result.warnings.some(w => w.code === "native-receive-unproven"));
    }
    if (warns) {
      assert.match(warning.message, DEV_CONFIRMATION_MESSAGE);
      assert.equal(result.status, "ready", "configured native route carries a connection uncertainty warning");
      assert.ok(result.warnings.some(w => w.code === "native-receive-unproven"));
    }
  }
});

test("readiness without a recorded start does not guess the runtime", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude" });
  const result = fx.readiness();
  assert.equal((result.warnings || []).some((w) => w.code === "channel-dev-confirmation"), false, JSON.stringify(result));
});

test("the skill's readiness table and the changelog name channel-dev-confirmation", () => {
  const skill = readFileSync(join(CAPABILITY, "skills", "oats-aweb", "SKILL.md"), "utf8");
  assert.match(skill, /\| `channel-dev-confirmation` \|/);
  const changelog = readFileSync(join(REPO, "CHANGELOG.md"), "utf8");
  assert.match(changelog, /^## 1\.21\.1\n[\s\S]*channel-dev-confirmation/m);
});

// Released status fields; no worker or successful-prompt telemetry invented.
for (const runtime of ["codex", "claude"]) test(`target readiness rejects daemon-green paused ${runtime} target`, (t) => {
  const fx = fixture(t, { delivery: "channel", runtime, settings: { join: "alpha" } });
  fx.record(fx.spawn().meta, runtime);
  const reg = fx.registered();
  fx.fake.setStatus({ daemon_running: true, daemon_version_state: "reported", daemon_version: "1.36.21", instances: [{ ...reg, phase: "active", paused: true, receive_identities: reg.receive_identities.map(r => ({ ...r, stream_admitted: true, stream_phase: "streaming" })) }] });
  assert.equal(fx.readiness().status, "unavailable");
});


// Synthetic mechanics fixture using only released aw v1.36.21 fields. This
// does not claim that a live broker delivered or a model consumed any message.
// aw v1.36.21/v1.36.23 wake/stream.go names StreamLive "streaming";
// wake/broker.go copies that phase into receive_identities[].stream_phase.
function transportStatus(fx, runtime = "codex") {
  const now = new Date().toISOString();
  const external = runtime === "codex";
  const reg = fx.registered();
  const receive = (reg.receive_identities || [{ identity_home: reg.identity_home, controls: true }]).map(r => ({
    ...r, delivery_owner: "session-hints", stream_admitted: true, stream_phase: "streaming",
  }));
  return { updated_at: now, daemon_running: true, daemon_version_state: "reported", daemon_version: "1.36.21", instances: [{
    ...reg, identity_home: receive[0].identity_home, runtime_delivery: external ? "external-session" : "native-channel",
    phase: "active", paused: false, last_inspect_at: now, last_state: "unknown",
    channel_core: { running: true, readiness_state: "unknown", readiness_waiting: "inspect_done" }, receive_identities: receive,
  }] };
}

function snapshot(dir) {
  return readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? snapshot(join(dir,e.name)) : readFileSync(join(dir,e.name)).toString('base64')]);
}

test("synthetic released unknown-nonshell streaming evidence passes Codex route prerequisites, read-only and independent of caller", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "codex", settings: {join: "alpha"} });
  fx.record(fx.spawn().meta, "codex");
  fx.fake.setStatus(transportStatus(fx));
  const before = snapshot(fx.home), calls = fx.fake.readCalls().length;
  const result = fx.readiness({extra: {AWEB_IDENTITY_HOME: "/foreign/identity", OATS_RUNTIME: "claude"}});
  assert.equal(result.status, "ready", JSON.stringify(result));
  assert.deepEqual(snapshot(fx.home), before);
  assert.deepEqual(fx.fake.readCalls().slice(calls).map(c => c.args), [["version"], ["wake", "status", "--json"]]);
  assert.match(result.warnings.find(w => w.code === "joined-team-receive").message, /observable broker route prerequisites/);
});

const defects = [
  ["malformed event policy", s => s.instances[0].receive_identities[0].event_classes = [null], "wake-target-binding"],
  ["malformed worker errors", s => s.instances[0].channel_core.binding_errors = null, "wake-status-unavailable"],
  ["invalid inspection", s => s.instances[0].last_inspect_at = "invalid", "receive-inspection-unproven"],
  ["future inspection", s => s.instances[0].last_inspect_at = "2999-01-01T00:00:00Z", "receive-inspection-unproven"],
  ["inspection newer than snapshot", s => s.updated_at = new Date(Date.parse(s.instances[0].last_inspect_at)-1).toISOString(), "receive-inspection-unproven"],
  ["future snapshot", s => s.updated_at = "2999-01-01T00:00:00Z", "wake-status-stale"],
  ["malformed snapshot", s => s.updated_at = "invalid", "wake-status-stale"],
  ["shell endpoint", s => {s.instances[0].last_state="shell"; s.instances[0].channel_core.readiness_state="shell";}, "receive-inspection-unproven"],
  ["absent endpoint", s => {s.instances[0].last_state="not-launched"; s.instances[0].channel_core.readiness_state="not-launched";}, "receive-inspection-unproven"],
  ["failed inspection retaining unknown", s => {s.instances[0].channel_core.readiness_waiting="inspect_error"; s.instances[0].channel_core.readiness_error="unavailable";}, "wake-worker-unavailable"],
  ["inspection error without diagnostic", s => s.instances[0].channel_core.readiness_waiting="inspect_error", "receive-inspection-unproven"],
  ["old failed inspection", s => {s.instances[0].last_inspect_at="2020-01-01T00:00:00Z"; s.instances[0].channel_core.readiness_waiting="inspect_error";}, "receive-inspection-unproven"],
  ["inspect_start retaining error", s => {s.instances[0].channel_core.readiness_waiting="inspect_start"; s.instances[0].channel_core.readiness_error="previous inspection failed";}, "wake-worker-unavailable"],
  ["inspect_start retaining stopped endpoint", s => {s.instances[0].channel_core.readiness_waiting="inspect_start"; s.instances[0].last_state="stopped"; s.instances[0].channel_core.readiness_state="stopped";}, "receive-inspection-unproven"],
  ["inspect_start retaining shell endpoint", s => {s.instances[0].channel_core.readiness_waiting="inspect_start"; s.instances[0].last_state="shell"; s.instances[0].channel_core.readiness_state="shell";}, "receive-inspection-unproven"],
  ["wrong-type observation", s => s.instances[0].channel_core.readiness_state=17, "wake-status-unavailable"],
  ["wrong-type inspection", s => s.instances[0].last_inspect_at=17, "receive-inspection-unproven"],
  ["wrong-type snapshot", s => s.updated_at=17, "wake-status-stale"],
  ["contradictory usable observation states", s => s.instances[0].last_state="idle", "wake-status-unavailable"],
  ["inspection error with empty diagnostic", s => {s.instances[0].channel_core.readiness_waiting="inspect_error"; s.instances[0].channel_core.readiness_error="";}, "receive-inspection-unproven"],
  ["conflicting observation state", s => s.instances[0].last_state="stopped", "receive-inspection-unproven"],
  ["worker paused", s => s.instances[0].channel_core.paused=true, "wake-worker-unavailable"],
  ["readiness paused", s => s.instances[0].channel_core.readiness_paused=true, "wake-worker-unavailable"],
  ["worker error without completed inspection", s => {s.instances[0].channel_core.last_error="failed"; s.instances[0].channel_core.readiness_waiting="inspect_start";}, "wake-worker-unavailable"],
  ["target error", s => s.instances[0].last_error="failed", "wake-worker-unavailable"],
  ["missing target", s => s.instances = [], "wake-target-missing"],
  ["duplicate target", s => s.instances.push(s.instances[0]), "wake-target-missing"],
  ["inactive", s => s.instances[0].phase = "inactive", "wake-target-inactive"],
  ["pending", s => s.instances[0].phase = "pending", "wake-target-inactive"],
  ["paused", s => s.instances[0].paused = true, "wake-target-paused"],
  ["pause unknown", s => delete s.instances[0].paused, "wake-target-paused"],
  ["worker stopped", s => s.instances[0].channel_core.running = false, "wake-worker-unavailable"],
  ["worker missing at floor", s => {s.daemon_version = "1.36.13"; delete s.instances[0].channel_core;}, "wake-worker-unavailable"],
  ["worker binding error", s => s.instances[0].channel_core.binding_errors = {alpha: "refused"}, "wake-worker-unavailable"],
  ["refused stream", s => s.instances[0].receive_identities[0].stream_admitted = false, "wake-stream-unavailable"],
  ["missing stream admission", s => delete s.instances[0].receive_identities[0].stream_admitted, "wake-stream-unavailable"],
  ...["starting", "retrying", "quarantined", "stopped", "connected"].map(phase => [
    `non-live stream phase ${phase}`, s => s.instances[0].receive_identities[0].stream_phase = phase, "wake-stream-unavailable",
  ]),
  ["missing stream phase", s => delete s.instances[0].receive_identities[0].stream_phase, "wake-stream-unavailable"],
  ["stream error", s => s.instances[0].receive_identities[0].stream_error = "refused", "wake-stream-unavailable"],
  ["missing binding", s => s.instances[0].receive_identities.pop(), "wake-target-binding"],
  ["extra binding", s => s.instances[0].receive_identities.push({...s.instances[0].receive_identities[0], identity_home: "/wrong"}), "wake-target-binding"],
  ["wrong binding", s => s.instances[0].receive_identities[0].identity_home = "/wrong", "wake-target-binding"],
  ["wrong owner", s => s.instances[0].receive_identities[0].delivery_owner = "native", "wake-target-binding"],
  ["missing owner", s => delete s.instances[0].receive_identities[0].delivery_owner, "wake-target-binding"],
  ["wrong controls", s => s.instances[0].receive_identities[0].controls = false, "wake-target-binding"],
  ["wrong event policy", s => s.instances[0].receive_identities[0].event_classes = ["mail"], "wake-target-binding"],
  ["wrong label", s => s.instances[0].receive_identities[0].label = "wrong", "wake-target-binding"],
  ["wrong team", s => s.instances[0].receive_identities[0].team_id = "wrong:example.test", "wake-target-binding"],
  ["wrong runtime", s => s.instances[0].runtime_delivery = "native-channel", "wake-target-binding"],
  ["malformed status", s => s.instances = null, "wake-status-unavailable"],
  ["daemon unknown", s => delete s.daemon_running, "wake-daemon-not-running"],
  ["daemon version unknown", s => delete s.daemon_version, "wake-daemon-version-unknown"],
];
for (const [name, change, code] of defects) test(`target readiness rejects ${name}`, (t) => {
  const fx = fixture(t, {delivery: "channel", runtime: "codex"});
  fx.record(fx.spawn().meta, "codex");
  const status = transportStatus(fx); change(status); fx.fake.setStatus(status);
  const result = fx.readiness();
  assert.equal(result.status, "unavailable", JSON.stringify(result));
  assert.ok(result.problems.some(p => p.code === code), JSON.stringify(result));
});

test("unreadable or malformed status is unavailable without writes", (t) => {
  const fx = fixture(t, {delivery:"channel", runtime:"codex"}); fx.record(fx.spawn().meta, "codex");
  for (const raw of ["{", "null", "[]"]) { fx.fake.setStatus(raw); assert.equal(fx.readiness().status,"unavailable"); }
  assert.equal(fx.readiness({extra:{FAKE_WAKE_FAIL:"status"}}).status,"unavailable");
});

test("null-home readiness remains prerequisites only", (t) => {
  const fx = fixture(t, {delivery:"session",runtime:"codex"});
  const result=fx.readiness({targetHome:null});
  assert.equal(result.status,"ready",JSON.stringify(result));
  assert.deepEqual(fx.wakeCalls(),[]);
});

test("mixed native primary retains failed joined problem and confirmation guidance", (t) => {
  const fx = fixture(t, {delivery:"channel",runtime:"claude",settings:{join:"alpha",claudeChannelMode:"development"}});
  fx.record(fx.spawn().meta,"claude"); const status=transportStatus(fx,"claude"); status.instances[0].channel_core.running=false; fx.fake.setStatus(status);
  const result=fx.readiness(); assert.equal(result.status,"unavailable");
  assert.ok(result.warnings.some(p=>p.code==='native-receive-unproven'));
  assert.ok(result.problems.some(p=>p.code==='wake-worker-unavailable'));
  assert.ok(result.warnings.some(p=>p.code==='channel-dev-confirmation'));
  assert.ok(result.warnings.some(p=>p.code==='joined-team-poll-only'));
});

for (const transition of ['join', 'leave']) test(`retained disk membership wins over launch metadata after ${transition}`, (t) => {
  const fx=fixture(t,{delivery:'channel',runtime:'codex',settings:{join:'alpha'}});
  const meta=fx.spawn().meta;
  const status=transportStatus(fx);
  if(transition==='join') meta.joinedTeams=[];
  else {
    writeFileSync(join(fx.home,'.oats-aweb','teams.json'),JSON.stringify({joinedTeams:[]}));
    rmSync(meta.joinedTeams[0].identityHome,{recursive:true}); // valid old metadata may name a departed identity
    status.instances[0].receive_identities=status.instances[0].receive_identities.filter(r=>r.controls);
    delete status.instances[0].receive_identities[0].label;
  }
  fx.record(meta,'codex');fx.fake.setStatus(status);
  assert.equal(fx.readiness().status,'ready');
});

test('captured locators and retained membership fail closed, including global early-return records', async(t)=>{
  const {expectedReceive}=await import('../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs');
  const home=tempDir(t), primary=join(home,'.aw'), grant=join(home,'.aweb-identity-100'), newer=join(home,'.aweb-identity-200');
  for(const dir of [primary,grant,newer,join(home,'.oats-aweb')])mkdirSync(dir);
  const file=join(home,'.oats-aweb','teams.json');
  const record=(meta,identityHome)=>writeFileSync(join(home,'instance.json'),JSON.stringify({capabilityMeta:{'oats.aweb':meta},launch:{hooks:{env:{AWEB_IDENTITY_HOME:identityHome}}}}));
  const local={delivery:'channel',runtime:'codex',identity:{mode:'local',team:'default:example.test'}};
  const global={...local,identity:{mode:'global',grant:{id:'g-100',home:grant}}};
  const unavailable=()=>assert.equal(expectedReceive(home).problems[0]?.code,'receive-record-unavailable');
  record(local,primary); unavailable(); // missing local state
  for(const raw of ['{','null','{}','{"joinedTeams":[null]}','{"joinedTeams":[{"label":"alpha","team":"a:example.test","identityHome":"relative"}]}']){
    writeFileSync(file,raw);unavailable();
  }
  writeFileSync(file,JSON.stringify({joinedTeams:[]}));
  assert.equal(expectedReceive(home).bindings[0].identity_home,primary);
  record(local,'/foreign/identity');unavailable();
  record({...local,delivery:'invalid'},primary);unavailable();
  record({...local,identity:{mode:'global',grant:{id:'bad'}}},primary);unavailable();
  rmSync(file);record(global,grant);
  assert.equal(expectedReceive(home).bindings[0].identity_home,grant,'final locator beats newer directory and ambient environment');
  record(global,newer);unavailable();
  record({...global,joinedTeams:[{label:'alpha',team:'a:example.test',identityHome:newer}]},grant);unavailable();
  record({...local,retained:true,identity:{mode:'global'}},primary);
  assert.equal(expectedReceive(home).bindings[0].identity_home,primary,'retained-root early return has no joined file');
  writeFileSync(file,'{');unavailable();
  writeFileSync(file,JSON.stringify({joinedTeams:[{label:'alpha',team:'a:example.test',identityHome:newer}]}));unavailable();
  record(local,primary);
  writeFileSync(file,JSON.stringify({joinedTeams:[{label:'alpha',team:'a:example.test',identityHome:primary}]}));unavailable();
  const alias=join(home,'identity-alias');symlinkSync(primary,alias);
  writeFileSync(file,JSON.stringify({joinedTeams:[]}));record(local,alias);
  assert.equal(expectedReceive(home).problems.length,0,'canonical locator aliases agree');
});

test('observation-age warning boundaries, quiet workers and timing skew use an injected clock', async(t)=>{
  const {targetReceiveAssessment}=await import('../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs');
  const home=tempDir(t), primary=join(home,'.aw'), observed=Date.parse('2026-10-05T12:00:00.000Z');
  mkdirSync(primary);
  const expected={home,runtimeDelivery:'external-session',primary,bindings:[{identity_home:primary,controls:true,event_classes:[]}]};
  const status={updated_at:new Date(observed).toISOString(),daemon_running:true,daemon_version_state:'reported',daemon_version:'1.36.21',instances:[{
    home,identity_home:primary,runtime_delivery:'external-session',delivery:'session',phase:'active',paused:false,
    receive_identities:[{identity_home:primary,delivery_owner:'session-hints',controls:true,stream_admitted:true,stream_phase:'streaming'}],
    last_state:'unknown',last_inspect_at:new Date(observed).toISOString(),channel_core:{running:true,readiness_state:'unknown',readiness_waiting:'inspect_done'},
  }]};
  const evaluate=(now)=>targetReceiveAssessment(status,expected,{minimumVersion:'1.36.13',now});
  for(const elapsed of [0,29999,30000]) assert.deepEqual(evaluate(observed+elapsed),{problems:[],warnings:[]},String(elapsed));
  let answer=evaluate(observed+30001);
  assert.deepEqual(answer.problems,[]);
  assert.ok(answer.warnings.some(w=>w.code==='receive-observation-aged'));
  status.updated_at=new Date(observed+30001).toISOString();
  answer=evaluate(observed+30001);
  assert.deepEqual(answer.problems,[],'new snapshot with quiet old observation remains configured route ready');
  assert.ok(answer.warnings.some(w=>w.code==='receive-observation-aged'),'fresh snapshot cannot freshen the observation');
  // A prospective 30s poll plus inspection/jitter may exceed the warning
  // threshold. This changes the warning, never certifies current liveness.
  assert.match(answer.warnings.find(w=>w.code==='receive-observation-aged').message,/30(?:\.001|001| seconds)/);
  status.instances[0].last_inspect_at=status.updated_at;
  assert.deepEqual(evaluate(observed+30001),{problems:[],warnings:[]});
  assert.equal(evaluate(observed+30000).problems[0].code,'wake-status-stale','future timestamp remains malformed evidence');
  status.updated_at=new Date(observed+30000).toISOString();
  assert.equal(evaluate(observed+30001).problems[0].code,'receive-inspection-unproven','inspection cannot follow its snapshot');
  status.instances[0].last_inspect_at='not-a-timestamp';
  assert.equal(evaluate(observed+30001).problems[0].code,'receive-inspection-unproven');
  status.updated_at='2026-02-30T12:00:00Z';
  status.instances[0].last_inspect_at=status.updated_at;
  assert.equal(evaluate(Date.parse('2026-03-02T12:00:00Z')).problems[0].code,'wake-status-stale','impossible date must not normalize to an observation');
});

test('failed prerequisites preserve configuration diagnostics without querying a recorded receive path', (t) => {
  const fx = fixture(t, {delivery:'channel', runtime:'codex'});
  fx.record(fx.spawn().meta, 'codex');
  const status = transportStatus(fx); status.instances[0].paused = true; fx.fake.setStatus(status);
  const before = snapshot(fx.home), calls = fx.fake.readCalls().length;
  const result = fx.readiness({extra:{OATS_DEFAULT_TEAM_ID:'not a team id'}});
  assert.deepEqual(result, {status:'needs-configuration', problems:[{
    code:'needs-configuration', message:'aweb team ids must have shape <name>:<namespace> (name matches ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$; namespace is a hostname)',
  }], warnings:[]});
  assert.deepEqual(fx.fake.readCalls().slice(calls), [], 'malformed configuration runs no aw call, including receive status');
  assert.deepEqual(snapshot(fx.home), before);
});

// Revised route claim: these four expectations were first run against a8daef48.
for (const scenario of ['native', 'aged', 'inspect_start', 'legacy']) test(`route claim revision accepts ${scenario} with explicit uncertainty`, (t) => {
  const native = scenario === 'native';
  const fx = fixture(t, {delivery:'channel', runtime:native ? 'claude' : 'codex'});
  if (scenario !== 'legacy') {
    fx.record(fx.spawn().meta, native ? 'claude' : 'codex');
    if (!native) {
      const status = transportStatus(fx);
      if (scenario === 'aged') status.instances[0].last_inspect_at = '2020-01-01T00:00:00Z';
      if (scenario === 'inspect_start') status.instances[0].channel_core.readiness_waiting = 'inspect_start';
      fx.fake.setStatus(status);
    }
  }
  const result = fx.readiness();
  assert.equal(result.status, 'ready', JSON.stringify(result));
  const code = {native:'native-receive-unproven', aged:'receive-observation-aged', inspect_start:'receive-inspection-pending', legacy:'receive-ownership-unproven'}[scenario];
  assert.ok(result.warnings.some(w => w.code === code), JSON.stringify(result));
  assert.deepEqual(result.problems, []);
});

// Released Go status omits zero-value observation fields. This is distinct
// from channel_core itself/running, which is required worker evidence.
for (const [name, change] of [
  ['missing inspection timestamp', s => delete s.instances[0].last_inspect_at],
  ['missing snapshot timestamp', s => delete s.updated_at],
  ['missing worker observation state', s => delete s.instances[0].channel_core.readiness_state],
  ['missing target observation state', s => delete s.instances[0].last_state],
  ['missing inspection waiting', s => delete s.instances[0].channel_core.readiness_waiting],
  ['all optional observations omitted', s => {delete s.updated_at; delete s.instances[0].last_inspect_at; delete s.instances[0].last_state; delete s.instances[0].channel_core.readiness_state; delete s.instances[0].channel_core.readiness_waiting;}],
  ['last input cannot substitute for inspection', s => {delete s.instances[0].last_inspect_at; Object.assign(s.instances[0].channel_core,{last_success_at:s.updated_at,last_input_at:s.updated_at});}],
]) test(`route readiness warns for ${name}`, t => {
  const fx=fixture(t,{delivery:'channel',runtime:'codex'});
  fx.record(fx.spawn().meta,'codex');
  const status=transportStatus(fx); change(status); fx.fake.setStatus(status);
  const before=snapshot(fx.home), calls=fx.fake.readCalls().length;
  const result=fx.readiness();
  assert.equal(result.status,'ready',JSON.stringify(result));
  assert.deepEqual(result.problems,[]);
  assert.ok(result.warnings.some(w=>w.code==='receive-observation-unproven'),JSON.stringify(result));
  assert.doesNotMatch(result.warnings.map(w=>w.message).join(' '), /has (?:a )?successful|completed successful|proves? (?:a )?successful/i,'absent observations never earn successful-history text');
  assert.deepEqual(snapshot(fx.home),before);
  assert.deepEqual(fx.fake.readCalls().slice(calls).map(c=>c.args),[['version'],['wake','status','--json']]);
});

for(const raw of ['{','null','[]','{"capabilityMeta":{"oats.aweb":null}}','{"capabilityMeta":{"oats.aweb":{"delivery":false}}}','{"capabilityMeta":{"oats.aweb":{"runtime":false}}}']) test(`legacy fallback rejects malformed supplied record ${raw}`,t=>{
  const fx=fixture(t,{delivery:'channel',runtime:'codex'});
  writeFileSync(join(fx.home,'instance.json'),raw);
  const before=snapshot(fx.home), calls=fx.fake.readCalls().length;
  const result=fx.readiness();
  assert.equal(result.status,'unavailable',JSON.stringify(result));
  assert.ok(result.problems.some(p=>p.code==='receive-record-unavailable'),JSON.stringify(result));
  assert.deepEqual(snapshot(fx.home),before);
  assert.deepEqual(fx.fake.readCalls().slice(calls).map(c=>c.args),[['version']]);
});

test('legacy fallback rejects an unreadable instance record rather than pretending it is absent',t=>{
  const fx=fixture(t,{delivery:'channel',runtime:'codex'});
  mkdirSync(join(fx.home,'instance.json'));
  const result=fx.readiness();
  assert.equal(result.status,'unavailable',JSON.stringify(result));
  assert.ok(result.problems.some(p=>p.code==='receive-record-unavailable'));
});

// Older provider records can lack delivery/runtime while retaining identity
// and membership. The fallback qualifies unknown ownership and still checks
// every retained joined path; caller runtime is not captured-plan authority.
for(const failed of [false,true]) test(`legacy missing composition retains ${failed?'failed':'healthy'} joined checks`,t=>{
  const fx=fixture(t,{delivery:'channel',runtime:'codex',settings:{join:'alpha'}});
  const meta=fx.spawn().meta;
  delete meta.delivery; delete meta.runtime;
  fx.record(meta,undefined);
  const status=transportStatus(fx);
  if(failed) status.instances[0].receive_identities.find(r=>r.label==='alpha').stream_admitted=false;
  fx.fake.setStatus(status);
  const result=fx.readiness({extra:{OATS_RUNTIME:'claude',AWEB_IDENTITY_HOME:'/foreign/identity'}});
  assert.equal(result.status,failed?'unavailable':'ready',JSON.stringify(result));
  assert.ok(result.warnings.some(w=>w.code==='receive-ownership-unproven'),JSON.stringify(result));
  if(failed) assert.ok(result.problems.some(p=>p.code==='wake-stream-unavailable'),JSON.stringify(result));
  else assert.deepEqual(result.problems,[]);
});

for(const corruption of ['missing-identity','malformed-state','wrong-control','wrong-policy','duplicate-joined']) test(`legacy known joins reject ${corruption}`,t=>{
  const fx=fixture(t,{delivery:'channel',runtime:'codex',settings:{join:'alpha'}});
  const meta=fx.spawn().meta; delete meta.delivery; delete meta.runtime; fx.record(meta,undefined);
  const status=transportStatus(fx), joined=status.instances[0].receive_identities.find(r=>r.label==='alpha');
  if(corruption==='missing-identity') rmSync(meta.joinedTeams[0].identityHome,{recursive:true});
  if(corruption==='malformed-state') writeFileSync(join(fx.home,'.oats-aweb','teams.json'),'{');
  if(corruption==='wrong-control') joined.controls=true;
  if(corruption==='wrong-policy') joined.event_classes=['mail'];
  if(corruption==='duplicate-joined') status.instances[0].receive_identities.push({...joined});
  fx.fake.setStatus(status);
  const result=fx.readiness();
  assert.equal(result.status,'unavailable',JSON.stringify(result));
  assert.ok(result.problems.some(p=>p.code===(['missing-identity','malformed-state'].includes(corruption)?'receive-record-unavailable':'wake-target-binding')),JSON.stringify(result));
});

for(const [name,settingsDelivery,capturedDelivery,runtime,needsBroker] of [
  ['captured channel wins over session setting without runtime','session','channel',undefined,false],
  ['captured session requires broker without runtime','channel','session',undefined,true],
  ['missing delivery uses session prerequisite setting','session',undefined,undefined,true],
  ['captured empty runtime is external under channel','channel','channel','',true],
]) test(`legacy projection: ${name}`,t=>{
  const fx=fixture(t,{delivery:settingsDelivery,runtime:'codex'}), meta=fx.spawn().meta;
  if(capturedDelivery===undefined) delete meta.delivery; else meta.delivery=capturedDelivery;
  if(runtime===undefined) delete meta.runtime; else meta.runtime=runtime;
  fx.record(meta,undefined);
  const status=transportStatus(fx); status.instances[0].channel_core.running=false; fx.fake.setStatus(status);
  const calls=fx.fake.readCalls().length;
  const result=fx.readiness();
  assert.equal(result.status,needsBroker?'unavailable':'ready',JSON.stringify(result));
  if(runtime===undefined || capturedDelivery===undefined) assert.ok(result.warnings.some(w=>w.code==='receive-ownership-unproven'));
  if(needsBroker) assert.ok(result.problems.some(p=>p.code==='wake-worker-unavailable'),JSON.stringify(result));
  assert.equal(fx.fake.readCalls().slice(calls).filter(c=>c.args[0]==='wake').length,needsBroker?1:0);
});

test('legacy absent disk state preserves captured known joins and tolerates otherwise valid unknown bindings',t=>{
  const fx=fixture(t,{delivery:'channel',runtime:'codex',settings:{join:'alpha'}});
  const meta=fx.spawn().meta; delete meta.delivery; delete meta.runtime; fx.record(meta,undefined);
  rmSync(join(fx.home,'.oats-aweb','teams.json'));
  const status=transportStatus(fx);
  // Full ownership is unknown; do not invent an exact primary plan from the
  // observed broker row. A valid extra stream cannot erase the known alpha.
  status.instances[0].receive_identities.push({identity_home:'/legacy/other',label:'other',controls:false,event_classes:['mail','chat'],delivery_owner:'session-hints',stream_admitted:true,stream_phase:'streaming'});
  fx.fake.setStatus(status);
  const result=fx.readiness();
  assert.equal(result.status,'ready',JSON.stringify(result));
  assert.ok(result.warnings.some(w=>w.code==='receive-ownership-unproven'));
  assert.ok(result.warnings.some(w=>w.code==='joined-team-receive'));
  status.instances[0].receive_identities.find(r=>r.label==='alpha').stream_admitted=false;
  fx.fake.setStatus(status);
  assert.equal(fx.readiness().status,'unavailable','missing optional disk file does not erase captured joined failure');
});

test('legacy absent membership permits qualified prerequisites but malformed supplied membership does not',t=>{
  const fx=fixture(t,{delivery:'channel',runtime:'claude'});
  writeFileSync(join(fx.home,'instance.json'),JSON.stringify({capabilityMeta:{'oats.aweb':{}}}));
  const result=fx.readiness();
  assert.equal(result.status,'ready',JSON.stringify(result));
  assert.ok(result.warnings.some(w=>w.code==='receive-ownership-unproven'));
  mkdirSync(join(fx.home,'.oats-aweb'));
  writeFileSync(join(fx.home,'.oats-aweb','teams.json'),'{');
  const malformed=fx.readiness();
  assert.equal(malformed.status,'unavailable',JSON.stringify(malformed));
  assert.ok(malformed.problems.some(p=>p.code==='receive-record-unavailable'));
});

for(const incomplete of [false,true]) for(const [name,change,code] of [
  ['wrong-type primary locator',s=>s.instances[0].primary_identity_home=false,'wake-target-binding'],
  ['contradictory primary locator',s=>s.instances[0].primary_identity_home='/foreign/primary','wake-target-binding'],
  ['aggregate refused stream',s=>s.instances[0].stream_admitted=false,'wake-stream-unavailable'],
  ['wrong-type stream error',s=>s.instances[0].receive_identities[0].stream_error=false,'wake-status-unavailable'],
]) test(`${incomplete?'partial':'complete'} target preserves ${name} failure`,t=>{
  const fx=fixture(t,{delivery:'session',runtime:'codex'}),meta=fx.spawn().meta;
  if(incomplete) delete meta.runtime;
  fx.record(meta,incomplete?undefined:'codex');
  const status=transportStatus(fx);change(status);fx.fake.setStatus(status);
  const result=fx.readiness();
  assert.equal(result.status,'unavailable',JSON.stringify(result));
  assert.ok(result.problems.some(p=>p.code===code),JSON.stringify(result));
});

for(const [name,change] of [
  ['missing primary controls',s=>delete s.instances[0].receive_identities[0].controls],
  ['restricted primary events',s=>s.instances[0].receive_identities[0].event_classes=['mail']],
]) test(`partial captured session retains ${name} contradiction`,t=>{
  const fx=fixture(t,{delivery:'session',runtime:'codex'}),meta=fx.spawn().meta;delete meta.runtime;fx.record(meta,undefined);
  const status=transportStatus(fx);change(status);fx.fake.setStatus(status);
  const result=fx.readiness();
  assert.equal(result.status,'unavailable',JSON.stringify(result));
  assert.ok(result.problems.some(p=>p.code==='wake-target-binding'));
});

test('missing home is not an absent legacy instance record',async t=>{
  const {expectedReceive}=await import('../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs');
  const home=join(tempDir(t),'does-not-exist');
  assert.equal(expectedReceive(home).problems[0]?.code,'receive-record-unavailable');
});

for (const delivery of [undefined,'channel','session']) for (const mismatch of [false,true]) test(`partial primary team ${mismatch?'contradiction':'agreement'} with ${delivery??'absent'} delivery`, t => {
  const fx=fixture(t,{delivery:'channel',runtime:'codex',settings:{join:'alpha'}});
  const meta=fx.spawn().meta;
  delete meta.runtime;
  if(delivery===undefined) delete meta.delivery; else meta.delivery=delivery;
  fx.record(meta,undefined);
  const status=transportStatus(fx);
  status.instances[0].receive_identities[0].team_id=mismatch?'contradictory:example.test':meta.identity.team;
  fx.fake.setStatus(status);
  const before=snapshot(fx.home),calls=fx.fake.readCalls().length;
  const result=fx.readiness();
  assert.equal(result.status,mismatch?'unavailable':'ready',JSON.stringify(result));
  assert.ok(result.warnings.some(w=>w.code==='receive-ownership-unproven'));
  if(mismatch) assert.ok(result.problems.some(p=>p.code==='wake-target-binding'));
  else assert.deepEqual(result.problems,[]);
  assert.deepEqual(snapshot(fx.home),before);
  assert.deepEqual(fx.fake.readCalls().slice(calls).map(c=>c.args),[['version'],['wake','status','--json']]);
});

for (const parent of ['absent','directory','dangling-symlink','valid-symlink']) test(`legacy state parent ${parent} classification`, async t => {
  const {expectedReceive}=await import('../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs');
  const home=tempDir(t),state=join(home,'.oats-aweb');
  const record=JSON.stringify({capabilityMeta:{'oats.aweb':{delivery:'channel',team:'retained:example.test'}}});
  writeFileSync(join(home,'instance.json'),record);
  if(parent==='directory') mkdirSync(state);
  if(parent.endsWith('symlink')) {
    const destination=join(home,'state-location');
    if(parent==='valid-symlink') mkdirSync(destination);
    symlinkSync(destination,state);
  }
  const before=readdirSync(home);
  const result=expectedReceive(home);
  if(parent==='dangling-symlink') assert.equal(result.problems[0]?.code,'receive-record-unavailable');
  else {
    assert.deepEqual(result.problems,[]);
    assert.ok(result.warnings.some(w=>w.code==='receive-ownership-unproven'));
    assert.deepEqual(result.joined,[]);
    assert.equal(result.brokerRequired,false);
  }
  assert.deepEqual(readdirSync(home),before);
  assert.equal(readFileSync(join(home,'instance.json'),'utf8'),record);
});

for (const record of ['instance.json', '.oats-aweb/teams.json']) test(`dangling ${record} is unreadable rather than legacy absence`, async t => {
  const {expectedReceive}=await import('../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs');
  const home=tempDir(t);
  mkdirSync(join(home,'.oats-aweb'));
  symlinkSync(join(home,'missing-record'),join(home,record));
  assert.equal(expectedReceive(home).problems[0]?.code,'receive-record-unavailable');
});

for(const joinedTeams of [null,[null],[{label:'alpha',team:'a:example.test',identityHome:'relative'}]]) test(`malformed captured membership ${JSON.stringify(joinedTeams)} cannot hide behind valid disk`,t=>{
  const fx=fixture(t,{delivery:'channel',runtime:'claude'}),meta=fx.spawn().meta;
  delete meta.delivery;delete meta.runtime;delete meta.claudeChannelMode;meta.joinedTeams=joinedTeams;fx.record(meta,undefined);
  const result=fx.readiness();
  assert.equal(result.status,'unavailable',JSON.stringify(result));
  assert.ok(result.problems.some(p=>p.code==='receive-record-unavailable'));
});

// Synthetic shape reported by the paired maintainer on Linux/session Claude
// (PR53 comment6007038771). Live delivery is peer evidence, not this fixture.
function retainedWorkerErrorFixture(home) {
  const now=Date.parse('2026-10-05T12:00:00Z'), primary=join(home,'.aw');
  const expected={home,runtimeDelivery:'external-session',primary,bindings:[{identity_home:primary,controls:true,event_classes:[]}]};
  const status={daemon_running:true,daemon_version_state:'reported',daemon_version:'1.36.23',updated_at:new Date(now).toISOString(),instances:[{
    home,identity_home:primary,runtime_delivery:'external-session',delivery:'session',paused:false,phase:'active',last_state:'unknown',last_inspect_at:new Date(now).toISOString(),
    receive_identities:[{identity_home:primary,controls:true,delivery_owner:'session-hints',stream_admitted:true,stream_phase:'streaming'}],
    channel_core:{running:true,readiness_state:'unknown',readiness_waiting:'inspect_done',last_success_at:new Date(now-41000).toISOString(),last_error:'E_RUNTIME_AUTHORITY_MISMATCH: instance metadata disagrees with independent session receipt'},
  }]};
  return {now,expected,status};
}

for(const timing of ['peer','no-input-success','old-input-success','no-observation-timestamps','old-observation']) test(`retained worker error warns with completed nonfailure observation: ${timing}`,async t=>{
  const {targetReceiveAssessment}=await import('../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs');
  const {now,expected,status}=retainedWorkerErrorFixture(tempDir(t)),row=status.instances[0];
  if(timing==='no-input-success') delete row.channel_core.last_success_at;
  if(timing==='old-input-success') row.channel_core.last_success_at='2020-01-01T00:00:00Z';
  if(timing==='no-observation-timestamps') {delete status.updated_at;delete row.last_inspect_at;}
  if(timing==='old-observation') {status.updated_at='2020-01-01T00:00:00Z';row.last_inspect_at=status.updated_at;}
  const before=structuredClone(status);
  const result=targetReceiveAssessment(status,expected,{minimumVersion:'1.36.13',now});
  assert.deepEqual(result.problems,[],JSON.stringify(result));
  const warning=result.warnings.find(w=>w.code==='wake-worker-error-retained');
  assert.ok(warning,JSON.stringify(result));
  assert.match(warning.message,/unproven currency/);
  assert.match(warning.message,/E_RUNTIME_AUTHORITY_MISMATCH/);
  assert.doesNotMatch(warning.message,/resolved|cleared|after the error|later success|historic/);
  assert.deepEqual(status,before);
});

for(const [name,change,code] of [
  ['inspect_error',r=>r.channel_core.readiness_waiting='inspect_error','receive-inspection-unproven'],
  ['readiness_error',r=>r.channel_core.readiness_error='inspection failed','wake-worker-unavailable'],
  ['stopped',r=>{r.last_state='stopped';r.channel_core.readiness_state='stopped';},'receive-inspection-unproven'],
  ['nonrunning',r=>r.channel_core.running=false,'wake-worker-unavailable'],
  ['row error',r=>r.last_error='target failed','wake-worker-unavailable'],
  ['conflict',r=>r.conflict_home='/other/home','wake-worker-unavailable'],
  ['binding error',r=>r.channel_core.binding_errors={alpha:'consumer failed'},'wake-worker-unavailable'],
  ['stream error',r=>r.receive_identities[0].stream_error='stream failed','wake-stream-unavailable'],
  ['target pause',r=>r.paused=true,'wake-target-paused'],
  ['worker pause',r=>r.channel_core.paused=true,'wake-worker-unavailable'],
  ['readiness pause',r=>r.channel_core.readiness_paused=true,'wake-worker-unavailable'],
  ['inspect_start',r=>r.channel_core.readiness_waiting='inspect_start','wake-worker-unavailable'],
  ['missing completion',r=>delete r.channel_core.readiness_waiting,'wake-worker-unavailable'],
  ['missing completed state',r=>delete r.channel_core.readiness_state,'wake-worker-unavailable'],
  ['empty completed state',r=>r.channel_core.readiness_state='','wake-worker-unavailable'],
  ['malformed retained error',r=>r.channel_core.last_error=false,'wake-status-unavailable'],
  ['malformed state',r=>r.channel_core.readiness_state=42,'wake-status-unavailable'],
  ['conflicting states',r=>r.last_state='idle','wake-status-unavailable'],
  ['invalid observation timestamp',r=>r.last_inspect_at='bad','receive-inspection-unproven'],
]) test(`retained worker error cannot mask ${name} with recent input success`,async t=>{
  const {targetReceiveAssessment}=await import('../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs');
  const {now,expected,status}=retainedWorkerErrorFixture(tempDir(t)),row=status.instances[0];
  row.channel_core.last_success_at=status.updated_at;
  change(row);
  const result=targetReceiveAssessment(status,expected,{minimumVersion:'1.36.13',now});
  assert.equal(result.problems[0]?.code,code,JSON.stringify(result));
  assert.equal(result.warnings.some(w=>w.code==='wake-worker-error-retained'),false);
});

test('retained worker error diagnostic is bounded and contains no terminal controls',async t=>{
  const {targetReceiveAssessment}=await import('../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs');
  const {now,expected,status}=retainedWorkerErrorFixture(tempDir(t));
  status.instances[0].channel_core.last_error='failure\n\u001b[31m'+ 'x'.repeat(2000);
  const result=targetReceiveAssessment(status,expected,{minimumVersion:'1.36.13',now});
  assert.deepEqual(result.problems,[]);
  const message=result.warnings.find(w=>w.code==='wake-worker-error-retained').message;
  assert.doesNotMatch(message,/[\u0000-\u001f\u007f-\u009f]/);
  assert.ok(message.length<350);
});

test('retained worker error reaches session Claude readiness as a warning without writes or probes',t=>{
  const fx=fixture(t,{delivery:'session',runtime:'claude'});
  fx.record(fx.spawn().meta,'claude');
  const status=transportStatus(fx);
  status.daemon_version='1.36.23';
  status.instances[0].channel_core.last_error='E_RUNTIME_AUTHORITY_MISMATCH: instance metadata disagrees with independent session receipt';
  status.instances[0].channel_core.last_success_at=new Date(Date.parse(status.updated_at)-41000).toISOString();
  fx.fake.setStatus(status);
  const before=snapshot(fx.home),calls=fx.fake.readCalls().length;
  const result=fx.readiness();
  assert.equal(result.status,'ready',JSON.stringify(result));
  assert.deepEqual(result.problems,[]);
  assert.ok(result.warnings.some(w=>w.code==='wake-worker-error-retained'));
  assert.deepEqual(snapshot(fx.home),before);
  assert.deepEqual(fx.fake.readCalls().slice(calls).map(c=>c.args),[['version'],['wake','status','--json']]);
});

// Unchanged sanitized status exported by josep-reyero/oats-maintainer-pepe:
// https://github.com/awebai/oats-aweb/pull/53#issuecomment-6007169594
// SHA256 02746fda83edbe1ac4bce2aeca1d9b2f30119fb2b6664fb7f6a739f8fffcd60e.
// Receiving/presentation/public-inspect success is separately peer-reported;
// the error has no timestamp with which to order it against these observations.
test('unchanged sanitized peer status warns about retained error and observation age',async()=>{
  const {targetReceiveAssessment}=await import('../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs');
  const status=JSON.parse(readFileSync(join(REPO,'test','fixtures','readiness-peer-status-6007169594.json'),'utf8'));
  const expected={home:'/fixture/home',runtimeDelivery:'external-session',primary:'/fixture/home/.aw',bindings:[{identity_home:'/fixture/home/.aw',controls:true,event_classes:[]}]};
  const before=structuredClone(status);
  const result=targetReceiveAssessment(status,expected,{minimumVersion:'1.36.13',now:Date.parse('2026-10-06T00:58:24.737Z')});
  assert.deepEqual(result.problems,[],JSON.stringify(result));
  assert.ok(result.warnings.some(w=>w.code==='wake-worker-error-retained'));
  assert.ok(result.warnings.some(w=>w.code==='receive-observation-aged'));
  assert.deepEqual(status,before);
});

for(const mode of [undefined,'approved']) test(`selector emits the fixed argument and admission guidance for ${mode??'omitted development default'}`,t=>{
  const fx=fixture(t,{delivery:'channel',runtime:'claude',settings:mode===undefined?{}:{claudeChannelMode:mode}});
  const doc=fx.spawn(), expected=mode??'development';
  assert.deepEqual(doc.launch,{claude:expected==='development'?DEV_CHANNEL_FLAG:CHANNEL_FLAG});
  assert.equal(doc.meta.claudeChannelMode,expected);
  const code=expected==='development'?'channel-dev-confirmation':'claude-channel-enrollment-unverified';
  assert.match(doc.warning,new RegExp(code));
  if(expected==='approved') {
    assert.match(doc.warning,/currently not on the default approved list/);
    assert.match(doc.warning,/approved mode registers no aweb channel unless applicable managed allowedChannelPlugins for this identity lists the plugin and marketplace/);
    assert.match(doc.warning,/Installation or a trusted marketplace is not approval/);
    assert.match(doc.warning,/no channel wake/i);
    assert.match(doc.warning,/without.*report/i);
  } else {
    assert.match(doc.warning,/sole launch opt-in and defaults OFF/);
    assert.match(doc.warning,/at most once; a folder-trust prompt blocks with a receipt and zero keys/);
  }
  fx.record(doc.meta,'claude');
  const warnings=fx.readiness().warnings;
  assert.ok(warnings.some(w=>w.code===code));
  assert.ok(warnings.some(w=>w.code==='native-receive-unproven'));
});

test('approved selector refuses explicit null before provider calls',t=>{
  const fx=fixture(t,{delivery:'channel',runtime:'claude',settings:{claudeChannelMode:null}});
  const before=snapshot(fx.home);
  const r=fx.hook('spawn');
  assert.notEqual(r.status,0);
  assert.match(r.doc.warning,/claudeChannelMode/);
  assert.deepEqual(fx.fake.readCalls(),[]);
  assert.deepEqual(snapshot(fx.home),before);
});

for (const value of [null, '', 'other', 1, false, [], {}]) test(`Claude selector rejects ${JSON.stringify(value)} before spawn/launch/preview/check effects`, t => {
  const fx=fixture(t,{settings:{claudeChannelMode:value}});
  const before=snapshot(fx.home);
  for(const event of ['spawn','launch']) for(const preview of ['', '1']) {
    const r=fx.hook(event,{OATS_LAUNCH_PREVIEW:preview});
    assert.notEqual(r.status,0,r.stdout);
    assert.match(r.doc.warning,/settings\.oats\.aweb\.claudeChannelMode/);
  }
  const result=fx.readiness({targetHome:null});
  assert.equal(result.status,'needs-configuration');
  assert.match(JSON.stringify(result.problems),/claudeChannelMode/);
  assert.deepEqual(fx.fake.readCalls(),[]);
  assert.deepEqual(snapshot(fx.home),before);
});

for(const mode of ['approved','development']) test(`local Claude selector ${mode} preserves preview and real launch semantics`,t=>{
  const fx=fixture(t,{settings:{claudeChannelMode:mode}});
  const spawned=fx.spawn(),argument=mode==='approved'?CHANNEL_FLAG:DEV_CHANNEL_FLAG;
  assert.equal(spawned.meta.claudeChannelMode,mode);
  assert.deepEqual(spawned.launch,{claude:argument});
  const before=snapshot(fx.home),calls=fx.fake.readCalls().length;
  const preview=fx.launch(spawned.meta,'claude',{extra:{OATS_LAUNCH_PREVIEW:'1'}});
  assert.equal(preview.status,0,preview.stdout);
  assert.deepEqual(preview.doc.launch,{claude:argument});
  assert.equal(preview.doc.meta,undefined);
  assert.deepEqual(fx.fake.readCalls().slice(calls),[]);
  assert.deepEqual(snapshot(fx.home),before);
  const real=fx.launch(spawned.meta,'claude');
  assert.equal(real.status,0,real.stdout);
  assert.deepEqual(real.doc.launch,{claude:argument});
  assert.equal(real.doc.meta.claudeChannelMode,mode);
  for(const [runtime,delivery] of [['pi','channel'],['codex','channel'],['claude','session']]) {
    const changed=fx.launch(spawned.meta,runtime,{delivery});
    assert.equal(changed.status,0,changed.stdout);
    assert.equal(changed.doc.launch,undefined);
    assert.equal(changed.doc.meta.claudeChannelMode,undefined);
  }
});

for(const [name,mode,hooks,code] of [
  ['captured approved against current development','approved',{},'claude-channel-enrollment-unverified'],
  ['captured development against current approved','development',{},'channel-dev-confirmation'],
  ['historical exact development contribution',undefined,{contributions:[{capability:'oats.aweb',launch:{claude:DEV_CHANNEL_FLAG}}]},'channel-dev-confirmation'],
  ['historical exact approved contribution',undefined,{contributions:[{capability:'oats.aweb',launch:{claude:CHANNEL_FLAG}}]},'claude-channel-enrollment-unverified'],
  ['historical aggregate development',undefined,{launch:{claude:DEV_CHANNEL_FLAG}},'channel-dev-confirmation'],
  ['historical absent contribution',undefined,{},'claude-channel-mode-unproven'],
  ['historical combined argument is not provider proof',undefined,{launch:{claude:DEV_CHANNEL_FLAG+' --other'}},'claude-channel-mode-unproven'],
  ['contradictory captured contribution','approved',{contributions:[{capability:'oats.aweb',launch:{claude:DEV_CHANNEL_FLAG}}]},'receive-record-unavailable'],
  ['malformed captured contribution',undefined,{contributions:[{capability:'oats.aweb',launch:{claude:'--arbitrary'}}]},'receive-record-unavailable'],
  ['duplicate captured contribution',undefined,{contributions:[{capability:'oats.aweb',launch:{claude:CHANNEL_FLAG}},{capability:'oats.aweb',launch:{claude:CHANNEL_FLAG}}]},'receive-record-unavailable'],
  ['malformed captured mode',null,{},'receive-record-unavailable'],
  ['recorded mode conflicts with exact aggregate despite absent own receipt','approved',{launch:{claude:DEV_CHANNEL_FLAG},contributions:[]},'receive-record-unavailable'],
  ['malformed contributions array',undefined,{contributions:[null]},'receive-record-unavailable'],
  ['contradictory aggregate and provider arguments',undefined,{launch:{claude:DEV_CHANNEL_FLAG},contributions:[{capability:'oats.aweb',launch:{claude:CHANNEL_FLAG}}]},'receive-record-unavailable'],
]) test(`Claude selector readiness: ${name}`,t=>{
  const fx=fixture(t,{settings:{claudeChannelMode:mode==='approved'?'development':'approved'}});
  const meta=fx.spawn().meta;
  delete meta.claudeChannelMode;
  if(mode!==undefined) meta.claudeChannelMode=mode;
  writeFileSync(join(fx.home,'instance.json'),JSON.stringify({launch:{harness:'claude',hooks},capabilityMeta:{'oats.aweb':meta}}));
  const before=snapshot(fx.home),calls=fx.fake.readCalls().length;
  const result=fx.readiness();
  assert.equal(result.status,code==='receive-record-unavailable'?'unavailable':'ready',JSON.stringify(result));
  assert.ok([...result.problems,...result.warnings].some(w=>w.code===code),JSON.stringify(result));
  if(result.status==='ready') assert.ok(result.warnings.some(w=>w.code==='native-receive-unproven'));
  assert.equal(fx.fake.readCalls().slice(calls).filter(c=>c.args[0]==='wake').length,0);
  assert.deepEqual(snapshot(fx.home),before);
});

for(const mode of ['approved','development']) for(const evidence of ['both','metadata','receipt']) {
  const receipts=evidence!=='metadata';
  const own=mode==='approved'?CHANNEL_FLAG:DEV_CHANNEL_FLAG;
  const opposite=mode==='approved'?DEV_CHANNEL_FLAG:CHANNEL_FLAG;
  for(const [kind,aggregate,failed] of [
    ['consistent',own+' --verbose',false],
    ['opposite',opposite+' --verbose',true],
    ['both',own+' '+opposite+' --verbose',true],
    ['quoted unrelated text',own+` --message "${opposite}"`,false],
    ['single-quoted unrelated text',own+` --message '${opposite}'`,false],
    ['different plugin',own+' '+opposite.replace('@awebai-marketplace','@another-marketplace'),false],
    ['positional text',own+' -- '+opposite,false],
    ['ambiguous shell expression',own+' $(echo ignored)',true],
    ['unterminated quote',own+' --message "unfinished',true],
  ]) test(`multi-provider Claude aggregate ${mode}/${evidence}/${kind}`,async t=>{
    const {expectedReceive}=await import('../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs');
    const home=tempDir(t);
    mkdirSync(join(home,'.aw'));
    mkdirSync(join(home,'.oats-aweb'));
    writeFileSync(join(home,'.oats-aweb','teams.json'),JSON.stringify({joinedTeams:[]}));
    const hooks={launch:{claude:aggregate},...(receipts?{contributions:[{capability:'oats.aweb',launch:{claude:own}},{capability:'fixture.logging',launch:{claude:'--verbose'}}]}:{})};
    writeFileSync(join(home,'instance.json'),JSON.stringify({launch:{harness:'claude',hooks},capabilityMeta:{'oats.aweb':{delivery:'channel',runtime:'claude',...(evidence==='receipt'?{}:{claudeChannelMode:mode})}}}));
    const before=snapshot(home),result=expectedReceive(home);
    assert.equal(result.problems[0]?.code,failed?'receive-record-unavailable':undefined,JSON.stringify(result));
    if(!failed) assert.ok(result.warnings.some(w=>w.code===(mode==='approved'?'claude-channel-enrollment-unverified':'channel-dev-confirmation')));
    assert.deepEqual(snapshot(home),before);
  });
}

for(const [name,aggregate,failed] of [
  ['one selector with extra argument',DEV_CHANNEL_FLAG+' --verbose',false],
  ['both selectors',CHANNEL_FLAG+' '+DEV_CHANNEL_FLAG+' --verbose',true],
]) test(`multi-provider Claude aggregate without provenance: ${name}`,async t=>{
  const {expectedReceive}=await import('../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs');
  const home=tempDir(t);
  mkdirSync(join(home,'.aw'));
  mkdirSync(join(home,'.oats-aweb'));
  writeFileSync(join(home,'.oats-aweb','teams.json'),JSON.stringify({joinedTeams:[]}));
  writeFileSync(join(home,'instance.json'),JSON.stringify({launch:{harness:'claude',hooks:{launch:{claude:aggregate}}},capabilityMeta:{'oats.aweb':{delivery:'channel',runtime:'claude'}}}));
  const before=snapshot(home),result=expectedReceive(home);
  assert.equal(result.problems[0]?.code,failed?'receive-record-unavailable':undefined,JSON.stringify(result));
  if(!failed) assert.ok(result.warnings.some(w=>w.code==='claude-channel-mode-unproven'));
  assert.deepEqual(snapshot(home),before);
});
