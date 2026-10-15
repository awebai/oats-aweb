// One tick of the agent status publisher (aweb-acah.3, D7): every home the
// deployment runs is assessed, its agent id is aw's own answer for its
// identity home, the agent designates its status host once per (agent id,
// host), and every agent gets a checked document published by its team's root
// (a resident by its own custody root). The host interface stands for the
// kernel CLI, aw and the cache files; the real calls are proven on a
// rehearsal, not here.
import test from "node:test";
import assert from "node:assert/strict";
import { healthSettings, publishTick } from "../oats-package/capabilities/oats-aweb/lib/health-publisher.mjs";
import { checkDocument } from "../oats-package/capabilities/oats-aweb/lib/status-document.mjs";

const NOW = Date.parse("2026-10-14T16:00:00.250Z");
const TEAM = "default:acme.aweb.ai", OTHER = "ops:acme.aweb.ai";
const ROOT = "/d/.aweb-roots/default", OPS_ROOT = "/d/.aweb-roots/ops", RESIDENT = "/d/.aweb-residents/merlin";
const ROOT_DID = "did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd";
const OPS_DID = "did:key:z6Mkn4x1HvZkkoREXWaXdWF8FjRTPd9PFqDab3QpbRG7M3Nu";
const RESIDENT_DID = "did:key:z6MkResidentResidentResidentResidentResident1";
const settings = { root: ROOT, roots: { [OTHER]: OPS_ROOT }, residents: { merlin: RESIDENT }, health: { publish: true } };

const localRow = (name, over = {}) => ({ instance: name, home: `/d/agents/a/instances/${name}`, launched: true, launchPrompts: { status: "completed" }, capabilityMeta: { "oats.aweb": { team: TEAM, alias: name, identity: { mode: "local", alias: name, team: TEAM } } }, ...over });
const seatRow = (name) => ({ instance: name, home: `/d/agents/r/instances/${name}`, launched: true, launchPrompts: { status: "not-engaged" }, capabilityMeta: { "oats.aweb": { identity: { mode: "global", alias: "merlin", team: TEAM, resident: "merlin", seat: name } } } });

/** The directory an aw target names: an identity home, or the cwd of a root. */
const where = (target) => target.identityHome ?? target.cwd;

/** An in-memory host: rows, liveness, readiness and aw answers per directory. */
function fakeHost({ rows, liveness = {}, readiness = {}, ids = {}, setResult = () => ({ ok: true, status: 200 }), publishResult = () => ({ ok: true, status: 200 }), supportsStatus = true, cache = {} } = {}) {
  const calls = { set: [], publish: [], log: [], readiness: [] };
  return {
    calls, cache,
    awSupportsStatus: async () => (supportsStatus ? { ok: true } : { ok: false, message: "aw 1.36.36 has no status publish; needs a release of aw with `aw status publish` (aweb-acah.3.1)" }),
    status: async () => ({ agents: [{ name: "a", instances: rows }] }),
    liveness: async (row) => liveness[row.instance] ?? { state: "alive", lastEvent: "launched" },
    readiness: async (home) => { calls.readiness.push(home); return home in readiness ? readiness[home] : { status: "ready", problems: [], warnings: [] }; },
    identityOf: async (target) => { const dir = where(target); return dir in ids ? ids[dir] : { did: `did:key:z6Mk${Buffer.from(dir).toString("hex").slice(-40)}` }; },
    statusHostSet: async (target, hostDid) => { const dir = where(target); calls.set.push({ dir, hostDid }); return setResult(dir, hostDid); },
    statusPublish: async (target, alias, document) => { const dir = where(target); calls.publish.push({ dir, alias, document }); return publishResult(dir, alias, document); },
    readCache: async (file) => cache[file] ?? null,
    writeCache: async (file, value) => { cache[file] = value; },
    log: async (entry) => { calls.log.push(entry); },
  };
}

const idsFor = { [ROOT]: { did: ROOT_DID }, [OPS_ROOT]: { did: OPS_DID }, [RESIDENT]: { did: RESIDENT_DID, stable_id: "did:aw:merlin" } };

