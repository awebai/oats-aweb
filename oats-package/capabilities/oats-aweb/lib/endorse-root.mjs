// `oats aweb setup --endorse-root` (spec human-ids-acxy7 v4.3.14 C-2): the
// deployment's root, its endorsement by the human through one approved link,
// and settings.oats.aweb.attribution, written last. The person's only act is
// approving the link; the service operator's is binding the root (step 2b).
// Setup makes no protected HTTP call itself: every effect is one aw command
// (protected-client.mjs), and OATS never parses aw's text.
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, normalize, resolve } from "node:path";
import { policyMissingText } from "./admission.mjs";
import { CONTAINER_DEPLOYMENT, KERNEL_FLOOR, ROOT_DIR, SPAWN_ATTRIBUTION_FEATURE, attributionError, attributionSetting, chainRefusal, profileDigest, profileProblem, readWho, rootHomeProblem, validLabel } from "./attribution.mjs";
import { PROTECTED_AW_MIN, REQUEST_BINDING_SERVED, AwRefusal, admissionPolicyArgv, awJson, createNoAddressArgv, endorseArgv } from "./protected-client.mjs";
import { canonicalTeamServerURL } from "./team-server-url.mjs";

export const ENDORSE_USAGE = "usage: oats aweb setup --endorse-root (--new-root --name <alias> | --root-home <abs>) --human <did:aw> --protected-profile <abs> --service <url> [--label \"<name>\"] [--teams <label,…>] [--json]";
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const DID_AW = /^did:aw:\S+$/;
const OPERATION_FILE = "endorse-operation.json";
/** aw waits for the receipt at most 600 s; setup gives it a minute more. */
const WAIT_MS = 660000;

const argumentError = (message) => attributionError("E_SETUP_ARGUMENT", `${message}\n${ENDORSE_USAGE}`, { stage: "arguments" });

/** The command line, checked before any effect. Throws E_SETUP_ARGUMENT. */
export function parseEndorseArgs(argv) {
  const o = { newRoot: false, teams: undefined };
  const value = (flag, i) => { if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw argumentError(`${flag} needs a value`); return argv[i + 1]; };
  const FLAGS = { "--name": "name", "--root-home": "rootHome", "--human": "human", "--protected-profile": "profile", "--service": "service", "--label": "label", "--teams": "teams" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--endorse-root" || arg === "--json") continue;
    if (arg === "--new-root") { o.newRoot = true; continue; }
    const eq = arg.indexOf("=");
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    if (!FLAGS[flag]) throw argumentError(`--endorse-root doesn't take ${arg}`);
    if (o[FLAGS[flag]] !== undefined) throw argumentError(`${flag} is given twice`);
    if (eq > 0) o[FLAGS[flag]] = arg.slice(eq + 1);
    else { o[FLAGS[flag]] = value(flag, i); i++; }
  }
  if (o.newRoot && o.rootHome !== undefined) throw argumentError("--new-root and --root-home name two roots; a deployment has one");
  if (o.newRoot && !ALIAS.test(o.name ?? "")) throw argumentError(`--new-root needs --name <alias>: 1-64 letters, digits, '-' or '_', starting with a letter or digit`);
  if (!o.newRoot && o.name !== undefined) throw argumentError("--name goes with --new-root");
  if (o.rootHome !== undefined && !isAbsolute(o.rootHome)) throw argumentError("--root-home must be an absolute path");
  if (!DID_AW.test(o.human ?? "")) throw argumentError("--human must be the human's did:aw");
  if (!o.profile || !isAbsolute(o.profile)) throw argumentError("--protected-profile must be the absolute path of the service's protected profile");
  // Refused, never rewritten (v4.3.25): after a symlinked directory, `..` names another file
  // than its lexical form does. Spawn's reader takes only this form.
  if (normalize(o.profile) !== o.profile || o.profile.endsWith("/") || o.profile.includes("\0")) throw attributionError("E_ATTRIBUTION_SETTING", `--protected-profile ${o.profile} isn't a normalized path → pass the profile's path with no \`.\` or \`..\` segment and no repeated \`/\``, { key: "--protected-profile", problem: "profile-path" });
  const service = canonicalTeamServerURL(o.service);
  if (!service.url) throw argumentError(`--service <url>, the aweb service the protected teams use, ${service.reason}`);
  o.service = service.url;
  if (o.label !== undefined && !validLabel(o.label)) throw argumentError("--label must be one line of 1-200 characters with no control, line-break or bidi character");
  if (o.teams !== undefined) {
    o.teams = o.teams.split(",").map((s) => s.trim()).filter(Boolean);
    if (!o.teams.length) throw argumentError("--teams needs at least one team label");
  }
  return o;
}

