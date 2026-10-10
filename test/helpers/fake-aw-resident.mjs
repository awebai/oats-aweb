// A fake `aw` (and fake launchctl/systemctl/loginctl) for `oats aweb resident
// create` unit tests. Every aw answer is a verbatim capture of real aw 1.36.33
// from test/fixtures/resident (see its README); the fake picks which capture
// to replay and creates the files a finished aw run leaves in its directory.
// Those files are empty markers: the provider only checks that they exist.
//
// The init child's environment is built from nothing, so nothing reaches the
// fake through its environment: the log and state paths are written into each
// script. Every call is logged as {cmd, argv, cwd, env} to <base>/calls.jsonl.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = fileURLToPath(new URL("../fixtures/resident/", import.meta.url));
export const fixture = (name) => ({
  stdout: readFileSync(join(FIXTURES, `${name}.stdout`), "utf8"),
  stderr: readFileSync(join(FIXTURES, `${name}.stderr`), "utf8"),
  exit: Number(readFileSync(join(FIXTURES, `${name}.exit`), "utf8").trim()),
});
export const AW_VERSION_OUTPUT = readFileSync(join(FIXTURES, "aw-version.txt"), "utf8");
/** The captured complete identity: its name, address and team. */
export const CAPTURED = (() => {
  const connected = JSON.parse(fixture("init-certificate-connect").stdout);
  return { name: connected.alias, address: connected.address, team: connected.team_id, stableId: connected.stable_id };
})();

const script = (state, body) => `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const state = ${state};
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(state.base, "calls.jsonl"), JSON.stringify({ cmd: path.basename(process.argv[1]), argv, cwd: process.cwd(), env: process.env }) + "\\n");
const flag = (name) => fs.existsSync(path.join(state.base, name));
const touch = (name) => fs.writeFileSync(path.join(state.base, name), "");
const replay = (f) => { process.stdout.write(f.stdout); process.stderr.write(f.stderr); process.exit(f.exit); };
${body}`;

/**
 * Writes the fakes into <base>/bin and returns helpers.
 * init: what `aw init` does — "connected" (a complete identity),
 *   "partial-404" (leaves a partial, aw's 404 answer), "mismatch" (aw's
 *   registry refusal; the partial stays as it was), "nothing" (aw refuses
 *   AWID_REGISTRY_URL=local and leaves nothing), "rejected" (aw's refusal of a
 *   quarantined partial), "echo-key" (a hostile aw that prints its AWEB_API_KEY on
 *   both streams and fails, leaving nothing).
 * linger: "yes" | "no" (loginctl's answer).
 * custody: "ready" (running after the unit loads), "missing-ops" (running
 *   without the floor ops), "never" (never starts).
 */
export function fakeResidentAw(base, { init = "connected", linger = "yes", custody = "ready", aw = true } = {}) {
  const bin = join(base, "bin");
  mkdirSync(bin, { recursive: true });
  const fixtures = {};
  for (const name of ["init-certificate-connect", "init-apikey-workspace-init-404", "init-apikey-registry-mismatch", "init-apikey-registry-local", "init-apikey-rejected", "whoami", "doctor-identity-offline", "doctor-registry-online", "custody-status-not-running", "custody-status-running"]) fixtures[name] = fixture(name);
  const running = JSON.parse(fixtures["custody-status-running"].stdout);
  const missingOps = { ...fixtures["custody-status-running"], stdout: JSON.stringify({ ...running, ops: running.ops.filter((op) => op !== "grant_never_ttl.v1" && op !== "mail_reply_continuation.v1") }, null, 2) + "\n" };
  const state = JSON.stringify({ base, init, linger, custody, fixtures, missingOps, version: AW_VERSION_OUTPUT });
  const write = (name, body) => { const file = join(bin, name); writeFileSync(file, script(state, body)); chmodSync(file, 0o755); };
  if (aw) write("aw", `
const f = state.fixtures, cwd = process.cwd(), dotAw = path.join(cwd, ".aw");
const mark = (...names) => { fs.mkdirSync(dotAw, { recursive: true, mode: 0o700 }); for (const n of names) fs.writeFileSync(path.join(dotAw, n), ""); };
if (argv[0] === "version") { process.stdout.write(state.version); process.exit(0); }
if (argv[0] === "init") {
  if (state.init === "connected") { if (fs.existsSync(path.join(dotAw, "partial-init.yaml"))) fs.rmSync(path.join(dotAw, "partial-init.yaml")); mark("identity.yaml", "signing.key", "workspace.yaml"); replay(f["init-certificate-connect"]); }
  if (state.init === "partial-404") { mark("partial-init.yaml"); replay(f["init-apikey-workspace-init-404"]); }
  if (state.init === "mismatch") replay(f["init-apikey-registry-mismatch"]);
  if (state.init === "rejected") replay(f["init-apikey-rejected"]);
  if (state.init === "nothing") replay(f["init-apikey-registry-local"]);
  if (state.init === "echo-key") { const k = process.env.AWEB_API_KEY || ""; process.stdout.write("key " + k + "\\n"); process.stderr.write("rejected key " + k + "\\n"); process.exit(1); }
}
if (argv[0] === "whoami") replay(f["whoami"]);
if (argv[0] === "doctor" && argv[1] === "identity") replay(f["doctor-identity-offline"]);
if (argv[0] === "doctor" && argv[1] === "registry") replay(f["doctor-registry-online"]);
if (argv[0] === "custody" && argv[1] === "status") {
  if (!flag("unit-loaded") || state.custody === "never") replay(f["custody-status-not-running"]);
  replay(state.custody === "missing-ops" ? state.missingOps : f["custody-status-running"]);
}
process.stderr.write("fake aw: unexpected " + argv.join(" ") + "\\n"); process.exit(97);
`);
  write("launchctl", `
if (argv[0] === "print") process.exit(flag("unit-loaded") ? 0 : 113);
if (argv[0] === "bootstrap") { touch("unit-loaded"); process.exit(0); }
if (argv[0] === "bootout") { try { fs.rmSync(path.join(state.base, "unit-loaded")); } catch {} process.exit(0); }
process.exit(97);
`);
  write("systemctl", `
if (argv[0] !== "--user") process.exit(97);
if (argv[1] === "show-environment") process.exit(0);
if (argv[1] === "daemon-reload") process.exit(0);
if (argv[1] === "enable" || argv[1] === "restart") { touch("unit-loaded"); process.exit(0); }
if (argv[1] === "is-active") process.exit(flag("unit-loaded") ? 0 : 3);
process.exit(97);
`);
  write("loginctl", `
if (argv[0] === "show-user") { process.stdout.write("Linger=" + state.linger + "\\n"); process.exit(0); }
process.exit(97);
`);
  return {
    bin,
    calls: () => existsSync(join(base, "calls.jsonl")) ? readFileSync(join(base, "calls.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [],
    loaded: () => existsSync(join(base, "unit-loaded")),
  };
}
