// Start and restart of an attributed home (spec v4.3.10 C-4) and revocation
// (C-3c), with acceptance tests 10 and 16.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HUMAN, ROOT_ID, attributionFixture, capabilityWith, verbs } from "./helpers/attribution-fixture.mjs";
import { writeIdentity } from "./helpers/fake-aw-protected.mjs";
import { filledSetupCommand } from "./helpers/setup-command.mjs";
import { parseEndorseArgs } from "../oats-package/capabilities/oats-aweb/lib/endorse-root.mjs";

const SETUP_COMMAND = "oats aweb setup --endorse-root --new-root --name <alias> --human <did:aw> --protected-profile <abs> --service <url>";
const README_SECTION = '(README, "Human attribution: revocation")';

const README = fileURLToPath(new URL("../README.md", import.meta.url));
const HUMAN_ATTRIBUTION = { mode: "human", human: { id: HUMAN, label: "Juan Pérez" }, parent: { id: ROOT_ID } };
const UNKNOWN = { mode: "unknown", human: null, parent: null };
/** Only what a start calls: no exchange, no protected call (C-4: start never calls the protected server). */
const PROTECTED = /^id (endorse|team (admit|remove-agent|admission-policy|install-cert)|child|parent)/;
const startCalls = (fx, before) => verbs({ calls: () => fx.fake.calls().slice(before) }).filter((v) => !v.startsWith("version") && !v.startsWith("wake"));
const segments = (r) => (r.doc.warning || "").split(" | ");

test("acceptance 10: captured without attribution, a start is unchanged: no aw who, meta as recorded", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  const { attribution, ...identity } = fx.meta("dev-1").identity;
  fx.record("dev-1", { ...fx.meta("dev-1"), identity });
  const before = fx.fake.calls().length, recorded = fx.meta("dev-1");
  const r = fx.launch("dev-1", { captured: { ...fx.settings, attribution: undefined } });
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.ok(!startCalls(fx, before).includes("who"), startCalls(fx, before).join("\n"));
  assert.deepEqual(r.doc.meta.identity, recorded.identity);
});

test("acceptance 10: captured mode human, a chain that verifies: one aw who, the attribution kept, nothing protected called", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  const before = fx.fake.calls().length;
  const r = fx.launch("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.deepEqual(startCalls(fx, before).filter((v) => v === "who"), ["who"]);
  assert.ok(!startCalls(fx, before).some((v) => PROTECTED.test(v)), startCalls(fx, before).join("\n"));
  assert.deepEqual(r.doc.meta.identity.attribution, HUMAN_ATTRIBUTION);
  assert.ok(!segments(r).some((w) => /attribution-/.test(w)), r.doc.warning);
});

test("acceptance 10 and 16: captured mode human, a revoked chain: the home records unknown with attribution-revoked", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  fx.fake.revoke(ROOT_ID);
  const r = fx.launch("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.deepEqual(r.doc.meta.identity.attribution, UNKNOWN);
  assert.ok(segments(r).some((w) => w.startsWith("oats-aweb: attribution-revoked")), r.doc.warning);
});

test("acceptance 10: captured mode human, registry evidence unavailable: the home records unknown with attribution-unverified", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  fx.fake.unavailable();
  const r = fx.launch("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.deepEqual(r.doc.meta.identity.attribution, UNKNOWN);
  assert.ok(segments(r).some((w) => w.startsWith("oats-aweb: attribution-unverified")), r.doc.warning);
});

test("acceptance 10: captured mode unknown, a start is unchanged: no aw who", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  fx.record("dev-1", { ...fx.meta("dev-1"), identity: { ...fx.meta("dev-1").identity, attribution: UNKNOWN } });
  const before = fx.fake.calls().length;
  const r = fx.launch("dev-1");
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.ok(!startCalls(fx, before).includes("who"));
  assert.deepEqual(r.doc.meta.identity.attribution, UNKNOWN);
});

/** The revocation refusal of a spawn after the root is revoked, from `capability`, checked against the cap. */
function revokedText(t, capability) {
  const fx = attributionFixture(t, capability ? { capability } : {});
  fx.fake.revoke(ROOT_ID);
  const r = fx.spawn("dev-1");
  assert.equal(r.status, 1);
  const text = segments(r)[0].replace(/^oats-aweb: /, "");
  assert.match(text, /^E_ATTRIBUTION_REVOKED: /);
  assert.ok(text.length <= 300, `${text.length}: ${text}`);
  assert.ok(text.includes("remove settings.oats.aweb.attribution"), text);
  assert.ok(text.endsWith('(README, "Human attribution: revocation")'), text);
  assert.ok(!text.includes("…"), `the why is whole, not shortened to fit: ${text}`);
  assert.ok(!verbs(fx.fake).includes("id create"), "before any effect");
  return text;
}

