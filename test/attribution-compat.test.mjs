// Acceptance test 9 (spec human-ids-acxy7 v4.3.7), first half: with no
// settings.oats.aweb.attribution, on a team aweb hasn't protected, spawn, start,
// restart, readiness, setup --check-only and retire are byte-identical to
// v1.42.1, the release this change builds on, aw calls included.
// fixtures/compat-1.42.1.json was recorded from the v1.42.1 tree itself
// (scripts/record-compat-fixture.mjs). The second half, a protected team's
// 403, is in test/attribution-protected-403.test.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COMPAT_JOURNEYS, compatTranscript } from "./helpers/compat-journey.mjs";

const RECORDED = JSON.parse(readFileSync(new URL("./fixtures/compat-1.42.1.json", import.meta.url), "utf8"));

test("the fixture covers every compatibility journey", () => {
  assert.deepEqual(RECORDED.map((r) => r.journey), COMPAT_JOURNEYS);
});

for (const { journey, transcript } of RECORDED) {
  test(`compatibility: no setting, ${journey.delivery} delivery on ${journey.runtime}${journey.settings.join ? " with a joined team" : ""}${journey.spawner ? " with OATS_SPAWNER_HOME" : ""}: spawn, start, restart, readiness, check-only and retire are v1.42.1's`, (t) => {
    assert.deepEqual(compatTranscript(t, journey), transcript);
  });
}