/** What opting in means, in the endorse output and the README (test 21). */
export const OPT_IN = Object.freeze([
  "Custody: the root's agent key is readable by every instance of this deployment (the same OS user), within its bounds: it can admit agents only within this root's own admission bounds.",
  "Outages: spawns into the protected teams stop while the protected service's or the identity registry's evidence is unavailable.",
  "Existing instances keep their identities, unattributed: respawn to attribute them.",
  "One approval: the human approves this root once, at its link; later spawns need no approval.",
  "Revocation: if the human revokes this root, new spawns refuse E_ATTRIBUTION_REVOKED; the path out is in the README, \"Human attribution: revocation\".",
  "BYOT: a deployment whose user can reach team or controller keys (~/.awid/team-keys, ~/.awid/controllers), which today is every existing BYOT deployment, can't opt in until aweb's package 8 migrates those keys; that's a known precondition, not a bug.",
  "Residents: opting in means no new residents until aweb's custody update lands (aweb-acxy.18): resident create and resident certify refuse here; existing residents are unchanged.",
  "Membership doesn't imply attribution: a genuinely chainless spawner's child is still admitted by the root, but carries no chain.",
]);

/** The deployment label aw shows the human on the approval page (v4.3.13): derived, never a flag. */
export const deploymentLabel = (host, deployment) => { const short = String(host || "").split(".")[0]; return short ? `${short}:${basename(deployment)}` : basename(deployment); };

// C-9's endorse column: aw's code → OATS's refusal. Only the codes listed here refuse or
// fail: any other code, or none, leaves the outcome unknown and the operation kept, so the
// rerun resumes it (v4.3.24).
const SCOPE = new Set(["scope_refused", "profile_scope_refused", "profile_scope_ambiguous"]);
const REGISTER = new Set(["registration_conflict", "human_chain_unverified", "signed_certificate_invalid"]);
const REFUSED = new Set(["subject_ineligible", "human_refused", "operation_expired", "approval_expired"]);

/** The operator's binding step, as setup prints it (step 2b). */
export function bindingStep({ root, human, teams }) {
  const bind = `python -m aweb.protected_signing.operator bind-root --human ${human} --root ${root}${teams.map((t) => ` --team ${t}`).join("")}`;
  return REQUEST_BINDING_SERVED
    ? `the protected service's operator binds this root as a requester: ${bind}`
    : `the protected service's operator binds this root as a requester: the first root on a service is named in its \`operator bootstrap --requester ${root}\`, once per binding (the human's, for endorse, and each team's controller); a later root needs bind-root, which the pinned aw and service don't serve yet`;
}

/** The root's operation record (step 3): {operationId, deploymentLabel, at}, or null. */
const operationPath = (rootHome) => join(rootHome, OPERATION_FILE);
function readOperation(rootHome) {
  try {
    const doc = JSON.parse(readFileSync(operationPath(rootHome), "utf8"));
    return typeof doc?.operationId === "string" && typeof doc.deploymentLabel === "string" ? doc : null;
  } catch { return null; }
}

/**
 * Runs `setup --endorse-root`. `ctx`:
 * - `aw(argv, cwd, timeoutMs)`: runs aw, returns stdout or throws aw's failure;
 * - `kernel()`: the kernel's `--version --json` document, or undefined;
 * - `awVersion`: the selected aw's version;
 * - `deployment`: D, or throws its error;
 * - `teams`: {default: {label, team} | null, mapped: [{label, team}]}, every team D maps;
 * - `live`: settings.oats.aweb.attribution as the deployment has it now, or undefined;
 * - `scan()`: the A5 scan, {findings, unknown};
 * - `record(setting)`: writes the setting into D's oats-local.yaml;
 * - `host`: this host's name; `print(text)`: terminal output, absent under --json;
 * - `optIn`: the lines the endorse output carries (test 21).
 * Returns the result, or throws an attributionError.
 */