test("health settings: off unless publish is true; language defaults to en; the operator role is one short line", () => {
  assert.deepEqual(healthSettings({}), { publish: false, language: "en", operator: null });
  assert.deepEqual(healthSettings({ health: { publish: true, language: "es", operator: "Nactiva's operator" } }), { publish: true, language: "es", operator: "Nactiva's operator" });
  assert.throws(() => healthSettings({ health: { publish: "yes" } }), /health.publish must be true or false/);
  assert.throws(() => healthSettings({ health: { publish: true, operator: "a\nb" } }), /health.operator must be one line of at most 120 bytes/);
  assert.throws(() => healthSettings({ health: { publish: true, operator: "x".repeat(121) } }), /health.operator must be one line of at most 120 bytes/);
  assert.throws(() => healthSettings({ health: { publish: true, nope: 1 } }), /unknown health setting: nope/);
});

test("a local agent is designated as itself, then published by its team's root with a checked document", async () => {
  const home = "/d/agents/a/instances/dev-1";
  const host = fakeHost({ rows: [localRow("dev-1")], ids: { ...idsFor, [`${home}/.aw`]: { did: "did:key:z6MkAgentDev1" } } });
  const result = await publishTick({ settings, now: () => NOW, host });
  assert.deepEqual(host.calls.set, [{ dir: `${home}/.aw`, hostDid: ROOT_DID }]);
  assert.equal(host.calls.publish.length, 1);
  const { dir, alias, document } = host.calls.publish[0];
  assert.equal(dir, ROOT);
  assert.equal(alias, "dev-1");
  assert.deepEqual(document, { v: 1, type: "agent_status", team_id: TEAM, agent: "did:key:z6MkAgentDev1", publisher_did: ROOT_DID, seq: NOW, reachable: "yes", observed_at: "2026-10-14T16:00:00Z", valid_until: "2026-10-14T16:05:00Z" });
  assert.deepEqual(checkDocument(document, { now: NOW }), { ok: true });
  assert.deepEqual(result.published, [{ alias: "dev-1", team: TEAM, reachable: "yes", code: null }]);
});

test("designation is cached per (agent id, host): the second tick does not designate again", async () => {
  const host = fakeHost({ rows: [localRow("dev-1")], ids: idsFor });
  await publishTick({ settings, now: () => NOW, host });
  await publishTick({ settings, now: () => NOW + 60000, host });
  assert.equal(host.calls.set.length, 1);
  assert.equal(host.calls.publish.length, 2);
  assert.ok(host.calls.publish[1].document.seq > host.calls.publish[0].document.seq);
});

test("a re-minted identity (a different id from aw) drops the cache and designates again", async () => {
  const home = "/d/agents/a/instances/dev-1";
  const who = { ...idsFor, [`${home}/.aw`]: { did: "did:key:z6MkFirst" } };
  const host = fakeHost({ rows: [localRow("dev-1")], ids: who });
  await publishTick({ settings, now: () => NOW, host });
  who[`${home}/.aw`] = { did: "did:key:z6MkSecond" };
  await publishTick({ settings, now: () => NOW + 60000, host });
  assert.equal(host.calls.set.length, 2);
  assert.equal(host.calls.publish[1].document.agent, "did:key:z6MkSecond");
});

test("a 403 not_status_host is logged with its exact fields and designates again at the next tick", async () => {
  let first = true;
  const host = fakeHost({ rows: [localRow("dev-1")], ids: idsFor, publishResult: () => (first ? (first = false, { ok: false, status: 403, code: "not_status_host", message: "not the status host for dev-1" }) : { ok: true, status: 200 }) });
  const result = await publishTick({ settings, now: () => NOW, host });
  assert.deepEqual(result.refused, [{ alias: "dev-1", team: TEAM, status: 403, code: "not_status_host", message: "not the status host for dev-1" }]);
  assert.deepEqual(host.calls.log.map(({ alias, status, code, message, retry_after }) => ({ alias, status, code, message, retry_after })), [{ alias: "dev-1", status: 403, code: "not_status_host", message: "not the status host for dev-1", retry_after: null }]);
  await publishTick({ settings, now: () => NOW + 60000, host });
  assert.equal(host.calls.set.length, 2);
});

