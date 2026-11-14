// Check-only's attribution block and `oats aweb setup --reconcile-admissions
// [--plan]` (spec v4.3.18 C-5), with the halves of acceptance tests 12 and 13
// that reconcile after a retire couldn't remove a membership.
import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HUMAN, OPS, ROOT_ID, SERVICE_URL, TEAM, attributionFixture, capabilityWith, commandArgs, verbs } from "./helpers/attribution-fixture.mjs";
import { POLICY, writeIdentity } from "./helpers/fake-aw-protected.mjs";

const admission = (fx, name, label = "default") => JSON.parse(readFileSync(join(fx.homeOf(name), ".oats-aweb", `admission-${label}.json`), "utf8"));
const rootCopy = (fx, id) => join(fx.rootHome, "admissions", `${id}.cert`);
const removeCalls = (fx) => fx.fake.calls().filter((c) => commandArgs(c.args).join(" ").startsWith("id team remove-agent"));
const checkOnly = (fx) => {
  const r = fx.setup(["--check-only", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.doc;
};
const reconcile = (fx, extra = []) => fx.setup(["--reconcile-admissions", ...extra, "--json"]);
/** dev-1 stays; dev-2's home is lost without a retire, so its membership leaks. */
function leaked(fx) {
  for (const name of ["dev-1", "dev-2"]) assert.equal(fx.spawn(name).status, 0);
  const id = admission(fx, "dev-2").certificateId;
  rmSync(fx.homeOf("dev-2"), { recursive: true, force: true });
  return { id, kept: admission(fx, "dev-1").certificateId };
}

// ---------------------------------------------------------------------------
// Check-only (C-5).

test("C-5: check-only has no attribution block without the setting", (t) => {
  const fx = attributionFixture(t, { attribution: false });
  assert.equal("attribution" in checkOnly(fx), false);
});

test("C-5: check-only's attribution holds the root, human, service and teams, the root verified, the bounds read as the root, and OATS's own count", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  const a = checkOnly(fx).attribution;
  assert.deepEqual(a.root, { id: ROOT_ID, home: fx.rootHome });
  assert.deepEqual(a.human, { id: HUMAN, label: "Juan Pérez" });
  assert.deepEqual(a.service, { id: "svc-acme", url: SERVICE_URL });
  assert.deepEqual(a.teams, [TEAM, OPS]);
  assert.equal(a.verified, "nearest_human");
  assert.deepEqual(a.bounds, { [TEAM]: POLICY.bounds, [OPS]: POLICY.bounds });
  assert.deepEqual(a.admittedLive, { countedBy: "oats", teams: { [TEAM]: 1, [OPS]: 0 } });
  const reads = fx.fake.calls().filter((c) => commandArgs(c.args).join(" ").startsWith("id team admission-policy"));
  assert.ok(reads.length && reads.every((c) => c.cwd === fx.rootHome), "the policy is read under the root's proof");
});

test("C-5: check-only says revoked or unavailable when the root doesn't verify", (t) => {
  const fx = attributionFixture(t);
  fx.fake.revoke(ROOT_ID);
  assert.equal(checkOnly(fx).attribution.verified, "revoked");
  const fy = attributionFixture(t);
  fy.fake.unavailable();
  assert.equal(checkOnly(fy).attribution.verified, "unavailable");
});

test("C-5: chainlessSpawners lists, by instance name, each live home whose identity carries no chain", (t) => {
  const fx = attributionFixture(t);
  writeIdentity(join(fx.homeOf("old-1"), ".aw"));
  assert.equal(fx.spawn("dev-1").status, 0);
  assert.equal(fx.spawn("dev-4", { spawner: "old-1" }).status, 0);
  assert.deepEqual(checkOnly(fx).attribution.chainlessSpawners, ["dev-4"]);
});

test("C-5: with remove served, limits name only what the pinned aw still lacks, each with what it waits on", (t) => {
  const fx = attributionFixture(t);
  assert.deepEqual(checkOnly(fx).attribution.limits, [{ code: "resident-certification-unavailable", waitsOn: "aweb-acxy.18" }]);
});

test("C-5: without remove, limits add admission-removal-unavailable (A2), and leakedMemberships is absent", (t) => {
  const fx = attributionFixture(t, { capability: capabilityWith(t, { REMOVE_SERVED: false }) });
  const a = checkOnly(fx).attribution;
  assert.deepEqual(a.limits.map((l) => [l.code, l.waitsOn]), [["admission-removal-unavailable", "A2, team.agent.remove"], ["resident-certification-unavailable", "aweb-acxy.18"]]);
  assert.equal("leakedMemberships" in a, false);
});

test("C-5: findings carry the A5 scan's package 8 entries, the keychain always unknown, with no key material", (t) => {
  const fx = attributionFixture(t);
  const a = checkOnly(fx).attribution;
  assert.ok(a.findings.some((f) => f.custody === "human-keychain" && f.readiness === "protected-key-inventory-unknown"), JSON.stringify(a.findings));
  assert.ok(!JSON.stringify(a).includes("PRIVATE KEY"));
});

test("C-5: leakedMemberships lists the active certificates whose alias has no live or kept home, read from a home that holds a membership", (t) => {
  const fx = attributionFixture(t, { service: { members: { [TEAM]: [{ certificate_id: "11111111-1111-4111-8111-111111111111", team_id: TEAM, alias: "juan", member_did_key: "did:key:zjuan", member_did_aw: HUMAN, identity_scope: "global", issued_at: "2026-11-13T00:00:00Z" }] } } });
  const { id } = leaked(fx);
  const a = checkOnly(fx).attribution;
  assert.deepEqual(a.leakedMemberships, [{ team: TEAM, alias: "dev-2", certificateId: id, removable: true }]);
  const read = fx.fake.calls().find((c) => commandArgs(c.args).join(" ").startsWith("id team members"));
  assert.equal(read.identityHome, join(fx.homeOf("dev-1"), ".aw"));
});

test("C-5: a team no home here can read is reported unreadable, never as having no leaks", (t) => {
  const fx = attributionFixture(t);
  const a = checkOnly(fx).attribution;
  assert.deepEqual(a.leakedMemberships, []);
  assert.deepEqual(a.unreadableTeams.map((u) => u.team), [TEAM, OPS]);
});

// ---------------------------------------------------------------------------
// --reconcile-admissions (C-5).

test("acceptance 12: --reconcile-admissions --plan lists exactly the leaked memberships and removes nothing", (t) => {
  const fx = attributionFixture(t);
  const { id } = leaked(fx);
  const r = reconcile(fx, ["--plan"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.doc.result.removals, [{ team: TEAM, alias: "dev-2", certificateId: id }]);
  assert.deepEqual(removeCalls(fx), []);
});

test("acceptance 12: the apply removes only the leaked memberships, from the root's copy, with each removal's UUID persisted under the root home", (t) => {
  const fx = attributionFixture(t);
  const { id, kept } = leaked(fx);
  const r = reconcile(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [id]);
  assert.ok(!existsSync(rootCopy(fx, id)) && existsSync(rootCopy(fx, kept)));
  const persisted = JSON.parse(readFileSync(join(fx.rootHome, "removals", `${id}.json`), "utf8"));
  const argv = commandArgs(removeCalls(fx)[0].args);
  assert.equal(argv[argv.indexOf("--operation-id") + 1], persisted.operationId);
  assert.equal(removeCalls(fx)[0].cwd, fx.rootHome);
  assert.deepEqual(r.doc.result.removed, [{ team: TEAM, alias: "dev-2", certificateId: id }]);
});

test("C-5: a leaked membership with no copy under admissions/ is reported and never removed by guess", (t) => {
  const fx = attributionFixture(t);
  const { id } = leaked(fx);
  rmSync(rootCopy(fx, id));
  const r = reconcile(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.doc.result.notRemovable, [{ team: TEAM, alias: "dev-2", certificateId: id, reason: "no-root-copy" }]);
  assert.deepEqual(removeCalls(fx), []);
});

test("acceptance 13: without remove, --reconcile-admissions refuses E_SETUP_AW_VERSION, naming what it waits for", (t) => {
  const fx = attributionFixture(t, { capability: capabilityWith(t, { REMOVE_SERVED: false }) });
  const r = reconcile(fx);
  assert.equal(r.doc?.ok, false, r.stdout);
  assert.equal(r.doc.error.code, "E_SETUP_AW_VERSION");
  assert.ok(r.doc.error.message.includes("team.agent.remove"), r.doc.error.message);
});

test("C-5: --reconcile-admissions without the setting refuses before any effect", (t) => {
  const fx = attributionFixture(t, { attribution: false });
  const r = reconcile(fx);
  assert.equal(r.doc?.ok, false, r.stdout);
  assert.equal(r.doc.error.code, "E_SETUP_ARGUMENT");
  assert.deepEqual(fx.fake.calls().filter((c) => commandArgs(c.args)[0] === "id"), []);
});

test("C-6: a server that doesn't serve the act answers reconcile admission-removal-unavailable, naming the server, never service-refused", (t) => {
  const fx = attributionFixture(t);
  leaked(fx);
  fx.fake.setService({ remove: "unserved" });
  const r = reconcile(fx);
  assert.notEqual(r.status, 0);
  const text = JSON.stringify(r.doc);
  assert.ok(text.includes("admission-removal-unavailable") && text.includes("the service's server answered handoff_http_404 to team.agent.remove"), text);
  assert.ok(!text.includes("service-refused"), text);
});

test("C-5: an unconfirmed removal at reconcile exits nonzero, keeps the copy, and a rerun reuses its operation id", (t) => {
  const fx = attributionFixture(t);
  const { id } = leaked(fx);
  fx.fake.setService({ remove: [{ code: "receipt_unavailable" }, "served"] });
  assert.notEqual(reconcile(fx).status, 0);
  assert.ok(existsSync(rootCopy(fx, id)));
  assert.equal(reconcile(fx).status, 0);
  const ops = removeCalls(fx).map((c) => { const a = commandArgs(c.args); return a[a.indexOf("--operation-id") + 1]; });
  assert.equal(new Set(ops).size, 1, ops.join(" "));
});

// After a retire that couldn't remove: once the root is fixed, reconcile removes it.
const FIXED = [
  ["root-home-missing", (fx) => renameSync(fx.rootHome, `${fx.rootHome}.away`), (fx) => renameSync(`${fx.rootHome}.away`, fx.rootHome)],
  ["root-home-unsafe", (fx) => chmodSync(fx.rootHome, 0o755), (fx) => chmodSync(fx.rootHome, 0o700)],
  ["profile-changed", (fx) => { renameSync(fx.profile, `${fx.profile}.kept`); writeFileSync(fx.profile, readFileSync(`${fx.profile}.kept`, "utf8") + " ", { mode: 0o600 }); }, (fx) => renameSync(`${fx.profile}.kept`, fx.profile)],
  ["service-refused", (fx) => fx.fake.setService({ remove: { code: "scope_refused" } }), (fx) => fx.fake.setService({ remove: "served" })],
];
for (const [reason, cause, fix] of FIXED) {
  test(`acceptance 13: after a retire blocked by ${reason} and the root fixed, --reconcile-admissions removes that membership`, (t) => {
    const fx = attributionFixture(t);
    for (const name of ["dev-1", "dev-2"]) assert.equal(fx.spawn(name).status, 0);
    const id = admission(fx, "dev-2").certificateId;
    cause(fx);
    const r = fx.retire("dev-2");
    assert.ok(String(r.doc?.warning).includes(`reason: ${reason}`), JSON.stringify(r.doc));
    rmSync(fx.homeOf("dev-2"), { recursive: true, force: true }); // the kernel removes the home
    fix(fx);
    const again = reconcile(fx);
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [id]);
  });
}

test("acceptance 13: after a retire blocked by root-revoked, reconcile refuses E_ATTRIBUTION_REVOKED: no OATS path removes it", (t) => {
  const fx = attributionFixture(t);
  for (const name of ["dev-1", "dev-2"]) assert.equal(fx.spawn(name).status, 0);
  fx.fake.revoke(ROOT_ID);
  fx.retire("dev-2");
  rmSync(fx.homeOf("dev-2"), { recursive: true, force: true });
  const r = reconcile(fx);
  assert.equal(r.doc?.ok, false, r.stdout);
  assert.equal(r.doc.error.code, "E_ATTRIBUTION_REVOKED");
  assert.ok(r.doc.error.message.includes("no OATS path removes this membership in v1"), r.doc.error.message);
  assert.deepEqual(removeCalls(fx), []);
});

test("acceptance 13: after a restore-then-blocked retire, the restored copy makes the membership reconcilable", (t) => {
  const fx = attributionFixture(t);
  for (const name of ["dev-1", "dev-2"]) assert.equal(fx.spawn(name).status, 0);
  const id = admission(fx, "dev-2").certificateId;
  rmSync(rootCopy(fx, id));
  fx.fake.setService({ remove: { code: "scope_refused" } });
  fx.retire("dev-2");
  rmSync(fx.homeOf("dev-2"), { recursive: true, force: true });
  fx.fake.setService({ remove: "served" });
  assert.equal(reconcile(fx).status, 0);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [id]);
});

