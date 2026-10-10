// oats.aweb 1.25: grants never expire by default (oats-aweb#80). `identity.ttl`
// is `never` unless set to a duration (60s to 720h), every mint passes it
// explicitly, a never seat's custody must list grant_never_ttl.v1, revocation is
// the only end of a never-grant, and readiness says it never expires.
//
// aw 1.36.32 shapes (df6bb193): `--ttl` takes "never" or 60s..720h (real binary,
// `aw id grant mint --help`); a never-grant's mint JSON and grant.yaml carry
// `expires_at: "never"` and custody always lists grant_never_ttl.v1 (source,
// cmd/aw/id_grant.go and custody.go:306). An aweb server without never-grants
// refuses the mint with HTTP 422 (404 before the grants endpoint): aw exits 1
// with the error on stderr and mints nothing (observed by the abph owner).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fakeAw } from "./helpers/fake-aw-grant.mjs";
import { DEFAULT_GRANT_TTL, resolveGrantTTL } from "../oats-package/capabilities/oats-aweb/lib/grant-duration.mjs";
import { custodyPreflight } from "../oats-package/capabilities/oats-aweb/lib/grant-custody.mjs";
import { grantExpiryAssessment } from "../oats-package/capabilities/oats-aweb/lib/grant-expiry.mjs";

const HOOK = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const BINDING = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb-binding.mjs", import.meta.url).pathname);
const TEAM = "t:example.test";
const NEVER_OP = "grant_never_ttl.v1";
const ALL_OPS = ["status.v1", "sign_plain_message.v1", "sign_app_request.v1", NEVER_OP, "create_e2ee_envelope.v1", "unwrap_e2ee_message.v1", "mail_reply_continuation.v1"];
const WITHOUT = (...ops) => ALL_OPS.filter(op => !ops.includes(op)).join(",");
const RESTART = "restart the custody on aw 1.36.33 or later (upgrade aw, restart the custody service and the wake daemon, then oats sync)";
const HTTP_422 = 'mint identity grant: aweb 422: {"detail":[{"type":"int_parsing","loc":["body","ttl_seconds"],"msg":"Input should be a valid integer, unable to parse string as an integer","input":"never"}]}';
const HTTP_404 = 'mint identity grant: aweb 404: {"detail":"Not Found"}';

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-never-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
const teamEnv = { OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]) };
function seat(t) {
  const base = tempDir(t), bin = fakeAw(base);
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "probe"); mkdirSync(home, { recursive: true });
  const custody = join(base, "custody", "merlin"); write(join(custody, ".aw", "identity.yaml"), "alias: resident-alias\n");
  const settings = (identity = {}) => ({ identity: { mode: "global", resident: "merlin", ...identity }, residents: { merlin: custody } });
  const hook = (event, env = {}) => {
    const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OATS_EVENT: event, ...teamEnv, OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, ...env } });
    let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
    return { ...r, doc };
  };
  const spawn = (identity, env = {}) => hook("spawn", { OATS_SETTINGS: JSON.stringify(settings(identity)), ...env });
  const launch = (meta, identity, env = {}) => hook("launch", { OATS_META: JSON.stringify(meta), OATS_SETTINGS: JSON.stringify(settings(identity)), ...env });
  const retire = (meta, env = {}) => hook("retire", { OATS_META: JSON.stringify(meta), OATS_SETTINGS: JSON.stringify(settings()), ...env });
  const calls = () => existsSync(join(base, "aw.log")) ? readFileSync(join(base, "aw.log"), "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l).argv) : [];
  const readiness = (identity, env = {}) => {
    const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: { root, delivery: "session", ...settings(identity) }, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: root, deployment: root, soul: "dev", home } } };
    const r = spawnSync(process.execPath, [BINDING, "check"], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...teamEnv, ...env } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout).result;
  };
  /** Record a start's meta, as the kernel does, so readiness reads it. */
  const record = (meta) => write(join(home, "instance.json"), JSON.stringify({ capabilityMeta: { "oats.aweb": { delivery: "session", runtime: "codex", ...meta } } }));
  return { base, home, custody, settings, spawn, launch, retire, calls, readiness, record };
}
const mints = (calls) => calls.filter(a => a.slice(0, 3).join(" ") === "id grant mint");
const revokes = (calls) => calls.filter(a => a.slice(0, 3).join(" ") === "id grant revoke");

// ------------------------------------------------------------------ the ttl

