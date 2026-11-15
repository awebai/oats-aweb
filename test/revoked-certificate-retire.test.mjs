// aweb-adbl: when hosted Cloud has already revoked an identity's own certificate, its
// `aw workspace delete --json` exits 1 with one JSON envelope on stdout whose error.code is
// "certificate_revoked" (aw 46b150f7fe). Retire then finishes and hands the member to the
// team's owner, instead of staying RETIRING forever. Only that code says so: an http_error
// 401, or "certificate_revoked" anywhere but error.code, keeps today's failure.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HOOK = join(REPO, "oats-package", "capabilities", "oats-aweb", "bin", "oats-aweb.mjs");

// aw's envelopes, as the aw commit names them (cli/go/cmd/aw/workspace_self_retire.go).
const SERVER = "certificate revoked";
const REVOKED = { error: { code: "certificate_revoked", message: `workspace not retired: self retirement failed: ${SERVER}`, http_status: 401, detail: SERVER, reason: "certificate_revoked" } };
const HTTP_401 = { error: { code: "http_error", message: "workspace not retired: self retirement failed: 401 Unauthorized", http_status: 401, detail: "Unauthorized" } };
// The words in every field but error.code: never recognized.
const REASON_ONLY = { error: { code: "http_error", message: "workspace not retired: self retirement failed: certificate_revoked", http_status: 401, detail: "certificate_revoked", reason: "certificate_revoked" } };
const ENVELOPES = { revoked: REVOKED, http401: HTTP_401, reasonOnly: REASON_ONLY };

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-adbl-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

/** An aw whose `workspace delete` answers FAKE_DELETE_DEFAULT (the home's own identity) or
 *  FAKE_DELETE_JOINED (an --identity-home call): an envelope name, exit 1, a sentence on
 *  stderr; unset is a released delete. */
