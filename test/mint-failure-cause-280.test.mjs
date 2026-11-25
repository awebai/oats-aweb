// awebai/oats-aweb#280: a failed spawn mint (`aw init --join-from ... --json`) names
// its cause from a fixed vocabulary, read from aw's --json envelope fields code,
// http_status and reason (never message or detail) or from aw's own words for a
// missing key or a network failure. None of aw's output, no token, key or argv value
// reaches the message. Only the message changes: the hook still exits 1 with its
// `identity minting failed` warning.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { joinFromFake, membersFake } from "./helpers/fake-aw-join-from.mjs";
import { AW_MINT_ERROR_CODES, AW_MINT_REFUSAL_REASONS, NAMESPACE_CONTROLLER_KEY_MISSING, SIGNING_KEY_MISSING, TEAM_KEY_MISSING, mintFailureCause } from "../oats-package/capabilities/oats-aweb/lib/aw-failure-cause.mjs";

const HOOK = resolve(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url).pathname);
const TEAM = "default:example.test";
const NETWORK = "the aweb service could not be reached: a network or TLS failure";
const NONE = "no HTTP status, aw error code, missing key or network failure in its output";
const TOKEN = "aw_inv_SECRET0123456789abcdefTOKEN";
const PEM = "-----BEGIN ED25519 PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIKEYMATERIALSHOULDNEVERLEAK0123456789\n-----END ED25519 PRIVATE KEY-----";
const PROSE = "free text the server wrote";
const envelope = (error) => JSON.stringify({ error: { message: `${PROSE} ${TOKEN}`, detail: `${PROSE} ${PEM}`, ...error } });

// ------------------------------------------------------------- the vocabulary

test("each allowed reason is named with its HTTP status", () => {
  for (const reason of AW_MINT_REFUSAL_REASONS) {
    assert.equal(mintFailureCause({ stderr: "", stdout: envelope({ code: "http_error", http_status: 409, reason }) }), `http 409, reason ${reason}`);
  }
  assert.deepEqual([...AW_MINT_REFUSAL_REASONS].sort(), ["alias_active", "alias_mismatch", "alias_taken", "team_key_not_current"]);
});

test("a reason off the list shows as the HTTP status alone", () => {
  // registry_operation_in_progress among them, until aweb confirms its route.
  for (const reason of ["registry_operation_in_progress", "self_custody_reinit_unproven", "some_new_reason", `x ${TOKEN}`, "", 42, null, ["alias_active"], { code: "alias_active" }]) {
    assert.equal(mintFailureCause({ stderr: "", stdout: envelope({ code: "http_error", http_status: 503, reason }) }), "http 503", JSON.stringify(reason));
  }
});

test("each allowed aw code is named, with the status and reason it carries", () => {
  for (const code of AW_MINT_ERROR_CODES) assert.equal(mintFailureCause({ stderr: "", stdout: envelope({ code }) }), `aw error ${code}`);
  assert.equal(mintFailureCause({ stderr: "", stdout: envelope({ code: "invite_not_created", http_status: 409, reason: "team_key_not_current" }) }), "aw error invite_not_created, http 409, reason team_key_not_current");
  assert.equal(mintFailureCause({ stderr: "", stdout: envelope({ code: "invite_not_created", http_status: 409, reason: "registry_operation_in_progress" }) }), "aw error invite_not_created, http 409");
  assert.equal(mintFailureCause({ stderr: "", stdout: envelope({ code: "alias_conflict", http_status: 409, reason: "alias_active" }) }), "aw error alias_conflict, http 409, reason alias_active");
});

test("a code off the list, or aw's generic codes, name no class", () => {
  for (const code of ["error", "http_error", "some_new_code", "controller_key_missing", "identity_exists", `x ${TOKEN}`, 7, null]) assert.equal(mintFailureCause({ stderr: "", stdout: envelope({ code }) }), NONE, JSON.stringify(code));
  assert.equal(mintFailureCause({ stderr: "", stdout: envelope({ code: "http_error", http_status: "409" }) }), NONE, "a status that is not a number is not read");
  assert.equal(mintFailureCause({ stderr: "", stdout: envelope({ code: "http_error", http_status: 4090 }) }), NONE, "nor one out of range");
});

