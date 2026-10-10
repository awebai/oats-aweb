// A grant seat's expiry, from the grant recorded at its last start
// (identity.grant.expiresAt, aw's `id grant mint` expires_at), with no aw or
// custody call. aw and the aweb server cap a grant at 720h (oats-aweb#80), so
// a seat that is not restarted in time loses messaging when its grant expires.
import {parseTimestamp} from './wake-receive.mjs';

export const GRANT_EXPIRY_WARNING_MS = 7 * 24 * 3600 * 1000;

/** The remedy for an expired, expiring or unknown grant: a restart re-mints
 *  under the captured settings, which a short ttl defeats. */
export function grantExpiryRemedy(home) {
  return `restart the seat (\`oats session restart --home ${home}\`) to re-mint; a home captured with a short ttl needs a respawn`;
}

const shown = value => value === undefined ? 'absent' : JSON.stringify(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 80);

/** {problems, warnings} for the recorded `identity`: `grant-expired` at or
 *  after the expiry, `grant-expiring` within 7 days of it, and
 *  `grant-expiry-unknown` when no expiry can be read. Nothing for a seat
 *  without a grant. */
export function grantExpiryAssessment(identity, {home, now}) {
  const grant = identity?.mode === 'global' ? identity.grant : undefined;
  if (!grant || typeof grant !== 'object' || typeof grant.id !== 'string') return {problems: [], warnings: []};
  const remedy = grantExpiryRemedy(home), expiresAt = grant.expiresAt, at = parseTimestamp(expiresAt);
  if (Number.isNaN(at)) return {problems: [], warnings: [{code: 'grant-expiry-unknown', message: `grant ${grant.id} has no readable expiry (recorded expiresAt: ${shown(expiresAt)}); readiness cannot tell when it expires: ${remedy}`}]};
  if (at <= now) return {problems: [{code: 'grant-expired', message: `grant ${grant.id} expired at ${expiresAt}: ${remedy}`}], warnings: []};
  if (at - now < GRANT_EXPIRY_WARNING_MS) return {problems: [], warnings: [{code: 'grant-expiring', message: `grant ${grant.id} expires at ${expiresAt}, within 7 days: ${remedy}`}]};
  return {problems: [], warnings: []};
}
