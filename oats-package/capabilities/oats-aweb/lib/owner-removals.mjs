// Members that retires on this host handed to their team's owner. When the server has
// revoked an identity's own certificate (aw's `certificate_revoked`), the identity can never
// finish its own retirement: the team's owner removes the member, by its member address,
// with the command retire prints.
import { AWEB_ALIAS_RE, validAwebTeamId } from "./aweb-team-id.mjs";

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
