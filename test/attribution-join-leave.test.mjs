// A home's own `oats aweb join` and `leave` on an opted-in deployment
// (acceptance 18, C-3, C-6): a joined team's identity is issued and admitted
// like a spawn's, by the root, never through a member invite; a team outside
// attribution.teams refuses at join; a leave removes the membership through
// the root, as retire does.
import assert from "node:assert/strict";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { OPS, ROOT_ID, TEAM, attributionFixture, capabilityWith, commandArgs, verbs } from "./helpers/attribution-fixture.mjs";

const call = (fake, prefix) => fake.calls().filter((c) => commandArgs(c.args).join(" ").startsWith(prefix));
const record = (fx, name, label) => JSON.parse(readFileSync(join(fx.homeOf(name), ".oats-aweb", `admission-${label}.json`), "utf8"));
const joinedHome = (fx, name = "dev-1") => join(fx.homeOf(name), ".aweb-identity-ops");
const joinedLabels = (fx) => {
  const r = fx.command("dev-1", "teams", ["--json"]);
  assert.equal(r.status, 0, r.stderr);
  return r.doc.joined.map((j) => j.label);
};
/** A spawned dev-1, and the calls made from then on. */
function spawned(fx, opts) {
  const r = fx.spawn("dev-1", opts);
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  const before = fx.fake.calls().length;
  return () => fx.fake.calls().slice(before);
}