function fakeAw(t) {
  const base = tempDir(t), bin = join(base, "bin"), calls = join(base, "calls.jsonl");
  write(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
let args = process.argv.slice(2), identityHome = null;
if (args[0] === "--identity-home") { identityHome = args[1]; args = args.slice(2); }
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, cwd: process.cwd(), identityHome }) + "\\n");
const emit = (o) => console.log(JSON.stringify(o));
const envelopes = ${JSON.stringify(ENVELOPES)};
if (args[0] === "workspace" && args[1] === "delete") {
  const answer = identityHome ? process.env.FAKE_DELETE_JOINED : process.env.FAKE_DELETE_DEFAULT;
  if (answer) { emit(envelopes[answer]); console.error("Error: " + envelopes[answer].error.message); process.exit(1); }
  fs.rmSync(identityHome || path.join(process.cwd(), ".aw"), { recursive: true, force: true });
  emit({ alias_released: true, alias_released_reason: "released" });
  process.exit(0);
}
if (args[0] === "id" && args[1] === "team" && args[2] === "list") { emit({ memberships: [{ team_id: String(identityHome || "").includes(".aweb-identity-shared") ? "shared:example.test" : "default:example.test" }] }); process.exit(0); }
if (args[0] === "wake") { console.log("ok"); process.exit(0); }
console.error("unexpected aw " + args.join(" ")); process.exit(93);
`);
  spawnSync("chmod", ["755", join(bin, "aw")]);
  return { path: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, calls: () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [] };
}

/** A local home whose default identity (alias dev-1 in default:example.test) holds its
 *  certificate file, as a spawned home does. */
function fixture(t) {
  const ws = tempDir(t), home = join(ws, "agents", "dev", "instances", "dev-1");
  write(join(home, ".aw", "identity.yaml"), "alias: dev-1\nteam_id: default:example.test\n");
  write(join(home, ".aw", "team-certs", "default__example.test.pem"), JSON.stringify({ version: 1, certificate_id: "cert-default-123", team_id: "default:example.test", alias: "dev-1" }));
  const env = {
    OATS_HOME: home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: ws,
    OATS_DEFAULT_TEAM: "personal", OATS_DEFAULT_TEAM_ID: "default:example.test", OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "personal", team: "default:example.test", default: true, from: "local" }, { label: "shared", team: "shared:example.test", default: false, from: "shared" }]),
    OATS_TEAMS_SOURCE: "live", OATS_RUNTIME: "claude", OATS_SETTINGS: JSON.stringify({ root: ws }),
  };
  const meta = { alias: "dev-1", team: "default:example.test", identity: { mode: "local", alias: "dev-1", team: "default:example.test" } };
  return { ws, home, env, meta };
}
function retire(fx, fake, extra = {}, meta = fx.meta) {
  const r = spawnSync(process.execPath, [HOOK, "retire"], { cwd: fx.home, env: { ...fx.env, PATH: fake.path, OATS_EVENT: "retire", OATS_META: JSON.stringify(meta), ...extra }, encoding: "utf8", timeout: 20000 });
  return { status: r.status, stderr: r.stderr, doc: JSON.parse(r.stdout.trim().split("\n").pop()) };
}
const marker = (fx) => join(fx.home, ".oats-aweb", "default-retire.json");
const OWNER_COMMAND = "aw team admin remove-agent example.test/dev-1 --team-id default:example.test";

test("a default identity whose certificate the server revoked finishes retiring and hands the member to the team owner", (t) => {
  const fake = fakeAw(t), fx = fixture(t);
  const r = retire(fx, fake, { FAKE_DELETE_DEFAULT: "revoked" });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.equal(r.doc.meta.retired, true);
  assert.equal(r.doc.meta.aliasReusable, false);
  assert.equal(r.doc.meta.aliasReason, "certificate_revoked");
  assert.deepEqual(r.doc.meta.pendingControllerCleanup, [{ label: "default", team: "default:example.test", alias: "dev-1", certificateId: "cert-default-123", cleanup: "owner", command: OWNER_COMMAND }]);
  assert.match(r.doc.warning, /default identity cleanup failed: certificate_revoked; its certificate was revoked by the server, so it cannot retire itself; the team owner removes the member with: aw team admin remove-agent example\.test\/dev-1 --team-id default:example\.test/);
  const written = JSON.parse(readFileSync(marker(fx), "utf8"));
  assert.equal(written.retired, true);
  assert.equal(written.aliasReusable, false);
  assert.equal(written.aliasReason, "certificate_revoked");
});

for (const [name, label] of [["http401", "an http_error 401"], ["reasonOnly", "an http_error whose reason, detail and message say certificate_revoked"]]) {
  test(`${label} from the default self-delete still keeps the instance retiring`, (t) => {
    const fake = fakeAw(t), fx = fixture(t);
    const r = retire(fx, fake, { FAKE_DELETE_DEFAULT: name });
    assert.equal(r.status, 1, JSON.stringify(r.doc) + r.stderr);
    assert.deepEqual(r.doc.meta, { retired: false, reason: "self-delete-failed" });
    assert.match(r.doc.warning, /self-delete failed \(the remote record will linger until stale\)/);
    assert.equal(existsSync(marker(fx)), false, "no completed-retire marker");
  });
}

/** The home's joined team `shared`, its identity holding its own certificate file. */
function withJoined(fx) {
  const identityHome = join(fx.home, ".aweb-identity-shared");
  write(join(identityHome, "identity.yaml"), "alias: dev-1\nteam_id: shared:example.test\n");
  write(join(identityHome, "team-certs", "shared__example.test.pem"), JSON.stringify({ version: 1, certificate_id: "cert-shared-123", team_id: "shared:example.test", alias: "dev-1" }));
  return { ...fx.meta, joinedTeams: [{ label: "shared", team: "shared:example.test", identityHome, alias: "dev-1", receive: "poll", since: "2026-11-01T00:00:00.000Z" }] };
}
const defaultDeletes = (fake) => fake.calls().filter((c) => !c.identityHome && c.args[0] === "workspace" && c.args[1] === "delete").length;

test("a home left retiring by a failed self-delete finishes once aw says its certificate is revoked", (t) => {
  const fake = fakeAw(t), fx = fixture(t);
  assert.equal(retire(fx, fake, { FAKE_DELETE_DEFAULT: "http401" }).status, 1, "premise: the first retire leaves it retiring");
  const r = retire(fx, fake, { FAKE_DELETE_DEFAULT: "revoked" });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.equal(r.doc.meta.retired, true);
  assert.equal(r.doc.meta.aliasReason, "certificate_revoked");
});

test("a retire run again after the default identity was handed to the owner does not self-delete again, and hands it over again", (t) => {
  const fake = fakeAw(t), fx = fixture(t), meta = withJoined(fx);
  // The joined leave fails for a reason that keeps its key: the retire exits 1 and is run again.
  const first = retire(fx, fake, { FAKE_DELETE_DEFAULT: "revoked", FAKE_DELETE_JOINED: "http401" }, meta);
  assert.equal(first.status, 1, JSON.stringify(first.doc));
  assert.deepEqual(first.doc.meta.failedLeaves, ["shared"]);
  assert.equal(defaultDeletes(fake), 1);
  const again = retire(fx, fake, {}, meta);
  assert.equal(again.status, 0, JSON.stringify(again.doc) + again.stderr);
  assert.equal(defaultDeletes(fake), 1, "the default identity is not deleted twice");
  assert.equal(again.doc.meta.retired, true);
  assert.equal(again.doc.meta.aliasReusable, false);
  assert.equal(again.doc.meta.aliasReason, "certificate_revoked");
  assert.deepEqual(again.doc.meta.pendingControllerCleanup, [{ label: "default", team: "default:example.test", alias: "dev-1", certificateId: "cert-default-123", cleanup: "owner", command: OWNER_COMMAND }]);
  assert.match(again.doc.warning, /default identity cleanup failed: certificate_revoked; its certificate was revoked by the server, so it cannot retire itself; the team owner removes the member with: aw team admin remove-agent example\.test\/dev-1 --team-id default:example\.test/);
  assert.doesNotMatch(again.doc.warning, /already deleted/);
});

test("a joined team whose certificate the server revoked is handed to its owner, and retire finishes", (t) => {
  const fake = fakeAw(t), fx = fixture(t), meta = withJoined(fx);
  const r = retire(fx, fake, { FAKE_DELETE_JOINED: "revoked" }, meta);
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.equal(r.doc.meta.retired, true);
  assert.equal(r.doc.meta.failedLeaves, undefined);
  assert.deepEqual(r.doc.meta.pendingControllerCleanup, [{ label: "shared", team: "shared:example.test", alias: "dev-1", certificateId: "cert-shared-123", cleanup: "owner", command: "aw team admin remove-agent example.test/dev-1 --team-id shared:example.test" }]);
  assert.match(r.doc.warning, /joined team shared cleanup failed: certificate_revoked; its certificate was revoked by the server, so it cannot retire itself; the team owner removes the member with: aw team admin remove-agent example\.test\/dev-1 --team-id shared:example\.test/);
});

for (const [name, label] of [["http401", "an http_error 401"], ["reasonOnly", "an http_error whose reason, detail and message say certificate_revoked"]]) {
  test(`${label} from a joined leave keeps its key and the retire nonzero`, (t) => {
    const fake = fakeAw(t), fx = fixture(t), meta = withJoined(fx);
    const r = retire(fx, fake, { FAKE_DELETE_JOINED: name }, meta);
    assert.equal(r.status, 1, JSON.stringify(r.doc) + r.stderr);
    assert.equal(r.doc.meta.retired, false);
    assert.equal(r.doc.meta.reason, "joined-team-leave-failed");
    assert.deepEqual(r.doc.meta.failedLeaves, ["shared"]);
    assert.equal(r.doc.meta.pendingControllerCleanup, undefined);
    assert.equal(existsSync(join(fx.home, ".aweb-identity-shared", "identity.yaml")), true, "the member key stays for the retry");
  });
}
