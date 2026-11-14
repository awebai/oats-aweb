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
import { committedAdmissions, homeRecords, verifiedCertificate } from "./admission.mjs";
import { awaitsOutcome, holdsMembership, shieldsCertificate } from "./admission-states.mjs";
import { UUID, attributionError, readWho } from "./attribution.mjs";
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

/** The memberships in the setting's teams that no live or kept home holds. Two sources: `aw id
 *  team members`, which aw signs with the caller's own key, so a private team is read from a
 *  home that holds a membership, else from the root (which holds none, so the read fails once the
 *  last member is gone); and the root's own copies under admissions/, which need no reader.
 *  A member list is unsigned registry metadata: a row is only ever acted on through the root's
 *  copy of its certificate, by an id of aw's form, and a certificate a home's record names (or
 *  may name) is that home's, whatever alias the row gives it. A row with no copy is listed, never
 *  removable, and only when its alias has no home. A copy for a team that was read counts only
 *  while the read lists it active. Only a local member is OATS's: a global member (a human, a
 *  resident) never is. Returns {leaked, unreadable}. */
export function leakedMemberships({ aw, setting, listHomes, registry }) {
  // The root's copies are read once, BEFORE the homes are listed and their records read, and only
  // that snapshot is ever a removal candidate. A spawning home is listed from its first
  // instance.json, and a home writes its admission record (pending) before the admit and the root's
  // copy only after it commits (C-3, C-3b): every copy read here has its home in the list and its
  // record in the reads below. A spawn or join that commits later adds a copy this snapshot never
  // holds, and so is never taken for a leak. A home list taken before the copies could miss a
  // home whose copy they hold.
  const copies = new Map(rootCopies(setting.root.home).map((c) => [c.certificateId, c]));
  const { homes, homesUnavailable } = listHomes();
  if (homesUnavailable) throw homesUnavailableError(homesUnavailable);
  const aliases = new Set(homes.map((h) => h.instance));
  const read = homes.map((h) => homeRecords(h.home));
  const unreadRecord = read.flatMap((r) => r.unreadable)[0];
  if (unreadRecord) throw recordsUnreadableError(unreadRecord);
  const records = read.flatMap((r) => r.records);
  const held = heldBy(records, setting.root.home);
  const leaked = [], unreadable = [];
  const active = new Map(); // team → the certificate ids its read lists active
  for (const team of setting.teams) {
    const reader = records.map((r) => r.record).find((r) => r.team === team && holdsMembership(r) && typeof r.identityHome === "string" && existsSync(r.identityHome))?.identityHome || join(setting.root.home, ".aw");
    let doc;
    try { doc = awJson(aw, "id team members", ["--identity-home", reader, ...teamMembersArgv({ team, registry })], setting.root.home, 30000); }
    catch (e) { if (e.code) throw e; unreadable.push({ team, reason: String(e.awCode || e.awMessage || e.message).slice(0, 200) }); continue; }
    if (!Array.isArray(doc.members)) { unreadable.push({ team, reason: "aw answered no members list" }); continue; }
    active.set(team, new Set(doc.members.filter((m) => m && !m.revoked_at).map((m) => String(m.certificate_id))));
    for (const m of doc.members) {
      if (!m || m.revoked_at || m.identity_scope !== "local" || m.member_did_aw || typeof m.alias !== "string") continue;
      const id = String(m.certificate_id);
      if (held(team, id)) continue;
      const copy = copies.get(id);
      if (copy && copy.team === team) { if (!held(team, id, copy.alias)) leaked.push({ team, alias: copy.alias, certificateId: id, removable: true }); continue; }
      if (aliases.has(m.alias)) continue;
      leaked.push({ team, alias: m.alias, certificateId: id.slice(0, 80), removable: false });
    }
  }
  const listed = new Set(leaked.map((l) => l.certificateId));
  for (const copy of copies.values()) {
    if (!setting.teams.includes(copy.team) || listed.has(copy.certificateId) || held(copy.team, copy.certificateId, copy.alias)) continue;
    if (active.has(copy.team) && !active.get(copy.team).has(copy.certificateId)) continue;
    leaked.push({ ...copy, removable: true });
  }
  return { leaked, unreadable };
}

/** Without the kernel's instance list nothing says which homes exist, so no membership is told leaked. */
const homesUnavailableError = (reason) => attributionError("E_ATTRIBUTION_EVIDENCE", `the kernel's instance list is unavailable (${String(reason).slice(0, 160)}), so which memberships have no home can't be told → retry once \`oats status --json\` answers`, { problem: "homes-unavailable", reason: String(reason).slice(0, 160) });

/** A live home's record that can't be read could hold any of the copies, so none is told leaked. */
const recordsUnreadableError = ({ file, reason }) => attributionError("E_ATTRIBUTION_EVIDENCE", `an admission record can't be read (${file.slice(-160)}: ${reason}), so which memberships its home holds can't be told → make it readable by this user, owner-only, or restore it, then retry`, { problem: "records-unreadable", file, reason });

/** Whether a live or kept home holds a certificate: a record of `team` that names its id (or
 *  whose verified --certificate-out does), or, given the certificate's own `alias`, one awaiting
 *  its outcome for that alias, which may yet name it. A record a leave set aside holds nothing. */