/** dev-2 as a spawn hook killed right after its admit leaves it: --certificate-out
 *  written, the record still pending, no root copy, nothing installed or connected. */
function killedAfterAdmit(fx) {
  for (const name of ["dev-1", "dev-2"]) assert.equal(fx.spawn(name).status, 0);
  const { certificateId, ...record } = admission(fx, "dev-2");
  rmSync(rootCopy(fx, certificateId));
  for (const later of ["team-certs", "workspace.yaml"]) rmSync(join(fx.homeOf("dev-2"), ".aw", later), { recursive: true, force: true });
  writeFileSync(join(fx.homeOf("dev-2"), ".oats-aweb", "admission-default.json"), JSON.stringify({ ...record, state: "pending" }));
  return certificateId;
}

test("acceptance 12: a hook killed between admit and the root's copy: the rollback retire writes the copy from the --certificate-out file and removes the membership", (t) => {
  const fx = attributionFixture(t);
  const id = killedAfterAdmit(fx);
  const r = fx.retire("dev-2", { fromMeta: {} });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [id]);
});

test("acceptance 12: a hook killed between admit and the root's copy, its removal then blocked: the copy the rerun wrote lets reconcile remove it", (t) => {
  const fx = attributionFixture(t);
  const id = killedAfterAdmit(fx);
  fx.fake.setService({ remove: { code: "scope_refused" } });
  const r = fx.retire("dev-2", { fromMeta: {} });
  assert.ok(String(r.doc?.warning).includes("reason: service-refused"), JSON.stringify(r.doc));
  assert.ok(existsSync(rootCopy(fx, id)), "written from --certificate-out");
  rmSync(fx.homeOf("dev-2"), { recursive: true, force: true });
  fx.fake.setService({ remove: "served" });
  assert.equal(reconcile(fx).status, 0);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [id]);
});

