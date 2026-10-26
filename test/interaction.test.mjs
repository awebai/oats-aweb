// settings.oats.aweb.interaction, stage 1 of the threaded human channel
// (awebai/oats docs/design/2026-10-26-threaded-human-channel.md §1 and the
// alias scheme of §2): the manifest setting, its validation before any aw
// call, the `interaction` meta key beside `delivery`, the `threads` brief
// paragraph on the three spawn paths that brief `Comms:`, and the human's
// deterministic alias (lib/human-identity.mjs). Nothing is minted, joined or
// written for the human at spawn.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fakeAwWake } from "./helpers/fake-aw-wake.mjs";
import { fakeAw as fakeAwGrant } from "./helpers/fake-aw-grant.mjs";
import { joinFromFake } from "./helpers/fake-aw-join-from.mjs";
import { ALIAS_MAX_LENGTH, aliasPart, hostNameFromLocalYaml, humanAlias, osUser, recordedHostName, shortHostname } from "../oats-package/capabilities/oats-aweb/lib/human-identity.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CAPABILITY = join(REPO, "oats-package", "capabilities", "oats-aweb");
const HOOK = join(CAPABILITY, "bin", "oats-aweb.mjs");
const AWEB_ALIAS_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const THREADS_BRIEF_RE = / Interaction: threads\. Your human talks to you in threads: each thread is one aweb mail conversation and one effort\. Read a thread with `aw mail show --conversation-id <id>`; answer in it with `aw mail reply <message-id>` \(which marks that message read\); never start a second thread for the same effort\. Your human's alias on this computer is "([a-z0-9-]+)"\. This oats\.aweb still delivers incoming mail in full; the one-line wake for threads souls is not shipped yet\./;
const BAD_VALUES = [["an unknown string", "chat"], ["null", null], ["the empty string", ""], ["a number", 7]];

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-interaction-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(file, text) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
const lastJson = (r) => { try { return JSON.parse(r.stdout.trim().split("\n").pop()); } catch { return undefined; } };
/** The alias the hook derives on this machine for a deployment whose oats-local.yaml records `host.name: <host>`. */
const expectedAlias = (host) => `${aliasPart(osUser())}-${aliasPart(host)}`;
/** The settings document with `interaction` set to `value`, or left out when `value` is `undefined`. */
/** A call log with the fixture's temporary paths and per-spawn labels neutralised, so two fixtures' logs compare. */
const shape = (calls) => calls.map((c) => c.replace(/\/tmp\/oats-aweb-interaction-[A-Za-z0-9]+/g, "<tmp>").replace(/--label=oats:probe:[0-9a-f]+/g, "--label=<label>"));
const withInteraction = (base, value) => ({ ...base, ...(value === undefined ? {} : { interaction: value }) });

// ------------------------------------------------------------ the manifest

test("the manifest declares settings.interaction with exactly terminal|threads, default terminal, not host-only", () => {
  const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));
  const setting = manifest.settings.interaction;
  assert.deepEqual(setting.values, ["terminal", "threads"]);
  assert.equal(setting.default, "terminal");
  assert.equal(setting.hostOnly, undefined);
  assert.match(setting.description, /terminal \(default\)/);
  assert.match(setting.description, /later release/);
});

// ------------------------------------------------------------ the local mint path

