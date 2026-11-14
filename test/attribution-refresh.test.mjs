// A rerun of `oats aweb setup --endorse-root` with a root recorded (spec
// v4.3.18 C-2 step 8, Edge cases): the refresh, acceptance test 22, and the
// service-URL rerun of test 14. It prepares nothing, reads the policy as the
// root, and writes once, or not at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { HUMAN, OPS, ROOT_ID, SERVICE_URL, TEAM, attributionFixture, commandArgs, verbs, writtenAttribution } from "./helpers/attribution-fixture.mjs";
import { POLICY } from "./helpers/fake-aw-protected.mjs";

const QA = "qa:acme.example";
const NEW_POLICY = { ...POLICY, version: 4, digest: `sha256:${"e".repeat(64)}`, teams: [TEAM, OPS, QA] };
const rerun = (fx, extra = []) => fx.setup(["--endorse-root", "--root-home", fx.rootHome, "--human", HUMAN, "--protected-profile", fx.profile, "--service", SERVICE_URL, ...extra, "--json"]);
const local = (fx) => readFileSync(join(fx.ws, "oats-local.yaml"), "utf8");
const errorOf = (r) => { assert.equal(r.doc?.ok, false, r.stdout + r.stderr); return r.doc.error; };
const policyReads = (fx) => fx.fake.calls().filter((c) => commandArgs(c.args).join(" ").startsWith("id team admission-policy"));

test("acceptance 22: with a root recorded and the policy changed, the rerun prepares nothing and rewrites only attribution.endorsement.policy, after reading it as the root", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ policy: NEW_POLICY });
  const r = rerun(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.result.state, "already-endorsed");
  assert.ok(!verbs(fx.fake).some((v) => v.startsWith("id endorse") || v.startsWith("id create")), verbs(fx.fake).join("\n"));
  assert.ok(policyReads(fx).length >= 2 && policyReads(fx).every((c) => c.cwd === fx.rootHome), "read as the root");
  assert.deepEqual(writtenAttribution(fx.ws), { ...fx.setting, endorsement: { ...fx.setting.endorsement, policy: { version: 4, digest: NEW_POLICY.digest } } });
});

test("acceptance 22: with nothing changed, the rerun is already-endorsed and writes nothing", (t) => {
  const fx = attributionFixture(t);
  const before = local(fx);
  const r = rerun(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.result.state, "already-endorsed");
  assert.equal(local(fx), before);
});