function heldBy(records, rootHome) {
  const named = new Set(), awaiting = new Set();
  for (const { record, left } of records) {
    if (!record || !shieldsCertificate(record, { left })) continue;
    const id = record.certificateId ?? verifiedCertificate(record, rootHome)?.id;
    if (typeof id === "string") named.add(`${record.team}\n${id}`);
    else if (awaitsOutcome(record)) awaiting.add(`${record.team}\n${record.alias}`);
  }
  return (team, id, alias) => named.has(`${team}\n${id}`) || (alias !== undefined && awaiting.has(`${team}\n${alias}`));
}

/** The root's copy of certificate `id`, read only for an id of aw's form: {team, alias}, or null. */
function rootCopyOf(rootHome, id) {
  if (!UUID.test(id)) return null;
  try {
    const cert = JSON.parse(readFileSync(join(rootHome, "admissions", `${id}.cert`), "utf8"));
    return cert && cert.certificate_id === id && typeof cert.team_id === "string" && typeof cert.alias === "string" && cert.identity_scope === "local" ? { team: cert.team_id, alias: cert.alias } : null;
  } catch { return null; }
}

/** The root's copies under admissions/: {team, alias, certificateId}, each named by its own certificate id, of aw's form. */
function rootCopies(rootHome) {
  const dir = join(rootHome, "admissions");
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith(".cert")); } catch { names = []; }
  return names.flatMap((name) => {
    const id = name.slice(0, -".cert".length);
    const copy = rootCopyOf(rootHome, id);
    return copy ? [{ team: copy.team, alias: copy.alias, certificateId: id }] : [];
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

/** check-only's `attribution` block. `scan()` is the A5 scan's {findings, unknown}, with the
 *  legacy roots' `inventory` (listed with the findings, never refused on). */
export function attributionStatus({ aw, setting, homes, homesUnavailable, listHomes, profileProblem = null, registry, scan, removeServed = REMOVE_SERVED }) {
  // A profile that fails C-1's checks backs no call: the policy reads and the member lists are
  // skipped, and the block says why (`problem`), with its local parts kept.
  const bounds = {};
  for (const team of setting.teams) {
    if (profileProblem) { bounds[team] = null; continue; }
    try { bounds[team] = awJson(aw, "id team admission-policy", admissionPolicyArgv({ team, profile: setting.service.profile }), setting.root.home, 30000).policy?.bounds ?? null; }
    catch (e) { if (e.code) throw e; bounds[team] = null; }
  }
  // Without the kernel's instance list, nothing here says which homes exist.
  const unknownHomes = homesUnavailable ? `the kernel's instance list is unavailable (${String(homesUnavailable).slice(0, 160)})` : null;
  const unread = unknownHomes || (profileProblem ? `the protected profile can't be used (${profileProblem.details?.problem})` : null);
  const unreadAll = (reason) => ({ leaked: [], unreadable: setting.teams.map((team) => ({ team, reason })) });
  let leaks = null;
  if (removeServed) {
    if (unread) leaks = unreadAll(unread);
    else try { leaks = leakedMemberships({ aw, setting, listHomes, registry }); }
    catch (e) {
      if (e.details?.problem === "homes-unavailable") leaks = unreadAll(`the kernel's instance list is unavailable (${e.details.reason})`);
      else if (e.details?.problem === "records-unreadable") leaks = unreadAll(`an admission record can't be read (${e.details.file.slice(-160)}: ${e.details.reason})`);
      else throw e;
    }
  }
  const found = scan();
  return {
    root: setting.root, human: setting.human, service: { id: setting.service.id, url: setting.service.url }, teams: setting.teams,
    ...rootVerified(aw, setting),
    chainlessSpawners: unknownHomes ? null : homes.filter((h) => h.meta?.identity && h.meta.identity.attribution?.mode !== "human").map((h) => h.instance),
    bounds,
    admittedLive: { countedBy: "oats", teams: Object.fromEntries(setting.teams.map((team) => [team, unknownHomes ? "unknown" : committedAdmissions(homes, team)])) },
    ...(leaks ? { leakedMemberships: leaks.leaked, ...(leaks.unreadable.length ? { unreadableTeams: leaks.unreadable } : {}) } : {}),
    findings: [...found.findings, ...found.unknown, ...(found.inventory || [])],
    limits: limitsOf({ removeServed }),
    ...(profileProblem ? { problem: { code: profileProblem.code, problem: profileProblem.details?.problem, message: String(profileProblem.message).slice(0, 300) } } : {}),
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
export function reconcileAdmissions({ aw, setting, homesUnavailable, listHomes, registry, deployment, plan = false, removeServed = REMOVE_SERVED }) {
  if (homesUnavailable) throw homesUnavailableError(homesUnavailable);
  if (!removeServed) throw attributionError("E_SETUP_AW_VERSION", "the pinned aw doesn't serve team.agent.remove yet (aweb A2), so no membership can be removed → reconcile once an aw that serves it is pinned");
  const blocked = rootCannotAct({ aw, setting, deployment });
  if (blocked) throw rootRefusal(blocked);
  const { leaked, unreadable } = leakedMemberships({ aw, setting, listHomes, registry });
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
