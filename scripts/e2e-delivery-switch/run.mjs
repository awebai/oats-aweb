#!/usr/bin/env node
// End-to-end evidence for oats.aweb delivery by harness (1.18): a disposable
// instance home switches between the host wake broker (codex) and the Claude
// channel plugin while mail arrives, against a local aweb + awid stack.
//
//   node scripts/e2e-delivery-switch/run.mjs <aweb-oss checkout> [--receipt <file>]
//   AWEB_OSS_SRC=<aweb-oss checkout> node scripts/e2e-delivery-switch/run.mjs
//
// Everything runs under one temp dir: a clone of the checkout's origin/main
// (the only place compose runs), the fixture identities, HOME for every aw and
// node process, the broker state dir, and the instance home. The receipt is
// printed to stdout (and written to --receipt) after cleanup, so it can state
// what the cleanup checks showed. Exit 0 only when every check passed and the
// cleanup left nothing behind.
import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const HOOK = join(REPO, "oats-package", "capabilities", "oats-aweb", "bin", "oats-aweb.mjs");
const INSTANCE = "dev-1";
const SEND_INTERVAL_MS = 400;
const QUIET_MS = 10_000;

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
let receiptPath;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--receipt") receiptPath = resolve(argv[++i]);
  else if (argv[i].startsWith("--receipt=")) receiptPath = resolve(argv[i].slice("--receipt=".length));
  else positional.push(argv[i]);
}
const SRC = positional[0] || process.env.AWEB_OSS_SRC;
if (!SRC) {
  console.error("usage: node scripts/e2e-delivery-switch/run.mjs <aweb-oss checkout> [--receipt <file>]  (or AWEB_OSS_SRC=<checkout>)");
  process.exit(2);
}

// ---------------------------------------------------------------- state
const which = (cmd) => { try { return execFileSync("/usr/bin/which", [cmd], { encoding: "utf8" }).trim(); } catch { return ""; } };
const AW = process.env.AW_BIN || which("aw");
const NODE = process.execPath;
const facts = { startedAt: new Date().toISOString(), src: resolve(SRC) };
const commands = [];          // every external command, in order, for the receipt
const checks = [];            // { name, ok, detail }
const cleanupReport = [];     // { step, ok, detail }
const scenarios = [];         // per-scenario evidence
const sent = [];              // { seq, phase, id, at }
const channelNotes = [];      // plugin notifications/claude/channel params
let TMP, CLONE, project, composeArgs, brokerProc, pluginProc, dockerStartedByUs = false, pluginStderrPath;

