// `oats aweb setup --steward` (aweb-acmj.21): a human, at a terminal, binds
// themselves to this deployment by issuing its steward, the agent identity
// that issues every instance a person spawns. aw asks for the human's
// passphrase and signs; this code never signs as a human. The steward lives
// outside instance homes, in D/.aweb-stewards/<alias>, and only its location
// is recorded, in host-only settings: it never reaches an instance's
// environment. One bound human per deployment.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { kernelRefusal, oneLineLabel } from "./attribution.mjs";
import { recordAwebScalar, recordAwebSetting } from "./local-settings.mjs";
import { querySelectedKernel } from "./session-readiness.mjs";
import { selectedDeployment } from "./team-roots.mjs";

export const STEWARD_USAGE = 'usage: oats aweb setup --steward --human <did:aw> --label "<name>" --domain <domain> --name <alias> [--dir <deployment>] [--json]';
const ALIAS_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const failure = (code, message) => Object.assign(new Error(message), { code });

export function parseStewardArgs(argv) {
  const out = {};
  const value = (flag, i) => { if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) throw failure("E_STEWARD_USAGE", `${flag} needs a value\n${STEWARD_USAGE}`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--steward" || arg === "--json" || arg.startsWith("--soul=")) continue;
    // The kernel forwards the messaging soul; the steward belongs to the deployment.
    if (arg === "--soul") { i++; continue; }
    const flag = { "--human": "human", "--label": "label", "--domain": "domain", "--name": "name", "--dir": "dir" }[arg];
    if (!flag) throw failure("E_STEWARD_USAGE", `unknown argument ${JSON.stringify(arg)}\n${STEWARD_USAGE}`);
    out[flag] = value(arg, i++);
  }
  if (!/^did:aw:\S+$/.test(out.human || "")) throw failure("E_STEWARD_USAGE", `--human must be the human's did:aw (from \`aw id human init\`)\n${STEWARD_USAGE}`);
  try { out.label = oneLineLabel(out.label); } catch (e) { throw failure("E_STEWARD_USAGE", `${e.message}\n${STEWARD_USAGE}`); }
  if (!DOMAIN_RE.test(out.domain || "")) throw failure("E_STEWARD_USAGE", `--domain must be the namespace the human controls, a lowercase DNS name\n${STEWARD_USAGE}`);
  if (!ALIAS_RE.test(out.name || "")) throw failure("E_STEWARD_USAGE", `--name must be the steward's alias: 1-64 letters, digits, '-' or '_', starting with a letter or digit\n${STEWARD_USAGE}`);
  return out;
}

/** The steward's verified chain, read with `aw who --json` in its home. */
function stewardWho(stewardHome, runCaptured) {
  let raw;
  try { raw = runCaptured(["aw", "who", "--json"], stewardHome); }
  catch (e) { throw failure("E_STEWARD_VERIFY", `aw who in ${stewardHome} failed: ${String(e.message || e).slice(0, 300)}`); }
  try { return JSON.parse(raw); } catch { throw failure("E_STEWARD_VERIFY", `aw who in ${stewardHome} answered no JSON`); }
}

function requireHumanChain(who, human, stewardHome) {
  if (who?.identity_valid === true && who.outcome === "nearest_human" && who.human_id === human) return;
  throw failure("E_STEWARD_VERIFY", `the steward in ${stewardHome} does not verify to ${human} (aw who: ${who?.outcome || "?"}, ${who?.reason || "?"}); nothing was recorded → check the human's registration, then rerun this command`);
}

const defaultDeps = {
  env: process.env,
  kernelVersion: (env) => querySelectedKernel(["--version", "--json"], { env }),
  runCaptured: (argv, cwd) => execFileSync(argv[0], argv.slice(1), { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000, env: awEnv(process.env) }).trim(),
  // aw asks for the human's passphrase on this terminal: stdio is inherited.
  runInteractive: (argv, cwd) => spawnSync(argv[0], argv.slice(1), { cwd, stdio: "inherit", env: awEnv(process.env) }).status,
  recordScalar: recordAwebScalar,
  recordSetting: recordAwebSetting,
};

