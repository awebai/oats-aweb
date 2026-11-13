// A deployment that never opted in, on a team aweb has protected (spec
// v4.3.22 C-8; acceptance 9's protected-team row, 23's refusal text): the
// member-invite mint gets HTTP 403 protected_admission_required, and the spawn
// refuses E_PROTECTED_ADMISSION_REQUIRED with its whole fix, never retrying
// the invite and never reminting. Readiness is unchanged. Any other 403 maps
// as it does today.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "./helpers/delivery-fixture.mjs";

const inits = (fx) => fx.fake.readCalls().filter((c) => c.args[0] === "init");
const FIX = "oats aweb setup --endorse-root --new-root --name <alias> --human <your human did:aw>";

for (const spelling of ["reason", "detail"]) {
  test(`C-8: a 403 whose ${spelling} is protected_admission_required refuses E_PROTECTED_ADMISSION_REQUIRED: why, the whole fix, the docs, and the human-ID step, in order, within 300 characters`, (t) => {
    const fx = fixture(t, { delivery: "channel" });
    const r = fx.hook("spawn", { FAKE_JOIN_FROM_PROTECTED: spelling });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const w = String(r.doc?.warning || "").split(" | ")[0];
    assert.ok(w.startsWith("oats-aweb: E_PROTECTED_ADMISSION_REQUIRED"), w);
    assert.ok(w.length <= "oats-aweb: ".length + 300, `${w.length} characters`);
    const at = (s) => { const i = w.indexOf(s); assert.ok(i >= 0, `missing: ${s}\n${w}`); return i; };
    assert.ok(at("this team now admits agents only through an endorsed root") < at(FIX) && at(FIX) < at('README, "Human attribution"') && at('README, "Human attribution"') < at("passkey enrollment"), w);
  });
}

test("C-8: the provider never retries the invite and never remints, and nothing is left for retire to settle", (t) => {
  const fx = fixture(t, { delivery: "channel" });
  const r = fx.hook("spawn", { FAKE_JOIN_FROM_PROTECTED: "reason" });
  assert.equal(r.status, 1);
  assert.equal(inits(fx).length, 1, "one mint");
  assert.equal(r.doc.meta, undefined, "no identity registered");
  assert.ok(!existsSync(join(fx.home, ".oats-aweb", "pending-mint.json")), "the mint's intent is dropped: the server refused it");
});

for (const spelling of ["other", "none"]) {
  test(`C-8: a 403 with ${spelling === "other" ? "another code" : "no code"} maps as it does today, never E_PROTECTED_ADMISSION_REQUIRED`, (t) => {
    const fx = fixture(t, { delivery: "channel" });
    const r = fx.hook("spawn", { FAKE_JOIN_FROM_PROTECTED: spelling });
    assert.notEqual(r.status, 0);
    assert.ok(!(r.stdout + r.stderr).includes("E_PROTECTED_ADMISSION_REQUIRED"), r.stdout + r.stderr);
  });
}

test("C-8: readiness is unchanged: it reports nothing for a protected team", (t) => {
  const fx = fixture(t, { delivery: "channel" });
  fx.hook("spawn", { FAKE_JOIN_FROM_PROTECTED: "reason" });
  const result = fx.readiness();
  assert.ok(!JSON.stringify(result).includes("protected"), JSON.stringify(result));
});