// The kernel's list of homes is what says a membership has no home: an
// unavailable or malformed list is never read as "no homes".
for (const status of ["fail", "malformed"]) {
  test(`C-5: with the kernel's instance list ${status === "fail" ? "unavailable" : "malformed"}, reconcile refuses before any removal, even on a team the root can read`, (t) => {
    const fx = attributionFixture(t, { service: { publicTeams: [TEAM, OPS] } });
    assert.equal(fx.spawn("dev-1").status, 0);
    const r = fx.setup(["--reconcile-admissions", "--json"], { extra: { FAKE_KERNEL_STATUS: status } });
    assert.equal(r.doc?.ok, false, r.stdout);
    assert.equal(r.doc.error.code, "E_ATTRIBUTION_EVIDENCE");
    assert.deepEqual(removeCalls(fx), []);
  });

  test(`C-5: with the kernel's instance list ${status === "fail" ? "unavailable" : "malformed"}, check-only reports every team unread, never leaked`, (t) => {
    const fx = attributionFixture(t, { service: { publicTeams: [TEAM, OPS] } });
    assert.equal(fx.spawn("dev-1").status, 0);
    const r = fx.setup(["--check-only", "--json"], { extra: { FAKE_KERNEL_STATUS: status } });
    const a = r.doc.attribution;
    assert.deepEqual(a.leakedMemberships, []);
    assert.deepEqual(a.unreadableTeams.map((u) => u.team), [TEAM, OPS]);
    assert.ok(a.unreadableTeams.every((u) => u.reason.includes("instance list")), JSON.stringify(a.unreadableTeams));
  });
}