const check = (name, ok, detail = "") => { checks.push({ name, ok: !!ok, detail }); if (!ok) console.error(`CHECK FAILED: ${name} ${detail}`); return !!ok; };
const redact = (s) => String(s).split(TMP || "\0").join("$TMP");
function logCommand(display, cwd) { commands.push({ display: redact(display), cwd: cwd ? redact(cwd) : undefined }); }
const quote = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${String(a).replace(/'/g, "'\\''")}'`);

async function runCmd(cmd, args, { cwd, env, display, timeout = 120_000, allowFailure = false, quiet = false } = {}) {
  if (!quiet) logCommand(display || [cmd, ...args].map(quote).join(" "), cwd);
  try {
    const r = await execFileAsync(cmd, args, { cwd, env, timeout, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" });
    return { ok: true, code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    if (allowFailure) return { ok: false, code: e.code, stdout: String(e.stdout || ""), stderr: String(e.stderr || "") };
    throw new Error(`${display || cmd + " " + args.join(" ")} failed (${e.code}): ${redact(String(e.stderr || e.message)).slice(0, 2000)}`);
  }
}

// Every aw and node process of the harness runs with this env: HOME, the aw
// config, and the broker state dir all inside TMP; nothing inherited from the
// caller's session (its AWEB_IDENTITY_HOME/AWEB_DELIVERY must never leak in).
let baseEnv;
function makeBaseEnv(awidURL) {
  return {
    HOME: join(TMP, "home"),
    PATH: [dirname(AW), dirname(NODE), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"),
    TMPDIR: join(TMP, "tmp") + "/",
    AW_CONFIG_PATH: join(TMP, "home", ".config", "aw", "config.yaml"),
    AW_WAKE_STATE_DIR: join(TMP, "wake"),
    AWID_REGISTRY_URL: awidURL,
    AWID_SKIP_DNS_VERIFY: "1",
    AW_NO_UPDATE_CHECK: "1",
  };
}
const aw = (args, cwd, opts = {}) => runCmd(AW, args, { cwd, env: baseEnv, display: opts.display || ["aw", ...args].map(quote).join(" "), ...opts });
const awJSON = async (args, cwd, opts) => { const r = await aw(args, cwd, opts); const s = r.stdout; return JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)); };

async function freePorts(n) {
  const servers = Array.from({ length: n }, () => createServer());
  const ports = await Promise.all(servers.map((s) => new Promise((ok, no) => { s.once("error", no); s.listen(0, "127.0.0.1", () => ok(s.address().port)); })));
  await Promise.all(servers.map((s) => new Promise((ok) => s.close(ok))));
  return ports;
}
async function waitHealthy(url, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${url}/health`); if (r.ok && (await r.json()).status === "ok") return; } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`${url} did not become healthy`);
}
const dockerUp = async ({ quiet = true } = {}) => (await runCmd("docker", ["info"], { allowFailure: true, timeout: 15_000, display: "docker info", quiet })).ok;
const dockerBackendRunning = () => { try { execFileSync("/usr/bin/pgrep", ["-f", "/Applications/Docker.app/Contents/MacOS/com.docker.backend"]); return true; } catch { return false; } };
const pgrep = (pattern) => { try { return execFileSync("/usr/bin/pgrep", ["-fl", pattern], { encoding: "utf8" }).trim(); } catch { return ""; } };

// ---------------------------------------------------------------- broker status
/** Polls are not logged one by one; the receipt lists the command once per snapshot it shows. */
async function wakeStatus({ quiet = false } = {}) { return awJSON(["wake", "status", "--json"], TMP, { quiet }); }
function trimStatus(s) {
  return {
    daemon_running: s.daemon_running,
    daemon_version: s.daemon_version,
    instances: (s.instances || []).map((i) => ({
      home: redact(i.home), delivery: i.delivery, runtime_delivery: i.runtime_delivery, phase: i.phase, registered_at: i.registered_at,
      receive_identities: (i.receive_identities || []).map((r) => ({ identity_home: redact(r.identity_home), stream_phase: r.stream_phase, stream_admitted: r.stream_admitted })),
    })),
  };
}
const listsHome = (s, home) => (s.instances || []).some((i) => i.home === home);
async function waitFor(pred, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await pred()) return true; await sleep(250); }
  check(`${what} (within ${timeoutMs / 1000}s)`, false);
  return false;
}

// ---------------------------------------------------------------- presentations
// Frozen before cleanup removes TMP, so the receipt counts what was presented.
let frozenBroker;
function brokerPresentations() {
  if (frozenBroker) return frozenBroker;
  const file = join(TMP, "broker-presented.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => {
    const row = JSON.parse(l);
    return { at: row.at, id: row.text.match(/^- message_id: (\S+)$/m)?.[1], type: row.text.match(/^- type: (\S+)$/m)?.[1], text: row.text };
  });
}
function channelPresentations() {
  return channelNotes.map((n) => ({ at: n.at, id: n.params?.meta?.message_id, type: n.params?.meta?.type, text: n.params?.content }));
}
function countsById() {
  const counts = new Map();
  const bump = (id, key) => { if (!counts.has(id)) counts.set(id, { broker: 0, channel: 0 }); counts.get(id)[key]++; };
  for (const p of brokerPresentations()) bump(p.id, "broker");
  for (const p of channelPresentations()) bump(p.id, "channel");
  return counts;
}

// ---------------------------------------------------------------- the hook
let hookBase;
async function hook(event, runtime, extra = {}) {
  const env = { ...baseEnv, ...hookBase, OATS_EVENT: event, OATS_RUNTIME: runtime, ...extra };
  const shown = [`OATS_EVENT=${event}`, `OATS_RUNTIME=${runtime}`, ...(extra.OATS_PREVIOUS_RUNTIME !== undefined ? [`OATS_PREVIOUS_RUNTIME=${extra.OATS_PREVIOUS_RUNTIME}`] : []), ...(extra.OATS_META ? ["OATS_META=<meta>"] : []), `OATS_SETTINGS='${hookBase.OATS_SETTINGS}'`];
  const r = await runCmd(NODE, [HOOK, event], { cwd: hookBase.OATS_HOME, env, display: `${shown.join(" ")} node oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs ${event}`, allowFailure: true, timeout: 180_000 });
  const last = r.stdout.trim().split("\n").pop();
  let doc; try { doc = JSON.parse(last); } catch { doc = undefined; }
  return { code: r.ok ? 0 : r.code, doc, stderr: r.stderr };
}
const hookSummary = (r) => ({ exit: r.code, env_AWEB_DELIVERY: r.doc?.env?.AWEB_DELIVERY ?? null, launch_claude: r.doc?.launch?.claude ?? null, meta_runtime: r.doc?.meta?.runtime ?? null, meta_delivery: r.doc?.meta?.delivery ?? null, warning: r.doc?.warning ? redact(r.doc.warning) : undefined });

// ---------------------------------------------------------------- the channel plugin
function startPlugin(home, identityHome) {
  const env = { ...baseEnv, AWEB_IDENTITY_HOME: identityHome, AW_BIN: AW };
  const entry = join(CLONE, "channel", "dist", "index.js");
  logCommand(`(cwd ${home}) AWEB_IDENTITY_HOME=${identityHome} AW_BIN=${AW} node $TMP/aweb-oss/channel/dist/index.js  # MCP stdio client: initialize, notifications/initialized, collect notifications/claude/channel`);
  pluginStderrPath = join(TMP, "plugin.stderr.log");
  const errFd = openSync(pluginStderrPath, "a");
  const proc = spawn(NODE, [entry], { cwd: home, env, stdio: ["pipe", "pipe", errFd], detached: true });
  let buf = "";
  const send = (msg) => { try { proc.stdin.write(JSON.stringify(msg) + "\n"); } catch { /* closed */ } };
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id === 1 && (msg.result || msg.error)) send({ jsonrpc: "2.0", method: "notifications/initialized" });
      else if (msg.method === "notifications/claude/channel") channelNotes.push({ at: new Date().toISOString(), params: msg.params });
      else if (msg.method && msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, result: {} });
    }
  });
  proc.stdin.on("error", () => {});
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { experimental: { "claude/channel": {} } }, clientInfo: { name: "oats-aweb-e2e-delivery-switch", version: "1" } } });
  proc.exited = new Promise((ok) => proc.on("exit", (code, signal) => ok({ code, signal })));
  return proc;
}
/** Stop a process group: SIGTERM (with its stdin closed too, as Claude Code
 *  ends an MCP stdio server), then SIGKILL after 10 s. Says which worked. */
