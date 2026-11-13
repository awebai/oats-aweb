// What check-only says about an opted-in deployment, and the reconciliation
// of memberships no home holds any more (spec v4.3.18 C-5).
// - check-only's `attribution` block: the setting's root, human, service and
//   teams; the root's verdict; chainless spawners; the policy's bounds read as
//   the root; OATS's own count of admitted live homes; leaked memberships
//   (once remove is served); the A5 scan's findings; and the limits of the
//   pinned aw.
// - `--reconcile-admissions [--plan]` removes only the leaked memberships the
//   root holds a copy for, with the root's team.agent.remove.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { admissionRecords, committedAdmissions } from "./admission.mjs";
import { attributionError, readWho } from "./attribution.mjs";
import { BLOCKED_FIX, notServedText, removeMembership, rootCannotAct } from "./removal.mjs";
import { REMOVE_SERVED, RESIDENT_CUSTODY_SERVED, admissionPolicyArgv, awJson, teamMembersArgv } from "./protected-client.mjs";

/** Each live or kept home the kernel lists: {instance, home, meta} (meta: this provider's, from
 *  instance.json). A document with no agents list throws: it says nothing about which homes exist,
 *  and an empty inventory read from it would make every membership look leaked. */
export function homesOf(statusDoc) {
  if (!Array.isArray(statusDoc?.agents) || statusDoc.agents.some((a) => !Array.isArray(a?.instances))) throw new Error("the kernel's instance list has no agents and instances");
  const rows = statusDoc.agents.flatMap((a) => a.instances);
  return rows.filter((r) => typeof r?.home === "string" && typeof r?.instance === "string").map((r) => {
    let meta = {};
    try { meta = JSON.parse(readFileSync(join(r.home, "instance.json"), "utf8")).capabilityMeta?.["oats.aweb"] || {}; } catch { meta = {}; }
    return { instance: r.instance, home: r.home, meta };
  });
}

/** The memberships in the setting's teams whose alias has no live or kept home.
 *  Two sources: `aw id team members`, which aw signs with the caller's own key,
 *  so a private team is read from a home that holds a membership, else from the
 *  root (which holds none, so the read fails once the last member is gone); and
 *  the root's own copies under admissions/, each a membership the root admitted
 *  and hasn't confirmed removed, which need no reader. A copy for a team that
 *  was read counts only while the read lists it active. Only a local member is
 *  OATS's: a global member (a human, a resident) never is. Returns {leaked, unreadable}. */
export function leakedMemberships({ aw, setting, homes, registry }) {
  const aliases = new Set(homes.map((h) => h.instance));
  const leaked = [], unreadable = [];
  const active = new Map(); // team → the certificate ids its read lists active
  for (const team of setting.teams) {
    const reader = homes.flatMap((h) => admissionRecords(h.home)).find((r) => r.team === team && r.state === "committed" && typeof r.identityHome === "string" && existsSync(r.identityHome))?.identityHome || join(setting.root.home, ".aw");
    let doc;
    try { doc = awJson(aw, "id team members", ["--identity-home", reader, ...teamMembersArgv({ team, registry })], setting.root.home, 30000); }
    catch (e) { if (e.code) throw e; unreadable.push({ team, reason: String(e.awCode || e.awMessage || e.message).slice(0, 200) }); continue; }
    if (!Array.isArray(doc.members)) { unreadable.push({ team, reason: "aw answered no members list" }); continue; }
    active.set(team, new Set(doc.members.filter((m) => m && !m.revoked_at).map((m) => String(m.certificate_id))));
    for (const m of doc.members) {
      if (!m || m.revoked_at || m.identity_scope !== "local" || m.member_did_aw || typeof m.alias !== "string" || aliases.has(m.alias)) continue;
      leaked.push({ team, alias: m.alias, certificateId: String(m.certificate_id), removable: existsSync(join(setting.root.home, "admissions", `${m.certificate_id}.cert`)) });
    }
  }
  const listed = new Set(leaked.map((l) => l.certificateId));
  for (const copy of rootCopies(setting.root.home)) {
    if (!setting.teams.includes(copy.team) || aliases.has(copy.alias) || listed.has(copy.certificateId)) continue;
    if (active.has(copy.team) && !active.get(copy.team).has(copy.certificateId)) continue;
    leaked.push({ ...copy, removable: true });
  }
  return { leaked, unreadable };
}

/** The root's copies under admissions/: {team, alias, certificateId}, each named by its own certificate id. */
function rootCopies(rootHome) {
  const dir = join(rootHome, "admissions");
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith(".cert")); } catch { names = []; }
  return names.flatMap((name) => {
    try {
      const cert = JSON.parse(readFileSync(join(dir, name), "utf8"));
      return cert && `${cert.certificate_id}.cert` === name && typeof cert.team_id === "string" && typeof cert.alias === "string" && cert.identity_scope === "local" ? [{ team: cert.team_id, alias: cert.alias, certificateId: cert.certificate_id }] : [];
    } catch { return []; }
  });
}

/** What the pinned aw doesn't support yet, each with what it waits on. */
export const limitsOf = ({ removeServed = REMOVE_SERVED, residentServed = RESIDENT_CUSTODY_SERVED } = {}) => [
  ...(removeServed ? [] : [{ code: "admission-removal-unavailable", waitsOn: "A2, team.agent.remove" }]),
  ...(residentServed ? [] : [{ code: "resident-certification-unavailable", waitsOn: "aweb-acxy.18" }]),
];

