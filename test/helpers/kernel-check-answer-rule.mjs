import assert from "node:assert/strict";

const PROVIDER_STATUS_ITEM = Object.freeze({ ready: "pass", "needs-configuration": "fail", "authorization-required": "fail", unavailable: "unknown" });
const ENVELOPE_KEYS = ["schemaVersion", "phase", "slot", "capability", "ok"];

function obj(x) { return x && typeof x === "object" && !Array.isArray(x); }
function validProblems(p) { return Array.isArray(p) && p.every((x) => obj(x) && typeof x.code === "string" && typeof x.message === "string"); }

export function assertKernelCheckAnswerRule(stdout, request, label = "provider check") {
  let doc;
  assert.doesNotThrow(() => { doc = JSON.parse(stdout || ""); }, `${label}: stdout must be exactly one JSON document`);
  assert.ok(obj(doc), `${label}: envelope must be an object`);
  const allowed = [...ENVELOPE_KEYS, doc.ok === true ? "result" : "error"];
  assert.deepEqual(Object.keys(doc).sort(), allowed.slice().sort(), `${label}: envelope keys must match the kernel binding check envelope`);
  for (const key of ["schemaVersion", "phase", "slot", "capability"]) assert.equal(doc[key], request[key], `${label}: envelope ${key} must echo request`);
  if (doc.ok === false) {
    assert.ok(obj(doc.error), `${label}: error must be an object`);
    assert.equal(typeof doc.error.code, "string", `${label}: error.code must be a string`);
    if (doc.error.message !== undefined) assert.equal(typeof doc.error.message, "string", `${label}: error.message must be a string`);
    return doc;
  }
  const res = doc.result;
  assert.equal(doc.ok, true, `${label}: ok must be true or false`);
  assert.ok(obj(res), `${label}: result must be an object`);
  assert.equal(Object.keys(res).some((k) => !["status", "problems", "warnings"].includes(k)), false, `${label}: result keys must be only status/problems/warnings`);
  assert.ok(Object.hasOwn(PROVIDER_STATUS_ITEM, res.status), `${label}: status must be a kernel provider status`);
  assert.ok(validProblems(res.problems), `${label}: problems must be {code,message}[]`);
  if (res.warnings !== undefined) assert.ok(validProblems(res.warnings), `${label}: warnings must be {code,message}[]`);
  assert.equal(res.status === "ready" && res.problems.length > 0, false, `${label}: ready results must not carry problems`);
  return doc;
}
