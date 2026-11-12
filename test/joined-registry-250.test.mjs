// awebai/oats-aweb#250: the joined-team release's controller command names the registry aw
// would use for that membership, by #248's rule: the registry_url of the team's membership
// in the joined identity's teams.yaml when it is a plain origin, or none. With only the
// membership's aweb_url, aw discovers the registry from that service, so the command omits
// --registry and says so; it never says aw will use its default there.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HOOK = join(REPO, "oats-package", "capabilities", "oats-aweb", "bin", "oats-aweb.mjs");
const DEFAULT = "default:example.test", SHARED = "shared:example.test";
const SHARED_NO_REGISTRY = "aw id team remove-member --namespace example.test --team shared --cert-id cert-shared-123 --json";
const SERVICE = "https://app.example.test";
const DISCOVERS = `(the team's registry is not recorded here; aw discovers it from ${SERVICE}: the controller adds --registry <that registry> if it is not aw's default)`;
const DEFAULT_TEXT = "aw will use its default";
const membership = (team, fields) => `    - team_id: ${team}\n      alias: dev-1\n${Object.entries(fields).map(([k, v]) => `      ${k}: ${v}\n`).join("")}`;
const teamsYaml = (...rows) => `active_team: ${SHARED}\nmemberships:\n${rows.join("")}`;