test("identity.ttl defaults to never, accepts exactly `never` or a 60s..720h duration, and names both forms when refused", () => {
  assert.equal(DEFAULT_GRANT_TTL, "never");
  for (const unset of [undefined, null, ""]) assert.equal(resolveGrantTTL(unset), "never");
  assert.equal(resolveGrantTTL("never"), "never");
  assert.equal(resolveGrantTTL("720h"), "720h");
  assert.equal(resolveGrantTTL("24h"), "24h");
  for (const bad of ["Never", "NEVER", " never", "never ", "nevermore", "721h", "0"]) {
    assert.throws(() => resolveGrantTTL(bad), /^Error: E_GRANT_TTL: identity\.ttl must be never or a Go duration between 60s and 720h/, bad);
  }
});

test("every mint passes its ttl explicitly: --ttl=never by default, the duration when one is set", (t) => {
  for (const [identity, flag] of [[{}, "--ttl=never"], [{ ttl: "never" }, "--ttl=never"], [{ ttl: "24h" }, "--ttl=24h"]]) {
    const s = seat(t);
    const spawned = s.spawn(identity);
    assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
    assert.deepEqual(mints(s.calls())[0].filter(a => a.startsWith("--ttl")), [flag]);
    const launched = s.launch(spawned.doc.meta, identity);
    assert.equal(launched.status, 0, launched.stdout + launched.stderr);
    assert.deepEqual(mints(s.calls())[1].filter(a => a.startsWith("--ttl")), [flag], "the renewing launch states it too");
  }
});

test("a never-grant is recorded as never, and the brief says it never expires", (t) => {
  const s = seat(t);
  const r = s.spawn({});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.meta.identity.grant.ttl, "never");
  assert.equal(r.doc.meta.identity.grant.expiresAt, "never");
  assert.match(r.doc.brief, /; never expires \(it ends only when revoked\)\./);
  assert.doesNotMatch(r.doc.brief, /expires: never/);
  const finite = seat(t).spawn({ ttl: "24h" });
  assert.match(finite.doc.brief, /; expires: 2026-09-24T07:00:00Z\./);
});

// ------------------------------------------------- mint receipt validation

test("a minted expiry must match the request: anything else fails closed, revokes and keeps nothing", (t) => {
  for (const [identity, expires] of [[{}, "2027-01-01T00:00:00Z"], [{}, ""], [{}, "soon"], [{}, "2026-02-30T00:00:00Z"], [{ ttl: "24h" }, "never"], [{ ttl: "24h" }, "soon"]]) {
    const s = seat(t);
    const r = s.spawn(identity, { FAKE_MINT_EXPIRES: expires });
    assert.notEqual(r.status, 0, `${JSON.stringify(identity)} ${expires}`);
    assert.match(r.doc.warning, /expires_at/);
    assert.deepEqual(revokes(s.calls()).map(a => a[3]), ["grant-spawn"], `revoked: ${JSON.stringify(identity)} ${expires}`);
    assert.equal(existsSync(join(s.home, ".aweb-identity")), false, "nothing kept");
  }
});

test("a renewal whose minted expiry does not match revokes the new grant and keeps the old one", (t) => {
  const s = seat(t);
  const spawned = s.spawn({});
  const launched = s.launch(spawned.doc.meta, {}, { FAKE_MINT_EXPIRES: "2027-01-01T00:00:00Z" });
  assert.equal(launched.status, 0, launched.stdout + launched.stderr);
  assert.equal(launched.doc.meta.identity.grant.id, "grant-spawn", "the previous grant is kept");
  const renewed = mints(s.calls())[1].find(a => a.startsWith("--out=")).slice("--out=".length);
  const newId = "grant-" + renewed.split(".aweb-identity-")[1];
  assert.deepEqual(revokes(s.calls()).map(a => a[3]), [newId]);
  assert.equal(existsSync(renewed), false);
  assert.match(launched.doc.warning, /keeping previous grant grant-spawn/);
});

// ------------------------------------------ an aweb server without never-grants

