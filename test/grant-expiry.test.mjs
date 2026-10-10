// oats.aweb 1.25: readiness makes a grant seat's expiry visible from the grant
// recorded at its last start (capabilityMeta identity.grant.expiresAt, as aw's
// `id grant mint` reported expires_at), without asking aw or custody. Within 7
// days of expiry it warns `grant-expiring`; at or after expiry it is the
// `grant-expired` problem; an absent or unreadable expiry is the
// `grant-expiry-unknown` warning, never an invented instant. LOCAL seats have
// no grant and get none of these.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fakeAw } from "./helpers/fake-aw-grant.mjs";
import { grantExpiryAssessment } from "../oats-package/capabilities/oats-aweb/lib/grant-expiry.mjs";
import { DEFAULT_GRANT_TTL } from "../oats-package/capabilities/oats-aweb/lib/grant-duration.mjs";

const BINDING = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb-binding.mjs", import.meta.url).pathname);
const TEAM = "t:example.test";
const HOUR = 3600000, DAY = 24 * HOUR;
const NOW = Date.parse("2026-10-10T02:00:00Z");
const HOME = "/abs/agents/dev/instances/seat";
const REMEDY = "restart the seat to renew it (`oats session restart --home /abs/agents/dev/instances/seat`)";
const RESPAWN = "respawn the seat: it captured identity.ttl 24h, which a restart would mint again";
const iso = (ms) => new Date(ms).toISOString();
const grantIdentity = (expiresAt, ttl) => ({ mode: "global", alias: "resident-alias", team: TEAM, resident: "merlin", grant: { id: "grant-1", ...(expiresAt === undefined ? {} : { expiresAt }), ...(ttl === undefined ? {} : { ttl }), scopes: ["mail.read"], home: `${HOME}/.aweb-identity` } });
const assess = (identity, now = NOW) => grantExpiryAssessment(identity, { home: HOME, now });

test("a grant expiring in 6 days 23 hours is the grant-expiring warning naming the instant and the remedy", () => {
  const at = iso(NOW + 6 * DAY + 23 * HOUR);
  assert.deepEqual(assess(grantIdentity(at)), { problems: [], warnings: [{ code: "grant-expiring", message: `grant grant-1 expires at ${at}, within 7 days: ${REMEDY}` }] });
});

test("the remedy restarts a seat minted with the default ttl, or none recorded, and respawns one minted with a short ttl", () => {
  const at = iso(NOW - 1000);
  for (const ttl of [undefined, "720h", "43200m", "garbage"]) {
    assert.equal(assess(grantIdentity(at, ttl)).problems[0].message, `grant grant-1 expired at ${at}: ${REMEDY}`, String(ttl));
  }
  assert.equal(assess(grantIdentity(at, "24h")).problems[0].message, `grant grant-1 expired at ${at}: ${RESPAWN}`);
  const soon = iso(NOW + DAY);
  assert.equal(assess(grantIdentity(soon, "24h")).warnings[0].message, `grant grant-1 expires at ${soon}, within 7 days: ${RESPAWN}`);
});

test("a grant expiring in 7 days and 1 hour is silent", () => {
  assert.deepEqual(assess(grantIdentity(iso(NOW + 7 * DAY + HOUR))), { problems: [], warnings: [] });
});

test("a grant just past its expiry, or exactly at it, is the grant-expired problem", () => {
  for (const at of [iso(NOW - 1000), iso(NOW)]) {
    assert.deepEqual(assess(grantIdentity(at)), { problems: [{ code: "grant-expired", message: `grant grant-1 expired at ${at}: ${REMEDY}` }], warnings: [] });
  }
});

test("the recorded instant is named as recorded, whatever its offset", () => {
  const at = "2026-10-12T04:00:00+02:00";
  assert.match(assess(grantIdentity(at)).warnings[0].message, /expires at 2026-10-12T04:00:00\+02:00, within 7 days/);
});

test("a missing or unreadable expiresAt is the grant-expiry-unknown warning and never an invented expiry", () => {
  for (const [value, shown] of [[undefined, "absent"], ["unknown", '"unknown"'], ["2026-02-30T00:00:00Z", '"2026-02-30T00:00:00Z"'], [1760000000, "1760000000"]]) {
    const assessed = assess(grantIdentity(value));
    assert.deepEqual(assessed.problems, [], String(value));
    assert.deepEqual(assessed.warnings, [{ code: "grant-expiry-unknown", message: `grant grant-1 has no readable expiry (recorded expiresAt: ${shown}), so readiness does not know when it expires: ${REMEDY}` }]);
  }
});

