// awebai/oats-aweb#241: a retained seat's spawn (identity.source) takes its aweb service
// only from the seat's own record, `<source>/workspace.yaml` `aweb_url` (aw writes it at
// `aw workspace connect`). OATS_AWEB_URL is no longer read on this route: with no record the
// spawn refuses before any copy or effect, naming the whole fix; with a record, a set
// variable is ignored with a warning. Neither text ever prints the variable's value. The
// rebind command a retire prints names the same server the spawn used, as a command only when
// it is a plain service URL.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fakeAw } from "./helpers/fake-aw-grant.mjs";

const HOOK = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const TEAM = "t:example.test";
const RECORD = "https://record.invalid/api";
const VARIABLE = "https://variable.invalid/api";

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function fixture(t, { workspace = `alias: retained\naweb_url: ${RECORD}\n` } = {}) {
  const base = mkdtempSync(join(tmpdir(), "oats-aweb-241-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "retained"); mkdirSync(home, { recursive: true });
  const source = join(base, "seats", "retained", ".aw");
  write(join(source, "signing.key"), "fixture-signing-key");
  write(join(source, "identity.yaml"), "alias: retained\ndid: did:key:zRetained\naddress: fixture.test/retained\n");
  write(join(source, "teams.yaml"), `active_team: ${TEAM}\n`);
  if (workspace !== null) write(join(source, "workspace.yaml"), workspace);
  return { base, root, home, source, legacyHome: dirname(source), lock: join(dirname(source), ".aw-retained-seat.json"), bin: fakeAw(base) };
}
function runHook(fx, event, env = {}) {
  const base = { ...process.env };
  delete base.OATS_AWEB_URL;
  const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: {
    ...base, PATH: `${fx.bin}:${process.env.PATH}`, OATS_EVENT: event, OATS_INSTANCE: "retained", OATS_HOME: fx.home,
    OATS_WORKSPACE: fx.root, OATS_CONTEXT: fx.root, OATS_RUNTIME: "codex", FAKE_RETAINED: "1",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]),
    OATS_SETTINGS: JSON.stringify({ delivery: "session", identity: { mode: "local", source: fx.source } }), ...env } });
  let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
  return { ...r, doc };
}
const awCalls = (fx) => { try { return readFileSync(join(fx.base, "aw.log"), "utf8").trim().split(/\n/).filter(Boolean).map(JSON.parse); } catch { return []; } };
const connectServices = (fx) => awCalls(fx).filter((c) => c.argv[0] === "workspace" && c.argv[1] === "connect").map((c) => c.argv.find((a) => a.startsWith("--service=")));
/** The whole fix a refusal names, in fixed text, for a fixture's source. */
const fix = (fx) => `run \`aw workspace connect --service <the team's aweb server>\` in ${fx.legacyHome}`;
const NOTE = /OATS_AWEB_URL is set, but it is no longer read for a retained seat/;
function assertNoEffect(fx, refused) {
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.equal(refused.doc?.meta, undefined, "no seat is reported");
  assert.equal(existsSync(fx.lock), false, "no lock is taken");
  assert.equal(existsSync(join(fx.home, ".aw")), false, "nothing is copied");
  assert.deepEqual(awCalls(fx).map((c) => c.argv.join(" ")).filter((a) => !["version", "wake status --json"].includes(a)), [], "no aw command runs but the read-only preflight probes");
}

// Pinned acceptance: record only → spawns with the record's service.
test("a seat with an aweb_url record spawns with the record's service", (t) => {
  const fx = fixture(t);
  const spawned = runHook(fx, "spawn");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  assert.equal(spawned.doc.meta.retained, true);
  assert.deepEqual(connectServices(fx), [`--service=${RECORD}`]);
  assert.doesNotMatch(spawned.doc.warning || "", /OATS_AWEB_URL/, "no warning when the variable is not set");
});

// Pinned acceptance: variable only → refuses with the whole fix and the note, no effect.
test("a seat with no aweb_url record and OATS_AWEB_URL set refuses with the whole fix and the note, before any effect", (t) => {
  const fx = fixture(t, { workspace: "alias: retained\n" });
  const refused = runHook(fx, "spawn", { OATS_AWEB_URL: VARIABLE });
  assertNoEffect(fx, refused);
  assert.ok(refused.doc.warning.includes(fix(fx)), refused.doc.warning);
  assert.match(refused.doc.warning, NOTE);
  assert.ok(!refused.doc.warning.includes(VARIABLE), "the variable's value is never printed");
});

