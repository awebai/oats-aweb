// `oats aweb setup --steward` (aweb-acrn): the deployment's steward carries its
// own signed parent request to aweb Cloud, the person approves it there, and
// the steward imports the issued chain. Run through the command, against the
// fake aw and Cloud of helpers/fake-aw-bind.mjs and a fake kernel.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CLOUD, HUMAN, STEWARD, fakeBindAw, seedSteward } from "./helpers/fake-aw-bind.mjs";

const HOOK = fileURLToPath(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url));
const KEY = "aw_sk_bind_KEYVALUE_77a1";
const LABEL = `acme-${hostname().split(".")[0]}`;
const APPROVAL = `${CLOUD}/account/adoptions/${STEWARD.agentId}/req-1?team_id=t1`;

function setup(t, { cloud = {}, workspaceName = "acme", features = ["spawn-attribution"], settings = {} } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-bind-flow-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const deployment = join(base, "deploy"), home = join(base, "home");
  mkdirSync(deployment); mkdirSync(home);
  writeFileSync(join(deployment, "oats-local.yaml"), "schemaVersion: 2\nworkspace: local\n");
  const fake = fakeBindAw(base, cloud);
  const kernel = join(base, "kernel.mjs");
  writeFileSync(kernel, `const a = process.argv.slice(2);
if (a[0] === "--version") console.log(JSON.stringify({ schemaVersion: 1, name: "@awebai/oats", version: "0.70.0", features: ${JSON.stringify(features)} }));
else if (a[0] === "workspace" && a[1] === "status") console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { workspace: { name: ${JSON.stringify(workspaceName)} } } }));
else { console.log(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_FAKE", message: a.join(" ") } })); process.exit(1); }
`);
  const steward = join(deployment, ".aweb-stewards", STEWARD.alias);
  const env = { PATH: `${fake.bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, OATS_TEAM_SCOPE: deployment, OATS_SETTINGS: JSON.stringify(settings), OATS_CLI_BIN: kernel, AWEB_URL: `${CLOUD}/api`, AWEB_API_KEY: KEY };
  const run = (args = [], extra = {}) => {
    const r = spawnSync(process.execPath, [HOOK, "setup", "--steward", "--name", STEWARD.alias, "--json", ...args], { env: { ...env, ...extra }, cwd: deployment, encoding: "utf8", input: "", timeout: 60000 });
    let doc; try { doc = JSON.parse(r.stdout.trim().split("\n").at(-1)); } catch { doc = undefined; }
    return { ...r, doc };
  };
  const localYaml = () => readFileSync(join(deployment, "oats-local.yaml"), "utf8");
  const cloudCalls = () => fake.calls().filter((c) => c.args[0] === "id" && c.args[1] === "request" && !c.args.includes("--help"));
  return { base, deployment, steward, env, fake, run, localYaml, cloudCalls, bindDir: join(steward, ".oats-bind") };
}

test("a first run makes the steward, submits its request with the label, and stops for the person's click, recording nothing", (t) => {
  const fx = setup(t, { cloud: { statuses: ["pending"] } });
  const r = fx.run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.doc.error.code, "E_BIND_PENDING");
  const d = r.doc.error.details;
  assert.equal(d.approvalUrl, APPROVAL);
  assert.deepEqual(d.shows, { address: `${STEWARD.domain}/${STEWARD.alias}`, domain: STEWARD.domain, deploymentLabel: LABEL, fingerprint: d.shows.fingerprint });
  assert.match(d.shows.fingerprint, /^SHA256:[0-9a-f]{64}$/);
  assert.match(r.doc.error.message, new RegExp(APPROVAL.replace(/[.?]/g, "\\$&")));
  for (const shown of [STEWARD.domain, LABEL, d.shows.fingerprint, `${STEWARD.domain}/${STEWARD.alias}`]) assert.ok(r.doc.error.message.includes(shown), shown);
  assert.equal(fx.localYaml(), "schemaVersion: 2\nworkspace: local\n", "nothing is recorded before the import");
  // The key reached `aw init` alone.
  const calls = fx.fake.calls();
  assert.deepEqual(calls.filter((c) => c.env.AWEB_API_KEY !== null).map((c) => c.args[0]), ["init"]);
  assert.ok(calls.every((c) => c.env.AWEB_IDENTITY_HOME === null));
  assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY));
  // Every Cloud call is aw's, signed by the steward, in its home.
  assert.ok(fx.cloudCalls().every((c) => c.cwd === fx.steward));
  assert.deepEqual(fx.cloudCalls().map((c) => [c.args[2], new URL(c.args[3]).pathname]), [
    ["GET", `/api/v1/agent-adoptions/${STEWARD.agentId}`],
    ["POST", `/api/v1/agent-adoptions/${STEWARD.agentId}/requests`],
    ["GET", `/api/v1/agent-adoptions/${STEWARD.agentId}/requests/req-1`],
  ]);
});

test("the POSTed envelope carries deployment_label beside the signed request, never inside it", (t) => {
  const fx = setup(t, { cloud: { statuses: ["pending"] } });
  fx.run();
  const [sub] = fx.fake.submissions();
  assert.equal(sub.header, "Content-Type: application/json");
  const doc = JSON.parse(sub.body);
  assert.deepEqual(Object.keys(doc).sort(), ["deployment_label", "signed_request"]);
  assert.equal(doc.deployment_label, LABEL);
  const request = readFileSync(join(fx.bindDir, "request.json"), "utf8");
  assert.equal(doc.signed_request, request.replace(/\n$/, ""), "the signed request is aw's file, byte for byte, less aw's final newline");
  assert.ok(!doc.signed_request.includes(LABEL) && !doc.signed_request.includes("deployment_label"), "the label is not in the CSR");
  const parent = fx.fake.calls().find((c) => c.args[1] === "parent" && c.args[2] === "request");
  assert.deepEqual(parent.args.slice(3).filter((a) => a !== "--json"), ["--domain", STEWARD.domain, "--parent", HUMAN, "--invitation-id", JSON.parse(readFileSync(join(fx.bindDir, "context.json"), "utf8")).invitation_id, "--out", join(fx.bindDir, "request.json")]);
  assert.ok(!parent.args.some((a) => a.includes(LABEL)), "aw signs nothing with the label");
  assert.equal(statSync(join(fx.bindDir, "submit.json")).mode & 0o777, 0o600);
});

test("after the click, a rerun continues the same request: it imports the chain and records the human, the steward and attribution", (t) => {
  const fx = setup(t, { cloud: { statuses: ["pending"], importRefusesNewline: true } });
  fx.run();
  fx.fake.setCloud({ statuses: ["issued"], importRefusesNewline: true });
  const r = fx.run(["--label", "Ana Example"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.result.outcome, "bound");
  assert.equal(fx.fake.submissions().length, 1, "no second submission");
  assert.equal(fx.cloudCalls().filter((c) => c.args[2] === "GET" && !c.args[3].includes("/requests")).length, 1, "no second context, so no new invitation");
  const response = readFileSync(join(fx.bindDir, "response.json"), "utf8");
  assert.ok(!response.endsWith("\n"), "aw's added newline is gone before the import");
  assert.equal(statSync(join(fx.bindDir, "response.json")).mode & 0o777, 0o600);
  const imp = fx.fake.calls().find((c) => c.args[1] === "parent" && c.args[2] === "import");
  assert.deepEqual(imp.args.slice(3).filter((a) => a !== "--json"), [join(fx.bindDir, "response.json"), "--domain", STEWARD.domain]);
  const yaml = fx.localYaml();
  assert.match(yaml, new RegExp(`steward:\\n {6}"id": "${STEWARD.stableId}"\\n {6}"home": "${fx.steward.replace(/[.]/g, "\\.")}"`));
  assert.match(yaml, new RegExp(`human:\\n {6}"id": "${HUMAN}"\\n {6}"label": "Ana Example"`));
  assert.ok(yaml.trimEnd().endsWith('attribution: "human"'), "attribution is turned on last");
});

test("without --label the human is recorded by id alone", (t) => {
  const fx = setup(t, { cloud: { statuses: ["issued"] } });
  const r = fx.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(fx.localYaml(), new RegExp(`human:\\n {6}"id": "${HUMAN}"\\n {4}attribution`));
});

test("a declined or expired request is reported, nothing is recorded, and a rerun reports it again without submitting (B2)", (t) => {
  for (const [status, code] of [["declined", "E_BIND_DECLINED"], ["expired", "E_BIND_EXPIRED"]]) {
    const fx = setup(t, { cloud: { statuses: [status] } });
    let r = fx.run();
    assert.equal(r.doc.error.code, code, r.stdout);
    r = fx.run();
    assert.equal(r.doc.error.code, code);
    assert.match(r.doc.error.message, /bind again only if they want to/);
    assert.match(r.doc.error.message, /remove .*\.oats-bind, then run this command again/, "never certified, so a new request for the same steward works");
    assert.equal(fx.fake.submissions().length, 1, `${status}: submitted once`);
    assert.equal(fx.localYaml(), "schemaVersion: 2\nworkspace: local\n");
    assert.ok(!fx.fake.calls().some((c) => c.args[2] === "import"));
  }
});

test("an account with no person yet refuses, naming claim-human first, and submits nothing", (t) => {
  const fx = setup(t, { cloud: { context: { status: 409, body: { detail: "A recorded creator with a registered human is required; use browser adoption" } } } });
  const r = fx.run();
  assert.equal(r.doc.error.code, "E_BIND_NO_HUMAN", r.stdout);
  assert.match(r.doc.error.message, /claim-human/);
  assert.match(r.doc.error.message, /attach yourself to the account/);
  assert.equal(fx.fake.submissions().length, 0);
});

test("Cloud's 404 for the agent id is its own code: the id from aw workspace status is not a Cloud agent", (t) => {
  const fx = setup(t, { cloud: { context: { status: 404, body: { detail: "Agent not found" } } } });
  const r = fx.run();
  assert.equal(r.doc.error.code, "E_BIND_AGENT_NOT_FOUND", r.stdout);
  assert.match(r.doc.error.message, new RegExp(STEWARD.agentId));
});

test("other step failures name the step, the HTTP status and Cloud's detail", (t) => {
  const fx = setup(t, { cloud: { submit: { status: 403, body: { detail: "Only the recorded creator can approve this agent" } } } });
  const r = fx.run();
  assert.equal(r.doc.error.code, "E_BIND_SUBMIT", r.stdout);
  assert.match(r.doc.error.message, /HTTP 403: Only the recorded creator/);
  assert.equal(fx.localYaml(), "schemaVersion: 2\nworkspace: local\n");
});

test("a steward whose custody isn't self refuses before any Cloud call", (t) => {
  const fx = setup(t);
  seedSteward(fx.steward, { custody: "resident" });
  const r = fx.run();
  assert.equal(r.doc.error.code, "E_STEWARD_CUSTODY", r.stdout);
  assert.equal(fx.cloudCalls().length, 0);
});

test("an existing self-custodial steward is used as it is, with no init and no key", (t) => {
  const fx = setup(t, { cloud: { statuses: ["pending"] } });
  seedSteward(fx.steward);
  const r = fx.run([], { AWEB_API_KEY: "" });
  assert.equal(r.doc.error.code, "E_BIND_PENDING", r.stdout);
  assert.ok(!fx.fake.calls().some((c) => c.args[0] === "init"));
});

test("a label over 120 characters refuses before init or any Cloud call", (t) => {
  const fx = setup(t, { workspaceName: "w".repeat(130) });
  const r = fx.run();
  assert.equal(r.doc.error.code, "E_BIND_LABEL", r.stdout);
  assert.ok(!fx.fake.calls().some((c) => c.args[0] === "init" || (c.args[1] === "request" && !c.args.includes("--help"))));
});

test("a kernel without spawn-attribution refuses before anything runs", (t) => {
  const fx = setup(t, { features: [] });
  const r = fx.run();
  assert.equal(r.doc.error.code, "E_STEWARD_KERNEL", r.stdout);
  assert.ok(!fx.fake.calls().some((c) => c.args[0] === "init"));
});

test("no agent id from aw workspace status refuses before any Cloud call", (t) => {
  const fx = setup(t);
  seedSteward(fx.steward);
  writeFileSync(join(fx.steward, ".aw", "fake-no-agent-id"), "");
  const r = fx.run();
  assert.equal(r.doc.error.code, "E_BIND_AGENT_ID", r.stdout);
  assert.equal(fx.cloudCalls().length, 0);
});

test("--wait polls, bounded, until the person approves", (t) => {
  const fx = setup(t, { cloud: { statuses: ["pending", "issued"] } });
  const r = fx.run(["--wait", "10"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.result.outcome, "bound");
});

test("a bound deployment answers already-bound, and another steward is refused: one human per deployment", (t) => {
  const fx = setup(t, { cloud: { statuses: ["issued"] } });
  assert.equal(fx.run().status, 0);
  const settings = { human: { id: HUMAN }, steward: { id: STEWARD.stableId, home: fx.steward }, attribution: "human" };
  const before = fx.fake.calls().length;
  let r = fx.run([], { OATS_SETTINGS: JSON.stringify(settings) });
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.doc.result.outcome, "already-bound");
  assert.ok(fx.fake.calls().slice(before).every((c) => !(c.args[1] === "request" && !c.args.includes("--help"))), "no Cloud call");
  r = fx.run([], { OATS_SETTINGS: JSON.stringify({ ...settings, steward: { id: "did:aw:other", home: join(fx.deployment, ".aweb-stewards", "other") } }) });
  assert.equal(r.doc.error.code, "E_STEWARD_ONE_HUMAN", r.stdout);
});

test("usage: --name is required, and unknown flags refuse", (t) => {
  const fx = setup(t);
  const r = spawnSync(process.execPath, [HOOK, "setup", "--steward", "--json"], { env: { PATH: process.env.PATH, OATS_SETTINGS: "{}" }, encoding: "utf8", input: "" });
  assert.equal(r.status, 2);
  assert.equal(JSON.parse(r.stdout.trim()).error.code, "E_STEWARD_USAGE");
  assert.equal(fx.run(["--bogus"]).doc.error.code, "E_STEWARD_USAGE");
  assert.ok(!existsSync(fx.bindDir));
});

test("a record stopped after human.id is completed by the rerun, with no Cloud call, and only a complete record is already-bound", (t) => {
  const fx = setup(t, { cloud: { statuses: ["issued"] } });
  assert.equal(fx.run().status, 0);
  // What a run stopped after human.id leaves: steward and human, no attribution.
  const partial = `schemaVersion: 2\nworkspace: local\nsettings:\n  oats.aweb:\n    steward:\n      "id": "${STEWARD.stableId}"\n      "home": "${fx.steward}"\n    human:\n      "id": "${HUMAN}"\n`;
  writeFileSync(join(fx.deployment, "oats-local.yaml"), partial);
  const settings = { steward: { id: STEWARD.stableId, home: fx.steward }, human: { id: HUMAN } };
  const before = fx.cloudCalls().length;
  let r = fx.run(["--label", "Ana Example"], { OATS_SETTINGS: JSON.stringify(settings) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc.result.outcome, "bound", "completing a partial record is not already-bound");
  assert.equal(fx.cloudCalls().length, before, "no Cloud call");
  assert.ok(fx.localYaml().trimEnd().endsWith('attribution: "human"'));
  assert.match(fx.localYaml(), /"label": "Ana Example"/);
  // attribution: none set on purpose: the bind turns it on again.
  r = fx.run([], { OATS_SETTINGS: JSON.stringify({ ...settings, human: { id: HUMAN, label: "Ana Example" }, attribution: "none" }) });
  assert.equal(r.doc.result.outcome, "bound", r.stdout);
  // Complete: already-bound.
  r = fx.run([], { OATS_SETTINGS: JSON.stringify({ ...settings, human: { id: HUMAN, label: "Ana Example" }, attribution: "human" }) });
  assert.equal(r.doc.result.outcome, "already-bound", r.stdout);
  // A new label is not complete until it is written.
  r = fx.run(["--label", "Ana B. Example"], { OATS_SETTINGS: JSON.stringify({ ...settings, human: { id: HUMAN, label: "Ana Example" }, attribution: "human" }) });
  assert.equal(r.doc.result.outcome, "bound", r.stdout);
  assert.match(fx.localYaml(), /"label": "Ana B\. Example"/);
});

test("a steward whose chain verifies but nothing was recorded yet is recorded without asking Cloud again", (t) => {
  const fx = setup(t, { cloud: { statuses: ["issued"] } });
  assert.equal(fx.run().status, 0);
  writeFileSync(join(fx.deployment, "oats-local.yaml"), "schemaVersion: 2\nworkspace: local\n");
  const before = fx.cloudCalls().length;
  const r = fx.run();
  assert.equal(r.doc.result.outcome, "bound", r.stdout);
  assert.equal(fx.cloudCalls().length, before);
  assert.match(fx.localYaml(), new RegExp(`human:\\n {6}"id": "${HUMAN}"\\n {4}attribution: "human"`));
});

// After B3's undo: the person revoked the steward's certificate. Cloud
// certifies an agent once, so the deployment can't be bound again yet
// (awebai/oats-aweb#204).
function revokedBind(t) {
  const fx = setup(t, { cloud: { statuses: ["issued"] } });
  assert.equal(fx.run().status, 0);
  fx.fake.revoke(STEWARD.agentId);
  const settings = { steward: { id: STEWARD.stableId, home: fx.steward }, human: { id: HUMAN }, attribution: "human" };
  return { fx, settings };
}

test("a revoked steward is reported with its own code: the deployment can't be bound again yet, naming the follow-up", (t) => {
  const { fx, settings } = revokedBind(t);
  const yaml = fx.localYaml();
  const r = fx.run([], { OATS_SETTINGS: JSON.stringify(settings) });
  assert.equal(r.doc.error.code, "E_BIND_REVOKED", r.stdout);
  assert.equal(r.doc.error.message, "the steward's certificate was revoked from the dashboard: aweb Cloud certifies an agent once, so this deployment can't be bound again yet (awebai/oats-aweb#204), and spawns refuse while its steward is revoked");
  assert.doesNotMatch(r.doc.error.message, /bind .*again →|remove .*\.oats-bind|--replace/);
  assert.equal(fx.localYaml(), yaml, "the record is left as it is");
  // The fake enforces that rule: a fresh request for the same steward is refused.
  rmSync(fx.bindDir, { recursive: true });
  const again = fx.run([], { OATS_SETTINGS: JSON.stringify({ ...settings, attribution: "none" }) });
  assert.notEqual(again.status, 0, again.stdout);
});

test("another steward after a revoke is still refused: one human and one steward per deployment", (t) => {
  const { fx, settings } = revokedBind(t);
  const r = spawnSync(process.execPath, [HOOK, "setup", "--steward", "--name", "steward2", "--json"], { env: { ...fx.env, OATS_SETTINGS: JSON.stringify(settings) }, cwd: fx.deployment, encoding: "utf8", input: "" });
  const doc = JSON.parse(r.stdout.trim().split("\n").at(-1));
  assert.equal(doc.error.code, "E_STEWARD_ONE_HUMAN");
  assert.doesNotMatch(doc.error.message, /--replace/);
});

test("an account whose human is not the deployment's bound human refuses before anything is submitted, and the record is unchanged", (t) => {
  const fx = setup(t, { cloud: { statuses: ["issued"] }, settings: { human: { id: "did:aw:human2" } } });
  const yaml = fx.localYaml();
  const r = fx.run();
  assert.equal(r.doc.error.code, "E_STEWARD_ONE_HUMAN", r.stdout);
  assert.match(r.doc.error.message, new RegExp(`the account's human is ${HUMAN}, but this deployment is bound to did:aw:human2`));
  assert.equal(fx.fake.submissions().length, 0);
  assert.equal(fx.localYaml(), yaml);
});

test("a failed opt-in leaves the deployment exactly as before: attribution: human is written only after the import verifies", (t) => {
  const response = JSON.stringify({ v: 1, request_id: "req-1", chain: [{ human: HUMAN }] }) + "\n\n";
  for (const cloud of [
    { statuses: ["pending"] },
    { statuses: ["declined"] },
    { context: { status: 409, body: { detail: "A recorded creator with a registered human is required" } } },
    { statuses: ["issued"], response, importRefusesNewline: true },
  ]) {
    const fx = setup(t, { cloud });
    const yaml = fx.localYaml();
    const r = fx.run();
    assert.notEqual(r.status, 0, `${JSON.stringify(cloud)}: ${r.stdout}`);
    assert.equal(fx.localYaml(), yaml, `${JSON.stringify(cloud)} must not touch oats-local.yaml`);
  }
});
