// Spawn attribution (acmj.21) through the spawn hook: with attribution: human
// the hook issues the new instance an aw identity chain through aw's
// agent-child exchange, from the spawner (OATS_SPAWNER_HOME) or the
// deployment's steward, refuses with a fix, or creates a chainless child.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { currentRootQuery } from "./helpers/current-root-query.mjs";
import { fakeAwChain, writeIdentity } from "./helpers/fake-aw-chain.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HOOK = join(REPO, "oats-package", "capabilities", "oats-aweb", "bin", "oats-aweb.mjs");
const HUMAN = "did:aw:human1", STEWARD = "did:aw:steward1", LEAD = "did:key:zlead-1";
const HUMAN_CERT = { id: HUMAN, kind: "human", parent: { kind: "namespace", id: "awtest-demo.example" } };
const STEWARD_CERT = { id: STEWARD, kind: "agent", parent: { kind: "identity", id: HUMAN } };
const LEAD_CERT = { id: LEAD, kind: "agent", parent: { kind: "identity", id: STEWARD } };

function fixture(t, { attribution = "human", features = ["spawn-attribution"], steward = true } = {}) {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-attr-")));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const home = join(ws, "agents", "dev", "instances", "dev-1");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(ws, ".aw"), { recursive: true });
  writeFileSync(join(ws, ".aw", "teams.yaml"), "active_team: legacy:example.test\n");
  writeFileSync(join(ws, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  const stewardHome = join(ws, ".aweb-stewards", "awtest-steward");
  if (steward) writeIdentity(stewardHome, { did: STEWARD, chain: [HUMAN_CERT, STEWARD_CERT] });
  const settings = {
    root: ws,
    ...(attribution ? { attribution } : {}),
    ...(steward ? { human: { id: HUMAN, label: "Juan" }, steward: { id: STEWARD, home: stewardHome } } : {}),
  };
  const kernel = currentRootQuery(ws, { home, deployment: ws, settings, change: `if(args.includes('--version'))doc={version:'0.80.0',features:${JSON.stringify(features)}};` });
  const env = {
    OATS_CLI_BIN: kernel.cli, OATS_HOME: home, OATS_INSTANCE: "dev-1", OATS_WORKSPACE: ws, OATS_WORKSPACE_KEY: "github.com/acme/agents", OATS_WORKSPACE_NAME: "acme",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: "legacy:example.test", OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: "legacy:example.test", default: true, from: "local" }]), OATS_TEAMS_SOURCE: "live",
    OATS_RUNTIME: "claude", OATS_SETTINGS: JSON.stringify(settings),
  };
  return { ws, home, env, stewardHome };
}

/** A spawner instance: its .aw, and its instance.json with this provider's meta. */
function spawner(fx, { chain = [HUMAN_CERT, STEWARD_CERT, LEAD_CERT], who, meta = { chainInstalled: true, identity: { mode: "local" } } } = {}) {
  const home = join(fx.ws, "agents", "lead", "instances", "lead-1");
  writeIdentity(home, { chain, who });
  writeFileSync(join(home, "instance.json"), JSON.stringify({ capabilityMeta: { "oats.aweb": meta } }));
  return home;
}

function spawn(fx, fake, env = {}) {
  const r = spawnSync(process.execPath, [HOOK, "spawn"], { cwd: fx.home, env: { ...fx.env, PATH: fake.path, OATS_EVENT: "spawn", ...env }, encoding: "utf8", timeout: 30000 });
  const doc = JSON.parse(r.stdout.trim().split("\n").pop() || "{}");
  return { status: r.status, doc, stderr: r.stderr };
}
const minted = (fake) => fake.calls().some((c) => c.args[0] === "init");
const chainCalls = (fake) => fake.calls().filter((c) => c.args[0] === "id" && ["child", "parent"].includes(c.args[1])).map((c) => `${c.args.slice(1, 3).join(" ")} @${c.cwd}`);

