// Attribution attach (acmj, oats#1665 §3 slice 2): an existing chainless
// local instance gets a chain for its existing key, from the parent the spawn
// rule would have chosen. These are the rules, one test per rule; the command
// and the start-time attach are tested through the hook.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { didKeyFromPublicKey, homeKeyIds } from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";

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