test("a seat with no workspace.yaml at all and OATS_AWEB_URL set refuses the same way", (t) => {
  const fx = fixture(t, { workspace: null });
  const refused = runHook(fx, "spawn", { OATS_AWEB_URL: VARIABLE });
  assertNoEffect(fx, refused);
  assert.ok(refused.doc.warning.includes(fix(fx)), refused.doc.warning);
  assert.match(refused.doc.warning, NOTE);
  assert.ok(!refused.doc.warning.includes(VARIABLE), "the variable's value is never printed");
});

// Pinned acceptance: both set and different → the record's service is used and the warning is given.
test("a seat with a record and a different OATS_AWEB_URL uses the record and warns the variable is ignored", (t) => {
  const fx = fixture(t);
  const spawned = runHook(fx, "spawn", { OATS_AWEB_URL: VARIABLE });
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  assert.deepEqual(connectServices(fx), [`--service=${RECORD}`], "the record, never the variable");
  assert.match(spawned.doc.warning, /OATS_AWEB_URL is set, but it is ignored for a retained seat/);
  assert.ok(!spawned.doc.warning.includes(VARIABLE), "the variable's value is never printed");
});

// Pinned acceptance: neither → refuses with the whole fix.
test("a seat with neither a record nor OATS_AWEB_URL refuses with the whole fix, before any effect", (t) => {
  const fx = fixture(t, { workspace: "alias: retained\n" });
  const refused = runHook(fx, "spawn");
  assertNoEffect(fx, refused);
  assert.ok(refused.doc.warning.includes(fix(fx)), refused.doc.warning);
  assert.doesNotMatch(refused.doc.warning, /OATS_AWEB_URL/, "no note when the variable is not set");
});

test("a record holding shell text is refused with the whole fix, and never printed", (t) => {
  const fx = fixture(t, { workspace: "alias: retained\naweb_url: https://fixture.invalid/$(touch pwned)\n" });
  const refused = runHook(fx, "spawn");
  assertNoEffect(fx, refused);
  assert.ok(refused.doc.warning.includes(fix(fx)), refused.doc.warning);
  assert.match(refused.doc.warning, /is not a usable service URL/);
  assert.doesNotMatch(refused.doc.warning, /touch pwned/);
});

// Any http(s) aweb_url with no userinfo, query or fragment is the seat's service, so a server
// behind a path prefix or at an IPv6 literal spawns; it reaches aw as one argv element.
for (const [name, url] of [
  ["a path prefix", "https://record.invalid/aweb/api"],
  ["an IPv6 literal", "http://[2001:db8::1]:8000/api"],
  ["a quoted path prefix", "https://record.invalid/team-a/aweb"],
]) test(`a seat whose aweb_url has ${name} spawns with it`, (t) => {
  const q = name.startsWith("a quoted") ? '"' : "";
  const fx = fixture(t, { workspace: `alias: retained\naweb_url: ${q}${url}${q}\n` });
  const spawned = runHook(fx, "spawn");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  assert.deepEqual(connectServices(fx), [`--service=${url}`]);
});

