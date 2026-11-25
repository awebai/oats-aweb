// The cause of a failed aw call whose output is withheld because it can hold a
// credential (an invite mint), named from a fixed vocabulary: aw's own text is
// matched, never relayed (awebai/oats-aweb#52).

/** The refusal codes read from aw's --json error envelope
 *  (`{"error":{"code":...}}`, aw 1.36.52-rc.3 and later). A code is a fixed
 *  word, so naming it leaks nothing; anything else is never read. */
export const AW_ERROR_CODES = new Set(["unknown_or_invalid"]);

/** Transport failures as Go's net, net/http and crypto/tls word them in the aw
 *  binary: a dial (tcp, tcp4, tcp6), DNS, refused/reset/unreachable, timeouts
 *  (i/o, deadline, TLS handshake, the client's own), TLS and certificate
 *  errors, and a connection that ended early (`Post "…": EOF`). */
const NETWORK_FAILURE_RE = /\b(?:dial tcp[46]?|no such host|connection refused|connection reset|network is unreachable|i\/o timeout|context deadline exceeded|tls handshake timeout|client\.timeout exceeded)\b|\btls: |\bx509: |": (?:unexpected )?EOF\b/i;

/** The `detail.code` an aweb service may refuse with, as a fixed table: the
 *  code is remote text, so it is named only when the table lists it or the
 *  WHOLE string is one short snake_case word; anything else is the generic
 *  SERVICE_REFUSED (awebai/oats-aweb#202). */
export const SERVICE_DETAIL_CODES = new Set(["service_url_mismatch", "awid_team_not_found", "awid_team_controller_mismatch", "awid_team_missing_controller", "invalid_controller_signature", "invalid_controller_timestamp", "validation_error"]);
export const SERVICE_REFUSED = "service-refused";
const SERVICE_DETAIL_CODE_RE = /^[a-z][a-z0-9_]{0,47}$/;
export function serviceDetailCode(code) {
  return typeof code === "string" && (SERVICE_DETAIL_CODES.has(code) || SERVICE_DETAIL_CODE_RE.test(code)) ? code : SERVICE_REFUSED;
}

/** A key aw needs that is not on this machine, as aw words it: a BYOT team
 *  create without the namespace controller key ("no local controller key for
 *  --namespace D", or "load controller key for D: ..." when loading it fails),
 *  and an invite or register without the team key ("no team key for D/N",
 *  "local team controller key for N:D was not found"). Checked before
 *  anything else: these are the actionable causes. */
export const NAMESPACE_CONTROLLER_KEY_MISSING = "the namespace controller key for this namespace is not on this machine";
export const TEAM_KEY_MISSING = "the team key is not on this machine";
const LOCAL_KEY_CAUSES = [
  [/\bno local controller key for\b|\bload controller key for\b/i, NAMESPACE_CONTROLLER_KEY_MISSING],
  [/\bno team key for\b|\blocal team controller key for \S+ was not found\b/i, TEAM_KEY_MISSING],
];

/** The JSON object that `text` starts with, ignoring whatever follows it. */
export function leadingJsonObject(text) {
  let depth = 0, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(0, i + 1));
  }
  throw new Error("unterminated JSON object");
}

/** aw's --json error code (`{"error":{"code":...}}` leading its stdout), only
 *  when AW_ERROR_CODES lists it. */
export function awErrorCode(stdout) {
  try {
    const code = leadingJsonObject(String(stdout ?? "").trim())?.error?.code;
    return AW_ERROR_CODES.has(code) ? code : undefined;
  } catch { return undefined; }
}

/** Whether aw's --json error envelope on stdout is a refusal of the alias because
 *  another member holds it: code `alias_conflict` (aw's name for the registry's
 *  `alias_active`), or AWID's `self_custody_reinit_unproven` as the reason of an
 *  `http_error` (aw awid/error_detail.go DescribeError). Only those two fields are
 *  read, never the message. */