export function endorseRoot(o, ctx) {
  const D = ctx.deployment;
  // A deployment has one root, and a rerun after success is the refresh.
  if (ctx.live) return refresh(o, ctx);
  // 1. Preflight, before any effect.
  clientPreflight(ctx);
  if (!o.newRoot && o.rootHome === undefined) {
    const dir = join(D, ROOT_DIR);
    let candidates = [];
    try { candidates = readdirSync(dir).map((n) => join(dir, n)).filter((h) => existsSync(join(h, ".aw", "signing.key"))); } catch { candidates = []; }
    throw argumentError(`choose the root: ${candidates.length ? `${candidates.map((h) => `--root-home ${h}`).join(", ")}, or ` : ""}--new-root --name <alias> for a new one; setup never picks one`);
  }
  const rootHome = o.newRoot ? join(D, ROOT_DIR, o.name) : resolve(o.rootHome);
  const fresh = o.newRoot && !existsSync(rootHome);
  if (fresh) {
    // The home doesn't exist yet: the container and placement rules from D, before creating it.
    if (resolve(D) === CONTAINER_DEPLOYMENT || resolve(D).startsWith(`${CONTAINER_DEPLOYMENT}/`)) throw rootHomeProblem(rootHome, { deployment: D });
    // The anchor the home is made under, if it exists, is a plain directory of D's own: a link
    // could put the key anywhere, a Git work tree included.
    const anchor = join(D, ROOT_DIR);
    let anchorStat = null;
    try { anchorStat = lstatSync(anchor); } catch { anchorStat = null; }
    if (anchorStat && (anchorStat.isSymbolicLink() || !anchorStat.isDirectory())) throw attributionError("E_ATTRIBUTION_ROOT_HOME", `${anchor} is ${anchorStat.isSymbolicLink() ? "a symbolic link" : "not a directory"}, so the root home ${rootHome} wouldn't be the deployment's own → make it a plain directory of the deployment`, { problem: "placement", home: rootHome });
    if (anchorStat && (existsSync(join(anchor, ".git")) || existsSync(join(anchor, "instance.json")))) throw attributionError("E_ATTRIBUTION_ROOT_HOME", `${anchor} is a Git work tree or an instance home, where the root's key could be committed or taken → make it a plain directory of the deployment`, { problem: "placement", home: rootHome });
    // D's real path: a deployment reached through a link is placed where the link points.
    let real = resolve(D);
    try { real = realpathSync(D); } catch { real = resolve(D); }
    for (let dir = real; ; dir = resolve(dir, "..")) {
      if (existsSync(join(dir, ".git"))) throw attributionError("E_ATTRIBUTION_ROOT_HOME", `the root home ${rootHome} would be inside a Git work tree (${dir}), where its key could be committed → move the deployment out of any work tree`, { problem: "placement", home: rootHome });
      if (existsSync(join(dir, "instance.json"))) throw attributionError("E_ATTRIBUTION_ROOT_HOME", `the root home ${rootHome} would be under an instance home (${dir}) → run setup in the deployment itself`, { problem: "placement", home: rootHome });
      if (resolve(dir, "..") === dir) break;
    }
  } else {
    const problem = rootHomeProblem(rootHome, { deployment: D });
    if (problem) throw problem;
  }
  const profileKey = "--protected-profile";
  const bad = profileProblem(o.profile, { key: profileKey });
  if (bad) throw bad;
  const digest = profileDigest(o.profile);
  let profile;
  try { profile = JSON.parse(readFileSync(o.profile, "utf8")); } catch { profile = null; }
  if (typeof profile?.registry_origin !== "string" || typeof profile?.service_id !== "string") throw attributionError("E_ATTRIBUTION_SETTING", `the protected profile ${o.profile} names no service id or registry origin → have the service's operator provision it again`, { key: profileKey, problem: "profile-mode", file: o.profile });
  keyPreflight(ctx, profile.service_id);
  const mapped = [...(ctx.teams.default ? [ctx.teams.default] : []), ...ctx.teams.mapped.filter((t) => t.team !== ctx.teams.default?.team)];
  let teams;
  if (o.teams) {
    teams = o.teams.map((label) => {
      const row = mapped.find((t) => t.label === label);
      if (!row) throw argumentError(`--teams names ${label}, which this deployment doesn't map (it maps ${mapped.map((t) => t.label).join(", ") || "no team"})`);
      return row.team;
    });
  } else teams = ctx.teams.default ? [ctx.teams.default.team] : [];
  if (!teams.length) throw argumentError("this deployment maps no default team, so --teams must name the protected teams");
  const unlisted = mapped.filter((t) => !teams.includes(t.team));
  if (unlisted.length) throw attributionError("E_ENDORSE_POLICY", `this deployment maps ${unlisted.map((t) => `${t.label} (${t.team})`).join(", ")}, which the endorsement wouldn't cover; an opted-in deployment admits only through its protected teams → add ${unlisted.length > 1 ? "them" : "it"} to --teams, or remove the mapping`, { problem: "unlisted", teams: unlisted.map((t) => t.team) });
  teams = [...new Set(teams)];

  // 2. The root.
  const identityHome = join(rootHome, ".aw");
  const run = (argv, timeout = 60000) => awJson(ctx.aw, argv.filter((a) => a !== "--json").slice(0, 3).join(" "), argv, rootHome, timeout);
  let rootId, created = "existing";
  if (o.newRoot) {
    mkdirSync(join(D, ROOT_DIR), { recursive: true, mode: 0o700 });
    mkdirSync(rootHome, { recursive: true, mode: 0o700 });
    chmodSync(rootHome, 0o700);
    try {
      const made = run(createNoAddressArgv({ identityHome, registry: profile.registry_origin }));
      rootId = made.did_aw; created = made.status;
    } catch (e) {
      if (!(e instanceof AwRefusal) || e.awCode !== "identity_exists") throw attributionError("E_ENDORSE_FAILED", `the root's identity couldn't be created (${e.awCode || oneLine(e.message)}) → rerun the same setup, which resumes the same key`, { step: "create", code: e.awCode ?? null });
      rootId = registeredId(identityHome);
      if (!rootId) throw attributionError("E_ATTRIBUTION_ROOT_HOME", `${identityHome} already holds an identity that isn't a registered root → choose another --name, or use --root-home for a registered agent`, { problem: "placement", home: rootHome });
    }
    const problem = rootHomeProblem(rootHome, { deployment: D });
    if (problem) throw problem;
  } else {
    const verdict = readWho((args) => ctx.aw(["aw", ...args], rootHome, 60000), identityHome);
    rootId = registeredId(identityHome);
    if (!rootId || !DID_AW.test(verdict.id || rootId) || verdict.kind === "revoked" || verdict.kind === "invalid" || verdict.kind === "error") throw attributionError("E_ENDORSE_ROOT_INELIGIBLE", `the identity at ${identityHome} can't be this deployment's root (${rootId ? verdict.reason || verdict.kind : "it is a local did:key, not a registered agent"}) → use --new-root --name <alias> for a new registered root`, { home: rootHome, reason: rootId ? verdict.reason || verdict.kind : "local" });
  }
  if (!DID_AW.test(rootId || "")) throw attributionError("E_ENDORSE_FAILED", `aw answered no did:aw for the root at ${identityHome} → rerun the same setup`, { step: "register" });
  const binding = { root: rootId, human: o.human, teams };

  // 3. The operation id and the deployment label, recorded before prepare.
  let operation = readOperation(rootHome);
  if (!operation) {
    operation = { operationId: randomUUID(), deploymentLabel: deploymentLabel(ctx.host, D), at: new Date().toISOString() };
    ctx.writePrivate(operationPath(rootHome), `${JSON.stringify(operation, null, 2)}\n`);
  }
  const spend = () => rmSync(operationPath(rootHome), { force: true });

  // 4-6. Prepare, check and approve, in one aw call; the link.
  const endorse = (wait) => {
    try { return run(endorseArgv({ human: o.human, teams, label: operation.deploymentLabel, operationId: operation.operationId, profile: o.profile, wait }), wait ? WAIT_MS : 120000); }
    catch (e) { throw endorseRefusal(e, { binding, operationId: operation.operationId, spend, legacy: () => legacyTeams(run, teams, o.profile) }); }
  };
  let answer = endorse(false);
  if (answer?.state === "pending") {
    const bounds = Object.fromEntries(teams.map((team) => [team, policyOf(run, team, o.profile)?.bounds ?? null]));
    const pending = { state: "pending", operationId: operation.operationId, url: answer.page, digest: answer.digest, fingerprint: answer.fingerprint, expiresAt: answer.expires_at, teams, bounds };
    if (!ctx.print) throw attributionError("E_ENDORSE_NOT_APPROVED", `the endorsement waits for ${o.human}'s approval → open ${answer.page} as the human, then rerun the same setup`, pending);
    ctx.print(linkText({ pending, human: o.human, root: rootId, optIn: ctx.optIn }));
    answer = endorse(true);
    if (answer?.state === "pending") throw attributionError("E_ENDORSE_NOT_APPROVED", `the endorsement is still waiting for approval, until ${answer.expires_at || pending.expiresAt} → approve at ${pending.url}, then rerun the same setup, which resumes it`, { ...pending, expiresAt: answer.expires_at || pending.expiresAt });
  }
  if (answer?.state !== "committed" || answer.registered !== true) throw attributionError("E_ENDORSE_NOT_APPROVED", `aw answered the endorsement ${answer?.state ?? "with nothing"} (operation ${operation.operationId}) → rerun the same setup, which reads the same receipt`, { state: "unknown", operationId: operation.operationId });

  // 7. Committed: the chain aw installed (v4.3.15), the policy, then the setting, last.
  if (answer.chain_installed !== true) throw attributionError("E_ENDORSE_FAILED", `the root's endorsement committed (certificate ${answer.certificate_id ?? "unnamed"}), but aw didn't install its chain in ${identityHome}, so the root can't issue → rerun setup, which installs it`, { step: "install", operationId: operation.operationId });
  const who = readWho((args) => ctx.aw(["aw", ...args], rootHome, 60000), identityHome);
  if (who.kind !== "verified" || who.humanId !== o.human) throw attributionError("E_ENDORSE_FAILED", `the root's endorsement committed, but aw who doesn't show ${o.human} as its nearest human (${who.humanId ?? who.reason ?? who.kind}) → rerun the same setup`, { step: "install", reason: who.reason ?? who.kind });
  const policies = teams.map((team) => policyOf(run, team, o.profile, { required: true }));
  const policy = { version: policies[0].version, digest: policies[0].digest };
  if (policies.some((p) => p.version !== policy.version || p.digest !== policy.digest)) throw attributionError("E_ENDORSE_POLICY", `the teams' admission policies differ (${teams.join(", ")}), so one endorsement can't record them → have the service's operator check the deployment's admission policy`, { problem: "changed" });
  const setting = {
    root: { id: rootId, home: rootHome }, human: { id: o.human, label: o.label ?? o.human },
    service: { id: profile.service_id, profile: o.profile, profileDigest: digest, url: o.service },
    teams, endorsement: { operationId: operation.operationId, policy },
  };
  // The setting is read back with spawn's own reader first: setup never writes one spawn refuses.
  attributionSetting({ attribution: setting });
  try { ctx.record(setting); }
  catch (e) { throw attributionError("E_ENDORSE_FAILED", `the root is endorsed, but the setting couldn't be written: ${oneLine(e.message)} → rerun the same setup, which records it`, { step: "record" }); }
  spend();
  return { state: "committed", root: { id: rootId, home: rootHome, created }, human: setting.human, teams, certificateId: answer.certificate_id, endorsement: setting.endorsement };
}

