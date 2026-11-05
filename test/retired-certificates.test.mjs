// Certificates that retires left in a people-controlled team are recorded on this host and
// marked by `oats aweb roster`. In a team whose controller key is held by people, `aw
// workspace delete` answers alias_released false, team_not_hosted: only the controller can
// remove the member. Retire keeps its warning and pendingControllerCleanup meta unchanged and
// also records each certificate at <deployment>/.oats-aweb/retired-certificates.json; roster
// matches the team's listed certificates against it on team and certificate id.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CAPABILITY = join(REPO, "oats-package", "capabilities", "oats-aweb");
const HOOK = join(CAPABILITY, "bin", "oats-aweb.mjs");
const LIB = join(CAPABILITY, "lib", "retired-certificates.mjs");
const { RETIRED_RECORD_MAX, recordRetiredCertificates } = await import(pathToFileURL(LIB).href);
const DEFAULT = "default:example.test", SHARED = "shared:example.test";
const DEFAULT_COMMAND = "aw id team remove-member --namespace example.test --team default --cert-id cert-default-123 --registry https://api.awid.ai --json";
const SHARED_COMMAND = "aw id team remove-member --namespace example.test --team shared --cert-id cert-shared-123 --registry https://api.awid.ai --json";
// The retire's warning and meta exactly as oats.aweb 1.38.0 (2a20792) printed them for this
// fixture: recording adds nothing to either.
const BASE_WARNING = `oats-aweb: joined team shared cleanup failed: team_not_hosted; controller cleanup: ${SHARED_COMMAND} | default identity cleanup failed: team_not_hosted; controller cleanup: ${DEFAULT_COMMAND}`;
const BASE_PENDING = [
  { label: "shared", team: SHARED, alias: "dev-1", certificateId: "cert-shared-123", command: SHARED_COMMAND },
  { label: "default", team: DEFAULT, alias: "dev-1", certificateId: "cert-default-123", command: DEFAULT_COMMAND },
];
const NOT_WRITABLE = "oats-aweb: could not record the controller cleanup on this host: the record directory is not writable";

