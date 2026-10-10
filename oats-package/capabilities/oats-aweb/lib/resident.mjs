// `oats aweb resident create <name>`: provisions a GLOBAL resident identity in
// an existing hosted team from the dashboard's API key, serves it with a
// per-user custody unit, and records it as settings.oats.aweb.residents.<name>.
//
// The key is read from AWEB_API_KEY, or, with no key in the environment and a
// terminal, from a prompt that does not echo. It goes into the environment of
// one child only, `aw init`, whose environment is built from nothing, and it is
// scrubbed from everything written or printed. No flag takes a key.
//
// Stages, each with its own error codes: arguments, deployment, aw, preflight
// (no remote effect), key, init (one run, no retry), verify, custody, record.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync, writeSync } from "node:fs";
import { userInfo } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { awFloorMessage } from "./binding-wire.mjs";
import { parseAwJson } from "./grant-custody.mjs";
import { assertAwebSettingRecordable, recordAwebSetting } from "./local-settings.mjs";
import { selectedTeamKernel } from "./setup-team-default.mjs";
import { selectedDeployment } from "./team-roots.mjs";
import { conflictMessage, custodyLabel, ensureCustodyUnit, handStep, lingerProblem, residentUnits, unitManager, unitPath, waitForCustody } from "./custody-unit.mjs";

export const RESIDENT_USAGE = "usage: AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create <name> [--dir <deployment>] [--root <dir>] [--team-label <label>] [--plan] [--json]";
const ALIAS_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const ALIAS_RULE = "aweb aliases must be 1-64 characters, start with a letter or digit, and then contain only letters, digits, '-' or '_'";
const LABEL_RE = /^[a-z0-9][a-z0-9._-]*$/;
const INIT_ARGS = (name) => ["init", "--global", "--name", name, "--do-not-touch-agents-md", "--json"];
const INIT_TIMEOUT_MS = 300000;
const MAX_KEY_LENGTH = 4096; // aw's own limit for a workspace API key
/** The files a complete identity has in its .aw (aw init's certificate connect). */
const COMPLETE = ["identity.yaml", "signing.key", "workspace.yaml"];
const CAPTURE_DIR = ".oats-resident";

const failure = (code, stage, message, details = {}) => Object.assign(new Error(message), { code, stage, details });
const hostname = (s) => typeof s === "string" && s.length <= 253 && s.split(".").every((l) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(l));
const canonicalTeam = (s) => { const m = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127}):([^:]+)$/.exec(String(s ?? "")); return !!m && hostname(m[2]); };
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const samePath = (a, b) => { if (resolve(a) === resolve(b)) return true; try { return realpathSync(a) === realpathSync(b); } catch { return false; } };

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
    if (!["--dir", "--root", "--team-label", "--soul"].includes(flag)) throw usage();
    const value = inline.length ? inline.join("=") : rest[++i];
    if (!value || value.startsWith("--")) throw usage();
    if (flag === "--dir") opts.dir = value;
    if (flag === "--root") opts.root = value;
    if (flag === "--team-label") opts.teamLabel = value;
  }
  if (opts.name === undefined) throw usage();
  if (!ALIAS_RE.test(opts.name)) throw failure("E_RESIDENT_ARGUMENT", "arguments", `invalid resident name ${JSON.stringify(opts.name)}: ${ALIAS_RULE}`);
  if (opts.teamLabel !== undefined && !LABEL_RE.test(opts.teamLabel)) throw failure("E_RESIDENT_ARGUMENT", "arguments", `invalid --team-label ${JSON.stringify(opts.teamLabel)}: a team label is lowercase letters, digits, '.', '_' or '-', starting with a letter or digit`);
  return opts;
}

