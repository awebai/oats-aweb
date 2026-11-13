// The A5 scan (spec human-ids-acxy7 C-5): the known places where this host's
// user can reach a protected human, namespace-controller or team-controller
// key, reported as package 8 findings in the contract's §7 fields. A path-only
// scan reports what it finds and never certifies isolation: it never says
// "clean", an unreadable place is `unknown`, and the human keychain, which aw
// can't inventory at the pinned commit, is always `unknown`. It reads names,
// never contents, and deletes, moves or rotates nothing.
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** aw's own stores (aweb cli/go/awconfig): the current one under ~/.awid and
 *  the legacy one under ~/.config/aw. A legacy minting root runs as this
 *  user, so these are the stores it references too. */
const LOCATIONS = [
  { custody: "namespace-controller", dir: [".awid", "controllers"] },
  { custody: "namespace-controller", dir: [".config", "aw", "controllers"] },
  { custody: "team-controller", dir: [".awid", "team-keys"] },
  { custody: "team-controller", dir: [".config", "aw", "team-keys"] },
  { custody: "team-invite", dir: [".config", "aw", "team-invites"] },
];
const ACTION = "migrate this key into protected custody with aweb's package 8 (aweb-acxy.8), then rerun setup";

/** Every finding and every unknown, for `deployment` and `service` (ids only).
 *  `consumer` names this provider and its version. */
export function scanProtectedKeys({ home, deployment, service, consumer }) {
  const findings = [], unknown = [];
  const base = { deployment, service: service ?? null, consumer };
  for (const { custody, dir } of LOCATIONS) {
    const path = join(home, ...dir);
    let names;
    try { names = readdirSync(path); }
    catch (e) {
      if (e.code === "ENOENT") continue;
      unknown.push({ ...base, custody, reference: path, readiness: "protected-key-inventory-unknown", reason: e.code || "unreadable" });
      continue;
    }
    for (const name of names.sort()) findings.push({ ...base, custody, reference: join(path, name), ...(custody === "team-controller" ? { team: `namespace ${name}` } : {}), readiness: "protected-key-reachable", action: ACTION });
  }
  unknown.push({ ...base, custody: "human-keychain", reference: "the OS keychain", readiness: "protected-key-inventory-unknown", reason: "aw has no keychain inventory read at the pinned aw" });
  return { findings, unknown };
}
