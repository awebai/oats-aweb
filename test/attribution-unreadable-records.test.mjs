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
import { OPS, attributionFixture, commandArgs } from "./helpers/attribution-fixture.mjs";
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
