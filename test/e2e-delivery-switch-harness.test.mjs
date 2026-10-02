// The e2e delivery-switch harness (scripts/e2e-delivery-switch/run.mjs) owns
// Docker resources, a broker daemon and child commands, so its lifecycle must
// hold under failure and signals: a failing switch, a SIGTERM mid-setup, and a
// Docker endpoint that is not the local Docker Desktop. Driven entirely by fake
// docker/aw/npm/git/open/osascript scripts: no Docker, no network beyond a
// loopback health stub the fake `docker compose up` starts.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { joinFromFake } from "./helpers/fake-aw-join-from.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HARNESS = join(REPO, "scripts", "e2e-delivery-switch", "run.mjs");
const NODE = process.execPath;

function fakeHeader(dir, bin) {
  return `#!${NODE}
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), crypto = require("node:crypto");
const DIR = ${JSON.stringify(dir)};
const cfg = JSON.parse(fs.readFileSync(path.join(DIR, "config.json"), "utf8"));
const args = process.argv.slice(2);
const log = (o = {}) => fs.appendFileSync(path.join(DIR, "calls.jsonl"), JSON.stringify({ bin: ${JSON.stringify(bin)}, args, pid: process.pid, t: Date.now(), ...o }) + "\\n");
const hang = () => { process.on("SIGTERM", () => { log({ event: "terminated" }); process.exit(143); }); setInterval(() => {}, 1000); };
const marker = (n) => path.join(DIR, n);
`;
}

