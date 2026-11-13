// Home readiness on an opted-in deployment (spec v4.3.18 C-5): only with the
// captured setting, the items attribution-revoked, attribution-unverified,
// attribution-spawner-unchained, admission-leaked and, while the pinned aw
// lacks team.agent.remove, admission-removal-unavailable; and the A5 scan's
// findings (acceptance 15's readiness half).
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ROOT_ID, attributionFixture, capabilityWith } from "./helpers/attribution-fixture.mjs";
import { writeIdentity } from "./helpers/fake-aw-protected.mjs";

const ITEMS = ["attribution-revoked", "attribution-unverified", "attribution-spawner-unchained", "admission-leaked", "admission-removal-unavailable", "protected-key-reachable"];
const codes = (result) => (result.warnings || []).map((w) => w.code).filter((c) => ITEMS.includes(c));
const item = (result, code) => (result.warnings || []).find((w) => w.code === code);

test("C-5: an attributed home that verifies has none of the attribution items", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  assert.deepEqual(codes(fx.readiness("dev-1")), []);
});

test("C-5: a home whose chain is revoked warns attribution-revoked", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  fx.fake.revoke(ROOT_ID);
  const w = item(fx.readiness("dev-1"), "attribution-revoked");
  assert.ok(w && w.message.includes("Human attribution: revocation"), JSON.stringify(w));
});

test("C-5: a home whose chain can't be verified warns attribution-unverified", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  fx.fake.unavailable();
  assert.deepEqual(codes(fx.readiness("dev-1")), ["attribution-unverified"]);
});

test("C-5: a home with no chain warns attribution-spawner-unchained: the children it spawns carry none", (t) => {
  const fx = attributionFixture(t);
  writeIdentity(join(fx.homeOf("old-1"), ".aw"));
  assert.equal(fx.spawn("dev-4", { spawner: "old-1" }).status, 0);
  const w = item(fx.readiness("dev-4"), "attribution-spawner-unchained");
  assert.ok(w && w.message.includes("respawn"), JSON.stringify(w));
});

test("C-5: a home holding an admission whose outcome is unknown warns admission-leaked, naming the operation and --reconcile-admissions' check-only read", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  const file = join(fx.homeOf("dev-1"), ".oats-aweb", "admission-ops.json");
  writeFileSync(file, JSON.stringify({ team: "ops:acme.example", label: "ops", alias: "dev-1", operationId: "3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b", state: "unknown" }));
  const w = item(fx.readiness("dev-1"), "admission-leaked");
  assert.ok(w && w.message.includes("3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b") && w.message.includes("ops:acme.example"), JSON.stringify(w));
});

test("C-5: while the pinned aw lacks team.agent.remove, readiness warns admission-removal-unavailable: retiring an instance frees no admission slot", (t) => {
  const fx = attributionFixture(t, { capability: capabilityWith(t, { REMOVE_SERVED: false }) });
  assert.equal(fx.spawn("dev-1").status, 0);
  const w = item(fx.readiness("dev-1"), "admission-removal-unavailable");
  assert.ok(w && w.message.includes("retiring an instance frees no admission slot"), JSON.stringify(w));
});

test("acceptance 15: a reachable protected key warns protected-key-reachable at readiness, without key material, and leaves the key in place", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  const dir = join(fx.ws, ".awid", "team-keys"), key = join(dir, "acme.example");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(key, "-----BEGIN PRIVATE KEY-----\nkey-shaped\n-----END PRIVATE KEY-----\n", { mode: 0o600 });
  const result = fx.readiness("dev-1");
  const w = item(result, "protected-key-reachable");
  assert.ok(w && w.message.includes(key) && w.message.includes("package 8"), JSON.stringify(result.warnings));
  assert.ok(!JSON.stringify(result).includes("PRIVATE KEY"));
  assert.ok(readFileSync(key, "utf8").includes("key-shaped"));
});

test("C-5: without the captured setting, none of these items appear", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  fx.fake.revoke(ROOT_ID);
  const { attribution, ...captured } = fx.settings;
  assert.deepEqual(codes(fx.readiness("dev-1", { captured })), []);
});