test("C-5, C-6: after the last member of a private team retires with its removal blocked, fixing the root and reconciling removes it from the root's copy, with no member left to read the team", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  const id = admission(fx, "dev-1").certificateId;
  fx.fake.setService({ remove: { code: "scope_refused" } });
  assert.equal(fx.retire("dev-1").status, 0);
  rmSync(fx.homeOf("dev-1"), { recursive: true, force: true });
  fx.fake.setService({ remove: "served" });
  const plan = fx.setup(["--reconcile-admissions", "--plan", "--json"]);
  assert.equal(plan.status, 0, plan.stdout + plan.stderr);
  assert.deepEqual(plan.doc.result.removals.map((r) => r.certificateId), [id]);
  const r = fx.setup(["--reconcile-admissions", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [id]);
  assert.ok(!existsSync(join(fx.rootHome, "admissions", `${id}.cert`)), "a confirmed removal deletes the root's copy");
});

test("C-5, A9: check-only lists the deployment's legacy minting roots as package 8 inventory: the configured root, a configured root for another team and each .aweb-roots root, by public id, never as reachable keys", (t) => {
  const other = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-ops-root-")));
  t.after(() => rmSync(other, { recursive: true, force: true }));
  const fx = attributionFixture(t, { settings: { roots: { [OPS]: other } } });
  writeIdentity(join(other, ".aw"));
  writeIdentity(join(fx.ws, ".aweb-roots", "lab", ".aw"));
  const doc = checkOnly(fx);
  const roots = doc.attribution.findings.filter((f) => f.custody === "legacy-minting-root");
  const did = (dir) => readFileSync(join(dir, ".aw", "identity.yaml"), "utf8").match(/^did: (\S+)/m)[1];
  assert.deepEqual(roots.map((f) => [f.reference, f.id, f.team ?? null]).sort(), [
    [join(fx.ws, ".aw"), did(fx.ws), TEAM],
    [join(fx.ws, ".aweb-roots", "lab", ".aw"), did(join(fx.ws, ".aweb-roots", "lab")), null],
    [join(other, ".aw"), did(other), OPS],
  ].sort());
  for (const f of roots) {
    assert.equal(f.readiness, "legacy-minting-root");
    assert.equal(f.consumer, "oats.aweb");
    assert.equal(f.service, "svc-acme");
    assert.ok(/package 8/.test(f.action), f.action);
  }
  assert.ok(!JSON.stringify(doc).includes("signing.key"), "no key file is named or read");
});

