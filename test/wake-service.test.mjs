// `oats aweb wake install | status | uninstall` (oats.aweb 1.28.0,
// awebai/oats#1224). Every manager call goes to the fake host
// (helpers/fake-wake-host.mjs): PATH is its bin alone, and units are written
// under a temporary HOME and XDG_CONFIG_HOME. Both platforms are tested on
// every host; a host's own validator (plutil, systemd-analyze) checks the
// rendered file when it is installed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { execStartArgv, plistArgv, renderWakeUnit, runsWakeBroker, WAKE_FALLBACK_PATH, WAKE_LABEL, WAKE_MARKER, wakeMain, wakeUnitPath } from "../oats-package/capabilities/oats-aweb/lib/wake-service.mjs";
import { AW_MIN } from "../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs";
import { fakeWakeHost } from "./helpers/fake-wake-host.mjs";

const BIN = fileURLToPath(new URL("../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs", import.meta.url));
const onPath = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
const PLATFORMS = ["linux", "darwin"];
const FAST = { verifyMs: 60, intervalMs: 10, uid: 501, user: "alice" };

async function wake(host, platform, argv, { env = {}, ...rest } = {}) {
  let stdout = "", stderr = "";
  const code = await wakeMain(argv, { env: { ...host.env, ...env }, platform, print: (fd, text) => { if (fd === 1) stdout += text; else stderr += text; }, ...FAST, ...rest });
  let json;
  try { json = JSON.parse(stdout); } catch { /* text output */ }
  return { code, stdout, stderr, json };
}
const unitFile = (host, platform) => wakeUnitPath({ platform, home: host.home, xdgConfigHome: host.env.XDG_CONFIG_HOME });
const nodeDir = dirname(process.execPath);
const expectedPath = (host) => [...new Set([host.bin, nodeDir, ...(host.tmuxBin ? [host.tmuxBin] : []), ...WAKE_FALLBACK_PATH])].join(":");

