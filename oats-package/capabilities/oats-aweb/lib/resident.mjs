// `oats aweb resident create <name>`: provisions a GLOBAL resident identity in
// an existing hosted team, serves it with a per-user custody unit, and records
// it as settings.oats.aweb.residents.<name>.
//
// Two routes create the identity. The key route runs `aw init --global` with
// the dashboard's API key, read from AWEB_API_KEY only: it goes into the
// environment of that one child, built from nothing, and is scrubbed from
// everything written or printed. No flag takes a key and nothing prompts for
// one. Without a key, the root route runs `aw id create` authorized by the
// deployment's team root (--owner-identity-home), with no key at all.
//
// Stages, each with its own error codes: arguments, deployment, aw, preflight
// (no remote effect), key (the route), init (one run, no retry), verify,
// custody, record.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync, writeSync } from "node:fs";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import { awFloorObservation, onPath } from "./binding-wire.mjs";
import { AW_RESIDENT_ROOT_MIN, versionAtLeast } from "./aw-floor.mjs";
import { parseAwJson } from "./grant-custody.mjs";
import { assertAwebSettingRecordable, recordAwebSetting } from "./local-settings.mjs";
import { querySelectedKernel } from "./session-readiness.mjs";
import { selectedTeamKernel } from "./setup-team-default.mjs";
import { normalizeAwebTeamName, selectedDeployment } from "./team-roots.mjs";
import { conflictMessage, custodyLabel, ensureCustodyUnit, foreignUnitMessage, handStep, lingerProblem, ownUnitServes, residentUnits, retireUnitStep, samePath, unitManager, unitPath, waitForCustody } from "./custody-unit.mjs";

export const RESIDENT_USAGE = "usage: [AWEB_API_KEY=<key> AWEB_URL=<url>] oats aweb resident create <name> [--dir <deployment>] [--root <dir>] [--authority-root <dir>] [--org <slug or id>] [--team-label <label>] [--plan] [--json]";
const ALIAS_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const ALIAS_RULE = "aweb aliases must be 1-64 characters, start with a letter or digit, and then contain only letters, digits, '-' or '_'";
const LABEL_RE = /^[a-z0-9][a-z0-9._-]*$/;
const INIT_ARGS = (name) => ["init", "--global", "--name", name, "--do-not-touch-agents-md", "--json"];
/** The inbound mode the root route requests, and the value aw reads back for it. */
const RESIDENT_INBOUND = { flag: "contacts-only", wire: "contacts_only" };
/** aw's --identity-home and --owner-identity-home take the credential
 *  directory itself, the `.aw` of a root. */
const credentialHome = (root) => join(root, ".aw");
const CREATE_ARGS = ({ resident, owner, org, teamId, name }) => ["--identity-home", credentialHome(resident), "id", "create", "--owner-identity-home", credentialHome(owner), "--org", org, "--team-id", teamId, "--name", name, "--inbound-mode", RESIDENT_INBOUND.flag, "--json"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;
/** The managed namespace suffix: `<org>.aweb.ai` belongs to organization <org>. */
const MANAGED_SUFFIX = ".aweb.ai";
const INIT_TIMEOUT_MS = 300000;
const MAX_KEY_LENGTH = 4096; // aw's own limit for a workspace API key
/** The files a complete identity has in its .aw (aw init's certificate connect). */
const COMPLETE = ["identity.yaml", "signing.key", "workspace.yaml"];
const CAPTURE_DIR = ".oats-resident";

const failure = (code, stage, message, details = {}) => Object.assign(new Error(message), { code, stage, details });
const hostname = (s) => typeof s === "string" && s.length <= 253 && s.split(".").every((l) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(l));
const canonicalTeam = (s) => { const m = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127}):([^:]+)$/.exec(String(s ?? "")); return !!m && hostname(m[2]); };
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function parseResidentArgs(argv) {
  const usage = () => failure("E_RESIDENT_ARGUMENT", "arguments", RESIDENT_USAGE);
  const [sub, ...rest] = argv;
  if (sub !== "create") throw usage();
  const opts = { plan: false, json: false };
  const seen = new Set();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) { if (opts.name !== undefined) throw usage(); opts.name = arg; continue; }
    const [flag, ...inline] = arg.split("=");
    if (seen.has(flag)) throw usage();
    seen.add(flag);
    if (flag === "--plan" || flag === "--json") { if (inline.length) throw usage(); opts[flag.slice(2)] = true; continue; }
    // --soul is the kernel's operator dispatch, forwarded to every command.
    if (!["--dir", "--root", "--authority-root", "--org", "--team-label", "--soul"].includes(flag)) throw usage();
    const value = inline.length ? inline.join("=") : rest[++i];
    if (!value || value.startsWith("--")) throw usage();
    if (flag === "--dir") opts.dir = value;
    if (flag === "--root") opts.root = value;
    if (flag === "--team-label") opts.teamLabel = value;
    if (flag === "--authority-root") opts.authorityRoot = value;
    if (flag === "--org") opts.org = value;
  }
  if (opts.name === undefined) throw usage();
  if (!ALIAS_RE.test(opts.name)) throw failure("E_RESIDENT_ARGUMENT", "arguments", `invalid resident name ${JSON.stringify(opts.name)}: ${ALIAS_RULE}`);
  if (opts.org !== undefined && !ORG_SLUG_RE.test(opts.org) && !UUID_RE.test(opts.org)) throw failure("E_RESIDENT_ARGUMENT", "arguments", `invalid --org ${JSON.stringify(opts.org)}: an organization is its slug (letters, digits and '-', starting with a letter or digit) or its UUID, never a domain`);
  if (opts.teamLabel !== undefined && !LABEL_RE.test(opts.teamLabel)) throw failure("E_RESIDENT_ARGUMENT", "arguments", `invalid --team-label ${JSON.stringify(opts.teamLabel)}: a team label is lowercase letters, digits, '.', '_' or '-', starting with a letter or digit`);
  return opts;
}

