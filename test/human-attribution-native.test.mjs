// A10 (README, "Human attribution"): the provider's `aw who --json` read against the
// real, explicitly selected aw of the CI matrix (OATS_TEST_AW: the floor, tested and
// the pinned next, 1.36.59-rc.6, whose npm integrity CI checks). A legacy chainless
// local did:key root (as aw <= 1.36.51 left one; a fresh hosted root reads no_human), built from throwaway keys in a private HOME, reads `unknown` /
// `legacy_no_chain` on an aw that has `who`, offline and fast: every network route the
// child could take points at a closed loopback port. On an aw without `who` (the floor)
// the read gives no answer and check-only reports `unavailable`. The joined-team accept,
// with and without --parent, runs against the real stack (test/resident-journey.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPinnedAw } from "./helpers/pinned-aw.mjs";
import { readWho } from "../oats-package/capabilities/oats-aweb/lib/attribution.mjs";
import { versionAtLeast } from "../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs";
import { WHO_AW_MIN } from "../scripts/check-aw-argv.mjs";

const HOOK = fileURLToPath(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url));
const TEAM = "fixture:example.invalid";

function b58(buf) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + buf.toString("hex")), out = "";
  while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  return out;
}
function key() {
  const pair = generateKeyPairSync("ed25519");
  return { ...pair, did: "did:key:z" + b58(Buffer.concat([Buffer.from([0xed, 1]), pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32)])) };
}
/** A legacy local did:key root with one synthetic membership, as aw lays it out; no chain. */
function chainlessRoot(root) {
  const aw = join(root, ".aw");
  mkdirSync(join(aw, "team-certs"), { recursive: true });
  const member = key(), signer = key();
  const cert = { version: 1, certificate_id: randomUUID(), team_id: TEAM, team_did_key: signer.did, member_did_key: member.did, alias: "fixture-root", identity_scope: "local", issued_at: new Date().toISOString().replace(/\.\d+Z$/, "Z") };
  cert.signature = sign(null, Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(cert).sort().map((k) => [k, cert[k]])))), signer.privateKey).toString("base64").replace(/=+$/, "");
  writeFileSync(join(aw, "team-certs", "fixture__example.invalid.pem"), JSON.stringify(cert), { mode: 0o600 });
  writeFileSync(join(aw, "signing.key"), `-----BEGIN ED25519 PRIVATE KEY-----\n${member.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("base64")}\n-----END ED25519 PRIVATE KEY-----\n`, { mode: 0o600 });
  writeFileSync(join(aw, "identity.yaml"), `did: ${member.did}\ncustody: self\nidentity_scope: local\n`);
  const membership = `  - team_id: ${TEAM}\n    alias: fixture-root\n    cert_path: team-certs/fixture__example.invalid.pem\n`;
  writeFileSync(join(aw, "teams.yaml"), `active_team: ${TEAM}\nmemberships:\n${membership}    aweb_url: http://127.0.0.1:1\n`);
  writeFileSync(join(aw, "workspace.yaml"), `aweb_url: http://127.0.0.1:1\nmemberships:\n${membership}`);
  return member.did;
}

test("A10: the provider's who read on this real aw: a legacy chainless did:key root reads unknown/legacy_no_chain offline and fast, and check-only reports it", (t) => {
  if (!process.env.OATS_TEST_AW) {
    assert.notEqual(process.env.OATS_ATTRIBUTION_NATIVE_REQUIRED, "1", "set OATS_TEST_AW");
    t.skip("requires an explicitly selected real aw (OATS_TEST_AW)"); return;
  }
  const binary = realpathSync(process.env.OATS_TEST_AW);
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "attribution-native-")));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const home = join(scratch, "home"), bin = join(scratch, "bin"), dep = join(scratch, "deployment"), root = join(dep, ".aweb-roots", "default");
  for (const dir of [home, bin, dep]) mkdirSync(dir, { recursive: true });
  symlinkSync(binary, join(bin, "aw"));
  // Offline: every registry, service and proxy the child could use is a closed port.
  const offline = { HOME: home, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, XDG_CONFIG_HOME: join(home, ".config"), AW_NO_UPDATE_CHECK: "1", AWID_REGISTRY_URL: "http://127.0.0.1:1", AWEB_URL: "http://127.0.0.1:1", HTTP_PROXY: "http://127.0.0.1:1", HTTPS_PROXY: "http://127.0.0.1:1" };
  const version = spawnSync(binary, ["version"], { env: offline, encoding: "utf8" });
  t.diagnostic(JSON.stringify(verifyPinnedAw(binary, version)));
  const awVersion = /^aw (\S+)$/m.exec(version.stdout)[1];
  const did = chainlessRoot(root);
  const hasWho = versionAtLeast(awVersion, WHO_AW_MIN);

  // The provider's reader, with the provider's argv, on the real binary.
  const runAw = (args, timeout) => execFileSync(binary, args, { cwd: scratch, env: offline, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] });
  const started = performance.now();
  const observed = readWho((args, timeout) => {
    try { return runAw(args, timeout); }
    catch (e) { throw Object.assign(new Error("aw who"), { outcome: e.status != null ? `failed (exit ${e.status})` : "failed", stdout: String(e.stdout ?? "") }); }
  }, join(root, ".aw"));
  const ms = performance.now() - started;
  if (hasWho) {
    assert.deepEqual({ outcome: observed.outcome, answered: observed.answered, id: observed.id, reason: observed.reason }, { outcome: "unknown", answered: true, id: did, reason: "legacy_no_chain" });
    assert.ok(ms < 2000, `offline and fast (${Math.round(ms)} ms)`);
  } else {
    assert.equal(observed.answered, false);
    assert.match(observed.reason, /^aw who failed \(exit 1\)/);
  }

  // C2 through the hook: check-only's roots[] for that root.
  writeFileSync(join(dep, "oats-local.yaml"), "schemaVersion: 2\nworkspace: fixture\n");
  // An ambient AWID_REGISTRY_URL asks the provider for its registry setting; the
  // read needs no registry, so the hook runs without it.
  const { AWID_REGISTRY_URL: _ambient, ...hookOffline } = offline;
  const env = { ...hookOffline, OATS_EVENT: "setup", OATS_TEAM_SCOPE: dep, OATS_WORKSPACE: dep, OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: "deployment", OATS_TEAMS: JSON.stringify([{ label: "default", team: TEAM, default: true, from: "local" }]), OATS_SETTINGS: JSON.stringify({ root }) };
  const checked = spawnSync(process.execPath, [HOOK, "setup", "--check-only", "--json"], { cwd: dep, env, encoding: "utf8", timeout: 60000 });
  const doc = JSON.parse(checked.stdout.trim().split("\n").pop());
  assert.equal(doc.roots?.length, 1, checked.stdout + checked.stderr);
  const [entry] = doc.roots;
  assert.deepEqual({ label: entry.label, team: entry.team, home: entry.home, warnings: entry.warnings }, { label: "root", team: null, home: root, warnings: [] });
  if (hasWho) assert.deepEqual(entry.attribution, { outcome: "unknown", humanId: null, reason: "legacy_no_chain" });
  else assert.deepEqual([entry.attribution.outcome, entry.attribution.humanId, /^aw who failed \(exit 1\)/.test(entry.attribution.reason)], ["unavailable", null, true]);
});