async function stopGroup(proc, label, { closeStdin = false } = {}) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return `${label}: already exited`;
  const t0 = Date.now();
  if (closeStdin) { try { proc.stdin.end(); } catch { /* closed */ } }
  try { process.kill(-proc.pid, "SIGTERM"); } catch { /* gone */ }
  const r = await Promise.race([proc.exited, sleep(10_000).then(() => undefined)]);
  if (r) return `${label}: exited (${r.signal || "code " + r.code}) ${Date.now() - t0} ms after ${closeStdin ? "stdin close + " : ""}SIGTERM`;
  try { process.kill(-proc.pid, "SIGKILL"); } catch { /* gone */ }
  const k = await Promise.race([proc.exited, sleep(5_000).then(() => undefined)]);
  return `${label}: ${k ? "killed with SIGKILL" : "DID NOT EXIT"}`;
}

// ---------------------------------------------------------------- mail
async function sendMail(seq, phase, cwd) {
  const body = `E2E-SEQ-${seq} ${phase}`;
  const r = await awJSON(["--json", "mail", "send", "--to", INSTANCE, "--body", body], cwd, { display: `aw --json mail send --to ${INSTANCE} --body 'E2E-SEQ-<n> ${phase}'` });
  sent.push({ seq, phase, id: r.message_id, at: new Date().toISOString() });
}
/** Send `total` mails at a steady rate; start `switchFn` (not awaited) just
 *  before mail number `switchAt + 1`, so mail keeps arriving while it runs. */
async function stream(phase, firstSeq, total, switchAt, switchFn, cwd) {
  let switching;
  for (let i = 0; i < total; i++) {
    if (i === switchAt) switching = switchFn();
    await sendMail(firstSeq + i, phase, cwd);
    await sleep(SEND_INTERVAL_MS);
  }
  await switching;
  const ids = sent.filter((s) => s.phase === phase).map((s) => s.id);
  await waitFor(() => { const c = countsById(); return ids.every((id) => c.has(id)); }, 120_000, `${phase}: every mail presented at least once`);
  await sleep(QUIET_MS); // let any late duplicate surface before counting
  return ids;
}