test("a server that refuses a never mint fails closed: aw's error shown, nothing kept, no revoke, no 720h retry", (t) => {
  for (const stderr of [HTTP_422, HTTP_404]) {
    const s = seat(t);
    const r = s.spawn({}, { FAKE_MINT_STDERR: stderr });
    assert.notEqual(r.status, 0);
    assert.ok(r.doc.warning.includes(stderr.slice(0, 120)), r.doc.warning);
    assert.doesNotMatch(r.doc.warning, /--ttl|--out|--custody-socket|revoke/);
    assert.deepEqual(mints(s.calls()).map(a => a.filter(x => x.startsWith("--ttl"))), [["--ttl=never"]], "one mint, never retried with a duration");
    assert.deepEqual(revokes(s.calls()), [], "no grant id, so no revoke");
    assert.equal(existsSync(join(s.home, ".aweb-identity")), false, "nothing kept");

    const s2 = seat(t);
    const spawned = s2.spawn({});
    const launched = s2.launch(spawned.doc.meta, {}, { FAKE_MINT_STDERR: stderr });
    assert.equal(launched.status, 0);
    assert.equal(launched.doc.meta.identity.grant.id, "grant-spawn");
    assert.ok(launched.doc.warning.includes(stderr.slice(0, 120)), launched.doc.warning);
    assert.deepEqual(mints(s2.calls()).slice(1).map(a => a.filter(x => x.startsWith("--ttl"))), [["--ttl=never"]]);
    assert.deepEqual(revokes(s2.calls()), []);
  }
});

// ------------------------------------------------ the custody op for never seats

const preflight = (ops, ttl) => custodyPreflight({ custody: "/custody", resident: "merlin", team: TEAM, ttl, fatalOnError: false,
  runAw: () => JSON.stringify({ status: "running", teams: [{ team_id: TEAM, ready: true, certificate_present: true }], keys: { signing_ready: true, encryption_ready: true }, ops, errors: [] }) });

test("a never seat requires grant_never_ttl.v1; a finite seat does not; one remedy, never a ttl", () => {
  assert.doesNotThrow(() => preflight(ALL_OPS, "never"));
  const refused = () => preflight(WITHOUT(NEVER_OP).split(","), "never");
  assert.throws(refused, { message: `custody preflight failed for merlin: status=running; required custody operations are missing: ${NEVER_OP}; ${RESTART}` });
  assert.doesNotThrow(() => preflight(WITHOUT(NEVER_OP).split(","), "24h"));
  assert.throws(() => preflight(WITHOUT(NEVER_OP, "mail_reply_continuation.v1").split(","), "never"),
    { message: `custody preflight failed for merlin: status=running; required custody operations are missing: mail_reply_continuation.v1, ${NEVER_OP}; ${RESTART}` });
  try { refused(); } catch (error) {
    assert.doesNotMatch(error.message, /identity\.ttl|\bttl\b|\b\d+(?:h|m|s)\b|duration/i, "never suggests a finite ttl");
  }
});

test("spawn refuses a never seat on a custody without the op before any mint; a finite seat mints", (t) => {
  const s = seat(t);
  const r = s.spawn({}, { FAKE_CUSTODY_OPS: WITHOUT(NEVER_OP) });
  assert.notEqual(r.status, 0);
  assert.equal(r.doc.warning, `oats-aweb: custody preflight failed for merlin: status=running; required custody operations are missing: ${NEVER_OP}; ${RESTART}`);
  assert.deepEqual(mints(s.calls()), []);
  const finite = seat(t);
  assert.equal(finite.spawn({ ttl: "24h" }, { FAKE_CUSTODY_OPS: WITHOUT(NEVER_OP) }).status, 0);
});

test("readiness: a never seat without the op is the custody problem; with it, or a finite seat without it, is not", (t) => {
  const s = seat(t);
  const custody = (result) => result.problems.filter(p => p.code === "custody").map(p => p.message);
  assert.deepEqual(custody(s.readiness({}, { FAKE_CUSTODY_OPS: WITHOUT(NEVER_OP) })), [`custody preflight failed for merlin: status=running; required custody operations are missing: ${NEVER_OP}; ${RESTART}`]);
  assert.deepEqual(custody(s.readiness({ ttl: "never" }, { FAKE_CUSTODY_OPS: WITHOUT(NEVER_OP) })).length, 1);
  assert.deepEqual(custody(s.readiness({})), []);
  assert.deepEqual(custody(s.readiness({ ttl: "24h" }, { FAKE_CUSTODY_OPS: WITHOUT(NEVER_OP) })), []);
  assert.match(s.readiness({ ttl: "1d" }).problems.map(p => p.message).join(" "), /E_GRANT_TTL/, "an invalid ttl is reported, not guessed");
});

// --------------------------------------------- revocation is the only end

const STAYS = (id, custody) => `grant ${id} stays valid until revoked: run \`aw id grant revoke ${id}\` in ${custody}`;