test("acceptance 22: a newly mapped team the policy lists is added to attribution.teams, with the policy, in one write; no endorsement or link is made", (t) => {
  const fx = attributionFixture(t, { teams: [TEAM] });
  fx.fake.setService({ policy: NEW_POLICY });
  const r = rerun(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(writtenAttribution(fx.ws), { ...fx.setting, teams: [TEAM, OPS], endorsement: { ...fx.setting.endorsement, policy: { version: 4, digest: NEW_POLICY.digest } } });
  assert.ok(!verbs(fx.fake).some((v) => v.startsWith("id endorse")));
});

test("acceptance 22: a newly mapped team the policy doesn't list refuses unlisted with the admission_policy_missing text, and oats-local.yaml is byte-identical", (t) => {
  const fx = attributionFixture(t, { teams: [TEAM] });
  fx.fake.setService({ teams: { [OPS]: "missing" } });
  const before = local(fx);
  const e = errorOf(rerun(fx));
  assert.deepEqual([e.code, e.details.problem], ["E_ENDORSE_POLICY", "unlisted"]);
  assert.ok(e.message.includes("This team is not in the deployment's admission policy, and this aweb release can't add a team to it"), e.message);
  assert.deepEqual(e.details.teams, [{ team: OPS, problem: "unlisted" }]);
  assert.equal(local(fx), before);
});

test("acceptance 22: a newly mapped team the root isn't bound for refuses E_ENDORSE_FAILED requester-unbound, naming bind-root for this root and that team, with oats-local.yaml byte-identical", (t) => {
  const fx = attributionFixture(t, { teams: [TEAM] });
  fx.fake.setService({ policyRead: { code: "scope_refused", teams: [OPS] } });
  const before = local(fx);
  const e = errorOf(rerun(fx));
  assert.deepEqual([e.code, e.details.problem], ["E_ENDORSE_FAILED", "requester-unbound"]);
  assert.ok(e.message.includes(`bind-root --human ${HUMAN} --root ${ROOT_ID} --team ${OPS}`), e.message);
  assert.equal(local(fx), before);
});

test("acceptance 22: two newly mapped teams, one listed and one not: nothing is written, the listed team included, and the refusal names the failing team", (t) => {
  const fx = attributionFixture(t, { teams: [TEAM], extraTeams: [{ label: "qa", team: QA }], service: { teams: { [QA]: "missing" } } });
  const before = local(fx);
  const e = errorOf(rerun(fx));
  assert.deepEqual([e.code, e.details.problem], ["E_ENDORSE_POLICY", "unlisted"]);
  assert.ok(e.message.includes(QA), e.message);
  assert.deepEqual(e.details.teams, [{ team: QA, problem: "unlisted" }]);
  assert.equal(local(fx), before);
});

test("acceptance 22: the same with a changed policy: the policy isn't rewritten either, and the text says spawns keep refusing policy_changed and names both ways out", (t) => {
  const fx = attributionFixture(t, { teams: [TEAM], extraTeams: [{ label: "qa", team: QA }], service: { teams: { [QA]: "missing" } } });
  fx.fake.setService({ policy: { ...NEW_POLICY, teams: [TEAM, OPS] } });
  const before = local(fx);
  const e = errorOf(rerun(fx));
  assert.ok(e.message.includes("policy_changed"), e.message);
  assert.ok(e.message.includes("bind the team") && e.message.includes("remove its mapping") && e.message.includes("oats teams"), e.message);
  assert.ok(e.message.includes("then rerun `oats aweb setup --endorse-root`"), e.message);
  assert.equal(local(fx), before);
});

test("acceptance 22: with both kinds of failure, requester-unbound comes first and details.teams lists every failing team", (t) => {
  const fx = attributionFixture(t, { teams: [TEAM], extraTeams: [{ label: "qa", team: QA }], service: { teams: { [QA]: "missing" }, policyRead: { code: "scope_refused", teams: [OPS] } } });
  const e = errorOf(rerun(fx));
  assert.deepEqual([e.code, e.details.problem], ["E_ENDORSE_FAILED", "requester-unbound"]);
  assert.deepEqual(e.details.teams, [{ team: OPS, problem: "requester-unbound" }, { team: QA, problem: "unlisted" }]);
});

test("acceptance 22: a recorded team the policy no longer lists refuses E_ENDORSE_POLICY unlisted", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ teams: { [OPS]: "missing" } });
  const before = local(fx);
  const e = errorOf(rerun(fx));
  assert.deepEqual([e.code, e.details.problem], ["E_ENDORSE_POLICY", "unlisted"]);
  assert.ok(e.message.includes(OPS), e.message);
  assert.equal(local(fx), before);
});

test("acceptance 22: an unknown policy read changes nothing and refuses E_ATTRIBUTION_EVIDENCE", (t) => {
  const fx = attributionFixture(t);
  fx.fake.setService({ policy: NEW_POLICY, policyRead: { code: "service_unavailable" } });
  const before = local(fx);
  assert.equal(errorOf(rerun(fx)).code, "E_ATTRIBUTION_EVIDENCE");
  assert.equal(local(fx), before);
});

for (const code of ["handoff_result_invalid", "handoff_http_503"]) {
  test(`acceptance 22: a refresh's policy read answered ${code} establishes nothing: E_ATTRIBUTION_EVIDENCE, and nothing changes`, (t) => {
    const fx = attributionFixture(t);
    fx.fake.setService({ policy: NEW_POLICY, policyRead: { code } });
    const before = local(fx);
    assert.equal(errorOf(rerun(fx)).code, "E_ATTRIBUTION_EVIDENCE");
    assert.equal(local(fx), before);
  });
}

test("acceptance 14: a rerun after success with another --service rewrites only service.url", (t) => {
  const fx = attributionFixture(t);
  const r = rerun(fx).status === 0 && fx.setup(["--endorse-root", "--root-home", fx.rootHome, "--human", HUMAN, "--protected-profile", fx.profile, "--service", "https://aweb2.acme.example/api", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(writtenAttribution(fx.ws), { ...fx.setting, service: { ...fx.setting.service, url: "https://aweb2.acme.example/api" } });
});

test("C-2: a rerun naming another root refuses E_ENDORSE_ONE_ROOT, and the root recorded is unchanged", (t) => {
  const fx = attributionFixture(t);
  const before = local(fx);
  const e = errorOf(fx.setup(["--endorse-root", "--new-root", "--name", "other-root", "--human", HUMAN, "--protected-profile", fx.profile, "--service", SERVICE_URL, "--json"]));
  assert.equal(e.code, "E_ENDORSE_ONE_ROOT");
  assert.equal(local(fx), before);
});

test("C-2: a rerun after the human revoked the root refuses E_ATTRIBUTION_REVOKED and writes nothing", (t) => {
  const fx = attributionFixture(t);
  fx.fake.revoke(ROOT_ID);
  const before = local(fx);
  assert.equal(errorOf(rerun(fx)).code, "E_ATTRIBUTION_REVOKED");
  assert.equal(local(fx), before);
});
