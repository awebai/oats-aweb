// Real-stack journeys for `oats aweb resident create`: real aw against aweb's
// local stack (docker-compose.e2e.yml: postgres, redis, awid, the OSS aweb
// server), with no fixture and no fake. CI runs them (see ci.yml); locally,
// bring the stack up and set:
//
//   OATS_RESIDENT_JOURNEY_AW        a real aw 1.36.33 executable
//   OATS_RESIDENT_JOURNEY_AWEB_URL  e.g. http://127.0.0.1:18000
//   OATS_RESIDENT_JOURNEY_AWID_URL  e.g. http://127.0.0.1:18010
//
// The OSS server does not serve aweb Cloud's /api/v1/workspaces/init, so an
// API-key init here registers the identity at awid and then fails. That proves
// registration, same-DID resume and the key's absence on a failure; a complete
// create, a quarantined partial and a customer-held team's refusal are proven
// only by the joint E2E against the local aweb Cloud.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const HOOK = fileURLToPath(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url));
const AW = process.env.OATS_RESIDENT_JOURNEY_AW, AWEB_URL = process.env.OATS_RESIDENT_JOURNEY_AWEB_URL, AWID_URL = process.env.OATS_RESIDENT_JOURNEY_AWID_URL;

function configured(t) {
  if (AW && AWEB_URL && AWID_URL) return true;
  assert.notEqual(process.env.OATS_RESIDENT_JOURNEY_REQUIRED, "1", "set OATS_RESIDENT_JOURNEY_AW, _AWEB_URL and _AWID_URL to run the real-stack journeys");
  t.skip("needs a real aw and aweb's local stack (OATS_RESIDENT_JOURNEY_*)");
  return false;
}

function journey(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-resident-journey-")));
  const deployment = join(base, "deploy"), home = join(base, "home"), bin = join(base, "bin");
  for (const d of [deployment, home, bin]) mkdirSync(d);
  writeFileSync(join(deployment, "oats-local.yaml"), "schemaVersion: 2\nworkspace: local\n");
  symlinkSync(realpathSync(AW), join(bin, "aw"));
  const version = spawnSync(join(bin, "aw"), ["version"], { encoding: "utf8" });
  assert.match(version.stdout, /^aw 1\.36\.33\n  commit: 877bbee94ce45aa1ff103912bc9850556e61dfb4 /, "the journeys are qualified on aw 1.36.33 (877bbee9)");
  const env = {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, OATS_TEAM_SCOPE: deployment, OATS_SETTINGS: "{}",
    ...(process.env.XDG_RUNTIME_DIR ? { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR } : {}),
    ...(process.env.DBUS_SESSION_BUS_ADDRESS ? { DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS } : {}),
  };
  const cleanups = [];
  t.after(() => { for (const c of cleanups.reverse()) { try { c(); } catch { /* best effort */ } } rmSync(base, { recursive: true, force: true }); });
  const run = (args, extra = {}) => {
    const r = spawnSync(process.execPath, [HOOK, "resident", ...args], { env: { ...env, ...extra }, cwd: deployment, encoding: "utf8", input: "", timeout: 180000 });
    let doc; try { doc = JSON.parse(r.stdout.trim().split("\n").at(-1)); } catch { doc = undefined; }
    return { ...r, doc };
  };
  const aw = (cwd, args, extra = {}) => spawnSync(join(bin, "aw"), args, { cwd, encoding: "utf8", env: { PATH: env.PATH, HOME: home, AWEB_URL, AWID_REGISTRY_URL: AWID_URL, AW_NO_UPDATE_CHECK: "1", NO_COLOR: "1", ...extra } });
  return { base, deployment, home, bin, env, run, aw, cleanups };
}
const yamlField = (text, key) => new RegExp(`^${key}:\\s*"?([^"\\n]+)"?\\s*$`, "m").exec(text)?.[1];
async function awidKey(stableId) {
  const res = await fetch(`${AWID_URL}/v1/did/${encodeURIComponent(stableId)}/key`);
  assert.equal(res.status, 200, `awid lookup of ${stableId}`);
  return res.json();
}
function filesUnder(dir) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) out.push(p); } };
  walk(dir);
  return out;
}