// Refused as a service (`unusable`: not http(s), userinfo, a query, a fragment, whitespace,
// control characters, a backslash, no host; the raw string is checked before it is parsed, as
// WHATWG URL parsing would drop a tab or a newline) or as a record (`outside`: a file outside
// the form aw writes, from which nothing is taken; lib/aw-record.mjs has the grammar's table).
// Each names the whole fix, before any effect, and never prints the value.
const MARK = "secretmark";
const UNUSABLE = /is not a usable service URL \(http or https and a host, with no userinfo, query, fragment, whitespace or control characters\)/;
const OUTSIDE = /workspace\.yaml is not in the form aw writes/;
for (const [name, value, why] of [
  ["userinfo", `https://${MARK}:pw@record.invalid/api`, UNUSABLE],
  ["an empty userinfo", `https://@record.invalid/${MARK}`, UNUSABLE],
  ["a query", `https://record.invalid/api?token=${MARK}`, UNUSABLE],
  ["an empty query", `https://record.invalid/${MARK}?`, UNUSABLE],
  ["a fragment", `https://record.invalid/api#${MARK}`, UNUSABLE],
  ["a space", `"https://record.invalid/${MARK} x"`, UNUSABLE],
  ["a tab", `"https://record.invalid/${MARK}\tx"`, UNUSABLE],
  ["a control character", `"https://record.invalid/${MARK}\u0001"`, UNUSABLE],
  ["a backslash", `https://record.invalid\\${MARK}`, UNUSABLE],
  ["another scheme", `ftp://record.invalid/${MARK}`, UNUSABLE],
  ["no host", `https:///${MARK}`, UNUSABLE],
  ["a line separator", `https://record.invalid/path\u2028  ${MARK}`, OUTSIDE],
  ["a paragraph separator", `https://record.invalid/path\u2029${MARK}`, OUTSIDE],
  ["a continuation line", `https://record.invalid/path\n  ${MARK}`, OUTSIDE],
  ["a continuation after blank lines", `https://record.invalid/path\n\n  \n  ${MARK}`, OUTSIDE],
  ["a second aweb_url", `https://record.invalid/api\naweb_url: https://other.invalid/${MARK}`, OUTSIDE],
  ["a flow mapping holding another aweb_url", `https://record.invalid/api\nother: {\naweb_url: https://other.invalid/${MARK}\n}`, OUTSIDE],
  ["a quoted key beside an aweb_url in a flow mapping", `https://other.invalid/${MARK}\n"aweb_url": https://record.invalid/api`, OUTSIDE],
]) test(`a seat whose aweb_url has ${name} is refused with the whole fix, before any effect, and never printed`, (t) => {
  const fx = fixture(t, { workspace: `alias: retained\naweb_url: ${value}\n` });
  const refused = runHook(fx, "spawn");
  assertNoEffect(fx, refused);
  assert.ok(refused.doc.warning.includes(fix(fx)), refused.doc.warning);
  assert.match(refused.doc.warning, why);
  assert.ok(!refused.stdout.includes(MARK) && !refused.stderr.includes(MARK), "the value is never printed");
});

// The reviewer's case: YAML gives the quoted top-level key's value; a line search would take
// the one inside the flow mapping. The record is outside aw's form, so neither is taken.
test("a record whose aweb_url line sits inside a flow mapping is refused, not read", (t) => {
  const fx = fixture(t, { workspace: `"aweb_url": https://actual.invalid/api\nother: {\naweb_url: https://wrong.invalid/${MARK}\n}\n` });
  const refused = runHook(fx, "spawn");
  assertNoEffect(fx, refused);
  assert.match(refused.doc.warning, OUTSIDE);
  assert.ok(!refused.stdout.includes("wrong.invalid"), refused.stdout);
});
test("a record whose aweb_url line sits inside a multi-line quoted scalar is refused, not read", (t) => {
  const fx = fixture(t, { workspace: `alias: retained\nnote: "first\naweb_url: https://wrong.invalid/${MARK}\n"\n` });
  const refused = runHook(fx, "spawn");
  assertNoEffect(fx, refused);
  assert.match(refused.doc.warning, OUTSIDE);
});

test("a record with Windows line endings names its service without the carriage return", (t) => {
  const fx = fixture(t, { workspace: "alias: retained\r\naweb_url: https://record.invalid/aweb/api\r\n" });
  const spawned = runHook(fx, "spawn");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  assert.deepEqual(connectServices(fx), ["--service=https://record.invalid/aweb/api"]);
});

// The seat's service is never printed, and aw's diagnostics may name it, so a failed spawn's
// aw calls show none of their output, whatever the service's shape.
for (const [shape, url] of [["a plain service URL", RECORD], ["a service with a path prefix and shell text", "https://record.invalid/mark-$(id)/api"]]) {
  for (const call of ["connect", "check", "heartbeat", "status", "whoami"]) {
    test(`a spawn whose ${call} fails never prints its service, ${shape}`, (t) => {
      const fx = fixture(t, { workspace: `alias: retained\naweb_url: ${url}\n` });
      const refused = runHook(fx, "spawn", { FAKE_RETAINED_ECHO: call });
      assert.equal(refused.status, 1, refused.stdout + refused.stderr);
      assert.match(refused.doc.warning, /retained identity could not be seated/);
      assert.match(refused.doc.warning, /output withheld: aw's output may name the seat's service, which is never printed/);
      assert.ok(!refused.stdout.includes(url) && !refused.stderr.includes(url), refused.stdout + refused.stderr);
    });
  }
}