// Client-side failures: no server refusal at all.
test("a missing local key is named from aw's own words, first", () => {
  for (const [message, cause] of [
    ["no team key for example.test/default; run `aw id team create` first", TEAM_KEY_MISSING],
    ["local team controller key for default:example.test was not found: open /home/u/.awid/team-keys/example.test/default.key: no such file or directory", TEAM_KEY_MISSING],
    ["no local controller key for --namespace example.test", NAMESPACE_CONTROLLER_KEY_MISSING],
    ["read /home/u/root/.aw/signing.key: open /home/u/root/.aw/signing.key: no such file or directory", SIGNING_KEY_MISSING],
    ["read /home/u/my root/.aw/signing.key: open /home/u/my root/.aw/signing.key: no such file or directory", SIGNING_KEY_MISSING],
  ]) {
    assert.equal(mintFailureCause({ stderr: `Error: ${message}`, stdout: envelope({ code: "invite_not_created", message }) }), cause === SIGNING_KEY_MISSING ? `aw error invite_not_created, ${cause}` : cause, message);
    assert.equal(mintFailureCause({ stderr: `Error: ${message}`, stdout: "" }), cause, `${message} (no envelope)`);
  }
});

test("a transport failure is named, with or without aw's envelope", () => {
  const stderr = `Error: Post "https://aweb.example.invalid/v1/teams/invite": dial tcp: lookup aweb.example.invalid: no such host ${TOKEN}`;
  assert.equal(mintFailureCause({ stderr, stdout: envelope({ code: "error" }) }), NETWORK);
  assert.equal(mintFailureCause({ stderr, stdout: "" }), NETWORK);
  assert.equal(mintFailureCause({ stderr: 'Error: Post "https://x.invalid/v1/a": context deadline exceeded', stdout: envelope({ code: "outcome_unknown" }) }), `aw error outcome_unknown, ${NETWORK}`);
});

test("a non-JSON answer falls back to aw's text, and never relays its detail", () => {
  assert.equal(mintFailureCause({ stderr: `Error: accept hosted team invite: registry http 409: {"detail":{"code":"alias_active","message":"${PROSE}"}}`, stdout: "" }), "http 409, reason alias_active");
  assert.equal(mintFailureCause({ stderr: `Error: registry http 500: {"detail":"${PROSE} ${TOKEN}"}`, stdout: "not json" }), "http 500");
  assert.equal(mintFailureCause({ stderr: `Error: registry http 409: {"detail":{"code":"unlisted_code"}}`, stdout: "" }), "http 409");
  assert.equal(mintFailureCause({ stderr: `something odd ${TOKEN}`, stdout: `not json ${TOKEN}` }), NONE);
  assert.equal(mintFailureCause({ stderr: undefined, stdout: undefined }), NONE);
});

// ------------------------------------------------------ the spawn hook itself

function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-280-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fixture(t, alias = "dev-1") {
  const base = tempDir(t), bin = join(base, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "aw"), `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === "version") { console.log("aw 1.36.58\\n  commit: abc"); process.exit(0); }
(${joinFromFake})(args);
(${membersFake})(args);
if (args[0] === "wake" && args[1] === "status") { console.log(JSON.stringify({ daemon_running: true, daemon_version_state: "reported", daemon_version: "1.36.58", instances: [] })); process.exit(0); }
if (args[0] === "wake") { console.log("ok"); process.exit(0); }
console.error("unexpected fake aw " + args.join(" ")); process.exit(93);
`);
  chmodSync(join(bin, "aw"), 0o755);
  const ws = join(base, "ws"), home = join(ws, "agents", "dev", "instances", alias);
  mkdirSync(join(ws, ".aw"), { recursive: true });
  writeFileSync(join(ws, ".aw", "teams.yaml"), `active_team: ${TEAM}\nmemberships:\n    - team_id: ${TEAM}\n      alias: root\n      cert_path: team-certs/default__example.test.pem\n`);
  writeFileSync(join(ws, "oats-local.yaml"), "settings: {}\n");
  mkdirSync(home, { recursive: true });
  const env = {
    HOME: base, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    OATS_INSTANCE: alias, OATS_HOME: home, OATS_INSTANCE_HOME: home, OATS_WORKSPACE: ws, OATS_RUNTIME: "claude",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]),
    OATS_SETTINGS: JSON.stringify({ root: ws, delivery: "session" }),
    FAKE_JOIN_FROM_REGISTRY: join(base, "registry.json"),
  };
  const spawn = (fail) => {
    const r = spawnSync(process.execPath, [HOOK, "spawn"], { cwd: home, env: { ...env, OATS_EVENT: "spawn", FAKE_JOIN_FROM_FAIL: JSON.stringify(fail) }, encoding: "utf8", timeout: 60000 });
    const doc = JSON.parse(r.stdout);
    return { ...r, doc, warning: doc.warning };
  };
  return { ws, home, spawn };
}

