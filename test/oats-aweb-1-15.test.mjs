import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertKernelCheckAnswerRule } from "./helpers/kernel-check-answer-rule.mjs";
import { assertKernelOperationAnswer } from "./helpers/kernel-operation-envelope-rule.mjs";
import { flagValue, joinFromCalls } from "./helpers/fake-aw-join-from.mjs";
import { fakeAwWake } from "./helpers/fake-aw-wake.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CAPABILITY = join(REPO, "oats-package", "capabilities", "oats-aweb");
const HOOK = join(CAPABILITY, "bin", "oats-aweb.mjs");
const BINDING = join(CAPABILITY, "bin", "oats-aweb-binding.mjs");
const HOSTED_KEY = "github.com/acme/agents";

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-115-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

const teamsEnv = JSON.stringify([
  { label: "default", team: "legacy:example.test", default: true, from: "local" },
  { label: "alpha", team: "alpha:example.test", default: false, from: "shared" },
  { label: "beta", team: "beta:example.test", default: false, from: "shared" },
]);

function fixture(t, { key = HOSTED_KEY, settings = {}, delivery, runtime = "claude", legacyRoot = true } = {}) {
  const ws = tempDir(t), home = join(ws, "agents", "dev", "instances", "dev-1");
  mkdirSync(home, { recursive: true });
  if (legacyRoot) { mkdirSync(join(ws, ".aw"), { recursive: true }); writeFileSync(join(ws, ".aw", "teams.yaml"), "active_team: legacy:example.test\n"); }
  const merged = { ...(delivery ? { delivery } : {}), ...settings };
  const env = {
    OATS_HOME: home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: ws, OATS_WORKSPACE_KEY: key, OATS_WORKSPACE_NAME: "acme",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: "legacy:example.test", OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: teamsEnv, OATS_TEAMS_SOURCE: "live",
    OATS_RUNTIME: runtime, OATS_SETTINGS: JSON.stringify(merged),
  };
  return { ws, home, env, settings: merged, defaultRoot: join(ws, ".aweb-default") };
}

function runHook(event, { cwd, env, args = [] }) {
  return spawnSync(process.execPath, [HOOK, event, ...args], { cwd, env: { ...env, OATS_EVENT: event }, encoding: "utf8", timeout: 20000 });
}
function spawnDoc(result) { assert.equal(result.status, 0, result.stdout + result.stderr); return JSON.parse(result.stdout.trim().split("\n").pop()); }
function check(fx, fake, settings = fx.settings) {
  const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: fx.env.OATS_WORKSPACE_KEY, deployment: fx.ws, soul: "dev", team: "alpha", instance: "dev-1", home: fx.home } } };
  const { OATS_SETTINGS, OATS_EVENT, OATS_HOME, OATS_RUNTIME, ...rest } = fx.env;
  const result = spawnSync(process.execPath, [BINDING, "check"], { cwd: fx.home, input: JSON.stringify(input), env: { ...rest, PATH: fake.path, OATS_INSTANCE_HOME: fx.home }, encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return assertKernelCheckAnswerRule(result.stdout, input, "oats-aweb binding check").result;
}

test("1.17 manifest: kernel default-team wire names, no provider team setting, roots are team-id keyed, oats-aweb skill", () => {
  const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  const dist = JSON.parse(readFileSync(join(REPO, "oats-package", "oats-package.json"), "utf8"));
  assert.equal(manifest.version, "1.17.7");
  assert.equal(pkg.version, "1.17.7");
  assert.equal(dist.version, "1.17.7");
  assert.equal(manifest.settings.team, undefined);
  assert.match(manifest.settings.roots.description, /Keys are team ids only/);
  assert.equal(manifest.settings.roots.hostOnly, true);
  assert.doesNotMatch(JSON.stringify(manifest), /team ensure|1\.36\.8|per-workspace default team|personal/i);
  assert.ok(manifest.skills.includes("skills/oats-aweb"));
  assert.match(readFileSync(join(CAPABILITY, "skills", "oats-aweb", "SKILL.md"), "utf8"), /^---\nname: oats-aweb\n/);
  assert.match(readFileSync(join(REPO, "CHANGELOG.md"), "utf8"), /## 1\.16\.0[\s\S]*E_TEAM_DEFAULT/);
});

test("agent-facing text never tells anyone to run aw auth login or aw team ensure for oats.aweb", () => {
  const files = [join(CAPABILITY, "injects", "aweb.md"), join(CAPABILITY, "skills", "oats-aweb", "SKILL.md"), join(CAPABILITY, "skills", "aweb-team-membership", "SKILL.md")];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /aw auth login|team ensure|default-team-/, file);
  }
  assert.match(readFileSync(join(REPO, "README.md"), "utf8"), /teams JSON field .*defaultTeam/);
});