function tempDir(t, prefix = "oats-aweb-retired-") {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => { try { chmodSync(join(dir, ".oats-aweb"), 0o700); } catch { /* not made read-only */ } rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

/** A fake aw whose team is not hosted: every `workspace delete` answers alias_released false,
 *  team_not_hosted. `id team members` and `workspace status` answer the fixture's files. */
function fakeAw(t, dir) {
  const bin = join(dir, "bin");
  write(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs");
let args = process.argv.slice(2), identityHome = null;
if (args[0] === "--identity-home") { identityHome = args[1]; args = args.slice(2); }
const emit = (o) => console.log(JSON.stringify(o));
const cmd = args.slice(0, 3).join(" ");
if (args[0] === "version") { console.log("aw 1.36.33 abcdef"); process.exit(0); }
if (args[0] === "workspace" && args[1] === "delete") { emit({ alias_released: false, alias_released_reason: "team_not_hosted" }); process.exit(0); }
if (cmd === "id team list") { emit({ memberships: [{ team_id: String(identityHome || "").includes(".aweb-identity-shared") ? ${JSON.stringify(SHARED)} : ${JSON.stringify(DEFAULT)}, registry_origin: "https://api.awid.ai" }] }); process.exit(0); }
if (cmd === "id team members") { fs.writeSync(1, fs.readFileSync(${JSON.stringify(join(dir, "members.json"))}, "utf8")); process.exit(0); }
if (args[0] === "workspace" && args[1] === "status") { emit({ selected_team: ${JSON.stringify(DEFAULT)}, team_has_more: false, team: [] }); process.exit(0); }
if (args[0] === "wake") { console.log("ok"); process.exit(0); }
console.error("fake aw: unexpected " + args.join(" ")); process.exit(93);
`);
  chmodSync(join(bin, "aw"), 0o755);
  return `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`;
}

/** A deployment (oats-local.yaml, a root for the default team) and an instance home whose
 *  default identity and joined team `shared` each hold a certificate in a team not hosted. */
function fixture(t) {
  const ws = tempDir(t), root = join(ws, "root"), home = join(ws, "agents", "dev", "instances", "dev-1");
  write(join(ws, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  write(join(root, ".aw", "identity.yaml"), "alias: root\n");
  const sharedHome = join(home, ".aweb-identity-shared");
  write(join(home, ".aw", "identity.yaml"), `alias: dev-1\nteam_id: ${DEFAULT}\n`);
  write(join(home, ".aw", "team-certs", "default__example.test.pem"), JSON.stringify({ version: 1, certificate_id: "cert-default-123", team_id: DEFAULT, alias: "dev-1" }));
  write(join(sharedHome, "identity.yaml"), `alias: dev-1\nteam_id: ${SHARED}\n`);
  write(join(sharedHome, "team-certs", "shared__example.test.pem"), JSON.stringify({ version: 1, certificate_id: "cert-shared-123", team_id: SHARED, alias: "dev-1" }));
  const meta = { alias: "dev-1", team: DEFAULT, identity: { mode: "local", alias: "dev-1", team: DEFAULT }, joinedTeams: [{ label: "shared", team: SHARED, identityHome: sharedHome, alias: "dev-1", receive: "poll", since: "2026-11-01T00:00:00.000Z" }] };
  const teams = [{ label: "personal", team: DEFAULT, default: true, from: "local" }, { label: "shared", team: SHARED, default: false, from: "shared" }];
  const env = {
    PATH: fakeAw(t, ws), OATS_HOME: home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: ws,
    OATS_DEFAULT_TEAM: "personal", OATS_DEFAULT_TEAM_ID: DEFAULT, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify(teams), OATS_TEAMS_SOURCE: "live", OATS_RUNTIME: "claude",
    OATS_SETTINGS: JSON.stringify({ roots: { [DEFAULT]: root } }),
  };
  const hook = (event, args = [], extra = {}) => spawnSync(process.execPath, [HOOK, event, ...args], { cwd: home, env: { ...env, OATS_EVENT: event, ...extra }, encoding: "utf8", timeout: 30000 });
  const retire = () => {
    // A fresh retire of the same identities: the default-retire marker would skip the self-delete.
    rmSync(join(home, ".oats-aweb", "default-retire.json"), { force: true });
    const r = hook("retire", [], { OATS_META: JSON.stringify(meta) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout);
  };
  const members = (list) => writeFileSync(join(ws, "members.json"), JSON.stringify({ team_id: DEFAULT, members: list }));
  return { ws, home, retire, hook, members, recordFile: join(ws, ".oats-aweb", "retired-certificates.json") };
}
const readRecord = (file) => JSON.parse(readFileSync(file, "utf8"));
const entry = (certificateId) => ({ team: "t:example.test", certificateId, alias: "a", instance: "a", retiredAt: "2026-11-05T00:00:00.000Z", command: `aw id team remove-member --cert-id ${certificateId}` });
const mode = (p) => statSync(p).mode & 0o777;

test("retire records each controller cleanup at the deployment, its warning and meta unchanged", (t) => {
  const fx = fixture(t);
  const doc = fx.retire();
  assert.equal(doc.warning, BASE_WARNING);
  assert.deepEqual(doc.meta.pendingControllerCleanup, BASE_PENDING);
  assert.equal(doc.meta.retired, true);
  assert.equal(doc.meta.aliasReason, "team_not_hosted");
  assert.equal(mode(join(fx.ws, ".oats-aweb")), 0o700);
  assert.equal(mode(fx.recordFile), 0o600);
  const record = readRecord(fx.recordFile);
  assert.equal(record.version, 1);
  assert.deepEqual(record.entries.map(({ retiredAt, ...rest }) => rest), [
    { team: SHARED, certificateId: "cert-shared-123", alias: "dev-1", instance: "dev-1", command: SHARED_COMMAND },
    { team: DEFAULT, certificateId: "cert-default-123", alias: "dev-1", instance: "dev-1", command: DEFAULT_COMMAND },
  ]);
  for (const e of record.entries) assert.ok(!Number.isNaN(Date.parse(e.retiredAt)), e.retiredAt);
  assert.doesNotMatch(readFileSync(fx.recordFile, "utf8"), /BEGIN|PRIVATE|secret|token/i, "certificate ids and commands only");

  // A second retire of the same certificates replaces their entries, never duplicates them.
  const first = record.entries.map((e) => e.retiredAt);
  const again = fx.retire();
  assert.equal(again.warning, BASE_WARNING);
  assert.deepEqual(again.meta.pendingControllerCleanup, BASE_PENDING);
  const second = readRecord(fx.recordFile);
  assert.deepEqual(second.entries.map((e) => [e.team, e.certificateId]), [[SHARED, "cert-shared-123"], [DEFAULT, "cert-default-123"]]);
  assert.ok(second.entries.every((e, i) => e.retiredAt >= first[i]));
  assert.equal(mode(fx.recordFile), 0o600);
});

test("a record that cannot be written adds one warning and leaves the retire's outcome unchanged", (t) => {
  const fx = fixture(t);
  mkdirSync(join(fx.ws, ".oats-aweb"), { mode: 0o500 });
  chmodSync(join(fx.ws, ".oats-aweb"), 0o500);
  const doc = fx.retire();
  assert.equal(doc.warning, `${BASE_WARNING} | ${NOT_WRITABLE}`);
  assert.deepEqual(doc.meta.pendingControllerCleanup, BASE_PENDING);
  assert.equal(doc.meta.retired, true);
  assert.equal(existsSync(fx.recordFile), false);
});

test("retire replaces a malformed record and says so; it never throws", (t) => {
  const fx = fixture(t);
  for (const content of ["{ not json", JSON.stringify({ version: 1, entries: [{ team: DEFAULT, certificateId: "cert-other", command: "x" }] })]) {
    write(fx.recordFile, content);
    const doc = fx.retire();
    assert.equal(doc.warning, `${BASE_WARNING} | oats-aweb: could not record the controller cleanup on this host: the previous record was malformed and was replaced`);
    assert.deepEqual(doc.meta.pendingControllerCleanup, BASE_PENDING);
    assert.deepEqual(readRecord(fx.recordFile).entries.map((e) => e.certificateId), ["cert-shared-123", "cert-default-123"]);
  }
});

test("a record that cannot be replaced leaves the retire's outcome unchanged", (t) => {
  const fx = fixture(t);
  mkdirSync(join(fx.recordFile, "occupied"), { recursive: true }); // a directory where the record goes
  const doc = fx.retire();
  assert.equal(doc.warning, `${BASE_WARNING} | oats-aweb: could not record the controller cleanup on this host: the record could not be written`);
  assert.deepEqual(doc.meta.pendingControllerCleanup, BASE_PENDING);
  assert.equal(doc.meta.retired, true);
  assert.equal(existsSync(`${fx.recordFile}.lock`), false, "the lock is released");
});

test("an existing record directory loses group and other access; an unwritable one stays unwritable", (t) => {
  const ws = tempDir(t), dir = join(ws, ".oats-aweb");
  mkdirSync(dir, { mode: 0o755 }); chmodSync(dir, 0o755);
  assert.deepEqual(recordRetiredCertificates(ws, [entry("c-1")]), {});
  assert.equal(mode(dir), 0o700);
  chmodSync(dir, 0o555);
  assert.deepEqual(recordRetiredCertificates(ws, [entry("c-2")]), { cause: "the record directory is not writable" });
  assert.equal(mode(dir), 0o500);
});

test("a failure after the lock is taken returns its cause and never throws", (t) => {
  const ws = tempDir(t), dir = join(ws, ".oats-aweb");
  const r = recordRetiredCertificates(ws, [entry("c-1")], { testHooks: { locked: () => chmodSync(dir, 0o500) } });
  assert.deepEqual(r, { cause: "the record could not be written" });
  chmodSync(dir, 0o700);
  assert.equal(existsSync(join(dir, "retired-certificates.json")), false);
});

test("a lock whose holder is alive is never taken, however old", (t) => {
  const ws = tempDir(t), lock = join(ws, ".oats-aweb", "retired-certificates.json.lock");
  write(lock, JSON.stringify({ pid: process.pid, host: hostname(), token: "live" }));
  utimesSync(lock, new Date(0), new Date(0));
  assert.deepEqual(recordRetiredCertificates(ws, [entry("c-1")], { lockWaitMs: 100 }), { cause: "another retire held the record's lock" });
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).token, "live");
  assert.equal(existsSync(join(ws, ".oats-aweb", "retired-certificates.json")), false);
});

/** A child process that records one entry, its lock steps ordered by marker files in ws. */
function orderedWriter(ws, name, hooks) {
  const marks = join(ws, "marks");
  const script = `const fs = await import("node:fs");
const { recordRetiredCertificates } = await import(${JSON.stringify(pathToFileURL(LIB).href)});
const mark = (m) => fs.writeFileSync(${JSON.stringify(marks)} + "/" + m, "");
const until = (m) => { while (!fs.existsSync(${JSON.stringify(marks)} + "/" + m)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); };
const hooks = ${hooks};
const r = recordRetiredCertificates(${JSON.stringify(ws)}, [{ team: "t:example.test", certificateId: "${name}", alias: "${name}", instance: "${name}", retiredAt: new Date().toISOString(), command: "aw id team remove-member --cert-id ${name}" }], { lockWaitMs: 60000, testHooks: hooks });
if (r.cause) { console.error(r.cause); process.exit(1); }`;
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = ""; child.stderr.on("data", (d) => { stderr += d; });
    child.on("exit", (code) => code === 0 ? done() : fail(new Error(`${name}: ${stderr}`)));
  });
}

test("two writers that find the same abandoned lock both keep their entry", async (t) => {
  const ws = tempDir(t);
  mkdirSync(join(ws, "marks"));
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  write(join(ws, ".oats-aweb", "retired-certificates.json.lock"), JSON.stringify({ pid: dead, host: hostname(), token: "dead" }));
  // Both read the dead lock; a breaks it and takes the lock; only then does b break what is
  // now a's live lock, and a commits after that.
  await Promise.all([
    orderedWriter(ws, "a", `{ abandoned: () => { mark("a-abandoned"); until("b-abandoned"); }, locked: () => { mark("a-locked"); until("b-broken"); } }`),
    orderedWriter(ws, "b", `{ abandoned: () => { mark("b-abandoned"); until("a-locked"); }, broken: () => mark("b-broken") }`),
  ]);
  const ids = readRecord(join(ws, ".oats-aweb", "retired-certificates.json")).entries.map((e) => e.certificateId).sort();
  assert.deepEqual(ids, ["a", "b"]);
  assert.equal(existsSync(join(ws, ".oats-aweb", "retired-certificates.json.lock")), false);
});

test("two concurrent writers keep every entry", async (t) => {
  const ws = tempDir(t), WRITES = 150;
  const writer = (name) => new Promise((done, fail) => {
    // Each writer waits for the other to be ready, so their read-merge-rename cycles overlap.
    const script = `const fs = await import("node:fs");
const { recordRetiredCertificates } = await import(${JSON.stringify(pathToFileURL(LIB).href)});
fs.writeFileSync(${JSON.stringify(join(ws, "ready-"))} + "${name}", "");
while (!["a", "b"].every((w) => fs.existsSync(${JSON.stringify(join(ws, "ready-"))} + w))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
for (let i = 0; i < ${WRITES}; i++) { const r = recordRetiredCertificates(${JSON.stringify(ws)}, [{ team: "t:example.test", certificateId: "${name}-" + i, alias: "${name}", instance: "${name}", retiredAt: new Date().toISOString(), command: "aw id team remove-member --cert-id ${name}-" + i }], { lockWaitMs: 60000 }); if (r.cause) { console.error(r.cause); process.exit(1); } }`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = ""; child.stderr.on("data", (d) => { stderr += d; });
    child.on("exit", (code) => code === 0 ? done() : fail(new Error(`${name}: ${stderr}`)));
  });
  await Promise.all([writer("a"), writer("b")]);
  const ids = readRecord(join(ws, ".oats-aweb", "retired-certificates.json")).entries.map((e) => e.certificateId).sort();
  assert.deepEqual(ids, [...Array(WRITES).keys()].flatMap((i) => [`a-${i}`, `b-${i}`]).sort());
  assert.equal(existsSync(join(ws, ".oats-aweb", "retired-certificates.json.lock")), false);
});

test("the record keeps the newest entries and skips those without a certificate id", (t) => {
  const ws = tempDir(t);
  assert.deepEqual(recordRetiredCertificates(ws, [...Array(RETIRED_RECORD_MAX + 3).keys()].map((i) => entry(`c-${i}`))), {});
  assert.deepEqual(recordRetiredCertificates(ws, [{ ...entry("c-9999"), certificateId: null }]), {});
  const ids = readRecord(join(ws, ".oats-aweb", "retired-certificates.json")).entries.map((e) => e.certificateId);
  assert.equal(ids.length, RETIRED_RECORD_MAX);
  assert.equal(ids[0], "c-3");
  assert.equal(ids.at(-1), `c-${RETIRED_RECORD_MAX + 2}`);
});

test("roster marks a recorded certificate it still lists, matched on team and certificate id", (t) => {
  const fx = fixture(t);
  fx.retire();
  const retiredAt = readRecord(fx.recordFile).entries.find((e) => e.team === DEFAULT).retiredAt;
  // dev-1's certificate was recorded; reused-alias holds the alias of a recorded certificate
  // with another id; the recorded gone-1 is no longer listed.
  const record = readRecord(fx.recordFile);
  record.entries.push({ team: DEFAULT, certificateId: "cert-old-reused", alias: "reused-alias", instance: "reused-alias", retiredAt, command: "aw id team remove-member --cert-id cert-old-reused" });
  record.entries.push({ team: DEFAULT, certificateId: "cert-gone", alias: "gone-1", instance: "gone-1", retiredAt, command: "aw id team remove-member --cert-id cert-gone" });
  record.entries.push({ team: "other:example.test", certificateId: "cert-live", alias: "live-1", instance: "live-1", retiredAt, command: "aw id team remove-member --cert-id cert-live" });
  writeFileSync(fx.recordFile, JSON.stringify(record));
  const before = readFileSync(fx.recordFile, "utf8");
  fx.members([
    { certificate_id: "cert-default-123", team_id: DEFAULT, alias: "dev-1", identity_scope: "local" },
    { certificate_id: "cert-new-reused", team_id: DEFAULT, alias: "reused-alias", identity_scope: "local" },
    { certificate_id: "cert-live", team_id: DEFAULT, alias: "live-1", identity_scope: "local" },
  ]);

  const json = fx.hook("roster", ["--json"]);
  assert.equal(json.status, 0, json.stdout + json.stderr);
  const doc = JSON.parse(json.stdout);
  assert.deepEqual(doc.problems, []);
  const byAlias = Object.fromEntries(doc.members.map((m) => [m.alias, m]));
  assert.deepEqual(Object.keys(byAlias).sort(), ["dev-1", "live-1", "reused-alias"], "a recorded certificate no longer listed is not shown");
  assert.deepEqual(byAlias["dev-1"].retired, { at: retiredAt, instance: "dev-1", command: DEFAULT_COMMAND });
  assert.equal("retired" in byAlias["reused-alias"], false, "an alias match with another certificate id is not marked");
  assert.equal("retired" in byAlias["live-1"], false, "a certificate id recorded for another team is not marked");
  const { retired, ...rest } = byAlias["dev-1"];
  assert.deepEqual(Object.keys(rest), Object.keys(byAlias["live-1"]), "the field is additive");

  const text = fx.hook("roster");
  assert.equal(text.status, 0, text.stdout + text.stderr);
  const lines = text.stdout.split("\n");
  assert.ok(lines.includes(`  dev-1 — unknown, certificate only: no workspace record [certificate]; retired by OATS on this host ${retiredAt.slice(0, 10)}; the team controller removes it with: ${DEFAULT_COMMAND}`), text.stdout);
  assert.ok(lines.includes("  reused-alias — unknown, certificate only: no workspace record [certificate]"), text.stdout);
  assert.ok(lines.includes("1 certificate belongs to an instance OATS retired on this host; only the team's controller can remove it."), text.stdout);
  assert.doesNotMatch(text.stdout, /gone-1|cert-gone/);
  assert.equal(readFileSync(fx.recordFile, "utf8"), before, "roster never writes the record");
});

test("roster counts several leftovers in its footer", (t) => {
  const fx = fixture(t);
  write(fx.recordFile, JSON.stringify({ version: 1, entries: ["x-1", "x-2"].map((alias) => ({ team: DEFAULT, certificateId: `c-${alias}`, alias, instance: alias, retiredAt: "2026-11-04T10:00:00.000Z", command: `aw id team remove-member --cert-id c-${alias}` })) }));
  fx.members(["x-1", "x-2"].map((alias) => ({ certificate_id: `c-${alias}`, team_id: DEFAULT, alias })));
  const text = fx.hook("roster");
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.match(text.stdout, /x-1 .*; retired by OATS on this host 2026-11-04; the team controller removes it with: aw id team remove-member --cert-id c-x-1\n/);
  assert.ok(text.stdout.includes("\n2 certificates belong to instances OATS retired on this host; only the team's controller can remove them.\n"), text.stdout);
});

test("roster reports a malformed or unreadable record as a problem and shows nothing from it", (t) => {
  const fx = fixture(t);
  fx.members([{ certificate_id: "cert-default-123", team_id: DEFAULT, alias: "dev-1" }]);
  for (const [content, message] of [
    ["{ not json", "the record of certificates OATS retired on this host is malformed; nothing from it is shown"],
    [JSON.stringify({ version: 2, entries: [{ team: DEFAULT, certificateId: "cert-default-123", command: "x" }] }), "the record of certificates OATS retired on this host is malformed; nothing from it is shown"],
    // Version 1 with one bad entry is malformed as a whole: no partial record is shown.
    [JSON.stringify({ version: 1, entries: [{ team: DEFAULT, certificateId: "cert-default-123", alias: "dev-1", instance: "dev-1", retiredAt: "2026-11-04T10:00:00.000Z", command: "x" }, { team: DEFAULT }] }), "the record of certificates OATS retired on this host is malformed; nothing from it is shown"],
    [JSON.stringify({ version: 1, entries: [{ team: DEFAULT, certificateId: "cert-default-123", command: "x" }] }), "the record of certificates OATS retired on this host is malformed; nothing from it is shown"],
  ]) {
    write(fx.recordFile, content);
    const r = fx.hook("roster", ["--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const doc = JSON.parse(r.stdout);
    assert.deepEqual(doc.problems, [{ source: "retired-record", message }]);
    assert.equal(doc.members.some((m) => m.retired), false);
    const text = fx.hook("roster");
    assert.ok(text.stdout.includes(`Incomplete: retired-record: ${message}.`), text.stdout);
    assert.doesNotMatch(text.stdout, /retired by OATS|certificates? belongs? to/);
    assert.equal(readFileSync(fx.recordFile, "utf8"), content, "roster never replaces the record");
  }
  write(fx.recordFile, JSON.stringify({ version: 1, entries: [] }));
  chmodSync(fx.recordFile, 0o000);
  const doc = JSON.parse(fx.hook("roster", ["--json"]).stdout);
  assert.deepEqual(doc.problems, [{ source: "retired-record", message: "the record of certificates OATS retired on this host could not be read; nothing from it is shown" }]);
});

test("roster with no record shows nothing more", (t) => {
  const fx = fixture(t);
  fx.members([{ certificate_id: "cert-default-123", team_id: DEFAULT, alias: "dev-1" }]);
  const r = fx.hook("roster", ["--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.deepEqual(doc.problems, []);
  assert.equal("retired" in doc.members[0], false);
  assert.equal(existsSync(fx.recordFile), false, "roster creates no record");
});
