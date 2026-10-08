// The approved Claude channel route's readiness evidence: the machine
// managed-settings file read-only, from an injected root (tests only).
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { approvedChannelPolicyWarning, readClaudeManagedPolicy } from "../oats-package/capabilities/oats-aweb/lib/claude-managed-policy.mjs";
import { expectedReceive } from "../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ADMITS = { channelsEnabled: true, allowedChannelPlugins: [{ plugin: "aweb-channel", marketplace: "awebai-marketplace" }] };
const DIRS = { linux: "etc/claude-code", darwin: "Library/Application Support/ClaudeCode" };

function tempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "oats-aweb-policy-"));
  t.after(() => { try { chmodSync(join(root, DIRS.linux, "managed-settings.json"), 0o600); } catch {} rmSync(root, { recursive: true, force: true }); });
  return root;
}
/** Writes files under the platform's managed directory; a string is written verbatim. */
function policyRoot(t, files, platform = "linux") {
  const root = tempRoot(t), dir = join(root, DIRS[platform]);
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}
const read = (root, platform = "linux") => readClaudeManagedPolicy({ root, platform });
const listing = root => readdirSync(root, { recursive: true }).sort();

test("admitted: channelsEnabled true and the aweb-channel entry", t => {
  const root = policyRoot(t, { "managed-settings.json": ADMITS });
  const before = listing(root);
  const policy = read(root);
  assert.equal(policy.state, "admitted", JSON.stringify(policy));
  assert.deepEqual(policy.sources, [join(root, DIRS.linux, "managed-settings.json")]);
  assert.deepEqual(listing(root), before, "the read writes nothing");
  const warning = approvedChannelPolicyWarning({ root, platform: "linux" });
  assert.equal(warning.code, "claude-channel-policy-admitted");
  assert.match(warning.message, /evidence, not proof/);
  assert.match(warning.message, /server-managed settings or MDM/);
  assert.match(warning.message, /only the nonce exchange proves receive/);
});

test("admitted on macOS's documented path", t => {
  const root = policyRoot(t, { "managed-settings.json": ADMITS }, "darwin");
  assert.equal(read(root, "darwin").state, "admitted");
  assert.equal(read(root, "linux").state, "unknown", "each platform reads only its own path");
});

for (const [name, doc, missing] of [
  ["channelsEnabled absent", { allowedChannelPlugins: ADMITS.allowedChannelPlugins }, ["channelsEnabled is absent (required for API-key and Team/Enterprise accounts)"]],
  ["channelsEnabled false", { ...ADMITS, channelsEnabled: false }, ["channelsEnabled is not true (required for API-key and Team/Enterprise accounts)"]],
  ["channelsEnabled a string", { ...ADMITS, channelsEnabled: "true" }, ["channelsEnabled is not true (required for API-key and Team/Enterprise accounts)"]],
  ["allowedChannelPlugins absent", { channelsEnabled: true }, ["allowedChannelPlugins is absent"]],
  ["allowedChannelPlugins without aweb-channel", { channelsEnabled: true, allowedChannelPlugins: [{ plugin: "telegram", marketplace: "claude-plugins-official" }] }, ['allowedChannelPlugins has no {plugin: "aweb-channel", marketplace: "awebai-marketplace"} entry']],
  ["allowedChannelPlugins not a list", { channelsEnabled: true, allowedChannelPlugins: { plugin: "aweb-channel", marketplace: "awebai-marketplace" } }, ['allowedChannelPlugins has no {plugin: "aweb-channel", marketplace: "awebai-marketplace"} entry']],
  ["aweb-channel entry with no marketplace", { channelsEnabled: true, allowedChannelPlugins: [{ plugin: "aweb-channel" }] }, ['allowedChannelPlugins lists aweb-channel with no marketplace; it needs marketplace "awebai-marketplace"']],
  ["wrong marketplace", { channelsEnabled: true, allowedChannelPlugins: [{ plugin: "aweb-channel", marketplace: "claude-plugins-official" }] }, ["allowedChannelPlugins lists aweb-channel from another marketplace, not awebai-marketplace"]],
  ["both keys missing (empty file)", "", ["channelsEnabled is absent (required for API-key and Team/Enterprise accounts)", "allowedChannelPlugins is absent"]],
]) test(`not admitted: ${name}`, t => {
  const root = policyRoot(t, { "managed-settings.json": doc });
  const policy = read(root);
  assert.equal(policy.state, "not-admitted", JSON.stringify(policy));
  assert.deepEqual(policy.missing, missing);
  const warning = approvedChannelPolicyWarning({ root, platform: "linux" });
  assert.equal(warning.code, "claude-channel-policy-not-admitted");
  for (const m of missing) assert.ok(warning.message.includes(m), warning.message);
  assert.match(warning.message, /section 4 host step 1/);
});