// C-3c: the spawn's 300-character text gives the code, the first step and the README section; the
// section holds the whole path. So the path's order and "outside v1" are read in the section, below.
test("acceptance 16 (C-3c): after the root is revoked, a new spawn refuses E_ATTRIBUTION_REVOKED within 300 characters, giving the first step, then setup's whole command, then the README section that holds the whole path", (t) => {
  const text = revokedText(t);
  const at = (part) => { const i = text.indexOf(part); assert.ok(i >= 0, `${part}: ${text}`); return i; };
  assert.ok(at("remove settings.oats.aweb.attribution") < at(SETUP_COMMAND), "the first step, then the second");
  assert.ok(at(SETUP_COMMAND) < at(README_SECTION), "then the section");
});

test("acceptance 16 (C-3c): the setup command E_ATTRIBUTION_REVOKED names, its placeholders filled, is one setup accepts", (t) => {
  const argv = filledSetupCommand(revokedText(t));
  const parsed = parseEndorseArgs(argv);
  assert.equal(parsed.newRoot, true);
  assert.equal(parsed.name, "root-1");
});

test("acceptance 16: a root that now verifies to another human refuses a new spawn E_ATTRIBUTION_REVOKED before any key, its why whole within 300 characters, with the same fix", (t) => {
  const fx = attributionFixture(t);
  const rootAw = join(fx.rootHome, ".aw");
  const who = JSON.parse(execFileSync("aw", ["--identity-home", rootAw, "who", "--json"], { env: { ...fx.env, PATH: fx.fake.path }, encoding: "utf8" }));
  assert.equal(who.reason, "verified", JSON.stringify(who));
  writeFileSync(join(rootAw, "fake-who.json"), JSON.stringify({ ...who, human_id: "did:aw:zAnotherHuman" }), { mode: 0o600 }); // the root home stays owner-only
  const r = fx.spawn("dev-1");
  assert.equal(r.status, 1);
  const text = segments(r)[0].replace(/^oats-aweb: /, "");
  assert.ok(text.startsWith("E_ATTRIBUTION_REVOKED: the endorsed root verifies to another human now → remove settings.oats.aweb.attribution"), text);
  assert.ok(text.length <= 300 && !text.includes("…"), `${text.length}: ${text}`);
  assert.ok(text.includes(SETUP_COMMAND) && text.endsWith(README_SECTION), text);
  assert.ok(!verbs(fx.fake).includes("id create"), "before any key");
});

test("acceptance 16: a spawn from a genuinely chainless spawner, after the root is revoked, refuses E_ATTRIBUTION_REVOKED too, not the service's refusal", (t) => {
  const fx = attributionFixture(t);
  writeIdentity(join(fx.homeOf("old-1"), ".aw"));
  fx.fake.revoke(ROOT_ID);
  const r = fx.spawn("dev-4", { spawner: "old-1" });
  assert.equal(r.status, 1);
  assert.ok(r.doc.warning.startsWith("oats-aweb: E_ATTRIBUTION_REVOKED"), r.doc.warning);
  assert.ok(!verbs(fx.fake).includes("id create"), "before any key");
});

test("acceptance 16: while the binding act isn't served, the refusal says no working path exists yet and names no other fix", (t) => {
  const text = revokedText(t, capabilityWith(t, { REQUEST_BINDING_SERVED: false }));
  assert.ok(text.includes("no working path exists yet"), text);
  assert.ok(!/--new-root|bind-root|rerun/.test(text), `names no fix that can't work: ${text}`);
});

test("acceptance 16: the README's revocation section names the whole path, says what holds while an aw doesn't serve the binding, and that re-endorsing the same root is outside v1", () => {
  const text = readFileSync(README, "utf8");
  const start = text.indexOf("## Human attribution: revocation");
  assert.ok(start >= 0, "the section exists");
  const end = text.indexOf("\n## ", start + 1);
  const section = text.slice(start, end < 0 ? undefined : end).replace(/\s+/g, " "); // as read, not as wrapped
  const at = (part) => { const i = section.indexOf(part); assert.ok(i >= 0, part); return i; };
  const steps = ["settings.oats.aweb.attribution", SETUP_COMMAND, "bind-root", "rerun"];
  for (let i = 1; i < steps.length; i++) assert.ok(at(steps[i - 1]) < at(steps[i]), `the whole path in order: ${steps[i - 1]}, then ${steps[i]}`);
  assert.ok(section.includes("a new root needs the protected service's operator to bind it, and that step isn't available yet, so this deployment can't spawn into its protected teams until it is"), "the text for an aw that doesn't serve the binding");
  assert.ok(/re-endors\w+ the same root[^.]*outside v1/i.test(section));
  assert.ok(section.includes("restart, or respawn, to clear the name"));
});

test("acceptance 16: membership calls are unchanged after revocation: a start makes no protected call", (t) => {
  const fx = attributionFixture(t);
  assert.equal(fx.spawn("dev-1").status, 0);
  fx.fake.revoke(ROOT_ID);
  const before = fx.fake.calls().length;
  fx.launch("dev-1");
  assert.ok(!startCalls(fx, before).some((v) => PROTECTED.test(v)), startCalls(fx, before).join("\n"));
  assert.ok(readFileSync(join(fx.homeOf("dev-1"), ".oats-aweb", "admission-default.json"), "utf8").includes('"committed"'));
});