test("attribution absent: today's spawn, no chain calls and no attribution in the meta", (t) => {
  const fx = fixture(t, { attribution: null, steward: false });
  const fake = fakeAwChain(t);
  const { status, doc } = spawn(fx, fake);
  assert.equal(status, 0, JSON.stringify(doc));
  assert.equal(doc.meta.identity.attribution, undefined);
  assert.equal(doc.meta.chainInstalled, undefined);
  assert.deepEqual(chainCalls(fake), []);
  assert.equal(fake.calls().some((c) => c.args[0] === "who"), false);
});

test("a person's spawn: the steward issues, the child installs the chain, and the meta names human and parent", (t) => {
  const fx = fixture(t);
  const fake = fakeAwChain(t);
  const { status, doc } = spawn(fx, fake);
  assert.equal(status, 0, JSON.stringify(doc));
  assert.deepEqual(doc.meta.identity.attribution, { mode: "human", human: { id: HUMAN, label: "Juan" }, parent: { id: STEWARD } });
  assert.equal(doc.meta.chainInstalled, true);
  assert.deepEqual(chainCalls(fake), [
    `child invite @${fx.stewardHome}`, `parent request @${fx.home}`, `child receive @${fx.stewardHome}`, `child approve @${fx.stewardHome}`, `parent import @${fx.home}`,
  ]);
  const installed = JSON.parse(readFileSync(join(fx.home, ".aw", "id-chain.json"), "utf8"));
  assert.deepEqual(installed.certificates.map((c) => c.certificate.id), [HUMAN, STEWARD, "did:key:zdev-1"]);
  assert.ok(!JSON.stringify(doc.env).includes(".aweb-stewards"), "the steward's location never reaches the instance's environment");
  assert.ok(fake.calls().every((c) => c.identityHome === null), "no aw call carries an AWEB_IDENTITY_HOME");
  const request = fake.calls().find((c) => c.args[1] === "parent" && c.args[2] === "request");
  assert.equal(request.args[request.args.indexOf("--parent") + 1], STEWARD);
});

test("an instance's spawn: the spawner issues, so the child's parent is the spawner", (t) => {
  const fx = fixture(t);
  const lead = spawner(fx);
  const fake = fakeAwChain(t);
  const { status, doc } = spawn(fx, fake, { OATS_SPAWNER_HOME: lead });
  assert.equal(status, 0, JSON.stringify(doc));
  assert.deepEqual(doc.meta.identity.attribution, { mode: "human", human: { id: HUMAN, label: "Juan" }, parent: { id: LEAD } });
  assert.equal(chainCalls(fake)[0], `child invite @${lead}`);
  const installed = JSON.parse(readFileSync(join(fx.home, ".aw", "id-chain.json"), "utf8"));
  assert.deepEqual(installed.certificates.map((c) => c.certificate.id), [HUMAN, STEWARD, LEAD, "did:key:zdev-1"]);
});

test("refuses before minting on a kernel without spawn-attribution, naming the upgrade", (t) => {
  const fx = fixture(t, { features: [] });
  const fake = fakeAwChain(t);
  const { status, doc } = spawn(fx, fake);
  assert.equal(status, 1);
  assert.match(doc.warning, /spawn-attribution feature; this kernel \(0\.80\.0\) does not: upgrade OATS/);
  assert.equal(minted(fake), false);
});