test("unknown: no file and no drop-ins", t => {
  const root = tempRoot(t);
  const policy = read(root);
  assert.equal(policy.state, "unknown");
  assert.match(policy.reason, /no managed-settings file at .*managed-settings\.json/);
  const warning = approvedChannelPolicyWarning({ root, platform: "linux" });
  assert.equal(warning.code, "claude-channel-enrollment-unverified", "the existing code keeps meaning admission is unverified");
  assert.match(warning.message, /is unknown/);
  assert.deepEqual(listing(root), [], "absence is not repaired");
});

test("unknown: unreadable file (a directory in its place)", t => {
  const root = tempRoot(t);
  mkdirSync(join(root, DIRS.linux, "managed-settings.json"), { recursive: true });
  const policy = read(root);
  assert.equal(policy.state, "unknown");
  assert.match(policy.reason, /is unreadable \(not a regular file\)/);
});

test("unknown: unreadable file (permission denied)", { skip: process.getuid?.() === 0 ? "root reads any file" : process.platform === "win32" ? "POSIX modes" : false }, t => {
  const root = policyRoot(t, { "managed-settings.json": ADMITS });
  chmodSync(join(root, DIRS.linux, "managed-settings.json"), 0o000);
  const policy = read(root);
  assert.equal(policy.state, "unknown", "an unreadable file is never read as admitted");
  assert.match(policy.reason, /is unreadable \(EACCES\)/);
});

for (const [name, content, reason] of [
  ["invalid JSON", "{\"channelsEnabled\": true,", /is not valid JSON/],
  ["top-level array", "[]", /is not a JSON object/],
  ["top-level null", "null", /is not a JSON object/],
]) test(`malformed file: ${name}`, t => {
  const root = policyRoot(t, { "managed-settings.json": content });
  const policy = read(root);
  assert.equal(policy.state, "malformed");
  assert.match(policy.reason, reason);
  const warning = approvedChannelPolicyWarning({ root, platform: "linux" });
  assert.equal(warning.code, "claude-channel-policy-malformed");
  assert.match(warning.message, /Claude Code refuses to start while it is, so an admin repairs it/);
});

test("unknown: a FIFO in the file's place is not read", { skip: spawnSync("mkfifo", ["--help"]).error ? "no mkfifo" : false }, t => {
  const root = tempRoot(t), dir = join(root, DIRS.linux);
  mkdirSync(dir, { recursive: true });
  assert.equal(spawnSync("mkfifo", [join(dir, "managed-settings.json")]).status, 0);
  const policy = read(root);
  assert.equal(policy.state, "unknown");
  assert.match(policy.reason, /not a regular file/);
});

test("unknown: a platform with no known machine path", t => {
  const root = policyRoot(t, { "managed-settings.json": ADMITS });
  const policy = read(root, "win32");
  assert.equal(policy.state, "unknown");
  assert.match(policy.reason, /no machine managed-settings location is known for platform win32/);
  const warning = approvedChannelPolicyWarning({ root, platform: "win32" });
  assert.equal(warning.code, "claude-channel-enrollment-unverified");
  assert.match(warning.message, /section 4 names machine files for Linux and macOS only/);
});

