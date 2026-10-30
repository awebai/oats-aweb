import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./helpers/delivery-fixture.mjs";
import { joinedTeamsPolled } from "../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs";

const CAPABILITY = new URL("../oats-package/capabilities/oats-aweb/", import.meta.url).pathname;
const warningCodes = (result) => (result.warnings || []).map((w) => w.code);

test("only a Claude channel home polls, and only a known --yolo keeps the broker", () => {
  assert.equal(joinedTeamsPolled({ delivery: "channel", runtime: "claude", yolo: false }), true);
  assert.equal(joinedTeamsPolled({ delivery: "channel", runtime: "claude" }), true, "unknown counts as not");
  assert.equal(joinedTeamsPolled({ delivery: "channel", runtime: "claude", yolo: true }), false);
  for (const home of [{ delivery: "channel", runtime: "pi" }, { delivery: "channel", runtime: "codex" }, { delivery: "session", runtime: "claude" }]) assert.equal(joinedTeamsPolled(home), false, JSON.stringify(home));
});

test("a Claude home spawned without OATS_YOLO stays off the broker and says it polls", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings: { join: "alpha" } });
  const { meta } = fx.spawn();
  assert.equal(fx.registered(), undefined);
  assert.equal(meta.wakeJoined, false);
  assert.deepEqual(meta.joinedTeams.map(({ receive, expectedPoll }) => ({ receive, expectedPoll })), [{ receive: "poll", expectedPoll: true }]);
});

for (const value of ["0", "true", ""]) test(`OATS_YOLO=${JSON.stringify(value)} is not a known --yolo`, (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings: { join: "alpha" } });
  assert.equal(fx.hook("spawn", { OATS_YOLO: value }).status, 0);
  assert.equal(fx.registered(), undefined);
});

test("a --yolo Claude home keeps its joined teams on the broker and records no expected poll", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings: { join: "alpha" }, yolo: true });
  const { meta } = fx.spawn();
  assert.deepEqual(fx.registered().receive_identities.map((r) => r.label), ["alpha"]);
  assert.equal(meta.joinedTeams[0].receive, "native");
  assert.equal("expectedPoll" in meta.joinedTeams[0], false);
});

test("the start after an upgrade takes a registered Claude home off the broker", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings: { join: "alpha" }, yolo: true });
  const { meta } = fx.spawn();
  assert.ok(fx.registered());
  const r = fx.launch(meta, "claude", { extra: { OATS_YOLO: "" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fx.registered(), undefined);
  assert.equal(r.doc.meta.wakeJoined, false);
  assert.equal(r.doc.meta.joinedTeams[0].expectedPoll, true);
});

test("a later --yolo start puts the teams back and clears the expected poll", (t) => {
  const fx = fixture(t, { delivery: "channel", runtime: "claude", settings: { join: "alpha" } });
  const { meta } = fx.spawn();
  const r = fx.launch(meta, "claude", { extra: { OATS_YOLO: "1" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fx.registered().receive_identities.map((x) => x.label), ["alpha"]);
  assert.equal(r.doc.meta.joinedTeams[0].receive, "native");
  assert.equal("expectedPoll" in r.doc.meta.joinedTeams[0], false);
});

for (const runtime of ["pi", "codex"]) test(`a ${runtime} home is unchanged: its joined teams stay on the broker without OATS_YOLO`, (t) => {
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

test("the inject carries the plain-text rule and the skill tells nobody to start the broker for a poll", () => {
  const inject = readFileSync(join(CAPABILITY, "injects", "aweb.md"), "utf8").replace(/\s+/g, " ");
  assert.match(inject, /If you've joined a team on `receive: native` \(`oats aweb teams`\), ask a person in plain text, then end your turn\. Don't open a question dialog\./);
  const skill = readFileSync(join(CAPABILITY, "skills", "oats-aweb", "SKILL.md"), "utf8");
  assert.match(skill, /\| `joined-team-polled` \|.*nobody: expected\. Don't install or start the broker for this \|/);
  assert.match(skill.replace(/\s+/g, " "), /Nothing wakes an idle Claude home for joined-team mail\. .* use one only where `oats session inspect --json` shows `wakeHold: on-claims`\./);
});
