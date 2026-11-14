// An existing home's explicit join on an opted-in deployment (acceptance 18 and 22, C-4): the
// kernel hands a home's command the settings it captured at spawn, so the join reads the
// deployment's live setting (`oats inspect --soul`) for what the refresh changes, the teams and
// the endorsement's policy, and nothing else. Everything else must equal the captured setting,
// or the join refuses before any aw call: the home's retire still acts with the captured one.
// Every command below runs with OATS_SETTINGS left as the home captured it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { OPS, TEAM, attributionFixture, commandArgs } from "./helpers/attribution-fixture.mjs";
import { POLICY } from "./helpers/fake-aw-protected.mjs";

const record = (fx, label) => JSON.parse(readFileSync(join(fx.homeOf("dev-1"), ".oats-aweb", `admission-${label}.json`), "utf8"));
const admits = (calls) => calls.filter((c) => commandArgs(c.args).join(" ").startsWith("id team admit"));
const flagOf = (call, name) => { const a = commandArgs(call.args); return a[a.indexOf(name) + 1]; };
/** The aw calls after `before`, but the floor's local `aw version`, which every command runs first. */
const awCallsSince = (fx, before) => fx.fake.calls().slice(before).filter((c) => c.args.join(" ") !== "version");
const NEW_POLICY = { version: POLICY.version + 1, digest: `sha256:${"d".repeat(64)}` };
/** The fixture's setting, with `attribution` changed by `edit`. */
const withAttribution = (fx, edit) => { const attribution = structuredClone(fx.settings.attribution); edit(attribution); return { ...fx.settings, attribution }; };
/** dev-1 spawned before ops was mapped: its captured setting lists only the default team. */
function capturedBeforeOps(t) {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  const captured = withAttribution(fx, (a) => { a.teams = [TEAM]; });
  return { fx, captured };
}

test("acceptance 18, 22: a home captured before a team was mapped joins it once the refresh adds it, with its captured OATS_SETTINGS", (t) => {
  const { fx, captured } = capturedBeforeOps(t);
  fx.setLive(captured);
  const before = fx.command("dev-1", "join", ["--labels", "ops", "--json"], { live: captured });
  assert.equal(before.status, 1, "before the refresh, ops isn't listed");
  assert.ok(before.stderr.includes("rerun `oats aweb setup --endorse-root` to add it"), before.stderr);
  fx.setLive(fx.settings); // the refresh wrote teams [backend, ops]
  const r = fx.command("dev-1", "join", ["--labels", "ops", "--json"], { live: captured });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(record(fx, "ops").state, "committed");
  assert.equal(record(fx, "ops").team, OPS);
});

test("acceptance 18, 22: `join --plan` reads the refreshed teams too", (t) => {
  const { fx, captured } = capturedBeforeOps(t);
  const r = fx.command("dev-1", "join", ["--labels", "ops", "--plan", "--json"], { live: captured });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("acceptance 22: after a policy refresh, a home's join admits under the new policy, not its captured one", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  const captured = fx.settings;
  fx.fake.setService({ policy: { ...POLICY, ...NEW_POLICY } });
  fx.setLive(withAttribution(fx, (a) => { a.endorsement.policy = NEW_POLICY; }));
  const before = fx.fake.calls().length;
  const r = fx.command("dev-1", "join", ["--labels", "ops", "--json"], { live: captured });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [admit] = admits(fx.fake.calls().slice(before));
  assert.equal(flagOf(admit, "--policy-version"), String(NEW_POLICY.version));
  assert.equal(flagOf(admit, "--policy-digest"), NEW_POLICY.digest);
});

test("C-3b: a pending join's resend after a policy refresh sends its recorded policy and operation, never the new one", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  const captured = fx.settings;
  // The admit commits, and its answer is lost: the record stays unknown, with the old policy.
  fx.fake.setService({ admit: { code: "receipt_unavailable", charge: true } });
  assert.equal(fx.command("dev-1", "join", ["--labels", "ops"], { live: captured }).status, 1);
  const pending = record(fx, "ops");
  assert.equal(pending.state, "unknown");
  fx.fake.setService({ admit: undefined, policy: { ...POLICY, ...NEW_POLICY } });
  fx.setLive(withAttribution(fx, (a) => { a.endorsement.policy = NEW_POLICY; }));
  const before = fx.fake.calls().length;
  const r = fx.command("dev-1", "join", ["--labels", "ops", "--json"], { live: captured });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const sent = admits(fx.fake.calls().slice(before));
  assert.ok(sent.length >= 1);
  for (const admit of sent) {
    assert.equal(flagOf(admit, "--operation-id"), pending.operationId);
    assert.equal(flagOf(admit, "--policy-version"), String(POLICY.version));
    assert.equal(flagOf(admit, "--policy-digest"), POLICY.digest);
  }
  assert.equal(record(fx, "ops").state, "committed");
});

const DIVERGED = [
  ["attribution.root.id", (a) => { a.root.id = "did:aw:zAnotherRoot"; }],
  ["attribution.service.url", (a) => { a.service.url = "https://other.acme.example/api"; }],
  ["attribution.service.profileDigest", (a) => { a.service.profileDigest = `sha256:${"e".repeat(64)}`; }],
];
for (const [field, edit] of DIVERGED) {
  for (const plan of [false, true]) {
    test(`C-1, acceptance 18: a live ${field} that differs from the captured one refuses ${plan ? "`join --plan`" : "the join"} before any aw call: respawn this home`, (t) => {
      const fx = attributionFixture(t);
      assert.equal(fx.spawn("dev-1").status, 0);
      fx.setLive(withAttribution(fx, edit));
      const before = fx.fake.calls().length;
      const r = fx.command("dev-1", "join", ["--labels", "ops", ...(plan ? ["--plan"] : []), "--json"], { live: fx.settings });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.ok(r.stderr.includes("E_ATTRIBUTION_SETTING") || JSON.stringify(r.doc).includes("E_ATTRIBUTION_SETTING"), r.stdout + r.stderr);
      assert.ok(r.stderr.includes(field), r.stderr);
      assert.ok(r.stderr.includes("respawn this home to use the current setting"), r.stderr);
      assert.deepEqual(awCallsSince(fx, before), [], "no aw call but the floor's version read");
    });
  }
}

test("C-1: a live setting with no attribution refuses an attributed home's join before any aw call: respawn this home", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  const { attribution, ...live } = fx.settings;
  fx.setLive(live);
  const before = fx.fake.calls().length;
  const r = fx.command("dev-1", "join", ["--labels", "ops", "--json"], { live: fx.settings });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stderr.includes("respawn this home to use the current setting"), r.stderr);
  assert.deepEqual(awCallsSince(fx, before), []);
});

test("C-1: an unreadable live setting refuses an attributed home's join before any aw call, naming the inspect to repair", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  const before = fx.fake.calls().length;
  const r = fx.command("dev-1", "join", ["--labels", "ops", "--json"], { live: fx.settings, extra: { FAKE_KERNEL_INSPECT: "fail" } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stderr.includes("E_ATTRIBUTION_SETTING") && r.stderr.includes("oats inspect"), r.stderr);
  assert.deepEqual(awCallsSince(fx, before), []);
});
