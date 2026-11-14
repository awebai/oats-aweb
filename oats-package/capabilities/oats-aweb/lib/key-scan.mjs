// The A5 scan (spec human-ids-acxy7 C-5): the known places where this host's
// user can reach a protected human, namespace-controller or team-controller
// key, reported as package 8 findings in the contract's §7 fields. A path-only
// scan reports what it finds and never certifies isolation: it never says
// "clean", an unreadable place is `unknown`, and the human keychain, which aw
// can't inventory at the pinned commit, is always `unknown`. It reads names,
// never contents, and deletes, moves or rotates nothing.
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

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

const ROOT_ACTION = "left untouched: on an opted-in deployment it mints nothing; package 8 (aweb-acxy.8) inventories and migrates the team keys it references";

/** The deployment's legacy minting roots (contract §7), as package 8 inventory: the configured
 *  `root` (the default team's) and `roots[team]`, the deployment directory's own `.aw` and each
 *  `.aweb-roots/<label>/.aw`. Each is an agent identity, so it is listed, never refused: by its
 *  public id (identity.yaml's did), never its key. A configured root that can't be read is
 *  `unknown`, never absent. `root` and `roots` are settings.oats.aweb's values. */
export function legacyRootInventory({ deployment, root, roots, defaultTeam, service, consumer }) {
  const base = { deployment, service: service ?? null, consumer, custody: "legacy-minting-root" };
  const candidates = [];
  if (typeof root === "string" && root.trim()) candidates.push({ dir: root.trim(), selectedBy: "settings.oats.aweb.root", team: defaultTeam ?? null, configured: true });
  if (roots && typeof roots === "object" && !Array.isArray(roots)) for (const [team, dir] of Object.entries(roots)) if (typeof dir === "string" && dir.trim()) candidates.push({ dir: dir.trim(), selectedBy: `settings.oats.aweb.roots[${JSON.stringify(team)}]`, team, configured: true });
  if (typeof deployment === "string" && isAbsolute(deployment)) {
    candidates.push({ dir: deployment, selectedBy: "the deployment directory", team: null });
    let labels = [];
    try { labels = readdirSync(join(deployment, ".aweb-roots")).sort(); } catch { labels = []; }
    for (const label of labels) candidates.push({ dir: join(deployment, ".aweb-roots", label), selectedBy: `.aweb-roots/${label}`, team: null, label });
  }
  const entries = [], seen = new Map();
  for (const c of candidates) {
    if (!isAbsolute(c.dir)) { entries.push({ ...base, reference: c.dir, team: c.team, selectedBy: c.selectedBy, readiness: "protected-key-inventory-unknown", reason: "not an absolute path" }); continue; }
    const reference = join(resolve(c.dir), ".aw");
    const known = seen.get(reference);
    if (known) { if (!known.team && c.team) known.team = c.team; continue; }
    let id;
    try { id = readFileSync(join(reference, "identity.yaml"), "utf8").match(/^did:\s*(\S+)/m)?.[1] ?? null; }
    catch (e) {
      if (e.code === "ENOENT" && !c.configured) continue;
      const entry = { ...base, reference, team: c.team, selectedBy: c.selectedBy, readiness: "protected-key-inventory-unknown", reason: e.code || "unreadable" };
      seen.set(reference, entry); entries.push(entry); continue;
    }
    const entry = { ...base, reference, id, team: c.team, ...(c.label ? { label: c.label } : {}), selectedBy: c.selectedBy, readiness: "legacy-minting-root", action: ROOT_ACTION };
    seen.set(reference, entry); entries.push(entry);
  }
  return entries;
}