/** The first executable `cmd` on PATH, as an absolute path. */
function onPath(cmd, path) {
  for (const dir of String(path || "").split(delimiter)) {
    if (!dir) continue;
    try { const p = join(dir, cmd); const st = statSync(p); if (st.isFile() && (st.mode & 0o111)) return resolve(p); } catch { /* keep looking */ }
  }
  return undefined;
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

/** The key, from AWEB_API_KEY or a prompt that does not echo. */
async function readKey({ env, stdin, stderr, name }) {
  const fromEnv = typeof env.AWEB_API_KEY === "string" ? env.AWEB_API_KEY.trim() : "";
  const key = fromEnv || (stdin.isTTY && stderr.isTTY ? await promptHidden(stdin, stderr) : undefined);
  if (key === undefined) throw failure("E_RESIDENT_KEY", "key", `no AWEB_API_KEY in the environment and no terminal to ask for it on: run AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create ${name}`);
  if (!key) throw failure("E_RESIDENT_KEY", "key", "no API key was entered");
  if (key.length > MAX_KEY_LENGTH || /[\x00-\x1f\x7f]/.test(key)) throw failure("E_RESIDENT_KEY", "key", `the API key must be one line of at most ${MAX_KEY_LENGTH} characters`);
  return key;
}
/** Reads one line from the terminal in raw mode, echoing nothing. */
function promptHidden(stdin, stderr) {
  return new Promise((done, reject) => {
    let value = "";
    const finish = (error) => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write("\n");
      // Terminals in bracketed-paste mode wrap a paste in these markers.
      if (error) reject(error); else done(value.replace(/\x1b\[20[01]~/g, "").trim());
    };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === "\r" || ch === "\n") return finish();
        if (ch === "\u0003") return finish(failure("E_RESIDENT_KEY", "key", "cancelled"));
        if (ch === "\u0004") { if (!value) return finish(failure("E_RESIDENT_KEY", "key", "no API key was entered")); continue; }
        if (ch === "\u007f" || ch === "\b") { value = value.slice(0, -1); continue; }
        value += ch;
      }
    };
    // Echo goes off before the prompt shows, so nothing typed after it is echoed.
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.on("data", onData);
    stdin.resume();
    stderr.write("aweb API key (input hidden): ");
  });
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

const NEXT = (name) => `spawn a seat on this resident: give its soul the oats.aweb settings identity: { mode: global, resident: ${name} }, then oats spawn <soul>.`;
const commitLines = (label, team) => ["This workspace does not allow local teams; commit the team in oats-workspace.yaml:", "    teams:", `      ${JSON.stringify(label)}: { team: ${JSON.stringify(team)} }`];

/** Maps the team label to the resident's team through the selected kernel. */
function recordTeamLabel(deployment, env, label, team) {
  // The kernel child gets no aweb or awid variable, the key least of all.
  const kernelEnv = Object.fromEntries(Object.entries(env).filter(([k]) => !/^(AWEB_|AWID_)/.test(k)));
  const kernel = (() => { try { return selectedTeamKernel(deployment, kernelEnv); } catch (e) { throw failure("E_RESIDENT_TEAM_LABEL", "record", e.message); } })();
  const read = () => { try { return kernel.read(); } catch (e) { throw failure("E_RESIDENT_TEAM_LABEL", "record", e.message); } };
  const doc = read();
  const row = doc.teams.find((r) => r.label === label);
  if (row && row.team !== team) throw failure("E_RESIDENT_TEAM_LABEL", "record", `team label ${label} already maps to ${row.team ?? "no team"}, not ${team}; choose another --team-label`);
  if (row) return { label, team, status: "reused" };
  if (doc.localTeams === false) return { label, team, status: "commit", lines: commitLines(label, team) };
  try { kernel.add(label, team); } catch (e) { throw failure("E_RESIDENT_TEAM_LABEL", "record", e.message); }
  if (read().teams.find((r) => r.label === label)?.team !== team) throw failure("E_RESIDENT_TEAM_LABEL", "record", `oats teams add ${label} did not read back as ${team}`);
  return { label, team, status: "added" };
}