/** A local-mint spawn fixture on the 1.15 fake aw: a deployment whose oats-local.yaml records `host.name: <host>`. */
function localFixture(t, { host = "Falcon", delivery = "channel" } = {}) {
  const fake = fakeAwWake(t);
  const ws = tempDir(t), home = join(ws, "agents", "dev", "instances", "dev-1"), user = join(ws, "user");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(ws, ".aw"), { recursive: true });
  writeFileSync(join(ws, ".aw", "teams.yaml"), "active_team: legacy:example.test\n");
  if (host !== null) writeFileSync(join(ws, "oats-local.yaml"), `schemaVersion: 2\nworkspace: local\nhost:\n  name: ${host}\nsettings:\n  oats.aweb:\n    delivery: ${delivery}\n`);
  const base = { root: ws, delivery, claudeChannelMode: "approved" };
  const env = {
    PATH: fake.path, HOME: user, OATS_HOME: home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: ws, OATS_WORKSPACE_KEY: "github.com/acme/agents", OATS_WORKSPACE_NAME: "acme",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: "legacy:example.test", OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: "legacy:example.test", default: true, from: "local" }]), OATS_TEAMS_SOURCE: "live",
  };
  const hook = (event, settings, extra = {}) => {
    const r = spawnSync(process.execPath, [HOOK, event], { cwd: home, env: { ...env, ...extra, OATS_EVENT: event, OATS_SETTINGS: JSON.stringify(settings) }, encoding: "utf8", timeout: 20000 });
    return { ...r, doc: lastJson(r) };
  };
  const spawn = (interaction, extra = {}) => hook("spawn", withInteraction(base, interaction), { OATS_RUNTIME: "pi", ...extra });
  const launch = (interaction, extra = {}) => hook("launch", withInteraction(base, interaction), { OATS_META: JSON.stringify({ delivery, runtime: "pi", team: "legacy:example.test", alias: "dev-1", identity: { mode: "local", alias: "dev-1", team: "legacy:example.test" } }), OATS_RUNTIME: "pi", OATS_PREVIOUS_RUNTIME: "pi", ...extra });
  return { ws, home, fake, spawn, launch, calls: () => fake.readCalls().map((c) => c.args.join(" ")) };
}

test("a threads spawn records interaction: threads, briefs the paragraph with the alias from host.name, and runs exactly a terminal spawn's aw calls", (t) => {
  const threads = localFixture(t), terminal = localFixture(t);
  const a = threads.spawn("threads"), b = terminal.spawn("terminal");
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.equal(a.doc.meta.interaction, "threads");
  assert.equal(a.doc.meta.delivery, "channel");
  const match = THREADS_BRIEF_RE.exec(a.doc.brief);
  assert.ok(match, a.doc.brief);
  assert.equal(match[1], expectedAlias("Falcon"));
  assert.match(match[1], AWEB_ALIAS_RE);
  assert.ok(a.doc.brief.indexOf("Interaction: threads") > a.doc.brief.indexOf("Notification delivery:"), "the paragraph follows the delivery brief");
  assert.equal(a.doc.brief.replace(match[0], ""), b.doc.brief, "the threads brief is the terminal brief plus the paragraph");
  assert.doesNotMatch(a.doc.brief, /identity:|\.oats-aweb\/human|\/tmp\//, "no secrets, no paths");
  assert.deepEqual(shape(threads.calls()), shape(terminal.calls()), "no extra aw invocation for the human");
  assert.equal(existsSync(join(threads.ws, ".oats-aweb")), false, "nothing is written for the human in the deployment");
  assert.deepEqual(Object.keys(a.doc.env), Object.keys(b.doc.env), "no new launch environment");
});

test("a terminal spawn and one with the setting absent are byte-identical and record interaction: terminal", (t) => {
  const explicit = localFixture(t).spawn("terminal"), absent = localFixture(t).spawn(undefined);
  for (const r of [explicit, absent]) {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.doc.meta.interaction, "terminal");
    assert.doesNotMatch(r.doc.brief, /Interaction: threads/);
  }
  assert.equal(explicit.doc.brief, absent.doc.brief);
  assert.deepEqual(explicit.doc.meta, absent.doc.meta);
});

test("any other value refuses the spawn before any aw call or mint, naming the key, the value and both accepted values", (t) => {
  for (const [name, value] of BAD_VALUES) {
    const fx = localFixture(t);
    const r = fx.spawn(value);
    assert.notEqual(r.status, 0, `${name}: ${r.stdout}`);
    assert.equal(r.doc.warning, `oats-aweb: settings.oats.aweb.interaction must be "terminal" or "threads" (got ${JSON.stringify(value)})`, name);
    assert.equal(r.doc.meta, undefined, `${name}: no meta, nothing to compensate`);
    assert.deepEqual(fx.calls(), [], `${name}: the fake aw was not called`);
    assert.equal(existsSync(join(fx.home, ".aw", "identity.yaml")), false, `${name}: no mint`);
  }
});