/** What R holds: create (empty or missing), continue (aw's partial init),
 *  rejected (quarantined signing material), adopt (a complete identity), or
 *  anything else, which is refused naming what is there. */
export function rootState(root) {
  if (!existsSync(root)) return { state: "create" };
  if (!statSync(root).isDirectory()) throw failure("E_RESIDENT_ROOT", "preflight", `${root} is not a directory`);
  const entries = readdirSync(root).sort();
  if (!entries.length) return { state: "create" };
  const dotAw = join(root, ".aw");
  const inAw = existsSync(dotAw) && statSync(dotAw).isDirectory() ? readdirSync(dotAw) : [];
  const rejected = inAw.filter((n) => n.startsWith("partial-init.yaml.") && n.endsWith(".rejected")).sort();
  const partial = inAw.includes("partial-init.yaml");
  const complete = COMPLETE.every((n) => inAw.includes(n));
  const others = entries.filter((n) => n !== ".aw" && n !== CAPTURE_DIR);
  if (rejected.length) return { state: "rejected", rejected: join(dotAw, rejected[0]) };
  if (complete && !partial) return { state: "adopt" };
  if (partial && !complete && !others.length) return { state: "continue" };
  throw failure("E_RESIDENT_ROOT", "preflight", `${root} is neither empty, a partial aw init nor a complete global identity: it contains ${entries.join(", ")}; never init into it: choose another --root or empty it yourself`);
}
const needsInit = (state) => state === "create" || state === "continue" || state === "rejected";

const KEY_ROUTE = (name) => `AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create ${name}`;
/** The key from AWEB_API_KEY, or undefined. Nothing asks for one. */
function envKey(env) {
  const key = typeof env.AWEB_API_KEY === "string" ? env.AWEB_API_KEY.trim() : "";
  if (!key) return undefined;
  if (key.length > MAX_KEY_LENGTH || /[\x00-\x1f\x7f]/.test(key)) throw failure("E_RESIDENT_KEY", "key", `the API key must be one line of at most ${MAX_KEY_LENGTH} characters`);
  return key;
}

/** The team root that authorizes the root route: --authority-root, else the
 *  deployment's root for the resident's team (the team of --team-label, else
 *  the default team), else its root. Fails E_RESIDENT_KEY, naming both routes,
 *  when there is none. */
function authorityRoot(opts, settings, team) {
  const roots = object(settings.roots) ? settings.roots : {};
  const [raw, from] = opts.authorityRoot !== undefined ? [opts.authorityRoot, "--authority-root"]
    : team && typeof roots[team] === "string" ? [roots[team], `settings.oats.aweb.roots[${JSON.stringify(team)}]`]
    : typeof settings.root === "string" ? [settings.root, "settings.oats.aweb.root"] : [];
  if (raw === undefined) throw failure("E_RESIDENT_KEY", "key", `no AWEB_API_KEY in the environment and no team root to authorize the resident: for the root route, set settings.oats.aweb.root (or settings.oats.aweb.roots[<team>]) to the directory holding the team root's .aw, or pass --authority-root <dir>; for the key route, run ${KEY_ROUTE(opts.name)}`);
  const root = resolve(raw);
  const home = credentialHome(root);
  if (!existsSync(home) || !statSync(home).isDirectory()) throw failure("E_RESIDENT_KEY", "key", `no AWEB_API_KEY in the environment, and ${from} (${root}) holds no .aw to authorize the resident: point it at the team root, pass --authority-root <dir>, or run ${KEY_ROUTE(opts.name)}`);
  return { root, from };
}

/** What `aw id create` needs from the team root: its team's Cloud UUID (the
 *  `team_id` of `inbound-mode`, never the canonical id) and the organization,
 *  --org or the slug of the root's `<org>.aweb.ai` namespace. */