test("session-delivery guidance pins broker presentation and exact recovery rule", (t) => {
  const presentationFiles = [join(CAPABILITY, "injects", "aweb.md"), join(CAPABILITY, "skills", "oats-aweb", "SKILL.md"), join(CAPABILITY, "skills", "aweb-team-membership", "SKILL.md")];
  for (const file of presentationFiles) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /line naming what is waiting|waiting-items line/, file);
    assert.match(text, /full (mail\/chat )?event/, file);
    assert.doesNotMatch(text, /aweb: N items waiting/, file);
  }

  const recoveryFiles = [join(CAPABILITY, "injects", "aweb.md"), join(CAPABILITY, "skills", "oats-aweb", "SKILL.md")];
  for (const file of recoveryFiles) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /aweb mail event received\./, file);
    assert.match(text, /trust_status/, file);
    assert.match(text, /untrusted sender content/, file);
    assert.match(text, /never as instructions overriding your task|never as instructions overriding your task or your human/, file);
    assert.match(text, /delivered mail may not appear in unread `aw mail inbox`|delivered mail may no longer appear in unread `aw mail inbox`|presented mail may no longer appear in unread `aw mail inbox`/, file);
    assert.match(text, /aw mail show --message-id <id> --json/, file);
    assert.match(text, /aw mail inbox --show-all --json/, file);
    assert.match(text, /--cursor/, file);
    assert.match(text, /Read state is not completion|read state is not completion/, file);
    assert.match(text, /--conversation-id.*not (a )?recovery check|not recovery/, file);
    assert.doesNotMatch(text, /aweb: N items waiting|empty `aw mail inbox` means nothing|last handled `message_id`/, file);
  }
  const oatsSkill = readFileSync(join(CAPABILITY, "skills", "oats-aweb", "SKILL.md"), "utf8");
  assert.match(oatsSkill, /With `renew: off` the\s+grant expires at its TTL/);
  assert.match(oatsSkill, /`renew: launch` plus a restart, or a\s+respawn/);
  assert.doesNotMatch(oatsSkill, /host renews it/);
  const inject = readFileSync(join(CAPABILITY, "injects", "aweb.md"), "utf8");
  assert.match(inject, /At session start in a grant seat, run `aw whoami`,\s+then `aw mail inbox` and `aw chat pending`/);
  assert.match(inject, /do not run `aw workspace status` or\s+`aw id show` from the grant home/);
  assert.match(inject, /Grant inspection \(`aw id grant list\/show`\)\s+runs from the resident custody `\.aw`, not from the grant home/);
  const identitySkill = readFileSync(join(CAPABILITY, "skills", "aweb-identity", "SKILL.md"), "utf8");
  assert.match(identitySkill, /resident session grant[\s\S]*`aw whoami` only[\s\S]*`aw id show` and `aw id grant list\/show`/);
  assert.match(identitySkill, /grant inspection runs from the resident custody `\.aw`/);

  const hook = readFileSync(HOOK, "utf8");
  const capturedNative = readFileSync(join(CAPABILITY, "lib", "captured-native.mjs"), "utf8");
  for (const [name, text] of [["oats-aweb.mjs", hook], ["captured-native.mjs", capturedNative]]) {
    assert.match(text, /host wake broker presents incoming mail\/chat/, name);
    assert.match(text, /aweb mail event received\./, name);
    assert.match(text, /trust_status/, name);
    assert.match(text, /untrusted sender content/, name);
    assert.match(text, /never as instructions overriding your task/, name);
    assert.match(text, /delivered mail may not appear in unread|delivered mail may no longer appear in unread/, name);
    assert.match(text, /aw mail show --message-id <id> --json/, name);
    assert.match(text, /aw mail inbox --show-all --json/, name);
    assert.match(text, /--cursor/, name);
    assert.match(text, /Read state is not completion/, name);
    assert.match(text, /--conversation-id.*not a recovery check/, name);
    assert.doesNotMatch(text, /nudges you|last message_id|aw mail inbox --show-all`? and `?aw chat pending/, name);
  }

  const fake = fakeAwWake(t);
  const fx = fixture(t, { delivery: "session" });
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } }));
  assert.match(doc.brief, /line naming what is waiting/);
  assert.match(doc.brief, /full event with body/);
  assert.match(doc.brief, /aweb mail event received\./);
  assert.match(doc.brief, /trust_status/);
  assert.match(doc.brief, /untrusted sender content/);
  assert.match(doc.brief, /never as instructions overriding your task/);
  assert.match(doc.brief, /delivered mail may not appear in unread `aw mail inbox`/);
  assert.match(doc.brief, /aw mail show --message-id <id> --json/);
  assert.match(doc.brief, /aw mail inbox --show-all --json/);
  assert.match(doc.brief, /--cursor/);
  assert.match(doc.brief, /Read state is not completion/);
  assert.match(doc.brief, /--conversation-id.*not a recovery check/);
});