test("a 429 skips that agent until Retry-After has passed", async () => {
  let n = 0;
  const host = fakeHost({ rows: [localRow("dev-1")], ids: idsFor, publishResult: () => (n++ === 0 ? { ok: false, status: 429, code: "rate_limited", message: "slow down", retry_after: 90 } : { ok: true, status: 200 }) });
  await publishTick({ settings, now: () => NOW, host });
  const second = await publishTick({ settings, now: () => NOW + 60000, host });
  assert.equal(host.calls.publish.length, 1);
  assert.deepEqual(second.skipped, [{ alias: "dev-1", team: TEAM, reason: "rate limited until 2026-10-14T16:01:30Z" }]);
  await publishTick({ settings, now: () => NOW + 120000, host });
  assert.equal(host.calls.publish.length, 2);
});

test("a 409 stale_seq is logged and the next tick simply sends a newer seq", async () => {
  let n = 0;
  const host = fakeHost({ rows: [localRow("dev-1")], ids: idsFor, publishResult: () => (n++ === 0 ? { ok: false, status: 409, code: "stale_seq", message: "seq is not greater than the stored seq" } : { ok: true, status: 200 }) });
  await publishTick({ settings, now: () => NOW, host });
  await publishTick({ settings, now: () => NOW + 60000, host });
  assert.equal(host.calls.log[0].code, "stale_seq");
  assert.equal(host.calls.set.length, 1);
  assert.equal(host.calls.publish.length, 2);
});

test("a failed designation is logged and that agent is not published this tick", async () => {
  const host = fakeHost({ rows: [localRow("dev-1")], ids: idsFor, setResult: () => ({ ok: false, status: 422, code: "invalid_host", message: "host_did is not an active member of this team" }) });
  const result = await publishTick({ settings, now: () => NOW, host });
  assert.equal(host.calls.publish.length, 0);
  assert.deepEqual(result.refused, [{ alias: "dev-1", team: TEAM, status: 422, code: "invalid_host", message: "host_did is not an active member of this team" }]);
});

test("a joined identity is its own agent, published by that team's root, degraded when it polls", async () => {
  const home = "/d/agents/a/instances/dev-1";
  const row = localRow("dev-1");
  row.capabilityMeta["oats.aweb"].joinedTeams = [{ label: "ops", team: OTHER, identityHome: `${home}/.aweb-identity-ops`, receive: "poll", alias: "dev-1" }];
  const host = fakeHost({ rows: [row], ids: idsFor });
  await publishTick({ settings, now: () => NOW, host });
  const joined = host.calls.publish.find((p) => p.document.team_id === OTHER);
  assert.equal(joined.dir, OPS_ROOT);
  assert.equal(joined.document.publisher_did, OPS_DID);
  assert.equal(joined.document.reachable, "degraded");
  assert.equal(joined.document.reason.code, "oats.joined_team_poll_only");
  assert.deepEqual(host.calls.set.find((s) => s.dir === `${home}/.aweb-identity-ops`), { dir: `${home}/.aweb-identity-ops`, hostDid: OPS_DID });
});

test("a resident's seats publish one document: the resident's did:aw, signed by its custody root, best seat wins", async () => {
  const host = fakeHost({ rows: [seatRow("seat-a"), seatRow("seat-b")], ids: idsFor, liveness: { "seat-a": { state: "stopped", lastEvent: "launched" } } });
  await publishTick({ settings, now: () => NOW, host });
  assert.equal(host.calls.publish.length, 1);
  const { dir, alias, document } = host.calls.publish[0];
  assert.equal(dir, RESIDENT);
  assert.equal(alias, "merlin");
  assert.equal(document.agent, "did:aw:merlin");
  assert.equal(document.publisher_did, RESIDENT_DID);
  assert.equal(document.reachable, "yes");
  assert.deepEqual(host.calls.set, [{ dir: RESIDENT, hostDid: RESIDENT_DID }]);
});

test("a resident whose seats are all gone, after it was published, is published as retired", async () => {
  const host = fakeHost({ rows: [seatRow("seat-a")], ids: idsFor });
  await publishTick({ settings, now: () => NOW, host });
  host.status = async () => ({ agents: [{ name: "r", instances: [] }] });
  await publishTick({ settings, now: () => NOW + 60000, host });
  const last = host.calls.publish.at(-1).document;
  assert.deepEqual([last.reachable, last.reason.code, last.fixing.by], ["no", "oats.retired", "nobody"]);
});