/** dev-1 alive, and a row the registry lists beside its real one: unsigned list metadata. */
function forgedRow(fx, certificateId) {
  assert.equal(fx.spawn("dev-1").status, 0);
  const id = admission(fx, "dev-1").certificateId;
  fx.fake.setService({ members: { [TEAM]: [{ certificate_id: certificateId(id), team_id: TEAM, alias: "nonexistent-ghost", member_did_key: "did:key:zghost", identity_scope: "local" }] } });
  return id;
}

test("C-5: a member row whose certificate id isn't aw's form is never removed, and no path is built from it", (t) => {
  const fx = attributionFixture(t);
  const id = forgedRow(fx, (real) => `../admissions/${real}`);
  const r = reconcile(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fx.fake.removed(), [], "the live home's membership stays");
  assert.ok(existsSync(rootCopy(fx, id)));
  assert.ok(!existsSync(join(fx.rootHome, "admissions", `${id}.json`)), "no removal record outside removals/");
  assert.deepEqual(r.doc.result.removals, []);
});

test("C-5: a member row with a live home's certificate id under another alias is that home's membership, never a leak", (t) => {
  const fx = attributionFixture(t);
  const id = forgedRow(fx, (real) => real);
  assert.ok(!checkOnly(fx).attribution.leakedMemberships.some((l) => l.certificateId === id), "not listed as leaked");
  const r = reconcile(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fx.fake.removed(), [], "the live home's membership stays");
  assert.ok(existsSync(rootCopy(fx, id)));
});