/** The mint failure's own line of the hook's warning. */
const mintLine = (warning) => warning.split(" | ").find((part) => part.startsWith("oats-aweb: identity minting failed: "));

for (const [name, fail, cause] of [
  ["a registry refusal while the root's invite is created", { at: "invite", stderr: `Error: create team invite: registry http 409: ${PROSE} ${TOKEN}; alternatively use --admission-team-id ${TEAM} with host authorization`, stdout: envelope({ code: "invite_not_created", http_status: 409, reason: "registry_operation_in_progress" }) }, "aw error invite_not_created, http 409"],
  ["a server refusal with a listed reason under the generic code", { stderr: `Error: connect: http 409: ${PROSE}`, stdout: envelope({ code: "http_error", http_status: 409, reason: "alias_mismatch" }) }, "http 409, reason alias_mismatch"],
  ["a server refusal with a reason off the list", { stderr: `Error: registry http 503: ${PROSE}`, stdout: envelope({ code: "http_error", http_status: 503, reason: "not_on_the_list" }) }, "http 503"],
  ["a missing root key, with no server refusal", { at: "invite", stderr: "Error: no team key for example.test/default; run `aw id team create` first; alternatively use --admission-team-id default:example.test with host authorization", stdout: envelope({ code: "invite_not_created" }) }, TEAM_KEY_MISSING],
  ["a transport failure, with no server refusal", { stderr: `Error: Post "https://aweb.example.invalid/v1/x": dial tcp: lookup aweb.example.invalid: no such host`, stdout: envelope({ code: "error" }) }, NETWORK],
  ["an outcome aw itself calls unknown", { stderr: 'Error: Post "https://aweb.example.invalid/v1/x": context deadline exceeded', stdout: envelope({ code: "outcome_unknown" }) }, `aw error outcome_unknown, ${NETWORK}`],
  ["output that is not JSON", { stderr: `${PROSE} ${TOKEN}`, stdout: `not json ${TOKEN}` }, NONE],
]) test(`a failed mint names its cause: ${name}`, (t) => {
  const fx = fixture(t);
  const r = fx.spawn(fail);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const line = mintLine(r.warning);
  assert.ok(line, r.warning);
  assert.ok(line.startsWith("oats-aweb: identity minting failed: aw init failed (exit 1) (output withheld: this command handles credentials; "), line);
  assert.ok(line.includes(`; ${cause})`), line);
});