export function awAliasRefusal(stdout) {
  try {
    const error = leadingJsonObject(String(stdout ?? "").trim())?.error;
    return error?.code === "alias_conflict" || (error?.code === "http_error" && error?.reason === "self_custody_reinit_unproven");
  } catch { return false; }
}

/** The cause of a failure with no HTTP status: a missing local key, else
 *  aw's allowlisted error code, else a network or TLS failure in its output,
 *  else that the output held none of these. */
export function withheldFailureCause({ stderr, stdout }) {
  const text = `${stderr ?? ""}\n${stdout ?? ""}`;
  const key = LOCAL_KEY_CAUSES.find(([re]) => re.test(text));
  if (key) return key[1];
  const code = awErrorCode(stdout);
  if (code) return `aw error ${code}`;
  if (NETWORK_FAILURE_RE.test(text)) return "the aweb service could not be reached: a network or TLS failure";
  return "no HTTP status, aw error code or network failure in its output";
}

/** The `error.code` values of aw's --json envelope that the spawn mint
 *  (`aw init --join-from ... --join-team ... --name ... --json`) may name
 *  (awebai/oats-aweb#280). The list is the codes that mint can produce, traced
 *  by aweb's maintainers against aw 1.36.59: aw's own refusals, its hosted invite
 *  preview's and its accept certificate check's. aw's codes are a published
 *  contract (aw docs/cli-integration-contract.md), so naming one relays nothing.
 *  `http_error` and `error` name no class: the status and reason say more. Any
 *  other code is not named. */
export const AW_MINT_ERROR_CODES = new Set([
  "invite_not_created", "alias_conflict", "outcome_unknown", "unknown_or_invalid",
  "native_agent_signature_pending", "invite_already_used", "invite_unknown_or_expired",
  "invite_issuance_pending", "certificate_persistence_incomplete", "team_name_unconfirmed",
  "expired_or_revoked", "exhausted", "server_unreachable",
  "certificate_invalid", "certificate_revoked", "team_key_not_current",
]);

/** The `error.reason` values (the server's or registry's own refusal code, as aw
 *  carries it) that the spawn mint may name (awebai/oats-aweb#280), as aweb's
 *  maintainers traced that mint. Server reasons are an open vocabulary and remote
 *  text, so a reason is named only when this table lists it: any other shows as
 *  the HTTP status alone. Left out on purpose: a reason that tells another
 *  holder's custody mode, and any reason this mint does not reach or aw flattens. */
export const AW_MINT_REFUSAL_REASONS = new Set(["alias_active", "alias_taken", "alias_mismatch", "team_key_not_current"]);

/** A signing key aw needs that it could not read: the root's (to sign the
 *  invite) or the new member's, as aw words a missing key file
 *  (awid/keys.go LoadSigningKey: "read <path>/signing.key: open ...: no such
 *  file or directory"). The path is matched, never relayed. */
export const SIGNING_KEY_MISSING = "a signing key aw needs is not on this machine";
const SIGNING_KEY_MISSING_RE = /\bread \S*signing\.key: open \S*signing\.key: no such file or directory\b/;

/** The cause of a failed spawn mint, from a fixed vocabulary only
 *  (awebai/oats-aweb#280). Read from the RAW output, before any scrub: only this
 *  answer leaves, never aw's message or detail, which are free text.
 *   - a missing local key (aw's own words), first: it is the actionable cause;
 *   - else from aw's --json envelope, `{"error":{code, http_status, reason}}`:
 *     `aw error <code>` for a code on AW_MINT_ERROR_CODES, `http <status>`, and
 *     `reason <reason>` for a reason on AW_MINT_REFUSAL_REASONS;
 *   - with no HTTP status, a client-side class from the text: a network or TLS
 *     failure, or a signing key aw could not read;
 *   - with no envelope (aw before 1.36.52), `http <status>` from aw's text,
 *     and its detail's code only when the reason table lists it;
 *   - else that the output held none of these. */
