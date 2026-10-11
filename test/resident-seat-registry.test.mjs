// A GLOBAL seat verifies senders at the registry its resident's identity
// records: the spawn and launch hooks give it AWID_REGISTRY_URL from the
// resident's .aw/identity.yaml (found through settings.oats.aweb.residents),
// only when that registry's origin is not aw's default, and never from the
// operator's environment. Readiness reports a recorded value that is not an
// http(s) origin. The resident identity is test/fixtures/resident/
// identity-global.yaml, written by real aw 1.36.33 (see that README); the
// default-registry and no-record cases change only its registry_url line.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fakeAw } from "./helpers/fake-aw-grant.mjs";
import { fakeAwSetupPath } from "./helpers/fake-aw-setup.mjs";

const HOOK = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const BINDING = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb-binding.mjs", import.meta.url).pathname);
const MANIFEST = JSON.parse(readFileSync(new URL("../oats-package/capabilities/oats-aweb/oats.json", import.meta.url), "utf8"));
const CAPTURED_IDENTITY = readFileSync(new URL("./fixtures/resident/identity-global.yaml", import.meta.url), "utf8");
const CAPTURED_REGISTRY = "http://127.0.0.1:52519";
const OPERATOR_REGISTRY = "http://operator-registry.invalid:9";
const TEAM = "t:example.test";
const OPS = ["status.v1", "sign_plain_message.v1", "sign_app_request.v1", "grant_never_ttl.v1", "create_e2ee_envelope.v1", "unwrap_e2ee_message.v1", "mail_reply_continuation.v1"];
const teamEnv = { OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]) };

/** The captured identity with its registry_url line replaced, or removed for null. */
const withRegistry = (value) => CAPTURED_IDENTITY.replace(/^registry_url: .*\n/m, value === null ? "" : `registry_url: ${value}\n`);

function seat(t, identityYaml, settingsIdentity = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-seat-registry-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = fakeAw(base);
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  const home = join(root, "agents", "dev", "instances", "probe"); mkdirSync(home, { recursive: true });
  const custody = join(base, "custody", "merlin"); mkdirSync(join(custody, ".aw"), { recursive: true });
  writeFileSync(join(custody, ".aw", "identity.yaml"), identityYaml);
  const settings = { identity: { mode: "global", resident: "merlin", ...settingsIdentity }, residents: { merlin: custody } };
  const common = { OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify(settings), FAKE_CUSTODY_OPS: OPS.join(",") };
  const hook = (event, env = {}) => {
    const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OATS_EVENT: event, ...teamEnv, ...common, ...env } });
    let doc; try { doc = JSON.parse(r.stdout.trim().split(/\n/).at(-1)); } catch { doc = undefined; }
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return doc;
  };
  const readiness = () => {
    const input = { schemaVersion: 1, phase: "check", slot: "messaging", capability: "oats.aweb", settings, input: { action: { kind: "readiness" }, context: { kind: "workspace", workspace: root, deployment: root, soul: "dev", home } } };
    const r = spawnSync(process.execPath, [BINDING, "check"], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...teamEnv, FAKE_CUSTODY_OPS: OPS.join(",") } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout).result;
  };
  return { hook, readiness, custody };
}
/** Every launch path's env: the preview, a renewing start and a start with renewal off. */
function launchEnvs(s, meta) {
  const preview = s.hook("launch", { OATS_META: JSON.stringify(meta), OATS_LAUNCH_PREVIEW: "1", AWID_REGISTRY_URL: OPERATOR_REGISTRY }).env;
  const renewed = s.hook("launch", { OATS_META: JSON.stringify(meta), AWID_REGISTRY_URL: OPERATOR_REGISTRY });
  const kept = s.hook("launch", { OATS_META: JSON.stringify(renewed.meta), AWID_REGISTRY_URL: OPERATOR_REGISTRY, OATS_SETTINGS: JSON.stringify({ identity: { mode: "global", resident: "merlin", renew: "off" }, residents: { merlin: s.custody } }) }).env;
  return { preview, renewed: renewed.env, kept };
}
const awidNames = (env) => Object.keys(env).filter((k) => k.startsWith("AWID_"));

test("the manifest declares AWID_REGISTRY_URL, and AWID_ as its namespace, and nothing else of AWID_", () => {
  assert.deepEqual(MANIFEST.environment, ["AWEB_DELIVERY", "AWEB_IDENTITY_HOME", "AWID_REGISTRY_URL"]);
  assert.deepEqual(MANIFEST.environmentNamespaces, ["AWEB_", "AWID_"]);
});

