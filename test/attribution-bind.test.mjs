// The bind's agent-side pieces (aweb-acrn): the person approves the steward in
// aweb Cloud, and the steward carries its own signed parent request there with
// `aw id request`. These are the rules that don't depend on how the steward is
// provisioned: the deployment label, the submission file, aw's --raw body, the
// bounded wait for the person's decision, and one error code per step.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BIND_STEPS,
  awaitDecision,
  bindStepFailure,
  deploymentLabel,
  rawBody,
  writeSubmission,
} from "../oats-package/capabilities/oats-aweb/lib/attribution-bind.mjs";

const tempDir = (t) => { const d = mkdtempSync(join(tmpdir(), "oats-bind-")); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test("the deployment label is <workspace name>-<short hostname>", () => {
  assert.equal(deploymentLabel("acme", "build-1.example.com"), "acme-build-1");
  assert.equal(deploymentLabel("acme", "build-1"), "acme-build-1");
});

test("a label over Cloud's 120-character limit is refused, naming why, never truncated", () => {
  const name = "w".repeat(110);
  assert.equal(deploymentLabel(name, "host1234"), `${name}-host1234`, "119 characters pass");
  assert.equal(deploymentLabel("w".repeat(111), "host1234").length, 120, "120 characters pass");
  assert.throws(() => deploymentLabel("w".repeat(112), "host1234"), (e) => e.code === "E_BIND_LABEL" && /121 characters.*at most 120.*workspace name/.test(e.message));
  // Characters, not UTF-16 units: an emoji counts once, as Cloud counts it.
  assert.equal(deploymentLabel("é".repeat(100) + "😀".repeat(10), "h12345678"), `${"é".repeat(100)}${"😀".repeat(10)}-h12345678`);
});

test("a label Cloud would change or refuse is refused here, so the click shows what was sent", () => {
  for (const [name, host] of [["", "h"], ["acme", ""], [" acme", "h"], ["acme\tx", "h"], ["acme\u202ex", "h"], ["acme\u200bx", "h"], [undefined, "h"], ["acme", undefined]]) {
    assert.throws(() => deploymentLabel(name, host), (e) => e.code === "E_BIND_LABEL", JSON.stringify([name, host]));
  }
});

test("--raw: exactly one trailing newline, the one aw adds, is stripped", () => {
  assert.equal(rawBody('{"v":1}\n'), '{"v":1}');
  assert.equal(rawBody('{"v":1}'), '{"v":1}');
  assert.equal(rawBody('{"v":1}\n\n'), '{"v":1}\n', "only one");
  assert.equal(rawBody(""), "");
});

test("the submission is {signed_request, deployment_label}, mode 600, the request as aw wrote it", (t) => {
  const dir = tempDir(t), file = join(dir, "submit.json");
  const signed = '{"v":1,"kind":"agent","proof":"x"}';
  writeSubmission(file, `${signed}\n`, "acme-build-1");
  const doc = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(doc), ["signed_request", "deployment_label"]);
  assert.equal(doc.signed_request, signed);
  assert.equal(doc.deployment_label, "acme-build-1");
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("the label travels in the envelope, never inside the signed request", (t) => {
  const dir = tempDir(t), file = join(dir, "submit.json");
  const signed = '{"v":1,"kind":"agent"}';
  writeSubmission(file, signed, "acme-build-1");
  const doc = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(doc.signed_request, signed, "the signed request is byte for byte what aw signed");
  assert.doesNotMatch(doc.signed_request, /acme-build-1|deployment_label/);
  assert.throws(() => writeSubmission(file, "", "acme-build-1"), (e) => e.code === "E_BIND_REQUEST");
});

test("an existing submission file is rewritten with mode 600", (t) => {
  const dir = tempDir(t), file = join(dir, "submit.json");
  writeFileSync(file, "old", { mode: 0o644 });
  writeSubmission(file, '{"v":1}', "acme-build-1");
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

const clock = () => { let now = 0; return { now: () => now, sleep: async (ms) => { now += ms; } }; };

test("the wait returns once the person approves and the response is issued", async () => {
  const seen = ["pending", "pending", "issued"];
  const c = clock();
  const result = await awaitDecision(async () => ({ status: seen.shift(), request_id: "r1" }), { timeoutMs: 60000, intervalMs: 5000, ...c });
  assert.equal(result.status, "issued");
  assert.equal(c.now(), 10000);
});

test("declined, expired, superseded and revoked are reported and never re-prompted (B2)", async () => {
  for (const [status, code] of [["declined", "E_BIND_DECLINED"], ["expired", "E_BIND_EXPIRED"], ["superseded", "E_BIND_SUPERSEDED"], ["revoked", "E_BIND_REVOKED"]]) {
    let reads = 0;
    await assert.rejects(awaitDecision(async () => { reads++; return { status, request_id: "r1" }; }, { timeoutMs: 60000, intervalMs: 5000, ...clock() }),
      (e) => e.code === code && e.message.includes("r1") && /nothing was signed|nothing is issued|was revoked/.test(e.message), status);
    assert.equal(reads, 1, `${status}: read once, not polled again`);
  }
});

test("the wait is bounded: still pending at the deadline stops, naming the request", async () => {
  const c = clock();
  let reads = 0;
  await assert.rejects(awaitDecision(async () => { reads++; return { status: "pending", request_id: "r1", expires_at: "2026-11-06T10:00:00Z" }; }, { timeoutMs: 30000, intervalMs: 10000, ...c }),
    (e) => e.code === "E_BIND_PENDING" && e.message.includes("r1") && e.message.includes("2026-11-06T10:00:00Z"));
  assert.equal(reads, 4, "reads at 0, 10, 20 and 30 seconds");
  assert.ok(c.now() <= 30000, "never sleeps past the deadline");
});

test("an unknown status stops the wait", async () => {
  await assert.rejects(awaitDecision(async () => ({ status: "weird", request_id: "r1" }), { timeoutMs: 1000, intervalMs: 500, ...clock() }), (e) => e.code === "E_BIND_STATUS" && e.message.includes("weird"));
});

test("each step's aw failure gets that step's code, with the HTTP status aw printed and Cloud's detail", () => {
  assert.deepEqual(Object.keys(BIND_STEPS), ["context", "request", "submit", "status", "response", "import", "record"]);
  const codes = Object.values(BIND_STEPS).map((s) => s.code);
  assert.equal(new Set(codes).size, codes.length, "one code per step");
  const e = bindStepFailure("submit", { status: 1, stdout: '{"detail":"Only this agent may submit or fetch its adoption request"}\n', stderr: "HTTP 403\nError: request failed with status 403\n" });
  assert.equal(e.code, "E_BIND_SUBMIT");
  assert.match(e.message, /HTTP 403/);
  assert.match(e.message, /Only this agent may submit/);
  const noHttp = bindStepFailure("context", { status: 1, stdout: "", stderr: "Error: current identity has no local signing key\n" });
  assert.equal(noHttp.code, "E_BIND_CONTEXT");
  assert.match(noHttp.message, /no local signing key/);
  assert.throws(() => bindStepFailure("nope", { status: 1 }), /unknown bind step/);
});