test("a launch answers meta.interaction from the setting, and the launch preview changes nothing", (t) => {
  for (const [interaction, expected] of [["threads", "threads"], ["terminal", "terminal"], [undefined, "terminal"]]) {
    const fx = localFixture(t);
    mkdirSync(join(fx.home, ".aw"), { recursive: true });
    const real = fx.launch(interaction);
    assert.equal(real.status, 0, real.stdout + real.stderr);
    assert.equal(real.doc.meta.interaction, expected, String(interaction));
    assert.equal(real.doc.meta.delivery, "channel");
    const before = fx.calls().length;
    const preview = fx.launch(interaction, { OATS_LAUNCH_PREVIEW: "1" });
    assert.equal(preview.status, 0, preview.stdout + preview.stderr);
    assert.equal(preview.doc.meta, undefined, "the preview records no meta");
    assert.deepEqual(preview.doc.env, real.doc.env, "the preview answers the real start's contribution");
    assert.equal(fx.calls().length, before, "the preview calls no aw");
  }
  for (const [name, value] of BAD_VALUES) {
    const fx = localFixture(t);
    mkdirSync(join(fx.home, ".aw"), { recursive: true });
    for (const extra of [{}, { OATS_LAUNCH_PREVIEW: "1" }]) {
      const r = fx.launch(value, extra);
      assert.notEqual(r.status, 0, name);
      assert.match(r.doc.warning, /settings\.oats\.aweb\.interaction must be "terminal" or "threads"/, name);
      assert.deepEqual(fx.calls(), [], `${name}: refused before any aw call`);
    }
  }
});

