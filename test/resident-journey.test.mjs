// Real-stack journeys for `oats aweb resident create`: real aw against aweb's
// local stack (docker-compose.e2e.yml: postgres, redis, awid, the OSS aweb
// server) and a real OATS kernel, with no fixture and no fake. CI runs them
// (see ci.yml); locally, bring the stack up and set:
//
//   OATS_RESIDENT_JOURNEY_AW        a real aw 1.36.33 or 1.36.58 executable
//                                   (aw-compat.json's min or tested)
//   OATS_RESIDENT_JOURNEY_AWEB_URL  e.g. http://127.0.0.1:18000
//   OATS_RESIDENT_JOURNEY_AWID_URL  e.g. http://127.0.0.1:18010
//   OATS_RESIDENT_JOURNEY_KERNEL    a checkout of an OATS kernel with the
//                                   teams-conditional-default feature, its
//                                   dependencies installed
//
// The kernel is the selected OATS_CLI_BIN of every run, and the dispatcher of
// the printed next steps, which the last journeys run as printed: the
// `oats teams default` step when there is one, then the seat's spawn, previewed
// and then scaffolded with --no-launch, which mints a real grant at the
// resident's custody; retiring the scaffold revokes it.
//
// The OSS server does not serve aweb Cloud's /api/v1/workspaces/init, so with
// aw 1.36.33 an API-key init here registers the identity at awid and then
// fails. That proves registration, same-DID resume and the key's absence on a
// failure. From aw 1.36.53, aw reads the key's team first, which this server doesn't
// answer, so it stops before minting: that proves aw's refusal reaches the
// operator unchanged, with no partial and no key anywhere, and a rerun into
// what it left runs aw again. A complete create, a quarantined partial and a
// customer-held team's refusal are proven only by the joint E2E against the
// local aweb Cloud.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { targetReceiveAssessment } from "../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs";
import { seatGrantLabel, teamGrants } from "../oats-package/capabilities/oats-aweb/lib/seat-grants.mjs";
import { AW_TEST_VERSIONS } from '../scripts/aw-test-versions.mjs';
import { AW_MIN, versionAtLeast } from "../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs";

const HOOK = fileURLToPath(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url));
import { nativeCapture } from './helpers/native-capture.mjs';
import { healthHost } from '../oats-package/capabilities/oats-aweb/lib/health-host.mjs';
import { observePrivateRegistryAw } from './helpers/observe-private-registry.mjs';
const CAPABILITY = fileURLToPath(new URL("../oats-package/capabilities/oats-aweb", import.meta.url));
const AW = process.env.OATS_RESIDENT_JOURNEY_AW, AWEB_URL = process.env.OATS_RESIDENT_JOURNEY_AWEB_URL, AWID_URL = process.env.OATS_RESIDENT_JOURNEY_AWID_URL;
const KERNEL = process.env.OATS_RESIDENT_JOURNEY_KERNEL;
const OATS = KERNEL ? join(KERNEL, "bin", "oats.mjs") : undefined;

/** The aw releases the journeys are qualified on, each with the commit its
 *  `aw version` prints: aw-compat.json's min and tested, in that order. */
const QUALIFIED_AW = Object.freeze({
  "1.36.33": "877bbee94ce45aa1ff103912bc9850556e61dfb4",
  "1.36.58": "a3223c1d32b8144abfd34d63b521b38d2b227ad5",
  "1.36.59-rc.5": "83a416bb9d987a00a217a6daa4c7bf9c10b87095",
});

test("the journeys are qualified on the floor, tested and pinned next aw", () => {
  assert.deepEqual(Object.keys(QUALIFIED_AW), AW_TEST_VERSIONS);
});

function configured(t) {
  if (AW && AWEB_URL && AWID_URL && KERNEL) return true;
  assert.notEqual(process.env.OATS_RESIDENT_JOURNEY_REQUIRED, "1", "set OATS_RESIDENT_JOURNEY_AW, _AWEB_URL, _AWID_URL and _KERNEL to run the real-stack journeys");
  t.skip("needs a real aw, aweb's local stack and an OATS kernel (OATS_RESIDENT_JOURNEY_*)");
  return false;
}

function journey(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-resident-journey-")));
  const deployment = join(base, "deploy"), home = join(base, "home"), bin = join(base, "bin");
  for (const d of [deployment, join(deployment, "agents"), home, bin]) mkdirSync(d);
  writeFileSync(join(deployment, "oats-local.yaml"), "schemaVersion: 2\nworkspace: local\n");
  symlinkSync(realpathSync(AW), join(bin, "aw"));
  const version = spawnSync(join(bin, "aw"), ["version"], { encoding: "utf8" });
  const [, awVersion, awCommit] = /^aw (\S+)\n  commit: ([0-9a-f]{40}) /.exec(version.stdout) ?? [];
  assert.ok(awVersion && QUALIFIED_AW[awVersion] === awCommit, `the journeys are qualified on ${Object.entries(QUALIFIED_AW).map(([v, c]) => `aw ${v} (${c.slice(0, 8)})`).join(" and ")}, not ${JSON.stringify(version.stdout)}`);
  // From aw 1.36.53, aw reads the API key's team before it mints anything; the
  // OSS server does not answer that read, so init stops there and leaves no partial.
  const teamReadFirst = versionAtLeast(awVersion, "1.36.53");
  // The printed steps start with `oats`; a spawn's preflight looks for the
  // harness, which --preview and --no-launch never start.
  writeFileSync(join(bin, "oats"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(OATS)} "$@"\n`, { mode: 0o755 });
  for (const harness of ["claude", "codex", "pi"]) writeFileSync(join(bin, harness), "#!/bin/sh\necho unexpected-harness-launch >&2\nexit 99\n", { mode: 0o755 });
  const tmuxDir = realpathSync(mkdtempSync('/tmp/aw-journey.'));
  const env = {
    TMUX_TMPDIR: tmuxDir,
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, OATS_TEAM_SCOPE: deployment, OATS_SETTINGS: "{}", OATS_CLI_BIN: OATS,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", OATS_REMOTE_CACHE: join(base, "cache"),
    ...(process.env.XDG_RUNTIME_DIR ? { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR } : {}),
    ...(process.env.DBUS_SESSION_BUS_ADDRESS ? { DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS } : {}),
  };
  const features = JSON.parse(spawnSync(process.execPath, [OATS, "--version", "--json"], { encoding: "utf8", env }).stdout).features;
  assert.ok(features.includes("teams-conditional-default"), "the journeys need a kernel with teams-conditional-default");
  const cleanups = [];
  const joinObservation = process.env.OATS_AWEB_CAPTURE_DIR ? observePrivateRegistryAw(bin, realpathSync(AW)) : undefined;
  t.after(() => {
    if (joinObservation && existsSync(joinObservation)) {
      const observations = readFileSync(joinObservation, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
      const id = createHash('sha256').update(t.name).digest('hex').slice(0, 12);
      nativeCapture('join-private-registry-' + id, observations, { version: awVersion, commit: awCommit });
    }
    for (const c of cleanups.reverse()) { try { c(); } catch { /* best effort */ } }
    rmSync(tmuxDir, { recursive: true, force: true }); rmSync(base, { recursive: true, force: true });
  });
  const parsed = (r) => { let doc; try { doc = JSON.parse(r.stdout.trim().split("\n").at(-1)); } catch { doc = undefined; } return { ...r, doc }; };
  const run = (args, extra = {}) => parsed(spawnSync(process.execPath, [HOOK, "resident", ...args], { env: { ...env, OATS_SETTINGS: JSON.stringify({ registry: AWID_URL }), ...extra }, cwd: deployment, encoding: "utf8", input: "", timeout: 180000 }));
  /** A command line as an operator types it in the deployment, `oats` being the kernel. */
  const shell = (line) => parsed(spawnSync("/bin/sh", ["-c", line], { env, cwd: deployment, encoding: "utf8", input: "", timeout: 300000 }));
  const aw = (cwd, args, extra = {}) => spawnSync(join(bin, "aw"), args, { cwd, encoding: "utf8", env: { PATH: env.PATH, HOME: home, AWEB_URL, AWID_REGISTRY_URL: AWID_URL, AW_NO_UPDATE_CHECK: "1", NO_COLOR: "1", ...extra } });
  /** Makes the deployment a workspace's: one `probe` soul (work: directory)
   *  with oats.aweb from a local git member, at this checkout's capability.
   *  Seats take session delivery, which needs no harness plugin. */
  const workspace = ({ teams = "", defaultTeam } = {}) => {
    const host = join(base, "source"), ref = pathToFileURL(host).href;
    mkdirSync(join(host, "souls", "probe"), { recursive: true });
    writeFileSync(join(host, "oats-workspace.yaml"), `schemaVersion: 2\nname: fixture\nmembers:\n  - ${ref}\n${teams}${defaultTeam ? `defaultTeam: ${defaultTeam}\n` : ""}localTeams: true\ndefaults:\n  messaging:\n    oats.aweb: { from: local/${host} }\n`);
    writeFileSync(join(host, "oats-membership.yaml"), `schemaVersion: 2\nworkspace: ${ref}\n`);
    writeFileSync(join(host, "souls", "probe", "soul.yaml"), "schemaVersion: 2\nname: probe\ndescription: probe\nwork: directory\n");
    writeFileSync(join(host, "souls", "probe", "AGENTS.md"), "Fixture only.\n");
    cpSync(CAPABILITY, join(host, "capabilities", "oats-aweb"), { recursive: true });
    const git = (...args) => spawnSync("git", ["-C", host, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { env, encoding: "utf8" });
    for (const args of [["init", "-q"], ["add", "."], ["commit", "-qm", "fixture workspace"]]) assert.equal(git(...args).status, 0, `git ${args[0]}`);
    writeFileSync(join(deployment, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${ref}\nsettings:\n  oats.aweb:\n    delivery: session\n`);
    wakeBroker();
  };
  /** This user's host wake broker, running as a supervisor would run it. A
   *  seat under session delivery is refused while none runs. */
  const wakeBroker = () => {
    const child = spawn(join(bin, "aw"), ["wake", "run"], { cwd: home, env: { ...env, AW_NO_UPDATE_CHECK: "1" }, stdio: "ignore" });
    child.unref();
    cleanups.push(() => child.kill("SIGTERM"));
    for (const deadline = Date.now() + 20000; ;) {
      const status = aw(home, ["wake", "status", "--json"]);
      let running = false;
      try { running = JSON.parse(status.stdout).daemon_running === true; } catch { /* not answering yet */ }
      if (running) return;
      assert.ok(Date.now() < deadline, `aw wake run did not come up: ${status.stdout}${status.stderr}`);
      spawnSync("sleep", ["0.2"]);
    }
  };
  return { base, deployment, home, bin, env, run, shell, aw, workspace, cleanups, teamReadFirst, awVersion, awCommit, tmuxDir };
}
/** A complete global identity in root, made the way aweb's own real-stack e2e
 *  makes one, whose custody and per-user unit the cleanups stop. */