test("retire: a never-grant that was not revoked stays valid, says how to revoke it, and a retry can", (t) => {
  const s = seat(t);
  const spawned = s.spawn({});
  const failed = s.retire(spawned.doc.meta, { FAKE_REVOKE_FAIL: "1" });
  assert.equal(failed.status, 1);
  assert.match(failed.doc.warning, new RegExp(STAYS("grant-spawn", s.custody).replace(/[.*+?^${}()|[\]\\`]/g, "\\$&")));
  assert.doesNotMatch(failed.doc.warning, /expires/);
  assert.equal(failed.doc.meta.retired, false);
  const retried = s.retire(failed.doc.meta);
  assert.equal(retried.status, 0, retried.stdout + retried.stderr);
  assert.deepEqual(retried.doc.meta, { retired: true, identityRevoked: true, grant: "grant-spawn" });
  // A finite grant that survives a retire is a live credential until it lapses:
  // the retire fails too, and a retry from its meta can revoke it.
  const finite = seat(t);
  const finiteSpawn = finite.spawn({ ttl: "24h" });
  const finiteFailed = finite.retire(finiteSpawn.doc.meta, { FAKE_REVOKE_FAIL: "1" });
  assert.equal(finiteFailed.status, 1);
  assert.equal(finiteFailed.doc.meta.reason, "grant-revoke-failed");
  assert.ok(finiteFailed.doc.warning.endsWith(`grant grant-spawn stays valid until 2026-09-24T07:00:00Z unless revoked: run \`aw id grant revoke grant-spawn\` in ${finite.custody}`), finiteFailed.doc.warning);
  assert.deepEqual(finite.retire(finiteFailed.doc.meta).doc.meta, { retired: true, identityRevoked: true, grant: "grant-spawn" });
});

// The custody's grant list (the fake's registry, like the server's) is the
// source of truth for what a seat still holds.
const registry = (s) => join(s.base, "grants.json");
const grantsOf = (s) => existsSync(registry(s)) ? JSON.parse(readFileSync(registry(s), "utf8")) : [];
const active = (s) => grantsOf(s).filter(g => g.status === "active").map(g => g.grant_id).sort();
const addGrant = (s, grant) => writeFileSync(registry(s), JSON.stringify([{ team_id: TEAM, status: "active", expires_at: "never", ...grant }, ...grantsOf(s)]));
const newGrantOf = (s, n = 1) => "grant-" + mints(s.calls())[n].find(a => a.startsWith("--out=")).split(".aweb-identity-")[1];

test("every mint carries a label unique to its seat, kept across renewals", (t) => {
  const s = seat(t);
  const spawned = s.spawn({});
  const id = spawned.doc.meta.identity.seat;
  assert.match(id, /^[0-9a-f]{16}$/);
  const launched = s.launch(spawned.doc.meta, {});
  assert.equal(launched.doc.meta.identity.seat, id);
  assert.deepEqual(mints(s.calls()).map(a => a.find(x => x.startsWith("--label="))), [`--label=oats:probe:${id}`, `--label=oats:probe:${id}`]);
  assert.notEqual(seat(t).spawn({}).doc.meta.identity.seat, id, "a new seat of the same name gets its own id");
});

test("a grant minted before a crash, found only in the custody's list, is revoked at the next start", (t) => {
  const s = seat(t);
  const spawned = s.spawn({});
  addGrant(s, { grant_id: "grant-crashed", label: `oats:probe:${spawned.doc.meta.identity.seat}` });
  s.record(spawned.doc.meta);
  assert.ok(s.readiness({}).warnings.some(w => w.code === "grant-revoke-pending" && w.message.startsWith(STAYS("grant-crashed", s.custody))));
  const launched = s.launch(spawned.doc.meta, {}, { FAKE_REVOKE_FAIL: "never-matches" });
  assert.equal(launched.status, 0, launched.stdout + launched.stderr);
  assert.match(launched.doc.warning, /revoked orphaned grant grant-crashed/);
  assert.equal(active(s).includes("grant-crashed"), false);
});

test("a seat sweeps only its own label: another seat of the same name, a pre-1.25.0 label and look-alikes are untouched", (t) => {
  const s = seat(t);
  const spawned = s.spawn({});
  const mine = spawned.doc.meta.identity.seat;
  const other = "0123456789abcdef";
  for (const [grant_id, label] of [["grant-other-seat", `oats:probe:${other}`], ["grant-legacy", "oats:probe"], ["grant-prefix", `oats:probe:${mine}x`], ["grant-other-name", `oats:probe2:${mine}`], ["grant-mine-old", `oats:probe:${mine}`]]) addGrant(s, { grant_id, label });
  s.launch(spawned.doc.meta, {});
  assert.deepEqual(active(s).filter(g => !g.startsWith("grant-1")), ["grant-legacy", "grant-other-name", "grant-other-seat", "grant-prefix"]);
  // The other seat, run in the same custody, leaves this seat's grants alone too.
  const otherMeta = { ...spawned.doc.meta, identity: { ...spawned.doc.meta.identity, seat: other, grant: { ...spawned.doc.meta.identity.grant, id: "grant-other-current" } } };
  const before = active(s).filter(g => g.startsWith("grant-1"));
  s.launch(otherMeta, {}, { FAKE_MINT_FAIL: "1" });
  assert.equal(active(s).includes("grant-other-seat"), false, "the other seat revokes its own stray grant");
  assert.deepEqual(active(s).filter(g => g.startsWith("grant-1")), before, "and none of this seat's");
});

test("renewal: a fresh grant that cannot be revoked does not fail the start; the seat runs on its previous grant", (t) => {
  for (const env of [{ FAKE_VERIFY_ERROR: "custody socket refused" }, { FAKE_GRANT_TEAM: "other:example.test" }]) {
    const s = seat(t);
    const spawned = s.spawn({});
    const launched = s.launch(spawned.doc.meta, {}, { ...env, FAKE_REVOKE_FAIL: "1" });
    assert.equal(launched.status, 0, JSON.stringify(env) + launched.stdout + launched.stderr);
    assert.equal(launched.doc.meta.identity.grant.id, "grant-spawn", "the previous grant is kept");
    const fresh = newGrantOf(s);
    assert.ok(launched.doc.warning.includes(STAYS(fresh, s.custody)), launched.doc.warning);
    if (!env.FAKE_GRANT_TEAM) {
      const next = s.launch(spawned.doc.meta, {});
      assert.equal(next.status, 0, next.stdout + next.stderr);
      assert.match(next.doc.warning, new RegExp(`revoked orphaned grant ${fresh}`));
      assert.equal(active(s).includes(fresh), false);
    }
  }
});

test("renewal: a previous grant that cannot be revoked does not fail the start; readiness shows it and the next start revokes it", (t) => {
  for (const identity of [{}, { ttl: "24h" }]) {
    const s = seat(t);
    const spawned = s.spawn(identity);
    const launched = s.launch(spawned.doc.meta, identity, { FAKE_REVOKE_FAIL: "grant-spawn" });
    assert.equal(launched.status, 0, launched.stdout + launched.stderr);
    assert.notEqual(launched.doc.meta.identity.grant.id, "grant-spawn", "the seat runs on its new grant");
    const until = identity.ttl ? "until 2026-09-24T07:00:00Z unless revoked" : "until revoked";
    assert.ok(launched.doc.warning.includes(`grant grant-spawn stays valid ${until}: run \`aw id grant revoke grant-spawn\` in ${s.custody}`), launched.doc.warning);
    s.record(launched.doc.meta);
    assert.ok(s.readiness(identity).warnings.some(w => w.code === "grant-revoke-pending" && w.message.startsWith(`grant grant-spawn stays valid ${until}`)));
    const next = s.launch(launched.doc.meta, identity);
    assert.match(next.doc.warning, /revoked orphaned grant grant-spawn/);
    s.record(next.doc.meta);
    assert.equal(s.readiness(identity).warnings.some(w => w.code === "grant-revoke-pending"), false);
  }
});

test("a grant list that cannot be read: a start proceeds saying so, readiness says so, and retire does not succeed", (t) => {
  const s = seat(t);
  const spawned = s.spawn({});
  const launched = s.launch(spawned.doc.meta, {}, { FAKE_GRANT_LIST_FAIL: "custody unreachable" });
  assert.equal(launched.status, 0, launched.stdout + launched.stderr);
  assert.match(launched.doc.warning, /could not check for orphaned grants \(aw id grant failed \(exit 1\): custody unreachable\)/);
  assert.doesNotMatch(launched.doc.warning, /no orphaned/);
  s.record(launched.doc.meta);
  assert.ok(s.readiness({}, { FAKE_GRANT_LIST_FAIL: "custody unreachable" }).warnings.some(w => w.code === "grant-revoke-unchecked" && /could not check for orphaned grants/.test(w.message)));
  const retired = s.retire(launched.doc.meta, { FAKE_GRANT_LIST_FAIL: "custody unreachable" });
  assert.equal(retired.status, 1);
  assert.equal(retired.doc.meta.reason, "grant-list-failed");
  assert.match(retired.doc.warning, /could not check for orphaned grants/);
  assert.equal(s.retire(launched.doc.meta).status, 0, "a retry that can read the list succeeds");
});

test("a grant list that hangs at a start gives the could-not-check note within the 10 s start bound", (t) => {
  const s = seat(t);
  const spawned = s.spawn({});
  const started = Date.now();
  const launched = s.launch(spawned.doc.meta, {}, { FAKE_GRANT_LIST_SLEEP_MS: "40000" });
  const took = Date.now() - started;
  assert.equal(launched.status, 0, launched.stdout + launched.stderr);
  assert.match(launched.doc.warning, /could not check for orphaned grants \(aw id grant timed out after 10 s\)/);
  assert.doesNotMatch(launched.doc.warning, /exit null/);
  assert.ok(took < 20000, `the start waited ${took} ms for the list (bound 10 s plus the renewal)`);
});

test("readiness whose grant list is cut off at its 5 s cap says it timed out, never (exit null)", (t) => {
  const s = seat(t);
  const spawned = s.spawn({});
  s.record(spawned.doc.meta);
  const unchecked = s.readiness({}, { FAKE_GRANT_LIST_SLEEP_MS: "20000" }).warnings.find(w => w.code === "grant-revoke-unchecked");
  assert.ok(unchecked, "the list was cut off");
  assert.match(unchecked.message, /could not check for orphaned grants \(aw id grant timed out after [1-5] s\)/);
  assert.doesNotMatch(unchecked.message, /exit null/);
});

test("retire revokes every active grant of the seat, and a failure lists each grant with its revoke command (what --force prints)", (t) => {
  const s = seat(t);
  const spawned = s.spawn({});
  addGrant(s, { grant_id: "grant-crashed", label: `oats:probe:${spawned.doc.meta.identity.seat}` });
  const failed = s.retire(spawned.doc.meta, { FAKE_REVOKE_FAIL: "grant-spawn,grant-crashed" });
  assert.equal(failed.status, 1);
  assert.equal(failed.doc.meta.reason, "grant-revoke-failed");
  for (const id of ["grant-spawn", "grant-crashed"]) assert.ok(failed.doc.warning.includes(STAYS(id, s.custody)), failed.doc.warning);
  const retried = s.retire(failed.doc.meta);
  assert.equal(retried.status, 0, retried.stdout + retried.stderr);
  assert.deepEqual(active(s), []);
});

test("spawn: a mint that fails after the server created the grant returns the seat, and the rollback retire revokes the grant", (t) => {
  for (const env of [{ FAKE_MINT_FAIL_AFTER_REGISTER: "write grant home: disk full" }, { FAKE_MINT_GARBAGE: "1" }]) {
    const s = seat(t);
    const r = s.spawn({}, env);
    assert.notEqual(r.status, 0, JSON.stringify(env));
    assert.match(r.doc.meta?.identity?.seat || "", /^[0-9a-f]{16}$/, "the seat reaches the kernel's rollback retire");
    assert.deepEqual(active(s), ["grant-spawn"], "the grant is live on the server");
    const rollback = s.retire(r.doc.meta);
    assert.equal(rollback.status, 0, rollback.stdout + rollback.stderr);
    assert.deepEqual(active(s), [], "the rollback retire found it by its label and revoked it");
  }
});

// A hook killed between the mint and its answer leaves the kernel no meta at all
// (Ctrl-C, the kernel ending the hook, a crash): the seat must already be on disk.
const seatRecord = (s) => JSON.parse(readFileSync(join(s.home, ".oats-aweb", "seat.json"), "utf8"));

test("the seat is written to the home before the first mint, and a retire with no meta finds and revokes the grant", (t) => {
  const s = seat(t);
  const r = s.spawn({}, { FAKE_MINT_FAIL_AFTER_REGISTER: "killed" });
  assert.notEqual(r.status, 0);
  const record = seatRecord(s);
  assert.match(record.seat, /^[0-9a-f]{16}$/);
  assert.deepEqual({ instance: record.instance, resident: record.resident, team: record.team }, { instance: "probe", resident: "merlin", team: TEAM });
  assert.equal(grantsOf(s).find(g => g.grant_id === "grant-spawn").label, `oats:probe:${record.seat}`, "the record names the label the mint used");
  assert.deepEqual(active(s), ["grant-spawn"]);
  // The kernel's retire after a killed hook: no meta.
  const retired = s.retire({});
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.deepEqual(active(s), [], "found by the seat record's label and revoked");
});

test("a retire that finds the seat record but cannot read the grant list exits nonzero", (t) => {
  const s = seat(t);
  s.spawn({}, { FAKE_MINT_FAIL_AFTER_REGISTER: "killed" });
  const retired = s.retire({}, { FAKE_GRANT_LIST_FAIL: "custody unreachable" });
  assert.equal(retired.status, 1);
  assert.equal(retired.doc.meta.reason, "grant-list-failed");
  assert.match(retired.doc.warning, /could not check for orphaned grants/);
});

test("an unreadable seat record blocks a retire only when the meta carries no seat", (t) => {
  const s = seat(t);
  const spawned = s.spawn({});
  writeFileSync(join(s.home, ".oats-aweb", "seat.json"), "{truncated");
  const blind = s.retire({});
  assert.equal(blind.status, 1);
  assert.equal(blind.doc.meta.reason, "seat-record-unreadable");
  assert.match(blind.doc.warning, /could not check for orphaned grants: the seat record is unreadable/);
  assert.deepEqual(active(s), ["grant-spawn"], "nothing to go on: the grant is named nowhere, so the retire fails");
  const retired = s.retire(spawned.doc.meta);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.match(retired.doc.warning, /the seat record is unreadable .*retired from the seat in the meta/);
  assert.deepEqual(active(s), [], "the meta's seat and grant are enough to revoke");
});

test("a renewal that gives a pre-seat meta its first seat id writes it before the mint", (t) => {
  const s = seat(t);
  const spawned = s.spawn({});
  const { seat: _, ...identity } = spawned.doc.meta.identity;
  const preSeat = { ...spawned.doc.meta, identity };
  rmSync(join(s.home, ".oats-aweb", "seat.json"), { force: true });
  const launched = s.launch(preSeat, {}, { FAKE_MINT_FAIL_AFTER_REGISTER: "killed" });
  assert.equal(launched.status, 0, launched.stdout + launched.stderr);
  const record = seatRecord(s);
  const fresh = grantsOf(s).find(g => g.grant_id !== "grant-spawn" && g.status === "active");
  assert.equal(fresh.label, `oats:probe:${record.seat}`, "the renewal's grant carries the persisted seat");
  assert.equal(s.retire(preSeat).status, 0);
  assert.equal(active(s).includes(fresh.grant_id), false, "a retire from the pre-seat meta revokes it through the record");
});

test("spawn: a never-grant whose attachment or wake registration fails and cannot be revoked fails, named, with its seat in the meta", (t) => {
  for (const [env, settings] of [[{ FAKE_VERIFY_ERROR: "custody socket refused" }, {}], [{ FAKE_WAKE_REGISTER_FAIL: "1" }, { delivery: "session" }]]) {
    const s = seat(t);
    const r = s.spawn({}, { ...env, FAKE_REVOKE_FAIL: "1", OATS_SETTINGS: JSON.stringify({ ...s.settings({}), ...settings }) });
    assert.notEqual(r.status, 0, JSON.stringify(env));
    assert.equal(r.doc.meta.identity.grant.id, "grant-spawn", "the kernel's retire compensation can still revoke it");
    assert.match(r.doc.meta.identity.seat, /^[0-9a-f]{16}$/, "and find it by its label");
    assert.ok(r.doc.warning.includes(STAYS("grant-spawn", s.custody)), r.doc.warning);
  }
});

test("spawn: a never-grant whose team mismatches and cannot be revoked says it stays valid, and keeps it for retire", (t) => {
  const s = seat(t);
  const r = s.spawn({}, { FAKE_GRANT_TEAM: "other:example.test", FAKE_REVOKE_FAIL: "1" });
  assert.notEqual(r.status, 0);
  assert.ok(r.doc.warning.includes(STAYS("grant-spawn", s.custody)), r.doc.warning);
  assert.equal(r.doc.meta.identity.grant.id, "grant-spawn", "retire compensation can still revoke it");
});

// ------------------------------------------------------------ readiness

test("readiness gives a never-grant no lifetime diagnostic and never parses its expiry as a date", () => {
  const identity = (grant) => ({ mode: "global", resident: "merlin", grant: { id: "grant-1", scopes: ["mail.read"], ...grant } });
  // At any instant, far past or far future, a never-grant is neither expiring, expired nor unknown.
  for (const now of [Date.parse("2026-10-10T02:00:00Z"), Date.parse("2126-10-10T02:00:00Z"), 0]) {
    for (const grant of [{ expiresAt: "never", ttl: "never", renew: "launch" }, { expiresAt: "never" }, { expiresAt: "never", ttl: "720h", renew: "off" }]) {
      assert.deepEqual(grantExpiryAssessment(identity(grant), { home: "/h", now, configuredTtl: "24h" }), { problems: [], warnings: [] });
    }
  }
});

test("the expiry remedy: a captured duration renews on restart and says how to stop it expiring; never, unset or a recorded fallback 720h restarts", () => {
  const now = Date.parse("2026-10-10T02:00:00Z"), at = "2026-10-10T01:00:00Z";
  const remedy = (grant, configuredTtl) => grantExpiryAssessment({ mode: "global", grant: { id: "g", expiresAt: at, renew: "launch", ...grant } }, { home: "/h", now, configuredTtl }).problems[0].message.slice(`grant g expired at ${at}: `.length);
  const restart = "restart the seat to renew it (`oats session restart --home /h`)";
  assert.equal(remedy({ ttl: "never" }, undefined), restart);
  assert.equal(remedy({}, "never"), restart);
  assert.equal(remedy({ ttl: "720h" }, undefined), restart, "a pre-1.25.0 seat renewed at the fallback");
  // grant-expiring carries the same remedy as grant-expired.
  assert.equal(grantExpiryAssessment({ mode: "global", grant: { id: "g", expiresAt: "2026-10-12T00:00:00Z", renew: "launch" } }, { home: "/h", now, configuredTtl: "720h" }).warnings[0].message,
    "grant g expires at 2026-10-12T00:00:00Z, within 7 days: a restart renews it for another 720h (`oats session restart --home /h`); to stop it expiring, remove identity.ttl and respawn");
  for (const ttl of ["720h", "24h"]) assert.equal(remedy({ ttl }, ttl), `a restart renews it for another ${ttl} (\`oats session restart --home /h\`); to stop it expiring, remove identity.ttl and respawn`);
});

// ------------------------------------------------- the real aw, read-only

test("real aw at the floor parses the --ttl forms OATS passes", (t) => {
  const realAw = process.env.AW_REAL_CLI_BIN;
  if (!realAw) { t.skip("set AW_REAL_CLI_BIN to a real aw 1.36.32+ (native or the npm JS shim) to check the mint flags"); return; }
  const dir = tempDir(t), home = join(dir, "home"); mkdirSync(home);
  // An empty, uninitialized directory: aw parses the flags, then stops before
  // any network call because there is no identity here.
  const aw = (args) => spawnSync(realAw, args, { cwd: dir, encoding: "utf8", timeout: 20000, env: { PATH: `${dirname(realAw)}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, AW_NO_UPDATE_CHECK: "1" } });
  const help = aw(["id", "grant", "mint", "--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--ttl string\s+Grant duration: never \(revocation-only\) or a duration from 60s to 720h/);
  const mint = (ttl) => aw(["id", "grant", "mint", "--team=t:example.invalid", "--scope=mail.read", `--ttl=${ttl}`, `--out=${join(dir, "out-" + ttl)}`, "--json"]);
  for (const ttl of ["never", "720h", "24h"]) {
    const r = mint(ttl);
    assert.doesNotMatch(r.stderr, /invalid argument/, `${ttl} parses: ${r.stderr}`);
    assert.match(r.stderr, /not initialized for aw/, ttl);
  }
  // The seat sweep's list call parses too (aw then stops: no identity here).
  const list = aw(["id", "grant", "list", "--team=t:example.invalid", "--json"]);
  assert.doesNotMatch(list.stderr, /unknown flag|invalid argument/, list.stderr);
  assert.match(list.stderr, /not initialized for aw/);
  for (const [ttl, why] of [["721h", /grant duration must be 60s to 720h or never/], ["Never", /invalid duration/]]) {
    assert.match(mint(ttl).stderr, new RegExp(`invalid argument "${ttl}" for "--ttl" flag: .*${why.source}`), ttl);
  }
});
