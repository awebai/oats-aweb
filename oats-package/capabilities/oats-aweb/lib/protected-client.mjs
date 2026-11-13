// The protected service's aw commands (aweb-acxy.5 at aweb 859e07567), one aw
// call per act (spec v4.3.7 P3, P4): OATS makes no protected HTTP call itself
// and never parses aw's text, only its --json answer and its error envelope
// {"error": {code, message}} (cli/go/cmd/aw/errors.go). Every argv here is the
// one the spec's C items name; test/protected-aw-argv.test.mjs pins each one
// against the built binary's --help.

/** The protected-client floor: aw built from aweb 859e07567, which rc.2 gates.
 *  [.5] The [.5] pin raises it to the published release, and moves the three
 *  constants below with it. */
export const PROTECTED_AW_MIN = "1.36.59-rc.2";
/** Whether the pinned aw and service serve `team.agent.remove` (A2). Decided
 *  from the pinned aw, never probed at run time. [.5: A2 served] */
export const REMOVE_SERVED = false;
/** Whether they serve the owner's live `team.admission-policy.change`. In v1
 *  the policy is fixed at provisioning (signer-embedding ad384aa8). */
export const POLICY_CHANGE_SERVED = false;
/** Whether the released exchange can run its child side through a resident's
 *  custody. [.5: custody exchange] */
export const RESIDENT_CUSTODY_SERVED = false;

/** aw's refusal: its envelope's code (or none, for a failure aw didn't code),
 *  and a bounded, single-line form of its message for a person. */
export class AwRefusal extends Error {
  constructor(command, { code, message, outcome }) {
    super(`aw ${command} ${code ? `refused ${code}` : outcome || "failed"}${message ? `: ${message}` : ""}`);
    this.awCode = code || undefined;
    this.awMessage = message || "";
    this.command = command;
  }
}

const oneLine = (text, max = 240) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
/** The first JSON object aw printed on stdout: its answer, or its envelope. */
function stdoutJson(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return undefined;
  try { return JSON.parse(trimmed); } catch { /* aw prints one document; anything else is no answer */ }
  const start = trimmed.indexOf("\n{");
  if (start >= 0) { try { return JSON.parse(trimmed.slice(start + 1)); } catch { /* no answer */ } }
  return undefined;
}
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const AW_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/** One protected aw command: `run(argv, cwd, timeout)` returns stdout or
 *  throws with `stdout`/`outcome` (the hook's runner). Returns aw's JSON
 *  answer, or throws an AwRefusal carrying aw's code. */
export function awJson(run, command, argv, cwd, timeout) {
  let stdout;
  try { stdout = run(["aw", ...argv], cwd, timeout); }
  catch (e) {
    const envelope = stdoutJson(e.stdout)?.error;
    const code = object(envelope) && typeof envelope.code === "string" && AW_CODE.test(envelope.code) ? envelope.code : undefined;
    throw new AwRefusal(command, { code, message: oneLine(object(envelope) ? envelope.message : e.stderr || e.message), outcome: e.outcome });
  }
  const doc = stdoutJson(stdout);
  if (!object(doc)) throw new AwRefusal(command, { message: "answered no JSON object" });
  return doc;
}

// ---------------------------------------------------------------------------
// The argv of each act, exactly as C-2, C-3, C-5 and C-6 write it.

/** C-2 step 2: a registered root with no address. */
export const createNoAddressArgv = ({ identityHome, registry }) => ["--json", "id", "create", "--no-address", "--identity-home", identityHome, "--registry", registry];
/** C-3 step 1: the child's key-only local identity. */
export const createLocalArgv = ({ identityHome }) => ["--json", "id", "create", "--local", "--identity-home", identityHome];
/** C-2 step 4, run from the root home. `wait`: the terminal's waiting rerun,
 *  the same call without --no-wait. */
export const endorseArgv = ({ human, teams, label, operationId, profile, wait = false }) => [
  "--json", "id", "endorse", "--human", human, ...teams.flatMap((t) => ["--team", t]), "--deployment-label", label,
  "--operation-id", operationId, "--protected-profile", profile, ...(wait ? [] : ["--no-wait"]), "--no-browser",
];
/** C-2 step 6 and the policy refresh, run from the root home. */
export const admissionPolicyArgv = ({ team, profile }) => ["--json", "id", "team", "admission-policy", "--team", team, "--protected-profile", profile];
/** C-3 step 3, run from the root home. `memberId` only for a registered child. */
export const admitArgv = ({ team, memberKey, memberId, alias, policy, operationId, certificateOut, profile }) => [
  "--json", "id", "team", "admit", "--team", team, "--member-key", memberKey, ...(memberId ? ["--member-id", memberId] : []), "--alias", alias,
  "--policy-version", String(policy.version), "--policy-digest", policy.digest, "--operation-id", operationId, "--certificate-out", certificateOut, "--protected-profile", profile,
];
/** C-3 step 3: the admitted certificate into the new home. */
export const installCertArgv = ({ identityHome, certificate, registry }) => ["--json", "id", "team", "install-cert", "--identity-home", identityHome, "--certificate", certificate, ...(registry ? ["--registry", registry] : [])];
/** C-3 step 3: the workspace connects, unchanged. */
export const serviceInitArgv = ({ identityHome, service, team }) => ["service", "init", "--identity-home", identityHome, "--service", service, "--team", team];
/** C-5 and C-6: root-mode removal, run from the root's identity home. */
export const removeAgentArgv = ({ certificate, operationId, profile }) => ["--json", "id", "team", "remove-agent", "--certificate", certificate, "--operation-id", operationId, "--protected-profile", profile];