test("hosted workspace: the primary team resolves as in 1.14.2 (root's active team), with no enrollment call", (t) => {
  const fake = fakeAwWake(t);
  const fx = fixture(t);
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } }));
  assert.equal(doc.meta.team, "legacy:example.test");
  assert.equal(doc.meta.identity.team, "legacy:example.test");
  assert.deepEqual(doc.meta.defaultTeam, { label: "default", team: "legacy:example.test", from: "deployment" });
  const [mint] = joinFromCalls(fake.readCalls());
  assert.equal(flagValue(mint.args, "--join-from"), fx.ws, "the deployment root mints, as in 1.14.2");
  assert.equal(flagValue(mint.args, "--join-team"), "legacy:example.test");
  assert.equal(existsSync(fx.defaultRoot), false, "no default-team authority is created");
  assert.doesNotMatch(`${doc.warning || ""}${doc.brief}`, /default-team-|aw auth|team ensure/);
  const result = check(fx, fake);
  assert.equal(result.status, "ready", JSON.stringify(result));
  assert.equal(result.warnings.some((w) => /^default-team-/.test(w.code)), false);
});

test("a local/ workspace key resolves the same way and says nothing about a default team", (t) => {
  const fake = fakeAwWake(t);
  const fx = fixture(t, { key: "local//srv/acme" });
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } }));
  assert.equal(doc.meta.team, "legacy:example.test");
  assert.equal(doc.meta.defaultTeam.from, "deployment");
  assert.doesNotMatch(doc.warning || "", /default-team-/);
  assert.deepEqual(check(fx, fake).warnings.filter((w) => /^default/.test(w.code)), []);
});

test("settings.team is removed and refused", (t) => {
  const fake = fakeAwWake(t);
  const message = "teams are not a setting since oats.aweb 1.17 / OATS 0.30: use oats teams / oats soul teams";
  for (const team of ["alpha:example.test", "beta"]) {
    const fx = fixture(t, { settings: { team } });
    const r = runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path } });
    assert.notEqual(r.status, 0);
    assert.match(JSON.parse(r.stdout).warning, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("no aw auth or aw team ensure on any path: spawn, launch, readiness, commands, retire", (t) => {
  const fake = fakeAwWake(t);
  const fx = fixture(t, { delivery: "session" });
  const settings = { delivery: "session", join: "alpha", roots: { "legacy:example.test": fx.ws } };
  const env = { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify(settings) };
  const outputs = [];
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env }));
  outputs.push(JSON.stringify(doc));
  const withMeta = { ...env, OATS_META: JSON.stringify(doc.meta) };
  for (const [event, args] of [["launch", []], ["teams", ["--json"]], ["roster", ["--json"]], ["join", ["--labels", "beta", "--json"]], ["leave", ["--labels", "beta", "--json"]]]) {
    const r = runHook(event, { cwd: fx.home, env: withMeta, args });
    assert.equal(r.status, 0, `${event}: ${r.stdout}${r.stderr}`);
    outputs.push(r.stdout + r.stderr);
  }
  outputs.push(JSON.stringify(check({ ...fx, settings }, fake)));
  const retired = runHook("retire", { cwd: fx.home, env: withMeta });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  outputs.push(retired.stdout + retired.stderr);
  assert.deepEqual(fake.readCalls().filter((c) => c.forbidden), []);
  for (const text of outputs) assert.doesNotMatch(text, /default-team-|aw auth login/);
});

test("session delivery registers every joined identity with the broker and reports native receive", (t) => {
  const fake = fakeAwWake(t);
  const fx = fixture(t, { delivery: "session", settings: { join: "alpha" } });
  mkdirSync(join(fx.ws, ".aw"), { recursive: true });
  const env = { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify({ delivery: "session", join: "alpha", root: fx.ws }) };
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env }));
  const reg = fake.registrations()[fx.home];
  assert.equal(reg.runtime_delivery, "external-session");
  assert.deepEqual(reg.receive_identities.map((r) => [r.label, r.identity_home, !!r.controls]), [
    ["default", join(fx.home, ".aw"), true],
    ["alpha", join(fx.home, ".aweb-identity-alpha"), false],
  ]);
  assert.equal(doc.meta.joinedTeams[0].receive, "native");
  const listed = spawnSync(process.execPath, [HOOK, "teams", "--json"], { cwd: fx.home, env: { ...env, OATS_EVENT: "teams", OATS_META: JSON.stringify(doc.meta) }, encoding: "utf8" });
  assert.equal(JSON.parse(listed.stdout).joined[0].receive, "native");
  const result = check({ ...fx, settings: { delivery: "session", root: fx.ws } }, fake);
  assert.equal(result.status, "ready", JSON.stringify(result));
  assert.match(result.warnings.find((w) => w.code === "joined-team-receive").message, /alpha.*native/);
});