/** aw acts as the steward from its own home's .aw: an inherited
 *  AWEB_IDENTITY_HOME never selects the identity. */
function awEnv(env) {
  const out = { ...env, AW_NO_UPDATE_CHECK: "1" };
  delete out.AWEB_IDENTITY_HOME;
  return out;
}

export async function setupSteward(args, deps = {}) {
  const { env, kernelVersion, runCaptured, runInteractive, recordScalar, recordSetting } = { ...defaultDeps, ...deps };
  if (env.OATS_INSTANCE_HOME) throw failure("E_STEWARD_INSIDE_HOME", "oats aweb setup --steward is run by the human at their own terminal, not inside an instance: an agent never binds a human");
  let settings = {};
  try { settings = JSON.parse(env.OATS_SETTINGS || "{}") || {}; } catch { settings = {}; }
  const bound = settings.human;
  if (bound?.id && bound.id !== args.human) throw failure("E_STEWARD_ONE_HUMAN", `${bound.label || bound.id} (${bound.id}) is already bound to this deployment, and this release binds one human per deployment; a second person needs their own deployment`);
  const refusal = kernelRefusal((() => { try { return kernelVersion(env); } catch { return undefined; } })());
  if (refusal) throw failure("E_STEWARD_KERNEL", refusal);
  const deployment = selectedDeployment(env, args.dir);
  const stewardHome = join(deployment, ".aweb-stewards", args.name);
  const recorded = settings.steward;
  if (recorded?.home && recorded.home !== stewardHome) throw failure("E_STEWARD_ONE_HUMAN", `this deployment already records the steward ${recorded.id || "?"} at ${recorded.home}; one steward per deployment`);
  let created = false;
  if (!existsSync(join(stewardHome, ".aw", "signing.key"))) {
    let help = "";
    try { help = runCaptured(["aw", "id", "create", "--help"], deployment); } catch { help = ""; }
    if (!help.includes("--human-parent")) throw failure("E_STEWARD_AW", "this aw has no `aw id create --human-parent`: upgrade aw to a release with identity chains (`npm i -g @awebai/aw@next`), then rerun");
    mkdirSync(stewardHome, { recursive: true, mode: 0o700 });
    const status = runInteractive(["aw", "id", "create", "--human-parent", args.human, "--domain", args.domain, "--name", args.name], stewardHome);
    if (status !== 0) throw failure("E_STEWARD_CREATE", `aw id create --human-parent exited ${status}; nothing was recorded → fix what aw reported, then rerun (a rerun continues from ${stewardHome})`);
    created = true;
  }
  const who = stewardWho(stewardHome, runCaptured);
  requireHumanChain(who, args.human, stewardHome);
  const start = deployment;
  // The mode switches last, so a partial record never turns bound mode on.
  recordSetting("steward", "id", who.id, { start });
  recordSetting("steward", "home", stewardHome, { start });
  recordSetting("human", "id", args.human, { start });
  recordSetting("human", "label", args.label, { start });
  recordScalar("attribution", "human", { start });
  return { human: { id: args.human, label: args.label }, steward: { id: who.id, home: stewardHome }, attribution: "human", created };
}

export async function stewardMain(argv, deps = {}) {
  const json = argv.includes("--json");
  try {
    const result = await setupSteward(parseStewardArgs(argv), deps);
    if (json) console.log(JSON.stringify({ schemaVersion: 1, ok: true, result }));
    else console.log(`PASS bound ${result.human.label} (${result.human.id}) to this deployment through steward ${result.steward.id} at ${result.steward.home}; attribution: human. Instances spawned from now on carry an identity chain to ${result.human.label}.`);
    return 0;
  } catch (e) {
    const code = e.code || "E_STEWARD_FAILED";
    if (json) console.log(JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message: e.message } }));
    else console.error(`FAIL ${code}: ${e.message}`);
    return code === "E_STEWARD_USAGE" ? 2 : 1;
  }
}
