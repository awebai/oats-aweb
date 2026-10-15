// A fake host for `oats aweb wake` unit tests: fake aw, oats, systemctl,
// launchctl, loginctl and ps in <base>/bin, and a fake kernel (OATS_CLI_BIN)
// answering `oats status --json`. PATH is that bin alone, so no real unit
// manager is ever reached. Every call is logged as {cmd, argv} to
// <base>/calls.jsonl.
//
// The fake daemon follows the fake unit: a started unit (systemctl restart,
// launchctl bootstrap or kickstart) runs it as pid 4242; a stopped one (disable
// --now, bootout) stops it. aw wake status reports the fields real aw 1.36.35
// reports (daemon_running, daemon_pid, daemon_version, daemon_version_state,
// instances).
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

const script = (state, body) => `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const state = ${JSON.stringify(state)};
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(state.base, "calls.jsonl"), JSON.stringify({ cmd: path.basename(process.argv[1]), argv }) + "\\n");
const flag = (name) => fs.existsSync(path.join(state.base, name));
const touch = (name) => fs.writeFileSync(path.join(state.base, name), "");
const drop = (name) => fs.rmSync(path.join(state.base, name), { force: true });
${body}`;

/**
 * daemon: "unit" (runs while the unit is started), "hand" (already running
 *   as pid 999 with no unit), "never" (the unit starts, the daemon never
 *   reports running), "old" (runs, reporting daemonVersion).
 * linger: "yes" | "no". oats: false leaves oats out of PATH. tmux: false
 *   leaves tmux out; otherwise a fake tmux sits in <base>/tmux-bin, its own
 *   PATH entry, so its directory's place in the unit's PATH shows.
 * registered: homes `aw wake status` lists.
 */
export function fakeWakeHost(t, { awVersion = "1.36.35", daemonVersion = awVersion, daemon = "unit", linger = "yes", oats = true, tmux = true, registered = [] } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-aweb-wake-service-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = join(base, "bin");
  mkdirSync(bin, { recursive: true });
  const state = { base, awVersion, daemonVersion, daemon, linger, registered };
  const write = (name, body) => { const file = join(bin, name); writeFileSync(file, script(state, body)); chmodSync(file, 0o755); };
  write("aw", `
if (argv[0] === "version") { process.stdout.write("aw " + state.awVersion + " 0123abcd\\n"); process.exit(0); }
if (argv[0] === "wake" && argv[1] === "status") {
  const instances = state.registered.map((home) => ({ home }));
  if (state.daemon === "hand") { process.stdout.write(JSON.stringify({ daemon_running: true, daemon_pid: 999, daemon_version: state.daemonVersion, daemon_version_state: "reported", instances })); process.exit(0); }
  if (flag("unit-running") && state.daemon !== "never") { process.stdout.write(JSON.stringify({ daemon_running: true, daemon_pid: 4242, daemon_version: state.daemonVersion, daemon_version_state: "reported", instances })); process.exit(0); }
  process.stdout.write(JSON.stringify({ daemon_running: false, daemon_version_state: "not_running", instances }));
  process.exit(0);
}
process.stderr.write("fake aw: unexpected " + argv.join(" ") + "\\n"); process.exit(97);
`);
  if (oats) write("oats", `process.exit(0);`);
  write("systemctl", `
if (argv[0] !== "--user") process.exit(97);
if (argv[1] === "daemon-reload") process.exit(0);
if (argv[1] === "enable") { touch("unit-enabled"); process.exit(0); }
if (argv[1] === "restart") { touch("unit-running"); process.exit(0); }
if (argv[1] === "disable") { drop("unit-enabled"); if (argv.includes("--now")) drop("unit-running"); process.exit(0); }
if (argv[1] === "show") {
  process.stdout.write(flag("unit-running") ? "ActiveState=active\\nSubState=running\\nMainPID=4242\\n" : "ActiveState=inactive\\nSubState=dead\\nMainPID=0\\n");
  process.exit(0);
}
process.exit(97);
`);
  write("launchctl", `
if (argv[0] === "print") {
  if (!flag("unit-loaded")) process.exit(113);
  process.stdout.write(flag("unit-running") ? "gui/501/ai.aweb.wake = {\\n\\tstate = running\\n\\tpid = 4242\\n}\\n" : "gui/501/ai.aweb.wake = {\\n\\tstate = not running\\n}\\n");
  process.exit(0);
}
if (argv[0] === "bootstrap") { touch("unit-loaded"); touch("unit-running"); process.exit(0); }
if (argv[0] === "bootout") { drop("unit-loaded"); drop("unit-running"); process.exit(0); }
if (argv[0] === "kickstart") { touch("unit-running"); process.exit(0); }
process.exit(97);
`);
  write("loginctl", `
if (argv[0] === "show-user") { process.stdout.write("Linger=" + state.linger + "\\n"); process.exit(0); }
process.exit(97);
`);
  write("ps", `process.stdout.write("    1\\n"); process.exit(0);`);
  const tmuxBin = join(base, "tmux-bin");
  if (tmux) { mkdirSync(tmuxBin); writeFileSync(join(tmuxBin, "tmux"), "#!/bin/sh\nexit 0\n"); chmodSync(join(tmuxBin, "tmux"), 0o755); }
  const kernel = join(base, "kernel.mjs");
  writeFileSync(kernel, `import fs from "node:fs";
fs.appendFileSync(${JSON.stringify(join(base, "calls.jsonl"))}, JSON.stringify({ cmd: "oats-kernel", argv: process.argv.slice(2) }) + "\\n");
const file = ${JSON.stringify(join(base, "kernel-status.json"))};
if (process.argv[2] === "status" && fs.existsSync(file)) { process.stdout.write(fs.readFileSync(file, "utf8")); process.exit(0); }
process.exit(3);
`);
  const home = join(base, "home");
  mkdirSync(home);
  const calls = () => existsSync(join(base, "calls.jsonl")) ? readFileSync(join(base, "calls.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return {
    base, bin, home, kernel, tmuxBin: tmux ? tmuxBin : null,
    env: { PATH: tmux ? `${bin}:${tmuxBin}` : bin, HOME: home, XDG_CONFIG_HOME: join(base, "cfg") },
    calls,
    /** The manager calls that change something: everything but reads. */
    changes: () => calls().filter((c) => ["systemctl", "launchctl"].includes(c.cmd) && !["print", "show", "is-active"].includes(c.argv[0] === "--user" ? c.argv[1] : c.argv[0])),
    running: () => existsSync(join(base, "unit-running")),
    loaded: () => existsSync(join(base, "unit-loaded")),
    setKernelStatus: (doc) => writeFileSync(join(base, "kernel-status.json"), JSON.stringify(doc)),
  };
}
