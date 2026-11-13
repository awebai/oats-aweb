// Spawn on an opted-in deployment (spec v4.3.7 C-3): the key, the chain, the
// admission, the install and the connect, with acceptance tests 5, 6 and 7.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { HUMAN, ROOT_ID, SERVICE_URL, TEAM, attributionFixture, commandArgs, verbs } from "./helpers/attribution-fixture.mjs";
import { POLICY } from "./helpers/fake-aw-protected.mjs";

const call = (fake, words) => fake.calls().filter((c) => commandArgs(c.args).join(" ").startsWith(words));

test("acceptance 5: a person's spawn: the root issues, the root admits, and the meta records {mode: human, parent: root}; no invite call is made", (t) => {
  const fx = attributionFixture(t);
  const r = fx.spawn("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  const home = fx.homeOf("dev-1"), identityHome = join(home, ".aw");
  assert.deepEqual(r.doc.meta.identity.attribution, { mode: "human", human: { id: HUMAN, label: "Juan Pérez" }, parent: { id: ROOT_ID } });
  assert.equal(r.doc.meta.team, TEAM);
  assert.equal(r.doc.meta.alias, "dev-1");
  // No member invite, no legacy mint, no team key.
  assert.deepEqual(fx.fake.forbidden(), []);
  assert.ok(!verbs(fx.fake).some((v) => v.startsWith("init") || v.startsWith("team invite") || v.startsWith("id team invite") || v.startsWith("id team accept-invite")), verbs(fx.fake).join("\n"));
  // The key, the chain, the admission, the install, the connect, in that order.
  const order = verbs(fx.fake).filter((v) => !v.startsWith("version") && !v.startsWith("wake"));
  assert.deepEqual(order, ["who", "id create", "id child invite", "id parent request", "id child receive", "id child approve", "id parent import", "who", "id team admit", "id team install-cert", "service init"]);
  // The key-only local identity is created in the new home.
  assert.deepEqual(call(fx.fake, "id create --local")[0].args, ["--json", "id", "create", "--local", "--identity-home", identityHome]);
  // The root issues: the invite and the approve run as the root's identity.
  for (const step of ["id child invite", "id child receive", "id child approve"]) assert.equal(call(fx.fake, step)[0].identityHome, join(fx.rootHome, ".aw"), step);
  for (const step of ["id parent request", "id parent import"]) assert.equal(call(fx.fake, step)[0].identityHome, identityHome, step);
  assert.deepEqual(fx.fake.issued(), [{ issuer: ROOT_ID, child: "did:key:zdev-1" }]);
  // The root admits, from its home, with the persisted operation id and the recorded policy.
  const admission = JSON.parse(readFileSync(join(home, ".oats-aweb", "admission-default.json"), "utf8"));
  const admit = call(fx.fake, "id team admit")[0];
  assert.equal(admit.cwd, fx.rootHome);
  assert.deepEqual(admit.args, ["--json", "id", "team", "admit", "--team", TEAM, "--member-key", "did:key:zdev-1", "--alias", "dev-1", "--policy-version", String(POLICY.version), "--policy-digest", POLICY.digest, "--operation-id", admission.operationId, "--certificate-out", join(home, ".oats-aweb", "admission-default.cert"), "--protected-profile", fx.profile]);
  assert.equal(admission.state, "committed");
  assert.equal(admission.team, TEAM);
  // The root keeps its copy of the certificate, 0600, byte for byte.
  const certificate = readFileSync(join(home, ".oats-aweb", "admission-default.cert"), "utf8");
  const copy = join(fx.rootHome, "admissions", `${JSON.parse(certificate).certificate_id}.cert`);
  assert.equal(readFileSync(copy, "utf8"), certificate);
  assert.equal(statSync(copy).mode & 0o777, 0o600);
  assert.equal(admission.certificateId, JSON.parse(certificate).certificate_id);
  // Installed into the new home, then connected with aw service init, unchanged, to the recorded service.url (never show-server).
  assert.deepEqual(call(fx.fake, "id team install-cert")[0].args, ["--json", "id", "team", "install-cert", "--identity-home", identityHome, "--certificate", join(home, ".oats-aweb", "admission-default.cert"), "--registry", "https://registry.acme.example"]);
  assert.deepEqual(call(fx.fake, "service init")[0].args, ["service", "init", "--identity-home", identityHome, "--service", SERVICE_URL, "--team", TEAM]);
  assert.ok(existsSync(join(identityHome, "workspace.yaml")));
});

test("acceptance 6: a grandchild: a chained spawner issues, the root admits, and the parent is the spawner", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  const before = fx.fake.calls().length;
  const r = fx.spawn("dev-2", { spawner: "dev-1" });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.deepEqual(r.doc.meta.identity.attribution, { mode: "human", human: { id: HUMAN, label: "Juan Pérez" }, parent: { id: "did:key:zdev-1" } });
  const calls = fx.fake.calls().slice(before);
  const by = (words) => calls.find((c) => commandArgs(c.args).join(" ").startsWith(words));
  assert.equal(by("id child invite").identityHome, join(fx.homeOf("dev-1"), ".aw"));
  assert.equal(by("id team admit").cwd, fx.rootHome);
  assert.deepEqual(fx.fake.issued().at(-1), { issuer: "did:key:zdev-1", child: "did:key:zdev-2" });
});

test("acceptance 7: wrong subtree: a spawner whose chain runs outside the root refuses E_ATTRIBUTION_ISSUER_OUTSIDE_ROOT before any effect", async (t) => {
  const fx = attributionFixture(t);
  const { writeIdentity } = await import("./helpers/fake-aw-protected.mjs");
  writeIdentity(join(fx.homeOf("lead-1"), ".aw"), { chain: [{ id: "did:aw:otherhuman", kind: "human", parent: { kind: "namespace", id: "acme.example" } }, { id: "did:key:zlead-1", kind: "agent", parent: { kind: "identity", id: "did:aw:otherhuman" } }] });
  const r = fx.spawn("dev-3", { spawner: "lead-1" });
  assert.equal(r.status, 1);
  assert.match(r.doc.warning, /^oats-aweb: E_ATTRIBUTION_ISSUER_OUTSIDE_ROOT/);
  assert.ok(!verbs(fx.fake).includes("id create"), "no key is created");
  assert.ok(!existsSync(join(fx.homeOf("dev-3"), ".aw")));
});

test("a genuinely chainless spawner: no exchange; the child is chainless, still admitted by the root, with attribution-spawner-unchained", async (t) => {
  const fx = attributionFixture(t);
  const { writeIdentity } = await import("./helpers/fake-aw-protected.mjs");
  writeIdentity(join(fx.homeOf("old-1"), ".aw"));
  const r = fx.spawn("dev-4", { spawner: "old-1" });
  assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
  assert.deepEqual(r.doc.meta.identity.attribution, { mode: "unknown", human: null, parent: null });
  assert.match(r.doc.warning, /attribution-spawner-unchained/);
  assert.ok(!verbs(fx.fake).includes("id child invite"));
  assert.equal(call(fx.fake, "id team admit")[0].cwd, fx.rootHome);
});