function tempDir(t, prefix = "oats-aweb-retired-") {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => { try { chmodSync(join(dir, ".oats-aweb"), 0o700); } catch { /* not made read-only */ } rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

/** A fake aw whose team is not hosted: every `workspace delete` answers alias_released false,
 *  team_not_hosted. `id team members` and `workspace status` answer the fixture's files. */
function fakeAw(t, dir, { registry = true } = {}) {
  const bin = join(dir, "bin");
  write(join(bin, "aw"), `#!${process.execPath}
const fs = require("node:fs");
let args = process.argv.slice(2), identityHome = null;
if (args[0] === "--identity-home") { identityHome = args[1]; args = args.slice(2); }
const emit = (o) => console.log(JSON.stringify(o));
const cmd = args.slice(0, 3).join(" ");
if (args[0] === "version") { console.log("aw 1.36.33 abcdef"); process.exit(0); }
if (args[0] === "workspace" && args[1] === "delete") { emit({ alias_released: false, alias_released_reason: "team_not_hosted" }); process.exit(0); }
if (cmd === "id team list") { emit({ memberships: [{ team_id: String(identityHome || "").includes(".aweb-identity-shared") ? ${JSON.stringify(SHARED)} : ${JSON.stringify(DEFAULT)}, ${registry ? 'registry_origin: "https://api.awid.ai"' : ""} }] }); process.exit(0); }
if (cmd === "id team members") { fs.writeSync(1, fs.readFileSync(${JSON.stringify(join(dir, "members.json"))}, "utf8")); process.exit(0); }
if (args[0] === "workspace" && args[1] === "status") { emit({ selected_team: ${JSON.stringify(DEFAULT)}, team_has_more: false, team: [] }); process.exit(0); }
if (args[0] === "wake") { console.log("ok"); process.exit(0); }
console.error("fake aw: unexpected " + args.join(" ")); process.exit(93);
`);
  chmodSync(join(bin, "aw"), 0o755);
  return `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`;
}

/** A deployment (oats-local.yaml, a root for the default team) and an instance home whose
 *  default identity and joined team `shared` each hold a certificate in a team not hosted. */
function fixture(t, { registry = true } = {}) {
  const ws = tempDir(t), root = join(ws, "root"), home = join(ws, "agents", "dev", "instances", "dev-1");
  write(join(ws, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  write(join(root, ".aw", "identity.yaml"), "alias: root\n");
  const sharedHome = join(home, ".aweb-identity-shared");
  write(join(home, ".aw", "identity.yaml"), `alias: dev-1\nteam_id: ${DEFAULT}\n`);
  write(join(home, ".aw", "team-certs", "default__example.test.pem"), JSON.stringify({ version: 1, certificate_id: "cert-default-123", team_id: DEFAULT, alias: "dev-1" }));
  write(join(sharedHome, "identity.yaml"), `alias: dev-1\nteam_id: ${SHARED}\n`);
  write(join(sharedHome, "team-certs", "shared__example.test.pem"), JSON.stringify({ version: 1, certificate_id: "cert-shared-123", team_id: SHARED, alias: "dev-1" }));
  const meta = { alias: "dev-1", team: DEFAULT, identity: { mode: "local", alias: "dev-1", team: DEFAULT }, joinedTeams: [{ label: "shared", team: SHARED, identityHome: sharedHome, alias: "dev-1", receive: "poll", since: "2026-11-01T00:00:00.000Z" }] };
  const teams = [{ label: "personal", team: DEFAULT, default: true, from: "local" }, { label: "shared", team: SHARED, default: false, from: "shared" }];
  const env = {
    PATH: fakeAw(t, ws, { registry }), OATS_HOME: home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: ws,
    OATS_DEFAULT_TEAM: "personal", OATS_DEFAULT_TEAM_ID: DEFAULT, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify(teams), OATS_TEAMS_SOURCE: "live", OATS_RUNTIME: "claude",
    OATS_SETTINGS: JSON.stringify({ roots: { [DEFAULT]: root } }),
  };
  const hook = (event, args = [], extra = {}) => spawnSync(process.execPath, [HOOK, event, ...args], { cwd: home, env: { ...env, OATS_EVENT: event, ...extra }, encoding: "utf8", timeout: 30000 });
  const retire = () => {
    // A fresh retire of the same identities: the default-retire marker would skip the self-delete.
    rmSync(join(home, ".oats-aweb", "default-retire.json"), { force: true });
    const r = hook("retire", [], { OATS_META: JSON.stringify(meta) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout);
  };
  const members = (list) => writeFileSync(join(ws, "members.json"), JSON.stringify({ team_id: DEFAULT, members: list }));
  return { ws, home, sharedHome, retire, hook, members, recordFile: join(ws, ".oats-aweb", "retired-certificates.json") };
}
const readRecord = (file) => JSON.parse(readFileSync(file, "utf8"));
const sharedEntry = (fx) => readRecord(fx.recordFile).entries.find((e) => e.team === SHARED);
const sharedPending = (doc) => doc.meta.pendingControllerCleanup.find((p) => p.team === SHARED);

test("1. a joined membership that records only its service: the command omits --registry and says aw discovers it there; the record stores none", (t) => {
  const fx = fixture(t, { registry: false });
  write(join(fx.sharedHome, "teams.yaml"), teamsYaml(membership(SHARED, { aweb_url: SERVICE })));
  const doc = fx.retire();
  assert.ok(doc.warning.includes(`joined team shared cleanup failed: team_not_hosted; controller cleanup: ${SHARED_NO_REGISTRY} ${DISCOVERS}`), doc.warning);
  assert.equal(sharedPending(doc).command, SHARED_NO_REGISTRY);
  assert.equal(sharedEntry(fx).registry, null);
  assert.equal(sharedEntry(fx).command, SHARED_NO_REGISTRY);
});

test("2. a joined membership that records a plain registry_url: the command, the record and the meta carry it", (t) => {
  const fx = fixture(t, { registry: false });
  write(join(fx.sharedHome, "teams.yaml"), teamsYaml(
    membership("other:example.test", { registry_url: "https://other-registry.example.test" }),
    membership(SHARED, { registry_url: "https://registry.example.test", aweb_url: SERVICE })));
  const doc = fx.retire();
  const command = "aw id team remove-member --namespace example.test --team shared --cert-id cert-shared-123 --registry https://registry.example.test --json";
  assert.ok(doc.warning.includes(`joined team shared cleanup failed: team_not_hosted; controller cleanup: ${command}`), doc.warning);
  assert.equal(sharedPending(doc).command, command);
  assert.equal(sharedEntry(fx).registry, "https://registry.example.test");
});

test("3. a recorded service that is not a plain service URL is not printed, and no registry is claimed", (t) => {
  const fx = fixture(t, { registry: false });
  write(join(fx.sharedHome, "teams.yaml"), teamsYaml(membership(SHARED, { aweb_url: '"https://user:pw@app.example.test/$(id)"' })));
  const doc = fx.retire();
  assert.ok(doc.warning.includes(`${SHARED_NO_REGISTRY} (the team's registry is not recorded here; aw discovers it from the membership's service: the controller adds --registry <that registry> if it is not aw's default)`), doc.warning);
  assert.doesNotMatch(JSON.stringify(doc), /user:pw|\$\(id\)/);
  assert.equal(sharedEntry(fx).registry, null);
});

test("4. a registry in the joined identity's other files is not taken when the membership records its service: aw would discover it", (t) => {
  const fx = fixture(t, { registry: false });
  write(join(fx.sharedHome, "identity.yaml"), `alias: dev-1\nteam_id: ${SHARED}\nregistry_url: https://identity-registry.example.test\n`);
  write(join(fx.sharedHome, "teams.yaml"), teamsYaml(membership(SHARED, { aweb_url: SERVICE })));
  const doc = fx.retire();
  assert.ok(doc.warning.includes(`${SHARED_NO_REGISTRY} ${DISCOVERS}`), doc.warning);
  assert.doesNotMatch(JSON.stringify(doc), /identity-registry/);
  const shared = doc.warning.split(" | ").find((w) => w.includes("joined team shared"));
  assert.equal(shared.includes(DEFAULT_TEXT), false, shared);
});

test("5. the membership is found as aw spells the team id", (t) => {
  const fx = fixture(t, { registry: false });
  write(join(fx.sharedHome, "teams.yaml"), teamsYaml(membership("Shared:Example.Test.", { registry_url: "https://registry.example.test" })));
  const doc = fx.retire();
  assert.equal(sharedEntry(fx).registry, "https://registry.example.test", doc.warning);
});

test("6. a joined membership with no registry and no service keeps today's answer: aw uses its default", (t) => {
  const fx = fixture(t, { registry: false });
  write(join(fx.sharedHome, "teams.yaml"), teamsYaml(membership(SHARED, {})));
  const doc = fx.retire();
  assert.ok(doc.warning.includes(`${SHARED_NO_REGISTRY} (registry origin could not be determined from the joined identity; command omits --registry and aw will use its default)`), doc.warning);
});