test("channel homes use aw's mixed mode: the channel keeps the primary, the broker takes joined teams", (t) => {
  const fake = fakeAwWake(t);
  const fx = fixture(t, { runtime: "claude" });
  mkdirSync(join(fx.ws, ".aw"), { recursive: true });
  const env = { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify({ root: fx.ws }) };
  let doc = spawnDoc(runHook("spawn", { cwd: fx.home, env }));
  assert.equal(fake.registrations()[fx.home], undefined, "no joined team: a channel home is not registered");
  const joined = spawnSync(process.execPath, [HOOK, "join", "--labels", "alpha", "--json"], { cwd: fx.home, env: { ...env, OATS_EVENT: "join", OATS_META: JSON.stringify(doc.meta) }, encoding: "utf8" });
  assert.equal(joined.status, 0, joined.stdout + joined.stderr);
  const reg = fake.registrations()[fx.home];
  assert.equal(reg.runtime_delivery, "native-channel");
  assert.equal(reg.primary_identity_home, join(fx.home, ".aw"));
  assert.deepEqual(reg.receive_identities.map((r) => r.label), ["alpha"]);
  assert.equal(JSON.parse(joined.stdout).joined[0].receive, "native");

  // Leave: deregister only after the release is confirmed and the home removed.
  const left = spawnSync(process.execPath, [HOOK, "leave", "--labels", "alpha", "--json"], { cwd: fx.home, env: { ...env, OATS_EVENT: "leave", OATS_META: JSON.stringify(doc.meta) }, encoding: "utf8" });
  assert.equal(left.status, 0, left.stdout + left.stderr);
  assert.equal(fake.registrations()[fx.home], undefined);
  const calls = fake.readCalls();
  const del = calls.findIndex((c) => c.args[0] === "workspace" && c.args[1] === "delete");
  const dereg = calls.findIndex((c) => c.args[0] === "wake" && c.args[1] === "deregister");
  assert.ok(dereg > del, "deregistration follows a confirmed release");
});

test("codex channel homes are broker homes: joined teams receive through the broker with the primary", (t) => {
  const fake = fakeAwWake(t);
  const fx = fixture(t, { runtime: "codex" });
  mkdirSync(join(fx.ws, ".aw"), { recursive: true });
  const env = { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify({ root: fx.ws, join: "alpha" }) };
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env }));
  assert.equal(doc.meta.joinedTeams[0].receive, "native");
  assert.equal(fake.registrations()[fx.home].runtime_delivery, "external-session");
  const result = check({ ...fx, settings: { root: fx.ws } }, fake);
  assert.equal(result.warnings.some((w) => w.code === "joined-team-poll-only"), false);
  assert.match(result.warnings.find((w) => w.code === "joined-team-receive").message, /alpha/);
});

test("readiness reports poll when the wake daemon is down for a registered joined team", (t) => {
  const fake = fakeAwWake(t);
  const fx = fixture(t, { runtime: "claude" });
  mkdirSync(join(fx.ws, ".aw"), { recursive: true });
  spawnDoc(runHook("spawn", { cwd: fx.home, env: { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify({ root: fx.ws, join: "alpha" }) } }));
  const down = { ...fake, path: fake.path };
  const result = spawnSync(process.execPath, [BINDING, "check"], {
    cwd: fx.home,
    input: JSON.stringify({ schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: { root: fx.ws }, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: HOSTED_KEY, deployment: fx.ws, soul: "dev", team: "alpha", instance: "dev-1", home: fx.home } } }),
    env: { ...fx.env, PATH: down.path, FAKE_DAEMON_DOWN: "1" }, encoding: "utf8",
  });
  const doc = JSON.parse(result.stdout).result;
  assert.match(doc.warnings.find((w) => w.code === "joined-team-poll-only").message, /alpha.*wake daemon/);
});

test("retire deregisters a channel home that carried joined-team receive", (t) => {
  const fake = fakeAwWake(t);
  const fx = fixture(t, { runtime: "pi" });
  mkdirSync(join(fx.ws, ".aw"), { recursive: true });
  const env = { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify({ root: fx.ws, join: "alpha" }) };
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env }));
  assert.equal(fake.registrations()[fx.home].runtime_delivery, "native-pi");
  const retired = runHook("retire", { cwd: fx.home, env: { ...env, OATS_META: JSON.stringify(doc.meta) } });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(fake.registrations()[fx.home], undefined);
});

