// The agent status document (aweb-acah.3) against aweb's frozen conformance
// vector, docs/vectors/agent-status-v1.json at aweb 9e2d4e255 (sha256
// 587d3b411b17327ec03ac9bb6938cb756359ce0907425807f39f3885d8a0c287). The
// fixture is a byte copy: changing it needs a new vector version on the aweb
// side. Every valid case canonicalizes to its exact bytes and verifies; every
// invalid case is refused with its one expected code; the cross-type entry
// shows a status signature does not verify as a message.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalBytes, checkDocument, verifyStatus, verifySignature } from "../oats-package/capabilities/oats-aweb/lib/status-document.mjs";

const FIXTURE = new URL("./fixtures/agent-status-v1.json", import.meta.url);
const VECTOR_SHA256 = "587d3b411b17327ec03ac9bb6938cb756359ce0907425807f39f3885d8a0c287";
const vector = JSON.parse(readFileSync(FIXTURE, "utf8"));
const at = (iso) => Date.parse(iso);
const verify = (c) => verifyStatus({ signed_payload: c.signed_payload, signature: c.signature }, { now: at(c.now), signerDid: vector.publisher_did_key, storedSeq: c.stored_seq });

test("the fixture is the frozen vector, byte for byte", () => {
  assert.equal(createHash("sha256").update(readFileSync(FIXTURE)).digest("hex"), VECTOR_SHA256);
  assert.equal(vector.valid.length + vector.invalid.length + 1, 39);
});

for (const c of vector.valid) {
  test(`valid ${c.name}: canonical bytes, signed_payload and signature agree with the vector`, () => {
    assert.equal(canonicalBytes(c.document).toString("utf8"), c.canonical_payload);
    assert.equal(canonicalBytes(c.document).toString("base64url"), c.signed_payload);
    assert.deepEqual(verify(c), { ok: true, document: c.document });
  });

  test(`valid ${c.name}: the publisher's pre-send check accepts the document`, () => {
    assert.deepEqual(checkDocument(c.document, { now: at(c.now) }), { ok: true });
  });
}

for (const c of vector.invalid) {
  test(`invalid ${c.name}: refused with ${c.error}`, () => {
    const result = verify(c);
    assert.equal(result.ok, false);
    assert.equal(result.error, c.error);
    assert.equal(typeof result.message, "string");
  });
}

test("cross-type: a status signature does not verify over message verification's canonical payload", () => {
  const x = vector.cross_type;
  assert.equal(verifySignature(Buffer.from(x.message_canonical_payload, "utf8"), x.signature, vector.publisher_did_key), false);
  assert.equal(verifySignature(canonicalBytes(x.document), x.signature, vector.publisher_did_key), true);
});

test("the pre-send check refuses a document it would never publish, with the vector's codes", () => {
  const good = vector.valid.find((c) => c.name === "reachable_no");
  const now = at(good.now);
  const without = (key) => Object.fromEntries(Object.entries(good.document).filter(([k]) => k !== key));
  assert.deepEqual(checkDocument({ ...good.document, note: "x" }, { now }).error, "unknown_field");
  assert.deepEqual(checkDocument(without("fixing"), { now }).error, "missing_field");
  assert.deepEqual(checkDocument({ ...good.document, seq: 2 ** 53 }, { now }).error, "invalid_value");
  assert.deepEqual(checkDocument({ ...good.document, reason: { code: "oats.x", text: "a\nb" } }, { now }).error, "control_character");
  assert.deepEqual(checkDocument({ ...good.document, type: "mail" }, { now }).error, "wrong_type");
});