// The rebind a retire prints is a command only for a plain service URL; for any other accepted
// service it says where the service is, in prose, and never prints it.
test("the rebind for a seat whose service has a path prefix is prose, naming where the service is", (t) => {
  const url = "https://record.invalid/aweb/api";
  const fx = fixture(t, { workspace: `alias: retained\naweb_url: ${url}\n` });
  const spawned = runHook(fx, "spawn", { FAKE_RETAINED_KILL: "after-connect" });
  assert.equal(spawned.signal, "SIGKILL", "the hook was killed after the connect");
  assert.deepEqual(connectServices(fx), [`--service=${url}`]);
  const retired = runHook(fx, "retire", { OATS_META: "{}" });
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.ok(retired.doc.warning.includes(`run \`aw workspace connect\` with the service, team and role in its workspace.yaml from ${fx.legacyHome}`), retired.doc.warning);
  assert.ok(!retired.doc.warning.includes(url), "the service is not printed in a command");
});

// Readiness predicts the spawn's refusal with the same resolver: at soul scope, a retained
// seat whose record names no usable service is a needs-configuration problem carrying the
// spawn's text. A seated home's readiness does not read the source again.
const BINDING = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb-binding.mjs", import.meta.url).pathname);
function readiness(fx, { home, env = {} } = {}) {
  const base = { ...process.env };
  delete base.OATS_AWEB_URL;
  const context = { kind: "workspace", workspace: fx.root, deployment: fx.root, soul: "dev", ...(home ? { instance: "retained", home } : {}) };
  const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: { delivery: "session", root: fx.root, identity: { mode: "local", source: fx.source } }, input: { action: { kind: "readiness" }, context } };
  const r = spawnSync(process.execPath, [BINDING, "check"], { input: JSON.stringify(input), encoding: "utf8", env: { ...base, PATH: `${fx.bin}:${process.env.PATH}`,
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]), ...env } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout).result;
}
const serviceProblems = (result) => result.problems.filter((p) => /aweb service is unknown/.test(p.message));

for (const [name, workspace] of [["no aweb_url record, OATS_AWEB_URL set", "alias: retained\n"], ["a record with userinfo", "alias: retained\naweb_url: https://user:pw@record.invalid/api\n"], ["a record with a tab", "alias: retained\naweb_url: \"https://record.invalid/a\tb\"\n"], ["a record with a continuation line", "alias: retained\naweb_url: https://record.invalid/a\n  b\n"], ["a record with a continuation after a blank line", "alias: retained\naweb_url: https://record.invalid/path\n\n  continued\n"]]) {
  test(`soul readiness reports the spawn's refusal for a retained seat with ${name}`, (t) => {
    const fx = fixture(t, { workspace });
    const spawned = runHook(fx, "spawn", { OATS_AWEB_URL: VARIABLE });
    assert.equal(spawned.status, 1, spawned.stdout + spawned.stderr);
    const result = readiness(fx, { env: { OATS_AWEB_URL: VARIABLE } });
    assert.equal(result.status, "needs-configuration", JSON.stringify(result));
    assert.deepEqual(serviceProblems(result).map((p) => [p.code, `oats-aweb: ${p.message}`]), [["needs-configuration", spawned.doc.warning]]);
    assert.ok(!JSON.stringify(result).includes(VARIABLE), "the variable's value is never printed");
  });
}

test("soul readiness reports no service problem for a retained seat whose record names its service", (t) => {
  const fx = fixture(t);
  assert.deepEqual(serviceProblems(readiness(fx, { env: { OATS_AWEB_URL: VARIABLE } })), []);
});

test("soul readiness reports no service problem for a retained seat whose service has a path prefix", (t) => {
  const fx = fixture(t, { workspace: "alias: retained\naweb_url: https://record.invalid/aweb/api\n" });
  assert.deepEqual(serviceProblems(readiness(fx)), []);
});

test("a seated home's readiness does not read its source's record again", (t) => {
  const fx = fixture(t);
  const spawned = runHook(fx, "spawn");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  writeFileSync(join(fx.source, "workspace.yaml"), "alias: retained\n");
  assert.deepEqual(serviceProblems(readiness(fx, { home: fx.home })), []);
});