const FAKES = {
  docker: `
log({ env: { DOCKER_HOST: process.env.DOCKER_HOST ?? null, DOCKER_CONTEXT: process.env.DOCKER_CONTEXT ?? null } });
if (args[0] === "info") {
  if (cfg.dockerDown && !fs.existsSync(marker("docker-started"))) { console.error("Cannot connect to the Docker daemon"); process.exit(1); }
  console.log(args.includes("--format") ? (cfg.dockerOS || "Docker Desktop") : "Server: Docker Desktop");
  process.exit(0);
}
if (args[0] === "context" && args[1] === "inspect") {
  console.log(JSON.stringify([{ Name: args[2], Endpoints: { docker: { Host: cfg.contextHost || "unix:///Users/fixture/.docker/run/docker.sock" } } }]));
  process.exit(0);
}
if (args[0] === "compose") {
  const sub = args.find((a) => ["up", "down"].includes(a));
  if (sub === "up") {
    log({ event: "up-started" });
    if (cfg.composeUpHang) hang();
    else {
      const env = fs.readFileSync(args[args.indexOf("--env-file") + 1], "utf8");
      const port = (k) => env.match(new RegExp("^" + k + "=(\\\\d+)$", "m"))[1];
      const code = "const http=require('node:http');for(const p of process.argv.slice(1))http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({status:'ok'}))}).listen(Number(p),'127.0.0.1')";
      const child = cp.spawn(process.execPath, ["-e", code, port("AWEB_PORT"), port("AWID_PORT")], { detached: true, stdio: "ignore" });
      fs.writeFileSync(marker("health.pid"), String(child.pid));
      child.unref();
      process.exit(0);
    }
  } else {
    if (sub === "down") { try { process.kill(Number(fs.readFileSync(marker("health.pid"), "utf8"))); } catch {} }
    process.exit(0);
  }
} else if (args[0] === "desktop" && args[1] === "stop") {
  fs.writeFileSync(marker("docker-quit"), "");
  fs.rmSync(marker("docker-started"), { force: true });
  try { process.kill(Number(fs.readFileSync(marker("backend.pid"), "utf8"))); } catch {}
  process.exit(0);
}
else { process.exit(0); } // ps/volume/network ls: nothing
`,
  open: `
log();
// A stand-in for com.docker.backend: it runs until \`docker desktop stop\`.
const backend = cp.spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", "e2eds-fake-docker-backend", DIR], { detached: true, stdio: "ignore" });
fs.writeFileSync(marker("backend.pid"), String(backend.pid));
backend.unref();
if (!cfg.dockerNeverStarts) {
  cp.spawn(process.execPath, ["-e", "setTimeout(()=>{const fs=require('node:fs');if(!fs.existsSync(process.argv[2]))fs.writeFileSync(process.argv[1],'')}," + (cfg.dockerStartDelayMs || 0) + ")", marker("docker-started"), marker("docker-quit")], { detached: true, stdio: "ignore" }).unref();
}
process.exit(0);
`,
  osascript: `
log();
// Docker Desktop 4.x may ignore the AppleScript quit (cfg.osascriptIgnored).
if (!cfg.osascriptIgnored) { fs.writeFileSync(marker("docker-quit"), ""); fs.rmSync(marker("docker-started"), { force: true }); }
process.exit(0);
`,
  git: `
log();
const sha = "f22257f30d5ebfc9b6b8dfa4840b87e9e97467d7";
const sub = args[0] === "-C" ? args[2] : args[0];
if (sub === "rev-parse") { console.log(sha); process.exit(0); }
if (sub === "clone") { const dest = args[args.length - 1]; for (const d of ["server", "channel"]) fs.mkdirSync(path.join(dest, d), { recursive: true }); process.exit(0); }
if (sub === "log") { console.log(sha + " fixture commit"); process.exit(0); }
process.exit(0);
`,
  npm: `
log({ event: "started" });
if (cfg.npmHang) hang(); else process.exit(0);
`,
  aw: `
let a = args; if (a[0] === "--identity-home") a = a.slice(2);
log();
(${joinFromFake})(a);
const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
const regsFile = marker("regs.json");
const regs = () => { try { return JSON.parse(fs.readFileSync(regsFile, "utf8")); } catch { return {}; } };
const flag = (n) => a.find((x) => x.startsWith(n + "="))?.slice(n.length + 1) ?? (a.includes(n) ? a[a.indexOf(n) + 1] : undefined);
const j = a.filter((x) => x !== "--json");
if (j[0] === "version") { console.log("aw 1.36.23\\n  commit: fixture"); process.exit(0); }
if (j[0] === "id" && j[1] === "create") out({ status: "created" });
if (j[0] === "id" && j[1] === "team" && j[2] === "create") out({ status: "created", team_id: "devteam:" + flag("--namespace") });
if (j[0] === "id" && j[1] === "team" && j[2] === "invite") out({ token: "fixture-token" });
if (j[0] === "id" && j[1] === "team" && j[2] === "accept-invite") out({ status: "accepted" });
if (j[0] === "id" && j[1] === "encryption-key") out({ status: "published" });
if (j[0] === "init") out({ status: "connected" });
if (j[0] === "mail" && j[1] === "send") out({ message_id: crypto.randomUUID(), status: "delivered" });
if (j[0] === "wake" && j[1] === "run") { hang(); }
else if (j[0] === "wake" && j[1] === "register") { const r = regs(); r[flag("--home")] = { home: flag("--home"), identity_home: flag("--identity-home") }; fs.writeFileSync(regsFile, JSON.stringify(r)); console.log("registered"); process.exit(0); }
else if (j[0] === "wake" && j[1] === "deregister") { const r = regs(); delete r[flag("--home")]; fs.writeFileSync(regsFile, JSON.stringify(r)); if (cfg.statusBreaksAfterDeregister) fs.writeFileSync(marker("status-broken"), ""); console.log("deregistered"); process.exit(0); }
else if (j[0] === "wake" && j[1] === "status") {
  if (fs.existsSync(marker("status-broken"))) { console.log("status: not json"); process.exit(0); }
  out({ daemon_running: true, daemon_version: "1.36.23", state_dir: process.env.AW_WAKE_STATE_DIR, instances: Object.values(regs()).map((r) => ({ home: r.home, delivery: "session", runtime_delivery: "external-session", phase: "active", receive_identities: [{ identity_home: r.identity_home, stream_phase: "streaming", stream_admitted: true }] })) });
}
else { console.error("fake aw: unexpected " + a.join(" ")); process.exit(93); }
`,
};

function fixture(t, cfg = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "e2eds-test-")));
  const bin = join(base, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "config.json"), JSON.stringify(cfg));
  for (const [name, body] of Object.entries(FAKES)) {
    writeFileSync(join(bin, name), fakeHeader(bin, name) + body);
    chmodSync(join(bin, name), 0o755);
  }
  const calls = () => existsSync(join(bin, "calls.jsonl")) ? readFileSync(join(bin, "calls.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  t.after(() => {
    for (const pid of ["health.pid", "backend.pid"]) { try { process.kill(Number(readFileSync(join(bin, pid), "utf8"))); } catch { /* not started or already stopped */ } }
    rmSync(base, { recursive: true, force: true });
  });
  return { base, bin, calls };
}

