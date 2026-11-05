// `oats aweb setup --steward` (aweb-acmj.21, aweb-acrn): binds a human to this
// deployment. The deployment's steward, the agent identity that issues every
// instance a person spawns, is an ordinary global self-custodial agent in
// D/.aweb-stewards/<alias>, made with `aw init --global` from the dashboard
// API key of the account whose human will be its parent (resident create's
// init stage, with no custody unit and no grant seats). The steward carries
// its own signed parent request to aweb Cloud; the person approves it there
// with one click; the steward imports the issued chain. aw signs every call;
// this code never holds key material, and no agent ever holds the human's
// key. Nothing is recorded until the import verifies; attribution: human is
// recorded last. The request's files stay in the steward's .oats-bind, so a
// rerun continues the same request instead of asking the person again.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { kernelRefusal, oneLineLabel } from "./attribution.mjs";
import { BIND_STEPS, awaitDecision, bindStepFailure, deploymentLabel, rawBody, writeSubmission } from "./attribution-bind.mjs";
import { recordAwebScalar, recordAwebSetting } from "./local-settings.mjs";
import { checkWhoamiAnswer, globalIdentityTools, initGlobalIdentity, needsInit, rootState, scrubber } from "./resident.mjs";
import { querySelectedKernel } from "./session-readiness.mjs";
import { selectedDeployment } from "./team-roots.mjs";

export const STEWARD_USAGE = 'usage: AWEB_API_KEY=<key> AWEB_URL=<url> oats aweb setup --steward --name <alias> [--label "<the human\'s name>"] [--wait <seconds>] [--dir <deployment>] [--json]';
const ALIAS_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL_MS = 2000;
const ID_REQUEST_AW = "upgrade aw to 1.36.54 or later (`npm i -g @awebai/aw@1.36.54`), the first with `aw id request`";
const CLAIM_HUMAN = "the account has no person yet, so nobody can approve its steward → the person attaches themselves first (`aw claim-human`, /oats-aweb \"attach yourself to the account\"), then run this command again";

const failure = (code, message, details) => Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
const readJsonFile = (file) => JSON.parse(readFileSync(file, "utf8"));
const writePrivate = (file, text) => { writeFileSync(file, text, { mode: 0o600 }); chmodSync(file, 0o600); };

