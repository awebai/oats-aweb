// Grants a seat minted or held but could not revoke. A grant stays a live
// credential until it is revoked (a never-grant) or lapses, so each one is
// kept in the home's provider state (.oats-aweb, disposable for retire's
// recovery copy, like teams.json) until a later start or retire revokes it.
// An entry holds the grant id, the custody directory the revoke runs in, the
// team and the recorded expiry (for how long the grant stays valid): no keys.
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const file = home => join(home, '.oats-aweb', 'pending-revokes.json');
const entryShape = e => e && typeof e === 'object' && typeof e.grant === 'string' && e.grant && typeof e.custody === 'string' && e.custody;

/** The pending entries, [] when there are none. A malformed record throws. */
export function readPendingRevokes(home) {
  if (!home || !existsSync(file(home))) return [];
  const doc = JSON.parse(readFileSync(file(home), 'utf8'));
  if (!doc || !Array.isArray(doc.pending) || !doc.pending.every(entryShape)) throw new Error(`${file(home)} is malformed`);
  return doc.pending;
}

function writePendingRevokes(home, pending) {
  if (!pending.length) { rmSync(file(home), {force: true}); return; }
  mkdirSync(join(home, '.oats-aweb'), {recursive: true, mode: 0o700});
  writeFileSync(file(home), JSON.stringify({pending}, null, 2) + '\n', {mode: 0o600});
}

/** Record a grant that could not be revoked (once per grant id). */
export function addPendingRevoke(home, {grant, custody, team, expiresAt}) {
  const pending = readPendingRevokes(home).filter(e => e.grant !== grant);
  writePendingRevokes(home, [...pending, {grant, custody, ...(team ? {team} : {}), ...(expiresAt ? {expiresAt} : {})}]);
}

/** Try every pending revoke with `revoke(custody, grant)`; keep the ones that
 *  fail. Returns {revoked, remaining}. */
export function retryPendingRevokes(home, revoke) {
  const revoked = [], remaining = [];
  for (const entry of readPendingRevokes(home)) {
    try { revoke(entry.custody, entry.grant); revoked.push(entry); }
    catch (error) { remaining.push({...entry, error: String(error?.message || error).slice(0, 200)}); }
  }
  writePendingRevokes(home, remaining.map(({error, ...entry}) => entry));
  return {revoked, remaining};
}

/** How long a grant that could not be revoked stays valid, and how to revoke
 *  it: a never-grant ends only when revoked. */
export function unrevokedGrant({grant, expiresAt, custody}) {
  const until = expiresAt === 'never' ? 'until revoked' : `until ${expiresAt || 'its TTL'} unless revoked`;
  return `grant ${grant} stays valid ${until}: run \`aw id grant revoke ${grant}\` in ${custody}`;
}