/** The kernel's feature and the protected-client floor (step 1). */
function clientPreflight(ctx) {
  const version = ctx.kernel();
  if (!Array.isArray(version?.features) || !version.features.includes(SPAWN_ATTRIBUTION_FEATURE)) throw attributionError("E_SETUP_KERNEL", `attribution needs an OATS kernel that lists ${SPAWN_ATTRIBUTION_FEATURE} (OATS ${KERNEL_FLOOR} or later); this one doesn't → upgrade OATS`);
  if (!ctx.versionAtLeast(ctx.awVersion, PROTECTED_AW_MIN)) throw attributionError("E_SETUP_AW_VERSION", `attribution needs aw ${PROTECTED_AW_MIN} or later, the protected-client floor; this host has ${ctx.awVersion || "an unreadable aw"} → upgrade aw`);
}

/** The A5 scan (C-5): a finding refuses, and nothing is changed. */
function keyPreflight(ctx, service) {
  const scan = ctx.scan({ service });
  if (scan.findings.length) throw attributionError("E_PROTECTED_KEY_REACHABLE", `this host's user can reach ${scan.findings.length} protected key location${scan.findings.length > 1 ? "s" : ""} (${scan.findings.slice(0, 3).map((f) => f.reference).join(", ")}${scan.findings.length > 3 ? ", …" : ""}), which an opted-in deployment must not → migrate them with aweb's package 8 (aweb-acxy.8), then rerun setup; nothing was changed`, { findings: scan.findings, unknown: scan.unknown });
}

