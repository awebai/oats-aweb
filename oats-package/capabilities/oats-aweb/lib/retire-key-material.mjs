// What a retire does with the aweb key material it leaves in a home
// (awebai/oats-aweb#318). A home the kernel keeps after a retire (--keep-dir,
// quarantined, or a failed retire) can be revived by a session provider with no
// OATS around it, and aw finds its identity at <cwd>/.aw or $AWEB_IDENTITY_HOME:
// so no answer of the retire hook leaves a credential entry at a path aw reads.
//
// - An exit 0 removes every credential entry: by then no remaining cleanup needs
//   the member key (a team_not_hosted handoff is key-independent).
// - A nonzero exit holds them: each is renamed, as itself, to
//   .oats-aweb/held/<name>, because the key is the only authority a retry has.
// - Every retire run restores held entries first, before it reads any state, so
//   a retry sees the home the failed retire saw. When an entry and its held copy
//   both exist (something re-created it, e.g. `aw init` in a revived session) or
//   a held entry cannot be read or renamed back, the retire fails closed and
//   touches neither.
//
// Renames only, within the home: nothing is copied, and a symlinked entry is
// moved or removed as the link itself, never followed (a retained seat's source
// identity, or one a person linked, is never touched). This stops a revived
// session from acting as the agent through aw's identity lookup; it is no
// boundary against a process of the same OS user that looks in .oats-aweb/held.
import { lstatSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** The provider's credential entries in a home: aw's own identity home and
 *  every per-team or grant identity home the provider writes beside it. */
export const CREDENTIAL_ENTRY_RE = /^(?:\.aw|\.aweb-identity|\.aweb-identity-.+)$/;
export const HELD_RELATIVE = join(".oats-aweb", "held");
export const heldDir = (home) => join(home, HELD_RELATIVE);

const codeOf = (e) => (/^E[A-Z]+$/.test(String(e?.code)) ? e.code : "error");
/** lstat that answers undefined for ENOENT and throws anything else. */
function lstatOrNone(path) {
  try { return lstatSync(path); }
  catch (e) { if (e?.code === "ENOENT") return undefined; throw e; }
}

/** The credential entries directly in `home`, by name (a broken symlink included). */
export function credentialEntries(home) {
  return readdirSync(home).filter((name) => CREDENTIAL_ENTRY_RE.test(name)).sort();
}

/** The credential entries held in `home`'s .oats-aweb/held: `{ names }`, or
 *  `{ problem }` when the held directory is there and cannot be listed or is not
 *  a directory (a symlink included: it is never followed). */
export function heldEntries(home) {
  const dir = heldDir(home);
  let st;
  try { st = lstatOrNone(dir); }
  catch (e) { return { problem: `${dir} cannot be checked (${codeOf(e)})` }; }
  if (!st) return { names: [] };
  if (!st.isDirectory()) return { problem: `${dir} is not a directory` };
  try { return { names: readdirSync(dir).filter((name) => CREDENTIAL_ENTRY_RE.test(name)).sort() }; }
  catch (e) { return { problem: `${dir} cannot be read (${codeOf(e)})` }; }
}

/** Put every held entry back at its own name, all or none. `{ restored }` on
 *  success (an empty list when nothing was held), else `{ problem }` with every
 *  entry where it was found: nothing is renamed when any original path is taken
 *  or cannot be checked, and a rename that fails puts back the ones before it. */
export function restoreHeld(home) {
  const held = heldEntries(home);
  if (held.problem) return { problem: held.problem };
  const dir = heldDir(home);
  const conflicts = [];
  for (const name of held.names) {
    const original = join(home, name), kept = join(dir, name);
    try { lstatSync(kept); }
    catch (e) { return { problem: `the held ${kept} cannot be read (${codeOf(e)})` }; }
    try { if (lstatOrNone(original)) conflicts.push(`${kept} and ${original}`); }
    catch (e) { return { problem: `${original} cannot be checked (${codeOf(e)}), so the held ${kept} was not put back` }; }
  }
  if (conflicts.length) return { problem: `both ${conflicts.join(", and both ")} exist: something re-created the entry a failed retire held` };
  const restored = [];
  for (const name of held.names) {
    try { renameSync(join(dir, name), join(home, name)); restored.push(name); }
    catch (e) {
      // Back to the held state this run found, so a revived session finds no key.
      const unwound = restored.filter((r) => { try { renameSync(join(home, r), join(dir, r)); return false; } catch { return true; } });
      return { problem: `the held ${join(dir, name)} could not be put back at ${join(home, name)} (${codeOf(e)})${unwound.length ? `; ${unwound.map((r) => join(home, r)).join(", ")} could not be held again and stay in place` : ""}` };
    }
  }
  return { restored };
}

/** Rename every credential entry of `home` into .oats-aweb/held, but one for which
 *  `keep(name)` answers a reason, which stays where it is. Each rename that fails
 *  leaves that entry in place and says why; nothing is thrown. */
export function holdEntries(home, { keep = () => undefined } = {}) {
  const held = [], problems = [];
  let names;
  try { names = credentialEntries(home); }
  catch (e) { return { held, problems: [`${home} could not be listed (${codeOf(e)}), so no key material was held`] }; }
  const moving = [];
  for (const name of names) {
    const reason = keep(name);
    if (reason) problems.push(`${join(home, name)} stays in place: ${reason}`); else moving.push(name);
  }
  if (!moving.length) return { held, problems };
  const dir = heldDir(home);
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  catch (e) { return { held, problems: [...problems, ...moving.map((name) => `${join(home, name)} stays in place: ${dir} could not be created (${codeOf(e)})`)] }; }
  for (const name of moving) {
    const target = join(dir, name);
    try {
      // A rename onto an existing path would replace it: never overwrite a held entry.
      if (lstatOrNone(target)) { problems.push(`${join(home, name)} stays in place: ${target} already exists`); continue; }
      renameSync(join(home, name), target);
      held.push(name);
    } catch (e) { problems.push(`${join(home, name)} stays in place: it could not be moved to ${target} (${codeOf(e)})`); }
  }
  return { held, problems };
}

/** Remove every credential entry of `home` (a symlink as the link itself), and
 *  the held directory once it is empty. Each removal that fails says why. */
export function removeEntries(home) {
  const removed = [], problems = [];
  let names;
  try { names = credentialEntries(home); }
  catch (e) { return { removed, problems: [`${home} could not be listed (${codeOf(e)}), so its key material was not removed`] }; }
  for (const name of names) {
    const path = join(home, name);
    try {
      const st = lstatOrNone(path);
      if (!st) continue;
      if (st.isDirectory()) rmSync(path, { recursive: true, force: true });
      else unlinkSync(path);
      removed.push(name);
    } catch (e) { problems.push(`${path} could not be removed (${codeOf(e)})`); }
  }
  // An empty held directory is all a completed retry leaves of the hold.
  try { rmdirSync(heldDir(home)); }
  catch (e) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(e?.code)) problems.push(`${heldDir(home)} could not be removed (${codeOf(e)})`); }
  return { removed, problems };
}
