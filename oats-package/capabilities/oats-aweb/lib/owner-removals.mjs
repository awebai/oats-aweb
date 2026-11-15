// Members that retires on this host handed to their team's owner. When the server has
// revoked an identity's own certificate (aw's `certificate_revoked`), the identity can never
// finish its own retirement: the team's owner removes the member, by its member address,
// with the command retire prints. The kernel keeps no hook output once it removes the home,
// so retire records each such member here, at <deployment>/.oats-aweb/owner-removals.json,
// for `oats aweb roster` on this host to show. The record lives only on the host where the
// retire ran.
//
// The record holds data only: team, alias, certificate id (when the home could read it),
// instance and time. Any agent running as the deployment's user can write it, so the
// owner's command is never stored: retire and roster build it with ownerRemovalCommand
// from a validated team and alias. It is a file of its own, not entries in
// retired-certificates.json: homes pin their own provider copy, and an older provider
// replaces that record whole when it finds an entry it does not know.
//
// An entry leaves the record only by the cap: the newest OWNER_REMOVALS_MAX are kept.
// Roster never writes it.
import { AWEB_ALIAS_RE, validAwebTeamId } from "./aweb-team-id.mjs";
import { readHostRecord, writeHostRecord } from "./host-record.mjs";
import { validCertificateId } from "./retired-certificates.mjs";

export const OWNER_REMOVALS_MAX = 500;
const RECORD_NAME = "owner-removals.json";

/** Why no owner removal command can be built from `{team, alias}`, or undefined when one
 *  can. The reason is fixed text and never echoes the value. */
export function ownerRemovalProblem({ team, alias } = {}) {
  if (typeof team !== "string" || !validAwebTeamId(team)) return "its team is not a valid aweb team id";
  if (typeof alias !== "string" || !AWEB_ALIAS_RE.test(alias)) return "its alias is not a valid aweb alias";
  return undefined;
}

/** The command the team's owner runs to remove the member `alias` of `team`, built only
 *  from validated values; undefined when either is invalid (ownerRemovalProblem). */
export function ownerRemovalCommand({ team, alias } = {}) {
  if (ownerRemovalProblem({ team, alias })) return undefined;
  const namespace = team.slice(team.indexOf(":") + 1);
  return `aw team admin remove-agent ${namespace}/${alias} --team-id ${team}`;
}

const nullableString = (v) => v === null || typeof v === "string";
/** An entry the record may hold: an owner command can be built from it, and the rest is typed. */
const validEntry = (e) => !!e && typeof e === "object" && !Array.isArray(e)
  && !ownerRemovalProblem(e)
  && (e.certificateId === null || validCertificateId(e.certificateId))
  && nullableString(e.instance)
  && typeof e.retiredAt === "string" && !Number.isNaN(Date.parse(e.retiredAt));
// One entry per instance's member: a retire run again replaces its own entry.
const keyOf = (e) => `${e.team}\u0000${e.alias}\u0000${e.instance ?? ""}`;

/** The record's entries for roster. `missing` when there is no file; `problem` (a fixed
 *  message) when it cannot be read or is malformed, and then no entries. */
export function readOwnerRemovals(deployment) {
  return readHostRecord(deployment, RECORD_NAME, validEntry, {
    unreadable: "the record of members OATS handed to their team's owner on this host could not be read; nothing from it is shown",
    malformed: "the record of members OATS handed to their team's owner on this host is malformed; nothing from it is shown",
  });
}

/** Records `entries` ({team, alias, certificateId, instance, retiredAt}) at the deployment,
 *  replacing an entry of the same instance's member and keeping the newest
 *  OWNER_REMOVALS_MAX. Entries no owner command can be built from are skipped: nothing could
 *  be shown for them. Never throws: returns `cause`, the fixed cause of what went wrong, if
 *  anything did (an unreadable or malformed record is replaced, and said so). */
export function recordOwnerRemovals(deployment, entries, { lockWaitMs } = {}) {
  try {
    const fresh = entries
      .map((e) => ({ team: e?.team, alias: e?.alias, certificateId: e?.certificateId ?? null, instance: e?.instance ?? null, retiredAt: e?.retiredAt }))
      .filter(validEntry);
    if (!fresh.length) return {};
    return writeHostRecord(deployment, RECORD_NAME, fresh, { valid: validEntry, keyOf, max: OWNER_REMOVALS_MAX, lockWaitMs });
  } catch {
    return { cause: "the record could not be written" };
  }
}
