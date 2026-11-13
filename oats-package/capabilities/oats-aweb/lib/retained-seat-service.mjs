// The aweb service a retained seat (identity.source) is bound on, and the refusal when it is
// unknown: one resolver for the spawn, its rollback, the rebind a retire prints and soul-scope
// readiness, so they never name different servers and readiness predicts the spawn's refusal.
// The service comes only from the seat's own record, its source's workspace.yaml `aweb_url`
// (aw writes it at `aw workspace connect`); OATS_AWEB_URL is never read for it
// (awebai/oats-aweb#241), read in the grammar aw writes (lib/aw-record.mjs). Any http(s) URL with a host is accepted, a path prefix or an IPv6
// literal included, as aw takes any base URL; it reaches aw only as one argv element and is
// never printed. A command shown to a person names it only when it is also a plain service URL
// (lib/plain-service.mjs).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readAwebUrl } from './aw-record.mjs';

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

/** The service a workspace.yaml's text records, read in aw's grammar (lib/aw-record.mjs):
 *  `service`, its top-level aweb_url when that passes seatServiceUrl, and `record`, why there is
 *  none: 'missing' (no aweb_url), 'unusable' (an aweb_url that does not pass, a key with no value
 *  included) or 'outside' (a file outside aw's grammar, from which nothing is taken). */
export function seatServiceFromRecord(text) {
  const read = readAwebUrl(text);
  if (!read) return { service: undefined, record: 'outside' };
  const service = typeof read.awebUrl === 'string' ? seatServiceUrl(read.awebUrl) : undefined;
  return { service, record: service ? 'ok' : read.awebUrl === undefined ? 'missing' : 'unusable' };
}

/** seatServiceFromRecord for the seat at `source`: its `<source>/workspace.yaml`, none when it
 *  cannot be read. */
export function retainedSeatService(source) {
  let text = '';
  try { text = readFileSync(join(source, 'workspace.yaml'), 'utf8'); } catch { /* no record */ }
  return seatServiceFromRecord(text);
}

/** OATS_AWEB_URL was the retained seat's service before #241; whether it is still set, to say
 *  it is no longer read. Its value is never shown. */
export const awebUrlVariableSet = (env = process.env) => typeof env.OATS_AWEB_URL === 'string' && env.OATS_AWEB_URL !== '';

/** The refusal for a seat whose record names no usable service. Fixed text and the operator's
 *  own paths only, naming the whole fix. */
export function unknownSeatServiceMessage(source, recordState, env = process.env) {
  const record = join(source, 'workspace.yaml');
  const why = recordState === 'outside'
    ? `${record} is not in the form aw writes (a top-level key and its value on one line, nested lines only under a key with no value; no flow collections, block or multi-line scalars, escapes, anchors, tags, quoted keys or document markers)`
    : recordState === 'unusable'
      ? `the aweb_url in ${record} is not a usable service URL (http or https and a host, with no userinfo, query, fragment, whitespace or control characters)`
      : `${record} names no aweb_url`;
  const note = awebUrlVariableSet(env) ? '; OATS_AWEB_URL is set, but it is no longer read for a retained seat: the service comes only from that workspace.yaml' : '';
  return `the retained seat's aweb service is unknown, so its spawn refuses before copying anything: ${why}; run \`aw workspace connect --service <the team's aweb server>\` in ${dirname(source)} to record it, then spawn again${note}`;
}