test("homes it cannot publish are listed with why, never guessed", async () => {
  const noMeta = { instance: "plain", home: "/d/agents/p/instances/plain", launched: true, capabilityMeta: {} };
  const retained = localRow("kept"); retained.capabilityMeta["oats.aweb"] = { team: TEAM, alias: "kept", retained: true, identity: { mode: "global", alias: "kept", team: TEAM } };
  const unknownResident = seatRow("seat-x"); unknownResident.capabilityMeta["oats.aweb"].identity.resident = "ghost";
  const noRoot = localRow("far"); noRoot.capabilityMeta["oats.aweb"].team = "far:elsewhere"; noRoot.capabilityMeta["oats.aweb"].identity.team = "far:elsewhere";
  const host = fakeHost({ rows: [noMeta, retained, unknownResident, noRoot], ids: idsFor });
  const result = await publishTick({ settings: { ...settings, root: undefined }, now: () => NOW, host });
  assert.equal(host.calls.publish.length, 0);
  assert.deepEqual(result.skipped, [
    { home: "/d/agents/a/instances/kept", reason: "a retained seat is not published in v1" },
    { home: "/d/agents/r/instances/seat-x", reason: "resident ghost is not in settings.oats.aweb.residents" },
    { home: "/d/agents/a/instances/far", reason: "no minting root for team far:elsewhere" },
  ]);
});

test("an id aw cannot give is listed, not guessed", async () => {
  const home = "/d/agents/a/instances/dev-1";
  const host = fakeHost({ rows: [localRow("dev-1")], ids: { ...idsFor, [`${home}/.aw`]: null } });
  const result = await publishTick({ settings, now: () => NOW, host });
  assert.equal(host.calls.publish.length, 0);
  assert.deepEqual(result.skipped, [{ alias: "dev-1", team: TEAM, reason: "aw gave no agent id" }]);
});

test("a home whose readiness does not answer within the budget is published unknown, not dropped", async () => {
  const host = fakeHost({ rows: [localRow("dev-1")], ids: idsFor });
  host.readiness = () => new Promise(() => {});
  const result = await publishTick({ settings, now: () => NOW, host, budgetMs: 20 });
  assert.deepEqual(result.published, [{ alias: "dev-1", team: TEAM, reachable: "unknown", code: "oats.readiness_unavailable" }]);
});

test("an aw without the status commands stops the tick before anything is sent", async () => {
  const host = fakeHost({ rows: [localRow("dev-1")], ids: idsFor, supportsStatus: false });
  await assert.rejects(publishTick({ settings, now: () => NOW, host }), /aw 1.36.36 has no status publish; needs a release of aw with `aw status publish`/);
  assert.equal(host.calls.set.length + host.calls.publish.length, 0);
});

test("publishing off: the tick does nothing at all", async () => {
  const host = fakeHost({ rows: [localRow("dev-1")], ids: idsFor });
  const result = await publishTick({ settings: { ...settings, health: undefined }, now: () => NOW, host });
  assert.deepEqual(result, { disabled: true });
  assert.equal(host.calls.readiness.length + host.calls.set.length + host.calls.publish.length, 0);
});

test("a stopped home is published as stopped with the operator role from settings when someone must act", async () => {
  const host = fakeHost({ rows: [localRow("dev-1"), localRow("dev-2")], ids: idsFor, liveness: { "dev-1": { state: "stopped", lastEvent: "stopped" }, "dev-2": { state: "shell", lastEvent: "launched" } } });
  await publishTick({ settings: { ...settings, health: { publish: true, operator: "Nactiva's operator" } }, now: () => NOW, host });
  const byAlias = Object.fromEntries(host.calls.publish.map((p) => [p.alias, p.document]));
  assert.deepEqual(byAlias["dev-1"].fixing, { by: "nobody", text: "Stopped on purpose." });
  assert.deepEqual(byAlias["dev-2"].fixing, { by: "operator", text: "Nactiva's operator" });
  assert.equal(host.calls.readiness.length, 0, "readiness is not read for a home that is not running");
});
