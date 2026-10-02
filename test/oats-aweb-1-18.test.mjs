// oats.aweb 1.18: delivery by harness. Under `delivery: channel` Claude Code
// takes mail through its channel plugin and pi through its extension; every
// other runtime (Codex, unknown) goes through the host wake broker, exactly as
// `delivery: session` sends every runtime. A home is delivered by one path
// only: a start on the channel path deregisters the home from the broker, a
// start on the broker path registers it.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
const CHANNEL_FLAG = "--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace";

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
  const readiness = () => {
    const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: merged, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: env.OATS_WORKSPACE_KEY, deployment: ws, soul: "dev", team: "default", instance: "dev-1", home } } };
    const { OATS_SETTINGS, OATS_HOME, OATS_RUNTIME, ...rest } = env;
    const r = spawnSync(process.execPath, [BINDING, "check"], { cwd: home, input: JSON.stringify(input), env: { ...rest, OATS_INSTANCE_HOME: home }, encoding: "utf8", timeout: 20000 });
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
    assert.deepEqual(doc.launch, runtime === "claude" ? { claude: CHANNEL_FLAG } : undefined, runtime);
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
  assert.deepEqual(r.doc.launch, { claude: CHANNEL_FLAG });
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
  assert.deepEqual(r.doc.launch, { claude: CHANNEL_FLAG });
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
  assert.match(changelog, /^# Changelog\n\n## 1\.18\.1\n/);
  const entry = changelog.split("\n## ")[1];
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
    if (relies) assert.equal(result.status, "needs-configuration");
  }
});

test("readiness reports an outdated wake daemon for a codex channel home", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "codex", daemonVersion: "1.36.6" });
  fx.record(fx.spawn().meta, "codex");
  const result = fx.readiness();
  assert.ok([...result.problems, ...(result.warnings || [])].some((p) => /wake-daemon-outdated/.test(p.code)), JSON.stringify(result));
});
