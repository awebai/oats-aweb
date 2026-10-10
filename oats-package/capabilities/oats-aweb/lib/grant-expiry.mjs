// A grant seat's expiry, from the grant recorded at its last mint
// (identity.grant.expiresAt, aw's `id grant mint` expires_at), with no aw or
// custody call. aw and the aweb server cap a grant at 720h (oats-aweb#80), so
// a seat that is not restarted in time loses messaging when its grant expires.
import {parseTimestamp} from './wake-receive.mjs';
import {DEFAULT_GRANT_TTL, durationNanoseconds} from './grant-duration.mjs';

export const GRANT_EXPIRY_WARNING_MS = 7 * 24 * 3600 * 1000;

/** True when the grant records the ttl it was minted with and that ttl is not
 *  the default. Grants minted before oats.aweb 1.25.0 record none. */
function explicitShortTtl(ttl) {
  if (typeof ttl !== 'string') return false;
  try { return durationNanoseconds(ttl) !== durationNanoseconds(DEFAULT_GRANT_TTL); } catch { return false; }
}

/** This seat's remedy, from the renew mode and ttl its grant recorded. A
 *  restart re-mints only under renew: launch, and with the captured ttl, so
 *  renew: off and an explicit non-default ttl need a respawn. A grant minted
 *  before oats.aweb 1.25.0 records neither and gets a remedy true for both. */
export function grantExpiryRemedy(home, grant) {
  const restart = `restart the seat to renew it (\`oats session restart --home ${home}\`)`;
  if (grant?.renew === 'off') return 'respawn the seat (or set `renew: launch` and respawn): with renew off a restart keeps this grant';
  if (explicitShortTtl(grant?.ttl)) return `respawn the seat: it captured identity.ttl ${grant.ttl}, which a restart would mint again`;
  if (grant?.renew === 'launch') return restart;
  return `${restart}; if its identity.renew is off or it captured a short identity.ttl, respawn it instead`;
}

const shown = value => value === undefined ? 'absent' : JSON.stringify(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 80);

/** {problems, warnings} for the recorded `identity`: `grant-expired` at or
 *  after the expiry, `grant-expiring` within 7 days of it, and
 *  `grant-expiry-unknown` when no expiry can be read. Nothing for a seat
 *  without a grant. */
export function grantExpiryAssessment(identity, {home, now}) {
  const grant = identity?.mode === 'global' ? identity.grant : undefined;
  if (!grant || typeof grant !== 'object' || typeof grant.id !== 'string') return {problems: [], warnings: []};
  const remedy = grantExpiryRemedy(home, grant), expiresAt = grant.expiresAt, at = parseTimestamp(expiresAt);
  if (Number.isNaN(at)) return {problems: [], warnings: [{code: 'grant-expiry-unknown', message: `grant ${grant.id} has no readable expiry (recorded expiresAt: ${shown(expiresAt)}), so readiness does not know when it expires: ${remedy}`}]};
  if (at <= now) return {problems: [{code: 'grant-expired', message: `grant ${grant.id} expired at ${expiresAt}: ${remedy}`}], warnings: []};
  if (at - now < GRANT_EXPIRY_WARNING_MS) return {problems: [], warnings: [{code: 'grant-expiring', message: `grant ${grant.id} expires at ${expiresAt}, within 7 days: ${remedy}`}]};
  return {problems: [], warnings: []};
}
