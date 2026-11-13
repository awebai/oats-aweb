// `oats aweb setup --endorse-root` (spec v4.3.13 C-2): acceptance tests 1 to 4,
// the setup half of 14 (arguments, profile, root home, labels) and 23's
// pending answer. The fake models aw built from aweb 44158f1bb.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { HUMAN, PROFILE_TEXT, ROOT_ID, SERVICE_URL, TEAM, OPS, attributionFixture, commandArgs, verbs, writtenAttribution } from "./helpers/attribution-fixture.mjs";
import { POLICY } from "./helpers/fake-aw-protected.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fresh = (t, opts = {}) => attributionFixture(t, { attribution: false, root: "none", ...opts });
const endorseArgs = (fx, extra = []) => ["--endorse-root", "--new-root", "--name", "acme-root", "--human", HUMAN, "--protected-profile", fx.profile, "--service", SERVICE_URL, "--teams", "default,ops", ...extra];
const json = (fx, args, opts) => fx.setup([...args, "--json"], opts);
const endorses = (fx) => fx.fake.calls().filter((c) => commandArgs(c.args).join(" ").startsWith("id endorse"));
const flagOf = (call, flag) => call.args[call.args.indexOf(flag) + 1];
const local = (fx) => readFileSync(join(fx.ws, "oats-local.yaml"), "utf8");
const errorOf = (r) => { assert.equal(r.doc?.ok, false, r.stdout + r.stderr); return r.doc.error; };
const operationFile = (fx) => join(fx.rootHome, "endorse-operation.json");
/** Every file under `dir` with its bytes' digest: a tree left byte-identical has the same map. */
const tree = (dir) => Object.fromEntries(readdirSync(dir, { recursive: true }).map((p) => join(dir, p)).filter((p) => statSync(p).isFile()).map((p) => [p, createHash("sha256").update(readFileSync(p)).digest("hex")]));

test("acceptance 1 and 23: one aw id endorse --no-wait with the persisted id answers pending at once, with the link; oats-local.yaml is untouched", (t) => {
  const fx = fresh(t);
  const before = local(fx);
  const r = json(fx, endorseArgs(fx));
  assert.equal(r.status, 1);
  const e = errorOf(r);
  assert.equal(e.code, "E_ENDORSE_NOT_APPROVED");
  assert.equal(e.details.state, "pending");
  const [call] = endorses(fx);
  assert.equal(endorses(fx).length, 1, "never polls");
  assert.ok(call.args.includes("--no-wait") && call.args.includes("--no-browser"));
  assert.equal(call.cwd, fx.rootHome, "from the root's home");
  const op = flagOf(call, "--operation-id");
  assert.match(op, UUID);
  assert.equal(JSON.parse(readFileSync(operationFile(fx), "utf8")).operationId, op);
  assert.equal(statSync(operationFile(fx)).mode & 0o777, 0o600);
  assert.deepEqual({ ...e.details, bounds: undefined }, { state: "pending", operationId: op, url: `https://human.example/approve/${op}`, digest: `sha256:${"d".repeat(64)}`, fingerprint: "dddddddddddddddd", expiresAt: "2026-11-13T19:00:00Z", teams: [TEAM, OPS], bounds: undefined });
  assert.deepEqual(e.details.bounds, { [TEAM]: POLICY.bounds, [OPS]: POLICY.bounds });
  assert.equal(local(fx), before);
});

test("acceptance 1: the rerun reads committed, aw who shows nearest_human H, and the setting is written last with the operation id, the policy and the profile", (t) => {
  const fx = fresh(t);
  json(fx, endorseArgs(fx));
  const r = json(fx, endorseArgs(fx, ["--label", "Juan Pérez"]));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.ok, true);
  const calls = endorses(fx);
  assert.equal(flagOf(calls[0], "--operation-id"), flagOf(calls[1], "--operation-id"), "the same operation");
  const after = verbs(fx.fake).slice(verbs(fx.fake).lastIndexOf("id endorse") + 1);
  assert.ok(after.includes("who"), after.join("\n"));
  const setting = writtenAttribution(fx.ws);
  assert.deepEqual(setting, {
    root: { id: ROOT_ID, home: fx.rootHome }, human: { id: HUMAN, label: "Juan Pérez" },
    service: { id: "svc-acme", profile: fx.profile, profileDigest: `sha256:${createHash("sha256").update(PROFILE_TEXT).digest("hex")}`, url: SERVICE_URL },
    teams: [TEAM, OPS], endorsement: { operationId: flagOf(calls[0], "--operation-id"), policy: { version: POLICY.version, digest: POLICY.digest } },
  });
  assert.equal(Number.isInteger(setting.endorsement.policy.version), true);
  assert.ok(!existsSync(operationFile(fx)), "a committed operation's id is spent");
});