test("acceptance 18: an explicit join of a listed team issues the joined identity from this home and has the root admit it; no member invite", (t) => {
  const fx = attributionFixture(t);
  const since = spawned(fx);
  const r = fx.command("dev-1", "join", ["--labels", "ops", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const calls = since().map((c) => commandArgs(c.args).join(" "));
  assert.ok(!calls.some((c) => c.startsWith("team invite") || c.startsWith("id team accept-invite")), calls.join("\n"));
  assert.deepEqual(fx.fake.issued().at(-1), { issuer: "did:key:zdev-1", child: "did:key:zdev-1-ops" });
  const admit = call(fx.fake, "id team admit").find((c) => c.args.includes(OPS));
  assert.equal(admit.cwd, fx.rootHome);
  assert.equal(admit.args[admit.args.indexOf("--operation-id") + 1], record(fx, "dev-1", "ops").operationId);
  assert.equal(record(fx, "dev-1", "ops").state, "committed");
  assert.deepEqual(call(fx.fake, "id team install-cert").at(-1).args[call(fx.fake, "id team install-cert").at(-1).args.indexOf("--identity-home") + 1], joinedHome(fx));
  assert.deepEqual(joinedLabels(fx), ["ops"]);
});

test("acceptance 18: an explicit join of a team outside attribution.teams refuses E_ENDORSE_POLICY unlisted, before any effect, naming the rerun of --endorse-root", (t) => {
  const fx = attributionFixture(t, { teams: [TEAM] });
  const since = spawned(fx);
  const r = fx.command("dev-1", "join", ["--labels", "ops"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.startsWith("E_ENDORSE_POLICY: ") && r.stderr.includes(OPS) && r.stderr.includes("rerun `oats aweb setup --endorse-root`"), r.stderr);
  const verbsNow = since().map((c) => commandArgs(c.args).join(" "));
  assert.ok(!verbsNow.some((v) => /^(id create|team invite|id team admit)/.test(v)), verbsNow.join("\n"));
  assert.ok(!existsSync(joinedHome(fx)));
});

test("acceptance 18: join --plan on an opted-in home names the root that admits each team, and refuses an unlisted one, with no effect", (t) => {
  const fx = attributionFixture(t);
  const since = spawned(fx);
  const r = fx.command("dev-1", "join", ["--labels", "ops", "--plan", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.doc.plan.map(({ label, team, admittedBy, member }) => ({ label, team, admittedBy, member })), [{ label: "ops", team: OPS, admittedBy: ROOT_ID, member: true }]);
  assert.ok(!since().some((c) => /^(id create|team invite|id team admit|id issue)/.test(commandArgs(c.args).join(" "))));
  const unlisted = attributionFixture(t, { teams: [TEAM] });
  spawned(unlisted);
  const u = unlisted.command("dev-1", "join", ["--labels", "ops", "--plan", "--json"]);
  assert.equal(u.status, 1);
  assert.ok(u.doc.plan[0].problem.includes("rerun `oats aweb setup --endorse-root`"), JSON.stringify(u.doc));
});

test("C-3b: an explicit join whose admission stays unknown keeps the joined identity, and the rerun resumes the same operation: one certificate", (t) => {
  const fx = attributionFixture(t);
  spawned(fx);
  fx.fake.setService({ admit: { code: "receipt_unavailable" } });
  const r = fx.command("dev-1", "join", ["--labels", "ops"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.startsWith("E_ADMISSION_UNKNOWN: ") && r.stderr.includes("oats aweb join --labels ops"), r.stderr);
  const { operationId, state } = record(fx, "dev-1", "ops");
  assert.equal(state, "unknown");
  assert.deepEqual(joinedLabels(fx), []);
  fx.fake.setService({ admit: undefined });
  const again = fx.command("dev-1", "join", ["--labels", "ops"]);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(record(fx, "dev-1", "ops").operationId, operationId);
  assert.deepEqual(Object.values(fx.fake.charges()).filter((c) => c.team === OPS).length, 1);
  assert.deepEqual(joinedLabels(fx), ["ops"]);
});

test("acceptance 13: an explicit leave of an admitted joined team removes the membership through the root, deletes the joined identity, and a later join admits it anew", (t) => {
  const fx = attributionFixture(t, { settings: { join: "ops" } });
  spawned(fx);
  const { certificateId } = record(fx, "dev-1", "ops");
  const r = fx.command("dev-1", "leave", ["--labels", "ops", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const remove = call(fx.fake, "id team remove-agent");
  assert.equal(remove.length, 1);
  assert.equal(remove[0].cwd, fx.rootHome);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [certificateId]);
  assert.ok(!existsSync(joinedHome(fx)), "the joined identity is deleted");
  // aw refuses a joined (external) home's workspace delete outside aweb's hosted zone: said, never claimed done.
  assert.ok(JSON.stringify(r.doc.warnings).includes("workspace on ops:acme.example stays at the service until it goes stale"), JSON.stringify(r.doc));
  assert.ok(!JSON.stringify(r.doc.actions).includes('"released"'), JSON.stringify(r.doc.actions));
  assert.deepEqual(joinedLabels(fx), []);
  const back = fx.command("dev-1", "join", ["--labels", "ops"]);
  assert.equal(back.status, 0, back.stdout + back.stderr);
  assert.notEqual(record(fx, "dev-1", "ops").certificateId, certificateId, "a new admission, not the removed one");
});

test("C-6: an explicit leave whose removal isn't confirmed keeps the joined identity and names the rerun", (t) => {
  const fx = attributionFixture(t, { settings: { join: "ops" } });
  spawned(fx);
  fx.fake.setService({ remove: { code: "receipt_unavailable" } });
  const r = fx.command("dev-1", "leave", ["--labels", "ops"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("receipt_unavailable") && r.stderr.includes("oats aweb leave --labels ops"), r.stderr);
  assert.ok(existsSync(joinedHome(fx)));
  assert.deepEqual(joinedLabels(fx), ["ops"]);
  assert.ok(!verbs(fx.fake).includes("workspace delete"));
});

test("C-6: an explicit leave while the root can't act keeps the membership with admission-removal-blocked, and the joined identity goes, as at retire", (t) => {
  const fx = attributionFixture(t, { settings: { join: "ops" } });
  spawned(fx);
  fx.fake.revoke(ROOT_ID);
  const r = fx.command("dev-1", "leave", ["--labels", "ops", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(JSON.stringify(r.doc.warnings).includes("admission-removal-blocked (reason: root-revoked"), JSON.stringify(r.doc));
  assert.deepEqual(call(fx.fake, "id team remove-agent"), []);
  assert.ok(!existsSync(joinedHome(fx)));
  assert.deepEqual(joinedLabels(fx), []);
});

test("C-6: while the pinned aw lacks team.agent.remove, an explicit leave warns admission-removal-unavailable and the membership stays", (t) => {
  const fx = attributionFixture(t, { settings: { join: "ops" }, capability: capabilityWith(t, { REMOVE_SERVED: false }) });
  spawned(fx);
  const r = fx.command("dev-1", "leave", ["--labels", "ops", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(JSON.stringify(r.doc.warnings).includes("admission-removal-unavailable"), JSON.stringify(r.doc));
  assert.deepEqual(call(fx.fake, "id team remove-agent"), []);
  assert.deepEqual(joinedLabels(fx), []);
});

test("C-6: a membership a leave couldn't remove is kept on record beside a later join's new admission, and the home's retire removes both once the root can act", (t) => {
  const fx = attributionFixture(t, { settings: { join: "ops" } });
  spawned(fx);
  const { certificateId } = record(fx, "dev-1", "ops");
  renameSync(fx.rootHome, `${fx.rootHome}.aside`);
  const r = fx.command("dev-1", "leave", ["--labels", "ops", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(JSON.stringify(r.doc.warnings).includes("reason: root-home-missing"), JSON.stringify(r.doc));
  assert.ok(!existsSync(joinedHome(fx)));
  renameSync(`${fx.rootHome}.aside`, fx.rootHome);
  const back = fx.command("dev-1", "join", ["--labels", "ops"]);
  assert.equal(back.status, 0, back.stdout + back.stderr);
  const again = record(fx, "dev-1", "ops").certificateId;
  assert.notEqual(again, certificateId);
  const retired = fx.retire("dev-1");
  assert.equal(retired.status, 0, JSON.stringify(retired.doc) + retired.stderr);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id).filter((id) => [certificateId, again].includes(id)).sort(), [certificateId, again].sort());
});

test("C-3b (native create): a join refused after its chain exchange reruns with the same key and chain, under a new operation", (t) => {
  const fx = attributionFixture(t);
  spawned(fx);
  fx.fake.setService({ admit: { code: "subject_ineligible" } });
  assert.equal(fx.command("dev-1", "join", ["--labels", "ops"]).status, 1);
  const refused = record(fx, "dev-1", "ops");
  assert.equal(refused.state, "refused");
  assert.ok(existsSync(join(joinedHome(fx), "id-chain.json")), "the exchange ran: aw's key-only create would refuse this home");
  fx.fake.setService({ admit: undefined });
  const again = fx.command("dev-1", "join", ["--labels", "ops"]);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  const now = record(fx, "dev-1", "ops");
  assert.notEqual(now.operationId, refused.operationId);
  assert.equal(now.memberKey, refused.memberKey);
  assert.equal(fx.fake.issued().filter((x) => x.child === refused.memberKey).length, 1, "one chain, never a second request");
});

test("C-3b (native create): a join killed between its chain exchange and its admit resumes from the recorded key", (t) => {
  const fx = attributionFixture(t);
  spawned(fx);
  fx.fake.setService({ admit: { code: "subject_ineligible" } });
  fx.command("dev-1", "join", ["--labels", "ops"]);
  fx.fake.setService({ admit: undefined });
  // As the hook leaves it when killed after the exchange: the key recorded, no operation yet.
  const file = join(fx.homeOf("dev-1"), ".oats-aweb", "admission-ops.json");
  const { team, label, alias, identityHome, memberKey } = record(fx, "dev-1", "ops");
  writeFileSync(file, JSON.stringify({ team, label, alias, identityHome, memberKey, state: "keyed" }));
  const before = Object.keys(fx.fake.charges()).length;
  const again = fx.command("dev-1", "join", ["--labels", "ops"]);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(record(fx, "dev-1", "ops").state, "committed");
  assert.equal(Object.keys(fx.fake.charges()).length, before + 1);
});

test("C-3b: a home whose record holds an operation for a key it no longer has refuses at key, and the operation is kept for retire", (t) => {
  const fx = attributionFixture(t);
  spawned(fx);
  fx.fake.setService({ admit: { code: "receipt_unavailable" } });
  fx.command("dev-1", "join", ["--labels", "ops"]);
  const { operationId } = record(fx, "dev-1", "ops");
  rmSync(joinedHome(fx), { recursive: true, force: true });
  const r = fx.command("dev-1", "join", ["--labels", "ops"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.startsWith("E_ATTRIBUTION_EXCHANGE: ") && r.stderr.includes(operationId), r.stderr);
  assert.equal(record(fx, "dev-1", "ops").operationId, operationId);
});