// ---------------------------------------------------------------- main
async function main() {
  if (!AW) throw new Error("aw is not on PATH (or set AW_BIN)");
  TMP = realpathSync(mkdtempSync(join(tmpdir(), "e2eds-")));
  for (const d of ["home", "tmp", "bin", "alice", "wake"]) mkdirSync(join(TMP, d), { recursive: true });
  if (join(TMP, "wake", "control.sock").length > 100) throw new Error(`temp dir ${TMP} is too long for the broker's unix socket; set TMPDIR to a shorter directory`);
  facts.tmp = TMP;
  facts.awVersion = execFileSync(AW, ["version"], { env: { PATH: process.env.PATH, HOME: join(TMP, "home"), AW_NO_UPDATE_CHECK: "1" }, encoding: "utf8", timeout: 20_000 }).trim().split("\n").slice(0, 2).map((l) => l.trim()).join(" ");
  facts.awPath = AW;
  facts.node = process.version;
  facts.hookSha256 = createHash("sha256").update(readFileSync(HOOK)).digest("hex");
  try { facts.repoHead = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); facts.repoDirty = execFileSync("git", ["-C", REPO, "status", "--porcelain", "--", "oats-package"], { encoding: "utf8" }).trim(); } catch { /* not a git tree */ }

  // 1. A temp clone of origin/main: compose runs only there.
  CLONE = join(TMP, "aweb-oss");
  const sha = (await runCmd("git", ["-C", facts.src, "rev-parse", "origin/main"], { display: "git -C <src> rev-parse origin/main" })).stdout.trim();
  await runCmd("git", ["clone", "--quiet", facts.src, CLONE], { display: `git clone --quiet <src> $TMP/aweb-oss`, timeout: 300_000 });
  await runCmd("git", ["-C", CLONE, "fetch", "--quiet", facts.src, "+refs/remotes/origin/main:refs/remotes/src/main"], { display: "git -C $TMP/aweb-oss fetch --quiet <src> +refs/remotes/origin/main:refs/remotes/src/main" });
  await runCmd("git", ["-C", CLONE, "checkout", "--quiet", "--detach", sha], { display: `git -C $TMP/aweb-oss checkout --quiet --detach ${sha}` });
  facts.awebCommit = (await runCmd("git", ["-C", CLONE, "log", "-1", "--format=%H %s"], { display: "git -C $TMP/aweb-oss log -1" })).stdout.trim();
  check("temp clone is at the source's origin/main", facts.awebCommit.startsWith(sha), facts.awebCommit);

  // 2. Docker Desktop.
  if (!(await dockerUp({ quiet: false }))) {
    dockerStartedByUs = true;
    await runCmd("open", ["-a", "Docker"], { display: "open -a Docker" });
    const deadline = Date.now() + 240_000;
    while (!(await dockerUp())) { if (Date.now() > deadline) throw new Error("Docker did not start"); await sleep(2000); }
  }
  facts.dockerStartedByUs = dockerStartedByUs;

  // 3. The local aweb + awid stack (server/docker-compose.yml of the clone; no bind mounts).
  const [awebPort, awidPort] = await freePorts(2);
  project = `e2eds-${Date.now().toString(36)}`;
  const envFile = join(TMP, "stack.env");
  writeFileSync(envFile, [
    "POSTGRES_USER=aweb", "POSTGRES_PASSWORD=aweb-e2e-delivery-switch", "POSTGRES_DB=aweb",
    `AWEB_PORT=${awebPort}`, `AWID_PORT=${awidPort}`,
    `AWEB_PUBLIC_ORIGIN=http://127.0.0.1:${awebPort}`, `AWID_PUBLIC_REGISTRY_URL=http://127.0.0.1:${awidPort}`,
    "AWID_SERVICE_TOKEN=aweb-e2e-delivery-switch-service-token-32bytes", "AWID_SKIP_DNS_VERIFY=1", "AWID_RATE_LIMIT_DISABLED=true", "APP_ENV=development",
  ].join("\n") + "\n");
  composeArgs = ["compose", "-p", project, "-f", join(CLONE, "server", "docker-compose.yml"), "--env-file", envFile];
  facts.project = project;
  await runCmd("docker", [...composeArgs, "up", "-d", "--build", "awid", "aweb"], { cwd: join(CLONE, "server"), display: `docker compose -p ${project} -f $TMP/aweb-oss/server/docker-compose.yml --env-file $TMP/stack.env up -d --build awid aweb`, timeout: 900_000 });
  const awebURL = `http://127.0.0.1:${awebPort}`, awidURL = `http://127.0.0.1:${awidPort}`;
  await waitHealthy(awidURL); await waitHealthy(awebURL);
  facts.awebURL = awebURL; facts.awidURL = awidURL;
  baseEnv = makeBaseEnv(awidURL);

  // 4. The Claude channel plugin, built from the clone (npm cache and HOME in TMP).
  const npmEnv = { ...baseEnv, npm_config_cache: join(TMP, "npm-cache"), npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" };
  await runCmd("npm", ["ci"], { cwd: join(CLONE, "channel"), env: npmEnv, display: "npm ci", timeout: 600_000 });
  await runCmd("npm", ["run", "build"], { cwd: join(CLONE, "channel"), env: npmEnv, display: "npm run build", timeout: 600_000 });

  // 5. Fixture identities on the local stack: alice owns the team, is the
  //    minting root (settings.root) and the sender.
  const alice = join(TMP, "alice");
  const domain = `e2eds-${Date.now()}.test`;
  await awJSON(["--json", "id", "create", "--name", "alice", "--domain", domain, "--registry", awidURL, "--skip-dns-verify"], alice);
  const team = (await awJSON(["--json", "id", "team", "create", "--namespace", domain, "--name", "devteam", "--registry", awidURL], alice)).team_id;
  const invite = (await awJSON(["--json", "id", "team", "invite", "--namespace", domain, "--team", "devteam"], alice)).token;
  await awJSON(["--json", "id", "team", "accept-invite", invite, "--global", "--name", "alice"], alice, { display: "aw --json id team accept-invite <invite-token> --global --name alice" });
  await awJSON(["--json", "init", "--url", awebURL], alice);
  await awJSON(["--json", "id", "encryption-key", "setup"], alice);
  facts.team = team;

  // 6. Our own broker, with a fake `oats` that logs every presented input.
  const fakeOats = join(TMP, "bin", "oats");
  const presentedLog = join(TMP, "broker-presented.jsonl");
  writeFileSync(fakeOats, `#!${NODE}
const fs = require("node:fs");
const a = process.argv.slice(2);
if (a[0] === "session" && a[1] === "inspect") { console.log(JSON.stringify({ ok: true, result: { present: true, state: "idle" } })); process.exit(0); }
if (a[0] === "session" && a[1] === "input") {
  let text = ""; try { text = fs.readFileSync(0, "utf8"); } catch {}
  fs.appendFileSync(${JSON.stringify(presentedLog)}, JSON.stringify({ at: new Date().toISOString(), home: a[a.indexOf("--home") + 1], text }) + "\\n");
  console.log(JSON.stringify({ ok: true, result: { submitted: true } })); process.exit(0);
}
console.log(JSON.stringify({ ok: false, error: { message: "fake oats: unsupported " + a.join(" ") } })); process.exit(1);
`);
  chmodSync(fakeOats, 0o755);
  logCommand(`AW_WAKE_OATS_BIN=$TMP/bin/oats aw wake run --state-dir $TMP/wake   # foreground daemon; fake oats appends each presented input to $TMP/broker-presented.jsonl`);
  const brokerLog = openSync(join(TMP, "wake.log"), "a");
  brokerProc = spawn(AW, ["wake", "run", "--state-dir", join(TMP, "wake")], { cwd: TMP, env: { ...baseEnv, AW_WAKE_OATS_BIN: fakeOats }, stdio: ["ignore", brokerLog, brokerLog], detached: true });
  brokerProc.exited = new Promise((ok) => brokerProc.on("exit", (code, signal) => ok({ code, signal })));
  await waitFor(async () => { try { return (await wakeStatus({ quiet: true })).daemon_running === true; } catch { return false; } }, 30_000, "our broker reports daemon_running");
  facts.daemon = (({ daemon_version, daemon_commit, state_dir }) => ({ daemon_version, daemon_commit, state_dir: redact(state_dir) }))(await wakeStatus());
  check("our broker's state dir is the temp one", facts.daemon.state_dir === "$TMP/wake", facts.daemon.state_dir);

  // 7. The disposable instance home.
  const ws = join(TMP, "ws");
  const home = join(ws, "agents", "dev", "instances", INSTANCE);
  mkdirSync(home, { recursive: true });
  hookBase = {
    OATS_HOME: home, OATS_INSTANCE: INSTANCE, OATS_WORKSPACE: ws, OATS_WORKSPACE_KEY: "local/e2e-delivery-switch", OATS_WORKSPACE_NAME: "e2e",
    OATS_DEFAULT_TEAM: "default", OATS_DEFAULT_TEAM_ID: team, OATS_DEFAULT_TEAM_FROM: "deployment",
    OATS_TEAMS: JSON.stringify([{ label: "default", team, default: true, from: "local" }]), OATS_TEAMS_SOURCE: "live",
    OATS_SETTINGS: JSON.stringify({ root: alice, delivery: "channel" }),
  };
  facts.home = redact(home);

  // ---------------- Scenario 1: codex (broker) -> claude (channel) while mail arrives.
  const s1 = { name: "1. codex home on the broker switches to the Claude channel mid-stream", statuses: {} };
  scenarios.push(s1);
  s1.statuses["before spawn"] = trimStatus(await wakeStatus());
  const spawned = await hook("spawn", "codex");
  s1.spawn = hookSummary(spawned);
  check("s1: codex spawn exits 0", spawned.code === 0, spawned.stderr && redact(spawned.stderr));
  check("s1: codex spawn sets AWEB_DELIVERY=session and no channel flag", spawned.doc?.env?.AWEB_DELIVERY === "session" && !spawned.doc?.launch);
  const identityHome = spawned.doc?.env?.AWEB_IDENTITY_HOME || join(home, ".aw");
  await waitFor(async () => { const s = await wakeStatus({ quiet: true }); return (s.instances || []).some((i) => i.home === home && (i.receive_identities || []).every((r) => r.stream_phase === "streaming")); }, 30_000, "s1: broker streams for the codex home");
  const before1 = await wakeStatus();
  s1.statuses["after codex spawn, before the switch"] = trimStatus(before1);
  check("s1: broker lists the codex home before the switch", listsHome(before1, home));
  let claudeMeta;
  const ids1 = await stream("phase1", 1, 24, 8, async () => {
    const launched = await hook("launch", "claude", { OATS_META: JSON.stringify(spawned.doc?.meta || {}), OATS_PREVIOUS_RUNTIME: "codex" });
    s1.launch = hookSummary(launched);
    s1.switchAt = new Date().toISOString();
    claudeMeta = launched.doc?.meta;
    check("s1: claude launch exits 0", launched.code === 0, redact(launched.stderr || ""));
    check("s1: claude launch returns the channel flag and no AWEB_DELIVERY", !!launched.doc?.launch?.claude && launched.doc?.env?.AWEB_DELIVERY === undefined);
    const after = await wakeStatus();
    s1.statuses["after the claude launch hook"] = trimStatus(after);
    check("s1: broker no longer lists the home after the claude launch", !listsHome(after, home));
    // Claude starts with the plugin only after its launch hook succeeded.
    pluginProc = startPlugin(home, identityHome);
    s1.pluginStartedAt = new Date().toISOString();
  }, alice);
  s1.ids = ids1;
  s1.statuses["end of scenario 1"] = trimStatus(await wakeStatus());

  // ---------------- Scenario 2: claude -> codex relaunch registers the home.
  const s2 = { name: "2. claude home relaunched as codex is registered with the broker", statuses: {} };
  scenarios.push(s2);
  const ids2 = await stream("phase2", 101, 20, 3, async () => {
    s2.pluginStop = await stopGroup(pluginProc, "channel plugin", { closeStdin: true });
    s2.pluginStoppedAt = new Date().toISOString();
    pluginProc = undefined;
    const before = await wakeStatus();
    s2.statuses["claude session ended, before the codex launch hook"] = trimStatus(before);
    check("s2: broker does not list the home before the codex launch", !listsHome(before, home));
    const launched = await hook("launch", "codex", { OATS_META: JSON.stringify(claudeMeta || {}), OATS_PREVIOUS_RUNTIME: "claude" });
    s2.launch = hookSummary(launched);
    s2.switchAt = new Date().toISOString();
    check("s2: codex launch exits 0", launched.code === 0, redact(launched.stderr || ""));
    check("s2: codex launch sets AWEB_DELIVERY=session and no channel flag", launched.doc?.env?.AWEB_DELIVERY === "session" && !launched.doc?.launch);
    const after = await wakeStatus();
    s2.statuses["after the codex launch hook"] = trimStatus(after);
    check("s2: broker lists the home after the codex launch", listsHome(after, home));
    s2.codexMeta = launched.doc?.meta;
  }, alice);
  s2.ids = ids2;

  // ---------------- Scenario 3: codex -> codex relaunch keeps the registration.
  const s3 = { name: "3. codex home relaunched as codex keeps its broker registration", statuses: {} };
  scenarios.push(s3);
  const ids3 = await stream("phase3", 201, 12, 3, async () => {
    const before = await wakeStatus();
    s3.statuses["before the codex relaunch hook"] = trimStatus(before);
    check("s3: broker lists the home before the codex relaunch", listsHome(before, home));
    const launched = await hook("launch", "codex", { OATS_META: JSON.stringify(s2.codexMeta || {}), OATS_PREVIOUS_RUNTIME: "codex" });
    s3.launch = hookSummary(launched);
    s3.switchAt = new Date().toISOString();
    check("s3: codex relaunch exits 0", launched.code === 0, redact(launched.stderr || ""));
    check("s3: codex relaunch sets AWEB_DELIVERY=session and no channel flag", launched.doc?.env?.AWEB_DELIVERY === "session" && !launched.doc?.launch);
    const after = await wakeStatus();
    s3.statuses["after the codex relaunch hook"] = trimStatus(after);
    check("s3: broker still lists the home after the codex relaunch", listsHome(after, home));
  }, alice);
  s3.ids = ids3;

  // ---------------- Exactly once.
  const counts = countsById();
  for (const s of scenarios) {
    const bad = s.ids.filter((id) => { const c = counts.get(id) || { broker: 0, channel: 0 }; return c.broker + c.channel !== 1; });
    check(`${s.name.split(".")[0]}: every mail presented exactly once`, bad.length === 0, bad.length ? `ids not presented exactly once: ${bad.join(", ")}` : `${s.ids.length} mails`);
  }
  // The switch must really have happened mid-stream, or exactly-once is vacuous.
  const by = (ids, key) => ids.filter((id) => (counts.get(id)?.[key] || 0) > 0).length;
  check("s1: the stream was split: the broker presented the early mails, the channel the later ones", by(s1.ids, "broker") > 0 && by(s1.ids, "channel") > 0, `broker ${by(s1.ids, "broker")}, channel ${by(s1.ids, "channel")}`);
  check("s2: the stream was split: the channel presented the early mails, the broker the later ones", by(s2.ids, "channel") > 0 && by(s2.ids, "broker") > 0, `channel ${by(s2.ids, "channel")}, broker ${by(s2.ids, "broker")}`);
  check("s3: the broker presented every mail across the codex relaunch", by(s3.ids, "broker") === s3.ids.length && by(s3.ids, "channel") === 0, `broker ${by(s3.ids, "broker")}, channel ${by(s3.ids, "channel")}`);
  const known = new Set(sent.map((s) => s.id));
  const strays = [...counts.keys()].filter((id) => !known.has(id));
  check("no presentation of an unknown or id-less event", strays.length === 0, strays.join(", "));
  const lateBroker = brokerPresentations().filter((p) => s1.switchAt && p.at > s1.switchAt && (!s2.switchAt || p.at < s2.switchAt));
  check("s1: the broker presented nothing between the claude launch and the codex relaunch", lateBroker.length === 0, lateBroker.map((p) => p.id).join(", "));
  const channelAfterStop = channelPresentations().filter((p) => s2.pluginStoppedAt && p.at > s2.pluginStoppedAt);
  check("s2: the channel presented nothing after the claude session ended", channelAfterStop.length === 0, channelAfterStop.map((p) => p.id).join(", "));
}