// ---------------------------------------------------------------------------
// Real published aw (>= 1.36.13): the admission table for every 1.15 command
// under --identity-home, the broker registration shapes, and every aw
// invocation the skills and inject teach.
const REAL_AW_MIN = [1, 36, 13];
function realAw(t) {
  const v = spawnSync("aw", ["version"], { encoding: "utf8", timeout: 10000 });
  const m = /aw\s+v?(\d+)\.(\d+)\.(\d+)/.exec(`${v.stdout ?? ""}${v.stderr ?? ""}`);
  const ok = m && (() => { const a = m.slice(1, 4).map(Number); for (let i = 0; i < 3; i++) if (a[i] !== REAL_AW_MIN[i]) return a[i] > REAL_AW_MIN[i]; return true; })();
  if (!ok) { t.skip(`needs a published aw >= ${REAL_AW_MIN.join(".")} on PATH (found ${m ? m[0] : "none"})`); return false; }
  t.diagnostic(`aw version fixture: ${`${v.stdout}`.trim().split("\n")[0]}`);
  return true;
}
const POLICY = "not yet identity-home-aware";

test("real aw: admission table for the 1.15 commands under --identity-home", (t) => {
  if (!realAw(t)) return;
  const root = tempDir(t), empty = join(root, "empty"), idh = join(root, ".aweb-identity-alpha"), home = join(root, "home"), state = join(root, "wake-state");
  mkdirSync(idh, { recursive: true }); mkdirSync(home, { recursive: true }); mkdirSync(join(home, ".aw"), { recursive: true });
  const env = { ...process.env, AW_WAKE_STATE_DIR: state };
  const rows = [
    // admitted: fails on its own semantics, never on the identity-home policy
    { name: "mail inbox", args: ["--identity-home", idh, "mail", "inbox", "--json"], admitted: true, expect: /initialized|identity|workspace/i },
    { name: "mail send", args: ["--identity-home", idh, "mail", "send", "--to", "nobody", "--subject", "s", "--body", "b"], admitted: true, expect: /initialized|identity|workspace|recipient/i },
    { name: "mail reply", args: ["--identity-home", idh, "mail", "reply", "m-1", "--body", "b"], admitted: true, expect: /initialized|identity|workspace|message/i },
    { name: "mail ack", args: ["--identity-home", idh, "mail", "ack", "m-1"], admitted: true, expect: /initialized|identity|workspace|message/i },
    { name: "chat pending", args: ["--identity-home", idh, "chat", "pending"], admitted: true, expect: /initialized|identity|workspace/i },
    { name: "chat send-and-leave", args: ["--identity-home", idh, "chat", "send-and-leave", "nobody", "hi"], admitted: true, expect: /initialized|identity|workspace/i },
    { name: "workspace delete", args: ["--identity-home", idh, "workspace", "delete", "nobody", "--json"], admitted: true, expect: /initialized|identity|workspace|alias/i },
    { name: "whoami", args: ["--identity-home", idh, "whoami"], admitted: true, expect: /initialized|identity|workspace|not found/i },
    // refused by aw: why minting roots invite from their own directory (cwd), not --identity-home
    { name: "team invite", args: ["--identity-home", idh, "team", "invite", "--team-id", "x:example.invalid", "--json"], admitted: false, expect: new RegExp(POLICY) },
    { name: "id team members", args: ["--identity-home", idh, "id", "team", "members", "--json"], admitted: false, expect: new RegExp(POLICY) },
  ];
  for (const row of rows) {
    const r = spawnSync("aw", row.args, { cwd: home, env, encoding: "utf8", timeout: 15000 });
    const text = `${r.stdout}${r.stderr}`;
    if (row.admitted) assert.doesNotMatch(text, new RegExp(POLICY), `${row.name}: hit the identity-home policy: ${text}`);
    else assert.match(text, new RegExp(POLICY), `${row.name}: expected the identity-home refusal: ${text}`);
    assert.notEqual(r.status, 0, `${row.name} unexpectedly succeeded`);
    assert.match(text, row.expect, `${row.name}: unexpected failure: ${text}`);
  }
});

test("real aw: the broker accepts the registrations oats.aweb writes (session, native-channel, native-pi)", async (t) => {
  if (!realAw(t)) return;
  const { wakeRegistration } = await import(join(CAPABILITY, "lib", "wake-receive.mjs"));
  const root = tempDir(t), home = join(root, "home"), state = join(root, "wake-state");
  for (const d of [join(home, ".aw"), join(home, ".aweb-identity-alpha"), join(home, ".aweb-identity-beta")]) mkdirSync(d, { recursive: true });
  const joined = [{ label: "alpha", identityHome: join(home, ".aweb-identity-alpha") }, { label: "beta", identityHome: join(home, ".aweb-identity-beta") }];
  for (const [delivery, runtime, expected] of [["session", "claude", "external-session"], ["channel", "claude", "native-channel"], ["channel", "pi", "native-pi"]]) {
    const doc = wakeRegistration({ home, primaryIdentityHome: join(home, ".aw"), delivery, runtime, joined });
    const r = spawnSync("aw", ["wake", "register", "--state-dir", state, "--registration-json", "-"], { input: JSON.stringify(doc), encoding: "utf8", timeout: 15000 });
    assert.equal(r.status, 0, `${expected}: ${r.stdout}${r.stderr}`);
    const status = JSON.parse(spawnSync("aw", ["wake", "status", "--state-dir", state, "--json"], { encoding: "utf8", timeout: 15000 }).stdout);
    assert.equal(status.state_dir, state, "real-aw wake tests must use a temp state dir, never the host broker state");
    assert.ok(existsSync(join(state, "instances.d")), "aw wake register/status initialized the isolated temp state dir");
    const row = status.instances.find((i) => i.home === home);
    assert.equal(row.runtime_delivery, expected);
    const labels = row.receive_identities.map((ri) => ri.label);
    assert.deepEqual(labels, expected === "external-session" ? ["default", "alpha", "beta"] : ["alpha", "beta"]);
  }
  const overlap = spawnSync("aw", ["wake", "register", "--state-dir", state, "--registration-json", "-"], { input: JSON.stringify({ home, runtime_delivery: "native-channel", primary_identity_home: join(home, ".aw"), receive_identities: [{ identity_home: join(home, ".aw") }] }), encoding: "utf8" });
  assert.notEqual(overlap.status, 0, "aw refuses a broker stream on the channel-owned primary");
  const dereg = spawnSync("aw", ["wake", "deregister", "--state-dir", state, "--home", home], { encoding: "utf8" });
  assert.equal(dereg.status, 0, dereg.stderr);
});

