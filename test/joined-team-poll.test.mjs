import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./helpers/delivery-fixture.mjs";
import { joinedTeamsPolled } from "../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs";

const CAPABILITY = new URL("../oats-package/capabilities/oats-aweb/", import.meta.url).pathname;
const warningCodes = (result) => (result.warnings || []).map((w) => w.code);

test("only a Claude channel home polls", () => {
  assert.equal(joinedTeamsPolled({ delivery: "channel", runtime: "claude" }), true);
  for (const home of [{ delivery: "channel", runtime: "pi" }, { delivery: "channel", runtime: "codex" }, { delivery: "session", runtime: "claude" }]) assert.equal(joinedTeamsPolled(home), false, JSON.stringify(home));
});

test("a Claude home stays off the broker and says it polls", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings: { join: "alpha" } });
  const { meta } = fx.spawn();
  assert.equal(fx.registered(), undefined);
  assert.equal(meta.wakeJoined, false);
  assert.deepEqual(meta.joinedTeams.map(({ receive, expectedPoll }) => ({ receive, expectedPoll })), [{ receive: "poll", expectedPoll: true }]);
});

test("OATS_YOLO changes nothing: a --yolo Claude home polls too", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings: { join: "alpha" } });
  const r = fx.hook("spawn", { OATS_YOLO: "1" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fx.registered(), undefined);
  assert.equal(r.doc.meta.joinedTeams[0].expectedPoll, true);
});

/** A home already on the broker, as a start before this version left it. */
function brokered(t, settings) {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings });
  const r = fx.hook("spawn", { OATS_RUNTIME: "pi" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fx.registered());
  return { fx, meta: r.doc.meta };
}

test("the start after an upgrade takes a registered Claude home off the broker", (t) => {
  const { fx, meta } = brokered(t, { join: "alpha" });
  const r = fx.launch(meta, "claude");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fx.registered(), undefined);
  assert.equal(r.doc.meta.wakeJoined, false);
  assert.equal(r.doc.meta.joinedTeams[0].expectedPoll, true);
});

test("a later start on pi puts the teams back and clears the expected poll", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings: { join: "alpha" } });
  const { meta } = fx.spawn();
  const r = fx.launch(meta, "pi");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fx.registered().receive_identities.map((x) => x.label), ["alpha"]);
  assert.equal(r.doc.meta.joinedTeams[0].receive, "native");
  assert.equal("expectedPoll" in r.doc.meta.joinedTeams[0], false);
});

for (const source of ["live", "unknown"]) test(`a local renew=launch home leaves the broker at a start (teams ${source})`, (t) => {
  const { fx, meta } = brokered(t, { join: "alpha", identity: { mode: "local", renew: "launch" } });
  const r = fx.launch(meta, "claude", { extra: { OATS_TEAMS_SOURCE: source } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fx.registered(), undefined);
  assert.equal(r.doc.meta.joinedTeams[0].receive, "poll");
  assert.equal(r.doc.meta.joinedTeams[0].expectedPoll, true);
  fx.record(r.doc.meta, "claude");
  const result = fx.readiness();
  assert.ok(warningCodes(result).includes("joined-team-polled"), JSON.stringify(result));
  assert.equal(warningCodes(result).includes("joined-team-poll-only"), false);
});

for (const runtime of ["pi", "codex"]) test(`a ${runtime} home is unchanged: its joined teams stay on the broker`, (t) => {
  const fx = fixture(t, { delivery: "channel", runtime, settings: { join: "alpha" } });
  const { meta } = fx.spawn();
  assert.ok(fx.registered().receive_identities.some((r) => r.label === "alpha"));
  assert.equal(meta.joinedTeams[0].receive, "native");
});

test("a Claude delivery: session home is unchanged", (t) => {
  const fx = fixture(t, { delivery: "session", runtime: "claude", settings: { join: "alpha" } });
  const { meta } = fx.spawn();
  assert.ok(fx.registered().receive_identities.some((r) => r.label === "alpha"));
  assert.equal(meta.joinedTeams[0].receive, "native");
});

test("readiness treats a poll by design as ready, with no broker to run", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings: { join: "alpha" }, daemon: false });
  fx.record(fx.spawn().meta, "claude");
  const result = fx.readiness();
  assert.equal(result.status, "ready", JSON.stringify(result));
  assert.deepEqual(result.problems, []);
  const polled = result.warnings.find((w) => w.code === "joined-team-polled");
  assert.match(polled.message, /joined team alpha is read at task boundaries on this Claude home, as expected/);
  assert.match(polled.message, /An idle session doesn't read its mail until something else wakes it/);
  assert.equal(warningCodes(result).includes("joined-team-poll-only"), false);
  assert.equal(/install|start the/i.test(polled.message), false, "it must not send the operator to the broker");
});

test("a stale expected poll doesn't excuse a home that now needs the broker", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings: { join: "alpha" }, daemon: false });
  const { meta } = fx.spawn();
  fx.record(meta, "codex");
  const result = fx.readiness();
  assert.notEqual(result.status, "ready", JSON.stringify(result));
  assert.equal(warningCodes(result).includes("joined-team-polled"), false);
});

test("the skill tells nobody to start the broker for a poll", () => {
  const skill = readFileSync(join(CAPABILITY, "skills", "oats-aweb", "SKILL.md"), "utf8");
  assert.match(skill, /\| `joined-team-polled` \|.*nobody: expected\. Don't install or start the broker for this \|/);
  assert.match(skill.replace(/\s+/g, " "), /Nothing wakes an idle Claude home for joined-team mail\. .* use one only where `oats session inspect --json` shows `wakeHold: on-claims`\./);
});