export function mintFailureCause({ stderr, stdout }) {
  const text = `${stderr ?? ""}\n${stdout ?? ""}`;
  const key = LOCAL_KEY_CAUSES.find(([re]) => re.test(text));
  if (key) return key[1];
  let error;
  try { error = leadingJsonObject(String(stdout ?? "").trim())?.error; } catch { error = undefined; }
  if (!error || typeof error !== "object" || Array.isArray(error)) error = undefined;
  const parts = [];
  if (error && AW_MINT_ERROR_CODES.has(error.code)) parts.push(`aw error ${error.code}`);
  let status = error && Number.isInteger(error.http_status) && error.http_status >= 100 && error.http_status <= 599 ? error.http_status : undefined;
  let reason = error && AW_MINT_REFUSAL_REASONS.has(error.reason) ? error.reason : undefined;
  if (!error) {
    // No envelope: aw's text names a server refusal as `http <status>: <body>`.
    const http = /\bhttp (\d{3})\b/.exec(text);
    if (http) {
      status = Number(http[1]);
      const body = text.indexOf("{", http.index);
      if (body >= 0) {
        try {
          const code = leadingJsonObject(text.slice(body))?.detail?.code;
          if (AW_MINT_REFUSAL_REASONS.has(code)) reason = code;
        } catch { /* no JSON body */ }
      }
    }
  }
  if (status !== undefined) parts.push(`http ${status}`);
  if (status !== undefined && reason) parts.push(`reason ${reason}`);
  if (status === undefined) {
    if (NETWORK_FAILURE_RE.test(text)) parts.push("the aweb service could not be reached: a network or TLS failure");
    else if (SIGNING_KEY_MISSING_RE.test(text)) parts.push(SIGNING_KEY_MISSING);
  }
  return parts.length ? parts.join(", ") : "no HTTP status, aw error code, missing key or network failure in its output";
}

/** Why aw refused a hosted username, as a plain sentence for the person who
 *  chose it, by aw's reason word (the service's check-username `reason`). */
export const USERNAME_UNAVAILABLE_CAUSES = {
  taken: "that username is taken: choose another",
  reserved: "that username is reserved: choose another",
  invalid_format: "aweb does not accept that username's format (lowercase letters, numbers and hyphens): choose another",
};
/** Whether `aw init --new-account --username <u>` was refused because the
 *  username is unavailable, and why: aw's reason word, or undefined. Read from
 *  the RAW output (before any scrub, which could rewrite it) in the one shape aw
 *  prints with no terminal to prompt on, from the 1.36.33 floor to the tested
 *  1.36.58 (cmd/aw/onboarding_wizard.go resolveGuidedHostedUsername, and a
 *  signup conflict as `(taken)`): its usage error, exit status 2, with a whole
 *  stderr line `username "<u>" is not available (<reason>)` naming exactly this
 *  username. The same words inside another error (a wrapped HTTP body) are not
 *  this refusal. The reason is a short snake_case word, the shape
 *  SERVICE_DETAIL_CODE_RE admits. aw has no code for it yet
 *  (docs/aw-error-decisions.md). */
export function usernameUnavailable({ stderr, status }, username) {
  if (status !== 2 || typeof username !== "string") return undefined;
  const prefix = "username \"", middle = " is not available (";
  for (const line of String(stderr ?? "").split(/\r?\n/)) {
    if (!line.startsWith(prefix) || !line.endsWith(")")) continue;
    // aw quotes the name with Go's %q, which escapes what is not printable (an
    // invisible U+200B prints as \u200b), so the quoted name is read back, not compared as JSON.
    const quoted = goQuotedPrefix(line.slice(prefix.length - 1));
    if (!quoted || quoted.value !== username || !line.slice(prefix.length - 1 + quoted.length).startsWith(middle)) continue;
    const reason = line.slice(prefix.length - 1 + quoted.length + middle.length, -1);
    if (SERVICE_DETAIL_CODE_RE.test(reason)) return reason;
  }
  return undefined;
}
const GO_SIMPLE_ESCAPES = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, '"': 34 };
/** The Go double-quoted string literal `text` starts with (as strconv.Quote and %q write
 *  one): its value and its length in `text`, or undefined when it does not start with a
 *  complete, valid one. */