/** The whole command. Returns the result document; throws a staged failure. */
export async function createResident(opts, { env, stdin, stderr, platform }) {
  const { name } = opts;
  let deployment;
  try { deployment = selectedDeployment(env, opts.dir); }
  catch (e) { throw failure("E_RESIDENT_DEPLOYMENT", "deployment", e.message); }
  let settings;
  try { settings = JSON.parse(env.OATS_SETTINGS || "{}"); } catch { settings = {}; }
  const residents = object(settings) && object(settings.residents) ? settings.residents : {};
  const root = opts.root ? resolve(opts.root) : join(deployment, ".aweb-residents", name);
  const localYaml = join(deployment, "oats-local.yaml");
  const recorded = typeof residents[name] === "string" ? residents[name] : undefined;
  if (recorded !== undefined && !samePath(recorded, root)) throw failure("E_RESIDENT_ROOT", "preflight", `settings.oats.aweb.residents.${name} already records ${recorded}, not ${root}: pass --root ${recorded} to verify that resident, or choose another name`);

  // Every aw child but init runs with PATH and HOME only: no key, no identity selector.
  const readEnv = { PATH: env.PATH || "", HOME: env.HOME || "", AW_NO_UPDATE_CHECK: "1" };
  const floor = await awFloorMessage({ env: readEnv });
  if (floor) throw failure("E_RESIDENT_AW_FLOOR", "aw", floor);
  const aw = onPath("aw", env.PATH);
  if (!aw) throw failure("E_RESIDENT_AW_FLOOR", "aw", "aw is not on PATH");
  const read = (args) => {
    const r = spawnSync(aw, args, { cwd: root, env: readEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    if (r.status !== 0) throw new Error(`aw ${args.slice(0, 2).join(" ")} ${r.error ? `failed: ${r.error.code}` : `exited ${r.status}`}${r.stderr ? `: ${String(r.stderr).trim().slice(0, 300)}` : ""}`);
    return r.stdout;
  };
  const readJson = (args, what, stage = "verify") => {
    try { return parseAwJson(read(args), what); }
    catch (e) { throw failure("E_RESIDENT_VERIFY", stage, `${what}: ${e.message}`); }
  };

  // ---- preflight: nothing here has a remote effect
  const where = { platform, home: env.HOME || "", xdgConfigHome: env.XDG_CONFIG_HOME };
  const { state, rejected } = rootState(root);
  if (needsInit(state) && !(typeof env.AWEB_URL === "string" && env.AWEB_URL.trim())) throw failure("E_RESIDENT_ARGUMENT", "preflight", `AWEB_URL is not set: copy the dashboard line, AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb resident create ${name}`);
  const manager = unitManager(platform);
  if (manager) {
    const conflict = residentUnits(where, name).find((u) => !u.root || !samePath(u.root, root));
    if (conflict) throw failure("E_RESIDENT_UNIT_CONFLICT", "preflight", conflictMessage(conflict, root));
  }
  const linger = lingerProblem({ platform, user: userInfo().username, env });
  if (linger) throw failure("E_RESIDENT_LINGER", "preflight", linger);
  try { assertAwebSettingRecordable("residents", name, root, { start: deployment }); }
  catch (e) { throw failure("E_RESIDENT_RECORD", "preflight", e.message); }

  if (opts.plan) {
    const known = state === "adopt" ? expectFields("aw whoami", readJson(["whoami", "--json"], "aw whoami", "preflight"), name, []) : undefined;
    const label = known ? custodyLabel(known.address, name) : `ai.aweb.custody.<domain of the returned address>.${name}`;
    return {
      outcome: "plan", name, root, state,
      ...(rejected ? { rejected } : {}),
      init: needsInit(state) ? { argv: ["aw", ...INIT_ARGS(name)], cwd: root, env: ["PATH", "HOME", "AWEB_URL", "AWEB_API_KEY", "AW_NO_UPDATE_CHECK", ...(env.AWID_REGISTRY_URL ? ["AWID_REGISTRY_URL"] : [])] } : null,
      verify: ["aw whoami --json", "aw doctor identity --offline --json", "aw doctor registry --online --json"].map((c) => `${c} (in ${root}, environment PATH and HOME only)`),
      custody: manager
        ? { manager, label, path: unitPath(where, known ? label : `ai.aweb.custody.<domain>.${name}`), runs: `${aw} custody serve`, workingDirectory: root, env: ["PATH", "HOME"] }
        : { manager: null, handStep: handStep(root, name) },
      record: `settings.oats.aweb.residents.${name}: ${root} in ${localYaml}`,
      ...(opts.teamLabel ? { teamLabel: `${opts.teamLabel} → the returned team, with oats teams add where the workspace allows local teams` } : {}),
    };
  }

  // ---- key and init
  let identity, captures = [];
  if (needsInit(state)) {
    let key = await readKey({ env, stdin, stderr, name });
    let scrub = scrubber([key, env.AWEB_API_KEY]);
    const childEnv = { PATH: env.PATH || "", HOME: env.HOME || "", AWEB_URL: env.AWEB_URL, AWEB_API_KEY: key, AW_NO_UPDATE_CHECK: "1", ...(env.AWID_REGISTRY_URL ? { AWID_REGISTRY_URL: env.AWID_REGISTRY_URL } : {}) };
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const r = spawnSync(aw, INIT_ARGS(name), { cwd: root, env: childEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: INIT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
    // The key is held for this child only: aw's streams are scrubbed of it
    // here, before anything else reads them, and then it is dropped.
    const stdoutText = scrub(r.stdout || ""), stderrText = scrub(r.stderr || "");
    const written = writeCaptures(root, r, scrub);
    key = undefined; childEnv.AWEB_API_KEY = undefined; scrub = undefined;
    captures = written.files;
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
    identity = expectFields("aw init", answer, name, ["status", "team_id"]);
  } else {
    identity = expectFields("aw whoami", readJson(["whoami", "--json"], "aw whoami"), name, []);
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
    try {
      const unit = ensureCustodyUnit({ platform, label, aw, root, home: env.HOME || "", address: identity.address, uid: process.getuid(), env, xdgConfigHome: env.XDG_CONFIG_HOME });
      custody = { manager: unit.manager, label: unit.label, path: unit.path };
    } catch (e) {
      if (e.code !== "E_RESIDENT_UNIT_UNSUPPORTED") throw failure(e.code || "E_RESIDENT_UNIT", "custody", e.message);
      unsupported = e.message;
    }
  }
  try { await waitForCustody({ status, resident: name, team, timeoutMs: unsupported ? 0 : undefined }); }
  catch (e) {
    if (unsupported) throw failure("E_RESIDENT_UNIT_UNSUPPORTED", "custody", `${unsupported}: ${handStep(root, name)}`);
    throw failure("E_RESIDENT_CUSTODY", "custody", e.message);
  }
  custody = { status: "running", ...(custody || { manager: null, label: null, path: null }) };

  // ---- record
  if (recorded === undefined) {
    try { recordAwebSetting("residents", name, root, { start: deployment }); }
    catch (e) { throw failure("E_RESIDENT_RECORD", "record", e.message); }
  }
  const teamLabel = opts.teamLabel ? recordTeamLabel(deployment, env, opts.teamLabel, team) : undefined;
  const outcome = state === "create" ? "created" : needsInit(state) ? "resumed" : recorded === undefined ? "adopted" : "already-exists";
  return {
    outcome, name, root, address: identity.address, team, stableId: identity.stableId,
    custody, recorded: { file: localYaml, setting: `settings.oats.aweb.residents.${name}` },
    ...(teamLabel ? { teamLabel } : {}),
    warnings, captures, next: NEXT(name),
  };
}

function renderText(r) {
  if (r.outcome === "plan") {
    const lines = [`Plan for resident ${r.name} in ${r.root} (${r.state}). Nothing was changed.`];
    if (r.rejected) lines.push(`  ${r.rejected} is quarantined signing material: init runs once and aw refuses it with its own reconciliation message.`);
    if (r.init) lines.push(`  init:    ${r.init.argv.join(" ")}  (in ${r.init.cwd}; environment ${r.init.env.join(", ")} only)`);
    for (const v of r.verify) lines.push(`  verify:  ${v}`);
    lines.push(r.custody.manager ? `  custody: ${r.custody.manager} unit ${r.custody.label} at ${r.custody.path}: ${r.custody.runs} in ${r.custody.workingDirectory}, environment PATH and HOME only` : `  custody: ${r.custody.handStep}`);
    lines.push(`  record:  ${r.record}`);
    if (r.teamLabel) lines.push(`  team label: ${r.teamLabel}`);
    return lines.join("\n") + "\n";
  }
  const how = { created: "", resumed: " (resumed)", adopted: " (adopted)", "already-exists": " (already exists)" }[r.outcome];
  const lines = [`PASS resident ${r.address} team ${r.team} custody running${how}`];
  for (const w of r.warnings) lines.push(`warning: ${w}`);
  if (r.custody.path) lines.push(`custody: ${r.custody.manager} unit ${r.custody.label} at ${r.custody.path}`);
  lines.push(`recorded: ${r.recorded.setting} in ${r.recorded.file}`);
  if (r.teamLabel?.status === "commit") lines.push(...r.teamLabel.lines);
  else if (r.teamLabel) lines.push(`team label: ${r.teamLabel.label} ${r.teamLabel.status === "added" ? "mapped to" : "already maps to"} ${r.teamLabel.team}`);
  lines.push(`Next: ${r.next}`);
  return lines.join("\n") + "\n";
}

/** The command's entrypoint: one JSON-v1 envelope with --json, else text.
 *  Exit 2 for a usage error, 1 for any other failure. Everything printed is
 *  scrubbed of AWEB_API_KEY's value as a last line of defence. */
export async function residentMain(argv, { env = process.env, stdin = process.stdin, stderr = process.stderr, platform = process.platform } = {}) {
  const json = argv.includes("--json");
  const scrub = scrubber([env.AWEB_API_KEY, String(env.AWEB_API_KEY ?? "").trim()]);
  const print = (fd, text) => writeSync(fd, scrub(text));
  try {
    const result = await createResident(parseResidentArgs(argv), { env, stdin, stderr, platform });
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