test("acceptance 1: in a terminal, setup prints the link, then waits by rerunning the same aw id endorse without --no-wait", (t) => {
  const fx = fresh(t);
  const r = fx.setup(endorseArgs(fx));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [first, waiting] = endorses(fx);
  assert.ok(first.args.includes("--no-wait"));
  assert.ok(!waiting.args.includes("--no-wait"));
  assert.equal(flagOf(waiting, "--operation-id"), flagOf(first, "--operation-id"));
  const op = flagOf(first, "--operation-id");
  for (const shown of [`https://human.example/approve/${op}`, `sha256:${"d".repeat(64)}`, "dddddddddddddddd", TEAM, OPS, "max_active 50", "everything it spawns counts as yours"]) assert.ok(r.stdout.includes(shown), `${shown}:\n${r.stdout}`);
  assert.ok(writtenAttribution(fx.ws));
});

test("acceptance 2: pending, then a rerun resumes the same id", (t) => {
  const fx = fresh(t, { service: { endorse: ["pending"] } });
  const before = local(fx);
  json(fx, endorseArgs(fx));
  json(fx, endorseArgs(fx));
  const [a, b] = endorses(fx);
  assert.equal(flagOf(a, "--operation-id"), flagOf(b, "--operation-id"));
  assert.equal(local(fx), before);
});

for (const code of ["human_refused", "operation_expired", "approval_expired", "policy_changed", "subject_ineligible"]) {
  test(`acceptance 2: refused with ${code}, then a rerun starts a new id; oats-local.yaml is byte-identical`, (t) => {
    const fx = fresh(t, { service: { endorse: [{ code }, "pending"] } });
    const before = local(fx);
    const e = errorOf(json(fx, endorseArgs(fx)));
    if (code === "policy_changed") assert.deepEqual([e.code, e.details.problem], ["E_ENDORSE_POLICY", "changed"]);
    else assert.deepEqual([e.code, e.details.state, e.details.code], ["E_ENDORSE_NOT_APPROVED", "refused", code]);
    if (["operation_expired", "approval_expired", "policy_changed"].includes(code)) assert.match(e.message, /rerun/);
    assert.equal(local(fx), before);
    json(fx, endorseArgs(fx));
    const [a, b] = endorses(fx);
    assert.notEqual(flagOf(a, "--operation-id"), flagOf(b, "--operation-id"));
  });
}

test("acceptance 2: unknown keeps the id and exits nonzero, and a rerun makes no second prepare", (t) => {
  const fx = fresh(t, { service: { endorse: [{ code: "receipt_unavailable" }] } });
  const before = local(fx);
  const r = json(fx, endorseArgs(fx));
  assert.equal(r.status, 1);
  const e = errorOf(r);
  assert.deepEqual([e.code, e.details.state], ["E_ENDORSE_NOT_APPROVED", "unknown"]);
  const op = flagOf(endorses(fx)[0], "--operation-id");
  assert.equal(e.details.operationId, op);
  json(fx, endorseArgs(fx));
  assert.equal(flagOf(endorses(fx)[1], "--operation-id"), op);
  assert.equal(fx.fake.endorseOps()[op].prepared, 1);
  assert.equal(local(fx), before);
});

test("acceptance 3: aw's admission_policy_missing refuses E_ENDORSE_POLICY missing, and a legacy team legacy, with no link", (t) => {
  for (const [mode, problem] of [["missing", "missing"], ["legacy", "legacy"]]) {
    const fx = fresh(t, { service: { teams: { [OPS]: mode } } });
    const e = errorOf(json(fx, endorseArgs(fx)));
    assert.deepEqual([e.code, e.details.problem], ["E_ENDORSE_POLICY", problem]);
    assert.equal(e.details.url, undefined, "no link");
    assert.ok(e.message.includes(OPS), e.message);
  }
});

