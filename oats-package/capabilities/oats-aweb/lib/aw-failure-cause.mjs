// The cause of a failed aw call whose output is withheld because it can hold a
// credential (an invite mint), named from a fixed vocabulary: aw's own text is
// matched, never relayed (awebai/oats-aweb#52).

/** The refusal codes read from aw's --json error envelope
 *  (`{"error":{"code":...}}`, aw 1.36.52-rc.3 and later). A code is a fixed
 *  word, so naming it leaks nothing; anything else is never read. */
export const AW_ERROR_CODES = new Set(["unknown_or_invalid"]);

/** Transport failures as Go's net/http and crypto/tls word them. */
const NETWORK_FAILURE_RE = /\b(?:dial tcp|no such host|connection refused|connection reset|network is unreachable|i\/o timeout|context deadline exceeded)\b|\btls: |\bx509: /i;

/** The cause of a failure with no HTTP status: aw's allowlisted error `code`
 *  (read by the caller from stdout), else a network or TLS failure seen in
 *  `text`, else that the output held none of these. */
export function withheldFailureCause({ text, code }) {
  if (AW_ERROR_CODES.has(code)) return `aw error ${code}`;
  if (NETWORK_FAILURE_RE.test(String(text ?? ""))) return "the aweb service could not be reached: a network or TLS failure";
  return "no HTTP status, aw error code or network failure in its output";
}
