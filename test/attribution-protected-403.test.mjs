// A deployment that never opted in, on a team aweb has protected (spec
// v4.3.22 C-8; acceptance 9's protected-team row, 23's refusal text): the
// member-invite mint gets HTTP 403 protected_admission_required, and the spawn
// refuses E_PROTECTED_ADMISSION_REQUIRED with its whole fix, never retrying
// the invite and never reminting. Readiness is unchanged. Any other 403 maps
// as it does today.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "./helpers/delivery-fixture.mjs";
import { PROTECTED_ADMISSION_REQUIRED } from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";
import { parseEndorseArgs } from "../oats-package/capabilities/oats-aweb/lib/endorse-root.mjs";

const inits = (fx) => fx.fake.readCalls().filter((c) => c.args[0] === "init");
/** C-2's whole command (v4.3.27): setup refuses E_SETUP_ARGUMENT without --protected-profile and --service. */
const FIX = "oats aweb setup --endorse-root --new-root --name <alias> --human <did:aw> --protected-profile <abs> --service <url>";

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

/** A spawn that joins alpha, whose accept-invite aw answers with `error` (a 403 envelope) and
 *  exit 1; every other aw call goes to the fake. Returns the answer and the accept calls made. */
function joinedAcceptRefused(t, error) {
  const fx = fixture(t, { delivery: "channel", settings: { join: "alpha" } });
  const wrapper = join(fx.ws, "wrapper"), log = join(fx.ws, "accepts.log");
  mkdirSync(wrapper);
  const native = join(fx.fake.path.split(":")[0], "aw");
  writeFileSync(join(wrapper, "aw"), `#!${process.execPath}
const a = process.argv.slice(2);
if (a.includes("accept-invite")) { require("node:fs").appendFileSync(${JSON.stringify(log)}, "accept\\n"); console.log(${JSON.stringify(JSON.stringify({ error }))}); console.error("Error: refused"); process.exit(1); }
const r = require("node:child_process").spawnSync(${JSON.stringify(native)}, a, { stdio: "inherit" });
process.exit(r.status ?? 1);
`, { mode: 0o700 });
  const r = fx.hook("spawn", { PATH: `${wrapper}:${fx.fake.path}` });
  const accepts = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").length : 0;
  return { r, accepts };
}

for (const spelling of ["reason", "detail"]) {
  test(`C-8: a joined team's member-invite accept answered 403 with ${spelling} protected_admission_required refuses the spawn E_PROTECTED_ADMISSION_REQUIRED with its fix, once, and hands the primary identity back for compensation`, (t) => {
    const { r, accepts } = joinedAcceptRefused(t, { code: "http_error", http_status: 403, [spelling]: "protected_admission_required" });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const w = String(r.doc?.warning || "");
    assert.ok(w.startsWith("oats-aweb: E_PROTECTED_ADMISSION_REQUIRED"), w);
    assert.ok(w.includes(FIX), w);
    assert.equal(accepts, 1, "never retried");
    assert.equal(typeof r.doc.meta?.alias, "string", JSON.stringify(r.doc.meta));
  });
}

test("C-8: a joined team's accept answered another 403 maps as it does today, never E_PROTECTED_ADMISSION_REQUIRED", (t) => {
  const { r } = joinedAcceptRefused(t, { code: "http_error", http_status: 403, reason: "forbidden" });
  assert.equal(r.status, 1);
  assert.ok(!(r.stdout + r.stderr).includes("E_PROTECTED_ADMISSION_REQUIRED"), r.stdout + r.stderr);
  assert.ok(String(r.doc?.warning || "").startsWith("oats-aweb: identity minting failed"), String(r.doc?.warning));
});

/** The setup command a refusal's fix names, with each placeholder filled, as argv after `oats aweb setup`. */
function filledSetupCommand(text) {
  const at = text.indexOf("oats aweb setup --endorse-root");
  assert.ok(at >= 0, text);
  const words = text.slice(at).split(/[`(;,]| \(/)[0].trim().split(/\s+/);
  assert.deepEqual(words.slice(0, 3), ["oats", "aweb", "setup"]);
  const FILL = { "<alias>": "root-1", "<did:aw>": "did:aw:human1", "<abs>": "/srv/aweb/protected-profile.json", "<url>": "https://aweb.acme.example/api" };
  const left = words.filter((w) => /^<.*>$/.test(w) && !(w in FILL));
  assert.deepEqual(left, [], `placeholders no one fills: ${left}`);
  return words.slice(3).map((w) => FILL[w] ?? w);
}

test("C-8 (v4.3.27): the setup command E_PROTECTED_ADMISSION_REQUIRED names, its placeholders filled, is one setup accepts", () => {
  const argv = filledSetupCommand(PROTECTED_ADMISSION_REQUIRED.message);
  const parsed = parseEndorseArgs(argv);
  assert.equal(parsed.newRoot, true);
  assert.equal(parsed.name, "root-1");
  assert.equal(parsed.human, "did:aw:human1");
  assert.equal(parsed.profile, "/srv/aweb/protected-profile.json");
  assert.equal(parsed.service, "https://aweb.acme.example/api");
});