export function parseStewardArgs(argv) {
  const usage = (why) => failure("E_STEWARD_USAGE", why ? `${why}\n${STEWARD_USAGE}` : STEWARD_USAGE);
  const out = { wait: 0 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--steward" || arg === "--json" || arg.startsWith("--soul=")) continue;
    // The kernel forwards the messaging soul; the steward belongs to the deployment.
    if (arg === "--soul") { i++; continue; }
    const flag = { "--name": "name", "--label": "label", "--wait": "wait", "--dir": "dir" }[arg];
    if (!flag) throw usage(`unknown argument ${JSON.stringify(arg)}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw usage(`${arg} needs a value`);
    out[flag] = value;
  }
  if (!ALIAS_RE.test(out.name || "")) throw usage("--name must be the steward's alias: 1-64 letters, digits, '-' or '_', starting with a letter or digit");
  if (out.label !== undefined) { try { out.label = oneLineLabel(out.label); } catch (e) { throw usage(e.message); } }
  if (typeof out.wait === "string") {
    if (!/^\d{1,4}$/.test(out.wait)) throw usage("--wait takes a whole number of seconds, at most 9999");
    out.wait = Number(out.wait);
  }
  return out;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** The key fingerprint aweb Cloud's approval page shows for a did:key:
 *  SHA256 of the raw Ed25519 public key, in hex (agent_adoption_requests.py). */
export function keyFingerprint(didKey) {
  const m = /^did:key:z([1-9A-HJ-NP-Za-km-z]+)$/.exec(String(didKey ?? ""));
  if (!m) return null;
  let n = 0n;
  for (const c of m[1]) n = n * 58n + BigInt(BASE58.indexOf(c));
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of m[1]) { if (c !== "1") break; bytes.unshift(0); }
  // The multicodec prefix of an Ed25519 public key, then its 32 bytes.
  if (bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) return null;
  return `SHA256:${createHash("sha256").update(Buffer.from(bytes.slice(2))).digest("hex")}`;
}

/** resident create's failures, as the steward's. */
const asSteward = (e) => { if (typeof e.code === "string") e.code = e.code.replace(/^E_RESIDENT_/, "E_STEWARD_"); return e; };

const defaultDeps = {
  query: (args, env) => querySelectedKernel(args, { env }),
  host: hostname,
  record: { setting: recordAwebSetting, scalar: recordAwebScalar },
};

/** The whole bind. Returns the result document; throws a failure with a code. */
export async function bindSteward(opts, { env, stdin, stderr }, deps = {}) {
  const { query, host, record } = { ...defaultDeps, ...deps };
  let deployment;
  try { deployment = selectedDeployment(env, opts.dir); } catch (e) { throw failure("E_STEWARD_DEPLOYMENT", e.message); }
  let settings = {};
  try { settings = JSON.parse(env.OATS_SETTINGS || "{}") || {}; } catch { settings = {}; }
  const stewardHome = join(deployment, ".aweb-stewards", opts.name);
  const recorded = settings.steward;
  if (recorded?.home && resolve(recorded.home) !== stewardHome) throw failure("E_STEWARD_ONE_HUMAN", `this deployment already records the steward ${recorded.id || "?"} at ${recorded.home}; one human and one steward per deployment, so a second person needs a deployment of their own`);
  let version;
  try { version = query(["--version", "--json"], env); } catch { version = undefined; }
  const refusal = kernelRefusal(version);
  if (refusal) throw failure("E_STEWARD_KERNEL", refusal);

  const { aw, readEnv, read, readJson } = await globalIdentityTools(env, stewardHome).catch((e) => { throw asSteward(e); });
  const call = (args, cwd = stewardHome) => spawnSync(aw, args, { cwd, env: readEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
  const who = () => { const r = call(["who", "--json"]); try { return JSON.parse(r.stdout); } catch { return undefined; } };
  const verifies = (doc, human) => doc?.identity_valid === true && doc.outcome === "nearest_human" && doc.human_id === human;

  if (recorded?.home && settings.human?.id && existsSync(join(stewardHome, ".aw", "id-chain.json")) && verifies(who(), settings.human.id)) {
    return { outcome: "already-bound", human: { id: settings.human.id, ...(settings.human.label ? { label: settings.human.label } : {}) }, steward: { id: recorded.id, home: stewardHome } };
  }

  // ---- the label, before anything has a remote effect
  let workspaceName;
  try { workspaceName = query(["workspace", "status", "--json"], env)?.result?.workspace?.name; } catch { workspaceName = undefined; }
  const label = deploymentLabel(workspaceName, host());
  if (call(["id", "request", "--help"], deployment).status !== 0) throw failure("E_STEWARD_AW", `this aw has no \`aw id request\`: ${ID_REQUEST_AW}, then run this command again`);

  // ---- the steward identity: made once, with the key held for aw init alone
  const rerun = `oats aweb setup --steward --name ${opts.name}`;
  let identity;
  try {
    const { state } = rootState(stewardHome);
    if (needsInit(state) && !(typeof env.AWEB_URL === "string" && env.AWEB_URL.trim())) throw failure("E_STEWARD_KEY", `AWEB_URL is not set: the steward is made from the dashboard line (AWEB_API_KEY and AWEB_URL) of the account whose human will approve it → AWEB_API_KEY=<key> AWEB_URL=<url> ${rerun}`);
    const known = state === "adopt" ? checkWhoamiAnswer(readJson(["whoami", "--json"], "aw whoami", "preflight"), opts.name) : undefined;
    ({ identity } = await initGlobalIdentity({ root: stewardHome, name: opts.name, state, known, aw, read, readJson, env, stdin, stderr, captures: [], rerun }));
  } catch (e) { throw asSteward(e); }
  const me = readJson(["whoami", "--json"], "aw whoami");
  // aw id request signs only with a local key (resolveLocalSigningIdentity).
  if (me.custody && me.custody !== "self") throw failure("E_STEWARD_CUSTODY", `the steward ${identity.address} in ${stewardHome} has custody ${me.custody}, not self, so it can't sign its own requests → the steward is a self-custodial identity of its own, never a resident or a grant seat`);
  let agentId;
  try { agentId = readJson(["workspace", "status", "--json"], "aw workspace status")?.workspace?.agent_id; } catch { agentId = undefined; }
  if (!UUID_RE.test(String(agentId ?? ""))) throw failure("E_BIND_AGENT_ID", `aw workspace status in ${stewardHome} reports no agent id for the steward, so its aweb Cloud agent can't be named → check that the steward is connected (\`aw workspace status\` there), then run this command again`);
  const awebUrl = /^aweb_url:\s*"?([^"\n]+?)"?\s*$/m.exec(existsSync(join(stewardHome, ".aw", "workspace.yaml")) ? readFileSync(join(stewardHome, ".aw", "workspace.yaml"), "utf8") : "")?.[1];
  let origin;
  try { origin = new URL(awebUrl).origin; } catch { throw failure("E_BIND_CONTEXT", `the steward's ${join(stewardHome, ".aw", "workspace.yaml")} names no aweb service URL, so aweb Cloud can't be reached`); }
  const base = `${origin}/api/v1/agent-adoptions/${agentId}`;

  /** One signed call to aweb Cloud, as `step`: its JSON answer, or the step's failure. */
  const cloud = (step, method, url, extra = []) => {
    const r = call(["id", "request", method, url, ...extra, "--raw"]);
    if (r.status !== 0) {
      const http = /^HTTP (\d{3})$/m.exec(String(r.stderr))?.[1], body = rawBody(r.stdout);
      if (step === "context" && http === "404") throw failure("E_BIND_AGENT_NOT_FOUND", `aweb Cloud has no agent ${agentId} for the steward ${identity.address} (HTTP 404) → check that the steward is connected to the account's team (\`aw workspace status\` in ${stewardHome})`);
      if (step === "context" && http === "409" && /registered human/.test(body)) throw failure("E_BIND_NO_HUMAN", CLAIM_HUMAN);
      if (step === "context" && http === "409" && /global_agent_required/.test(body)) throw failure("E_BIND_CONTEXT", `aweb Cloud takes a submitted request only from a global agent, and the steward ${identity.address} is local (HTTP 409)`);
      throw bindStepFailure(step, r);
    }
    if (step === "response") return rawBody(r.stdout);
    try { return JSON.parse(rawBody(r.stdout)); } catch { throw failure(BIND_STEPS[step].code, `${BIND_STEPS[step].what}: aweb Cloud answered no JSON`); }
  };

  // ---- the request, signed once and submitted once; a rerun continues it
  const dir = join(stewardHome, ".oats-bind");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const files = Object.fromEntries(["context", "request", "submit", "operation", "response"].map((f) => [f, join(dir, `${f}.json`)]));
  if (!existsSync(files.operation)) {
    if (!existsSync(files.request)) {
      const context = cloud("context", "GET", base);
      if (!/^did:aw:\S+$/.test(context?.parent?.id || "") || typeof context.domain !== "string" || typeof context.invitation_id !== "string") throw failure(BIND_STEPS.context.code, `${BIND_STEPS.context.what}: aweb Cloud's answer names no human, domain and invitation`);
      writePrivate(files.context, JSON.stringify(context));
      const r = call(["id", "parent", "request", "--domain", context.domain, "--parent", context.parent.id, "--invitation-id", context.invitation_id, "--out", files.request, "--json"]);
      if (r.status !== 0) throw bindStepFailure("request", r);
    }
    if (!existsSync(files.submit)) writeSubmission(files.submit, readFileSync(files.request, "utf8"), label);
    const submitted = cloud("submit", "POST", `${base}/requests`, ["--body-file", files.submit, "--header", "Content-Type: application/json"]);
    if (!/^[\w-]{1,64}$/.test(String(submitted?.request_id ?? ""))) throw failure(BIND_STEPS.submit.code, `${BIND_STEPS.submit.what}: aweb Cloud's answer names no request id`);
    writePrivate(files.operation, JSON.stringify(submitted));
  }
  const context = readJsonFile(files.context), operation = readJsonFile(files.operation);
  const shown = readJsonFile(files.submit).deployment_label;
  const shows = { address: identity.address, domain: context.domain, deploymentLabel: shown, fingerprint: keyFingerprint(me.did) };
  const approvalUrl = typeof operation.approval_path === "string" ? new URL(operation.approval_path, origin).href : null;

  // ---- the person's decision, waited for within --wait
  try {
    await awaitDecision(() => cloud("status", "GET", `${base}/requests/${operation.request_id}`), { timeoutMs: opts.wait * 1000, intervalMs: POLL_MS });
  } catch (e) {
    if (e.code === "E_BIND_PENDING") {
      throw failure("E_BIND_PENDING", [
        `the adoption request ${operation.request_id} waits for the person's approval${operation.expires_at ? ` (it expires at ${operation.expires_at})` : ""}.`,
        `Send the person this link: ${approvalUrl}`,
        `Before they click, tell them the page will show the agent ${shows.address}, the domain ${shows.domain}, the deployment label "${shows.deploymentLabel}" (marked as supplied by the agent) and the key fingerprint ${shows.fingerprint}, and that they approve only if all four match.`,
        `Once they have approved it, run this command again: ${rerun}`,
      ].join("\n"), { approvalUrl, shows, requestId: operation.request_id, expiresAt: operation.expires_at ?? null });
    }
    if (/^E_BIND_(DECLINED|EXPIRED|SUPERSEDED|REVOKED)$/.test(e.code)) e.message += `: remove ${dir}, then run this command again`;
    throw e;
  }

  // ---- the issued chain, imported as aw wrote it, less aw's added newline
  if (!existsSync(files.response)) writePrivate(files.response, cloud("response", "GET", `${base}/requests/${operation.request_id}/response`));
  const imported = call(["id", "parent", "import", files.response, "--domain", context.domain, "--json"]);
  if (imported.status !== 0 && !verifies(who(), context.parent.id)) throw bindStepFailure("import", imported);
  const verdict = who();
  if (!verifies(verdict, context.parent.id)) throw failure(BIND_STEPS.import.code, `the steward in ${stewardHome} does not verify to ${context.parent.id} after the import (aw who: ${verdict?.outcome || "?"}, ${verdict?.reason || "?"}); nothing was recorded`);

  // ---- record: the mode last, so a partial record never turns human mode on
  try {
    const start = deployment;
    record.setting("steward", "id", identity.stableId, { start });
    record.setting("steward", "home", stewardHome, { start });
    record.setting("human", "id", context.parent.id, { start });
    if (opts.label) record.setting("human", "label", opts.label, { start });
    record.scalar("attribution", "human", { start });
  } catch (e) { throw failure(BIND_STEPS.record.code, `${BIND_STEPS.record.what} failed: ${e.message}`); }
  return { outcome: "bound", human: { id: context.parent.id, ...(opts.label ? { label: opts.label } : {}) }, steward: { id: identity.stableId, home: stewardHome }, deploymentLabel: shown, requestId: operation.request_id };
}