/** Every team D maps, its default first. */
const mappedTeams = (ctx) => [...(ctx.teams.default ? [ctx.teams.default] : []), ...ctx.teams.mapped.filter((t) => t.team !== ctx.teams.default?.team)];

/**
 * The rerun with a root recorded (step 8, Edge cases): it prepares nothing.
 * It checks the root is still endorsed, reads each recorded and each newly
 * mapped team's policy as the root, and then, all or nothing, rewrites the
 * policy, adds the newly mapped teams the policy lists, and takes a new
 * --service URL or a re-provisioned profile's digest, in one write.
 */
function refresh(o, ctx) {
  const live = ctx.live, D = ctx.deployment;
  const rootHome = live.root.home;
  const asked = o.newRoot ? join(D, ROOT_DIR, o.name) : o.rootHome && resolve(o.rootHome);
  if (asked && resolve(asked) !== resolve(rootHome)) throw attributionError("E_ENDORSE_ONE_ROOT", `this deployment already records the root ${live.root.id} at ${rootHome}; a deployment has one root → rerun with --root-home ${rootHome}, or follow the README's "Human attribution: revocation" to replace it`, { root: live.root.id, home: rootHome });
  if (o.human !== live.human.id) throw argumentError(`this deployment's root is endorsed by ${live.human.id}, not ${o.human}; a rerun names the same human`);
  if (resolve(o.profile) !== resolve(live.service.profile)) throw argumentError(`this deployment records the protected profile ${live.service.profile}; a rerun names the same file`);
  clientPreflight(ctx);
  const homeProblem = rootHomeProblem(rootHome, { deployment: D });
  if (homeProblem) throw homeProblem;
  const bad = profileProblem(o.profile, { key: "--protected-profile" });
  if (bad) throw bad;
  const digest = profileDigest(o.profile);
  keyPreflight(ctx, live.service.id);
  const who = readWho((args) => ctx.aw(["aw", ...args], rootHome, 60000), join(rootHome, ".aw"));
  if (who.kind !== "verified") throw chainRefusal(who, { who: "the endorsed root", step: "issuer" });
  if (who.humanId !== live.human.id) throw chainRefusal({ kind: "revoked", reason: "another_human" }, { who: "the endorsed root", step: "issuer" });

  const run = (argv) => awJson(ctx.aw, "id team admission-policy", argv, rootHome, 60000);
  /** One team's policy as the root: {policy}, or {problem}; an unavailable read throws, so nothing changes. */
  const read = (team) => {
    let doc;
    try { doc = run(admissionPolicyArgv({ team, profile: o.profile })); }
    catch (e) {
      if (!(e instanceof AwRefusal)) throw attributionError("E_ATTRIBUTION_EVIDENCE", `${team}'s admission policy couldn't be read (${oneLine(e.message)}); nothing was changed → retry setup`, { team });
      if (e.awCode === "admission_policy_missing") return { problem: "unlisted" };
      if (SCOPE.has(e.awCode)) return { problem: "requester-unbound" };
      if (!e.awCode || /_unavailable$|_unresolved$|_unconfirmed$/.test(e.awCode)) throw attributionError("E_ATTRIBUTION_EVIDENCE", `${team}'s admission policy couldn't be read (${e.awCode || "no answer"}); nothing was changed → retry setup once the protected service answers`, { team, code: e.awCode ?? null });
      throw attributionError("E_ENDORSE_FAILED", `${team}'s admission policy read was refused (${e.awCode}); nothing was changed → rerun setup`, { step: "prepare", team, code: e.awCode });
    }
    return doc?.mode === "protected" && doc.policy ? { policy: doc.policy } : { problem: "unlisted" };
  };
  const recorded = live.teams.map((team) => ({ team, ...read(team) }));
  const added = mappedTeams(ctx).map((t) => t.team).filter((team) => !live.teams.includes(team)).map((team) => ({ team, ...read(team) }));
  const current = recorded.find((r) => r.policy)?.policy ?? added.find((r) => r.policy)?.policy;
  const policyChanged = !!current && (current.version !== live.endorsement.policy.version || current.digest !== live.endorsement.policy.digest);
  const failures = [...recorded, ...added].filter((r) => r.problem).map(({ team, problem }) => ({ team, problem }));
  if (failures.length) {
    const unbound = failures.filter((f) => f.problem === "requester-unbound");
    const why = failures.map((f) => f.problem === "unlisted"
      ? `${f.team}: ${policyMissingText(f.team, live.root.id)}`
      : `${f.team}: this root isn't bound for its controller → ${bindingStep({ root: live.root.id, human: live.human.id, teams: [f.team] })}`).join(" ");
    const skipped = policyChanged ? ` The policy rewrite was skipped too, so spawns into the recorded teams keep refusing policy_changed until this is fixed.` : "";
    const message = `${why} Nothing was written, the listed teams included.${skipped} The ways out: 1. bind the team (for requester-unbound), or remove its mapping (\`oats teams …\`; for unlisted, the only way in v1); 2. then rerun \`oats aweb setup --endorse-root\`.`;
    if (unbound.length) throw attributionError("E_ENDORSE_FAILED", message, { step: "prepare", problem: "requester-unbound", teams: failures, bind: { root: live.root.id, human: live.human.id, teams: unbound.map((f) => f.team) } });
    throw attributionError("E_ENDORSE_POLICY", message, { problem: "unlisted", teams: failures });
  }
  const next = {
    ...live,
    service: { ...live.service, url: o.service, profileDigest: digest },
    teams: [...live.teams, ...added.map((a) => a.team)],
    endorsement: { ...live.endorsement, policy: policyChanged ? { version: current.version, digest: current.digest } : live.endorsement.policy },
  };
  const refreshed = { policy: policyChanged, teams: added.map((a) => a.team), serviceUrl: o.service !== live.service.url, profileDigest: digest !== live.service.profileDigest };
  if (refreshed.policy || refreshed.teams.length || refreshed.serviceUrl || refreshed.profileDigest) {
    attributionSetting({ attribution: next });
    try { ctx.record(next); }
    catch (e) { throw attributionError("E_ENDORSE_FAILED", `the refresh couldn't be written: ${oneLine(e.message)} → rerun the same setup`, { step: "record" }); }
  }
  return { state: "already-endorsed", root: { id: live.root.id, home: rootHome }, human: live.human, teams: next.teams, endorsement: next.endorsement, refreshed };
}