test("a retire leaves the recorded interaction as it is and is not refused by the setting", (t) => {
  const fx = localFixture(t);
  const spawned = fx.spawn("threads");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const r = spawnSync(process.execPath, [HOOK, "retire"], { cwd: fx.home, env: { PATH: fx.fake.path, OATS_EVENT: "retire", OATS_HOME: fx.home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: fx.ws, OATS_META: JSON.stringify(spawned.doc.meta), OATS_SETTINGS: JSON.stringify({ root: fx.ws, interaction: "chat" }) }, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// ------------------------------------------------------------ the retained seat path

/** A fake aw for the retained-seat spawn (the 1.14 surface: connect, check, heartbeat, status, whoami). */
function fakeAwRetained(t) {
  const base = tempDir(t), bin = join(base, "bin"), calls = join(base, "calls.jsonl");
  write(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
let args = process.argv.slice(2), identityHome = null;
if (args[0] === "--identity-home") { identityHome = args[1]; args = args.slice(2); }
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args }) + "\\n");
(${joinFromFake})(args);
const emit = (o) => console.log(JSON.stringify(o));
const flag = (n) => args.find((a) => a.startsWith(n + "="))?.slice(n.length + 1) ?? (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const home = () => identityHome || path.join(process.cwd(), ".aw");
if (args[0] === "version") { console.log("aw 1.36.33 44786439"); process.exit(0); }
if (args[0] === "wake" && args[1] === "status") { emit({ daemon_running: true, daemon_version_state: "reported", daemon_version: "1.36.33", instances: [] }); process.exit(0); }
if (args[0] === "wake") { console.log("ok"); process.exit(0); }
if (args[0] === "workspace" && args[1] === "connect") { fs.mkdirSync(home(), { recursive: true }); fs.writeFileSync(path.join(home(), "workspace.yaml"), "alias: retained\\nteam_id: " + flag("--team") + "\\naweb_url: " + flag("--service") + "\\n"); emit({ status: "connected" }); process.exit(0); }
if (args[0] === "workspace" && args[1] === "status") { emit({ workspace: { alias: "retained", workspace_path: process.cwd(), hostname: "fixture" } }); process.exit(0); }
if (args[0] === "whoami") { emit({ alias: "retained", did: "did:key:zRetained", address: "fixture.test/retained" }); process.exit(0); }
if (args[0] === "check" || args[0] === "heartbeat") { console.log("ok"); process.exit(0); }
console.error("unexpected fake aw " + args.join(" ")); process.exit(93);
`);
  spawnSync("chmod", ["755", join(bin, "aw")]);
  return { path: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, calls: () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).args.join(" ")) : [] };
}

function retainedSpawn(t, interaction, { host = "Falcon" } = {}) {
  const fake = fakeAwRetained(t);
  const root = tempDir(t), home = join(root, "home"), source = join(root, "source", ".aw");
  mkdirSync(home, { recursive: true });
  write(join(source, "signing.key"), "fixture-signing-key");
  write(join(source, "identity.yaml"), "alias: retained\ndid: did:key:zRetained\naddress: fixture.test/retained\n");
  write(join(source, "teams.yaml"), "active_team: default:example.test\n");
  write(join(source, "workspace.yaml"), "alias: retained\naweb_url: https://app.aweb.ai/api\n");
  write(join(root, "oats-local.yaml"), `host:\n  name: ${host}\n`);
  const env = {
    PATH: fake.path, OATS_EVENT: "spawn", OATS_HOME: home, OATS_INSTANCE: "retained", OATS_WORKSPACE: root, OATS_WORKSPACE_KEY: "repo:fixture", OATS_RUNTIME: "pi",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: "default:example.test", OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: "default:example.test", default: true, from: "local" }]),
    OATS_SETTINGS: JSON.stringify(withInteraction({ delivery: "session", identity: { mode: "local", source } }, interaction)),
  };
  const r = spawnSync(process.execPath, [HOOK, "spawn"], { cwd: home, env, encoding: "utf8", timeout: 20000 });
  return { ...r, doc: lastJson(r), home, calls: fake.calls };
}

test("the retained seat brief carries the paragraph for threads and is unchanged for terminal", (t) => {
  const threads = retainedSpawn(t, "threads"), terminal = retainedSpawn(t, "terminal"), absent = retainedSpawn(t, undefined);
  for (const r of [threads, terminal, absent]) assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(threads.doc.meta.retained, true);
  assert.equal(threads.doc.meta.interaction, "threads");
  const match = THREADS_BRIEF_RE.exec(threads.doc.brief);
  assert.ok(match, threads.doc.brief);
  assert.equal(match[1], expectedAlias("Falcon"));
  assert.ok(threads.doc.brief.indexOf("Interaction: threads") > threads.doc.brief.indexOf("Notification delivery:"));
  assert.equal(threads.doc.brief.replace(match[0], ""), terminal.doc.brief);
  assert.equal(terminal.doc.brief, absent.doc.brief);
  assert.equal(terminal.doc.meta.interaction, "terminal");
  assert.doesNotMatch(terminal.doc.brief, /Interaction: threads/);
  assert.deepEqual(shape(threads.calls()), shape(terminal.calls()));
  const refused = retainedSpawn(t, "chat");
  assert.notEqual(refused.status, 0);
  assert.match(refused.doc.warning, /settings\.oats\.aweb\.interaction must be "terminal" or "threads" \(got "chat"\)/);
  assert.deepEqual(refused.calls(), [], "refused before the seat is copied or connected");
  assert.equal(existsSync(join(refused.home, ".aw")), false);
});

// ------------------------------------------------------------ the global grant path

function globalSpawn(t, interaction, { host = "Falcon" } = {}) {
  const base = tempDir(t), bin = fakeAwGrant(base);
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "probe"); mkdirSync(home, { recursive: true });
  const custody = join(base, "custody", "merlin"); write(join(custody, ".aw", "identity.yaml"), "alias: resident-alias\n");
  write(join(root, "oats-local.yaml"), `host:\n  name: "${host}" # the recorded host\n`);
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, OATS_EVENT: "spawn", OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_RUNTIME: "pi",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: "t:example.test", OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: JSON.stringify([{ label: "default", team: "t:example.test", default: true, from: "local" }]),
    OATS_SETTINGS: JSON.stringify(withInteraction({ identity: { mode: "global", resident: "merlin" }, residents: { merlin: custody } }, interaction)),
  };
  const r = spawnSync(process.execPath, [HOOK, "spawn"], { cwd: home, env, encoding: "utf8", timeout: 20000 });
  const calls = () => existsSync(join(base, "aw.log")) ? readFileSync(join(base, "aw.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).argv.filter((a) => !a.startsWith("--out=")).join(" ")) : [];
  return { ...r, doc: lastJson(r), home, calls };
}

test("the global grant seat brief carries the paragraph for threads and is unchanged for terminal", (t) => {
  const threads = globalSpawn(t, "threads"), terminal = globalSpawn(t, "terminal");
  for (const r of [threads, terminal]) assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(threads.doc.meta.identity.mode, "global");
  assert.equal(threads.doc.meta.interaction, "threads");
  assert.equal(terminal.doc.meta.interaction, "terminal");
  const match = THREADS_BRIEF_RE.exec(threads.doc.brief);
  assert.ok(match, threads.doc.brief);
  assert.equal(match[1], expectedAlias("Falcon"), "host.name read through quotes and a trailing comment");
  assert.equal(threads.doc.brief.replace(match[0], ""), terminal.doc.brief);
  assert.doesNotMatch(terminal.doc.brief, /Interaction: threads/);
  assert.deepEqual(shape(threads.calls()), shape(terminal.calls()));
  const refused = globalSpawn(t, 7);
  assert.notEqual(refused.status, 0);
  assert.match(refused.doc.warning, /settings\.oats\.aweb\.interaction must be "terminal" or "threads" \(got 7\)/);
  assert.deepEqual(refused.calls(), [], "refused before any grant is minted");
});

test("the hook has exactly one threads brief builder, used on the three Comms brief paths", () => {
  const source = readFileSync(HOOK, "utf8");
  assert.equal(source.match(/Interaction: threads\./g).length, 1, "one shared paragraph");
  assert.equal(source.match(/\$\{deliveryBrief\}\$\{threadsBrief\(\)\}/g).length, 3, "right after the delivery brief on each path");
  assert.equal(source.match(/\$\{deliveryBrief\}(?!\$\{threadsBrief)/g), null, "no Comms brief path without it");
});

// ------------------------------------------------------------ the alias (lib/human-identity.mjs)

test("the alias is <os-user>-<host>, lowercased and reduced to [a-z0-9-]", (t) => {
  const deployment = tempDir(t);
  writeFileSync(join(deployment, "oats-local.yaml"), "schemaVersion: 2\nhost:\n  name: Falcon\n");
  assert.equal(humanAlias({ deployment, user: "Joan" }), "joan-falcon");
  assert.equal(humanAlias({ deployment, user: "j.oan", hostname: "ignored.example" }), "j-oan-falcon", "the recorded host.name wins over the hostname");
  assert.equal(humanAlias({ deployment: tempDir(t), user: "j.oan", hostname: "my host_1" }), "j-oan-my-host-1");
  assert.equal(humanAlias({ deployment: tempDir(t), user: "Joan", hostname: "Falcon.local.example" }), "joan-falcon", "the hostname is cut at its first dot");
  assert.equal(humanAlias({ deployment: tempDir(t), user: "--Joan--", hostname: "  falcon  " }), "joan-falcon");
  assert.equal(aliasPart("Ünïcode Näme!"), "n-code-n-me");
});

test("with no oats-local.yaml, or no usable host.name, the host part is the short OS hostname", (t) => {
  const short = hostname().split(".")[0];
  assert.equal(shortHostname(), short);
  assert.equal(humanAlias({ deployment: tempDir(t), user: "joan" }), `joan-${aliasPart(short)}`);
  assert.equal(humanAlias({ deployment: join(tempDir(t), "missing"), user: "joan", hostname: "h1" }), "joan-h1");
  for (const [name, text] of [
    ["no host block", "schemaVersion: 2\nsettings:\n  oats.aweb:\n    delivery: channel\n"],
    ["host is a scalar", "host: falcon\n"],
    ["host block without name", "host:\n  id: abc\n"],
    ["name is a flow mapping", "host:\n  name: { a: 1 }\n"],
    ["name is empty", "host:\n  name:\n"],
    ["name is a comment only", "host:\n  name: # nothing\n"],
    ["name outside the host block", "host:\n  id: abc\nname: elsewhere\n"],
    ["host block nested", "settings:\n  host:\n    name: nested\n"],
    ["unterminated quote", "host:\n  name: \"falcon\n"],
    ["not yaml", "{\n"],
  ]) {
    const deployment = tempDir(t);
    writeFileSync(join(deployment, "oats-local.yaml"), text);
    assert.equal(recordedHostName(deployment), undefined, name);
    assert.equal(humanAlias({ deployment, user: "joan", hostname: "fallback.example" }), "joan-fallback", name);
  }
  assert.equal(humanAlias({ deployment: tempDir(t), user: "joan", hostname: "h", readFile: () => { throw new Error("EACCES"); }, exists: () => true }), "joan-h", "an unreadable file falls back, never throws");
});

test("host.name is read quoted or bare, with comments stripped outside quotes", () => {
  assert.equal(hostNameFromLocalYaml("host:\n  name: Falcon\n"), "Falcon");
  assert.equal(hostNameFromLocalYaml("host:\n  name: \"Falcon\" # the recorded host\n"), "Falcon");
  assert.equal(hostNameFromLocalYaml("host:\n  name: 'Fal''con'\n"), "Fal'con");
  assert.equal(hostNameFromLocalYaml("host:\n  name: \"fal#con\"\n"), "fal#con");
  assert.equal(hostNameFromLocalYaml("host:\n  name: falcon # trailing\n"), "falcon");
  assert.equal(hostNameFromLocalYaml("host:\n  name: falcon#notacomment\n"), "falcon#notacomment");
  assert.equal(hostNameFromLocalYaml("# leading comment\nhost:\n  # a comment line\n  id: x\n  name:   Falcon  \n"), "Falcon");
  assert.equal(hostNameFromLocalYaml("host:\n    name: deep\n"), "deep");
  assert.equal(hostNameFromLocalYaml("host:\r\n  name: crlf\r\n"), "crlf");
  assert.equal(hostNameFromLocalYaml(undefined), undefined);
});

test("an overlong alias is cut to 64 characters and still matches aw's alias rule", (t) => {
  const alias = humanAlias({ deployment: tempDir(t), user: "u".repeat(40), hostname: "h".repeat(40) });
  assert.equal(alias.length, ALIAS_MAX_LENGTH);
  assert.equal(alias, `${"u".repeat(40)}-${"h".repeat(23)}`);
  assert.match(alias, AWEB_ALIAS_RE);
  const cutAtDash = humanAlias({ deployment: tempDir(t), user: "u".repeat(63), hostname: "h" });
  assert.equal(cutAtDash, "u".repeat(63), "a trailing dash left by the cut is trimmed");
  assert.match(cutAtDash, AWEB_ALIAS_RE);
});

test("the OS user comes from userInfo, falling back to $USER only when it throws", () => {
  assert.equal(osUser({ userInfo: () => ({ username: "Joan" }), env: { USER: "other" } }), "Joan");
  assert.equal(osUser({ userInfo: () => { throw new Error("ENOENT"); }, env: { USER: "env-user" } }), "env-user");
  assert.equal(osUser({ userInfo: () => { throw new Error("ENOENT"); }, env: {} }), "");
  assert.equal(humanAlias({ deployment: "/nonexistent", user: "", hostname: "falcon" }), "falcon", "a part that cannot be derived is left out, never a throw");
});
