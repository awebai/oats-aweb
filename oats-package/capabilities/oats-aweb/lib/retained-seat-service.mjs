// A retained seat's (identity.source) pre-effect check, and the aweb service and team it is
// bound with: one predicate for the spawn, its rollback, the rebind a retire prints and
// soul-scope readiness, so they never name different servers or teams and readiness reports
// each refusal the spawn makes from the soul's settings and the source (retainedSeatCheck).
// The service comes only from the seat's own record, its source's workspace.yaml `aweb_url`
// (aw writes it at `aw workspace connect`); OATS_AWEB_URL is never read for it
// (awebai/oats-aweb#241), read in the grammar aw writes (lib/aw-record.mjs). Any http(s) URL with a host is accepted, a path prefix or an IPv6
// literal included, as aw takes any base URL; it reaches aw only as one argv element and is
// never printed. A command shown to a person names it only when it is also a plain service URL
// (lib/plain-service.mjs).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readAwebUrl } from './aw-record.mjs';
// binding-wire imports this module too; these are read only when a function runs, as
// resident-registry.mjs reads yamlScalar.
import { NO_TEAMS_MESSAGE, unmappedDefaultMessage, yamlScalar } from './binding-wire.mjs';

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

const envText = (env, name) => typeof env[name] === 'string' && env[name].trim() ? env[name].trim() : undefined;

/** The team a retained seat at `source` is bound on: the kernel's default team id
 *  (OATS_DEFAULT_TEAM_ID), else the active team in `<source>/teams.yaml`; undefined when neither
 *  names a team id. */
export function retainedSeatTeam(source, env = process.env) {
  let teams = '';
  try { teams = readFileSync(join(source, 'teams.yaml'), 'utf8'); } catch { /* no teams file */ }
  const team = envText(env, 'OATS_DEFAULT_TEAM_ID') || yamlScalar(teams, 'active_team') || yamlScalar(teams, 'active');
  return team && team.includes(':') ? team : undefined;
}

/** The seat at `source`, as its spawn checks it before any effect: `refusal`, the text of the
 *  first refusal in the order the spawn makes them (the source is not an absolute path; it holds
 *  no signing.key; it records no usable aweb_url; no team can be determined), or undefined; and
 *  the `service`, `record` and `team` it would be bound with, read whatever the refusal, so a
 *  retire still names them. A lock another seat holds is not checked here: it is live state at
 *  spawn time, not configuration, so readiness does not report it and the spawn checks it after
 *  this. */
export function retainedSeatCheck(source, env = process.env) {
  if (typeof source !== 'string' || !source.startsWith('/')) return { refusal: 'identity.source must be the absolute path of the legacy .aw directory to retain' };
  const { service, record } = retainedSeatService(source);
  const team = retainedSeatTeam(source, env);
  const label = envText(env, 'OATS_DEFAULT_TEAM');
  const teamRemedy = label && !envText(env, 'OATS_DEFAULT_TEAM_ID') ? unmappedDefaultMessage(label) : NO_TEAMS_MESSAGE;
  const refusal = !existsSync(join(source, 'signing.key'))
    ? `identity.source ${source} holds no signing.key, so there is no identity to retain; set identity.source to the member's .aw directory, the one that holds its signing.key`
    : !service ? unknownSeatServiceMessage(source, record, env)
      : !team ? `cannot determine the team for the retained identity (${teamRemedy}, or keep an active team in ${join(source, 'teams.yaml')})`
        : undefined;
  return { refusal, service, record, team };
}
