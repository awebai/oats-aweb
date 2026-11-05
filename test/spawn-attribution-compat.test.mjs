// Spawn attribution (acmj.21) is inert without a bound human: a deployment
// whose attribution is absent or `none` spawns, mints and wakes exactly as it
// did before attribution existed. The aw calls are pinned per delivery path,
// the meta carries no attribution, no warning or problem mentions it, and an
// explicit `none` is indistinguishable from an absent setting.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fixture } from "./helpers/delivery-fixture.mjs";
import { AW_MIN } from "../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs";
import { readFileSync } from "node:fs";
import { compatTranscript } from "./helpers/compat-journey.mjs";

const ATTRIBUTION_TRACE = /attribution|identity chain|chainless|steward|bound human/i;

test("the provider's aw floor stays 1.36.33: only mode human needs aw 1.36.53", () => {
  assert.equal(AW_MIN, "1.36.33");
});

/** One journey, as the kernel drives it: spawn, record, start, readiness. */
function journey(t, { delivery, runtime, settings }) {
  const fx = fixture(t, { delivery, runtime, settings });
  const spawned = fx.hook("spawn");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  fx.record(spawned.doc.meta, runtime);
  const launched = fx.launch(spawned.doc.meta, runtime);
  assert.equal(launched.status, 0, launched.stdout + launched.stderr);
  const readiness = fx.readiness();
  const calls = fx.fake.readCalls().map((c) => c.args.join(" "));
  // Each journey has its own temp deployment; replace it, the minted
  // workspace ids and the start's timestamps so two journeys compare.
  const comparable = JSON.stringify({ spawn: spawned.doc, spawnErr: spawned.stderr, launch: launched.doc, launchErr: launched.stderr, readiness, calls })
    .split(fx.ws).join("<deployment>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<time>");
  return { fx, spawned, launched, readiness, calls, comparable };
}

for (const [delivery, runtime, wake] of [["channel", "claude", "wake deregister"], ["channel", "codex", "wake register"], ["session", "claude", "wake register"], ["session", "codex", "wake register"]]) {
  test(`compatibility, ${delivery} delivery on ${runtime}: no bound human spawns, mints and wakes as before attribution`, (t) => {
    const absent = journey(t, { delivery, runtime, settings: {} });
    const none = journey(t, { delivery, runtime, settings: { attribution: "none" } });
    for (const run of [absent, none]) {
      const { fx, spawned, launched, readiness, calls } = run;
      // The mint is the one --join-from init, and the home is delivered by
      // exactly its path; no chain, who or kernel-feature call is made.
      const mint = `init --join-from=${fx.ws} --join-team=legacy:example.test --name=dev-1 --json --do-not-touch-agents-md`;
      const registration = `${wake} --home ${fx.home}` + (wake === "wake register" ? ` --identity-home ${fx.home}/.aw --delivery session` : "");
      assert.deepEqual(calls.filter((c) => !c.startsWith("version") && !c.startsWith("wake status")), wake === "wake register" ? [mint, registration, registration] : [mint, registration]);
      assert.equal(calls.some((c) => /^(who|id )/.test(c)), false);
      // The journey runs on aw 1.36.33, the provider's floor.
      assert.equal(fx.fake.readCalls().some((c) => c.args[0] === "version"), true);
      assert.match(spawnSync("aw", ["version"], { env: { PATH: fx.fake.path }, encoding: "utf8" }).stdout, /^aw 1\.36\.33 /);
      assert.equal(spawned.doc.meta.identity.attribution, undefined);
      assert.equal(Object.hasOwn(spawned.doc.meta, "chainInstalled"), false);
      assert.equal(Object.hasOwn(launched.doc.meta, "chainInstalled"), false);
      for (const text of [spawned.doc.warning, launched.doc.warning, spawned.stderr, launched.stderr]) assert.doesNotMatch(text || "", ATTRIBUTION_TRACE);
      for (const item of [...readiness.warnings, ...readiness.problems]) assert.doesNotMatch(`${item.code} ${item.message}`, ATTRIBUTION_TRACE);
    }
    assert.equal(none.comparable, absent.comparable, "attribution: none must behave exactly as an absent setting");
  });
}

// The opt-in gate: a deployment without attribution: human, on this release,
// behaves as on 1.38.0. The transcript in fixtures/compat-1.38.0.json was
// recorded by running test/helpers/compat-journey.mjs against the v1.38.0
// tree; spawn, start, restart, readiness, setup --check-only and retire must
// match it, aw calls included.
const COMPAT_1_38_0 = JSON.parse(readFileSync(new URL("./fixtures/compat-1.38.0.json", import.meta.url), "utf8"));
for (const { journey, transcript } of COMPAT_1_38_0) {
  test(`no setting, ${journey.delivery} delivery on ${journey.runtime}${journey.settings.join ? " with a joined team" : ""}${journey.spawner ? " under a spawn-attribution kernel" : ""}: spawn, start, restart, readiness, setup and retire are 1.38.0's`, (t) => {
    assert.deepEqual(compatTranscript(t, journey), transcript);
  });
}