test("acceptance 3: a mapped team left out of the intended teams refuses unlisted in preflight, naming --teams", (t) => {
  const fx = fresh(t);
  const e = errorOf(json(fx, endorseArgs(fx).filter((a, i, all) => a !== "--teams" && all[i - 1] !== "--teams")));
  assert.deepEqual([e.code, e.details.problem], ["E_ENDORSE_POLICY", "unlisted"]);
  assert.ok(e.message.includes("--teams") && e.message.includes(OPS), e.message);
  assert.deepEqual(verbs(fx.fake).filter((v) => v.startsWith("id ")), [], "before any effect");
});

test("acceptance 3: an unavailable read refuses E_ATTRIBUTION_EVIDENCE", (t) => {
  const fx = fresh(t, { service: { endorse: [{ code: "service_unavailable" }] } });
  assert.equal(errorOf(json(fx, endorseArgs(fx))).code, "E_ATTRIBUTION_EVIDENCE");
});

// C-9's endorse column, row by row.
const ENDORSE_ROWS = [
  ["admission_policy_missing", "E_ENDORSE_POLICY", { problem: "missing" }],
  ["policy_changed", "E_ENDORSE_POLICY", { problem: "changed" }],
  ["subject_ineligible", "E_ENDORSE_NOT_APPROVED", { state: "refused" }],
  ["human_refused", "E_ENDORSE_NOT_APPROVED", { state: "refused" }],
  ["operation_expired", "E_ENDORSE_NOT_APPROVED", { state: "refused" }],
  ["approval_expired", "E_ENDORSE_NOT_APPROVED", { state: "refused" }],
  ["scope_refused", "E_ENDORSE_FAILED", { problem: "requester-unbound" }],
  ["profile_scope_refused", "E_ENDORSE_FAILED", { problem: "requester-unbound" }],
  ["profile_scope_ambiguous", "E_ENDORSE_FAILED", { problem: "requester-unbound" }],
  ["receipt_unavailable", "E_ENDORSE_NOT_APPROVED", { state: "unknown" }],
  ["external_effect_unresolved", "E_ENDORSE_NOT_APPROVED", { state: "unknown" }],
  ["registration_unconfirmed", "E_ENDORSE_NOT_APPROVED", { state: "unknown" }],
  ["registration_conflict", "E_ENDORSE_FAILED", {}],
  ["human_chain_unverified", "E_ENDORSE_FAILED", {}],
  ["signed_certificate_invalid", "E_ENDORSE_FAILED", {}],
  ["operation_conflict", "E_ENDORSE_FAILED", {}],
];
for (const [code, expected, details] of ENDORSE_ROWS) {
  test(`acceptance 3, C-9's endorse column: aw's ${code} is ${expected}${Object.keys(details).length ? ` ${Object.values(details)[0]}` : ""}, carrying aw's code`, (t) => {
    const fx = fresh(t, { service: { endorse: [{ code }] } });
    const before = local(fx);
    const e = errorOf(json(fx, endorseArgs(fx)));
    assert.equal(e.code, expected, e.message);
    for (const [k, v] of Object.entries(details)) assert.equal(e.details[k], v);
    assert.equal(e.details.code, code);
    assert.equal(local(fx), before);
  });
}

test("acceptance 4: with neither --new-root nor --root-home, E_SETUP_ARGUMENT lists the candidates and --new-root", (t) => {
  const fx = attributionFixture(t, { attribution: false, root: "registered" });
  const r = json(fx, ["--endorse-root", "--human", HUMAN, "--protected-profile", fx.profile, "--service", SERVICE_URL, "--teams", "default,ops"]);
  const e = errorOf(r);
  assert.equal(e.code, "E_SETUP_ARGUMENT");
  assert.ok(e.message.includes(`--root-home ${fx.rootHome}`) && e.message.includes("--new-root"), e.message);
  assert.deepEqual(verbs(fx.fake).filter((v) => v.startsWith("id ")), []);
});

test("acceptance 4: a local did:key --root-home refuses E_ENDORSE_ROOT_INELIGIBLE before prepare, naming --new-root", (t) => {
  const fx = attributionFixture(t, { attribution: false, root: "local" });
  const e = errorOf(json(fx, ["--endorse-root", "--root-home", fx.rootHome, "--human", HUMAN, "--protected-profile", fx.profile, "--service", SERVICE_URL, "--teams", "default,ops"]));
  assert.equal(e.code, "E_ENDORSE_ROOT_INELIGIBLE");
  assert.match(e.message, /--new-root/);
  assert.equal(endorses(fx).length, 0);
});

