// Real-stack journeys for `oats aweb resident create`: real aw against aweb's
// local stack (docker-compose.e2e.yml: postgres, redis, awid, the OSS aweb
// server) and a real OATS kernel, with no fixture and no fake. CI runs them
// (see ci.yml); locally, bring the stack up and set:
//
//   OATS_RESIDENT_JOURNEY_AW        a real aw 1.36.33 or 1.36.51 executable
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
// The OSS server does not serve aweb Cloud's /api/v1/workspaces/init, so an
// API-key init here registers the identity at awid and then fails. That proves
// registration, same-DID resume and the key's absence on a failure; a complete
// create, a quarantined partial and a customer-held team's refusal are proven
// only by the joint E2E against the local aweb Cloud.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { seatGrantLabel, teamGrants } from "../oats-package/capabilities/oats-aweb/lib/seat-grants.mjs";

const HOOK = fileURLToPath(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url));
const CAPABILITY = fileURLToPath(new URL("../oats-package/capabilities/oats-aweb", import.meta.url));
const AW = process.env.OATS_RESIDENT_JOURNEY_AW, AWEB_URL = process.env.OATS_RESIDENT_JOURNEY_AWEB_URL, AWID_URL = process.env.OATS_RESIDENT_JOURNEY_AWID_URL;
const KERNEL = process.env.OATS_RESIDENT_JOURNEY_KERNEL;
const OATS = KERNEL ? join(KERNEL, "bin", "oats.mjs") : undefined;

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
  assert.match(version.stdout, /^aw (1\.36\.33\n  commit: 877bbee94ce45aa1ff103912bc9850556e61dfb4|1\.36\.51\n  commit: 8325ef68ecae502523253b43575570144dd46297) /, "the journeys are qualified on aw 1.36.33 (877bbee9) and 1.36.51 (8325ef68)");
  // The printed steps start with `oats`; a spawn's preflight looks for the
  // harness, which --preview and --no-launch never start.
  writeFileSync(join(bin, "oats"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(OATS)} "$@"\n`, { mode: 0o755 });
  for (const harness of ["claude", "codex", "pi"]) writeFileSync(join(bin, harness), "#!/bin/sh\necho unexpected-harness-launch >&2\nexit 99\n", { mode: 0o755 });
  const env = {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, OATS_TEAM_SCOPE: deployment, OATS_SETTINGS: "{}", OATS_CLI_BIN: OATS,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", OATS_REMOTE_CACHE: join(base, "cache"),
    ...(process.env.XDG_RUNTIME_DIR ? { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR } : {}),
    ...(process.env.DBUS_SESSION_BUS_ADDRESS ? { DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS } : {}),
  };
  const features = JSON.parse(spawnSync(process.execPath, [OATS, "--version", "--json"], { encoding: "utf8", env }).stdout).features;
  assert.ok(features.includes("teams-conditional-default"), "the journeys need a kernel with teams-conditional-default");
  const cleanups = [];
  t.after(() => { for (const c of cleanups.reverse()) { try { c(); } catch { /* best effort */ } } rmSync(base, { recursive: true, force: true }); });
  const parsed = (r) => { let doc; try { doc = JSON.parse(r.stdout.trim().split("\n").at(-1)); } catch { doc = undefined; } return { ...r, doc }; };
  const run = (args, extra = {}) => parsed(spawnSync(process.execPath, [HOOK, "resident", ...args], { env: { ...env, ...extra }, cwd: deployment, encoding: "utf8", input: "", timeout: 180000 }));
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
  };
  return { base, deployment, home, bin, env, run, shell, aw, workspace, cleanups };
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
  return label;
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

  const again = j.run(["create", "carol", "--root", root, "--json"], { ...withKey, OATS_SETTINGS: JSON.stringify({ residents: { carol: root } }) });
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
  assert.doesNotMatch(loaded.stdout, /AWEB_|AWID_/);
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
function printedStepsJourney(t, { teams, defaultTeam, expectStatus, expectDefault, expectFirstStep }) {
  if (!configured(t)) return;
  if (!["darwin", "linux"].includes(process.platform)) { t.skip("no per-user service manager on this platform"); return; }
  const j = journey(t);
  const ns = `res-${randomBytes(4).toString("hex")}.test`;
  const team = `default:${ns}`;
  j.workspace({ teams: teams?.(team) ?? "", defaultTeam });
  const root = join(j.deployment, ".aweb-residents", "carol");
  globalIdentity(j, root, "carol", ns);

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
  // The seat verifies at the resident's registry, from its identity.yaml.
  assert.equal(record.launch.hooks.env.AWID_REGISTRY_URL, AWID_URL);
  const list = (argv) => { const r = j.aw(root, argv.slice(1)); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const seatLabel = seatGrantLabel(instance, identity.seat);
  const active = () => teamGrants(list, team).filter((g) => g.label === seatLabel && g.status === "active").map((g) => g.grant_id);
  assert.deepEqual(active(), [identity.grant.id], "the scaffold's grant is active at the resident's custody");

  const retired = j.shell(`oats retire ${instance} --json`);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.deepEqual(active(), [], "no active grant of this seat remains after the retire");
}

test("printed steps, no default team: the command sets it, and the spawn line alone previews and scaffolds a seat", (t) => {
  printedStepsJourney(t, { expectStatus: "added", expectDefault: "set" });
});

test("printed steps, the workspace's default team is another: it is kept, and `oats teams default` printed first makes the spawn work", (t) => {
  printedStepsJourney(t, { teams: () => "teams:\n  core: { team: 'core:example.invalid' }\n", defaultTeam: "core", expectStatus: "added", expectDefault: "kept", expectFirstStep: "oats teams default default" });
});

test("printed steps, the derived label already maps to the resident's team and is the default: reused, and the spawn line alone works", (t) => {
  printedStepsJourney(t, { teams: (team) => `teams:\n  default: { team: '${team}' }\n`, defaultTeam: "default", expectStatus: "reused", expectDefault: "already" });
});
