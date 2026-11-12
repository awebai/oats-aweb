// The aweb service a retained seat (identity.source) is bound on, and the refusal when it is
// unknown: one resolver for the spawn, its rollback, the rebind a retire prints and soul-scope
// readiness, so they never name different servers and readiness predicts the spawn's refusal.
// The service comes only from the seat's own record, its source's workspace.yaml `aweb_url`
// (aw writes it at `aw workspace connect`); OATS_AWEB_URL is never read for it
// (awebai/oats-aweb#241). Any http(s) URL with a host is accepted, a path prefix or an IPv6
// literal included, as aw takes any base URL; it reaches aw only as one argv element and is
// never printed. A command shown to a person names it only when it is also a plain service URL
// (lib/plain-service.mjs).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The `aweb_url` scalar of a workspace.yaml, as aw writes it: one line, quotes removed, an
 *  unquoted value cut at a ` #` comment. Lines end only at `\n` (a `\r` before it is dropped),
 *  so a Unicode line separator stays in the value and fails its shape below. undefined when
 *  there is no `aweb_url`; null for a record this reader does not take whole (a second
 *  `aweb_url`, a value continued on an indented line, a quoted value not closed or followed by
 *  more than a comment), so that it is refused rather than cut to a prefix. */
function recordedAwebUrl(text) {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  const at = lines.flatMap((line, i) => (line.startsWith('aweb_url:') ? [i] : []));
  if (at.length === 0) return undefined;
  if (at.length > 1) return null;
  const value = lines[at[0]].slice('aweb_url:'.length).replace(/^[ \t]+/, '');
  if (value && !/^[ \t]/.test(lines[at[0]].slice('aweb_url:'.length))) return null;
  for (const next of lines.slice(at[0] + 1)) {
    if (!/^[ \t]/.test(next)) break;
    if (!/^[ \t]*(#.*)?$/.test(next)) return null;
  }
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1), rest = end < 0 ? '' : value.slice(end + 1).trim();
    return end < 0 || (rest && !rest.startsWith('#')) ? null : value.slice(1, end);
  }
  return value.replace(/[ \t]+#.*$/, '').replace(/[ \t]+$/, '');
}

/** `value` when it is a service URL a retained seat may be bound on, else undefined: http or
 *  https and a host, with no userinfo, query or fragment, at most 2048 characters. The raw
 *  string is checked before it is parsed, because WHATWG URL parsing drops tabs and newlines
 *  and reads a backslash as a slash, and the raw string is what aw receives. */
export function seatServiceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  if (/[\p{White_Space}\p{Cc}\p{Cf}\\?#]/u.test(value)) return undefined;
  const authority = /^https?:\/\/([^/]*)/i.exec(value)?.[1];
  if (!authority || authority.includes('@')) return undefined;
  try { return new URL(value).hostname ? value : undefined; } catch { return undefined; }
}

/** `{service, serviceRecorded}` for the seat at `source`: `service` is the service URL its
 *  record names, when it passes seatServiceUrl, else undefined; `serviceRecorded` tells a
 *  missing `aweb_url` from one that does not pass. */
export function retainedSeatService(source) {
  let text = '';
  try { text = readFileSync(join(source, 'workspace.yaml'), 'utf8'); } catch { /* no record */ }
  const recorded = recordedAwebUrl(text);
  return { service: recorded ? seatServiceUrl(recorded) : undefined, serviceRecorded: recorded !== undefined };
}

/** OATS_AWEB_URL was the retained seat's service before #241; whether it is still set, to say
 *  it is no longer read. Its value is never shown. */
export const awebUrlVariableSet = (env = process.env) => typeof env.OATS_AWEB_URL === 'string' && env.OATS_AWEB_URL !== '';

/** The refusal for a seat whose record names no usable service. Fixed text and the operator's
 *  own paths only, naming the whole fix. */
export function unknownSeatServiceMessage(source, serviceRecorded, env = process.env) {
  const record = join(source, 'workspace.yaml');
  const why = serviceRecorded
    ? `the aweb_url in ${record} is not a usable service URL (http or https and a host, with no userinfo, query, fragment, whitespace or control characters)`
    : `${record} names no aweb_url`;
  const note = awebUrlVariableSet(env) ? '; OATS_AWEB_URL is set, but it is no longer read for a retained seat: the service comes only from that workspace.yaml' : '';
  return `the retained seat's aweb service is unknown, so its spawn refuses before copying anything: ${why}; run \`aw workspace connect --service <the team's aweb server>\` in ${dirname(source)} to record it, then spawn again${note}`;
}
