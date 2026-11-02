// `oats aweb attribution attach` through the provider's command entry: the
// setup expert plans, then applies with the plan's revision, from inside its
// own session (its AWEB_IDENTITY_HOME is never the identity attach acts as).
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { homeKeyIds } from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";
import { currentRootQuery } from "./helpers/current-root-query.mjs";
import { fakeAwChain, writeIdentity } from "./helpers/fake-aw-chain.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HOOK = join(REPO, "oats-package", "capabilities", "oats-aweb", "bin", "oats-aweb.mjs");
const HUMAN = "did:aw:human1", STEWARD = "did:aw:steward1";
const HUMAN_CERT = { id: HUMAN, kind: "human", parent: { kind: "namespace", id: "awtest-demo.example" } };
const STEWARD_CERT = { id: STEWARD, kind: "agent", parent: { kind: "identity", id: HUMAN } };

/** An identity home with a real Ed25519 key: the fake aw's identity (`.aw/did`)
 *  is the did:key of that key, as aw's is. */
function keyedHome(dir) {
  mkdirSync(join(dir, ".aw"), { recursive: true });
  const seed = Buffer.from(generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" }).d, "base64url");
  writeFileSync(join(dir, ".aw", "signing.key"), `-----BEGIN ED25519 PRIVATE KEY-----\n${seed.toString("base64")}\n-----END ED25519 PRIVATE KEY-----\n`);
  writeFileSync(join(dir, ".aw", "did"), homeKeyIds(dir).didKey);
  writeFileSync(join(dir, ".aw", "identity.yaml"), `did: ${homeKeyIds(dir).didKey}\naddress: awtest-demo.example/${dir.split("/").pop()}\n`);
  return dir;
}

function deployment(t, { attribution = "human", steward = true, instances }) {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-attach-cmd-")));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  writeFileSync(join(ws, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const stewardHome = join(ws, ".aweb-stewards", "awtest-steward");
  if (steward) writeIdentity(stewardHome, { did: STEWARD, chain: [HUMAN_CERT, STEWARD_CERT] });
  const homes = {};
  for (const [name, record] of Object.entries(instances)) {
    const home = keyedHome(join(ws, "agents", "dev", "instances", name));
    writeFileSync(join(home, "instance.json"), JSON.stringify({ instance: name, ...record, capabilityMeta: { "oats.aweb": { identity: { mode: "local" } } } }));
    homes[name] = home;
  }
  const settings = { root: ws, ...(attribution ? { attribution } : {}), ...(steward ? { human: { id: HUMAN, label: "Juan" }, steward: { id: STEWARD, home: stewardHome } } : {}) };
  const rows = Object.entries(homes).map(([instance, home]) => ({ instance, home }));
  const kernel = currentRootQuery(ws, { home: ws, deployment: ws, settings, change: `if(args[0]==='status')doc={root:${JSON.stringify(ws)},agents:[{instances:${JSON.stringify(rows)}}]};` });
  const caller = join(ws, "agents", "setup", "instances", "expert");
  mkdirSync(join(caller, ".aw"), { recursive: true });
  const env = { OATS_CLI_BIN: kernel.cli, OATS_TEAM_SCOPE: ws, OATS_SETTINGS: JSON.stringify(settings), OATS_INSTANCE_HOME: caller, AWEB_IDENTITY_HOME: join(caller, ".aw") };
  return { ws, homes, env, kernel };
}

function attach(fx, fake, args) {
  const r = spawnSync(process.execPath, [HOOK, "attribution", "attach", ...args, "--json"], { cwd: fx.ws, env: { ...fx.env, PATH: fake.path }, encoding: "utf8", timeout: 60000 });
  return { status: r.status, doc: JSON.parse(r.stdout.trim().split("\n").pop() || "{}"), stderr: r.stderr };
}
const kernelCalls = (fx) => (existsSync(fx.kernel.calls) ? readFileSync(fx.kernel.calls, "utf8").trim().split("\n").filter(Boolean) : []);

test("plan, then apply: every chainless home attaches under its spawn's parent, top-down, keeping its key and identity", (t) => {
  const fx = deployment(t, { instances: { lead: { spawnedBy: null }, dev: { spawnedBy: { instance: "lead", home: "" } } } });
  writeFileSync(join(fx.homes.dev, "instance.json"), JSON.stringify({ instance: "dev", spawnedBy: { instance: "lead", home: fx.homes.lead }, capabilityMeta: { "oats.aweb": { identity: { mode: "local" } } } }));
  const before = Object.fromEntries(Object.entries(fx.homes).map(([n, h]) => [n, ["signing.key", "identity.yaml", "did"].map((f) => readFileSync(join(h, ".aw", f), "utf8"))]));
  const fake = fakeAwChain(t);
  const plan = attach(fx, fake, ["--plan"]);
  assert.equal(plan.status, 0, JSON.stringify(plan.doc) + plan.stderr);
  assert.deepEqual(plan.doc.result.homes.map((h) => [h.instance, h.status, h.parent?.steward ? "steward" : h.parent?.instance]), [["lead", "attach", "steward"], ["dev", "attach", "lead"]]);
  assert.equal(fake.calls().some((c) => c.args[0] === "id"), false, "a plan changes nothing");
  const applied = attach(fx, fake, ["--plan-revision", plan.doc.result.planRevision, "--idempotency-key", "first"]);
  assert.equal(applied.status, 0, JSON.stringify(applied.doc) + applied.stderr);
  assert.deepEqual(applied.doc.result.homes.map((h) => [h.instance, h.status]), [["lead", "attached"], ["dev", "attached"]]);
  const chainOf = (h) => JSON.parse(readFileSync(join(h, ".aw", "id-chain.json"), "utf8")).certificates.map((c) => c.certificate.id);
  assert.deepEqual(chainOf(fx.homes.lead), [HUMAN, STEWARD, homeKeyIds(fx.homes.lead).didKey]);
  assert.deepEqual(chainOf(fx.homes.dev), [HUMAN, STEWARD, homeKeyIds(fx.homes.lead).didKey, homeKeyIds(fx.homes.dev).didKey]);
  for (const [n, h] of Object.entries(fx.homes)) assert.deepEqual(["signing.key", "identity.yaml", "did"].map((f) => readFileSync(join(h, ".aw", f), "utf8")), before[n], `${n}'s identity is unchanged`);
  const replay = attach(fx, fake, ["--plan-revision", plan.doc.result.planRevision, "--idempotency-key", "first"]);
  assert.equal(replay.doc.result.replayed, true);
  const stale = attach(fx, fake, ["--plan-revision", plan.doc.result.planRevision, "--idempotency-key", "second"]);
  assert.equal(stale.doc.error.code, "E_ATTACH_PLAN_STALE");
  assert.deepEqual(stale.doc.error.details.plan.homes.map((h) => h.status), ["attached", "attached"]);
});

test("compat: attribution absent or none refuses naming the bind, with no aw call and no home read", (t) => {
  for (const attribution of [null, "none"]) {
    const fx = deployment(t, { attribution, steward: false, instances: { lead: { spawnedBy: null } } });
    const fake = fakeAwChain(t);
    const r = attach(fx, fake, ["--plan"]);
    assert.equal(r.status, 1);
    assert.equal(r.doc.error.code, "E_ATTACH_NO_HUMAN");
    assert.match(r.doc.error.message, /bind a human to this deployment/);
    assert.deepEqual(fake.calls(), []);
    assert.deepEqual(kernelCalls(fx), []);
  }
});

test("a home `oats status` does not list is never touched, even when it sits in the deployment", (t) => {
  const fx = deployment(t, { instances: { lead: { spawnedBy: null } } });
  const stray = keyedHome(join(fx.ws, "agents", "dev", "instances", "stray"));
  writeFileSync(join(stray, "instance.json"), JSON.stringify({ instance: "stray", spawnedBy: null }));
  const fake = fakeAwChain(t);
  const plan = attach(fx, fake, ["--plan"]);
  assert.deepEqual(plan.doc.result.homes.map((h) => h.instance), ["lead"]);
  attach(fx, fake, ["--plan-revision", plan.doc.result.planRevision, "--idempotency-key", "k"]);
  assert.equal(existsSync(join(stray, ".aw", "id-chain.json")), false);
  assert.equal(fake.calls().some((c) => c.cwd === stray), false);
});

test("usage: plan or apply, never both or neither", (t) => {
  const fx = deployment(t, { instances: {} });
  const fake = fakeAwChain(t);
  for (const args of [[], ["--plan", "--plan-revision", "a".repeat(24)], ["--bogus"]]) assert.equal(attach(fx, fake, args).status, 2, JSON.stringify(args));
});