/** The root's verdict as check-only reports it: nearest_human (for the recorded human), revoked or unavailable. */
function rootVerified(aw, setting) {
  const verdict = readWho((args) => aw(["aw", ...args], setting.root.home, 30000), join(setting.root.home, ".aw"));
  if (verdict.kind === "verified" && verdict.humanId === setting.human.id) return { verified: "nearest_human" };
  if (verdict.kind === "revoked") return { verified: "revoked" };
  return { verified: "unavailable", verifiedReason: verdict.kind === "verified" ? `verifies to ${verdict.humanId ?? "no human"}` : `${verdict.kind}: ${verdict.reason ?? "no reason"}` };
}

/** check-only's `attribution` block. `scan()` is the A5 scan's {findings, unknown}. */
export function attributionStatus({ aw, setting, homes, homesUnavailable, registry, scan, removeServed = REMOVE_SERVED }) {
  const bounds = {};
  for (const team of setting.teams) {
    try { bounds[team] = awJson(aw, "id team admission-policy", admissionPolicyArgv({ team, profile: setting.service.profile }), setting.root.home, 30000).policy?.bounds ?? null; }
    catch (e) { if (e.code) throw e; bounds[team] = null; }
  }
  // Without the kernel's instance list, nothing here says which homes exist.
  const unknownHomes = homesUnavailable ? `the kernel's instance list is unavailable (${String(homesUnavailable).slice(0, 160)})` : null;
  const leaks = !removeServed ? null : unknownHomes ? { leaked: [], unreadable: setting.teams.map((team) => ({ team, reason: unknownHomes })) } : leakedMemberships({ aw, setting, homes, registry });
  const found = scan();
  return {
    root: setting.root, human: setting.human, service: { id: setting.service.id, url: setting.service.url }, teams: setting.teams,
    ...rootVerified(aw, setting),
    chainlessSpawners: unknownHomes ? null : homes.filter((h) => h.meta?.identity && h.meta.identity.attribution?.mode !== "human").map((h) => h.instance),
    bounds,
    admittedLive: { countedBy: "oats", teams: Object.fromEntries(setting.teams.map((team) => [team, unknownHomes ? "unknown" : committedAdmissions(homes, team)])) },
    ...(leaks ? { leakedMemberships: leaks.leaked, ...(leaks.unreadable.length ? { unreadableTeams: leaks.unreadable } : {}) } : {}),
    findings: [...found.findings, ...found.unknown],
    limits: limitsOf({ removeServed }),
  };
}

/** The refusal for a root that can't act at reconciliation. */
function rootRefusal({ reason, why }) {
  if (reason === "root-revoked") return attributionError("E_ATTRIBUTION_REVOKED", `${why} → ${BLOCKED_FIX["root-revoked"]}`, { reason });
  if (reason === "profile-changed") return attributionError("E_ATTRIBUTION_SETTING", `${why} → rerun setup if the operator changed the profile`, { key: "settings.oats.aweb.attribution.service.profile", problem: "profile-changed" });
  return attributionError("E_ATTRIBUTION_ROOT_HOME", `${why} → fix the root, then run \`oats aweb setup --reconcile-admissions\` again`, { problem: reason });
}

/** `--reconcile-admissions [--plan]`: the plan lists the removals first; the
 *  apply removes each from the root's copy, its UUID persisted under the root
 *  home before prepare. Returns {result, ok}: ok is false when a removal
 *  didn't go through. Throws a refusal before any effect. */
export function reconcileAdmissions({ aw, setting, homes, homesUnavailable, registry, deployment, plan = false, removeServed = REMOVE_SERVED }) {
  if (homesUnavailable) throw attributionError("E_ATTRIBUTION_EVIDENCE", `the kernel's instance list is unavailable (${String(homesUnavailable).slice(0, 160)}), so which memberships have no home can't be told → retry once \`oats status --json\` answers`);
  if (!removeServed) throw attributionError("E_SETUP_AW_VERSION", "the pinned aw doesn't serve team.agent.remove yet (aweb A2), so no membership can be removed → reconcile once an aw that serves it is pinned");
  const blocked = rootCannotAct({ aw, setting, deployment });
  if (blocked) throw rootRefusal(blocked);
  const { leaked, unreadable } = leakedMemberships({ aw, setting, homes, registry });
  const row = ({ team, alias, certificateId }) => ({ team, alias, certificateId });
  const removals = leaked.filter((l) => l.removable).map(row);
  const notRemovable = leaked.filter((l) => !l.removable).map((l) => ({ ...row(l), reason: "no-root-copy" }));
  const result = { plan, removals, notRemovable, ...(unreadable.length ? { unreadableTeams: unreadable } : {}) };
  if (plan) return { ok: true, result };
  const removed = [], failed = [];
  for (const r of removals) {
    const done = removeMembership({ aw, setting, certificateId: r.certificateId, team: r.team, file: join(setting.root.home, "removals", `${r.certificateId}.json`) });
    if (done.outcome === "removed") { removed.push(r); continue; }
    const text = done.outcome === "unavailable" ? notServedText({ code: done.code, team: r.team })
      : done.outcome === "unconfirmed" ? `the removal wasn't confirmed (operation ${done.operationId}, ${done.code || "no code"}) → run \`oats aweb setup --reconcile-admissions\` again once the service answers`
      : `admission-removal-blocked (reason: service-refused, team ${r.team}): the protected service refused the removal (${done.code}) → ${BLOCKED_FIX["service-refused"]}`;
    failed.push({ ...r, outcome: done.outcome, code: done.code, text });
  }
  return { ok: !failed.length, result: { ...result, removed, failed } };
}