test("a resident on a custom registry: spawn and every launch give the seat exactly that registry, whatever the operator's environment says", (t) => {
  const s = seat(t, CAPTURED_IDENTITY);
  const spawned = s.hook("spawn", { AWID_REGISTRY_URL: OPERATOR_REGISTRY });
  assert.equal(spawned.env.AWID_REGISTRY_URL, CAPTURED_REGISTRY);
  assert.deepEqual(awidNames(spawned.env), ["AWID_REGISTRY_URL"]);
  for (const [path, env] of Object.entries(launchEnvs(s, spawned.meta))) {
    assert.equal(env.AWID_REGISTRY_URL, CAPTURED_REGISTRY, path);
    assert.deepEqual(awidNames(env), ["AWID_REGISTRY_URL"], path);
  }
  assert.deepEqual(s.readiness().problems.filter((p) => /registry_url/.test(p.message)), []);
});

test("a resident on aw's default registry, or with no registry recorded, gives the seat no AWID_ variable", (t) => {
  for (const recorded of ["https://api.awid.ai", "HTTPS://API.awid.ai:443/", null]) {
    const s = seat(t, withRegistry(recorded));
    const spawned = s.hook("spawn", { AWID_REGISTRY_URL: OPERATOR_REGISTRY });
    assert.deepEqual(awidNames(spawned.env), [], String(recorded));
    for (const [path, env] of Object.entries(launchEnvs(s, spawned.meta))) assert.deepEqual(awidNames(env), [], `${recorded} ${path}`);
  }
});

test("a recorded registry that is not an http(s) origin is a readiness problem and is never passed on", (t) => {
  for (const [recorded, why] of [["ftp://registry.example", "its scheme is not http or https"], ["http://registry.example/v1", "it includes a path"], ["https://user@registry.example", "it includes userinfo"], ["https://r.example/#x", "it is not a URL"], ["\"https://r.example/it's\"", "it is not a URL"]]) {
    const s = seat(t, withRegistry(recorded));
    const message = `the resident's identity at ${join(s.custody, ".aw", "identity.yaml")} records registry_url ${JSON.stringify(recorded)}, which is not an http(s) registry origin (${why}); repair it there, else the seat verifies senders at aw's default registry`;
    assert.deepEqual(s.readiness().problems.filter((p) => p.code === "custody"), [{ code: "custody", message }]);
    const spawned = s.hook("spawn", { AWID_REGISTRY_URL: OPERATOR_REGISTRY });
    assert.deepEqual(awidNames(spawned.env), []);
    assert.ok(spawned.warning.includes(`oats-aweb: ${message}`), spawned.warning);
    for (const [path, env] of Object.entries(launchEnvs(s, spawned.meta))) assert.deepEqual(awidNames(env), [], `${recorded} ${path}`);
  }
});

test("a local identity's spawn and launch are unchanged: no AWID_ variable, though a custom-registry resident is configured and the operator sets one", (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-seat-registry-local-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const fake = fakeAwSetupPath(t);
  const root = join(base, "root"); mkdirSync(join(root, ".aw"), { recursive: true });
  writeFileSync(join(root, ".aw", "teams.json"), JSON.stringify({ memberships: [{ team_id: TEAM }] }));
  const home = join(root, "agents", "dev", "instances", "probe"); mkdirSync(home, { recursive: true });
  const custody = join(base, "custody", "merlin"); mkdirSync(join(custody, ".aw"), { recursive: true });
  writeFileSync(join(custody, ".aw", "identity.yaml"), CAPTURED_IDENTITY);
  const settings = { root, delivery: "session", residents: { merlin: custody } };
  const hook = (event, env = {}) => {
    const r = spawnSync(process.execPath, [HOOK, event], { encoding: "utf8", env: { ...process.env, PATH: `${fake.path}:${process.env.PATH}`, OATS_EVENT: event, ...teamEnv, OATS_INSTANCE: "probe", OATS_HOME: home, OATS_WORKSPACE: root, OATS_CONTEXT: root, OATS_SETTINGS: JSON.stringify(settings), AWID_REGISTRY_URL: OPERATOR_REGISTRY, AW_FAKE_TEAM: TEAM, ...env } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout.trim().split(/\n/).at(-1));
  };
  const spawned = hook("spawn");
  assert.equal(spawned.meta.identity.mode, "local");
  assert.ok(spawned.env.AWEB_IDENTITY_HOME, JSON.stringify(spawned.env));
  assert.deepEqual(awidNames(spawned.env), []);
  for (const extra of [{ OATS_LAUNCH_PREVIEW: "1" }, {}]) {
    const launched = hook("launch", { OATS_META: JSON.stringify(spawned.meta), ...extra });
    assert.deepEqual(awidNames(launched.env || {}), [], JSON.stringify(extra));
  }
});