test("C-5, C-6 (decided L): a joined membership a blocked leave set aside is reconcilable while its parent home lives", (t) => {
  const fx = attributionFixture(t, { settings: { join: "ops" } });
  assert.equal(fx.spawn("dev-1").status, 0);
  const { certificateId } = admission(fx, "dev-1", "ops");
  fx.fake.setService({ remove: { code: "scope_refused" } });
  const left = fx.command("dev-1", "leave", ["--labels", "ops", "--json"]);
  assert.equal(left.status, 0, left.stdout + left.stderr);
  fx.fake.setService({ remove: "served" });
  assert.ok(checkOnly(fx).attribution.leakedMemberships.some((l) => l.certificateId === certificateId && l.removable), "listed as leaked, removable");
  const r = reconcile(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fx.fake.removed().map((x) => x.certificate_id), [certificateId]);
  assert.deepEqual(fx.fake.removed().length, 1, "dev-1's own membership stays");
});

for (const [problem, change] of [
  ["profile-changed", (fx) => appendFileSync(fx.profile, " ")],
  ["profile-mode", (fx) => chmodSync(fx.profile, 0o666)],
]) {
  test(`C-1, C-5: check-only with a ${problem === "profile-mode" ? "world-writable" : "changed"} protected profile reports ${problem} and makes no profile-backed call, keeping its local findings`, (t) => {
    const fx = attributionFixture(t);
    assert.equal(fx.spawn("dev-1").status, 0);
    change(fx);
    const before = fx.fake.calls().length;
    const doc = checkOnly(fx);
    const calls = fx.fake.calls().slice(before).map((c) => commandArgs(c.args).join(" "));
    assert.ok(!calls.some((c) => c.startsWith("id team admission-policy") || c.startsWith("id team members")), calls.join(", "));
    const a = doc.attribution;
    assert.equal(a.problem?.code, "E_ATTRIBUTION_SETTING", JSON.stringify(a));
    assert.equal(a.problem?.problem, problem);
    assert.ok(Array.isArray(a.findings) && a.findings.length > 0, "the local findings stay");
    assert.ok(a.findings.some((f) => f.custody === "legacy-minting-root"), "the legacy roots stay");
    // Local parts stay; what would go through the profile reads as unread, never as clean.
    assert.deepEqual(a.admittedLive, { countedBy: "oats", teams: Object.fromEntries(a.teams.map((team) => [team, team === TEAM ? 1 : 0])) });
    assert.deepEqual(a.chainlessSpawners, []);
    assert.ok(Array.isArray(a.limits));
    assert.deepEqual(Object.values(a.bounds), a.teams.map(() => null));
    assert.deepEqual(a.leakedMemberships, []);
    assert.deepEqual(a.unreadableTeams.map((u) => u.team), a.teams);
    assert.ok(a.unreadableTeams.every((u) => u.reason.includes(problem)), JSON.stringify(a.unreadableTeams));
    // The root's verdict comes from aw who, which reads no profile (its registry is the domain's own).
    assert.equal(a.verified, "nearest_human");
  });
}