const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

/** The registered did:aw in `identityHome`, or null (a local did:key, or none). */
function registeredId(identityHome) {
  try { const did = readFileSync(join(identityHome, "did"), "utf8").trim(); if (DID_AW.test(did)) return did; } catch { /* no recorded did */ }
  try { const m = /^stable_id:\s*(did:aw:\S+)\s*$/m.exec(readFileSync(join(identityHome, "identity.yaml"), "utf8")); if (m) return m[1]; } catch { /* no identity */ }
  return null;
}

/** A team's admission policy read as the root, or null where `required` is false and it can't be read. */
function policyOf(run, team, profile, { required = false } = {}) {
  try {
    const doc = run(admissionPolicyArgv({ team, profile }));
    if (doc?.mode === "protected" && doc.policy) return doc.policy;
    if (!required) return null;
    throw attributionError("E_ENDORSE_POLICY", `${team} has no protected admission policy (${doc?.mode ?? "no answer"}) → have the service's operator provision it`, { problem: doc?.mode === "legacy" ? "legacy" : "missing", team });
  } catch (e) {
    if (!required || e.code?.startsWith?.("E_")) { if (required) throw e; return null; }
    if (e instanceof AwRefusal && /_unavailable$/.test(e.awCode || "")) throw attributionError("E_ATTRIBUTION_EVIDENCE", `${team}'s admission policy couldn't be read (${e.awCode}) → retry setup once the protected service answers`, { code: e.awCode, team });
    throw attributionError("E_ENDORSE_POLICY", `${team}'s admission policy couldn't be read (${e.awCode || oneLine(e.message)}) → rerun setup`, { problem: "missing", team, code: e.awCode ?? null });
  }
}

