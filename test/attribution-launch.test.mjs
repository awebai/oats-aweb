// Start and restart of an attributed home (spec v4.3.10 C-4) and revocation
// (C-3c), with acceptance tests 10 and 16.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HUMAN, ROOT_ID, attributionFixture, verbs } from "./helpers/attribution-fixture.mjs";

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

test("acceptance 16: after the root is revoked, a new spawn refuses E_ATTRIBUTION_REVOKED, with its first step, no working path and the README, within 300 characters", (t) => {
  const fx = attributionFixture(t);
  fx.fake.revoke(ROOT_ID);
  const r = fx.spawn("dev-1");
  assert.equal(r.status, 1);
  const text = segments(r)[0].replace(/^oats-aweb: /, "");
  assert.match(text, /^E_ATTRIBUTION_REVOKED: /);
  assert.ok(text.length <= 300, `${text.length}: ${text}`);
  assert.ok(text.includes("remove settings.oats.aweb.attribution"), text);
  assert.ok(text.includes("no working path exists yet"), text);
  assert.ok(text.endsWith('(README, "Human attribution: revocation")'), text);
  assert.ok(!/--new-root|bind-root/.test(text.split("no working path")[1] || ""), "names no other fix after saying none works");
  assert.ok(!verbs(fx.fake).includes("id create"), "before any effect");
});

test("acceptance 16: the README's revocation section names the whole path, says no working path exists while binding isn't served, and that re-endorsing the same root is outside v1", () => {
  const text = readFileSync(README, "utf8");
  const start = text.indexOf("## Human attribution: revocation");
  assert.ok(start >= 0, "the section exists");
  const end = text.indexOf("\n## ", start + 1);
  const section = text.slice(start, end < 0 ? undefined : end).replace(/\s+/g, " "); // as read, not as wrapped
  for (const step of ["settings.oats.aweb.attribution", "oats aweb setup --endorse-root --new-root", "bind", "rerun"]) assert.ok(section.includes(step), step);
  assert.ok(section.includes("a new root needs the protected service's operator to bind it, and that step isn't available yet, so this deployment can't spawn into its protected teams until it is"));
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