/** Every `aw …` invocation the agent guidance teaches, from code blocks and
 *  inline code: the subcommand path must exist and each --flag it uses must be
 *  on that command's help. */
function citedAwInvocations(text) {
  const out = [];
  const clean = (line) => line.replace(/\s+#.*$/, "").trim();
  for (const block of text.matchAll(/```(?:bash|sh)?\n([\s\S]*?)```/g)) for (const line of block[1].split("\n")) { const l = clean(line); if (/^aw\s/.test(l)) out.push(l); }
  for (const m of text.matchAll(/`(aw\s[^`]+)`/g)) out.push(m[1].trim());
  return [...new Set(out)];
}
function parseInvocation(inv) {
  let words = inv.split(/\s+/).slice(1);
  if (words[0] === "--identity-home") words = words.slice(2);
  const path = [];
  for (const w of words) { if (/^[a-z][a-z0-9-]*$/.test(w) && !w.includes("|")) path.push(w); else break; }
  const alt = words.find((w) => /^[a-z]+\|[a-z|]+$/.test(w));
  const flags = words.filter((w) => /^--[a-z][a-z0-9-]*$/.test(w));
  return { path, flags, alt };
}

test("real aw: every aw invocation in the skills and inject exists with its flags", (t) => {
  if (!realAw(t)) return;
  const files = [
    join(CAPABILITY, "injects", "aweb.md"),
    ...["oats-aweb", "aweb-messaging", "aweb-team-membership", "aweb-identity"].map((s) => join(CAPABILITY, "skills", s, "SKILL.md")),
  ];
  const helpCache = new Map();
  const help = (path) => {
    const key = path.join(" ");
    if (!helpCache.has(key)) { const r = spawnSync("aw", [...path, "--help"], { encoding: "utf8", timeout: 10000 }); helpCache.set(key, { ok: r.status === 0, text: `${r.stdout}${r.stderr}` }); }
    return helpCache.get(key);
  };
  let checked = 0;
  const problems = [];
  for (const file of files) {
    for (const inv of citedAwInvocations(readFileSync(file, "utf8"))) {
      const { path, flags, alt } = parseInvocation(inv);
      if (!path.length && !alt) continue;
      const paths = alt ? alt.split("|").map((a) => [...path, a]) : [path];
      for (const full of paths) {
        // The longest prefix that is a command; any remaining words must be
        // positionals that command's usage line declares (<arg> or [arg]).
        const isCommand = (q) => { const h = help(q); return h.ok && new RegExp(`Usage:\\s*\\n\\s*aw ${q.join(" ")}(\\s|$)`).test(h.text); };
        let p = full;
        while (p.length && !isCommand(p)) p = p.slice(0, -1);
        const h = p.length ? help(p) : undefined;
        const usage = h ? (new RegExp(`Usage:\\s*\\n\\s*(aw ${p.join(" ")}[^\\n]*)`).exec(h.text)?.[1] || "") : "";
        if (!p.length || (p.length < full.length && !/[<[]/.test(usage.slice(`aw ${p.join(" ")}`.length)))) { problems.push(`${file.split("/oats-aweb/").pop()}: \`${inv}\` → aw ${full.join(" ")} is not a command`); continue; }
        for (const f of flags) if (f !== "--identity-home" && f !== "--help" && !h.text.includes(`${f} `) && !h.text.includes(`${f}\n`)) problems.push(`${file.split("/oats-aweb/").pop()}: \`${inv}\` → aw ${p.join(" ")} has no ${f}`);
        checked++;
      }
    }
  }
  t.diagnostic(`checked ${checked} cited aw invocations`);
  assert.ok(checked > 20);
  assert.deepEqual(problems, []);
});