test("registration at awid, a forced failure with no key anywhere, and a rerun that keeps the same DID", async (t) => {
  if (!configured(t)) return;
  const j = journey(t);
  const key = `aw_sk_journey_${randomBytes(12).toString("hex")}`;
  const root = join(j.deployment, ".aweb-residents", "alice");
  const first = j.run(["create", "alice", "--json"], { AWEB_API_KEY: key, AWEB_URL, AWID_REGISTRY_URL: AWID_URL });
  assert.equal(first.status, 1, first.stdout + first.stderr);
  assert.equal(first.doc.error.code, "E_RESIDENT_INIT");
  assert.match(first.doc.error.message, /^workspace init target was not found or the team was deleted \(404\): .*\nrerun the same command in this directory; do not delete \.aw\/partial-init\.yaml$/);
  const partialFile = join(root, ".aw", "partial-init.yaml");
  assert.equal(first.doc.error.details.partial, partialFile);
  const partial = readFileSync(partialFile, "utf8");
  const didKey = yamlField(partial, "did_key"), stableId = yamlField(partial, "stable_id");
  assert.match(didKey, /^did:key:/);
  const registered = await awidKey(stableId);
  assert.equal(registered.current_did_key, didKey, "aw registered the DID at awid before the failure");

  // A rerun continues the same partial: same DID, same registration.
  const again = j.run(["create", "alice", "--json"], { AWEB_API_KEY: key, AWEB_URL, AWID_REGISTRY_URL: AWID_URL });
  assert.equal(again.doc.error.code, "E_RESIDENT_INIT");
  assert.equal(yamlField(readFileSync(partialFile, "utf8"), "did_key"), didKey);
  const after = await awidKey(stableId);
  assert.equal(after.current_did_key, didKey);
  assert.equal(after.log_head.seq, registered.log_head.seq, "no second registration");

  // The key is in no output and no written file: the deployment, the resident,
  // the home aw used, and the captures under the resident included.
  for (const r of [first, again]) assert.ok(!r.stdout.includes(key) && !r.stderr.includes(key));
  assert.deepEqual(filesUnder(j.base).filter((p) => readFileSync(p).includes(key)), []);
  assert.equal(statSync(join(root, ".oats-resident")).mode & 0o777, 0o700);
});

test("a rerun with another registry gets aw's own refusal, unchanged", (t) => {
  if (!configured(t)) return;
  const j = journey(t);
  const key = `aw_sk_journey_${randomBytes(12).toString("hex")}`;
  assert.equal(j.run(["create", "alice"], { AWEB_API_KEY: key, AWEB_URL, AWID_REGISTRY_URL: AWID_URL }).status, 1);
  const other = AWID_URL.replace("127.0.0.1", "localhost");
  const r = j.run(["create", "alice", "--json"], { AWEB_API_KEY: key, AWEB_URL, AWID_REGISTRY_URL: other });
  assert.equal(r.doc.error.code, "E_RESIDENT_INIT");
  const partialFile = join(j.deployment, ".aweb-residents", "alice", ".aw", "partial-init.yaml");
  assert.equal(r.doc.error.message, `partial API-key init state at ${partialFile} was created for a different bootstrap context (registry_url ${JSON.stringify(AWID_URL)} != ${JSON.stringify(other)}); retry the original command or remove the file explicitly`);
});

test("a complete global identity is adopted: verified, served by a real per-user custody unit, recorded, and a rerun is a pure verify", (t) => {
  if (!configured(t)) return;
  if (!["darwin", "linux"].includes(process.platform)) { t.skip("no per-user service manager on this platform"); return; }
  const j = journey(t);
  const ns = `res-${randomBytes(4).toString("hex")}.test`;
  const root = join(j.base, "carol");
  mkdirSync(root);
  // Made the way aweb's own real-stack e2e makes a global identity.
  const step = (args) => { const r = j.aw(root, args, { AWID_SKIP_DNS_VERIFY: "1" }); assert.equal(r.status, 0, `aw ${args.join(" ")}: ${r.stdout}${r.stderr}`); return r.stdout; };
  step(["id", "create", "--domain", ns, "--name", "carol", "--registry", AWID_URL, "--skip-dns-verify", "--json"]);
  step(["id", "team", "create", "--namespace", ns, "--name", "default", "--registry", AWID_URL, "--json"]);
  const cert = JSON.parse(step(["id", "team", "add-member", "--namespace", ns, "--team", "default", "--member", `${ns}/carol`, "--json"])).certificate_id;
  step(["id", "team", "fetch-cert", "--namespace", ns, "--team", "default", "--cert-id", cert, "--registry", AWID_URL, "--json"]);
  step(["init", "--do-not-touch-agents-md", "--json"]);
  const label = `ai.aweb.custody.${ns}.carol`;
  j.cleanups.push(() => j.aw(root, ["custody", "stop"]));
  if (process.platform === "darwin") j.cleanups.push(() => spawnSync("launchctl", ["bootout", `gui/${userInfo().uid}/${label}`]));
  else j.cleanups.push(() => spawnSync("systemctl", ["--user", "disable", "--now", `${label}.service`], { env: j.env }));

  const r = j.run(["create", "carol", "--root", root, "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const result = r.doc.result;
  assert.equal(result.outcome, "adopted");
  assert.equal(result.address, `${ns}/carol`);
  assert.equal(result.team, `default:${ns}`);
  assert.deepEqual({ ...result.custody, path: undefined }, { status: "running", manager: process.platform === "darwin" ? "launchd" : "systemd", label, path: undefined });
  assert.ok(existsSync(result.custody.path));
  const status = JSON.parse(j.aw(root, ["custody", "status", "--json"]).stdout);
  assert.equal(status.status, "running");
  assert.ok(status.ops.includes("mail_reply_continuation.v1") && status.ops.includes("grant_never_ttl.v1"));
  assert.match(readFileSync(join(j.deployment, "oats-local.yaml"), "utf8"), new RegExp(`"carol": ${JSON.stringify(root).replace(/[.]/g, "\\.")}`));

  const again = j.run(["create", "carol", "--root", root, "--json"], { OATS_SETTINGS: JSON.stringify({ residents: { carol: root } }) });
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(again.doc.result.outcome, "already-exists");
});
