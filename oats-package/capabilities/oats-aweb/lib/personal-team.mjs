// Per-workspace personal team (oats.aweb 1.15).
//
// aweb's personal enrollment (Cloud >= 0.8.12, aw >= 1.36.8) get-or-creates the
// person's own team for ONE workspace, keyed on the digest of the OATS canonical
// format-1 workspace key, and installs a member authority for it into an explicit
// credential root: `aw --identity-home <root>/.aw team ensure --workspace-key <key>`.
// That authority then mints instance identities exactly like any other root
// (cwd = <root>, `aw team invite`), because `aw team invite` is not admitted under
// --identity-home.
//
// Host placement: settings.oats.aweb.roots.personal (hostOnly), default
// <deployment>/.aweb-personal — the same placement policy as the default root.
// A local/ workspace key has no hosted personal team: the provider falls back to
// the root's active team and says so (`personal-team-local-workspace`).
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isAbsolute, join, resolve} from 'node:path';

export const PERSONAL_ENSURE_AW_MIN = '1.36.8';
export const PERSONAL_BINDING_FILE = 'personal-workspace-binding.yaml';
export const PERSONAL_ROOT_KEY = 'settings.oats.aweb.roots.personal';
export const PERSONAL_DEFAULT_DIR = '.aweb-personal';
export const LOCAL_WORKSPACE_WARNING = "this workspace's key is local-only; the per-workspace personal team needs a hosted workspace repository";

const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** hosted | local | none — only a hosted key can own a per-workspace personal team. */
export function workspaceKeyKind(key) {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k) return 'none';
  return k.startsWith('local/') ? 'local' : 'hosted';
}

export function workspaceKeyDigest(key) {
  return createHash('sha256').update(String(key).trim()).digest('hex');
}

/** The host directory whose .aw is the personal-team authority for this workspace. */
export function personalRootCandidate(settings, {deployment, env = process.env} = {}) {
  const roots = obj(settings?.roots) ? settings.roots : {};
  if (typeof roots.personal === 'string' && roots.personal.trim()) return {root: roots.personal.trim(), key: PERSONAL_ROOT_KEY, declared: true};
  const base = env.OATS_WORKSPACE || deployment;
  if (typeof base === 'string' && isAbsolute(base)) return {root: join(resolve(base), PERSONAL_DEFAULT_DIR), key: PERSONAL_ROOT_KEY, declared: false};
  return {root: undefined, key: PERSONAL_ROOT_KEY, declared: false};
}

export const personalCredentialRoot = (root) => join(resolve(root), '.aw');

function scalar(text, key) {
  const m = String(text).match(new RegExp(`^${key}:\\s*["']?([^"'\\n#]+)["']?\\s*$`, 'm'));
  return m ? m[1].trim() : undefined;
}

/** Read aw's binding marker. Returns null when unbound, {mismatch} when the
 *  credential root is bound to another workspace, else the bound team. */
export function readPersonalBinding(credentialRoot, digest) {
  let text;
  try { text = readFileSync(join(credentialRoot, PERSONAL_BINDING_FILE), 'utf8'); } catch { return null; }
  const bound = scalar(text, 'workspace_key_sha256');
  const teamId = scalar(text, 'team_id');
  const canonical = scalar(text, 'canonical_team_id');
  if (!bound || !teamId) return null;
  if (bound !== digest) return {mismatch: true, teamId, canonicalTeamId: canonical || teamId};
  return {teamId, canonicalTeamId: canonical || teamId, team: canonical || teamId};
}

/** aw prints stable ensure diagnostics as `<code>: <text>` on stderr, exit 2. */
export function ensureDiagnosticCode(text) {
  const m = /\b(authorization-required|workspace-key-not-portable|identity-home-occupied|unsupported-server)\b/.exec(String(text || ''));
  return m ? m[1] : undefined;
}

export function ensureRemedy(code, {root} = {}) {
  switch (code) {
    case 'authorization-required': return 'this host aw CLI is not logged in to the person\'s aweb account; run `aw auth login` on this host once, then retry';
    case 'unsupported-server': return 'the aweb service does not support per-workspace personal teams yet (needs aweb Cloud >= 0.8.12); set settings.oats.aweb.team to mint into a chosen team meanwhile';
    case 'identity-home-occupied': return `${root ? join(root, '.aw') : PERSONAL_ROOT_KEY} already holds another identity or workspace binding; point ${PERSONAL_ROOT_KEY} at an empty dedicated directory`;
    case 'workspace-key-not-portable': return LOCAL_WORKSPACE_WARNING;
    default: return 'see `aw team ensure --help`';
  }
}
