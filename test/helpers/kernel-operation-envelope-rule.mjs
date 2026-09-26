import assert from "node:assert/strict";

// Vendored from oats bin/oats.mjs `finishOperation` (identical at oats main
// 371b1d16 and in the published @awebai/oats 0.27.2): the receipt rule
// `oats operation run` applies to a provider command it ran with
// OATS_OPERATION=<address> and --json. Only the shape check and the
// exit-status agreement are copied; view-document and launch-receipt rules do
// not apply to oats.aweb's action operations.
//
// Returns what the kernel would do with the process result:
//   { verdict: "ok", result }                       relayed as success
//   { verdict: "provider-failure", code, message }  relayed as the provider's own failure
//   { verdict: "E_OPERATION_RESULT", reason }       rejected: not a trusted receipt
export function kernelOperationVerdict({ status, stdout }) {
  let envelope;
  try { envelope = JSON.parse(String(stdout || "").trim()); } catch { envelope = undefined; }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || envelope.schemaVersion !== 1 || typeof envelope.ok !== "boolean") {
    return { verdict: "E_OPERATION_RESULT", reason: `did not answer exactly one JSON-v1 envelope on stdout (exit ${status})` };
  }
  if (!envelope.ok) return { verdict: "provider-failure", code: envelope.error?.code || "E_OPERATION_FAILED", message: envelope.error?.message || "failed", envelope };
  if (status !== 0) return { verdict: "E_OPERATION_RESULT", reason: `answered ok but exited ${status}` };
  const result = envelope.result && typeof envelope.result === "object" ? envelope.result : {};
  return { verdict: "ok", result, envelope };
}

/** Assert the kernel accepts this answer, with the expected outcome. Stricter
 *  than the kernel on one point, per the operation contract: a failure
 *  envelope must come with a nonzero exit. */
export function assertKernelOperationAnswer(r, { ok, label = "operation" } = {}) {
  const v = kernelOperationVerdict(r);
  assert.notEqual(v.verdict, "E_OPERATION_RESULT", `${label}: kernel would reject the receipt (${v.reason}); stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(String(r.stderr || "").slice(0, 400))}`);
  assert.equal(String(r.stdout).trim().split("\n").length, 1, `${label}: stdout must be one line holding one envelope`);
  if (ok) assert.equal(v.verdict, "ok", `${label}: expected success, got ${JSON.stringify(v)}`);
  else {
    assert.equal(v.verdict, "provider-failure", `${label}: expected a failure envelope, got ${JSON.stringify(v)}`);
    assert.notEqual(r.status, 0, `${label}: a failure envelope needs a nonzero exit`);
    assert.equal(typeof v.message, "string");
  }
  return v;
}
