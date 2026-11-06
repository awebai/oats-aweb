// The release lane's draft read of #176: the start reads the same listing of
// homes as the plan, a recorded path is resolved before it is trusted, and a
// home's lock left by a start that died is taken over.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { attachHome, awInHome, startAttach } from "../oats-package/capabilities/oats-aweb/lib/attach.mjs";
import { homeKeyIds } from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";
import { fakeAwChain } from "./helpers/fake-aw-chain.mjs";

const HUMAN = "did:aw:human1", STEWARD = "did:aw:steward1";
const cert = (id, kind, parent) => ({ certificate: { id, kind, domain: "awtest-demo.example", parent }, signature: "s" });
const CHAIN = [cert(HUMAN, "human", { kind: "namespace", id: "awtest-demo.example" }), cert(STEWARD, "agent", { kind: "identity", id: HUMAN })];

function identity(dir, { chained = false } = {}) {
  mkdirSync(join(dir, ".aw"), { recursive: true });
  const seed = Buffer.from(generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" }).d, "base64url");
  writeFileSync(join(dir, ".aw", "signing.key"), `-----BEGIN ED25519 PRIVATE KEY-----\n${seed.toString("base64")}\n-----END ED25519 PRIVATE KEY-----\n`);
  const id = homeKeyIds(dir).didKey;
  writeFileSync(join(dir, ".aw", "did"), id);
  if (chained) writeFileSync(join(dir, ".aw", "id-chain.json"), JSON.stringify({ v: 1, type: "aweb.id-chain", certificates: [...CHAIN, cert(id, "agent", { kind: "identity", id: STEWARD })] }));
  return id;
}
function deployment(t) {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-attach-listing-")));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const steward = join(ws, ".aweb-stewards", "s");
  mkdirSync(join(steward, ".aw"), { recursive: true });
  writeFileSync(join(steward, ".aw", "did"), STEWARD);
  writeFileSync(join(steward, ".aw", "id-chain.json"), JSON.stringify({ v: 1, type: "aweb.id-chain", certificates: CHAIN }));
  const settings = { attribution: "human", human: { id: HUMAN, label: "Juan" }, steward: { id: STEWARD, home: steward } };
  const fake = fakeAwChain(t);
  const home = (name, record, opts) => { const h = join(ws, "agents", "dev", "instances", name); identity(h, opts); writeFileSync(join(h, "instance.json"), JSON.stringify({ instance: name, ...record })); return h; };
  /** `oats status` for this deployment: the homes listed, by default all. */
  const listing = (except = []) => () => ({ known: true, rows: readdirSync(join(ws, "agents", "dev", "instances")).filter((n) => !except.includes(n)).map((n) => ({ instance: n, home: join(ws, "agents", "dev", "instances", n) })) });
  const start = (h, name, listHomes) => startAttach({ home: h, instance: name, settings, deployment: ws, local: true, env: { PATH: fake.path }, listHomes });
  return { ws, steward, settings, fake, home, listing, start };
}
const inviteCwd = (fake) => fake.calls().find((c) => c.args[0] === "id" && c.args[1] === "child" && c.args[2] === "invite")?.cwd;

test("a recorded spawner that oats status doesn't list (retired, its instance.json left) is no parent at start, as in the plan", (t) => {
  const fx = deployment(t);
  const retired = fx.home("retired", { spawnedBy: null }, { chained: true });
  const c = fx.home("c", { spawnedBy: { instance: "retired", home: retired } });
  assert.deepEqual(fx.start(c, "c", fx.listing(["retired"])), { attach: undefined, note: null });
  assert.equal(inviteCwd(fx.fake), fx.steward);
});

test("a legacy parentInstance that oats status doesn't list is no parent at start either", (t) => {
  const fx = deployment(t);
  fx.home("old", { spawnedBy: null }, { chained: true });
  const c = fx.home("c", { parentInstance: "old" });
  fx.start(c, "c", fx.listing(["old"]));
  assert.equal(inviteCwd(fx.fake), fx.steward);
});

test("a recorded spawner path is resolved before it is trusted: `..` can't name a home outside the listing", (t) => {
  const fx = deployment(t);
  const outside = join(fx.ws, "elsewhere", "x");
  identity(outside, { chained: true });
  writeFileSync(join(outside, "instance.json"), JSON.stringify({ instance: "x", spawnedBy: null }));
  const c = fx.home("c", { spawnedBy: { instance: "x", home: `${fx.ws}/agents/../elsewhere/x` } });
  fx.start(c, "c", fx.listing());
  assert.equal(inviteCwd(fx.fake), fx.steward);
});

test("a start that can't read the deployment's listing waits, warning, with no exchange", (t) => {
  const fx = deployment(t);
  const c = fx.home("c", { spawnedBy: null });
  const r = fx.start(c, "c", () => ({ known: false, reason: "oats status did not answer" }));
  assert.match(r.note, /\(E_ATTACH_FAILED\).*oats status did not answer.*the next start tries again/);
  assert.equal(inviteCwd(fx.fake), undefined);
});

test("a start never attaches its own home when oats status doesn't list it: no aw call, no provider state", (t) => {
  for (const listHomes of ["self excluded", "empty"]) {
    const fx = deployment(t);
    const c = fx.home("c", { spawnedBy: null });
    const r = fx.start(c, "c", listHomes === "empty" ? () => ({ known: true, rows: [] }) : fx.listing(["c"]));
    assert.equal(r.attach, undefined, listHomes);
    assert.match(r.note, /\(E_ATTACH_FAILED\): this home is not among the homes `oats status` lists for this deployment, so attach never touches it/, listHomes);
    assert.deepEqual(fx.fake.calls(), [], listHomes);
    assert.equal(existsSync(join(c, ".oats-aweb")), false, listHomes);
    assert.equal(existsSync(join(c, ".aw", "id-chain.json")), false, listHomes);
  }
  // Listed through a link to it, the same home is its own.
  const fx = deployment(t);
  const c = fx.home("c", { spawnedBy: null });
  const link = join(fx.ws, "link-to-c");
  symlinkSync(c, link);
  assert.deepEqual(fx.start(c, "c", () => ({ known: true, rows: [{ instance: "c", home: link }] })), { attach: undefined, note: null });
  assert.equal(existsSync(join(c, ".aw", "id-chain.json")), true);
});

test("a home's lock left by a start that died is taken over; a running one still refuses", (t) => {
  const fx = deployment(t);
  const c = fx.home("c", { spawnedBy: null });
  const lock = join(c, ".oats-aweb", "attribution", "attach.lock");
  mkdirSync(join(c, ".oats-aweb", "attribution"), { recursive: true });
  writeFileSync(lock, `${process.pid}\n`);
  const entry = { instance: "c", home: c, parent: { steward: true, home: fx.steward } };
  assert.throws(() => attachHome({ entry, run: awInHome({ PATH: fx.fake.path }) }), (e) => e.code === "E_ATTACH_FAILED" && /already running|is running/.test(e.message));
  writeFileSync(lock, "999999999\n");
  attachHome({ entry, run: awInHome({ PATH: fx.fake.path }) });
  assert.equal(existsSync(join(c, ".aw", "id-chain.json")), true);
  assert.equal(existsSync(lock), false);
});