// ---------------------------------------------------------------- cleanup
async function cleanup() {
  const step = (name, ok, detail) => cleanupReport.push({ step: name, ok: !!ok, detail: redact(detail ?? "") });
  try { step("stop the channel plugin", true, pluginProc ? await stopGroup(pluginProc, "channel plugin", { closeStdin: true }) : "not running (stopped in scenario 2)"); } catch (e) { step("stop the channel plugin", false, String(e)); }
  try { step("stop our `aw wake run` daemon", true, brokerProc ? await stopGroup(brokerProc, "aw wake run") : "never started"); } catch (e) { step("stop our `aw wake run` daemon", false, String(e)); }
  if (TMP) {
    const left = pgrep(TMP);
    step("no harness process left (pgrep -f $TMP: broker, channel-core runner, plugin)", !left, left || "none");
  }
  if (composeArgs) {
    const down = await runCmd("docker", [...composeArgs, "down", "-v", "--rmi", "local", "--remove-orphans"], { cwd: join(CLONE, "server"), display: `docker compose -p ${project} ... down -v --rmi local --remove-orphans`, allowFailure: true, timeout: 300_000 });
    step("docker compose down -v --rmi local --remove-orphans", down.ok, down.ok ? "ok" : down.stderr.slice(-500));
    const label = `label=com.docker.compose.project=${project}`;
    const ps = await runCmd("docker", ["ps", "-a", "--filter", label, "-q"], { allowFailure: true, display: `docker ps -a --filter ${label} -q` });
    const vols = await runCmd("docker", ["volume", "ls", "--filter", label, "-q"], { allowFailure: true, display: `docker volume ls --filter ${label} -q` });
    const nets = await runCmd("docker", ["network", "ls", "--filter", label, "-q"], { allowFailure: true, display: `docker network ls --filter ${label} -q` });
    const byName = await runCmd("docker", ["volume", "ls", "-q"], { allowFailure: true, display: "docker volume ls -q" });
    const named = byName.stdout.split("\n").filter((v) => v.startsWith(project));
    step(`no containers of project ${project} (docker ps -a)`, ps.ok && !ps.stdout.trim(), ps.stdout.trim() || "none");
    step(`no volumes of project ${project} (docker volume ls)`, vols.ok && !vols.stdout.trim() && !named.length, [vols.stdout.trim(), ...named].filter(Boolean).join(" ") || "none");
    step(`no networks of project ${project}`, nets.ok && !nets.stdout.trim(), nets.stdout.trim() || "none");
  }
  if (dockerStartedByUs) {
    const stoppedWithin = async (ms) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) { if (!(await dockerUp()) && !dockerBackendRunning()) return true; await sleep(2000); }
      return false;
    };
    await runCmd("osascript", ["-e", 'quit app "Docker"'], { allowFailure: true, display: `osascript -e 'quit app "Docker"'` });
    let how = "osascript quit";
    let stopped = await stoppedWithin(30_000);
    if (!stopped) {
      // Docker Desktop 4.x may ignore the AppleScript quit; its own CLI stops it.
      how = "osascript quit was ignored for 30s; `docker desktop stop`";
      await runCmd("docker", ["desktop", "stop"], { allowFailure: true, display: "docker desktop stop", timeout: 120_000 });
      stopped = await stoppedWithin(90_000);
    }
    step("quit Docker Desktop (docker info fails, no com.docker.backend process)", stopped, stopped ? `stopped (${how})` : `still running (${how})`);
  } else if (facts.dockerStartedByUs === false) {
    step("Docker Desktop left running", true, "it was already running when the harness started, so the harness did not quit it");
  }
  if (TMP) {
    try { rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* reported below */ }
    step("remove the temp dir", !existsSync(TMP), existsSync(TMP) ? "still exists" : "removed");
  }
}