test("the units: aw wake run with PATH and AW_WAKE_OATS_BIN only, our marker, no --state-dir", (t) => {
  const host = fakeWakeHost(t);
  const linux = renderWakeUnit({ platform: "linux", aw: "/opt/a$b/aw", oats: "/opt/100%/oats", path: "/opt/a$b:/usr/bin", home: "/home/a" });
  assert.equal(linux, `# ${WAKE_MARKER}; rerun it to update this unit, and oats aweb wake uninstall to remove it.
[Unit]
Description=aweb host wake broker

[Service]
Type=simple
Environment="PATH=/opt/a$b:/usr/bin" "AW_WAKE_OATS_BIN=/opt/100%%/oats"
ExecStart="/opt/a$$b/aw" wake run
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`);
  assert.deepEqual(execStartArgv(linux), ["/opt/a$b/aw", "wake", "run"], "our own ExecStart parses back");
  const darwin = renderWakeUnit({ platform: "darwin", aw: "/opt/homebrew/bin/aw", oats: "/Users/a b/bin/oats", path: "/opt/homebrew/bin:/usr/bin", home: "/Users/a b" });
  assert.equal(darwin, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${WAKE_MARKER}; rerun it to update this unit, and oats aweb wake uninstall to remove it. -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.aweb.wake</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/aw</string>
    <string>wake</string>
    <string>run</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/bin</string>
    <key>AW_WAKE_OATS_BIN</key>
    <string>/Users/a b/bin/oats</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/a b/Library/Logs/ai.aweb.wake.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/a b/Library/Logs/ai.aweb.wake.log</string>
</dict>
</plist>
`);
  assert.deepEqual(plistArgv(darwin), ["/opt/homebrew/bin/aw", "wake", "run"]);
  if (onPath("plutil")) {
    writeFileSync(join(host.base, "u.plist"), darwin);
    const lint = spawnSync("plutil", ["-lint", join(host.base, "u.plist")], { encoding: "utf8" });
    assert.equal(lint.status, 0, lint.stdout + lint.stderr);
  }
  if (onPath("systemd-analyze")) {
    const file = join(host.base, `${WAKE_LABEL}.service`);
    writeFileSync(file, linux.replace('"/opt/a$$b/aw" wake run', "/bin/true"));
    const runtime = join(host.base, "runtime"); mkdirSync(runtime, { mode: 0o700 });
    const verify = spawnSync("systemd-analyze", ["verify", "--user", file], { encoding: "utf8", env: { ...process.env, XDG_RUNTIME_DIR: runtime } });
    assert.equal(verify.status, 0, verify.stderr);
    assert.equal(verify.stderr, "", "no warning about any setting");
  }
  assert.equal(wakeUnitPath({ platform: "linux", home: "/home/a" }), "/home/a/.config/systemd/user/ai.aweb.wake.service");
  assert.equal(wakeUnitPath({ platform: "linux", home: "/home/a", xdgConfigHome: "/cfg" }), "/cfg/systemd/user/ai.aweb.wake.service");
  assert.equal(wakeUnitPath({ platform: "darwin", home: "/Users/a" }), "/Users/a/Library/LaunchAgents/ai.aweb.wake.plist");
});

test("the recogniser: aw (by name or link target) with wake run, quoted or bare, exec prefixes, flags after", (t) => {
  const host = fakeWakeHost(t);
  symlinkSync(join(host.bin, "aw"), join(host.base, "aweb-cli"));
  // The shape of a hand-written unit: an unquoted ExecStart.
  assert.deepEqual(execStartArgv("[Service]\nExecStart=/home/u/.local/bin/aw wake run\nRestart=always\n"), ["/home/u/.local/bin/aw", "wake", "run"]);
  assert.deepEqual(execStartArgv('ExecStart=-"/a b/aw" wake run --state-dir "/s t"'), ["/a b/aw", "wake", "run", "--state-dir", "/s t"]);
  assert.deepEqual(execStartArgv("ExecStart=@/usr/bin/aw aw-broker wake run"), ["/usr/bin/aw", "wake", "run"]);
  assert.equal(execStartArgv("[Service]\nType=simple\n"), undefined);
  assert.ok(runsWakeBroker(["/x/aw", "wake", "run", "--max-streams", "8"]));
  assert.ok(runsWakeBroker([join(host.base, "aweb-cli"), "wake", "run"]), "a link whose target is aw");
  for (const argv of [["/x/aw", "wake", "status"], ["/x/aw", "custody", "serve"], ["/x/awx", "wake", "run"], ["/x/aw"], undefined]) assert.equal(runsWakeBroker(argv), false, JSON.stringify(argv));
  assert.deepEqual(plistArgv("<key>Program</key><string>/x/aw</string><key>ProgramArguments</key><array><string>broker</string><string>wake</string><string>run</string></array>"), ["/x/aw", "wake", "run"]);
});

test("install, fresh: writes our unit, loads and starts it, and verifies the daemon on the resolved aw", async (t) => {
  for (const platform of PLATFORMS) {
    const host = fakeWakeHost(t);
    const r = await wake(host, platform, ["install", "--json"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const path = unitFile(host, platform);
    assert.deepEqual(r.json, { ok: true, unit: { manager: platform === "darwin" ? "launchd" : "systemd", label: WAKE_LABEL, path, written: true }, daemon: { running: true, version: "1.36.35", versionState: "reported", pid: 4242 }, warnings: [] });
    const text = readFileSync(path, "utf8");
    assert.equal(text, renderWakeUnit({ platform, aw: join(host.bin, "aw"), oats: join(host.bin, "oats"), path: expectedPath(host), home: host.home }));
    assert.ok(text.includes(WAKE_MARKER));
    assert.doesNotMatch(text, /state-dir|AW_WAKE_STATE_DIR/);
    assert.deepEqual(host.changes().map((c) => c.argv.join(" ")), platform === "darwin"
      ? [`bootstrap gui/501 ${path}`]
      : ["--user daemon-reload", `--user enable ${path}`, `--user restart ${WAKE_LABEL}.service`]);
    if (platform === "darwin") assert.ok(existsSync(join(host.home, "Library", "Logs")), "the log directory exists for launchd");
    const text2 = await wake(fakeWakeHost(t), platform, ["install"]);
    assert.match(text2.stdout, new RegExp(`^PASS wake broker 1\\.36\\.35 \\(${platform === "darwin" ? "launchd" : "systemd"} unit .*ai\\.aweb\\.wake\\.(plist|service)\\)\\n$`));
  }
});

test("install: the unit's PATH has aw's and oats's directories and their link targets, node's, tmux's, and the kernel timer's fallback", async (t) => {
  const host = fakeWakeHost(t);
  const links = join(host.base, "links"); mkdirSync(links);
  for (const cmd of ["aw", "oats"]) symlinkSync(join(host.bin, cmd), join(links, cmd));
  const r = await wake(host, "linux", ["install", "--json"], { env: { PATH: `${links}:${host.bin}:${host.tmuxBin}` } });
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(r.json.warnings, []);
  const unit = readFileSync(unitFile(host, "linux"), "utf8");
  const path = [links, host.bin, nodeDir, host.tmuxBin, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].filter((d, i, all) => all.indexOf(d) === i).join(":");
  assert.ok(unit.includes(`Environment="PATH=${path}" "AW_WAKE_OATS_BIN=${links}/oats"\n`), unit);
  assert.match(unit, new RegExp(`^ExecStart="${links}/aw" wake run$`, "m"));
});

test("install without tmux on PATH: installs, warns wake-tmux-missing, and the unit's PATH keeps the fallback", async (t) => {
  for (const platform of PLATFORMS) {
    const host = fakeWakeHost(t, { tmux: false });
    const r = await wake(host, platform, ["install", "--json"]);
    assert.equal(r.code, 0, r.stdout);
    assert.deepEqual(r.json.warnings, [{ code: "wake-tmux-missing", message: "tmux is not on this shell's PATH, so it is not on the unit's: the broker cannot reach OATS sessions until tmux is on the unit's PATH; install tmux or fix PATH, then rerun oats aweb wake install" }]);
    assert.ok(readFileSync(unitFile(host, platform), "utf8").includes([host.bin, nodeDir, ...WAKE_FALLBACK_PATH].filter((d, i, all) => all.indexOf(d) === i).join(":")));
    const plan = await wake(fakeWakeHost(t, { tmux: false }), platform, ["install", "--plan", "--json"]);
    assert.equal(plan.json.warnings[0].code, "wake-tmux-missing");
  }
});

test("install again: unchanged restarts without rewriting; changed rewrites, reloads and restarts", async (t) => {
  for (const platform of PLATFORMS) {
    const host = fakeWakeHost(t);
    assert.equal((await wake(host, platform, ["install"])).code, 0);
    const path = unitFile(host, platform);
    const before = host.changes().length;
    const same = await wake(host, platform, ["install", "--json"]);
    assert.equal(same.json.unit.written, false);
    assert.deepEqual(host.changes().slice(before).map((c) => c.argv.join(" ")), platform === "darwin"
      ? [`kickstart -k gui/501/${WAKE_LABEL}`]
      : [`--user enable ${path}`, `--user restart ${WAKE_LABEL}.service`]);
    // oats moved: the unit's AW_WAKE_OATS_BIN and PATH change.
    const moved = join(host.base, "moved"); mkdirSync(moved);
    symlinkSync(join(host.bin, "oats"), join(moved, "oats"));
    const at = host.changes().length;
    const changed = await wake(host, platform, ["install", "--json"], { env: { PATH: `${moved}:${host.bin}:${host.tmuxBin}` } });
    assert.equal(changed.code, 0, changed.stdout);
    assert.equal(changed.json.unit.written, true);
    assert.match(readFileSync(path, "utf8"), new RegExp(`AW_WAKE_OATS_BIN${platform === "darwin" ? "</key>\\s*<string>" : "="}${moved}/oats`));
    assert.deepEqual(host.changes().slice(at).map((c) => c.argv.join(" ")), platform === "darwin"
      ? [`bootout gui/501/${WAKE_LABEL}`, `bootstrap gui/501 ${path}`]
      : ["--user daemon-reload", `--user enable ${path}`, `--user restart ${WAKE_LABEL}.service`]);
  }
});

test("install refuses a foreign unit that runs aw wake run, and a file at our path it did not write; it writes and runs nothing", async (t) => {
  for (const platform of PLATFORMS) {
    const host = fakeWakeHost(t);
    const dir = dirname(unitFile(host, platform));
    mkdirSync(dir, { recursive: true });
    const foreign = platform === "darwin" ? join(dir, "com.me.wake.plist") : join(dir, "aw-wake.service");
    writeFileSync(foreign, platform === "darwin"
      ? `<plist version="1.0"><dict><key>Label</key><string>com.me.wake</string><key>ProgramArguments</key><array><string>${host.bin}/aw</string><string>wake</string><string>run</string></array></dict></plist>`
      : `[Unit]\nDescription=aweb host wake broker\n\n[Service]\nExecStart=${host.bin}/aw wake run\nEnvironment=PATH=${host.bin}:/usr/bin\nRestart=always\n\n[Install]\nWantedBy=default.target\n`);
    // A unit that serves something else is not a wake unit.
    writeFileSync(join(dir, platform === "darwin" ? "ai.aweb.custody.x.y.plist" : "ai.aweb.custody.x.y.service"), platform === "darwin"
      ? `<plist><dict><key>ProgramArguments</key><array><string>/bin/aw</string><string>custody</string><string>serve</string></array></dict></plist>`
      : "[Service]\nExecStart=/bin/aw custody serve\n");
    const before = readFileSync(foreign, "utf8");
    const r = await wake(host, platform, ["install", "--json"]);
    assert.equal(r.code, 1);
    assert.equal(r.json.error.code, "E_WAKE_UNIT_CONFLICT");
    assert.ok(r.json.error.message.includes(foreign), r.json.error.message);
    assert.ok(r.json.error.message.includes(platform === "darwin" ? "launchctl bootout gui/501/com.me.wake" : "systemctl --user disable --now aw-wake.service"), r.json.error.message);
    assert.equal(readFileSync(foreign, "utf8"), before, "the foreign unit is untouched");
    assert.equal(existsSync(unitFile(host, platform)), false, "nothing written");
    assert.deepEqual(host.changes(), []);
    // A file at our path without our marker is not ours either.
    const host2 = fakeWakeHost(t);
    mkdirSync(dirname(unitFile(host2, platform)), { recursive: true });
    writeFileSync(unitFile(host2, platform), "hand written\n");
    const r2 = await wake(host2, platform, ["install", "--json"]);
    assert.equal(r2.json.error.code, "E_WAKE_UNIT_CONFLICT");
    assert.match(r2.json.error.message, /not written by oats aweb wake install/);
    assert.equal(readFileSync(unitFile(host2, platform), "utf8"), "hand written\n");
    assert.deepEqual(host2.changes(), []);
  }
});

test("install refuses a daemon running outside any recognised unit, naming its pid", async (t) => {
  for (const platform of PLATFORMS) {
    const host = fakeWakeHost(t, { daemon: "hand" });
    const r = await wake(host, platform, ["install", "--json"]);
    assert.equal(r.json.error.code, "E_WAKE_RUNNING_UNSUPERVISED");
    assert.match(r.json.error.message, /daemon_pid 999\) outside any recognised unit.*kill 999/);
    assert.equal(existsSync(unitFile(host, platform)), false);
    assert.deepEqual(host.changes(), []);
  }
});

test("install refuses before any effect: inside a home, a missing command, AW_WAKE_STATE_DIR, an aw below the floor", async (t) => {
  for (const platform of PLATFORMS) {
    for (const name of ["OATS_INSTANCE_HOME", "OATS_HOME"]) {
      const host = fakeWakeHost(t);
      const r = await wake(host, platform, ["install", "--json"], { env: { [name]: "/srv/agents/x/instances/y" } });
      assert.equal(r.json.error.code, "E_WAKE_INSIDE_HOME");
      assert.ok(r.json.error.message.includes(`${name} is set`));
      assert.deepEqual(host.calls(), [], "nothing runs at all");
    }
    const noOats = fakeWakeHost(t, { oats: false });
    const r = await wake(noOats, platform, ["install", "--json"]);
    assert.equal(r.json.error.code, "E_WAKE_PATH");
    assert.match(r.json.error.message, /^oats not found on this shell's PATH/);
    const node = await wake(fakeWakeHost(t), platform, ["install", "--json"], { env: { OATS_NODE_BIN: "/nowhere/node" } });
    assert.equal(node.json.error.code, "E_WAKE_PATH");
    assert.match(node.json.error.message, /^node not found \(node: \/nowhere\/node\)/);
    const stateDir = fakeWakeHost(t);
    const s = await wake(stateDir, platform, ["install", "--json"], { env: { AW_WAKE_STATE_DIR: "/tmp/elsewhere" } });
    assert.equal(s.json.error.code, "E_WAKE_STATE_DIR");
    assert.match(s.json.error.message, /AW_WAKE_STATE_DIR/);
    assert.deepEqual(stateDir.calls(), []);
    const old = fakeWakeHost(t, { awVersion: "1.36.30" });
    const f = await wake(old, platform, ["install", "--json"]);
    assert.deepEqual(f.json.error, { code: "E_AW_FLOOR", message: `aw 1.36.30 is older than required ${AW_MIN}; upgrade with \`npm i -g @awebai/aw@latest\` (or \`npm i -g @awebai/aw@${AW_MIN}\`)` });
    assert.deepEqual(old.changes(), []);
  }
});