test("commands run from inside an instance session (AWEB_IDENTITY_HOME set) still work", (t) => {
  const fake = fakeAwWake(t);
  const fx = fixture(t);
  mkdirSync(join(fx.ws, ".aw"), { recursive: true });
  const env = { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify({ root: fx.ws }) };
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env }));
  const session = { ...env, AWEB_IDENTITY_HOME: join(fx.home, ".aw"), OATS_META: JSON.stringify(doc.meta) };
  const roster = spawnSync(process.execPath, [HOOK, "roster", "--json"], { cwd: fx.home, env: { ...session, OATS_EVENT: "roster" }, encoding: "utf8" });
  assert.equal(roster.status, 0, roster.stdout + roster.stderr);
  assert.equal(JSON.parse(roster.stdout).team_id, "legacy:example.test");
  const joined = spawnSync(process.execPath, [HOOK, "join", "--labels", "alpha", "--json"], { cwd: fx.home, env: { ...session, OATS_EVENT: "join" }, encoding: "utf8" });
  assert.equal(joined.status, 0, joined.stdout + joined.stderr);

  // A nested spawn inherits the spawner's AWEB_IDENTITY_HOME: the new instance
  // still mints its own identity, and retiring it deletes ITS workspace.
  const worker = join(fx.ws, "agents", "dev", "instances", "dev-w");
  mkdirSync(worker, { recursive: true });
  const nested = { ...env, AWEB_IDENTITY_HOME: join(fx.home, ".aw"), OATS_HOME: worker, OATS_INSTANCE: "dev-w" };
  const wdoc = spawnDoc(runHook("spawn", { cwd: worker, env: nested }));
  assert.equal(wdoc.meta.alias, "dev-w");
  const retired = runHook("retire", { cwd: worker, env: { ...nested, OATS_META: JSON.stringify(wdoc.meta) } });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(fake.readCalls().some((c) => c.viaEnv), false, "no aw call ran under the spawner's identity");
});

test("a partly failed multi-label leave records what already happened", (t) => {
  const fake = fakeAwWake(t);
  const fx = fixture(t);
  mkdirSync(join(fx.ws, ".aw"), { recursive: true });
  const env = { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify({ root: fx.ws, join: "alpha,beta" }) };
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env }));
  assert.equal(doc.meta.joinedTeams.length, 2);
  rmSync(join(fx.home, ".aweb-identity-beta", "team-certs"), { recursive: true, force: true });
  const left = spawnSync(process.execPath, [HOOK, "leave", "--labels", "alpha,beta", "--json"], { cwd: fx.home, env: { ...env, OATS_EVENT: "leave", OATS_META: JSON.stringify(doc.meta), FAKE_DELETE_FAIL_FOR: "beta" }, encoding: "utf8" });
  assert.notEqual(left.status, 0);
  const state = JSON.parse(readFileSync(join(fx.home, ".oats-aweb", "teams.json"), "utf8"));
  assert.deepEqual(state.joinedTeams.map((j) => j.label), ["beta"], "alpha's confirmed leave is recorded despite beta failing");
  assert.deepEqual(fake.registrations()[fx.home].receive_identities.map((r) => r.label), ["beta"], "the broker registration follows the recorded state");
});

test("oats aweb join is refused for resident-grant (global) homes", (t) => {
  const fake = fakeAwWake(t);
  const fx = fixture(t);
  const joined = spawnSync(process.execPath, [HOOK, "join", "--labels", "alpha", "--json"], { cwd: fx.home, env: { ...fx.env, PATH: fake.path, OATS_EVENT: "join", OATS_SETTINGS: JSON.stringify({ identity: { mode: "global", resident: "r" } }) }, encoding: "utf8" });
  assert.notEqual(joined.status, 0);
  assert.match(joined.stderr, /global/);
});

// ---------------------------------------------------------------------------
// Home operations under `oats operation run` (messaging:teams|join|leave): the
// kernel runs `node <script> <command> [--labels L] --json` in the home with
// OATS_OPERATION=<address> and stdin closed, and trusts only exactly one JSON-v1
// envelope whose ok agrees with the exit status (vendored rule).
function runOperation(address, command, { cwd, env, labels }) {
  const argv = [HOOK, command, ...(labels ? ["--labels", labels] : []), "--json"];
  const { OATS_EVENT, ...rest } = env;
  return spawnSync(process.execPath, argv, { cwd, env: { ...rest, OATS_OPERATION: address }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 });
}
function operationFixture(t, settings = {}) {
  const fake = fakeAwWake(t);
  const fx = fixture(t, { delivery: "session" });
  const env = { ...fx.env, PATH: fake.path, OATS_SETTINGS: JSON.stringify({ delivery: "session", ...settings }) };
  const doc = spawnDoc(runHook("spawn", { cwd: fx.home, env }));
  writeFileSync(join(fx.home, "instance.json"), JSON.stringify({ instance: "dev-1", capabilityMeta: { "oats.aweb": doc.meta } }));
  return { fake, fx, env };
}

