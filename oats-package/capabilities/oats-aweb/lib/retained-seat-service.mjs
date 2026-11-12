// The aweb service a retained seat (identity.source) is bound on, and the refusal when it is
// unknown: one resolver for the spawn, its rollback, the rebind command a retire prints and
// soul-scope readiness, so they never name different servers and readiness predicts the
// spawn's refusal. The service comes only from the seat's own record, its source's
// workspace.yaml `aweb_url` (aw writes it at `aw workspace connect`), and only when that is a
// plain service URL; OATS_AWEB_URL is never read for it (awebai/oats-aweb#241).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { plainServiceUrl } from './plain-service.mjs';

const AWEB_URL_RE = /^aweb_url:\s*["']?([^"'\n#]+)["']?\s*$/m;

/** `{service, serviceRecorded}` for the seat at `source`: `service` is the plain service URL
 *  its record names, else undefined; `serviceRecorded` tells a missing `aweb_url` from one that
 *  is not a plain service URL. */
export function retainedSeatService(source) {
  let text = '';
  try { text = readFileSync(join(source, 'workspace.yaml'), 'utf8'); } catch { /* no record */ }
  const recorded = AWEB_URL_RE.exec(text)?.[1].trim();
  return { service: plainServiceUrl(recorded), serviceRecorded: recorded !== undefined };
}

/** OATS_AWEB_URL was the retained seat's service before #241; whether it is still set, to say
 *  it is no longer read. Its value is never shown. */
export const awebUrlVariableSet = (env = process.env) => typeof env.OATS_AWEB_URL === 'string' && env.OATS_AWEB_URL !== '';

/** The refusal for a seat whose record names no usable service. Fixed text and the operator's
 *  own paths only, naming the whole fix. */
export function unknownSeatServiceMessage(source, serviceRecorded, env = process.env) {
  const record = join(source, 'workspace.yaml');
  const why = serviceRecorded
    ? `the aweb_url in ${record} is not a plain service URL (http or https, a host, an optional port, and no path but / or /api)`
    : `${record} names no aweb_url`;
  const note = awebUrlVariableSet(env) ? '; OATS_AWEB_URL is set, but it is no longer read for a retained seat: the service comes only from that workspace.yaml' : '';
  return `the retained seat's aweb service is unknown, so its spawn refuses before copying anything: ${why}; run \`aw workspace connect --service <the team's aweb server>\` in ${dirname(source)} to record it, then spawn again${note}`;
}