export function goQuotedPrefix(text) {
  if (text[0] !== '"') return undefined;
  const bytes = [];
  const push = s => { for (const b of Buffer.from(s, "utf8")) bytes.push(b); };
  for (let i = 1; i < text.length;) {
    const c = text[i];
    if (c === '"') {
      const value = Buffer.from(bytes).toString("utf8");
      // Invalid UTF-8 (a \xNN that is not part of a whole character) never equals a username.
      return Buffer.from(value, "utf8").equals(Buffer.from(bytes)) ? { value, length: i + 1 } : undefined;
    }
    if (c === "\n") return undefined;
    if (c !== "\\") { const cp = text.codePointAt(i); push(String.fromCodePoint(cp)); i += cp > 0xffff ? 2 : 1; continue; }
    const e = text[i + 1];
    if (e !== undefined && Object.hasOwn(GO_SIMPLE_ESCAPES, e)) { bytes.push(GO_SIMPLE_ESCAPES[e]); i += 2; continue; }
    const hex = { x: 2, u: 4, U: 8 }[e];
    if (hex) {
      const digits = text.slice(i + 2, i + 2 + hex);
      if (!new RegExp(`^[0-9a-fA-F]{${hex}}$`).test(digits)) return undefined;
      const n = parseInt(digits, 16);
      if (e === "x") bytes.push(n);
      else if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return undefined;
      else push(String.fromCodePoint(n));
      i += 2 + hex; continue;
    }
    if (/^[0-7]{3}$/.test(text.slice(i + 1, i + 4)) && parseInt(text.slice(i + 1, i + 4), 8) <= 255) { bytes.push(parseInt(text.slice(i + 1, i + 4), 8)); i += 4; continue; }
    return undefined;
  }
  return undefined;
}
/** The plain sentence for aw's reason word: a fixed one for the reasons aw 1.36.58
 *  words itself, else the word named as the service gave it. */
export function usernameUnavailableCause(reason) {
  // An own property only: a reason word such as `constructor` must not select one of Object's.
  return Object.hasOwn(USERNAME_UNAVAILABLE_CAUSES, reason) ? USERNAME_UNAVAILABLE_CAUSES[reason] : `aweb reports that username unavailable (${reason}): choose another`;
}

/** A namespace domain as aw normalizes it before it uses or prints one
 *  (awconfig.NormalizeDomain): trimmed, lowercased, without one trailing dot. */
export function normalizeAwDomain(domain) {
  const lower = String(domain ?? "").trim().toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

/** Whether `aw id team create --name <name> --namespace <domain> --json` was
 *  refused because the name is already held in the namespace under a team key
 *  that is not this machine's (awebai/oats-aweb#208). Read only from aw's --json
 *  error envelope, in exactly the two shapes aw 1.36.56 prints for it
 *  (ensureLocalTeamRegistered): "team <domain>/<name> is already pinned to
 *  <did:key>" under code `error`, and the registry's own 409 under code
 *  `http_error` ("create team at registry: ..."). A re-create with this
 *  machine's own key is not a refusal: aw answers it as created. */
export function teamNameTaken(stdout, domain, name) {
  domain = normalizeAwDomain(domain);
  let error;
  try { error = leadingJsonObject(String(stdout ?? "").trim())?.error; } catch { return false; }
  if (!error || typeof error.message !== "string") return false;
  if (error.code === "error") {
    const pinned = `team ${domain}/${name} is already pinned to did:key:`;
    return error.message.startsWith(pinned) && /^\S+$/.test(error.message.slice(pinned.length));
  }
  return error.code === "http_error" && error.http_status === 409 && error.message.startsWith("create team at registry: ");
}

/** Whether aw's --json answer to `aw id team show-server` is that no team-server record is
 *  published for `team` (aw 1.36.56 id_team_server.go:226-227: the registry's 404, a plain error). */
export function teamServerRecordMissing(stdout, team) {
  let error;
  try { error = leadingJsonObject(String(stdout ?? "").trim())?.error; } catch { return false; }
  return error?.code === "error" && error.message === `no team server record is published for ${team}`;
}
