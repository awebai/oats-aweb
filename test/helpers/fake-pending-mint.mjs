// What aw leaves in an identity home when it stops a mint as signature pending
// (aw 1.36.58 / 1.36.59-rc.3 hosted_invite_creation.go, acceptance_key_marker.go):
// the member's key, hosted-invite-creation.json (token_hash, did_key, id_tree.request_id;
// never the token) and the pending-hosted-accept marker. Embedded in CommonJS fakes
// as source: `(${pendingMintFake})(awDir)`; returns the key's did:key.
export function pendingMintFake(awDir) {
  const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const der = privateKey.export({ format: "der", type: "pkcs8" });
  fs.mkdirSync(awDir, { recursive: true });
  fs.writeFileSync(path.join(awDir, "signing.key"), "-----BEGIN ED25519 PRIVATE KEY-----\n" + Buffer.from(der.subarray(der.length - 32)).toString("base64") + "\n-----END ED25519 PRIVATE KEY-----\n", { mode: 0o600 });
  const raw = Buffer.concat([Buffer.from([0xed, 1]), publicKey.export({ format: "der", type: "spki" }).subarray(-32)]);
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + raw.toString("hex")), b58 = "";
  while (n) { b58 = alphabet[Number(n % 58n)] + b58; n /= 58n; }
  const did = "did:key:z" + b58;
  fs.writeFileSync(path.join(awDir, "hosted-invite-creation.json"), JSON.stringify({ token_hash: crypto.randomBytes(32).toString("hex"), did_key: did, team_id: "fixture:example.invalid", id_tree: { request_id: crypto.randomUUID() }, request_ready: true }));
  fs.writeFileSync(path.join(awDir, "pending-hosted-accept"), "pending hosted accept\n");
  return did;
}
