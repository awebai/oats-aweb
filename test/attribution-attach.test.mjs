// Attribution attach (acmj, oats#1665 §3 slice 2): an existing chainless
// local instance gets a chain for its existing key, from the parent the spawn
// rule would have chosen. These are the rules, one test per rule; the command
// and the start-time attach are tested through the hook.
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { attachParents, didKeyFromPublicKey, exchangeChain, homeKeyIds, issuerSelection } from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";
import { fakeAwChain, writeIdentity } from "./helpers/fake-aw-chain.mjs";

const pem = (seedHex) => `-----BEGIN ED25519 PRIVATE KEY-----\n${Buffer.from(seedHex, "hex").toString("base64")}\n-----END ED25519 PRIVATE KEY-----\n`;
function home(t, signingKey) {
  const dir = mkdtempSync(join(tmpdir(), "oats-aweb-attach-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".aw"));
  if (signingKey !== undefined) writeFileSync(join(dir, ".aw", "signing.key"), signingKey);
  return dir;
}

test("did:key encoding matches aw's W3C vectors", () => {
  assert.equal(didKeyFromPublicKey(Buffer.from("2e6fcce36701dc791488e0d0b1745cc1e33a4c1c9fcc41c63bd343dbbe0970e6", "hex")), "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK");
  assert.equal(didKeyFromPublicKey(Buffer.from("095f9a1a595dde755d82786864ad03dfa5a4fbd68832566364e2b65e13cc9e44", "hex")), "did:key:z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP");
});

test("a home's current key is read from its signing key, never from a did (RFC 8032 seed vector)", (t) => {
  // RFC 8032 §7.1 test 1: this seed's public key is d75a9801…511a.
  const dir = home(t, pem("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"));
  writeFileSync(join(dir, ".aw", "did"), "did:key:zSomethingElse");
  const ids = homeKeyIds(dir);
  assert.equal(ids.didKey, didKeyFromPublicKey(Buffer.from("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex")));
  assert.match(ids.stableId, /^did:aw:[1-9A-HJ-NP-Za-km-z]+$/);
});

test("a home without a readable signing key has no current key", (t) => {
  for (const key of [undefined, "not a pem\n", pem("00")]) assert.equal(homeKeyIds(home(t, key)), null, JSON.stringify(key));
});

// A deployment's homes as attach sees them: path, name, the kernel's record
// (spawnedBy, parentInstance) and the identity's id.
const STEWARD = { id: "did:aw:steward", home: "/d/.aweb-stewards/s" };
const node = (instance, record, did = `did:key:z${instance}`) => ({ instance, home: `/d/agents/x/instances/${instance}`, record, did });
const by = (nodes) => Object.fromEntries(attachParents(nodes).map((r) => [r.instance, r]));

test("parent rule (C1): the recorded spawner; null means a person's spawn, issued by the steward", () => {
  const r = by([
    node("lead", { spawnedBy: null }),
    node("dev", { spawnedBy: { instance: "lead", home: "/d/agents/x/instances/lead" }, parentInstance: "lead", relation: "child" }),
    node("side", { spawnedBy: { instance: "lead", home: "/d/agents/x/instances/lead" }, relation: "unrelated" }),
    node("manual", { spawnedBy: null, parentInstance: "lead", relation: "child" }),
  ]);
  assert.deepEqual([r.lead.parent, r.dev.parent?.instance, r.side.parent?.instance, r.manual.parent], [null, "lead", "lead", null]);
});

test("parent rule (C1): a home spawned before the kernel recorded spawners takes its OATS parent, else the steward", () => {
  const r = by([node("lead", {}), node("dev", { parentInstance: "lead" }), node("orphan", { parentInstance: "gone" })]);
  assert.deepEqual([r.lead.parent, r.dev.parent?.instance, r.orphan.parent], [null, "lead", null]);
});

test("parent rule: a spawner that is no longer listed, or a malformed record, falls to the steward", () => {
  const r = by([node("dev", { spawnedBy: { instance: "gone", home: "/d/agents/x/instances/gone" } }), node("odd", { spawnedBy: { home: 3 }, parentInstance: "dev" })]);
  assert.deepEqual([r.dev.parent, r.odd.parent], [null, null]);
});

test("C1: for every home whose spawner is recorded, attach chooses the issuer the spawn chose", () => {
  const nodes = [
    node("root", { spawnedBy: null }),
    node("a", { spawnedBy: { instance: "root", home: "/d/agents/x/instances/root" }, parentInstance: "root" }),
    node("b", { spawnedBy: { instance: "a", home: "/d/agents/x/instances/a" }, relation: "unrelated" }),
    node("c", { spawnedBy: null, parentInstance: "a" }),
    node("d", { spawnedBy: { instance: "b", home: "/d/agents/x/instances/b" }, siblingInstance: "c", relation: "sibling" }),
  ];
  const attach = by(nodes);
  for (const n of nodes) {
    const spawn = issuerSelection({ spawnerHome: n.record.spawnedBy?.home, steward: STEWARD });
    assert.equal(attach[n.instance].parent?.home ?? STEWARD.home, spawn.home, n.instance);
  }
});

test("a did:aw under a local parent takes its nearest registered ancestor, else the steward", () => {
  const r = by([
    node("glob", { spawnedBy: null }, "did:aw:glob"),
    node("local", { spawnedBy: { instance: "glob", home: "/d/agents/x/instances/glob" } }),
    node("seat", { spawnedBy: { instance: "local", home: "/d/agents/x/instances/local" } }, "did:aw:seat"),
    node("lone", { spawnedBy: { instance: "local2", home: "/d/agents/x/instances/local2" } }, "did:aw:lone"),
    node("local2", { spawnedBy: null }),
  ]);
  assert.deepEqual([r.seat.parent?.instance, r.lone.parent, r.local.parent?.instance], ["glob", null, "glob"]);
});

test("order: every parent comes before its children", () => {
  const order = attachParents([
    node("c", { spawnedBy: { instance: "b", home: "/d/agents/x/instances/b" } }),
    node("b", { spawnedBy: { instance: "a", home: "/d/agents/x/instances/a" } }),
    node("a", { spawnedBy: null }),
  ]).map((r) => r.instance);
  assert.deepEqual(order, ["a", "b", "c"]);
});

test("a record that loops back on itself still places every home once, the steward closing the loop", () => {
  const order = attachParents([
    node("p", { spawnedBy: { instance: "q", home: "/d/agents/x/instances/q" } }),
    node("q", { spawnedBy: { instance: "p", home: "/d/agents/x/instances/p" } }),
  ]);
  assert.deepEqual(order.map((r) => r.instance).sort(), ["p", "q"]);
  assert.equal(order[0].parent, null);
  assert.equal(order[1].parent?.instance, order[0].instance);
});

// The agent-child exchange, shared by spawn and attach.
const HUMAN_CERT = { id: "did:aw:human1", kind: "human", parent: { kind: "namespace", id: "awtest-demo.example" } };
const STEWARD_CERT = { id: "did:aw:steward1", kind: "agent", parent: { kind: "identity", id: "did:aw:human1" } };
function exchangeFixture(t, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "oats-aweb-exchange-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const issuer = join(dir, "steward"), child = join(dir, "child");
  writeIdentity(issuer, { did: "did:aw:steward1", chain: [HUMAN_CERT, STEWARD_CERT] });
  writeIdentity(child, { did: "did:key:zchild" });
  const fake = fakeAwChain(t);
  const run = (argv, cwd) => execFileSync(argv[0], argv.slice(1), { cwd, encoding: "utf8", env: { PATH: fake.path, ...env }, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const go = (expectedSubjectKey) => exchangeChain({ issuerHome: issuer, childHome: child, recipient: "child", stateDir: join(child, ".oats-aweb", "attribution"), run, parseJson: (text) => JSON.parse(text), expectedSubjectKey });
  return { issuer, child, fake, go };
}
const steps = (fake) => fake.calls().filter((c) => c.args[0] === "id").map((c) => c.args.slice(1, 3).join(" "));

test("exchange: the issuer approves only a request for the home's own key, then the home installs the chain", (t) => {
  const fx = exchangeFixture(t);
  fx.go("did:key:zchild");
  assert.deepEqual(steps(fx.fake), ["child invite", "parent request", "child receive", "child approve", "parent import"]);
  assert.equal(existsSync(join(fx.child, ".aw", "id-chain.json")), true);
});

test("key boundary: a request whose subject_key is not the home's key is refused before the issuer receives it", (t) => {
  const fx = exchangeFixture(t);
  assert.throws(() => fx.go("did:key:zsomeoneelse"), (e) => e.code === "E_ATTACH_KEY_MISMATCH" && /not this home's key/.test(e.message));
  assert.deepEqual(steps(fx.fake), ["child invite", "parent request"]);
  assert.equal(existsSync(join(fx.child, ".aw", "id-chain.json")), false);
});

test("exchange: aw's refusal reason is carried as E_ATTACH_PARENT_REFUSED, and nothing is installed", (t) => {
  const fx = exchangeFixture(t, { FAKE_APPROVE_REFUSE: "parent_revoked" });
  assert.throws(() => fx.go("did:key:zchild"), (e) => e.code === "E_ATTACH_PARENT_REFUSED" && e.reason === "parent_revoked");
  assert.equal(existsSync(join(fx.child, ".aw", "id-chain.json")), false);
});

test("exchange: a resulting chain over aw's limits is refused before the home installs it", (t) => {
  const fx = exchangeFixture(t, { FAKE_CHAIN_EXTRA: "7" });
  assert.throws(() => fx.go("did:key:zchild"), (e) => e.code === "E_ATTACH_PARENT_REFUSED" && e.reason === "chain_limit");
  assert.equal(existsSync(join(fx.child, ".aw", "id-chain.json")), false);
});
