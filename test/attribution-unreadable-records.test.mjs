// An admission record that exists but can't be read, or isn't one of the state table's, is
// never read as no record (round 22; the lead, mail 0bee4050-df17-4cb4-8d5b-67dcbab87d6c): a
// missing file is none, and any other refuses E_ATTRIBUTION_EVIDENCE (problem
// records-unreadable) before any effect, naming the record and the fix. Retire keeps the home
// (records-unreadable), leave and the admission refuse, and a start, never blocked, skips its
// cleanup of that label with a warning.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { OPS, TEAM, attributionFixture, commandArgs } from "./helpers/attribution-fixture.mjs";
import { providerRecords, readAdmission } from "../oats-package/capabilities/oats-aweb/lib/admission.mjs";
import { POLICY } from "./helpers/fake-aw-protected.mjs";

const recordFile = (fx, label, name = "dev-1") => join(fx.homeOf(name), ".oats-aweb", `admission-${label}.json`);
const calls = (fx, before = 0) => fx.fake.calls().slice(before).map((c) => commandArgs(c.args).join(" "));
const FIX = "make it readable by this user, owner-only, or restore it, then";
/** Makes `label`'s record unreadable until the test ends. */
function unreadable(t, fx, label) {
  const file = recordFile(fx, label);
  chmodSync(file, 0o000);
  t.after(() => { try { chmodSync(file, 0o600); } catch {} });
  return file;
}
const HOSTED = { default: "backend:review.aweb.ai", ops: "ops:review.aweb.ai" };
const hosted = (t, extra = {}) => attributionFixture(t, { teamIds: HOSTED, teams: [HOSTED.default, HOSTED.ops], service: { policy: { ...POLICY, teams: [HOSTED.default, HOSTED.ops] } }, ...extra });

test("C-6, acceptance 13: a hosted home whose committed record can't be read is kept by its retire, records-unreadable, with no effect: no self-retirement, removal or delete", (t) => {
  const fx = hosted(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  unreadable(t, fx, "default");
  const before = fx.fake.calls().length;
  const r = fx.retire("dev-1");
  assert.notEqual(r.status, 0, "the kernel keeps the home");
  assert.equal(r.doc.meta.retired, false);
  assert.equal(r.doc.meta.reason, "records-unreadable");
  const w = r.doc.warning || "";
  assert.ok(w.includes(".oats-aweb/admission-default.json") && w.includes(`${FIX} retire again`), w);
  assert.deepEqual(fx.fake.selfRetired(), []);
  assert.deepEqual(fx.fake.removed(), []);
  assert.deepEqual(calls(fx, before).filter((v) => v !== "version"), [], "no aw call at all");
});

test("C-6: a home whose record isn't one of the table's ({}) is kept by its retire the same way", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  writeFileSync(recordFile(fx, "default"), "{}\n", { mode: 0o600 });
  const before = fx.fake.calls().length;
  const r = fx.retire("dev-1");
  assert.notEqual(r.status, 0);
  assert.equal(r.doc.meta.reason, "records-unreadable");
  assert.deepEqual(calls(fx, before).filter((v) => v !== "version"), []);
});