function globalIdentity(j, root, name, ns) {
  mkdirSync(root, { recursive: true });
  const step = (args) => { const r = j.aw(root, args, { AWID_SKIP_DNS_VERIFY: "1" }); assert.equal(r.status, 0, `aw ${args.join(" ")}: ${r.stdout}${r.stderr}`); return r.stdout; };
  step(["id", "create", "--domain", ns, "--name", name, "--registry", AWID_URL, "--skip-dns-verify", "--json"]);
  step(["id", "team", "create", "--namespace", ns, "--name", "default", "--registry", AWID_URL, "--json"]);
  const cert = JSON.parse(step(["id", "team", "add-member", "--namespace", ns, "--team", "default", "--member", `${ns}/${name}`, "--json"])).certificate_id;
  step(["id", "team", "fetch-cert", "--namespace", ns, "--team", "default", "--cert-id", cert, "--registry", AWID_URL, "--json"]);
  step(["init", "--do-not-touch-agents-md", "--json"]);
  const label = `ai.aweb.custody.${ns}.${name}`;
  j.cleanups.push(() => j.aw(root, ["custody", "stop"]));
  if (process.platform === "darwin") j.cleanups.push(() => spawnSync("launchctl", ["bootout", `gui/${userInfo().uid}/${label}`]));
  else j.cleanups.push(() => spawnSync("systemctl", ["--user", "disable", "--now", `${label}.service`], { env: j.env }));
  // Explicit operator admission for this disposable private registry. This
  // record-only command changes no root, account, team or default. Kernel
  // spawn/join hooks must read the persisted setting, not the ambient AWID URL.
  const optedIn = j.shell(`oats aweb setup --registry ${JSON.stringify(AWID_URL)} --soul probe --json`);
  assert.equal(optedIn.status, 0, optedIn.stdout + optedIn.stderr);
  assert.equal(optedIn.doc.schemaVersion, 1);
  assert.equal(optedIn.doc.ok, true);
  assert.equal(optedIn.doc.result.registry, AWID_URL);
  return label;
}
/** From aw 1.36.59 (aweb 32b8f4977; cmd/aw/workspace_local_retire.go at
 *  57359d18ae), a delete of a local member of a team that is not hosted, on a
 *  machine holding that team's controller key, retires the member itself: it
 *  deletes the workspace and revokes the certificate, and answers
 *  alias_released: true. Without the key, aw keeps the released team_not_hosted
 *  refusal, which hands the membership to the controller. */
