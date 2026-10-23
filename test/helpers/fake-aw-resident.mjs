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
// Whether our unit's process is running at this look. A flapping one is
// running at the first look and gone at every later one.
const running = () => {
  if (["crashloop", "takeover"].includes(state.custody)) return false;
  if (state.custody !== "flapping") return true;
  const looks = path.join(state.base, "looks");
  const seen = fs.existsSync(looks);
  fs.writeFileSync(looks, "");
  return !seen;
};
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
 *   without the floor ops), "never" (never starts), "elsewhere" (already
 *   running, started by hand or by another supervisor, with no unit of ours),
 *   "crashloop" (that other custody runs, and our unit is loaded but
 *   restarting against it: launchd's "spawn scheduled", systemd's
 *   activating/auto-restart), "takeover" (another custody answers only once
 *   our unit has started, and our unit restarts against it), "flapping" (our
 *   unit's process is running at the first look and gone at the next).
 * Our unit's process is pid 4242 and owns the custody socket (fake lsof);
 * another custody is pid 999.
 * lsof: false leaves the fake lsof out, as on a host without it.
 * version: the version `aw version` reports (default the captured 1.36.33).
 *
 * The root route (`aw --identity-home <R>/.aw id create --owner-identity-home
 * <A>/.aw ...`) is not in any released aw: its answers below are synthetic,
 * shaped by the frozen arguments of awebai/oats-aweb#146, until a release
 * can be captured. Reads given `--identity-home` are the authority root's:
 * authority.domain is its `whoami` domain, authority.teamId the `team_id` of its
 * `inbound-mode`. create: "connected" (the complete identity, as init leaves
 * it) or "refused" (aw's refusal, nothing written). inbound: the resident's
 * `inbound_mode` read back after the create.
 */
export const AUTHORITY_TEAM_ID = "6f1d2c3b-4a59-4e8f-9b7a-0c1d2e3f4a5b";
export function fakeResidentAw(base, { init = "connected", linger = "yes", custody = "ready", aw = true, lsof = true, version, authority = {}, create = "connected", inbound = "contacts_only" } = {}) {
  const bin = join(base, "bin");
  mkdirSync(bin, { recursive: true });
  const fixtures = {};
  for (const name of ["init-certificate-connect", "init-apikey-workspace-init-404", "init-apikey-registry-mismatch", "init-apikey-registry-local", "init-apikey-rejected", "whoami", "doctor-identity-offline", "doctor-registry-online", "custody-status-not-running", "custody-status-running"]) fixtures[name] = fixture(name);
  const running = JSON.parse(fixtures["custody-status-running"].stdout);
  const missingOps = { ...fixtures["custody-status-running"], stdout: JSON.stringify({ ...running, ops: running.ops.filter((op) => op !== "grant_never_ttl.v1" && op !== "mail_reply_continuation.v1") }, null, 2) + "\n" };
  const versionOutput = version ? AW_VERSION_OUTPUT.replace(/^aw \S+/, `aw ${version}`) : AW_VERSION_OUTPUT;
  const owner = { domain: "acme.aweb.ai", teamId: AUTHORITY_TEAM_ID, ...authority };
  const state = JSON.stringify({ base, init, linger, custody, fixtures, missingOps, version: versionOutput, owner, create, inbound });
  const write = (name, body) => { const file = join(bin, name); writeFileSync(file, script(state, body)); chmodSync(file, 0o755); };
  if (aw) write("aw", `
const f = state.fixtures, cwd = process.cwd(), dotAw = path.join(cwd, ".aw");
const mark = (...names) => { fs.mkdirSync(dotAw, { recursive: true, mode: 0o700 }); for (const n of names) fs.writeFileSync(path.join(dotAw, n), ""); };
const json = (doc) => { process.stdout.write(JSON.stringify(doc, null, 2) + "\\n"); process.exit(0); };
const identityHome = argv[0] === "--identity-home" ? argv.splice(0, 2)[1] : undefined;
if (argv[0] === "version") { process.stdout.write(state.version); process.exit(0); }
if (argv[0] === "id" && argv[1] === "create") {
  if (state.create === "refused") { process.stderr.write("fake aw: the owner identity is not the owner of this organization\\n"); process.exit(1); }
  fs.mkdirSync(identityHome, { recursive: true, mode: 0o700 });
  for (const n of ["identity.yaml", "signing.key", "workspace.yaml"]) fs.writeFileSync(path.join(identityHome, n), "");
  const name = argv[argv.indexOf("--name") + 1];
  json({ status: "created", alias: name, identity_scope: "global", address: state.owner.domain + "/" + name, inbound_mode: state.inbound });
}
if (identityHome && argv[0] === "inbound-mode") json({ agent_id: "agent-root", team_id: state.owner.teamId, alias: "root", identity_scope: "local", inbound_mode: "open", label: "All", configurable: false });
if (identityHome && argv[0] === "whoami") json({ address: state.owner.domain + "/root", alias: "root", did: "did:key:z6Mkroot", domain: state.owner.domain, identity_scope: "local", inbound_configurable: false, inbound_mode: "open", inbound_mode_label: "All", name: "root" });
if (argv[0] === "inbound-mode") json({ agent_id: "agent-resident", team_id: state.owner.teamId, alias: "carol", identity_scope: "global", inbound_mode: state.inbound, label: "Contacts only", configurable: true });
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
  if (state.custody === "elsewhere" || state.custody === "crashloop") replay(f["custody-status-running"]);
  if (state.custody === "takeover" && flag("unit-loaded")) replay(f["custody-status-running"]);
  if (!flag("unit-loaded") || state.custody === "never") replay(f["custody-status-not-running"]);
  replay(state.custody === "missing-ops" ? state.missingOps : f["custody-status-running"]);
}
process.stderr.write("fake aw: unexpected " + argv.join(" ") + "\\n"); process.exit(97);
`);
  write("launchctl", `
if (argv[0] === "print") {
  if (!flag("unit-loaded")) process.exit(113);
  process.stdout.write(running() ? "gui/501/x = {\\n\\tstate = running\\n\\tpid = 4242\\n\\tendpoints = {\\n\\t\\tstate = active\\n\\t}\\n}\\n" : "gui/501/x = {\\n\\tstate = spawn scheduled\\n\\tlast exit code = 1\\n}\\n");
  process.exit(0);
}
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
if (argv[1] === "show") {
  process.stdout.write(flag("unit-loaded") && running() ? "ActiveState=active\\nSubState=running\\nMainPID=4242\\n" : "ActiveState=activating\\nSubState=auto-restart\\nMainPID=0\\n");
  process.exit(0);
}
process.exit(97);
`);
  write("loginctl", `
if (argv[0] === "show-user") { process.stdout.write("Linger=" + state.linger + "\\n"); process.exit(0); }
process.exit(97);
`);
  if (lsof) write("lsof", `
if (argv[0] !== "-t") process.exit(97);
if (["elsewhere", "crashloop", "takeover"].includes(state.custody)) { process.stdout.write("999\\n"); process.exit(0); }
if (flag("unit-loaded")) { process.stdout.write("4242\\n"); process.exit(0); }
process.exit(1);
`);
  return {
    bin,
    calls: () => existsSync(join(base, "calls.jsonl")) ? readFileSync(join(base, "calls.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [],
    loaded: () => existsSync(join(base, "unit-loaded")),
  };
}