test("linger off: install warns and installs; --linger-required refuses before writing anything", async (t) => {
  const host = fakeWakeHost(t, { linger: "no" });
  const r = await wake(host, "linux", ["install", "--json"]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.warnings, [{ code: "wake-linger-off", message: "systemd lingering is off for alice: the wake broker stops when alice's last session ends; remedy: `loginctl enable-linger alice` (may need an administrator)" }]);
  assert.match((await wake(host, "linux", ["install"])).stdout, /^PASS wake broker .*\nWARN wake-linger-off: systemd lingering is off for alice/);
  const strict = fakeWakeHost(t, { linger: "no" });
  const s = await wake(strict, "linux", ["install", "--linger-required", "--json"]);
  assert.equal(s.json.error.code, "E_WAKE_LINGER");
  assert.match(s.json.error.message, /an administrator runs `loginctl enable-linger alice`, then rerun$/);
  assert.equal(existsSync(unitFile(strict, "linux")), false);
  assert.deepEqual(strict.changes(), []);
  // On with --linger-required: no warning; macOS has no linger.
  assert.deepEqual((await wake(fakeWakeHost(t), "linux", ["install", "--linger-required", "--json"])).json.warnings, []);
  const mac = fakeWakeHost(t, { linger: "no" });
  assert.deepEqual((await wake(mac, "darwin", ["install", "--linger-required", "--json"])).json.warnings, []);
  assert.equal(mac.calls().filter((c) => c.cmd === "loginctl").length, 0);
});