/** Run the harness against the fakes; send SIGTERM once `signalWhen(calls)`
 *  holds. Resolves with the exit, the output, and the call index at the signal. */
function runHarness(fx, { env = {}, signalWhen, timeoutMs = 90_000 } = {}) {
  return new Promise((done) => {
    const child = spawn(NODE, [HARNESS, join(fx.base, "aweb-oss-src")], {
      env: {
        PATH: `${fx.bin}:${dirname(NODE)}:/usr/bin:/bin`, HOME: join(fx.base, "home"), TMPDIR: tmpdir().replace(/\/?$/, "/"), // short enough for the broker socket path check
        AW_BIN: join(fx.bin, "aw"), DOCKER_BIN: join(fx.bin, "docker"), DOCKER_DESKTOP_BACKEND_PATTERN: `e2eds-fake-docker-backend ${fx.bin}`,
        E2EDS_SEND_INTERVAL_MS: "50", E2EDS_DOCKER_QUIT_WAIT_MS: "2000",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", signalledAt;
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    const poll = signalWhen && setInterval(() => {
      const calls = fx.calls();
      if (signalledAt === undefined && signalWhen(calls)) { signalledAt = calls.length; child.kill("SIGTERM"); }
    }, 25);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("exit", (code, signal) => {
      clearInterval(poll); clearTimeout(timer);
      done({ code, signal, stdout, stderr, calls: fx.calls(), signalledAt });
    });
  });
}

const isComposeUp = (c) => c.bin === "docker" && c.args[0] === "compose" && c.args.includes("up") && !c.event;
const isComposeDown = (c) => c.bin === "docker" && c.args[0] === "compose" && c.args.includes("down") && c.args.includes("-v");
const projectOf = (c) => c.args[c.args.indexOf("-p") + 1];
/** Commands only cleanup may start once a signal arrived. */
const isCleanupCall = (c) => c.event === "terminated" || c.bin === "osascript"
  || (c.bin === "docker" && (isComposeDown(c) || ["ps", "volume", "network", "info", "desktop"].includes(c.args[0])));
function assertNoUnhandledCrash(r) {
  assert.equal(r.signal, null, `the harness was killed (${r.signal}); stderr:\n${r.stderr}`);
  assert.notEqual(r.code, 0, "a failed run exits nonzero");
  assert.doesNotMatch(r.stderr, /Unhandled|triggerUncaughtException|unhandledRejection/i, r.stderr);
  assert.match(r.stdout, /\*\*Result: FAIL\*\*/, `the receipt is printed after cleanup; stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
}
function assertDownForEveryUp(r) {
  const ups = r.calls.filter(isComposeUp);
  for (const up of ups) {
    const downs = r.calls.filter((c) => isComposeDown(c) && projectOf(c) === projectOf(up) && c.t >= up.t);
    assert.ok(downs.length, `compose up of ${projectOf(up)} was never followed by compose down -v`);
  }
}
function assertLocalDockerOnly(r) {
  const docker = r.calls.filter((c) => c.bin === "docker" && c.env);
  assert.ok(docker.length, "docker was called");
  for (const c of docker) {
    assert.equal(c.env.DOCKER_HOST, null, `docker ${c.args.join(" ")} saw DOCKER_HOST`);
    assert.equal(c.env.DOCKER_CONTEXT, "desktop-linux", `docker ${c.args.join(" ")} ran in context ${c.env.DOCKER_CONTEXT}`);
  }
}

test("a switch that rejects mid-stream ends in cleanup, not an unhandled rejection", { timeout: 120_000 }, async (t) => {
  const fx = fixture(t, { statusBreaksAfterDeregister: true });
  // The caller's remote endpoint must not reach any docker call either.
  const r = await runHarness(fx, { env: { DOCKER_HOST: "tcp://remote.example:2376", DOCKER_CONTEXT: "remote" } });
  assertNoUnhandledCrash(r);
  assert.ok(r.calls.some(isComposeUp), `the run reached compose up; stderr:\n${r.stderr}`);
  assertDownForEveryUp(r);
  assertLocalDockerOnly(r);
  const sends = r.calls.filter((c) => c.bin === "aw" && c.args.includes("mail") && c.args.includes("send"));
  assert.ok(sends.length > 0 && sends.length < 24, `the stream started and stopped once the switch failed (sent ${sends.length} of 24)`);
  assert.ok(r.calls.some((c) => c.bin === "aw" && c.args.includes("wake") && c.args.includes("deregister")), "the failure came after the claude launch deregistered the home, not earlier");
  assert.match(r.stdout + r.stderr, /wake status/i, `the run failed on the broken aw wake status; output:\n${(r.stdout + r.stderr).slice(-3000)}`);
  assert.ok(r.calls.some((c) => c.bin === "aw" && c.args.includes("run") && c.event === "terminated"), "the broker daemon was stopped");
});

test("SIGTERM while Docker Desktop starts: nothing new starts, Docker is quit", { timeout: 120_000 }, async (t) => {
  // Docker comes up 1.5 s after `open` and ignores the AppleScript quit; its
  // backend runs until `docker desktop stop`, so cleanup waits ~30 s with
  // Docker up: a run that was not cancelled would go on to compose up meanwhile.
  const fx = fixture(t, { dockerDown: true, dockerStartDelayMs: 1500, osascriptIgnored: true });
  const r = await runHarness(fx, { signalWhen: (calls) => calls.some((c) => c.bin === "open") });
  assertNoUnhandledCrash(r);
  const after = r.calls.slice(r.signalledAt);
  assert.deepEqual(after.filter((c) => !isCleanupCall(c)).map((c) => `${c.bin} ${c.args.join(" ")}`), [], "no resource command started after the signal");
  assert.equal(r.calls.filter(isComposeUp).length, 0, "compose up never started");
  assert.ok(r.calls.some((c) => c.bin === "osascript"), "the Docker Desktop the harness started is quit");
  assert.ok(r.calls.some((c) => c.bin === "docker" && c.args[0] === "desktop" && c.args[1] === "stop"), "an ignored quit falls back to docker desktop stop");
  assertLocalDockerOnly(r);
});

test("SIGTERM during compose up: the in-flight up is terminated and the project is brought down", { timeout: 120_000 }, async (t) => {
  const fx = fixture(t, { composeUpHang: true });
  const r = await runHarness(fx, { signalWhen: (calls) => calls.some((c) => c.event === "up-started") });
  assertNoUnhandledCrash(r);
  assert.ok(r.calls.some((c) => c.bin === "docker" && c.event === "terminated"), "the in-flight compose up was terminated");
  const after = r.calls.slice(r.signalledAt);
  assert.deepEqual(after.filter((c) => !isCleanupCall(c)).map((c) => `${c.bin} ${c.args.join(" ")}`), [], "no resource command started after the signal");
  assertDownForEveryUp(r);
});

test("SIGTERM during the plugin build: npm is terminated and the project is brought down", { timeout: 120_000 }, async (t) => {
  const fx = fixture(t, { npmHang: true });
  const r = await runHarness(fx, { signalWhen: (calls) => calls.some((c) => c.bin === "npm") });
  assertNoUnhandledCrash(r);
  assert.ok(r.calls.some((c) => c.bin === "npm" && c.event === "terminated"), "the in-flight npm was terminated");
  const after = r.calls.slice(r.signalledAt);
  assert.deepEqual(after.filter((c) => !isCleanupCall(c)).map((c) => `${c.bin} ${c.args.join(" ")}`), [], "no resource command started after the signal");
  assertDownForEveryUp(r);
});

for (const [name, cfg] of [
  ["a desktop-linux context that is not a local socket", { contextHost: "tcp://remote.example:2376" }],
  ["a daemon that is not Docker Desktop", { dockerOS: "Ubuntu 24.04 LTS" }],
]) {
  test(`refuses ${name} before any compose up`, { timeout: 60_000 }, async (t) => {
    const fx = fixture(t, cfg);
    const r = await runHarness(fx, { env: { DOCKER_HOST: "tcp://remote.example:2376" } });
    assertNoUnhandledCrash(r);
    assert.equal(r.calls.filter(isComposeUp).length, 0, "compose up never ran");
    assert.match(r.stdout + r.stderr, /refus/i, "the refusal is reported");
    assertLocalDockerOnly(r);
  });
}
