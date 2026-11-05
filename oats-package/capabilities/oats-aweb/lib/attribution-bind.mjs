// The bind (aweb-acrn): the person approves the deployment's steward in aweb
// Cloud, and the steward carries its own signed parent request there. aw signs
// every call (`aw id request`, `aw id parent request`, `aw id parent import`);
// this code only builds argv and files and never holds key material. Cloud's
// routes are `/api/v1/agent-adoptions/{agent_id}` in aweb Cloud
// (routers/agent_adoption_requests.py). The approval page shows the agent's
// address or alias, the request domain, the key fingerprint and the
// deployment label sent here, marked as supplied by the agent.
import { closeSync, fchmodSync, openSync, writeSync } from "node:fs";

/** Cloud's ShownName limit for `deployment_label`, in characters. */
export const DEPLOYMENT_LABEL_MAX = 120;
/** What Cloud's ShownName refuses (security/names.py): control characters,
 *  line and paragraph separators, bidi embeddings, overrides, isolates and
 *  marks, and the zero-width space, word joiner and no-break space. */
const REFUSED_IN_NAME = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c\u200b\u2060\ufeff]/u;

const failure = (code, message) => Object.assign(new Error(message), { code });

/** The steps of the bind, in order, each with its error code. */
export const BIND_STEPS = Object.freeze({
  context: { code: "E_BIND_CONTEXT", what: "reading the adoption context (the human, the domain and the invitation) from aweb Cloud" },
  request: { code: "E_BIND_REQUEST", what: "signing the steward's parent request (`aw id parent request`)" },
  submit: { code: "E_BIND_SUBMIT", what: "submitting the request to aweb Cloud" },
  status: { code: "E_BIND_STATUS", what: "reading the request's status from aweb Cloud" },
  response: { code: "E_BIND_RESPONSE", what: "fetching the issued response from aweb Cloud" },
  import: { code: "E_BIND_IMPORT", what: "importing the issued chain (`aw id parent import`)" },
  record: { code: "E_BIND_RECORD", what: "recording the human and the steward in this host's settings" },
});

/** The label the person sees beside the steward: the deployment's messaging
 *  root name, `<workspace name>-<short hostname>`. Refused, never shortened
 *  or cleaned, when Cloud would refuse or change it. */
export function deploymentLabel(workspaceName, host) {
  const short = typeof host === "string" ? host.split(".")[0] : "";
  if (typeof workspaceName !== "string" || !workspaceName) throw failure("E_BIND_LABEL", "the workspace has no name, so the deployment label <workspace name>-<short hostname> can't be formed → give the workspace a name in oats-workspace.yaml");
  if (!short) throw failure("E_BIND_LABEL", "this machine's hostname is empty, so the deployment label <workspace name>-<short hostname> can't be formed");
  const label = `${workspaceName}-${short}`;
  if (label !== label.trim() || REFUSED_IN_NAME.test(label)) throw failure("E_BIND_LABEL", `the deployment label ${JSON.stringify(label)} has surrounding whitespace or a control, bidi or zero-width character, which aweb Cloud would refuse or change, so the person wouldn't see what was sent → rename the workspace in oats-workspace.yaml`);
  const length = [...label].length;
  if (length > DEPLOYMENT_LABEL_MAX) throw failure("E_BIND_LABEL", `the deployment label ${JSON.stringify(label)} is ${length} characters, and aweb Cloud takes at most ${DEPLOYMENT_LABEL_MAX}; it isn't shortened, because the person must see the whole label → shorten the workspace name in oats-workspace.yaml`);
  return label;
}

/** A body printed by `aw id request --raw`: aw adds one newline when the body
 *  has none (cli/go/cmd/aw/id_request.go), and only that one is removed. */
export function rawBody(stdout) {
  const text = String(stdout ?? "");
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/** Writes the Cloud submission: the request exactly as aw signed it, and the
 *  label beside it in the envelope, never inside the signed request. The
 *  file is mode 600, whether it is new or rewritten. */
export function writeSubmission(file, signedRequest, label) {
  const signed = rawBody(signedRequest);
  if (!signed) throw failure(BIND_STEPS.request.code, "aw id parent request wrote an empty request, so there is nothing to submit");
  const fd = openSync(file, "w", 0o600);
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, JSON.stringify({ signed_request: signed, deployment_label: label }));
  } finally { closeSync(fd); }
}

const DECIDED = {
  declined: ["E_BIND_DECLINED", "was declined in aweb Cloud; nothing was signed and nothing is issued"],
  expired: ["E_BIND_EXPIRED", "expired before it was approved; nothing was signed and nothing is issued"],
  superseded: ["E_BIND_SUPERSEDED", "was replaced by a newer request for this steward; nothing was signed for it and nothing is issued"],
  revoked: ["E_BIND_REVOKED", "was approved, then its certificate was revoked from the dashboard"],
};

/** Waits, bounded, for the person's decision. `readStatus` returns Cloud's
 *  status object. Issued returns it; a decided request is reported once and
 *  never re-submitted (release lane B2); still pending at the deadline stops. */
export async function awaitDecision(readStatus, { timeoutMs, intervalMs, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const doc = await readStatus();
    const id = doc?.request_id ?? "?";
    if (doc?.status === "issued") return doc;
    if (DECIDED[doc?.status]) {
      const [code, what] = DECIDED[doc.status];
      throw failure(code, `the adoption request ${id} ${what} → tell the person, and bind again only if they want to`);
    }
    if (doc?.status !== "pending") throw failure(BIND_STEPS.status.code, `aweb Cloud reported the adoption request ${id} as ${JSON.stringify(doc?.status)}, which the bind doesn't know; nothing is imported`);
    const left = deadline - now();
    if (left <= 0) throw failure("E_BIND_PENDING", `the adoption request ${id} is still waiting for the person's approval${doc.expires_at ? ` (it expires at ${doc.expires_at})` : ""} → once they have approved it, run the bind again; it continues the same request`);
    await sleep(Math.min(intervalMs, left));
  }
}

/** A failed aw call during `step`: that step's code, the HTTP status aw
 *  printed to stderr with --raw, and Cloud's own detail when it sent one. */
export function bindStepFailure(step, result) {
  const s = BIND_STEPS[step];
  if (!s) throw new Error(`unknown bind step ${JSON.stringify(step)}`);
  const stderr = String(result?.stderr ?? ""), body = rawBody(result?.stdout).trim();
  const http = /^HTTP (\d{3})$/m.exec(stderr)?.[1];
  let detail;
  try { const d = JSON.parse(body)?.detail; detail = typeof d === "string" ? d : d === undefined ? undefined : JSON.stringify(d); } catch { detail = undefined; }
  const reason = [http ? `HTTP ${http}` : null, detail ?? (http ? null : stderr.trim().split("\n").filter(Boolean).at(-1)) ?? `aw exited ${result?.status ?? "?"}`].filter(Boolean).join(": ");
  return failure(s.code, `${s.what} failed (${String(reason).slice(0, 400)})`);
}
