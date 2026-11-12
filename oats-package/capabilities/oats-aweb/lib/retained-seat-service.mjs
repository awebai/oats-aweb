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

const AWEB_URL_LINE = /^aweb_url:[ \t]*(.*)$/m;

/** The `aweb_url` scalar of a workspace.yaml, as written: quotes removed, an unquoted value cut
 *  at a ` #` comment. A quoted value that is not closed, or is followed by anything but a
 *  comment, is returned whole, so it fails the shape below instead of being cut to one. */
function recordedAwebUrl(text) {
  const line = AWEB_URL_LINE.exec(text);
  if (!line) return undefined;
  const value = line[1], quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1), rest = end < 0 ? '' : value.slice(end + 1).trim();
    return end < 0 || (rest && !rest.startsWith('#')) ? value : value.slice(1, end);
  }
  return value.replace(/[ \t]+#.*$/, '').replace(/[ \t\r]+$/, '');
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
  return { service: seatServiceUrl(recorded), serviceRecorded: recorded !== undefined };
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