/** The teams the service holds as legacy, read as the root (best effort): an admission_policy_missing names them. */
function legacyTeams(run, teams, profile) {
  return teams.filter((team) => { try { return run(admissionPolicyArgv({ team, profile }))?.mode === "legacy"; } catch { return false; } });
}

/** C-9's endorse column. `spend()` clears the persisted operation where the outcome is final. */
export function endorseRefusal(e, { binding, operationId, spend, legacy }) {
  const code = e instanceof AwRefusal ? e.awCode || null : null;
  const details = { code, operationId };
  const unknown = () => attributionError("E_ENDORSE_NOT_APPROVED", `the endorsement's outcome is unknown (${code || oneLine(e.awMessage || e.message)}), operation ${operationId} → rerun the same setup, which reads the same receipt and never prepares again`, { ...details, state: "unknown" });
  if (!code) return unknown();
  if (code === "admission_policy_missing") {
    spend();
    const legacyOnes = legacy();
    return attributionError("E_ENDORSE_POLICY", legacyOnes.length
      ? `${legacyOnes.join(", ")} ${legacyOnes.length > 1 ? "are legacy teams" : "is a legacy team"} at this service, with no protected admission policy; no link was made → have the service's operator provision ${legacyOnes.length > 1 ? "them" : "it"} as protected (setup never provisions), or remove ${legacyOnes.length > 1 ? "their" : "its"} mapping`
      : `a team among ${binding.teams.join(", ")} has no protected admission policy at this service; no link was made → have the service's operator provision the deployment's admission policy for it (setup never provisions)`, { ...details, problem: legacyOnes.length ? "legacy" : "missing", teams: legacyOnes.length ? legacyOnes : binding.teams });
  }
  if (code === "policy_changed") { spend(); return attributionError("E_ENDORSE_POLICY", `the teams' admission policy changed before the link was shown, so none was → rerun setup, which starts a new operation with a new link`, { ...details, problem: "changed" }); }
  if (SCOPE.has(code)) return attributionError("E_ENDORSE_FAILED", `the protected service hasn't bound the root ${binding.root} as a requester for the human ${binding.human} and the teams ${binding.teams.join(", ")} (${code}); nothing was recorded → ${bindingStep(binding)}; then rerun this setup`, { ...details, step: "prepare", problem: "requester-unbound", bind: binding });
  if (REGISTER.has(code)) return attributionError("E_ENDORSE_FAILED", `the endorsement couldn't be registered (${code}), operation ${operationId} → rerun the same setup`, { ...details, step: "register" });
  if (code === "operation_conflict") return attributionError("E_ENDORSE_FAILED", `aw refused the endorsement request (${code}), operation ${operationId}; it is never sent again by itself → rerun the same setup`, { ...details, step: "prepare" });
  if (!REFUSED.has(code)) return unknown();
  spend();
  return attributionError("E_ENDORSE_NOT_APPROVED", `the endorsement was refused (${code}) → rerun setup, which starts a new operation with a new link`, { ...details, state: "refused" });
}

/** The terminal's link block (C-2 step 6): the page, the full digest and fingerprint, the teams and bounds, and the responsibility statement. */
function linkText({ pending, human, root, optIn = [] }) {
  const bounds = (b) => b ? `max_active ${b.max_active}, max_per_window ${b.max_per_window} per ${b.rate_window_seconds} s` : "bounds unreadable";
  return [
    `The human ${human} approves this deployment's root ${root} at:`,
    `  ${pending.url}`,
    `Check that the page shows digest ${pending.digest} (fingerprint ${pending.fingerprint}), before ${pending.expiresAt}.`,
    "Teams:",
    ...pending.teams.map((t) => `  ${t}: ${bounds(pending.bounds[t])}`),
    `Approving makes ${human} responsible for this root: everything it spawns counts as yours (ancestry, not permissions).`,
    ...optIn,
    "Waiting for the approval (setup reruns the same operation; up to 600 s)…",
  ].join("\n");
}