test("acceptance 4: a registered --root-home is endorsed as it is: no key is created", (t) => {
  const fx = attributionFixture(t, { attribution: false, root: "registered" });
  const args = ["--endorse-root", "--root-home", fx.rootHome, "--human", HUMAN, "--protected-profile", fx.profile, "--service", SERVICE_URL, "--teams", "default,ops"];
  json(fx, args);
  assert.equal(json(fx, args).status, 0);
  assert.ok(!verbs(fx.fake).includes("id create"));
  assert.equal(writtenAttribution(fx.ws).root.id, ROOT_ID);
});

test("acceptance 4: --new-root makes a registered agent with no address with aw id create --no-address, and a killed run resumes the same key", (t) => {
  const fx = fresh(t, { service: { createKill: true } });
  const e = errorOf(json(fx, endorseArgs(fx)));
  assert.deepEqual([e.code, e.details.step], ["E_ENDORSE_FAILED", "create"]);
  const key = readFileSync(join(fx.rootHome, ".aw", "signing.key"), "utf8");
  fx.fake.setService({ createKill: false });
  const r = json(fx, endorseArgs(fx));
  assert.equal(errorOf(r).details.state, "pending");
  const creates = fx.fake.calls().filter((c) => commandArgs(c.args).join(" ").startsWith("id create"));
  assert.deepEqual(creates.map((c) => c.args), Array(2).fill(["--json", "id", "create", "--no-address", "--identity-home", join(fx.rootHome, ".aw"), "--registry", "https://registry.acme.example"]));
  assert.equal(readFileSync(join(fx.rootHome, ".aw", "signing.key"), "utf8"), key, "the same key");
  assert.equal(readFileSync(join(fx.rootHome, ".aw", "did"), "utf8"), ROOT_ID);
  assert.equal(statSync(fx.rootHome).mode & 0o777, 0o700);
});

test("acceptance 4: an unbound root refuses E_ENDORSE_FAILED requester-unbound, printing the root's did:aw, H and the team bindings, with oats-local.yaml byte-identical", (t) => {
  const fx = fresh(t, { service: { endorse: [{ code: "scope_refused" }] } });
  const before = local(fx);
  const e = errorOf(json(fx, endorseArgs(fx)));
  assert.deepEqual([e.code, e.details.problem], ["E_ENDORSE_FAILED", "requester-unbound"]);
  for (const shown of [ROOT_ID, HUMAN, TEAM, OPS]) assert.ok(e.message.includes(shown), `${shown}: ${e.message}`);
  assert.deepEqual(e.details.bind, { root: ROOT_ID, human: HUMAN, teams: [TEAM, OPS] });
  assert.equal(local(fx), before);
});

test("acceptance 4: the legacy minting roots are byte-identical afterwards", (t) => {
  const fx = fresh(t);
  const before = tree(join(fx.ws, ".aw"));
  json(fx, endorseArgs(fx));
  json(fx, endorseArgs(fx));
  assert.deepEqual(tree(join(fx.ws, ".aw")), before);
});

for (const [name, args] of [
  ["without --service", (fx) => endorseArgs(fx).filter((a, i, all) => a !== "--service" && all[i - 1] !== "--service")],
  ["with an http URL outside loopback", (fx) => endorseArgs(fx).map((a) => a === SERVICE_URL ? "http://aweb.acme.example/api" : a)],
  ["with a URL carrying a query", (fx) => endorseArgs(fx).map((a) => a === SERVICE_URL ? `${SERVICE_URL}?x=1` : a)],
  ["with a label the waiting-message rule refuses", (fx) => endorseArgs(fx, ["--label", "Juan\nPérez"])],
]) {
  test(`acceptance 14: --endorse-root ${name} refuses E_SETUP_ARGUMENT before any effect`, (t) => {
    const fx = fresh(t);
    const r = json(fx, args(fx));
    assert.equal(errorOf(r).code, "E_SETUP_ARGUMENT");
    assert.equal(r.status, 2);
    assert.deepEqual(verbs(fx.fake).filter((v) => v.startsWith("id ")), []);
    assert.ok(!existsSync(join(fx.ws, ".aweb-endorsed-root")), "no root directory");
  });
}