test("no token, key, argv value or aw prose reaches the hook's answer", (t) => {
  const fx = fixture(t);
  const r = fx.spawn({ stderr: `Error: ${PROSE} ${TOKEN} ${PEM} --join-from=${fx.ws}`, stdout: envelope({ code: "http_error", http_status: 409, reason: "alias_taken" }) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = r.stdout + r.stderr;
  for (const leak of [TOKEN, "KEYMATERIAL", "PRIVATE KEY", PROSE, "--join-from", "--join-team", "--name"]) assert.equal(out.includes(leak), false, `${leak} in ${out}`);
  // The root is recorded in the meta, for retire; never in the message.
  assert.equal(r.warning.includes(fx.ws), false, r.warning);
  assert.ok(mintLine(r.warning).includes("; http 409, reason alias_taken)"), r.warning);
});

test("a failure after aw wrote the member's key says the mint may have happened, and keeps the intent for retire", (t) => {
  const fx = fixture(t);
  const r = fx.spawn({ at: "register", stderr: "Error: registry http 503", stdout: envelope({ code: "http_error", http_status: 503 }) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(existsSync(join(fx.home, ".aw", "signing.key")), true);
  const line = mintLine(r.warning);
  assert.ok(line.endsWith("; http 503); the mint may have happened, so retire settles the recorded mint"), line);
  assert.equal(r.doc.meta.pendingMint.alias, "dev-1");
  assert.equal(r.doc.meta.pendingMint.team, TEAM);
});

test("a failure aw confirms created no invite says nothing of an uncertain mint, and drops the intent", (t) => {
  const fx = fixture(t);
  const r = fx.spawn({ at: "invite", stderr: `Error: create team invite: registry http 409; alternatively use --admission-team-id ${TEAM} with host authorization`, stdout: envelope({ code: "invite_not_created", http_status: 503 }) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.warning, /may have happened/);
  assert.equal(r.doc.meta, undefined);
  assert.equal(existsSync(join(fx.home, ".oats-aweb", "pending-mint.json")), false);
});

test("a failure whose text only looks like an alias refusal still names its class", (t) => {
  const fx = fixture(t);
  const r = fx.spawn({ stderr: `Error: registry http 409: conflict ${PROSE}`, stdout: envelope({ code: "http_error", http_status: 409, reason: "registry_operation_in_progress" }) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.warning.startsWith('oats-aweb: aw init --join-from failed with what may be a refusal of alias "dev-1" that aw did not confirm by its code'), r.warning);
  assert.ok(r.warning.endsWith("; cause: http 409"), r.warning);
  assert.equal(r.doc.meta.pendingMint.alias, "dev-1");
  assert.equal(r.warning.includes(PROSE), false, r.warning);
});

test("a server refusal's status wins over key or network words in its free text", () => {
  for (const words of ["no team key for remote-text", "no local controller key for remote-text", "read /x/signing.key: open /x/signing.key: no such file or directory", 'Post "https://x.invalid/v1/a": dial tcp: lookup x.invalid: no such host']) {
    assert.equal(mintFailureCause({ stderr: "", stdout: JSON.stringify({ error: { code: "http_error", http_status: 503, reason: "registry_operation_in_progress", message: words } }) }), "http 503", `message: ${words}`);
    assert.equal(mintFailureCause({ stderr: "", stdout: JSON.stringify({ error: { code: "http_error", http_status: 503, detail: words } }) }), "http 503", `detail: ${words}`);
    assert.equal(mintFailureCause({ stderr: `Error: registry http 500: {"detail":"${words.replace(/"/g, '\\"')}"}`, stdout: "" }), "http 500", `old aw's text: ${words}`);
  }
});

// fatal keeps 300 characters of its message: the retire guidance and the class must not be cut.
const LONG = "a".repeat(64);
test("with the longest alias, a failure that keeps the intent still says retire settles the recorded mint, and its class", (t) => {
  const fx = fixture(t, LONG);
  const r = fx.spawn({ at: "register", stderr: 'Error: Post "https://aweb.example.invalid/v1/x": context deadline exceeded', stdout: JSON.stringify({ error: { code: "certificate_persistence_incomplete", http_status: 503, reason: "team_key_not_current" } }) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const line = mintLine(r.warning);
  assert.ok(line.includes("; aw error certificate_persistence_incomplete, http 503, reason team_key_not_current)"), line);
  assert.ok(line.endsWith("; the mint may have happened, so retire settles the recorded mint"), line);
  assert.equal(r.doc.meta.pendingMint.alias, LONG);
});

test("with the longest alias, a failure that only looks like an alias refusal keeps its retire guidance and names its class", (t) => {
  const fx = fixture(t, LONG);
  const r = fx.spawn({ stderr: 'Error: conflict: Post "https://x.invalid/v1/a": context deadline exceeded', stdout: JSON.stringify({ error: { code: "outcome_unknown" } }) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.warning, /retire settles the recorded mint/);
  assert.ok(r.warning.endsWith("; cause: aw error outcome_unknown, the aweb service could not be reached: a network or TLS failure"), r.warning);
  assert.equal(r.doc.meta.pendingMint.alias, LONG);
});