test("operations answer one JSON-v1 envelope: teams, join and leave succeed", (t) => {
  const { fx, env } = operationFixture(t);
  let v = assertKernelOperationAnswer(runOperation("messaging:teams", "teams", { cwd: fx.home, env }), { ok: true, label: "messaging:teams" });
  assert.equal(v.result.defaultTeam.team, "legacy:example.test");
  assert.deepEqual(v.result.joined, []);
  v = assertKernelOperationAnswer(runOperation("messaging:join", "join", { cwd: fx.home, env, labels: "alpha" }), { ok: true, label: "messaging:join" });
  assert.deepEqual(v.result.actions.map((a) => [a.action, a.label]), [["join", "alpha"]]);
  assert.deepEqual(v.result.joined.map((j) => [j.label, j.receive]), [["alpha", "native"]]);
  v = assertKernelOperationAnswer(runOperation("messaging:leave", "leave", { cwd: fx.home, env, labels: "alpha" }), { ok: true, label: "messaging:leave" });
  assert.deepEqual(v.result.actions.map((a) => [a.action, a.label, a.released]), [["leave", "alpha", "released"]]);
  assert.deepEqual(v.result.joined, []);
});

test("operations answer a failure envelope with the provider's code and a nonzero exit", (t) => {
  const { fake, fx, env } = operationFixture(t);
  let v = assertKernelOperationAnswer(runOperation("messaging:join", "join", { cwd: fx.home, env, labels: "ghost" }), { ok: false, label: "join ghost" });
  assert.equal(v.code, "E_TEAM_NOT_ELIGIBLE");
  assert.match(v.message, /alpha, beta/);
  v = assertKernelOperationAnswer(runOperation("messaging:leave", "leave", { cwd: fx.home, env, labels: "default" }), { ok: false, label: "leave personal" });
  assert.equal(v.code, "E_TEAM_DEFAULT");
  v = assertKernelOperationAnswer(runOperation("messaging:join", "join", { cwd: fx.home, env: { ...env, OATS_SETTINGS: JSON.stringify({ identity: { mode: "global", resident: "r" } }) }, labels: "alpha" }), { ok: false, label: "join global" });
  assert.equal(v.code, "E_TEAM_GLOBAL_MODE");
  // A refusal printed before any document (aw missing from PATH) still answers.
  const noAw = join(tempDir(t), "bin");
  mkdirSync(noAw, { recursive: true });
  symlinkSync(process.execPath, join(noAw, "node"));
  v = assertKernelOperationAnswer(runOperation("messaging:teams", "teams", { cwd: fx.home, env: { ...env, PATH: `${noAw}:/usr/bin:/bin` } }), { ok: false, label: "teams without aw" });
  assert.match(v.message, /aw CLI not on PATH/);
  // A partly failed leave reports what already happened in error.details.
  assertKernelOperationAnswer(runOperation("messaging:join", "join", { cwd: fx.home, env, labels: "alpha,beta" }), { ok: true, label: "join alpha,beta" });
  const r = runOperation("messaging:leave", "leave", { cwd: fx.home, env: { ...env, FAKE_DELETE_FAIL_FOR: "beta" }, labels: "alpha,beta" });
  v = assertKernelOperationAnswer(r, { ok: false, label: "partial leave" });
  assert.deepEqual(v.envelope.error.details.actions.map((a) => a.label), ["alpha"]);
  assert.deepEqual(v.envelope.error.details.joined.map((j) => j.label), ["beta"]);
  assert.deepEqual(fake.readCalls().filter((c) => c.forbidden), []);
});

test("from a shell (no OATS_OPERATION) teams --json keeps its bare document", (t) => {
  const { fx, env } = operationFixture(t);
  const r = spawnSync(process.execPath, [HOOK, "teams", "--json"], { cwd: fx.home, env: { ...env, OATS_EVENT: "teams" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.schemaVersion, undefined);
  assert.equal(doc.defaultTeam.team, "legacy:example.test");
  assert.equal(doc.defaultTeam.from, "deployment");
});

test("teams defaultTeam.from is always present and derived from kernel env for older homes", (t) => {
  const { fx, env } = operationFixture(t, {});
  const instanceJson = JSON.parse(readFileSync(join(fx.home, "instance.json"), "utf8"));
  delete instanceJson.capabilityMeta["oats.aweb"].defaultTeam.from;
  writeFileSync(join(fx.home, "instance.json"), JSON.stringify(instanceJson));
  const v = assertKernelOperationAnswer(runOperation("messaging:teams", "teams", { cwd: fx.home, env }), { ok: true, label: "messaging:teams deployment" });
  assert.equal(v.result.defaultTeam.from, "deployment");
});