const retiresLocalMember = (version) => versionAtLeast(version, "1.36.59-rc.4");
/** The one active certificate the team lists for alias, read as its controller. */
function seatCertificate(step, teamId, alias) {
  const listed = JSON.parse(step(["id", "team", "members", "--team-id", teamId, "--registry", AWID_URL, "--json"])).members.filter((m) => m.alias === alias);
  assert.equal(listed.length, 1, `${teamId} lists one active certificate for ${alias}: ${JSON.stringify(listed)}`);
  return listed[0].certificate_id;
}
/** The team lists certificateId only as revoked. */
function assertRetiredAtService(step, teamId, certificateId) {
  const active = JSON.parse(step(["id", "team", "members", "--team-id", teamId, "--registry", AWID_URL, "--json"])).members;
  assert.equal(active.some((m) => m.certificate_id === certificateId), false, `${teamId} no longer lists ${certificateId} as a member`);
  const all = JSON.parse(step(["id", "team", "members", "--team-id", teamId, "--registry", AWID_URL, "--include-revoked", "--json"])).members;
  const row = all.find((m) => m.certificate_id === certificateId);
  assert.ok(row?.revoked_at, `${teamId} records ${certificateId} as revoked: ${JSON.stringify(row)}`);
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

test("a forced API-key init failure leaves no key anywhere; on aw 1.36.33 it registers at awid and a rerun keeps the same DID, from aw 1.36.53 aw refuses before minting and a rerun runs aw again", async (t) => {
  if (!configured(t)) return;
  const j = journey(t);
  const key = `aw_sk_journey_${randomBytes(12).toString("hex")}`;
  const root = join(j.deployment, ".aweb-residents", "alice");
  const first = j.run(["create", "alice", "--json"], { AWEB_API_KEY: key, AWEB_URL, AWID_REGISTRY_URL: AWID_URL });
  assert.equal(first.status, 1, first.stdout + first.stderr);
  if (j.teamReadFirst) {
    // The refusal is aw's own, and nothing was minted: no partial; R holds only
    // the captures and aw's recovery lock, so a rerun runs aw init again.
    assert.equal(first.doc.error.code, "E_RESIDENT_NOTHING_TO_CONTINUE");
    const captured = (kind) => readFileSync(first.doc.error.details.captures.find((p) => p.endsWith(kind)), "utf8").trim();
    const awText = captured(".stderr") || captured(".stdout");
    assert.match(awText, /^The aweb service at \S+ /, "aw names the service that refused");
    assert.ok(first.doc.error.message.startsWith(`${awText}\n`), first.doc.error.message);
    assert.equal(first.doc.error.details.partial, null);
    assert.ok(!existsSync(join(root, ".aw", "partial-init.yaml")));
    assert.match(first.doc.error.message, /\nnothing was created; fix what aw reports above, then rerun the same command \(aw's output is kept in \S+\)$/);
    const again = j.run(["create", "alice", "--json"], { AWEB_API_KEY: key, AWEB_URL, AWID_REGISTRY_URL: AWID_URL });
    assert.equal(again.doc.error.code, "E_RESIDENT_NOTHING_TO_CONTINUE", "the rerun reaches aw again");
    assert.ok(again.doc.error.message.startsWith(`${awText}\n`), again.doc.error.message);
    assert.equal(readdirSync(join(root, ".oats-resident")).length, 6, "both runs' captures are kept");
    for (const r of [first, again]) assert.ok(!r.stdout.includes(key) && !r.stderr.includes(key));
    assert.deepEqual(filesUnder(j.base).filter((p) => readFileSync(p).includes(key)), []);
    assert.equal(statSync(join(root, ".oats-resident")).mode & 0o777, 0o700);
    return;
  }
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

test("a rerun with another registry gets aw's own refusal, unchanged (aw 1.36.33: from aw 1.36.53 aw leaves no partial to carry a registry)", (t) => {
  if (!configured(t)) return;
  const j = journey(t);
  const key = `aw_sk_journey_${randomBytes(12).toString("hex")}`;
  if (j.teamReadFirst) { t.skip("from aw 1.36.53, aw refuses before writing a partial on this server, so no rerun carries a registry; the previous journey covers its refusal"); return; }
  assert.equal(j.run(["create", "alice"], { AWEB_API_KEY: key, AWEB_URL, AWID_REGISTRY_URL: AWID_URL }).status, 1);
  const other = AWID_URL.replace("127.0.0.1", "localhost");
  const r = j.run(["create", "alice", "--json"], { AWEB_API_KEY: key, AWEB_URL, AWID_REGISTRY_URL: other, OATS_SETTINGS: JSON.stringify({ registry: other }) });
  assert.equal(r.doc.error.code, "E_RESIDENT_INIT");
  const partialFile = join(j.deployment, ".aweb-residents", "alice", ".aw", "partial-init.yaml");
  assert.equal(r.doc.error.message, `partial API-key init state at ${partialFile} was created for a different bootstrap context (registry_url ${JSON.stringify(AWID_URL)} != ${JSON.stringify(other)}); retry the original command or remove the file explicitly`);
});

test("a complete global identity is adopted: verified, served by a real per-user custody unit, recorded, and a rerun is a pure verify", (t) => {
  if (!configured(t)) return;
  if (!["darwin", "linux"].includes(process.platform)) { t.skip("no per-user service manager on this platform"); return; }
  const j = journey(t);
  j.workspace();
  const ns = `res-${randomBytes(4).toString("hex")}.test`;
  const root = join(j.base, "carol");
  const label = globalIdentity(j, root, "carol", ns);

  // The key is in the environment, as on the dashboard's line: adopting needs
  // no init, so it must reach nothing the custody and record stages write.
  const key = `aw_sk_journey_${randomBytes(12).toString("hex")}`;
  const withKey = { AWEB_API_KEY: key, AWEB_URL, AWID_REGISTRY_URL: AWID_URL };
  const r = j.run(["create", "carol", "--root", root, "--json"], withKey);
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

  const again = j.run(["create", "carol", "--root", root, "--json"], { ...withKey, OATS_SETTINGS: JSON.stringify({ registry: AWID_URL, residents: { carol: root } }) });
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(again.doc.result.outcome, "already-exists");

  // No written file has the key: the real unit, oats-local.yaml, R and the
  // home aw used. Nor has the loaded service's environment.
  assert.ok(filesUnder(j.base).includes(result.custody.path));
  assert.deepEqual(filesUnder(j.base).filter((p) => readFileSync(p).includes(key)), []);
  for (const out of [r, again]) assert.ok(!out.stdout.includes(key) && !out.stderr.includes(key));
  const loaded = process.platform === "darwin"
    ? spawnSync("launchctl", ["print", `gui/${userInfo().uid}/${label}`], { encoding: "utf8" })
    : spawnSync("systemctl", ["--user", "show", "-p", "Environment", `${label}.service`], { encoding: "utf8", env: j.env });
  assert.equal(loaded.status, 0, loaded.stderr);
  assert.ok(!loaded.stdout.includes(key), loaded.stdout);
  assert.match(loaded.stdout, /PATH/);
  // launchctl prints NAME => value; systemctl show prints NAME=value.
  const unitRegistryValues = [...loaded.stdout.matchAll(/(?:^Environment=|^|[\s"])AWID_REGISTRY_URL\s*(?:=>\s*|=)"?([^"\s]+)(?=["\s]|$)/gm)].map(match => match[1]);
  assert.deepEqual(unitRegistryValues, [AWID_URL]);
  assert.doesNotMatch(loaded.stdout, /\bAWEB_/);
  assert.deepEqual([...new Set(loaded.stdout.match(/\bAWID_[A-Za-z0-9_]*/g) ?? [])], ["AWID_REGISTRY_URL"]);
});

// ------------------------------------------------------------------ the printed steps, run as printed

/** The next steps the text output prints, in order: one `Next:` spawn line, or
 *  the numbered steps after `Next, in order (…):`. */
function printedSteps(stdout) {
  const lines = stdout.split("\n");
  const sentence = "Next: spawn a seat on this resident: ";
  const one = lines.find((l) => l.startsWith(sentence));
  if (one) return [one.slice(sentence.length)];
  const at = lines.findIndex((l) => l.startsWith("Next, in order ("));
  assert.ok(at >= 0, `no next step in:\n${stdout}`);
  const steps = [];
  for (const l of lines.slice(at + 1)) { const m = /^  \d+\. (.+)$/.exec(l); if (!m) break; steps.push(m[1]); }
  return steps;
}

/** Adopts a resident in the deployment's default R with the dashboard's bare
 *  line, runs every printed step in order through the kernel, the spawn first
 *  with --preview and then with --no-launch, checks the scaffold's grant at
 *  the resident's custody, and retires it. */
async function printedStepsJourney(t, { teams, defaultTeam, expectStatus, expectDefault, expectFirstStep }) {
  if (!configured(t)) return;
  if (!["darwin", "linux"].includes(process.platform)) { t.skip("no per-user service manager on this platform"); return; }
  const j = journey(t);
  const ns = `res-${randomBytes(4).toString("hex")}.test`;
  const team = `default:${ns}`;
  j.workspace({ teams: teams?.(team) ?? "", defaultTeam });
  const root = join(j.deployment, ".aweb-residents", "carol");
  globalIdentity(j, root, "carol", ns);

  Object.assign(j.env, { AWID_REGISTRY_URL: AWID_URL });
  const created = j.shell("oats aweb resident create carol");
  assert.equal(created.status, 0, created.stdout + created.stderr);
  const steps = printedSteps(created.stdout);
  // The --json rerun is a pure verify that answers the same steps.
  const again = j.shell("oats aweb resident create carol --json");
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(again.doc.result.outcome, "already-exists");
  assert.equal(again.doc.result.teamLabel.status, expectStatus === "added" ? "reused" : expectStatus);
  assert.equal(again.doc.result.teamLabel.derived, true);
  assert.deepEqual(again.doc.result.steps, steps);
  assert.equal(again.doc.result.next, `spawn a seat on this resident: ${steps.at(-1)}`);
  assert.match(created.stdout, new RegExp(`^team label: default \\(derived from the team's name\\) ${expectStatus === "added" ? "mapped to" : "already maps to"} ${team.replace(/\./g, "\\.")}$`, "m"));
  if (expectDefault === "set") assert.match(created.stdout, /^default team: default \(set: the deployment had none\)$/m);
  assert.equal(steps.length, expectFirstStep ? 2 : 1, created.stdout);
  if (expectFirstStep) assert.equal(steps[0], expectFirstStep);

  for (const step of steps.slice(0, -1)) {
    const r = j.shell(step);
    assert.equal(r.status, 0, `${step}: ${r.stdout}${r.stderr}`);
  }
  const teamsNow = JSON.parse(j.shell("oats teams --json").stdout).result;
  assert.deepEqual({ label: teamsNow.defaultTeam?.label, team: teamsNow.defaultTeam?.team }, { label: "default", team });

  const spawnLine = steps.at(-1).replace("<soul>", "probe");
  const preview = j.shell(`${spawnLine} --preview --json`);
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.equal(preview.doc.ok, true, preview.stdout);
  const scaffold = j.shell(`${spawnLine} --no-launch --json`);
  assert.equal(scaffold.status, 0, scaffold.stdout + scaffold.stderr);
  const { instance, home } = scaffold.doc.result;
  // Not rolled back: the home and its record are there.
  const record = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  const identity = record.capabilityMeta["oats.aweb"].identity;
  assert.equal(identity.mode, "global");
  assert.equal(identity.resident, "carol");
  assert.equal(identity.team, team);
  assert.match(identity.grant.id, /\S/);
  // The seat verifies at the explicitly configured registry matching this resident.
  assert.equal(record.launch.hooks.env.AWID_REGISTRY_URL, AWID_URL);
  // Health observes only this journey's disposable resident and scaffold.
  const health = healthHost({ deployment: j.deployment, env: j.env, settings: { registry: AWID_URL } });
  const who = JSON.parse(j.aw(root, ['whoami', '--json']).stdout);
  assert.deepEqual(await health.identityOf({ cwd: root }), { did: who.did, stable_id: who.stable_id });
  assert.match(who.stable_id, /^did:aw:/);
  const readiness = await health.readiness(home);
  assert.ok(readiness && ['ready', 'needs-configuration', 'authorization-required', 'unavailable'].includes(readiness.status), JSON.stringify(readiness));
  assert.ok(Array.isArray(readiness.problems) && Array.isArray(readiness.warnings));
  const shown = j.aw(root, ['id', 'grant', 'show', identity.grant.id, '--json']);
  assert.equal(shown.status, 0, shown.stderr);
  assert.equal(JSON.parse(shown.stdout).status, 'active');
  nativeCapture('grant-show', JSON.parse(shown.stdout), { version: j.awVersion, commit: j.awCommit, paths: { [j.base]: '/fixture/journey' } });
  nativeCapture('resident-whoami', who, { version: j.awVersion, commit: j.awCommit, paths: { [j.base]: '/fixture/journey' } });
  const captureHome = join(j.base, 'capture-grant');
  const custodyStatus = j.aw(root, ['custody', 'status', '--json']);
  assert.equal(custodyStatus.status, 0, custodyStatus.stderr);
  const custodySocket = JSON.parse(custodyStatus.stdout).socket_path;
  assert.equal(typeof custodySocket, 'string');
  const minted = j.aw(root, ['id', 'grant', 'mint', '--team=' + team, '--scope=mail.read', '--ttl=never', '--out=' + captureHome, '--custody-socket=' + custodySocket, '--json']);
  assert.equal(minted.status, 0, minted.stdout + minted.stderr);
  const mintDoc = JSON.parse(minted.stdout);
  nativeCapture('grant-mint', mintDoc, { version: j.awVersion, commit: j.awCommit, paths: { [j.base]: '/fixture/journey' } });
  const revokedCapture = j.aw(root, ['id', 'grant', 'revoke', mintDoc.grant_id, '--json']);
  assert.equal(revokedCapture.status, 0, revokedCapture.stderr);

  const unattached = join(j.base, 'unattached-grant');
  cpSync(identity.grant.home, unattached, { recursive: true });
  const grantYaml = join(unattached, 'grant.yaml');
  writeFileSync(grantYaml, readFileSync(grantYaml, 'utf8').split('\n').filter(line => !line.trimStart().startsWith('socket_path:')).join('\n'));
  const missingLocator = j.aw(j.base, ['custody', 'status', '--json'], { AWEB_IDENTITY_HOME: unattached });
  assert.notEqual(missingLocator.status, 0);
  assert.match(missingLocator.stdout + missingLocator.stderr, /grant home has no custody\.socket_path locator/);
  const list = (argv) => { const r = j.aw(root, argv.slice(1)); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const seatLabel = seatGrantLabel(instance, identity.seat);
  const active = () => teamGrants(list, team).filter((g) => g.label === seatLabel && g.status === "active").map((g) => g.grant_id);
  assert.deepEqual(active(), [identity.grant.id], "the scaffold's grant is active at the resident's custody");

  const retired = j.shell(`oats retire ${instance} --json`);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.deepEqual(active(), [], "no active grant of this seat remains after the retire");
}

test("printed steps, no default team: the command sets it, and the spawn line alone previews and scaffolds a seat", (t) => {
  return printedStepsJourney(t, { expectStatus: "added", expectDefault: "set" });
});

test("printed steps, the workspace's default team is another: it is kept, and `oats teams default` printed first makes the spawn work", (t) => {
  return printedStepsJourney(t, { teams: () => "teams:\n  core: { team: 'core:example.invalid' }\n", defaultTeam: "core", expectStatus: "added", expectDefault: "kept", expectFirstStep: "oats teams default default" });
});

test("printed steps, the derived label already maps to the resident's team and is the default: reused, and the spawn line alone works", (t) => {
  return printedStepsJourney(t, { teams: (team) => `teams:\n  default: { team: '${team}' }\n`, defaultTeam: "default", expectStatus: "reused", expectDefault: "already" });
});

test("a real grant seat retires in team X while its resident keeps team Y active, and show confirms an uncertain revoke", (t) => {
  if (!configured(t)) return;
  if (!["darwin", "linux"].includes(process.platform)) { t.skip("no per-user service manager on this platform"); return; }
  const j = journey(t), ns = `grant-team-${randomBytes(4).toString("hex")}.test`;
  const teamX = `alpha:${ns}`, teamY = `default:${ns}`;
  j.env.TMUX_TMPDIR = join(j.base,"tmux");
  mkdirSync(j.env.TMUX_TMPDIR);
  j.workspace({teams:`teams:\n  x: { team: '${teamX}' }\n`, defaultTeam:"x"});
  const root = join(j.base, "resident");
  globalIdentity(j, root, "resident", ns);
  const step = args => {
    const r = j.aw(root, args, {AWID_SKIP_DNS_VERIFY:"1"});
    assert.equal(r.status, 0, `aw ${args.join(" ")}: ${r.stdout}${r.stderr}`);
    return r.stdout;
  };
  step(["id", "team", "create", "--namespace", ns, "--name", "alpha", "--registry", AWID_URL, "--json"]);
  const cert = JSON.parse(step(["id", "team", "add-member", "--namespace", ns, "--team", "alpha", "--member", `${ns}/resident`, "--json"])).certificate_id;
  step(["id", "team", "fetch-cert", "--namespace", ns, "--team", "alpha", "--cert-id", cert, "--registry", AWID_URL, "--json"]);
  step(["workspace", "connect", "--team", teamX, "--service", AWEB_URL, "--json"]);
  step(["team", "switch", teamY]);
  const teams = JSON.parse(step(["team", "list", "--json"]));
  assert.equal(teams.active_team, teamY);
  assert.ok(teams.memberships.some(row=>row.team_id===teamX));
  const adopted = j.run(["create", "resident", "--root", root, "--json"], {AWEB_URL, AWID_REGISTRY_URL:AWID_URL});
  assert.equal(adopted.status, 0, adopted.stdout + adopted.stderr);
  Object.assign(j.env, {AWEB_URL, AWID_REGISTRY_URL:AWID_URL});
  const spawned = j.shell("oats spawn probe --name grant-seat --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=resident --no-launch --json");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const {home, instance} = spawned.doc.result;
  const identity = JSON.parse(readFileSync(join(home,"instance.json"),"utf8")).capabilityMeta["oats.aweb"].identity;
  assert.equal(identity.team, teamX);

  // This wrapper forwards every operation to the real aw and service. Only
  // after a successful real revoke does it simulate a lost client response,
  // forcing the hook to confirm with a real show. It never fakes grant state.
  const log = join(j.base,"grant-calls.jsonl"), realAw = realpathSync(AW);
  rmSync(join(j.bin,"aw"));
  writeFileSync(join(j.bin,"aw"), `#!${process.execPath}
const {spawnSync}=require('node:child_process');
const {appendFileSync}=require('node:fs');
const args=process.argv.slice(2);
const r=spawnSync(${JSON.stringify(realAw)},args,{env:process.env,encoding:'utf8'});
if(args[0]==='id' && args[1]==='grant' && ['revoke','show'].includes(args[2])) appendFileSync(${JSON.stringify(log)},JSON.stringify({args,status:r.status})+'\\n');
process.stdout.write(r.stdout||''); process.stderr.write(r.stderr||'');
if(args[0]==='id' && args[1]==='grant' && args[2]==='revoke' && r.status===0) {process.stderr.write('revoke may have applied: context deadline exceeded\\n'); process.exit(1);}
process.exit(r.status ?? 1);
`, {mode:0o755});
  const retired = j.shell(`oats retire ${instance} --json`);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  const calls = readFileSync(log,"utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(calls.map(c=>c.args[2]), ["revoke","show"]);
  for (const call of calls) {
    assert.ok(call.args.includes(`--team=${teamX}`), JSON.stringify(call));
    assert.equal(call.status, 0, "the real aw operation succeeded at the service");
  }
  assert.equal(JSON.parse(step(["id","grant","show",identity.grant.id,`--team=${teamX}`,"--json"])).status,"revoked");
  assert.equal(JSON.parse(step(["team","list","--json"])).active_team,teamY);
});

test("a real joined-team spawn: invite, accept, connect and register on this aw, and a retire leaves nothing", async (t) => {
  if (!configured(t)) return;
  if (!["darwin", "linux"].includes(process.platform)) { t.skip("no per-user service manager on this platform"); return; }
  const j = journey(t);
  const ns = `joined-${randomBytes(4).toString("hex")}.test`;
  const team = `default:${ns}`, joinedTeam = `alpha:${ns}`;
  j.workspace({ teams: `teams:\n  default: { team: '${team}' }\n  alpha: { team: '${joinedTeam}' }\nsouls:\n  '*':\n    teams: any\n`, defaultTeam: "default" });
  // The deployment's own root holds both teams' controller keys, as a minting root does.
  globalIdentity(j, j.deployment, "root", ns);
  const step = (args) => { const r = j.aw(j.deployment, args, { AWID_SKIP_DNS_VERIFY: "1" }); assert.equal(r.status, 0, `aw ${args.join(" ")}: ${r.stdout}${r.stderr}`); return r.stdout; };
  step(["id", "team", "create", "--namespace", ns, "--name", "alpha", "--registry", AWID_URL, "--json"]);
  const cert = JSON.parse(step(["id", "team", "add-member", "--namespace", ns, "--team", "alpha", "--member", `${ns}/root`, "--json"])).certificate_id;
  step(["id", "team", "fetch-cert", "--namespace", ns, "--team", "alpha", "--cert-id", cert, "--registry", AWID_URL, "--json"]);
  const local = join(j.deployment, "oats-local.yaml");
  writeFileSync(local, readFileSync(local, "utf8").replace("    delivery: session\n", `    delivery: session\n    root: ${j.deployment}\n`));
  Object.assign(j.env, { AWEB_URL, AWID_REGISTRY_URL: AWID_URL });

  // Human attribution (README): this root has no person behind it, so the join passes
  // no --parent. A shim records the argv the provider hands the real aw.
  const argvBin = join(j.base, "argv-bin"), argvLog = join(j.base, "aw-argv.log");
  mkdirSync(argvBin);
  writeFileSync(join(argvBin, "aw"), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(argvLog)}\nexec ${JSON.stringify(join(j.bin, "aw"))} "$@"\n`, { mode: 0o755 });
  const plainPath = j.env.PATH;
  j.env.PATH = `${argvBin}:${plainPath}`;
  const spawned = j.shell("oats spawn probe --name joined-seat --provider oats.aweb join=alpha --no-launch --json");
  j.env.PATH = plainPath;
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const { home } = spawned.doc.result;
  const awArgv = readFileSync(argvLog, "utf8").trim().split("\n");
  const acceptArgv = awArgv.filter((line) => line.includes(" id team accept-invite "));
  assert.equal(acceptArgv.length, 1, awArgv.join("\n"));
  assert.doesNotMatch(acceptArgv[0], /--parent/, "a chainless root's join passes no --parent");
  assert.ok(awArgv.some((line) => line === `--identity-home ${join(j.deployment, ".aw")} who --json`), "the join read its root with aw who");
  const record = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  const [joined] = record.capabilityMeta["oats.aweb"].joinedTeams;
  assert.deepEqual({ label: joined.label, team: joined.team, receive: joined.receive }, { label: "alpha", team: joinedTeam, receive: "native" });
  const identityHome = join(home, ".aweb-identity-alpha");
  assert.ok(existsSync(join(identityHome, "workspace.yaml")), "the joined identity is connected");
  const listed = j.aw(home, ["--identity-home", identityHome, "id", "team", "list", "--json"]);
  assert.equal(listed.status, 0, listed.stdout + listed.stderr);
  assert.match(listed.stdout, new RegExp(joinedTeam.replace(/\./g, "\\.")));

  const who = j.aw(home, ['whoami', '--json']);
  assert.equal(who.status, 0, who.stderr);
  const ids = await healthHost({ deployment: j.deployment, env: j.env, settings: { registry: AWID_URL } }).identityOf({ identityHome: join(home, '.aw') });
  assert.equal(ids.did, JSON.parse(who.stdout).did);
  assert.match(ids.did, /^did:key:z/);
  assert.equal(ids.stable_id, undefined);
  const host = healthHost({ deployment: j.deployment, env: j.env, settings: { registry: AWID_URL } });
  for (const args of [['id', 'team', 'members', '--team-id', team, '--registry', AWID_URL, '--json'], ['workspace', 'status', '--limit=200', '--json'], ['mail', 'inbox', '--count-only', '--json']]) {
    const r = j.aw(home, args);
    if (args.includes('--count-only') && j.awVersion === '1.36.33') {
      assert.notEqual(r.status, 0, 'the floor must refuse unsupported count-only');
      assert.match(r.stderr, /unknown flag: --count-only/);
      assert.equal(await host.supportsUnreadCount(), false);
      continue;
    }
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const doc = JSON.parse(r.stdout);
    assert.ok(doc, 'real roster/count response is JSON');
    if (args.includes('--count-only')) {
      const count = await host.unreadCount(join(home, '.aw'));
      assert.ok(Number.isSafeInteger(count) && count >= 0, 'the provider reads a nonnegative native unread_count');
      assert.equal(count, doc.unread_count);
    }
    nativeCapture(args[0] === 'id' ? 'roster-members' : args[0] === 'workspace' ? 'roster-presence' : 'mail-inbox-count', doc, { version: j.awVersion, commit: j.awCommit, paths: { [j.base]: '/fixture/journey' } });
  }
  const listedRoster = j.shell('oats aweb roster --soul probe --json');
  assert.equal(listedRoster.status, 0, listedRoster.stdout + listedRoster.stderr);
  const roster = JSON.parse(listedRoster.stdout);
  assert.equal(roster.certificatesComplete, true);
  assert.equal(roster.presenceComplete, true);
  const seat = roster.members.find(member => member.alias === spawned.doc.result.instance);
  assert.ok(seat, 'the provider roster contains the joined seat');
  assert.deepEqual(seat.sources, ['certificate', 'presence']);
  // On an aw with accept-invite --parent (the pinned next, 1.36.59-rc.5), the argv
  // an adopted root's join passes is parsed by the real aw, which answers its JSON:
  // here against a chainless parent on the stack. The completed parented accept is
  // proven by aweb's own E2E against an adopted root.
  const acceptHelp = j.aw(home, ["id", "team", "accept-invite", "--help"]);
  assert.equal(acceptHelp.status, 0, acceptHelp.stderr);
  if (/^\s+--parent string\s/m.test(acceptHelp.stdout)) {
    const invite = JSON.parse(step(["team", "invite", `--team-id=${joinedTeam}`, "--json"]));
    const parentedHome = join(home, ".aweb-identity-parented");
    const parented = spawnSync(join(j.bin, "aw"), ["--identity-home", parentedHome, "id", "team", "accept-invite", "--token-stdin", "--name=joined-seat-parented", "--local", `--parent=${join(j.deployment, ".aw")}`, "--json"], { cwd: home, encoding: "utf8", input: invite.token + "\n", env: { PATH: j.env.PATH, HOME: j.env.HOME, AWEB_URL, AWID_REGISTRY_URL: AWID_URL, AW_NO_UPDATE_CHECK: "1", NO_COLOR: "1" } });
    assert.doesNotMatch(parented.stderr, /unknown flag|unknown command/, parented.stderr);
    const answer = JSON.parse(parented.stdout.trim().split("\n").at(-1));
    assert.ok(answer && typeof answer === "object", `aw answered its JSON: ${parented.stdout}${parented.stderr}`);
    if (parented.status !== 0) assert.equal(typeof answer.error?.code, "string", `a refusal is aw's envelope: ${parented.stdout}`);
    else rmSync(parentedHome, { recursive: true, force: true });
  } else {
    assert.ok(!versionAtLeast(j.awVersion, "1.36.59-rc.3"), `aw ${j.awVersion} should have accept-invite --parent`);
  }
  const seatCerts = retiresLocalMember(j.awVersion) ? { default: seatCertificate(step, team, seat.alias), alpha: seatCertificate(step, joinedTeam, seat.alias) } : undefined;
  const retired = j.shell("oats retire joined-seat --json");
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(existsSync(identityHome), false);
  const meta = JSON.parse(retired.stdout).capabilityMeta["oats.aweb"];
  if (!retiresLocalMember(j.awVersion)) {
    // Neither team is hosted here, so aw's refusal hands both memberships to the controller.
    assert.deepEqual(meta.pendingControllerCleanup.map((c) => c.label).sort(), ["alpha", "default"]);
    return;
  }
  // This root holds both teams' controller keys, so aw retires the member itself:
  // nothing is left for the controller, and nothing stays at the service.
  assert.equal(meta.pendingControllerCleanup, undefined, retired.stdout);
  assertRetiredAtService(step, team, seatCerts.default);
  assertRetiredAtService(step, joinedTeam, seatCerts.alpha);
  const after = j.shell("oats aweb roster --soul probe --json");
  assert.equal(after.status, 0, after.stdout + after.stderr);
  assert.equal(JSON.parse(after.stdout).members.find((member) => member.alias === seat.alias), undefined, "the default team's roster no longer lists the seat");
});

test("a real join killed right after this aw accepted the invite (awebai/oats-aweb#217): retire releases the unrecorded membership, and nothing stays at the service", (t) => {
  if (!configured(t)) return;
  if (!["darwin", "linux"].includes(process.platform)) { t.skip("no per-user service manager on this platform"); return; }
  const j = journey(t);
  const ns = `killed-${randomBytes(4).toString("hex")}.test`;
  const team = `default:${ns}`, joinedTeam = `alpha:${ns}`;
  j.workspace({ teams: `teams:\n  default: { team: '${team}' }\n  alpha: { team: '${joinedTeam}' }\nsouls:\n  '*':\n    teams: any\n`, defaultTeam: "default" });
  globalIdentity(j, j.deployment, "root", ns);
  const step = (args) => { const r = j.aw(j.deployment, args, { AWID_SKIP_DNS_VERIFY: "1" }); assert.equal(r.status, 0, `aw ${args.join(" ")}: ${r.stdout}${r.stderr}`); return r.stdout; };
  step(["id", "team", "create", "--namespace", ns, "--name", "alpha", "--registry", AWID_URL, "--json"]);
  const cert = JSON.parse(step(["id", "team", "add-member", "--namespace", ns, "--team", "alpha", "--member", `${ns}/root`, "--json"])).certificate_id;
  step(["id", "team", "fetch-cert", "--namespace", ns, "--team", "alpha", "--cert-id", cert, "--registry", AWID_URL, "--json"]);
  const local = join(j.deployment, "oats-local.yaml");
  writeFileSync(local, readFileSync(local, "utf8").replace("    delivery: session\n", `    delivery: session\n    root: ${j.deployment}\n`));
  Object.assign(j.env, { AWEB_URL, AWID_REGISTRY_URL: AWID_URL });

  const spawned = j.shell("oats spawn probe --name killed-seat --no-launch --json");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const { home } = spawned.doc.result;
  const identityHome = join(home, ".aweb-identity-alpha");

  // The real aw, except that a successful accept-invite then kills its
  // caller, the hook, before it can record the joined team.
  const killBin = join(j.base, "kill-bin");
  mkdirSync(killBin);
  writeFileSync(join(killBin, "aw"), `#!/bin/sh\ncase " $* " in\n  *" id team accept-invite "*) ${JSON.stringify(join(j.bin, "aw"))} "$@" || exit $?; kill -9 $PPID; exit 0 ;;\nesac\nexec ${JSON.stringify(join(j.bin, "aw"))} "$@"\n`, { mode: 0o755 });
  const path = j.env.PATH;
  j.env.PATH = `${killBin}:${path}`;
  const killed = j.shell(`cd ${JSON.stringify(home)} && oats aweb join --labels alpha --json`);
  j.env.PATH = path;
  assert.notEqual(killed.status, 0, killed.stdout + killed.stderr);
  const state = JSON.parse(readFileSync(join(home, ".oats-aweb", "teams.json"), "utf8"));
  assert.deepEqual(state.joinedTeams, [], "the hook died before it recorded the join");
  assert.deepEqual(state.pendingJoins.map((p) => [p.label, p.team, p.identityHome]), [["alpha", joinedTeam, identityHome]]);
  const listed = j.aw(home, ["--identity-home", identityHome, "id", "team", "list", "--json"]);
  assert.equal(listed.status, 0, listed.stdout + listed.stderr);
  assert.match(listed.stdout, new RegExp(joinedTeam.replace(/\./g, "\\.")), "aw holds the accepted membership");
  const members = () => step(["id", "team", "members", "--team-id", joinedTeam, "--registry", AWID_URL, "--json"]);
  const before = members();
  const killedCert = retiresLocalMember(j.awVersion) ? seatCertificate(step, joinedTeam, "killed-seat") : undefined;

  const retired = j.shell("oats retire killed-seat --json");
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(existsSync(identityHome), false);
  if (retiresLocalMember(j.awVersion)) {
    // This root holds the team's controller key, so aw retires the unrecorded
    // member itself: no controller cleanup, and its certificate is revoked.
    assert.equal(JSON.parse(retired.stdout).capabilityMeta["oats.aweb"].pendingControllerCleanup, undefined, retired.stdout);
    assertRetiredAtService(step, joinedTeam, killedCert);
    return;
  }
  // As for a recorded joined team, aw refuses a self-release on a team not
  // hosted here, so retire hands the membership to the controller.
  const cleanup = JSON.parse(retired.stdout).capabilityMeta["oats.aweb"].pendingControllerCleanup.find((c) => c.label === "alpha");
  assert.ok(cleanup?.command, `retire names the controller cleanup of the unrecorded membership: ${retired.stdout}`);
  assert.ok(before.includes(cleanup.certificateId), `the team listed the killed join's certificate before the retire: ${before}`);
  // Execute the complete operator line, including its explicit registry pin.
  const cleaned = j.shell(cleanup.command);
  assert.equal(cleaned.status, 0, cleaned.stdout + cleaned.stderr);
  assert.ok(!members().includes(cleanup.certificateId), "the team no longer lists the member");
});

test("a real joined-team seat whose teams' controller keys are not on this machine: retire hands both memberships to the controller, and its printed cleanup removes them", (t) => {
  if (!configured(t)) return;
  if (!["darwin", "linux"].includes(process.platform)) { t.skip("no per-user service manager on this platform"); return; }
  const j = journey(t);
  const ns = `keyless-${randomBytes(4).toString("hex")}.test`;
  const team = `default:${ns}`, joinedTeam = `alpha:${ns}`;
  j.workspace({ teams: `teams:\n  default: { team: '${team}' }\n  alpha: { team: '${joinedTeam}' }\nsouls:\n  '*':\n    teams: any\n`, defaultTeam: "default" });
  globalIdentity(j, j.deployment, "root", ns);
  const step = (args) => { const r = j.aw(j.deployment, args, { AWID_SKIP_DNS_VERIFY: "1" }); assert.equal(r.status, 0, `aw ${args.join(" ")}: ${r.stdout}${r.stderr}`); return r.stdout; };
  step(["id", "team", "create", "--namespace", ns, "--name", "alpha", "--registry", AWID_URL, "--json"]);
  const cert = JSON.parse(step(["id", "team", "add-member", "--namespace", ns, "--team", "alpha", "--member", `${ns}/root`, "--json"])).certificate_id;
  step(["id", "team", "fetch-cert", "--namespace", ns, "--team", "alpha", "--cert-id", cert, "--registry", AWID_URL, "--json"]);
  const local = join(j.deployment, "oats-local.yaml");
  writeFileSync(local, readFileSync(local, "utf8").replace("    delivery: session\n", `    delivery: session\n    root: ${j.deployment}\n`));
  Object.assign(j.env, { AWEB_URL, AWID_REGISTRY_URL: AWID_URL });

  const spawned = j.shell("oats spawn probe --name keyless-seat --provider oats.aweb join=alpha --no-launch --json");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const identityHome = join(spawned.doc.result.home, ".aweb-identity-alpha");
  assert.ok(existsSync(join(identityHome, "workspace.yaml")), "the joined identity is connected");

  // The controller keys are held by people elsewhere: for the retire only, move
  // this namespace's keys out of aw's key directories in the private HOME, as
  // on a machine that never held them. Every aw in the matrix then refuses the
  // self-release with its released team_not_hosted sentence.
  const keyDirs = [join(j.home, ".awid", "team-keys", ns), join(j.home, ".config", "aw", "team-keys", ns)].filter((dir) => existsSync(dir));
  assert.ok(keyDirs.some((dir) => existsSync(join(dir, "alpha.key")) && existsSync(join(dir, "default.key"))), `aw keeps both teams' controller keys in ${keyDirs.join(", ") || "none of its key directories"}`);
  const aside = join(j.home, "keys-aside");
  mkdirSync(aside);
  const moved = keyDirs.map((dir, i) => [dir, join(aside, String(i))]);
  const restore = () => { for (const [dir, to] of moved) if (existsSync(to) && !existsSync(dir)) renameSync(to, dir); };
  j.cleanups.push(restore);
  for (const [dir, to] of moved) renameSync(dir, to);
  let retired;
  try { retired = j.shell("oats retire keyless-seat --json"); } finally { restore(); }
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(existsSync(identityHome), false, "controller cleanup needs no member key: the home may go");
  const pending = JSON.parse(retired.stdout).capabilityMeta["oats.aweb"].pendingControllerCleanup ?? [];
  assert.deepEqual(pending.map((c) => c.label).sort(), ["alpha", "default"], retired.stdout);

  // The keys are back: the controller runs each printed line as it is.
  for (const [teamId, cleanup] of [[team, pending.find((c) => c.label === "default")], [joinedTeam, pending.find((c) => c.label === "alpha")]]) {
    assert.ok(cleanup.command && cleanup.certificateId, JSON.stringify(cleanup));
    const cleaned = j.shell(cleanup.command);
    assert.equal(cleaned.status, 0, cleaned.stdout + cleaned.stderr);
    const listed = JSON.parse(step(["id", "team", "members", "--team-id", teamId, "--registry", AWID_URL, "--json"])).members;
    assert.equal(listed.some((m) => m.certificate_id === cleanup.certificateId), false, `${teamId} no longer lists ${cleanup.certificateId}`);
  }
});

test('a real retained seat copies authority, reconnects, checks, heartbeats, reports its identity and releases only its own lock', async t => {
  if (!configured(t)) return;
  const j = journey(t), ns = `retained-${randomBytes(4).toString('hex')}.test`, team = `default:${ns}`;
  j.workspace({ teams: `teams:\n  default: { team: '${team}' }\n`, defaultTeam: 'default' });
  const sourceRoot = join(j.base, 'standing-seat');
  globalIdentity(j, sourceRoot, 'retained', ns);
  Object.assign(j.env, { AWEB_URL, AWID_REGISTRY_URL: AWID_URL });
  const source = join(sourceRoot, '.aw'), sourceKey = readFileSync(join(source, 'signing.key'));
  const result = j.shell(`oats spawn probe --name real-retained --harness codex --provider oats.aweb identity.source=${source} --no-launch --json`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const home = result.doc.result.home;
  const record = JSON.parse(readFileSync(join(home, 'instance.json'), 'utf8'));
  const meta = record.capabilityMeta['oats.aweb'];
  assert.equal(meta.retained, true);
  assert.equal(meta.identity.mode, 'local');
  assert.equal(meta.identity.grant, undefined);
  const who = j.aw(home, ['whoami', '--json']);
  assert.equal(who.status, 0, who.stderr);
  assert.equal(JSON.parse(who.stdout).did, JSON.parse(j.aw(sourceRoot, ['whoami', '--json']).stdout).did);
  const status = j.aw(home, ['workspace', 'status', '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).workspace.workspace_path, home);
  const paths = { [home]: '/fixture/codex', [j.base]: '/fixture/journey' };
  nativeCapture('workspace-record', readFileSync(join(home, '.aw', 'workspace.yaml'), 'utf8'), { version: j.awVersion, commit: j.awCommit, paths });
  nativeCapture('retained-presence', JSON.parse(status.stdout), { version: j.awVersion, commit: j.awCommit, paths });
  assert.deepEqual(readFileSync(join(source, 'signing.key')), sourceKey);
  const lock = join(sourceRoot, '.aw-retained-seat.json');
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).home, home);
  // Start only the journey's inert harness on its own tmux server. The broker
  // and service are real; no person's pane or agent participates in this run.
  writeFileSync(join(j.bin, 'codex'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex 0.1.0"; exit 0; fi\nexec sleep 3600\n', { mode: 0o755 });
  j.cleanups.push(() => {
    for (const rel of readdirSync(j.tmuxDir, { recursive: true })) {
      const socket = join(j.tmuxDir, rel);
      if (statSync(socket).isSocket()) spawnSync('tmux', ['-S', socket, 'kill-server'], { env: j.env });
    }
  });
  // Witness the reported ordering with real status before the session exists.
  // This makes request m's quiet-start RED deterministic in the aw candidate
  // reproduction, rather than depending on which initial inspection wins.
  const prelaunch = j.shell(`oats session inspect --home ${home} --json`);
  assert.equal(prelaunch.status, 0, prelaunch.stdout + prelaunch.stderr);
  assert.equal(prelaunch.doc.result.state, 'not-launched');
  let prelaunchWake;
  for (const deadline = Date.now() + 30000; ;) {
    const observed = j.aw(home, ['wake', 'status', '--json']);
    assert.equal(observed.status, 0, observed.stderr);
    prelaunchWake = JSON.parse(observed.stdout);
    const row = prelaunchWake.instances.find(row => row.home === home);
    if (row?.last_state === 'not-launched' && row.channel_core?.readiness_state === 'not-launched') break;
    assert.ok(Date.now() < deadline, 'the real broker must witness the prelaunch not-launched state');
    await delay(500);
  }
  nativeCapture('retained-prelaunch-wake', prelaunchWake, { version: j.awVersion, commit: j.awCommit, paths });
  const started = j.shell(`oats session start --home ${home} --json`);
  assert.equal(started.status, 0, started.stdout + started.stderr);
  const inspected = j.shell(`oats session inspect --home ${home} --json`);
  assert.equal(inspected.status, 0, inspected.stdout + inspected.stderr);
  assert.equal(inspected.doc.result.present, true);
  assert.equal(inspected.doc.result.running, true);
  nativeCapture('retained-post-start-kernel', inspected.doc.result, { version: j.awVersion, commit: j.awCommit, paths });
  let wake;
  for (const deadline = Date.now() + 30000; ;) {
    const observed = j.aw(home, ['wake', 'status', '--json']);
    assert.equal(observed.status, 0, observed.stderr);
    wake = JSON.parse(observed.stdout);
    const row = wake.instances.find(row => row.home === home);
    if (row?.receive_identities?.some(r => r.stream_admitted === true && r.stream_phase === 'streaming')) break;
    if (Date.now() >= deadline) break;
    await delay(500);
  }
  nativeCapture('codex-wake-pre-event', wake, { version: j.awVersion, commit: j.awCommit, paths });
  const expected = { home, runtime: 'codex', runtimeDelivery: 'external-session', primary: join(home, '.aw'),
    bindings: [{ identity_home: join(home, '.aw'), team, controls: true, event_classes: [] }] };
  const preRow = wake.instances.find(row => row.home === home);
  const preAssessment = targetReceiveAssessment(wake, expected, { minimumVersion: AW_MIN });
  assert.ok(['pending', 'active'].includes(preRow?.phase), JSON.stringify(preAssessment));
  // Pending aw request m: the one quiet inspection can precede the kernel's
  // launch receipt. Keep this false negative visible; once aw fixes it,
  // require phase active and no pre-event assessment problems unconditionally.
  if (preRow.phase === 'pending') {
    assert.equal(preRow.last_state, 'not-launched');
    assert.deepEqual(preAssessment.problems.map(problem => problem.code), ['wake-target-inactive']);
  } else assert.deepEqual(preAssessment.problems, []);
  t.diagnostic(`post-start pre-event broker phase=${preRow.phase}, last_state=${preRow.last_state}`);
  const senderRoot = join(j.base, 'mail-sender');
  mkdirSync(senderRoot);
  const sender = j.aw(senderRoot, ['init', '--join-from', sourceRoot, '--name=fixture-sender', '--do-not-touch-agents-md', '--json']);
  assert.equal(sender.status, 0, sender.stdout + sender.stderr);
  const marker = `oats-ci-retained-${randomBytes(10).toString('hex')}`, bodyFile = join(j.base, 'retained-mail.txt');
  writeFileSync(bodyFile, `${marker}\n`, { mode: 0o600 });
  // This sender is new and has no prior conversation. One native send drives
  // the real event path; only this journey's inert terminal can receive it.
  const sent = j.aw(senderRoot, ['mail', 'send', '--to=retained', '--subject=' + marker, '--body-file=' + bodyFile, '--json']);
  assert.equal(sent.status, 0, sent.stdout + sent.stderr);
  const receipt = JSON.parse(sent.stdout);
  assert.equal(typeof receipt.message_id, 'string');
  assert.ok(receipt.message_id.length > 0);
  nativeCapture('retained-mail-receipt', receipt, { version: j.awVersion, commit: j.awCommit, paths });
  for (const deadline = Date.now() + 30000; ;) {
    const observed = j.aw(home, ['wake', 'status', '--json']);
    assert.equal(observed.status, 0, observed.stderr);
    wake = JSON.parse(observed.stdout);
    const row = wake.instances.find(row => row.home === home);
    if (row?.phase === 'active' && row.receive_identities?.some(r => r.stream_admitted === true && r.stream_phase === 'streaming')
      && Date.parse(row.channel_core?.last_input_at) > 0) break;
    if (Date.now() >= deadline) break;
    await delay(500);
  }
  nativeCapture('codex-wake-status', wake, { version: j.awVersion, commit: j.awCommit, paths });
  const assessment = targetReceiveAssessment(wake, expected, { minimumVersion: AW_MIN });
  assert.deepEqual(assessment.problems, [], JSON.stringify(assessment));
  const delivered = wake.instances.find(row => row.home === home);
  assert.equal(delivered?.phase, 'active');
  assert.ok(delivered.receive_identities?.some(r => r.identity_home === join(home, '.aw') && r.stream_admitted === true && r.stream_phase === 'streaming'));
  assert.ok(Date.parse(delivered.channel_core?.last_input_at) > 0, 'the broker reports successful session input');
  const socket = JSON.parse(readFileSync(join(home, 'instance.json'), 'utf8')).tmux.socket;
  assert.ok(socket.startsWith(j.tmuxDir + '/'), 'delivery is inspected only on the private CI tmux server');
  const pane = spawnSync('tmux', ['-S', socket, 'capture-pane', '-p', '-J', '-t', inspected.doc.result.paneId, '-S', '-1000'], { env: j.env, encoding: 'utf8' });
  assert.equal(pane.status, 0, pane.stderr);
  assert.ok(pane.stdout.includes(marker), 'the controlled mail reached the inert pane; no model-consumption claim');
  nativeCapture('retained-delivered-pane', pane.stdout, { version: j.awVersion, commit: j.awCommit, paths });
  const retired = j.shell('oats retire real-retained --json');
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(existsSync(lock), false);
  assert.deepEqual(readFileSync(join(source, 'signing.key')), sourceKey);
});

// messaging:mail, through the pinned kernel's `oats operation run`, against the
// real aw and the real server: both identities of a joined-team home, sent and
// received, newest first, and NOTHING acknowledged: each identity's unread
// count and every message's read_at are the same before and after the read.
test("messaging:mail reads a real home's mail on both identities and acknowledges nothing", (t) => {
  if (!configured(t)) return;
  if (!["darwin", "linux"].includes(process.platform)) { t.skip("no per-user service manager on this platform"); return; }
  const j = journey(t);
  const ns = `mail-${randomBytes(4).toString("hex")}.test`;
  const team = `default:${ns}`, joinedTeam = `alpha:${ns}`;
  j.workspace({ teams: `teams:\n  default: { team: '${team}' }\n  alpha: { team: '${joinedTeam}' }\nsouls:\n  '*':\n    teams: any\n`, defaultTeam: "default" });
  globalIdentity(j, j.deployment, "root", ns);
  const step = (args, cwd = j.deployment) => { const r = j.aw(cwd, args, { AWID_SKIP_DNS_VERIFY: "1" }); assert.equal(r.status, 0, `aw ${args.join(" ")}: ${r.stdout}${r.stderr}`); return r.stdout; };
  step(["id", "team", "create", "--namespace", ns, "--name", "alpha", "--registry", AWID_URL, "--json"]);
  const cert = JSON.parse(step(["id", "team", "add-member", "--namespace", ns, "--team", "alpha", "--member", `${ns}/root`, "--json"])).certificate_id;
  step(["id", "team", "fetch-cert", "--namespace", ns, "--team", "alpha", "--cert-id", cert, "--registry", AWID_URL, "--json"]);
  const local = join(j.deployment, "oats-local.yaml");
  writeFileSync(local, readFileSync(local, "utf8").replace("    delivery: session\n", `    delivery: session\n    root: ${j.deployment}\n`));
  Object.assign(j.env, { AWEB_URL, AWID_REGISTRY_URL: AWID_URL });
  const spawned = j.shell("oats spawn probe --name mail-seat --provider oats.aweb join=alpha --no-launch --json");
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const { home } = spawned.doc.result;
  const primary = join(home, ".aw"), joined = join(home, ".aweb-identity-alpha");
  // Retire what this test spawned: at its end, asserted; on a failure, from
  // journey's cleanups, which run before its directory is removed.
  const spawnedSeats = ["mail-seat"];
  const retireSeats = () => {
    // Every seat is tried, whatever an earlier one did; the failures are
    // printed (journey's cleanups swallow a throw) and then thrown.
    const failed = [];
    while (spawnedSeats.length) {
      const name = spawnedSeats.pop();
      const retired = j.shell(`oats retire ${name} --json`);
      if (retired.status !== 0) failed.push(`retire ${name}: ${retired.stdout}${retired.stderr}`);
    }
    if (failed.length) { console.error(failed.join("\n")); assert.fail(failed.join("\n")); }
  };
  j.cleanups.push(retireSeats);
  // A second joined home sends in alpha: the deployment root holds alpha's
  // controller keys but no alpha workspace membership to send from.
  const peer = j.shell("oats spawn probe --name mail-peer --provider oats.aweb join=alpha --no-launch --json");
  assert.equal(peer.status, 0, peer.stdout + peer.stderr);
  spawnedSeats.push("mail-peer");
  const peerAlpha = join(peer.doc.result.home, ".aweb-identity-alpha");

  // Mail: root -> seat in default, mail-peer -> seat in alpha, and the seat
  // answering in default.
  const send = (cwd, args, body, identity = []) => {
    const file = join(j.base, `body-${randomBytes(4).toString("hex")}.txt`);
    writeFileSync(file, body, { mode: 0o600 });
    return JSON.parse(step([...identity, "mail", "send", ...args, `--body-file=${file}`, "--json"], cwd));
  };
  const first = send(j.deployment, ["--to=mail-seat", "--subject=first"], "hello on default");
  const second = send(peer.doc.result.home, ["--to=mail-seat", "--subject=second"], "hello on alpha", ["--identity-home", peerAlpha]);
  const third = send(home, [`--conversation-id=${first.conversation_id}`], "answer from the seat");
  for (const receipt of [first, second, third]) assert.equal(typeof receipt.message_id, "string");

  const readState = () => {
    const state = {};
    for (const identityHome of [primary, joined]) {
      const count = j.aw(home, ["--identity-home", identityHome, "mail", "inbox", "--count-only", "--json"]);
      const threads = j.aw(home, ["--identity-home", identityHome, "mail", "threads", "--json"]);
      state[identityHome] = { count: count.status === 0 ? JSON.parse(count.stdout).unread_count : `refused: ${count.stderr.trim()}`, read: {} };
      if (threads.status !== 0) { state[identityHome].threads = `refused: ${threads.stderr.trim()}`; continue; }
      for (const c of JSON.parse(threads.stdout).conversations) {
        const shown = JSON.parse(step(["--identity-home", identityHome, "mail", "show", `--conversation-id=${c.conversation_id}`, "--limit=500", "--json"], home));
        for (const m of shown.messages) state[identityHome].read[m.message_id] = m.read_at ?? null;
      }
    }
    return state;
  };
  const mailSupported = versionAtLeast(j.awVersion, "1.36.53");
  const before = mailSupported ? readState() : null;
  if (mailSupported) {
    assert.ok(before[primary].count >= 1 && before[joined].count >= 1, JSON.stringify(before));
    assert.ok(Object.values(before[primary].read).includes(null), "an unread message is there to be acknowledged by mistake");
  }

  const result = j.shell(`oats operation run messaging:mail --home ${JSON.stringify(home)} --json`);
  const doc = JSON.parse(result.stdout.trim().split("\n").at(-1));
  if (!mailSupported) {
    assert.notEqual(result.status, 0);
    assert.equal(doc.error.code, "E_AW_TOO_OLD", result.stdout + result.stderr);
    assert.match(doc.error.message, /needs aw >= 1\.36\.53/);
    retireSeats();
    return;
  }
  assert.equal(result.status, 0, result.stdout + result.stderr);
  // The kernel's operation-run answer; the provider's view result is inside it.
  assert.equal(doc.result.operation, "messaging:mail");
  assert.equal(doc.result.capability, "oats.aweb");
  const { mail, documents } = doc.result.result;
  assert.equal(documents[0].label, "Mail");
  assert.equal(mail.mailApi, 1);
  assert.equal(mail.acknowledges, false);
  assert.deepEqual(mail.identities.map((i) => [i.team, i.primary, i.error]), [["default", true, null], ["alpha", false, null]]);
  assert.deepEqual(mail.messages.map((m) => [m.id, m.team, m.direction, m.body]), [
    [third.message_id, "default", "sent", "answer from the seat"],
    [second.message_id, "alpha", "received", "hello on alpha"],
    [first.message_id, "default", "received", "hello on default"],
  ]);
  assert.deepEqual([mail.messages[1].subject, mail.messages[2].subject], ["second", "first"]);
  for (const m of mail.messages) {
    assert.equal(m.verification, "verified", JSON.stringify(m));
    assert.ok(["normal", "high", "unknown"].includes(m.priority));
    assert.equal(m.readByAgent, m.direction === "sent", "nothing the seat received was read");
  }
  assert.equal(mail.messages[2].conversationId, first.conversation_id);
  assert.equal(mail.messages[2].threadTitle, "first");
  // One conversation, through the kernel's --arg.
  const one = j.shell(`oats operation run messaging:mail --home ${JSON.stringify(home)} --arg conversation=${first.conversation_id} --arg limit=1 --json`);
  assert.equal(one.status, 0, one.stdout + one.stderr);
  const oneDoc = JSON.parse(one.stdout.trim().split("\n").at(-1)).result.result.mail;
  assert.deepEqual(oneDoc.messages.map((m) => m.id), [third.message_id]);
  assert.equal(oneDoc.hasMore, true);
  nativeCapture('mail-operation', doc.result.result, { version: j.awVersion, commit: j.awCommit, paths: { [j.base]: '/fixture/journey' } });

  assert.deepEqual(readState(), before, "the read acknowledged nothing: unread counts and read_at unchanged");
  retireSeats();
});

test("a real legacy bare-label grant seat fills at launch and retires its grant in its team", (t) => {
  if (!configured(t)) return;
  if (!["darwin", "linux"].includes(process.platform)) { t.skip("no per-user service manager on this platform"); return; }
  const j = journey(t), ns = `legacy-${randomBytes(4).toString('hex')}.test`, team = `default:${ns}`;
  j.workspace({teams:`teams:\n  default: { team: '${team}' }\n`,defaultTeam:'default'});
  const custody = join(j.base,'resident');
  globalIdentity(j,custody,'resident',ns);
  const adopted = j.run(['create','resident','--root',custody,'--json'],{AWEB_URL,AWID_REGISTRY_URL:AWID_URL});
  assert.equal(adopted.status,0,adopted.stdout+adopted.stderr);
  const status = j.aw(custody,['custody','status','--json']);
  assert.equal(status.status,0,status.stderr);
  const home=join(j.base,'legacy-seat'), grantHome=join(home,'.aweb-identity');
  mkdirSync(home);
  const minted=j.aw(custody,['id','grant','mint',`--team=${team}`,'--scope=mail.read','--ttl=720h','--label=oats:legacy-seat',`--out=${grantHome}`,`--custody-socket=${JSON.parse(status.stdout).socket_path}`,'--json']);
  assert.equal(minted.status,0,minted.stdout+minted.stderr);
  const receipt=JSON.parse(minted.stdout);
  const meta={identity:{mode:'global',alias:'resident',resident:'resident',team,grant:{id:receipt.grant_id,home:grantHome,expiresAt:receipt.expires_at,ttl:'720h',scopes:['mail.read']}}};
  const hook=(event,input)=>spawnSync(process.execPath,[HOOK,event],{cwd:home,encoding:'utf8',env:{...j.env,
    OATS_EVENT:event,OATS_HOME:home,OATS_INSTANCE:'legacy-seat',OATS_CONTEXT:j.deployment,
    OATS_RUNTIME:'pi',OATS_DEFAULT_TEAM:'default',OATS_DEFAULT_TEAM_ID:team,
    OATS_SETTINGS:JSON.stringify({registry:AWID_URL,identity:{mode:'global',resident:'resident',renew:'off'},residents:{resident:custody}}),OATS_META:JSON.stringify(input)}});
  const launched=hook('launch',meta);
  assert.equal(launched.status,0,launched.stdout+launched.stderr);
  const filled=JSON.parse(readFileSync(join(home,'.oats-aweb','seat.json'),'utf8'));
  assert.match(filled.seat,/^[0-9a-f]{16}$/);
  assert.deepEqual({...filled,seat:undefined},{seat:undefined,instance:'legacy-seat',resident:'resident',team});
  const show=()=>{
    const r=j.aw(custody,['id','grant','show',receipt.grant_id,`--team=${team}`,'--json']);
    assert.equal(r.status,0,r.stderr); return JSON.parse(r.stdout);
  };
  assert.equal(show().status,'active');
  const retired=hook('retire',JSON.parse(launched.stdout).meta);
  assert.equal(retired.status,0,retired.stdout+retired.stderr);
  assert.equal(show().status,'revoked');
});
