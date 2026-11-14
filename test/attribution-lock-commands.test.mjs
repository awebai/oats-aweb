// The per-label admission lock in the commands that move a label's admission record (the
// lead's decision on round 18, mail 24e49058-3946-4389-a959-89dbdf301e15): spawn's and
// join's admission, its resume included, leave and retire. Two commands of one home and
// label never move its record at once; reconcile takes no lock.
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { OPS, attributionFixture, commandArgs } from "./helpers/attribution-fixture.mjs";
import { interleave } from "./helpers/interleave.mjs";

const record = (fx, label, name = "dev-1") => JSON.parse(readFileSync(join(fx.homeOf(name), ".oats-aweb", `admission-${label}.json`), "utf8"));
const lockOf = (fx, label, name = "dev-1") => join(fx.homeOf(name), ".oats-aweb", `admission-${label}.lock`);
const opsCharges = (fx) => Object.values(fx.fake.charges()).filter((c) => c.team === OPS);
const calls = (fx, before = 0) => fx.fake.calls().slice(before).map((c) => commandArgs(c.args).join(" "));
// A join or leave prints a refusal as "<code>: <text>"; the error carries step lock, which a
// spawn's refusal prints in its head.
const LOCK_REFUSAL = "E_ATTRIBUTION_EXCHANGE: another command holds ops's admission lock";
/** dev-1 spawned; a lock on its `label` held by this test's own process, which runs. */
function liveLock(fx, label) {
  writeFileSync(lockOf(fx, label), JSON.stringify({ pid: process.pid, nonce: "a-live-command" }));
  return lockOf(fx, label);
}
function spawned(t, opts) {
  const fx = attributionFixture(t, opts);
  const r = fx.spawn("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  return fx;
}

test("round 18's schedule: a second join of a label, started while the first creates its key, refuses step lock; the first commits and reconcile removes nothing", (t) => {
  const fx = spawned(t);
  const second = interleave(fx, { at: 'a.includes("create") && a.includes("--local") && a.some((x) => x.endsWith(".aweb-identity-ops"))', args: ["join", "--labels", "ops", "--json"] });
  const first = fx.command("dev-1", "join", ["--labels", "ops", "--json"], { extra: { PATH: second.path } });
  const inner = second.inner();
  assert.ok(inner, "the second join ran inside the first's key creation");
  assert.equal(inner.status, 1, inner.stdout + inner.stderr);
  assert.ok((inner.stdout + inner.stderr).includes(LOCK_REFUSAL), inner.stdout + inner.stderr);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(record(fx, "ops").state, "committed");
  assert.equal(opsCharges(fx).length, 1, "one admission");
  assert.equal(existsSync(lockOf(fx, "ops")), false, "released");
  const r = fx.setup(["--reconcile-admissions", "--json"]);
  assert.equal(r.doc?.ok, true, r.stdout);
  assert.deepEqual(fx.fake.removed(), [], "the live join keeps its membership");
});

test("two resumes of one keyed record: the second, started during the first's chain exchange, refuses step lock; one operation is sent and the record commits", (t) => {
  const fx = spawned(t);
  fx.fake.setService({ admit: { code: "subject_ineligible" } });
  assert.equal(fx.command("dev-1", "join", ["--labels", "ops"]).status, 1);
  fx.fake.setService({ admit: undefined });
  const { team, label, alias, identityHome, memberKey } = record(fx, "ops");
  writeFileSync(join(fx.homeOf("dev-1"), ".oats-aweb", "admission-ops.json"), JSON.stringify({ team, label, alias, identityHome, memberKey, state: "keyed" }));
  const before = Object.keys(fx.fake.charges()).length;
  const second = interleave(fx, { at: 'a.some((x) => x.endsWith(".aweb-identity-ops"))', args: ["join", "--labels", "ops", "--json"] });
  const first = fx.command("dev-1", "join", ["--labels", "ops", "--json"], { extra: { PATH: second.path } });
  const inner = second.inner();
  assert.ok(inner, "the second resume ran inside the first's");
  assert.ok((inner.stdout + inner.stderr).includes(LOCK_REFUSAL), inner.stdout + inner.stderr);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(record(fx, "ops").state, "committed");
  assert.equal(Object.keys(fx.fake.charges()).length - before, 1, "one new operation");
});

test("a join while a live command holds the label's lock refuses step lock before any key, exchange or admission, naming the pid, the lock and the fix, and leaves the lock", (t) => {
  const fx = spawned(t);
  const path = liveLock(fx, "ops");
  const before = fx.fake.calls().length;
  const r = fx.command("dev-1", "join", ["--labels", "ops", "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const text = r.stdout + r.stderr;
  assert.ok(text.includes(LOCK_REFUSAL) && text.includes(`pid ${process.pid}`) && text.includes(`remove ${path}`), text);
  assert.deepEqual(calls(fx, before).filter((v) => v !== "version" && v !== "who"), [], "only the preflight's reads");
  assert.equal(JSON.parse(readFileSync(path, "utf8")).nonce, "a-live-command");
});

test("a join takes over a lock whose holder no longer runs, and releases it", (t) => {
  const fx = spawned(t);
  writeFileSync(lockOf(fx, "ops"), JSON.stringify({ pid: 2 ** 22 + 7, nonce: "killed" })); // above any pid_max: no process runs as it
  const r = fx.command("dev-1", "join", ["--labels", "ops", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(record(fx, "ops").state, "committed");
  assert.equal(existsSync(lockOf(fx, "ops")), false);
});

test("a spawn's admission releases its lock, and a failed one does too", (t) => {
  const fx = spawned(t);
  assert.equal(existsSync(lockOf(fx, "default")), false);
  fx.fake.setService({ admit: { code: "subject_ineligible" } });
  assert.equal(fx.spawn("dev-2").status, 1);
  assert.equal(existsSync(lockOf(fx, "default", "dev-2")), false);
});

/** dev-1 spawned and joined to ops. */
function joined(t) {
  const fx = spawned(t);
  const r = fx.command("dev-1", "join", ["--labels", "ops", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return fx;
}
const removes = (fx, before) => calls(fx, before).filter((v) => v.startsWith("id team remove-agent"));

test("a leave while a live command holds the label's lock refuses step lock and acts on nothing: the membership, its record and the joined identity stay", (t) => {
  const fx = joined(t);
  liveLock(fx, "ops");
  const before = fx.fake.calls().length;
  const r = fx.command("dev-1", "leave", ["--labels", "ops", "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok((r.stdout + r.stderr).includes(LOCK_REFUSAL), r.stdout + r.stderr);
  assert.deepEqual(removes(fx, before), []);
  assert.equal(record(fx, "ops").state, "committed");
  assert.ok(existsSync(join(fx.homeOf("dev-1"), ".aweb-identity-ops")));
});

test("a retire while a live command holds a label's lock acts on nothing: it exits nonzero, keeps the home and names the rerun, before the workspace delete", (t) => {
  const fx = joined(t);
  const path = liveLock(fx, "ops");
  const before = fx.fake.calls().length;
  const r = fx.retire("dev-1");
  assert.notEqual(r.status, 0, "the kernel keeps the home");
  assert.equal(r.doc.meta.retired, false);
  assert.equal(r.doc.meta.reason, "admission-locked");
  const w = r.doc.warning || "";
  assert.ok(w.includes(`pid ${process.pid}`) && w.includes("rerun the retire when it ends") && w.includes(`remove ${path}`), w);
  assert.deepEqual(removes(fx, before), []);
  assert.ok(!calls(fx, before).some((v) => v.startsWith("workspace delete")), "nothing deleted");
  assert.equal(record(fx, "ops").state, "committed");
  assert.equal(record(fx, "default").state, "committed");
  rmSync(path);
  const again = fx.retire("dev-1");
  assert.equal(again.status, 0, JSON.stringify(again.doc));
  assert.equal(fx.fake.removed().length, 2, "the rerun removes both memberships");
});

test("the rollback retire of a failed spawn finds the lock released: the spawn's own process gave it up when its admission failed", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ install: { code: "member_mismatch" } }); // the admission commits, the install refuses
  const spawn = fx.hook("spawn", "dev-1");
  assert.notEqual(spawn.status, 0);
  fx.fake.setService({ install: undefined });
  assert.equal(existsSync(lockOf(fx, "default")), false, "no process holds it once the spawn hook exits");
  const id = record(fx, "default").certificateId;
  const r = fx.retire("dev-1", { fromMeta: spawn.doc.meta });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [id]);
});

test("the rollback retire of a spawn killed during its admission takes over the lock its dead process left, and removes the membership", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ install: { code: "member_mismatch" } });
  const spawn = fx.hook("spawn", "dev-1");
  fx.fake.setService({ install: undefined });
  writeFileSync(lockOf(fx, "default"), JSON.stringify({ pid: 2 ** 22 + 7, nonce: "killed-spawn" })); // as a killed hook leaves it
  const id = record(fx, "default").certificateId;
  const r = fx.retire("dev-1", { fromMeta: spawn.doc.meta });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [id]);
});

test("reconcile takes no lock: a live command holding a home's label lock doesn't stop it, and it removes only a home-less copy", (t) => {
  const fx = spawned(t);
  assert.equal(fx.spawn("dev-2").status, 0);
  const lost = record(fx, "default", "dev-2").certificateId;
  rmSync(fx.homeOf("dev-2"), { recursive: true, force: true });
  liveLock(fx, "default");
  const r = fx.setup(["--reconcile-admissions", "--json"]);
  assert.equal(r.doc?.ok, true, r.stdout);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [lost]);
});