function authorityFacts(owner, org, readJson) {
  const read = (cmd) => readJson(["--identity-home", credentialHome(owner), cmd, "--json"], `aw ${cmd} in the team root ${owner}`, "preflight", owner);
  const inbound = read("inbound-mode");
  if (!object(inbound) || typeof inbound.team_id !== "string" || !UUID_RE.test(inbound.team_id)) throw failure("E_RESIDENT_VERIFY", "preflight", `aw inbound-mode in the team root ${owner} answered team_id ${JSON.stringify(inbound?.team_id ?? null)}, not the team's UUID`);
  if (org !== undefined) return { teamId: inbound.team_id, org };
  const domain = read("whoami")?.domain;
  const slug = typeof domain === "string" && domain.endsWith(MANAGED_SUFFIX) ? domain.slice(0, -MANAGED_SUFFIX.length) : "";
  if (!ORG_SLUG_RE.test(slug)) throw failure("E_RESIDENT_VERIFY", "preflight", `aw whoami in the team root ${owner} answered domain ${JSON.stringify(domain ?? null)}, not <org>${MANAGED_SUFFIX}, so the organization cannot be derived from it: pass --org <slug or id>`);
  return { teamId: inbound.team_id, org: slug };
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
/** Keeps aw init's streams and exit under R only, owner-readable. */
function writeCaptures(root, r, scrub) {
  const dir = join(root, CAPTURE_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const at = stamp();
  const exit = r.error ? (r.error.code === "ETIMEDOUT" ? `timed out after ${INIT_TIMEOUT_MS / 1000} s` : `failed: ${r.error.code || r.error.message}`) : r.signal ? `signal ${r.signal}` : `exit ${r.status}`;
  const files = { stdout: scrub(r.stdout || ""), stderr: scrub(r.stderr || ""), exit: `${exit}\n` };
  const written = Object.entries(files).map(([kind, text]) => {
    const file = join(dir, `init-${at}.${kind}`);
    writeFileSync(file, text, { mode: 0o600 });
    chmodSync(file, 0o600);
    return file;
  });
  return { files: written, exit };
}
/** Replaces every secret's value in text. */
export function scrubber(secrets) {
  const values = [...new Set(secrets.filter((v) => typeof v === "string" && v.length))].sort((a, b) => b.length - a.length);
  return (text) => values.reduce((acc, v) => acc.split(v).join("<redacted>"), String(text ?? ""));
}

/** A field check over aw's answer: throws E_RESIDENT_VERIFY naming the field. */
function expectFields(what, doc, name, fields) {
  const wrong = (field, want) => failure("E_RESIDENT_VERIFY", "verify", `${what} answered ${field} ${JSON.stringify(doc?.[field] ?? null)}, not ${want}`);
  if (!object(doc)) throw failure("E_RESIDENT_VERIFY", "verify", `${what} printed no JSON object`);
  if (fields.includes("status") && doc.status !== "connected") throw wrong("status", "connected");
  if (doc.identity_scope !== "global") throw wrong("identity_scope", "global");
  if (doc.alias !== name) throw wrong("alias", name);
  if (doc.name !== undefined && doc.name !== name) throw wrong("name", name);
  if (fields.includes("team_id") && !canonicalTeam(doc.team_id)) throw wrong("team_id", "a canonical <name>:<namespace> team id");
  if (typeof doc.stable_id !== "string" || !doc.stable_id.startsWith("did:aw:")) throw wrong("stable_id", "a did:aw stable id");
  const [namespace, alias, ...rest] = String(doc.address ?? "").split("/");
  if (!hostname(namespace) || alias !== name || rest.length) throw wrong("address", `<namespace>/${name}`);
  return { address: doc.address, stableId: doc.stable_id, ...(fields.includes("team_id") ? { team: doc.team_id } : {}) };
}

/** aw init's answer: a connected global identity named `name` in a canonical
 *  team, with a stable id and an address. */
export const checkInitAnswer = (doc, name) => expectFields("aw init", doc, name, ["status", "team_id"]);

/** Every offline identity check must be ok: with no identity at all, aw's
 *  doctor answers status ok with each check `info`. */
function identityDoctor(doc, name) {
  const what = "aw doctor identity --offline";
  if (!object(doc) || !Array.isArray(doc.checks)) throw failure("E_RESIDENT_VERIFY", "verify", `${what} printed no checks`);
  const identityChecks = doc.checks.filter((c) => object(c) && String(c.id || "").startsWith("identity."));
  const notOk = identityChecks.filter((c) => c.status !== "ok");
  if (!identityChecks.length) throw failure("E_RESIDENT_VERIFY", "verify", `${what} ran no identity checks`);
  if (notOk.length || doc.status !== "ok") {
    const why = notOk.map((c) => `${c.id} is ${c.status}, not ok${c.message ? ` (${c.message})` : ""}`);
    throw failure("E_RESIDENT_VERIFY", "verify", `${what}: ${why.length ? why.join("; ") : `status is ${doc.status}, not ok`}`);
  }
  const subject = object(doc.subject) ? doc.subject : {};
  if (subject.identity_scope !== "global" || subject.alias !== name) throw failure("E_RESIDENT_VERIFY", "verify", `${what} examined ${subject.alias ?? "no identity"} (${subject.identity_scope ?? "no scope"}), not the global identity ${name}`);
  if (!canonicalTeam(subject.team_id)) throw failure("E_RESIDENT_VERIFY", "verify", `${what} shows team ${JSON.stringify(subject.team_id ?? null)}, not a canonical team id`);
  if (typeof subject.workspace_id !== "string" || !subject.workspace_id) throw failure("E_RESIDENT_VERIFY", "verify", `${what} shows no workspace: the identity is not connected`);
  return { team: subject.team_id };
}

function registryWarnings(read) {
  const what = "aw doctor registry --online";
  let doc;
  try { doc = parseAwJson(read(["doctor", "registry", "--online", "--json"]), what); }
  catch (e) { return [`${what} could not be read (${String(e.message || e).slice(0, 200)}); this can be publication lag`]; }
  if (doc?.status === "ok") return [];
  const failing = (Array.isArray(doc?.checks) ? doc.checks : []).filter((c) => object(c) && !["ok", "info"].includes(c.status));
  return failing.length ? failing.map((c) => `${what}: ${c.id} is ${c.status} (this can be publication lag)`) : [`${what}: status is ${doc?.status ?? "unknown"} (this can be publication lag)`];
}

const SPAWN = (name) => `oats spawn <soul> --provider oats.aweb identity.mode=global --provider oats.aweb identity.resident=${name}`;
const NEXT = (name) => `spawn a seat on this resident: ${SPAWN(name)}`;
const commitLines = (entries) => ["This workspace does not allow local teams; commit the team in oats-workspace.yaml:", ...entries];
const KERNEL_LABEL_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CONDITIONAL_DEFAULT = "teams-conditional-default";

/** The selected kernel's team commands, failing as E_RESIDENT_TEAM_LABEL at
 *  `stage`. The kernel child gets no aweb or awid variable, the key least of all. */
const kernelEnvOf = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !/^(AWEB_|AWID_)/.test(k)));
function teamKernel(deployment, env, stage) {
  const failed = (e) => failure("E_RESIDENT_TEAM_LABEL", stage, e.message);
  let kernel;
  try { kernel = selectedTeamKernel(deployment, kernelEnvOf(env)); } catch (e) { throw failed(e); }
  const guarded = (f) => (...args) => { try { return f(...args); } catch (e) { throw failed(e); } };
  return { read: guarded(kernel.read), addMapping: guarded(kernel.addMapping), setDefaultIfAbsent: kernel.setDefaultIfAbsent };
}