for (const [name, change] of [["group-writable", (fx) => chmodSync(fx.profile, 0o664)], ["other-writable", (fx) => chmodSync(fx.profile, 0o602)]]) {
  test(`acceptance 14: a ${name} profile refuses E_ATTRIBUTION_SETTING profile-mode at setup, before any aw call`, (t) => {
    const fx = fresh(t);
    change(fx);
    const e = errorOf(json(fx, endorseArgs(fx)));
    assert.deepEqual([e.code, e.details.problem], ["E_ATTRIBUTION_SETTING", "profile-mode"]);
    assert.deepEqual(verbs(fx.fake).filter((v) => v.startsWith("id ") || v === "who"), []);
  });
}

test("acceptance 14: a root home open to others refuses E_ATTRIBUTION_ROOT_HOME mode at setup, before any effect", (t) => {
  const fx = attributionFixture(t, { attribution: false, root: "registered" });
  chmodSync(fx.rootHome, 0o755);
  const e = errorOf(json(fx, ["--endorse-root", "--root-home", fx.rootHome, "--human", HUMAN, "--protected-profile", fx.profile, "--service", SERVICE_URL, "--teams", "default,ops"]));
  assert.deepEqual([e.code, e.details.problem], ["E_ATTRIBUTION_ROOT_HOME", "mode"]);
  assert.deepEqual(verbs(fx.fake).filter((v) => v.startsWith("id ")), []);
});

test("acceptance 14: without --label, human.label is H's did:aw; the deployment label aw receives is <short host>:<basename of D>, never the human's name", (t) => {
  const fx = fresh(t);
  json(fx, endorseArgs(fx, ["--label", "Juan Pérez"]));
  const derived = `${hostname().split(".")[0]}:${basename(fx.ws)}`;
  assert.equal(flagOf(endorses(fx)[0], "--deployment-label"), derived);
  const other = fresh(t);
  json(other, endorseArgs(other));
  assert.equal(json(other, endorseArgs(other)).status, 0);
  assert.deepEqual(writtenAttribution(other.ws).human, { id: HUMAN, label: HUMAN });
});

test("acceptance 14: a profile that changed between setup's preflight and its record is never recorded under the old digest", (t) => {
  const fx = fresh(t);
  json(fx, endorseArgs(fx));
  appendFileSync(fx.profile, " ");
  assert.equal(json(fx, endorseArgs(fx)).status, 0);
  assert.equal(writtenAttribution(fx.ws).service.profileDigest, `sha256:${createHash("sha256").update(readFileSync(fx.profile)).digest("hex")}`);
});

test("acceptance 14 (v4.3.14): the deployment label is recorded with the operation, and a rerun of it sends the recorded label, never a new one", (t) => {
  const fx = fresh(t, { service: { endorse: ["pending"] } });
  json(fx, endorseArgs(fx));
  const recorded = JSON.parse(readFileSync(operationFile(fx), "utf8"));
  assert.equal(recorded.deploymentLabel, `${hostname().split(".")[0]}:${basename(fx.ws)}`);
  // As if the host were renamed between the two runs of this operation.
  writeFileSync(operationFile(fx), JSON.stringify({ ...recorded, deploymentLabel: "old-host:deployment" }), { mode: 0o600 });
  json(fx, endorseArgs(fx));
  assert.equal(flagOf(endorses(fx)[1], "--deployment-label"), "old-host:deployment");
  assert.equal(flagOf(endorses(fx)[1], "--operation-id"), recorded.operationId);
});

test("acceptance 1 (v4.3.15): a committed answer without chain_installed: true refuses E_ENDORSE_FAILED, and the rerun that installs it goes on", (t) => {
  const fx = fresh(t, { service: { endorse: ["pending", "committed-without-chain", "committed"] } });
  const before = local(fx);
  json(fx, endorseArgs(fx));
  const e = errorOf(json(fx, endorseArgs(fx)));
  assert.deepEqual([e.code, e.details.step], ["E_ENDORSE_FAILED", "install"]);
  assert.match(e.message, /rerun setup/);
  assert.equal(local(fx), before);
  assert.equal(json(fx, endorseArgs(fx)).status, 0);
  const ops = endorses(fx).map((c) => flagOf(c, "--operation-id"));
  assert.equal(new Set(ops).size, 1, "the same operation throughout");
  assert.ok(writtenAttribution(fx.ws));
});