test("drop-ins merge after the file: lists combine, a later single value replaces", t => {
  const root = policyRoot(t, {
    "managed-settings.json": { channelsEnabled: true, allowedChannelPlugins: [{ plugin: "telegram", marketplace: "claude-plugins-official" }] },
    "managed-settings.d/20-aweb.json": { allowedChannelPlugins: [{ plugin: "aweb-channel", marketplace: "awebai-marketplace" }] },
    "managed-settings.d/.hidden.json": { channelsEnabled: false },
    "managed-settings.d/30-notes.txt": "not json",
  });
  const policy = read(root);
  assert.equal(policy.state, "admitted", JSON.stringify(policy));
  assert.equal(policy.sources.length, 2, "hidden and non-.json files are skipped");
});

test("drop-ins alone admit, and a later drop-in can withdraw channelsEnabled", t => {
  const alone = policyRoot(t, { "managed-settings.d/10-aweb.json": ADMITS });
  assert.equal(read(alone).state, "admitted");
  const withdrawn = policyRoot(t, { "managed-settings.d/10-aweb.json": ADMITS, "managed-settings.d/90-off.json": { channelsEnabled: false } });
  assert.deepEqual(read(withdrawn).missing, ["channelsEnabled is not true (required for API-key and Team/Enterprise accounts)"]);
});

test("a malformed drop-in poisons the whole read", t => {
  const root = policyRoot(t, { "managed-settings.json": ADMITS, "managed-settings.d/50-bad.json": "{" });
  const policy = read(root);
  assert.equal(policy.state, "malformed");
  assert.match(policy.reason, /50-bad\.json is not valid JSON/);
});

test("unknown: managed-settings.d is not a readable directory", t => {
  const root = policyRoot(t, { "managed-settings.json": ADMITS, "managed-settings.d": "a file" });
  const policy = read(root);
  assert.equal(policy.state, "unknown");
  assert.match(policy.reason, /managed-settings\.d is unreadable \(ENOTDIR\)/);
});

test("the production read has no environment override", () => {
  const source = readFileSync(join(REPO, "oats-package/capabilities/oats-aweb/lib/claude-managed-policy.mjs"), "utf8");
  assert.doesNotMatch(source, /process\.env/);
});

function approvedHome(t) {
  const home = mkdtempSync(join(tmpdir(), "oats-aweb-policy-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".aw"));
  mkdirSync(join(home, ".oats-aweb"));
  writeFileSync(join(home, ".oats-aweb", "teams.json"), JSON.stringify({ joinedTeams: [] }));
  writeFileSync(join(home, "instance.json"), JSON.stringify({
    launch: { harness: "claude", hooks: { launch: { claude: "--channels plugin:aweb-channel@awebai-marketplace" } } },
    capabilityMeta: { "oats.aweb": { delivery: "channel", runtime: "claude", claudeChannelMode: "approved" } },
  }));
  return home;
}

for (const [name, files, code] of [
  ["admitted", { "managed-settings.json": ADMITS }, "claude-channel-policy-admitted"],
  ["not admitted", { "managed-settings.json": { channelsEnabled: true } }, "claude-channel-policy-not-admitted"],
  ["unknown", {}, "claude-channel-enrollment-unverified"],
  ["malformed", { "managed-settings.json": "{" }, "claude-channel-policy-malformed"],
]) test(`readiness of an approved Claude home reports the policy: ${name}`, t => {
  const result = expectedReceive(approvedHome(t), { policy: { root: policyRoot(t, files), platform: "linux" } });
  assert.deepEqual(result.problems, [], JSON.stringify(result));
  const codes = result.warnings.map(w => w.code);
  assert.ok(codes.includes(code), JSON.stringify(result.warnings));
  assert.equal(codes.filter(c => c.startsWith("claude-channel-")).length, 1, "one policy verdict per home");
});

test("a development home's readiness does not read the policy", t => {
  const home = approvedHome(t);
  const doc = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  doc.capabilityMeta["oats.aweb"].claudeChannelMode = "development";
  doc.launch.hooks.launch.claude = "--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace";
  writeFileSync(join(home, "instance.json"), JSON.stringify(doc));
  const result = expectedReceive(home, { policy: { root: policyRoot(t, { "managed-settings.json": ADMITS }), platform: "linux" } });
  assert.ok(result.warnings.some(w => w.code === "channel-dev-confirmation"));
  assert.ok(!result.warnings.some(w => w.code.startsWith("claude-channel-policy-")));
});