/** Mapping a team must never replace a default: a plain `oats teams add`
 *  makes the first local team the default, over the workspace's. The kernel's
 *  `--no-default` and `--if-absent` (feature teams-conditional-default, OATS
 *  0.48.0) are the only safe verbs, and an older kernel ignores those flags.
 *  So an older kernel is refused wherever the record stage writes through the
 *  kernel: everywhere but a workspace that allows no local teams, where the
 *  command only prints what to commit. */
function preflightKernel(deployment, env) {
  let version;
  try { version = querySelectedKernel(["--version", "--json"], { env: kernelEnvOf(env) }); }
  catch { throw failure("E_RESIDENT_TEAM_LABEL", "preflight", "the selected OATS kernel (OATS_CLI_BIN) did not answer oats --version --json: run this command as oats aweb resident create"); }
  if (Array.isArray(version?.features) && version.features.includes(CONDITIONAL_DEFAULT)) return;
  if (teamKernel(deployment, env, "preflight").read().localTeams === false) return;
  throw failure("E_RESIDENT_TEAM_LABEL", "preflight", `oats aweb resident create needs OATS 0.48.0 or later (${CONDITIONAL_DEFAULT}), so that mapping the resident's team never replaces a default team; the selected kernel is ${typeof version?.version === "string" ? version.version : "unknown"}: upgrade OATS with \`npm install -g @awebai/oats@latest\`, then rerun`);
}

/** Before an init, a label that already maps to a team is refused: the new
 *  resident's team is known only after aw init, which is a remote effect. */
function preflightTeamLabel(deployment, env, label) {
  const row = teamKernel(deployment, env, "preflight").read().teams.find((r) => r.label === label);
  if (row) throw failure("E_RESIDENT_TEAM_LABEL", "preflight", `team label ${label} already maps to ${row.team ?? "no team"}, and a new resident's team is known only after aw init: run without --team-label if the resident joins that team, or choose another label`);
}

/** The label a team is mapped under without --team-label: its name, the part
 *  of the id before ':', as an aweb team name, and a kernel team label. */
export function derivedTeamLabel(team) {
  let label;
  try { label = normalizeAwebTeamName(String(team).split(":")[0]); } catch { /* refused below */ }
  if (!label || !KERNEL_LABEL_RE.test(label)) throw new Error(`the name of team ${team} is not a team label of at most 64 characters`);
  return label;
}

/** Maps the resident's team under --team-label, or under its derived label,
 *  through the selected kernel, and makes that label the default team only
 *  where the deployment has none. An existing default is never changed. */
function recordTeam(deployment, env, opts, team, { root, custody, localYaml }) {
  const derived = opts.teamLabel === undefined;
  const rerun = () => ["oats aweb resident create", opts.name, ...(opts.dir ? ["--dir", opts.dir] : []), ...(opts.root ? ["--root", opts.root] : []), "--team-label <other>"].join(" ");
  // The identity, custody and residents setting are in place: only the mapping is missing.
  const served = custody.label ? `its custody unit ${custody.label} (${custody.path})` : `its custody, running in ${root}`;
  const refuse = (why) => failure("E_RESIDENT_TEAM_LABEL", "record", `${why}. This check runs after aw init and before the label is written. Already in place: the resident's identity in ${root}, ${served}, and settings.oats.aweb.residents.${opts.name} in ${localYaml}; only the team mapping is missing. Rerun with another label: ${rerun()}. That rerun needs no API key: it verifies the resident and adds the mapping; it is not a second create`);
  let label = opts.teamLabel;
  if (derived) { try { label = derivedTeamLabel(team); } catch (e) { throw refuse(e.message); } }
  const kernel = teamKernel(deployment, env, "record");
  let doc = kernel.read();
  const row = doc.teams.find((r) => r.label === label);
  if (row && row.team !== team) {
    if (derived) throw refuse(`the team label ${label}, derived from the name of team ${team}, already maps to ${row.team ?? "no team"}`);
    throw failure("E_RESIDENT_TEAM_LABEL", "record", `team label ${label} already maps to ${row.team ?? "no team"}, not ${team}; choose another --team-label`);
  }
  const result = { label, team, status: row ? "reused" : doc.localTeams === false ? "commit" : "added", derived };
  const other = doc.defaultTeam && doc.defaultTeam.label !== label ? doc.defaultTeam : undefined;
  if (doc.localTeams === false) {
    const entries = [...(row ? [] : ["    teams:", `      ${JSON.stringify(label)}: { team: ${JSON.stringify(team)} }`]), ...(doc.defaultTeam ? [] : [`    defaultTeam: ${JSON.stringify(label)}`])];
    // `oats teams default` is refused there too: a different default is the workspace's to change.
    return { teamLabel: { ...result, default: doc.defaultTeam ? (other ? "kept" : "already") : "commit", ...(entries.length ? { lines: commitLines(entries) } : {}) }, other };
  }
  if (!row) {
    kernel.addMapping(label, team);
    doc = kernel.read();
    if (doc.teams.find((r) => r.label === label)?.team !== team) throw failure("E_RESIDENT_TEAM_LABEL", "record", `oats teams add ${label} did not read back as ${team}`);
  }
  if (doc.defaultTeam?.label === label) return { teamLabel: { ...result, default: "already" } };
  if (!doc.defaultTeam) {
    // --if-absent refuses when a default appeared meanwhile: the readback decides.
    let refused;
    try { kernel.setDefaultIfAbsent(label); } catch (e) { refused = e; }
    doc = kernel.read();
    if (doc.defaultTeam?.label === label) return { teamLabel: { ...result, default: "set" } };
    if (!doc.defaultTeam) throw failure("E_RESIDENT_TEAM_LABEL", "record", `oats teams default ${label} --if-absent did not make ${label} the default team${refused ? ` (${refused.message})` : ""}`);
  }
  return { teamLabel: { ...result, default: "kept" }, other: doc.defaultTeam, defaultStep: `oats teams default ${label}` };
}

