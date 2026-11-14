// Home readiness on an opted-in deployment (spec v4.3.18 C-5), only with the
// home's captured setting: the home's own chain (`aw who`, read-only), the
// admissions it holds, what the pinned aw lacks, and the A5 scan's findings.
// Readiness never calls the protected service.
import { join } from "node:path";
import { admissionRecords } from "./admission.mjs";
import { outcomeUnknown } from "./admission-states.mjs";
import { README_REVOCATION, readWho } from "./attribution.mjs";
import { REMOVE_SERVED } from "./protected-client.mjs";

/** The warnings for `home`, whose recorded meta is `meta`. `aw(argv)` runs aw
 *  (argv without "aw") and returns stdout; `scan()` is the A5 scan's {findings}. */
export function attributionReadiness({ aw, home, meta, scan, removeServed = REMOVE_SERVED }) {
  const warnings = [];
  const recorded = meta?.identity?.attribution;
  if (recorded?.mode === "human") {
    const verdict = readWho(aw, join(home, ".aw"));
    if (verdict.kind === "revoked") warnings.push({ code: "attribution-revoked", message: `this home's chain is revoked or replaced (${verdict.reason}), so it no longer acts for ${recorded.human?.label || "its human"} → respawn it once the deployment has a new root (${README_REVOCATION})` });
    else if (!(verdict.kind === "verified" && verdict.humanId === recorded.human?.id)) warnings.push({ code: "attribution-unverified", message: `this home's chain couldn't be verified (${verdict.kind === "verified" ? `it verifies to ${verdict.humanId ?? "no human"}` : `${verdict.kind}: ${verdict.reason ?? "no reason"}`}), so its next start records it unattributed → retry once the identity registry answers, or respawn to attribute it` });
  } else if (meta?.identity) warnings.push({ code: "attribution-spawner-unchained", message: "this home has no identity chain, so each child it spawns is admitted with none and attributed to nobody → respawn it from a person to attribute its children" });
  for (const r of admissionRecords(home)) if (outcomeUnknown(r)) warnings.push({ code: "admission-leaked", message: `the admission to ${r.team} (operation ${r.operationId}) has an unknown outcome, so a membership may exist that no OATS record holds → retiring this home resumes it; check-only lists any leak under leakedMemberships` });
  if (!removeServed) warnings.push({ code: "admission-removal-unavailable", message: "the pinned aw doesn't serve team.agent.remove yet: retiring an instance frees no admission slot" });
  for (const f of scan().findings) warnings.push({ code: "protected-key-reachable", message: `${f.reference} (${f.custody}) is reachable by this host's user → ${f.action}` });
  return warnings;
}
