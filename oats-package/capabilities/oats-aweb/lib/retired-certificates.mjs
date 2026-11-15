// The host's record of certificates that retires left in a people-controlled team.
// `aw workspace delete` cannot remove the member certificate of a team whose controller
// key is held by people (alias_released_reason team_not_hosted): only that controller
// can, with the command retire prints. Retire records each such certificate here, at
// <deployment>/.oats-aweb/retired-certificates.json, so `oats aweb roster` on this host
// can mark the leftover member and print that command. The record holds certificate ids,
// registry origins and commands only, never a secret, and lives only on the host where the
// retire ran.
//
// Any agent running as the deployment's user can write the record, so no text from it
// reaches a person as a command: retire and roster both build the controller's command
// with controllerCleanupCommand, from a validated team, certificate id and registry. The
// stored `command` is written (rebuilt) for older providers that require it, and never read.
//
// Retire writes the record and roster reads it through lib/host-record.mjs: the writers'
// lock, the merge under it, and the atomic rename readers rely on.
import { validAwebTeamId } from "./aweb-team-id.mjs";
import { hostRecordDir, hostRecordFile, readHostRecord, writeHostRecord } from "./host-record.mjs";
import { registryOriginUrl } from "./plain-service.mjs";

export const RETIRED_RECORD_MAX = 500;
const RECORD_NAME = "retired-certificates.json";

export const retiredRecordDir = (deployment) => hostRecordDir(deployment);
export const retiredRecordFile = (deployment) => hostRecordFile(deployment, RECORD_NAME);

const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";
const nullableString = (v) => v === null || typeof v === "string";
/** An entry the record may hold: everything roster shows is present and typed. */
const validEntry = (e) => !!e && typeof e === "object" && !Array.isArray(e)
  && nonEmpty(e.team) && nonEmpty(e.certificateId) && nonEmpty(e.command)
  && typeof e.retiredAt === "string" && !Number.isNaN(Date.parse(e.retiredAt))
  && nullableString(e.alias) && nullableString(e.instance);
const keyOf = (e) => `${e.team}\u0000${e.certificateId}`;

// A certificate id as aw issues them (a UUID): letters, digits, `_` and `-`, starting with
// a letter or digit so it can never read as a flag.
const CERTIFICATE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Why no controller cleanup command can be built from `{team, certificateId, registry}`, or
 *  undefined when one can. `registry` is optional: undefined or null builds a command without
 *  --registry. The reason is fixed text and never echoes the value. */
export function controllerCleanupProblem({ team, certificateId, registry } = {}) {
  if (typeof team !== "string" || !validAwebTeamId(team)) return "its team is not a valid aweb team id";
  if (typeof certificateId !== "string" || !CERTIFICATE_ID_RE.test(certificateId)) return "its certificate id is not valid";
  if (registry != null && !registryOriginUrl(registry)) return "its registry is not a plain registry origin";
  return undefined;
}

/** The command the team's controller runs to remove a member certificate, built only from
 *  validated values; undefined when any of them is invalid (controllerCleanupProblem). */
export function controllerCleanupCommand({ team, certificateId, registry } = {}) {
  if (controllerCleanupProblem({ team, certificateId, registry })) return undefined;
  const [name, namespace] = team.split(":");
  return `aw id team remove-member --namespace ${namespace} --team ${name} --cert-id ${certificateId}${registry ? ` --registry ${registry}` : ""} --json`;
}

/** The record's entries for roster. `missing` when there is no file; `problem` (a fixed
 *  message) when it cannot be read or is malformed, and then no entries. */
export function readRetiredRecord(deployment) {
  return readHostRecord(deployment, RECORD_NAME, validEntry, {
    unreadable: "the record of certificates OATS retired on this host could not be read; nothing from it is shown",
    malformed: "the record of certificates OATS retired on this host is malformed; nothing from it is shown",
  });
}

/** Records `entries` ({team, certificateId, registry, alias, instance, retiredAt}) at the
 *  deployment, each with the command controllerCleanupCommand builds from it, replacing any
 *  entry with the same team and certificate id and keeping the newest RETIRED_RECORD_MAX.
 *  Entries no command can be built for (no or an invalid certificate id, team or registry)
 *  are skipped: nothing could be shown for them. Never throws: returns `cause`, the fixed cause of what went wrong, if
 *  anything did (an unreadable or malformed record is replaced, and said so). */
export function recordRetiredCertificates(deployment, entries, { lockWaitMs } = {}) {
  try {
    const fresh = entries
      .map((e) => ({ team: e?.team, certificateId: e?.certificateId, alias: e?.alias ?? null, instance: e?.instance ?? null, retiredAt: e?.retiredAt, registry: e?.registry ?? null, command: controllerCleanupCommand({ team: e?.team, certificateId: e?.certificateId, registry: e?.registry }) }))
      .filter(validEntry);
    if (!fresh.length) return {};
    return writeHostRecord(deployment, RECORD_NAME, fresh, { valid: validEntry, keyOf, max: RETIRED_RECORD_MAX, lockWaitMs });
  } catch {
    return { cause: "the record could not be written" };
  }
}