test("C-6: a leave of a label whose record can't be read refuses E_ATTRIBUTION_EVIDENCE before any effect: the membership and the joined identity stay", (t) => {
  const fx = attributionFixture(t, { settings: { join: "ops" } });
  assert.equal(fx.spawn("dev-1").status, 0);
  unreadable(t, fx, "ops");
  const before = fx.fake.calls().length;
  const r = fx.command("dev-1", "leave", ["--labels", "ops", "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const text = r.stdout + r.stderr;
  assert.ok(text.includes("E_ATTRIBUTION_EVIDENCE") && text.includes(".oats-aweb/admission-ops.json") && text.includes(`${FIX} leave again`), text);
  assert.deepEqual(fx.fake.removed(), []);
  assert.ok(!calls(fx, before).some((v) => v.startsWith("workspace delete")));
  assert.ok(existsSync(join(fx.homeOf("dev-1"), ".aweb-identity-ops")));
});

test("C-3b: a join's rerun over an unknown record that can't be read refuses before any admit: the persisted operation is never replaced", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  fx.fake.setService({ admit: { code: "receipt_unavailable", charge: true } });
  assert.equal(fx.command("dev-1", "join", ["--labels", "ops"]).status, 1);
  fx.fake.setService({ admit: undefined });
  const bytes = readFileSync(recordFile(fx, "ops"), "utf8");
  assert.equal(JSON.parse(bytes).state, "unknown");
  unreadable(t, fx, "ops");
  const charges = Object.keys(fx.fake.charges()).length;
  const r = fx.command("dev-1", "join", ["--labels", "ops", "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const text = r.stdout + r.stderr;
  assert.ok(text.includes("E_ATTRIBUTION_EVIDENCE") && text.includes(`${FIX} rerun`), text);
  assert.equal(Object.keys(fx.fake.charges()).length, charges, "no new operation");
  chmodSync(recordFile(fx, "ops"), 0o600);
  assert.equal(readFileSync(recordFile(fx, "ops"), "utf8"), bytes, "the record is untouched");
});

test("C-4: a start is never blocked by a record that can't be read: it skips that label's cleanup with a warning, and the joined team stays", (t) => {
  const fx = hosted(t, { settings: { join: "ops" } });
  assert.equal(fx.spawn("dev-1").status, 0);
  unreadable(t, fx, "ops");
  const before = fx.fake.calls().length;
  const live = JSON.stringify([{ label: "default", team: HOSTED.default, default: true, from: "local" }]);
  const r = fx.launch("dev-1", { extra: { OATS_TEAMS: live, OATS_TEAMS_SOURCE: "live" } });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.ok(!calls(fx, before).some((v) => v.startsWith("workspace delete")));
  assert.deepEqual(fx.fake.selfRetired(), []);
  assert.deepEqual(r.doc.meta.joinedTeams.map((j) => j.label), ["ops"]);
  assert.ok(String(r.doc.warning).includes("admission-ops.json") && String(r.doc.warning).includes("can't be read"), String(r.doc.warning));
});

test("the lock refusal names the lock relative to the home, so its whole fix fits a spawn's 300 characters on a long home path", (t) => {
  const fx = attributionFixture(t);
  const name = "a".repeat(64);
  const home = fx.homeOf(name, "s".repeat(64));
  mkdirSync(join(home, ".oats-aweb"), { recursive: true });
  writeFileSync(join(home, ".oats-aweb", "admission-default.lock"), JSON.stringify({ pid: process.pid, nonce: "held" }));
  const r = fx.hook("spawn", name, { OATS_HOME: home, OATS_INSTANCE_HOME: home });
  assert.equal(r.status, 1);
  const text = r.doc.warning.split(" | ")[0].replace(/^oats-aweb: /, "");
  assert.ok(text.length <= 300, `${text.length}: ${text}`);
  assert.ok(text.startsWith("E_ATTRIBUTION_EXCHANGE (step: lock): "), text);
  assert.ok(text.endsWith(`if no oats aweb command runs as pid ${process.pid}, remove .oats-aweb/admission-default.lock in this home`), text);
});

// A record the check accepts is one retire can act on (round 23; the lead, mail
// f4973d11-554b-4883-9b98-d66ff6e03052): its label is its file's, and a committed one names its
// certificate id. One that isn't is refused as unreadable, never skipped or read as holding none.
const rewriteRecord = (fx, label, edit) => { const file = recordFile(fx, label); writeFileSync(file, JSON.stringify(edit(JSON.parse(readFileSync(file, "utf8")))), { mode: 0o600 }); };
for (const [damage, edit] of [
  ["names its certificate only by --certificate-out", ({ certificateId, ...r }) => r],
  ["has no label", ({ label, ...r }) => r],
  ["carries another label than its file's", (r) => ({ ...r, label: "ops" })],
]) {
  test(`C-6: a home whose committed record ${damage} is kept by its retire, records-unreadable, with no effect`, (t) => {
    const fx = hosted(t);
    assert.equal(fx.spawn("dev-1").status, 0);
    rewriteRecord(fx, "default", edit);
    const before = fx.fake.calls().length;
    const r = fx.retire("dev-1");
    assert.notEqual(r.status, 0, "the kernel keeps the home");
    assert.equal(r.doc.meta.reason, "records-unreadable");
    assert.ok((r.doc.warning || "").includes(".oats-aweb/admission-default.json"), r.doc.warning);
    assert.deepEqual(fx.fake.removed(), []);
    assert.deepEqual(calls(fx, before).filter((v) => v !== "version"), [], "no aw call at all");
  });
}

// A refusal for a record that can't be read comes before every effect of the command, its
// receive sync and its state write included: the labels' records are checked as soon as their
// locks are held.
const BROKER = { runtime: "codex", delivery: "session", service: { wake: "running" } };
const teamsState = (fx) => readFileSync(join(fx.homeOf("dev-1"), ".oats-aweb", "teams.json"), "utf8");

test("C-6: a broker-delivered leave of a label whose record isn't one of the table's refuses with no aw call and no state write", (t) => {
  const fx = attributionFixture(t, { ...BROKER, settings: { join: "ops" } });
  assert.equal(fx.spawn("dev-1").status, 0);
  writeFileSync(recordFile(fx, "ops"), "{}\n", { mode: 0o600 });
  const state = teamsState(fx);
  const before = fx.fake.calls().length;
  const r = fx.command("dev-1", "leave", ["--labels", "ops", "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok((r.stdout + r.stderr).includes(`${FIX} leave again`), r.stdout + r.stderr);
  assert.deepEqual(calls(fx, before).filter((v) => v !== "version"), []);
  assert.equal(teamsState(fx), state, "the provider's team state is untouched");
});

test("C-3b: a broker-delivered join over a record that isn't one of the table's refuses with no aw call and no state write", (t) => {
  const fx = attributionFixture(t, BROKER);
  assert.equal(fx.spawn("dev-1").status, 0);
  fx.fake.setService({ admit: { code: "receipt_unavailable", charge: true } });
  assert.equal(fx.command("dev-1", "join", ["--labels", "ops"]).status, 1);
  fx.fake.setService({ admit: undefined });
  writeFileSync(recordFile(fx, "ops"), "{}\n", { mode: 0o600 });
  const state = teamsState(fx);
  const before = fx.fake.calls().length;
  const r = fx.command("dev-1", "join", ["--labels", "ops", "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok((r.stdout + r.stderr).includes(`${FIX} rerun`), r.stdout + r.stderr);
  assert.deepEqual(calls(fx, before).filter((v) => v !== "version"), [], "not even the preflight's reads");
  assert.equal(teamsState(fx), state);
});

test("C-6: a leave of two labels, the second's record unreadable, leaves the first untouched", (t) => {
  const QA = "qa:acme.example";
  const fx = attributionFixture(t, { teams: [TEAM, OPS, QA], extraTeams: [{ label: "qa", team: QA }] });
  assert.equal(fx.spawn("dev-1").status, 0);
  assert.equal(fx.command("dev-1", "join", ["--labels", "ops,qa"]).status, 0);
  const ops = readFileSync(recordFile(fx, "ops"), "utf8");
  unreadable(t, fx, "qa");
  const before = fx.fake.calls().length;
  const r = fx.command("dev-1", "leave", ["--labels", "ops,qa", "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok((r.stdout + r.stderr).includes(".oats-aweb/admission-qa.json"), r.stdout + r.stderr);
  assert.deepEqual(calls(fx, before).filter((v) => v !== "version"), []);
  assert.deepEqual(fx.fake.removed(), []);
  assert.equal(readFileSync(recordFile(fx, "ops"), "utf8"), ops, "ops's record is untouched");
  assert.ok(existsSync(join(fx.homeOf("dev-1"), ".aweb-identity-ops")));
});

// Every writer of a record writes one the check accepts, so a writer and the check its readers use
// can't drift apart (the lead, mail f4973d11).
/** Asserts every admission record under dev-1's home is one of the table's, and returns them. */
function checkedRecords(fx) {
  const { records, unreadable: bad } = providerRecords(join(fx.homeOf("dev-1"), ".oats-aweb"));
  assert.deepEqual(bad, [], "every record passes the check");
  return records.map((r) => r.record);
}
const stateOf = (fx, label) => checkedRecords(fx).find((r) => r.label === label)?.state;
/** A spawn hook killed during its admit: its record pending, no certificate yet. */
function killedDuringAdmit(fx) {
  fx.fake.setService({ admit: { code: "receipt_unavailable" } });
  fx.hook("spawn", "dev-1");
  fx.fake.setService({ admit: undefined });
  rewriteRecord(fx, "default", (r) => ({ ...r, state: "pending" }));
}

test("C-5: the admission's record of a spawn is one of the table's", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  assert.equal(stateOf(fx, "default"), "committed");
});

test("C-5: the admission's record of a join whose answer was lost is one of the table's", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  fx.fake.setService({ admit: { code: "receipt_unavailable", charge: true } });
  assert.equal(fx.command("dev-1", "join", ["--labels", "ops"]).status, 1);
  assert.equal(stateOf(fx, "ops"), "unknown");
});

test("C-5: retire's mark-committed writes a record of the table's", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  rewriteRecord(fx, "default", ({ certificateId, ...r }) => ({ ...r, state: "pending" }));
  fx.fake.setService({ remove: "pending" });
  assert.notEqual(fx.retire("dev-1", { fromMeta: {} }).status, 0, "kept at the unconfirmed removal");
  assert.equal(fx.fake.calls().filter((c) => commandArgs(c.args).join(" ").startsWith("id team admit")).length, 1, "no resume: the spawn's admit only");
  assert.equal(stateOf(fx, "default"), "committed");
});

test("C-5: retire's resume writes a record of the table's", (t) => {
  const fx = attributionFixture(t);
  killedDuringAdmit(fx);
  fx.fake.setService({ remove: "pending" });
  assert.notEqual(fx.retire("dev-1", { fromMeta: {} }).status, 0, "kept at the unconfirmed removal");
  assert.equal(stateOf(fx, "default"), "committed");
});

test("C-5: retire's resume refused writes a record of the table's", (t) => {
  const fx = attributionFixture(t);
  killedDuringAdmit(fx);
  fx.fake.setService({ admit: { code: "subject_ineligible" } });
  assert.equal(fx.retire("dev-1", { fromMeta: {} }).status, 0);
  assert.equal(stateOf(fx, "default"), "refused");
});

test("C-5: retire's removal writes a record of the table's", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  assert.equal(fx.retire("dev-1").status, 0);
  assert.equal(stateOf(fx, "default"), "removed");
});

test("C-5: a leave's set-aside record is one of the table's", (t) => {
  const fx = attributionFixture(t, { settings: { join: "ops" } });
  assert.equal(fx.spawn("dev-1").status, 0);
  assert.equal(fx.command("dev-1", "leave", ["--labels", "ops"]).status, 0);
  assert.ok(checkedRecords(fx).some((r) => r.label === "ops"), "the set-aside record is read");
});

// Both readers apply one check, so a record that one refuses the other never acts on (round 24;
// the lead, mail 2bf3ffb7-b48b-4385-89a9-ffd945f54901).
test("C-3b: readAdmission refuses a record whose label isn't its file's, as providerRecords does", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  rewriteRecord(fx, "default", (r) => ({ ...r, label: "ops" }));
  const dir = join(fx.homeOf("dev-1"), ".oats-aweb");
  assert.throws(() => readAdmission(dir, "default"), (e) => e.code === "E_ATTRIBUTION_EVIDENCE" && e.details?.problem === "records-unreadable" && e.message.includes("a label other than its file's") && e.message.endsWith(`${FIX} rerun`));
  assert.equal(providerRecords(dir).unreadable[0]?.reason, "a label other than its file's");
});

test("C-3b: a resumed spawn over a record whose label isn't its file's refuses before any effect: no admit, install or connect, and the record is untouched", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  rewriteRecord(fx, "default", (r) => ({ ...r, label: "ops" }));
  const bytes = readFileSync(recordFile(fx, "default"), "utf8");
  const before = fx.fake.calls().length;
  const r = fx.hook("spawn", "dev-1");
  assert.equal(r.status, 1, JSON.stringify(r.doc) + r.stderr);
  assert.ok(String(r.doc?.warning).includes("E_ATTRIBUTION_EVIDENCE"), String(r.doc?.warning));
  assert.deepEqual(calls(fx, before).filter((v) => !["version", "who"].includes(v)), [], "nothing but the preflight's reads");
  assert.equal(readFileSync(recordFile(fx, "default"), "utf8"), bytes);
});

test("C-3b: a join's rerun over a record whose label isn't its file's refuses with no aw call, and the record is untouched", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  fx.fake.setService({ admit: { code: "receipt_unavailable", charge: true } });
  assert.equal(fx.command("dev-1", "join", ["--labels", "ops"]).status, 1);
  fx.fake.setService({ admit: undefined });
  rewriteRecord(fx, "ops", (r) => ({ ...r, label: "default" }));
  const bytes = readFileSync(recordFile(fx, "ops"), "utf8");
  const before = fx.fake.calls().length;
  const r = fx.command("dev-1", "join", ["--labels", "ops", "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(calls(fx, before).filter((v) => v !== "version"), []);
  assert.equal(readFileSync(recordFile(fx, "ops"), "utf8"), bytes);
});