test("refuses before minting when no human is bound, naming the binding act", (t) => {
  const fx = fixture(t, { steward: false });
  const fake = fakeAwChain(t);
  const { status, doc } = spawn(fx, fake);
  assert.equal(status, 1);
  assert.match(doc.warning, /no human is bound to this deployment: a human runs `oats aweb setup --steward/);
  assert.equal(minted(fake), false);
});

test("refuses before minting a revoked spawner chain, and never falls back to chainless", (t) => {
  const fx = fixture(t);
  const lead = spawner(fx, { who: { id: LEAD, outcome: "unknown", human_id: null, identity_valid: false, kind: null, reason: "revoked" } });
  const fake = fakeAwChain(t);
  const { status, doc } = spawn(fx, fake, { OATS_SPAWNER_HOME: lead });
  assert.equal(status, 1);
  assert.match(doc.warning, /the spawner's identity chain is revoked \(revoked\) → /);
  assert.equal(minted(fake), false);
});

test("refuses before minting when the registry evidence is unavailable", (t) => {
  const fx = fixture(t);
  const lead = spawner(fx, { who: { id: LEAD, outcome: "unavailable", human_id: null, identity_valid: null, kind: null, reason: "status_expired" } });
  const fake = fakeAwChain(t);
  const { status, doc } = spawn(fx, fake, { OATS_SPAWNER_HOME: lead });
  assert.equal(status, 1);
  assert.match(doc.warning, /chained spawning stops while it has been unreachable for over 60 s/);
  assert.equal(minted(fake), false);
});

test("a spawner that predates the binding creates a chainless child that reports unknown, with a warning", (t) => {
  const fx = fixture(t);
  const lead = spawner(fx, { chain: null, meta: { identity: { mode: "local" } } });
  const fake = fakeAwChain(t);
  const { status, doc } = spawn(fx, fake, { OATS_SPAWNER_HOME: lead });
  assert.equal(status, 0, JSON.stringify(doc));
  assert.deepEqual(doc.meta.identity.attribution, { mode: "unknown", human: null, parent: null });
  assert.equal(doc.meta.chainInstalled, false);
  assert.match(doc.warning, /the spawner has no identity chain \(it predates the human binding\)/);
  assert.deepEqual(chainCalls(fake), []);
});

test("refuses a spawner whose meta records an installed chain but whose chain files are gone", (t) => {
  const fx = fixture(t);
  const lead = spawner(fx, { chain: null });
  const fake = fakeAwChain(t);
  const { status, doc } = spawn(fx, fake, { OATS_SPAWNER_HOME: lead });
  assert.equal(status, 1);
  assert.match(doc.warning, /records an installed chain but its chain files are gone/);
  assert.equal(minted(fake), false);
});

test("refuses a resident-grant spawner in mode human: it holds no identity key to sign with", (t) => {
  const fx = fixture(t);
  const lead = spawner(fx, { meta: { identity: { mode: "global", grant: { id: "g1", home: "/x" } } } });
  const fake = fakeAwChain(t);
  const { status, doc } = spawn(fx, fake, { OATS_SPAWNER_HOME: lead });
  assert.equal(status, 1);
  assert.match(doc.warning, /acts through a session grant and holds no identity key to issue with → spawn it from a local-mode instance or from a shell/);
  assert.equal(minted(fake), false);
});

test("a refusal after the mint hands the minted identity back for compensation and installs no chain", (t) => {
  const fx = fixture(t);
  const fake = fakeAwChain(t);
  const { status, doc } = spawn(fx, fake, { FAKE_APPROVE_REFUSE: "depth_exceeded" });
  assert.equal(status, 1);
  assert.match(doc.warning, /identity chain issuance failed: .*depth_exceeded/);
  assert.deepEqual(doc.meta, { team: "legacy:example.test", alias: "dev-1" });
  assert.equal(existsSync(join(fx.home, ".aw", "id-chain.json")), false);
});

test("refuses a resulting chain over the limits before the child installs it", (t) => {
  for (const env of [{ FAKE_CHAIN_EXTRA: "6" }, { FAKE_CHAIN_PAD: "6200" }]) {
    const fx = fixture(t);
    const fake = fakeAwChain(t);
    const { status, doc } = spawn(fx, fake, env);
    assert.equal(status, 1, JSON.stringify(env));
    assert.match(doc.warning, /over the limit of (8|6144)/);
    assert.equal(doc.meta.alias, "dev-1");
    assert.equal(existsSync(join(fx.home, ".aw", "id-chain.json")), false);
    assert.equal(chainCalls(fake).some((c) => c.startsWith("parent import")), false);
  }
});
