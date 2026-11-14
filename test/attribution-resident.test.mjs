// Residents on an opted-in deployment (spec v4.3.22 C-7): until aweb serves
// certifying a resident through its custody (aweb-acxy.18, the [.5] custody
// pin), `oats aweb resident create` and `resident certify` refuse
// E_SETUP_AW_VERSION, decided from the pinned aw by a constant beside the
// floor. Acceptance test 17 itself is deferred to that pin.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { attributionFixture, capabilityWith } from "./helpers/attribution-fixture.mjs";

const CAPABILITY = fileURLToPath(new URL("../oats-package/capabilities/oats-aweb/", import.meta.url));
const resident = (fx, args, { capability = CAPABILITY, settings = fx.settings } = {}) => {
  const r = spawnSync(process.execPath, [join(capability, "bin", "oats-aweb.mjs"), "resident", ...args, "--json"], { cwd: fx.ws, env: { ...fx.env, OATS_EVENT: "resident", OATS_SETTINGS: JSON.stringify(settings), AWEB_API_KEY: "aw_sk_fixture", AWEB_URL: "https://aweb.acme.example/api" }, encoding: "utf8", timeout: 60000 });
  let doc; try { doc = JSON.parse(r.stdout.trim().split("\n").pop()); } catch { doc = undefined; }
  return { ...r, doc };
};

for (const sub of ["create", "certify"]) {
  test(`C-7: on an opted-in deployment, resident ${sub} refuses E_SETUP_AW_VERSION before any aw call: the pinned aw doesn't support certifying a resident through its custody yet`, (t) => {
    const fx = attributionFixture(t);
    const r = resident(fx, [sub, "reviewer"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(r.doc?.error?.code, "E_SETUP_AW_VERSION", r.stdout);
    assert.ok(r.doc.error.message.includes("the pinned aw doesn't support certifying a resident through its custody yet"), r.doc.error.message);
    assert.ok(r.doc.error.message.includes("aweb-acxy.18"), r.doc.error.message);
    assert.deepEqual(fx.fake.calls(), [], "before any effect");
  });
}

test("C-7: with resident custody served, the refusal is gone (the constant decides, nothing else)", (t) => {
  const fx = attributionFixture(t);
  const r = resident(fx, ["create", "reviewer"], { capability: capabilityWith(t, { RESIDENT_CUSTODY_SERVED: true }) });
  assert.notEqual(r.doc?.error?.code, "E_SETUP_AW_VERSION", r.stdout);
});

test("C-7: on a deployment that never opted in, resident create is unchanged", (t) => {
  const fx = attributionFixture(t, { attribution: false });
  const r = resident(fx, ["create", "reviewer"], { settings: { root: fx.ws } });
  assert.notEqual(r.doc?.error?.code, "E_SETUP_AW_VERSION", r.stdout);
});

test("C-7: resident certify without the setting refuses as an argument error: there is nothing to certify for", (t) => {
  const fx = attributionFixture(t, { attribution: false });
  const r = resident(fx, ["certify", "reviewer"], { settings: { root: fx.ws } });
  assert.equal(r.status, 2, r.stdout);
  assert.equal(r.doc?.error?.code, "E_RESIDENT_ARGUMENT");
});