/** The whole command. Returns the result document; throws a staged failure. */
export async function createResident(opts, { env, platform }) {
  const { name } = opts;
  let deployment;
  try { deployment = selectedDeployment(env, opts.dir); }
  catch (e) { throw failure("E_RESIDENT_DEPLOYMENT", "deployment", e.message); }
  let settings;
  try { settings = JSON.parse(env.OATS_SETTINGS || "{}"); } catch { settings = {}; }
  const residents = object(settings) && object(settings.residents) ? settings.residents : {};
  const root = opts.root ? resolve(opts.root) : join(deployment, ".aweb-residents", name);
  // Every failure from here on names the resident's directory, and the
  // captures of the init run when there was one.
  const captures = [];
  try {
    const localYaml = join(deployment, "oats-local.yaml");
    const recorded = typeof residents[name] === "string" ? residents[name] : undefined;
    if (recorded !== undefined && !samePath(recorded, root)) throw failure("E_RESIDENT_ROOT", "preflight", `settings.oats.aweb.residents.${name} already records ${recorded}, not ${root}: pass --root ${recorded} to verify that resident, or choose another name`);

    // Every aw child but init runs with PATH and HOME, and the init's registry
    // when one is set: no key, no identity selector.
    const readEnv = { PATH: env.PATH || "", HOME: env.HOME || "", AW_NO_UPDATE_CHECK: "1", ...(env.AWID_REGISTRY_URL ? { AWID_REGISTRY_URL: env.AWID_REGISTRY_URL } : {}) };
    const { message: floor, version: awVersion } = await awFloorObservation({ env: readEnv });
    if (floor) throw failure("E_RESIDENT_AW_FLOOR", "aw", floor);
    const aw = onPath("aw", env);
    if (!aw) throw failure("E_RESIDENT_AW_FLOOR", "aw", "aw is not on PATH");
    const read = (args, cwd = root) => {
      const r = spawnSync(aw, args, { cwd, env: readEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
      if (r.status !== 0) throw new Error(`aw ${args.slice(0, 2).join(" ")} ${r.error ? `failed: ${r.error.code}` : `exited ${r.status}`}${r.stderr ? `: ${String(r.stderr).trim().slice(0, 300)}` : ""}`);
      return r.stdout;
    };
    const readJson = (args, what, stage = "verify", cwd = root) => {
      try { return parseAwJson(read(args, cwd), what); }
      catch (e) { throw failure("E_RESIDENT_VERIFY", stage, `${what}: ${e.message}`); }
    };

    // ---- preflight: nothing here has a remote effect
    const where = { platform, uid: process.getuid?.(), home: env.HOME || "", xdgConfigHome: env.XDG_CONFIG_HOME };
    let apiKey = envKey(env);
    const rootFlag = opts.authorityRoot !== undefined ? "--authority-root" : opts.org !== undefined ? "--org" : undefined;
    if (rootFlag && apiKey) throw failure("E_RESIDENT_ARGUMENT", "preflight", `${rootFlag} belongs to the root route, and AWEB_API_KEY selects the key route: unset AWEB_API_KEY or drop ${rootFlag}`);
    if (opts.authorityRoot !== undefined && samePath(resolve(opts.authorityRoot), root)) throw failure("E_RESIDENT_ROOT", "preflight", `${root} is the team root that authorizes it: choose another --root for the resident`);
    const { state, rejected } = rootState(root);
    const awebUrl = typeof env.AWEB_URL === "string" && env.AWEB_URL.trim() ? env.AWEB_URL : undefined;
    const manager = unitManager(platform);
    if (manager) {
      const conflict = residentUnits(where, name).find((u) => !u.root || !samePath(u.root, root));
      if (conflict) throw failure("E_RESIDENT_UNIT_CONFLICT", "preflight", conflictMessage(conflict, root));
    }
    const linger = lingerProblem({ platform, user: userInfo().username, env });
    if (linger) throw failure("E_RESIDENT_LINGER", "preflight", linger);
    try { assertAwebSettingRecordable("residents", name, root, { start: deployment }); }
    catch (e) { throw failure("E_RESIDENT_RECORD", "preflight", e.message); }
    preflightKernel(deployment, env);

    // The route: the key route with AWEB_API_KEY, else the root route, whose
    // team root authorizes the create. Only the key route continues aw init's partial.
    let route;
    if (needsInit(state) && apiKey) route = { kind: "key" };
    else if (needsInit(state)) {
      if (state !== "create") throw failure("E_RESIDENT_KEY", "key", `${root} holds a partial aw init, which only the key route continues: run ${KEY_ROUTE(name)}, or choose another --root for the root route`);
      const teams = teamKernel(deployment, env, "preflight").read();
      const team = opts.teamLabel !== undefined ? teams.teams.find((r) => r.label === opts.teamLabel)?.team : teams.defaultTeam?.team;
      const owner = authorityRoot(opts, settings, team);
      if (!versionAtLeast(awVersion, AW_RESIDENT_ROOT_MIN)) throw failure("E_RESIDENT_AW_FLOOR", "aw", `aw ${awVersion} is older than ${AW_RESIDENT_ROOT_MIN}, the first aw whose id create takes --owner-identity-home: creating a resident without an API key needs it; upgrade with \`npm i -g @awebai/aw@latest\``);
      route = { kind: "root", owner: owner.root, from: owner.from, ...authorityFacts(owner.root, opts.org, readJson) };
    }
    // A plan has no remote effect: it names the URL the init would use.
    if (route?.kind === "key" && !awebUrl && !opts.plan) throw failure("E_RESIDENT_ARGUMENT", "preflight", `AWEB_URL is not set: copy the dashboard line, ${KEY_ROUTE(name)}`);
    // On the root route the label's team is known before the create: it selects the team root.
    if (opts.teamLabel && route?.kind === "key") preflightTeamLabel(deployment, env, opts.teamLabel);
    /** Why the custody answering in R is not this command's unit, or nothing
     *  when our unit's process is what serves it. */
    const notOurCustody = async (label, status) => {
      const own = await ownUnitServes({ platform, label, root, home: env.HOME || "", xdgConfigHome: env.XDG_CONFIG_HOME, uid: process.getuid(), env, socketPath: String(status?.socket_path || "") });
      if (own.serves) return undefined;
      const units = residentUnits(where, name).filter((u) => u.root && samePath(u.root, root));
      // Our unit just failed ownership verification; retiring it cannot stop
      // the custody that is actually answering. Only name another unit.
      const supervisor = units.find((u) => u.label !== label);
      const step = supervisor
        ? `recognised custody unit ${supervisor.label} (${supervisor.path}) is configured for this root: ${retireUnitStep(supervisor, where)}, then rerun; a unit started beside it would restart in a loop against it`
        : `no ${units.length ? "other " : ""}recognised unit was found; find and stop any supervisor outside the recognised units: run \`aw custody stop\` in ${root} (or stop whatever supervises it), then rerun; a unit started beside it would restart in a loop against it`;
      return own.why === "no unit of this command serves it"
        ? `custody for ${name} is already running in ${root}, and not from this command's unit ${label}: ${step}`
        : `custody for ${name} is already running in ${root}, and this command's unit ${label} is not what serves it (${own.why}): ${step}`;
    };
    // A complete identity may already be served by a custody someone started
    // by hand or under another supervisor. A unit started beside it would
    // restart in a loop (aw refuses a second server on a socket that answers),
    // while that other custody answered the readiness check.
    const known = state === "adopt" ? expectFields("aw whoami", readJson(["whoami", "--json"], "aw whoami", "preflight"), name, []) : undefined;
    if (known && manager) {
      const label = custodyLabel(known.address, name);
      let status;
      try { status = parseAwJson(read(["custody", "status", "--json"]), "aw custody status"); } catch { /* unreadable is not running here */ }
      if (status?.status === "running") {
        const problem = await notOurCustody(label, status);
        if (problem) throw failure("E_RESIDENT_CUSTODY_RUNNING", "preflight", problem);
      }
    }

    // A same-root unit under another label must not remain to load at login.
    // Before init no address is known, so no existing label is ours to adopt.
    if (manager) {
      const label = known ? custodyLabel(known.address, name) : undefined;
      const foreign = residentUnits(where, name).find((u) => u.label !== label);
      if (foreign) throw failure("E_RESIDENT_UNIT_CONFLICT", "preflight", foreignUnitMessage(foreign, root, where));
    }

    if (opts.plan) {
      const created = route?.kind === "root" ? "aw id create" : "aw init";
      const label = known ? custodyLabel(known.address, name) : `ai.aweb.custody.<domain of the returned address>.${name}`;
      return {
        outcome: "plan", name, root, state,
        ...(rejected ? { rejected } : {}),
        init: route?.kind === "key" ? { route: "key", argv: ["aw", ...INIT_ARGS(name)], cwd: root, awebUrl: awebUrl ?? "AWEB_URL from your dashboard line", env: ["PATH", "HOME", "AWEB_URL", "AWEB_API_KEY", "AW_NO_UPDATE_CHECK", ...(env.AWID_REGISTRY_URL ? ["AWID_REGISTRY_URL"] : [])] }
          : route?.kind === "root" ? { route: "root", argv: ["aw", ...CREATE_ARGS({ resident: root, owner: route.owner, org: route.org, teamId: route.teamId, name })], cwd: route.owner, authorityRoot: route.owner, authorityFrom: route.from, env: Object.keys(readEnv) }
          : null,
        verify: ["aw whoami --json", ...(route?.kind === "root" ? [`aw inbound-mode --json, which must read back ${RESIDENT_INBOUND.wire}`] : []), "aw doctor identity --offline --json", "aw doctor registry --online --json"].map((c) => `${c} (in ${root}, environment ${env.AWID_REGISTRY_URL ? "PATH, HOME and AWID_REGISTRY_URL" : "PATH and HOME"} only)`),
        custody: manager
          ? { manager, label, path: unitPath(where, known ? label : `ai.aweb.custody.<domain>.${name}`), runs: `${aw} custody serve`, workingDirectory: root, env: ["PATH", "HOME"] }
          : { manager: null, handStep: handStep(root, name) },
        record: `settings.oats.aweb.residents.${name}: ${root} in ${localYaml}`,
        teamLabel: opts.teamLabel
          ? `${opts.teamLabel} → the returned team, with oats teams add --no-default where the workspace allows local teams; it becomes the default team only where there is none`
          : `derived from the returned team's name after ${created}, mapped with oats teams add --no-default where the workspace allows local teams, and the default team only where there is none; if that label already maps to another team, the run stops there, after ${created}, with the identity, its custody and the residents setting in place, and names the --team-label rerun`,
      };
    }

    // ---- init: aw init with the key, or aw id create authorized by the team root
    let identity;
    if (route?.kind === "key") {
      let key = apiKey;
      apiKey = undefined;
      let scrub = scrubber([key, env.AWEB_API_KEY]);
      const childEnv = { PATH: env.PATH || "", HOME: env.HOME || "", AWEB_URL: env.AWEB_URL, AWEB_API_KEY: key, AW_NO_UPDATE_CHECK: "1", ...(env.AWID_REGISTRY_URL ? { AWID_REGISTRY_URL: env.AWID_REGISTRY_URL } : {}) };
      mkdirSync(root, { recursive: true, mode: 0o700 });
      const r = spawnSync(aw, INIT_ARGS(name), { cwd: root, env: childEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: INIT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
      // The key is held for this child only: aw's streams are scrubbed of it
      // here, before anything else reads them, and then it is dropped.
      const stdoutText = scrub(r.stdout || ""), stderrText = scrub(r.stderr || "");
      const written = writeCaptures(root, r, scrub);
      key = undefined; childEnv.AWEB_API_KEY = undefined; scrub = undefined;
      captures.push(...written.files);
      if (r.error || r.status !== 0) {
        let after;
        try { after = rootState(root).state; } catch { after = "other"; }
        const partial = join(root, ".aw", "partial-init.yaml");
        const awText = stderrText.trim() || stdoutText.trim() || `aw init ${written.exit}`;
        const details = { root, captures, partial: existsSync(partial) ? partial : null };
        if (!["continue", "rejected", "adopt"].includes(after)) {
          throw failure("E_RESIDENT_NOTHING_TO_CONTINUE", "init", `${awText}\nprovisioning left nothing to continue; ${root} contains ${readdirSync(root).sort().join(", ") || "nothing"}; contact aweb with ${captures[1]}`, details);
        }
        throw failure("E_RESIDENT_INIT", "init", awText, details);
      }
      let answer;
      try { answer = parseAwJson(stdoutText, "aw init"); }
      catch (e) { throw failure("E_RESIDENT_VERIFY", "verify", e.message, { root, captures }); }
      identity = checkInitAnswer(answer, name);
    } else if (route?.kind === "root") {
      mkdirSync(root, { recursive: true, mode: 0o700 });
      const r = spawnSync(aw, CREATE_ARGS({ resident: root, owner: route.owner, org: route.org, teamId: route.teamId, name }), { cwd: route.owner, env: readEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: INIT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
      if (r.error || r.status !== 0) {
        const exit = r.error ? `failed: ${r.error.code || r.error.message}` : r.signal ? `signal ${r.signal}` : `exit ${r.status}`;
        throw failure("E_RESIDENT_INIT", "init", String(r.stderr || "").trim() || String(r.stdout || "").trim() || `aw id create ${exit}`);
      }
      try { parseAwJson(r.stdout, "aw id create"); }
      catch (e) { throw failure("E_RESIDENT_VERIFY", "verify", e.message); }
      identity = expectFields("aw whoami", readJson(["whoami", "--json"], "aw whoami"), name, []);
      // aw reads the mode back too; a different answer here is a downgrade.
      const mode = readJson(["inbound-mode", "--json"], "aw inbound-mode")?.inbound_mode;
      if (mode !== RESIDENT_INBOUND.wire) throw failure("E_RESIDENT_VERIFY", "verify", `aw inbound-mode answered inbound_mode ${JSON.stringify(mode ?? null)}, not ${RESIDENT_INBOUND.wire} (requested with --inbound-mode ${RESIDENT_INBOUND.flag})`);
    } else {
      identity = known;
    }

    // ---- verify, with the key absent
    const doctor = identityDoctor(readJson(["doctor", "identity", "--offline", "--json"], "aw doctor identity --offline"), name);
    if (identity.team && identity.team !== doctor.team) throw failure("E_RESIDENT_VERIFY", "verify", `aw init answered team ${identity.team}, but the identity on disk is in ${doctor.team}`);
    const team = doctor.team;
    const warnings = registryWarnings(read);

    // ---- custody
    const label = custodyLabel(identity.address, name);
    const status = () => read(["custody", "status", "--json"]);
    let custody;
    let unsupported = manager ? undefined : `this host (${platform}) has no supported per-user service manager`;
    if (manager) {
      const conflict = residentUnits(where, name).find((u) => !u.root || !samePath(u.root, root));
      if (conflict) throw failure("E_RESIDENT_UNIT_CONFLICT", "custody", conflictMessage(conflict, root));
      const foreign = residentUnits(where, name).find((u) => u.label !== label);
      if (foreign) throw failure("E_RESIDENT_UNIT_CONFLICT", "custody", foreignUnitMessage(foreign, root, where));
      try {
        const unit = ensureCustodyUnit({ platform, label, aw, root, home: env.HOME || "", address: identity.address, uid: process.getuid(), env, xdgConfigHome: env.XDG_CONFIG_HOME });
        custody = { manager: unit.manager, label: unit.label, path: unit.path };
      } catch (e) {
        if (e.code !== "E_RESIDENT_UNIT_UNSUPPORTED") throw failure(e.code || "E_RESIDENT_UNIT", "custody", e.message);
        unsupported = e.message;
      }
    }
    // Ready means our unit's process is the server, not just that a custody answers.
    try { await waitForCustody({ status, resident: name, team, owner: custody ? (ready) => notOurCustody(label, ready) : undefined, timeoutMs: unsupported ? 0 : undefined }); }
    catch (e) {
      if (unsupported) throw failure("E_RESIDENT_UNIT_UNSUPPORTED", "custody", `${unsupported}: ${handStep(root, name)}`);
      throw failure(e.code === "E_RESIDENT_CUSTODY_RUNNING" ? e.code : "E_RESIDENT_CUSTODY", "custody", e.message);
    }
    custody = { status: "running", ...(custody || { manager: null, label: null, path: null }) };

    // ---- record
    if (recorded === undefined) {
      try { recordAwebSetting("residents", name, root, { start: deployment }); }
      catch (e) { throw failure("E_RESIDENT_RECORD", "record", e.message); }
    }
    const { teamLabel, other, defaultStep } = recordTeam(deployment, env, opts, team, { root, custody, localYaml });
    const outcome = state === "create" ? "created" : needsInit(state) ? "resumed" : recorded === undefined ? "adopted" : "already-exists";
    // A seat's grant is minted in the default team: with another default, making
    // this label the default is the operator's step, run first.
    const before = defaultStep ? [defaultStep] : [];
    return {
      outcome, name, root, address: identity.address, team, stableId: identity.stableId,
      custody, recorded: { file: localYaml, setting: `settings.oats.aweb.residents.${name}` },
      teamLabel,
      warnings, captures, next: NEXT(name), steps: [...before, SPAWN(name)],
      // The default step moves the whole deployment's default, not this seat's: say so.
      ...(other ? { stepsReason: `a seat's grant is minted in the deployment's default team, which is ${other.label} (${other.team}), not ${teamLabel.label}${before.length ? `. Running ${before[0]} moves the default team of the whole deployment: every later spawn of a soul without a default team of its own goes to ${teamLabel.label} (${team})` : `; making ${teamLabel.label} the default team is a change to oats-workspace.yaml (defaultTeam:), which this workspace commits`}` } : {}),
      ...(other ? { defaultTeam: { label: other.label, team: other.team } } : {}),
    };
  } catch (e) {
    if (e.stage) e.details = { root, ...(captures.length ? { captures } : {}), ...e.details };
    throw e;
  }
}

function renderText(r) {
  if (r.outcome === "plan") {
    const lines = [`Plan for resident ${r.name} in ${r.root} (${r.state}). Nothing was changed.`];
    if (r.rejected) lines.push(`  ${r.rejected} is quarantined signing material: init runs once and aw refuses it with its own reconciliation message.`);
    if (r.init?.route === "key") lines.push(`  init:    ${r.init.argv.join(" ")}  (in ${r.init.cwd}, against ${r.init.awebUrl}; environment ${r.init.env.join(", ")} only)`);
    if (r.init?.route === "root") lines.push(`  create:  ${r.init.argv.join(" ")}  (in ${r.init.cwd}, authorized by the team root ${r.init.authorityRoot} from ${r.init.authorityFrom}; environment ${r.init.env.join(", ")} only)`);
    for (const v of r.verify) lines.push(`  verify:  ${v}`);
    lines.push(r.custody.manager ? `  custody: ${r.custody.manager} unit ${r.custody.label} at ${r.custody.path}: ${r.custody.runs} in ${r.custody.workingDirectory}, environment PATH and HOME only` : `  custody: ${r.custody.handStep}`);
    lines.push(`  record:  ${r.record}`);
    lines.push(`  team label: ${r.teamLabel}`);
    return lines.join("\n") + "\n";
  }
  const how = { created: "", resumed: " (resumed)", adopted: " (adopted)", "already-exists": " (already exists)" }[r.outcome];
  const lines = [`PASS resident ${r.address} team ${r.team} custody running${how}`];
  for (const w of r.warnings) lines.push(`warning: ${w}`);
  if (r.custody.path) lines.push(`custody: ${r.custody.manager} unit ${r.custody.label} at ${r.custody.path}`);
  lines.push(`recorded: ${r.recorded.setting} in ${r.recorded.file}`);
  const t = r.teamLabel;
  if (t.status === "commit") lines.push(`team label: ${t.label}${t.derived ? " (derived from the team's name)" : ""}, to commit for ${t.team}:`);
  if (t.lines) lines.push(...t.lines);
  if (t.status !== "commit") lines.push(`team label: ${t.label}${t.derived ? " (derived from the team's name)" : ""} ${t.status === "added" ? "mapped to" : "already maps to"} ${t.team}`);
  if (t.default === "set") lines.push(`default team: ${t.label} (set: the deployment had none)`);
  if (t.default === "kept") lines.push(`default team: ${r.defaultTeam.label} (kept; not changed by this command)`);
  if (r.steps.length === 1 && r.stepsReason) lines.push(`Before spawning: ${r.stepsReason}.`);
  if (r.steps.length === 1) lines.push(`Next: ${r.next}`);
  else lines.push(`Next, in order (${r.stepsReason}):`, ...r.steps.map((step, i) => `  ${i + 1}. ${step}`));
  return lines.join("\n") + "\n";
}

/** The command's entrypoint: one JSON-v1 envelope with --json, else text.
 *  Exit 2 for a usage error, 1 for any other failure. Everything printed is
 *  scrubbed of AWEB_API_KEY's value as a last line of defence. */
export async function residentMain(argv, { env = process.env, platform = process.platform } = {}) {
  const json = argv.includes("--json");
  const scrub = scrubber([env.AWEB_API_KEY, String(env.AWEB_API_KEY ?? "").trim()]);
  const print = (fd, text) => writeSync(fd, scrub(text));
  try {
    const result = await createResident(parseResidentArgs(argv), { env, platform });
    print(1, json ? JSON.stringify({ schemaVersion: 1, ok: true, result }) + "\n" : renderText(result));
    return 0;
  } catch (e) {
    const known = typeof e.code === "string" && e.code.startsWith("E_RESIDENT_");
    const code = known ? e.code : "E_RESIDENT_FAILED", stage = e.stage || "unknown";
    const message = known ? e.message : `resident create failed: ${e.message || e}`;
    if (json) print(1, JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message, details: { stage, ...(e.details || {}) } } }) + "\n");
    else print(2, message === RESIDENT_USAGE ? `${message}\n` : `FAIL ${stage}: ${message}\n`);
    return stage === "arguments" ? 2 : 1;
  }
}