/** The command's entrypoint: one JSON-v1 envelope with --json, else text.
 *  Exit 2 for a usage error, 1 for any other failure. Everything printed is
 *  scrubbed of AWEB_API_KEY's value. */
export async function stewardMain(argv, { env = process.env, stdin = process.stdin, stderr = process.stderr } = {}, deps = {}) {
  const json = argv.includes("--json");
  const scrub = scrubber([env.AWEB_API_KEY, String(env.AWEB_API_KEY ?? "").trim()]);
  const print = (fd, text) => writeSync(fd, scrub(text));
  try {
    const result = await bindSteward(parseStewardArgs(argv), { env, stdin, stderr }, deps);
    const who = result.human.label ? `${result.human.label} (${result.human.id})` : result.human.id;
    print(1, json ? JSON.stringify({ schemaVersion: 1, ok: true, result }) + "\n" : `PASS ${result.outcome === "already-bound" ? "already bound" : "bound"}: ${who} through steward ${result.steward.id} at ${result.steward.home}; attribution: human.\n`);
    return 0;
  } catch (e) {
    const code = typeof e.code === "string" && /^E_(STEWARD|BIND)_/.test(e.code) ? e.code : "E_STEWARD_FAILED";
    if (json) print(1, JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message: e.message, ...(e.details ? { details: e.details } : {}) } }) + "\n");
    else print(2, `FAIL ${code}: ${e.message}\n`);
    return code === "E_STEWARD_USAGE" ? 2 : 1;
  }
}