test("verify: a daemon that never reports running, or runs another version, fails E_WAKE_NOT_RUNNING and keeps the unit", async (t) => {
  for (const platform of PLATFORMS) {
    for (const options of [{ daemon: "never" }, { daemonVersion: "1.36.34" }]) {
      const host = fakeWakeHost(t, options);
      const r = await wake(host, platform, ["install", "--json"]);
      assert.equal(r.code, 1);
      assert.equal(r.json.error.code, "E_WAKE_NOT_RUNNING");
      assert.ok(r.json.error.message.includes(platform === "darwin" ? `read its log in ${host.home}/Library/Logs/ai.aweb.wake.log` : "journalctl --user -u ai.aweb.wake.service -n 50"), r.json.error.message);
      assert.ok(r.json.error.message.includes("the unit is kept"));
      assert.ok(existsSync(unitFile(host, platform)), "the unit is kept");
      if (options.daemonVersion) assert.match(r.json.error.message, /running aw 1\.36\.35 \(running: true, version: 1\.36\.34/);
    }
  }
});

test("--plan changes nothing: it prints the unit, the actions and any refusal", async (t) => {
  for (const platform of PLATFORMS) {
    const host = fakeWakeHost(t);
    const r = await wake(host, platform, ["install", "--plan", "--json"]);
    assert.equal(r.code, 0);
    const path = unitFile(host, platform);
    assert.equal(r.json.plan, true);
    assert.deepEqual(r.json.unit, { manager: platform === "darwin" ? "launchd" : "systemd", label: WAKE_LABEL, path, written: false, changed: true });
    assert.equal(r.json.text, renderWakeUnit({ platform, aw: join(host.bin, "aw"), oats: join(host.bin, "oats"), path: expectedPath(host), home: host.home }));
    assert.deepEqual(r.json.actions, platform === "darwin" ? [`write ${path}`, `bootstrap gui/501 ${path}`].map((a, i) => (i ? `launchctl ${a}` : a))
      : [`write ${path}`, "systemctl --user daemon-reload", `systemctl --user enable ${path}`, `systemctl --user restart ${WAKE_LABEL}.service`]);
    assert.equal(existsSync(path), false);
    assert.deepEqual(host.changes(), []);
    const text = await wake(host, platform, ["install", "--plan"]);
    assert.match(text.stdout, /^PLAN wake broker .*\n--- unit\n[\s\S]*--- actions\n/);
    // A refusal it would hit.
    const busy = fakeWakeHost(t, { daemon: "hand" });
    const refused = await wake(busy, platform, ["install", "--plan", "--json"]);
    assert.equal(refused.code, 1);
    assert.equal(refused.json.plan, true);
    assert.equal(refused.json.error.code, "E_WAKE_RUNNING_UNSUPERVISED");
    assert.deepEqual(busy.changes(), []);
  }
});

test("uninstall removes only ours; a foreign unit is never touched; absent is ok", async (t) => {
  for (const platform of PLATFORMS) {
    const host = fakeWakeHost(t);
    const dir = dirname(unitFile(host, platform));
    mkdirSync(dir, { recursive: true });
    const foreign = join(dir, platform === "darwin" ? "com.me.wake.plist" : "aw-wake.service");
    writeFileSync(foreign, platform === "darwin" ? "<plist/>" : `[Service]\nExecStart=${host.bin}/aw wake run\n`);
    // Install refuses beside it, so ours is put in place by hand-rendering it.
    writeFileSync(unitFile(host, platform), renderWakeUnit({ platform, aw: join(host.bin, "aw"), oats: join(host.bin, "oats"), path: host.bin, home: host.home }));
    if (platform === "darwin") writeFileSync(join(host.base, "unit-loaded"), "");
    const plan = await wake(host, platform, ["uninstall", "--plan", "--json"]);
    assert.ok(existsSync(unitFile(host, platform)));
    assert.deepEqual(host.changes(), []);
    const path = unitFile(host, platform);
    assert.deepEqual(plan.json.actions, platform === "darwin" ? [`launchctl bootout gui/501/${WAKE_LABEL}`, `remove ${path}`] : [`systemctl --user disable --now ${WAKE_LABEL}.service`, `remove ${path}`, "systemctl --user daemon-reload"]);
    const r = await wake(host, platform, ["uninstall", "--json"]);
    assert.deepEqual(r.json, { ok: true, unit: { manager: platform === "darwin" ? "launchd" : "systemd", label: WAKE_LABEL, path, removed: true } });
    assert.equal(existsSync(path), false);
    assert.ok(existsSync(foreign), "the foreign unit stays");
    assert.deepEqual(host.changes().map((c) => c.argv.join(" ")), platform === "darwin" ? [`bootout gui/501/${WAKE_LABEL}`] : [`--user disable --now ${WAKE_LABEL}.service`, "--user daemon-reload"]);
    // Absent.
    const again = await wake(host, platform, ["uninstall", "--json"]);
    assert.equal(again.code, 0);
    assert.equal(again.json.unit.removed, false);
    assert.match((await wake(host, platform, ["uninstall"])).stdout, /^PASS no wake broker unit at /);
    // A file at our path that install did not write.
    writeFileSync(path, "hand written\n");
    const refused = await wake(host, platform, ["uninstall", "--json"]);
    assert.equal(refused.json.error.code, "E_WAKE_UNIT_CONFLICT");
    assert.equal(readFileSync(path, "utf8"), "hand written\n");
    // Inside a home it refuses, as install does.
    assert.equal((await wake(host, platform, ["uninstall", "--json"], { env: { OATS_INSTANCE_HOME: "/h" } })).json.error.code, "E_WAKE_INSIDE_HOME");
  }
});

/** An instance home whose record this provider can read: its delivery and runtime. */
function record(root, name, meta) {
  const home = join(root, "agents", "s", "instances", name);
  mkdirSync(join(home, ".aw"), { recursive: true });
  mkdirSync(join(home, ".oats-aweb"), { recursive: true });
  writeFileSync(join(home, ".oats-aweb", "teams.json"), JSON.stringify({ joinedTeams: [] }));
  writeFileSync(join(home, "instance.json"), JSON.stringify({ instance: name, capabilityMeta: { "oats.aweb": meta } }));
  return realpathSync(home);
}

test("status: unit, daemon and the deployment's homes that need the broker; read-only, exit 0", async (t) => {
  const host = fakeWakeHost(t);
  const deployment = join(host.base, "deployment"); mkdirSync(deployment);
  writeFileSync(join(deployment, "oats-local.yaml"), "settings: {}\n");
  const session = record(deployment, "codex-1", { delivery: "session", runtime: "codex" });
  const codex = record(deployment, "codex-2", { delivery: "channel", runtime: "codex" });
  const pi = record(deployment, "pi-1", { delivery: "channel", runtime: "pi" });
  const broken = join(deployment, "agents", "s", "instances", "broken"); mkdirSync(broken, { recursive: true });
  writeFileSync(join(broken, "instance.json"), "{");
  host.setKernelStatus({ root: join(deployment, "agents"), agents: [{ name: "s", instances: [session, codex, pi, broken].map((home) => ({ instance: home.split("/").at(-1), home })) }] });
  const env = { OATS_WORKSPACE: deployment, OATS_CLI_BIN: host.kernel };
  for (const platform of PLATFORMS) {
    const absent = await wake(host, platform, ["status", "--json"], { env });
    assert.equal(absent.code, 0);
    assert.deepEqual(absent.json.unit, { manager: platform === "darwin" ? "launchd" : "systemd", label: WAKE_LABEL, present: false, path: unitFile(host, platform), aw: null, awOnPath: join(host.bin, "aw"), awCurrent: null, others: [] });
    assert.deepEqual(absent.json.daemon, { running: false, version: null, versionState: "not_running", pid: null, readable: true, floor: { min: AW_MIN, ok: null } });
    assert.deepEqual(absent.json.homes.items, [{ instance: "codex-1", home: session, registered: false }, { instance: "codex-2", home: codex, registered: false }]);
    assert.deepEqual(absent.json.homes.unknown.map((h) => h.instance), ["broken"]);
  }
  // Installed and running, with one home registered.
  const running = fakeWakeHost(t, { registered: [session] });
  running.setKernelStatus({ agents: [{ instances: [{ instance: "codex-1", home: session }, { instance: "pi-1", home: pi }] }] });
  assert.equal((await wake(running, "linux", ["install"])).code, 0);
  const before = running.changes().length;
  const r = await wake(running, "linux", ["status", "--json"], { env: { OATS_WORKSPACE: deployment, OATS_CLI_BIN: running.kernel } });
  assert.equal(r.code, 0);
  assert.equal(r.json.unit.present, true);
  assert.equal(r.json.unit.aw, join(running.bin, "aw"));
  assert.equal(r.json.unit.awCurrent, true);
  assert.deepEqual(r.json.daemon, { running: true, version: "1.36.35", versionState: "reported", pid: 4242, readable: true, floor: { min: AW_MIN, ok: true } });
  assert.deepEqual(r.json.homes, { known: true, items: [{ instance: "codex-1", home: session, registered: true }], unknown: [] });
  assert.equal(running.changes().length, before, "status changes nothing");
  assert.deepEqual(running.calls().filter((c) => c.cmd === "oats-kernel").at(-1).argv, ["status", "--dir", deployment, "--max-age", "3600", "--json"]);
  const text = await wake(running, "linux", ["status"], { env: { OATS_WORKSPACE: deployment, OATS_CLI_BIN: running.kernel } });
  assert.match(text.stdout, /^unit: .*ai\.aweb\.wake\.service runs .*\/aw \(the aw on PATH\)\ndaemon: running 1\.36\.35 \(pid 4242\)\nhomes needing the broker: 1\n  codex-1: registered\n$/);
  // An aw on PATH that is not the unit's (a link to the unit's is the same aw).
  const other = join(running.base, "other"); mkdirSync(other);
  symlinkSync(join(running.bin, "aw"), join(other, "aw"));
  assert.equal((await wake(running, "linux", ["status", "--json"], { env: { PATH: `${other}:${running.bin}:${running.tmuxBin}` } })).json.unit.awCurrent, true);
  rmSync(join(other, "aw")); copyFileSync(join(running.bin, "aw"), join(other, "aw")); chmodSync(join(other, "aw"), 0o755);
  assert.equal((await wake(running, "linux", ["status", "--json"], { env: { PATH: `${other}:${running.bin}:${running.tmuxBin}` } })).json.unit.awCurrent, false);
  // No deployment or no kernel: homes unknown, still exit 0.
  const unknown = await wake(running, "linux", ["status", "--json"]);
  assert.equal(unknown.code, 0);
  assert.equal(unknown.json.homes.known, false);
  assert.match(unknown.json.homes.reason, /deployment is not selected/);
  const noKernel = await wake(running, "linux", ["status", "--json"], { env: { OATS_WORKSPACE: deployment } });
  assert.match(noKernel.json.homes.reason, /OATS_CLI_BIN is not set/);
  const failing = await wake(running, "linux", ["status", "--json"], { env: { OATS_WORKSPACE: deployment, OATS_CLI_BIN: host.kernel.replace("kernel.mjs", "missing.mjs") } });
  assert.match(failing.json.homes.reason, /^oats status --json did not answer/);
  // A foreign unit is reported, not touched; an old daemon fails the floor check.
  const old = fakeWakeHost(t, { daemon: "hand", daemonVersion: "1.36.30" });
  mkdirSync(dirname(unitFile(old, "linux")), { recursive: true });
  writeFileSync(join(dirname(unitFile(old, "linux")), "aw-wake.service"), `[Service]\nExecStart=${old.bin}/aw wake run\n`);
  const s = await wake(old, "linux", ["status", "--json"]);
  assert.deepEqual(s.json.unit.others, [{ label: "aw-wake", path: join(dirname(unitFile(old, "linux")), "aw-wake.service") }]);
  assert.equal(s.json.daemon.floor.ok, false);
  assert.match((await wake(old, "linux", ["status"])).stdout, /below the aw floor/);
});

test("arguments: usage exits 2; each verb takes only its own flags; --soul and --dir are accepted", async (t) => {
  const host = fakeWakeHost(t);
  for (const argv of [[], ["restart"], ["status", "--plan"], ["uninstall", "--linger-required"], ["install", "--plan", "--plan"], ["install", "--dir"]]) {
    const r = await wake(host, "linux", argv);
    assert.equal(r.code, 2, argv.join(" "));
    assert.match(r.stderr, /^usage: oats aweb wake install/);
  }
  assert.equal((await wake(host, "linux", ["status", "--soul", "x", "--dir", host.base, "--json"])).code, 0);
  assert.equal((await wake(host, "win32", ["install", "--json"])).json.error.code, "E_WAKE_UNSUPPORTED");
});

test("the entrypoint dispatches `wake` before any hook setup", (t) => {
  const host = fakeWakeHost(t);
  const r = spawnSync(process.execPath, [BIN, "wake", "status", "--json"], { env: host.env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
  const manifest = JSON.parse(readFileSync(new URL("../oats-package/capabilities/oats-aweb/oats.json", import.meta.url), "utf8"));
  assert.equal(manifest.commands.wake, "bin/oats-aweb.mjs wake");
});