// ---------------------------------------------------------------- receipt
function receipt(error) {
  const counts = countsById();
  const passed = !error && checks.every((c) => c.ok) && cleanupReport.every((c) => c.ok);
  const L = [];
  L.push("# oats.aweb delivery switch: end-to-end receipt", "");
  L.push(`**Result: ${passed ? "PASS" : "FAIL"}**${error ? ` (aborted: ${redact(error.message || error)})` : ""}`, "");
  L.push(`- Date: ${facts.startedAt} (UTC)`);
  L.push(`- aw: \`${facts.awVersion || "?"}\` (${facts.awPath}); daemon reported ${facts.daemon?.daemon_version || "?"} commit ${facts.daemon?.daemon_commit || "?"}`);
  L.push(`- aweb-oss: \`${facts.awebCommit || "?"}\` (origin/main of ${facts.src}, cloned into the temp dir; compose ran only there)`);
  L.push(`- oats-aweb hook: ${REPO.split("/").slice(-1)[0]} HEAD ${facts.repoHead || "?"}${facts.repoDirty ? " plus uncommitted changes under oats-package" : ""}; bin/oats-aweb.mjs sha256 ${facts.hookSha256 || "?"}`);
  L.push(`- node ${facts.node}; compose project \`${facts.project || "?"}\`; local stack aweb ${facts.awebURL || "?"}, awid ${facts.awidURL || "?"}; team \`${facts.team || "?"}\``);
  L.push(`- Instance home: \`${facts.home || "?"}\` (\`$TMP\` = one fresh temp dir, removed at the end); HOME, AW_CONFIG_PATH and AW_WAKE_STATE_DIR of every aw/node process were inside it`);
  L.push(`- Docker Desktop was ${facts.dockerStartedByUs ? "not running; the harness started it and quit it" : facts.dockerStartedByUs === false ? "already running; the harness left it running" : "not reached"}`, "");
  L.push("## Checks", "");
  for (const c of checks) L.push(`- [${c.ok ? "x" : " "}] ${c.name}${c.detail ? ` — ${redact(c.detail)}` : ""}`);
  L.push("");
  const dupes = [...counts.entries()].filter(([, c]) => c.broker + c.channel > 1);
  const lost = sent.filter((s) => !counts.has(s.id));
  L.push("## Duplicates and losses", "");
  L.push(dupes.length ? dupes.map(([id, c]) => `- DUPLICATE ${id}: broker ${c.broker}, channel ${c.channel}`).join("\n") : "- No message id was presented more than once.");
  L.push(lost.length ? lost.map((s) => `- LOST seq ${s.seq} ${s.id}: never presented`).join("\n") : "- No sent message id went unpresented.");
  L.push("");
  for (const s of scenarios) {
    L.push(`## Scenario ${s.name}`, "");
    if (s.spawn) L.push(`Spawn hook (OATS_RUNTIME=codex): \`${JSON.stringify(s.spawn)}\``, "");
    if (s.pluginStop) L.push(`Ending the Claude session: ${s.pluginStop}`, "");
    if (s.launch) L.push(`Launch hook: \`${JSON.stringify(s.launch)}\` (finished ${s.switchAt})`, "");
    if (s.pluginStartedAt) L.push(`Channel plugin started ${s.pluginStartedAt}, right after the launch hook succeeded.`, "");
    for (const [label, st] of Object.entries(s.statuses)) {
      L.push(`\`aw wake status --json\` (trimmed), ${label}:`, "", "```json", JSON.stringify(st, null, 2), "```", "");
    }
    if (s.ids) {
      L.push("Per-message presentations (sent at a steady rate; the switch ran while mail kept arriving):", "");
      L.push("| seq | message_id | sent at | presented at (by) | broker | channel | total |", "|---|---|---|---|---|---|---|");
      const shown = [...brokerPresentations().map((p) => ({ ...p, by: "broker" })), ...channelPresentations().map((p) => ({ ...p, by: "channel" }))];
      for (const id of s.ids) {
        const m = sent.find((x) => x.id === id), c = counts.get(id) || { broker: 0, channel: 0 };
        const when = shown.filter((p) => p.id === id).sort((a, b) => a.at.localeCompare(b.at)).map((p) => `${p.at.slice(11, 23)} (${p.by})`).join(", ") || "never";
        L.push(`| ${m.seq} | ${id} | ${m.at.slice(11, 23)} | ${when} | ${c.broker} | ${c.channel} | ${c.broker + c.channel}${c.broker + c.channel === 1 ? "" : " ⚠"} |`);
      }
      const tb = s.ids.reduce((n, id) => n + (counts.get(id)?.broker || 0), 0), tc = s.ids.reduce((n, id) => n + (counts.get(id)?.channel || 0), 0);
      L.push("", `Totals: ${s.ids.length} mails sent, ${tb} broker presentations, ${tc} channel presentations.`, "");
    }
  }
  if (facts.pluginStderr) {
    const notable = facts.pluginStderr.filter((l) => /error|fatal|warn|fail/i.test(l));
    L.push("## Channel plugin stderr", "", `${facts.pluginStderr.length} lines; ${notable.length} mention error/fatal/warn/fail${notable.length ? ":" : "."}`, "");
    if (notable.length) L.push("```", ...notable.slice(0, 20).map(redact), "```", "");
  }
  L.push("## Commands run (in order)", "", "```");
  let prev, n = 0;
  const flush = () => { if (prev !== undefined) L.push(n > 1 ? `${prev}   # x${n}` : prev); };
  for (const c of commands) {
    const line = c.cwd ? `(cd ${c.cwd}) ${c.display}` : c.display;
    if (line === prev) n++; else { flush(); prev = line; n = 1; }
  }
  flush();
  L.push("```", "");
  L.push("## Cleanup", "");
  for (const c of cleanupReport) L.push(`- [${c.ok ? "x" : " "}] ${c.step}: ${c.detail}`);
  L.push("");
  return { text: L.join("\n"), passed };
}

// ---------------------------------------------------------------- run
let cleaningUp = false;
async function finish(error) {
  if (cleaningUp) return;
  cleaningUp = true;
  if (error) console.error(`e2e-delivery-switch: ${error.stack || error}`);
  try { frozenBroker = TMP ? brokerPresentations() : []; } catch { frozenBroker = []; }
  try { if (pluginStderrPath && existsSync(pluginStderrPath)) facts.pluginStderr = readFileSync(pluginStderrPath, "utf8").split("\n").filter(Boolean); } catch { /* evidence only */ }
  try { await cleanup(); } catch (e) { cleanupReport.push({ step: "cleanup", ok: false, detail: String(e) }); }
  const { text, passed } = receipt(error);
  if (receiptPath) writeFileSync(receiptPath, text);
  process.stdout.write(text + "\n");
  process.exit(passed ? 0 : 1);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => finish(new Error(`interrupted by ${sig}`)));
main().then(() => finish(), (e) => finish(e));