test("a LOCAL seat, or a record without a grant, gets no expiry diagnostics", () => {
  for (const identity of [undefined, { mode: "local", alias: "dev-1", team: TEAM }, { mode: "global", resident: "merlin" }]) {
    assert.deepEqual(assess(identity), { problems: [], warnings: [] });
  }
});

// ------------------------------------------------- through the binding check

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-expiry-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
const teamEnv = { OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]) };

/** Readiness for a home whose last start recorded `identity`, under `settings`. */
function readinessFor(t, identity, settingsFor) {
  const base = tempDir(t);
  const bin = fakeAw(base);
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "seat"); mkdirSync(home, { recursive: true });
  const custody = join(base, "custody", "merlin"); write(join(custody, ".aw", "identity.yaml"), "alias: resident-alias\n");
  write(join(home, "instance.json"), JSON.stringify({ capabilityMeta: { "oats.aweb": { delivery: "session", runtime: "codex", identity } } }));
  const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings: { root, delivery: "session", ...settingsFor(custody) }, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: root, deployment: root, soul: "dev", home } } };
  const r = spawnSync(process.execPath, [BINDING, "check"], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...teamEnv } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { home, result: JSON.parse(r.stdout).result };
}
const globalSettings = (custody) => ({ identity: { mode: "global", resident: "merlin" }, residents: { merlin: custody } });
const codes = (rows) => rows.map((p) => p.code);

test("grant-seat readiness reports an expiring grant as a warning naming this home", (t) => {
  const at = iso(Date.now() + 6 * DAY + 23 * HOUR);
  const { home, result } = readinessFor(t, grantIdentity(at), globalSettings);
  const warning = result.warnings.find((w) => w.code === "grant-expiring");
  assert.ok(warning, JSON.stringify(result));
  assert.equal(warning.message, `grant grant-1 expires at ${at}, within 7 days: restart the seat to renew it (\`oats session restart --home ${home}\`)`);
  assert.equal(codes(result.problems).includes("grant-expired"), false);
});

test("grant-seat readiness reports an expired grant as a problem, and messaging as unavailable", (t) => {
  const { result } = readinessFor(t, grantIdentity(iso(Date.now() - 60000)), globalSettings);
  assert.equal(result.status, "unavailable");
  assert.ok(codes(result.problems).includes("grant-expired"), JSON.stringify(result));
});

test("grant-seat readiness with a distant expiry is silent about it", (t) => {
  const { result } = readinessFor(t, grantIdentity(iso(Date.now() + 7 * DAY + HOUR)), globalSettings);
  assert.deepEqual([...codes(result.problems), ...codes(result.warnings)].filter((c) => c.startsWith("grant-")), []);
});

test("grant-seat readiness without a recorded expiry says it is unknown", (t) => {
  const { result } = readinessFor(t, grantIdentity(undefined), globalSettings);
  assert.ok(codes(result.warnings).includes("grant-expiry-unknown"), JSON.stringify(result));
  assert.equal(codes(result.problems).some((c) => c.startsWith("grant-")), false);
});

test("a LOCAL seat's readiness has no grant expiry diagnostics", (t) => {
  const { result } = readinessFor(t, { mode: "local", alias: "seat", team: TEAM }, () => ({}));
  assert.deepEqual([...codes(result.problems), ...codes(result.warnings)].filter((c) => c.startsWith("grant-")), []);
});

// ------------------------------------------------ the grant duration defaults

test("1.25.0 grant seats default to a 720h ttl renewed at every launch, as the manifest says", () => {
  assert.equal(DEFAULT_GRANT_TTL, "720h");
  const manifest = JSON.parse(readFileSync(new URL("../oats-package/capabilities/oats-aweb/oats.json", import.meta.url), "utf8"));
  const description = manifest.settings.identity.description;
  assert.match(description, /ttl \(Go duration, 60s to 720h, default 720h\)/);
  assert.match(description, /renew \(off\|launch, default launch\)/);
});
