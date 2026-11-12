// The shape of an aweb team id, `<name>:<namespace>`: the name matches
// ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ and the namespace is a hostname. The hook and the libs
// that need it (a command built from a team id) share this one check.

/** True when `value` is a hostname: dot-separated labels of letters, digits and inner hyphens. */
export function validHostname(value) { const s = String(value || ""); return s.length <= 253 && s.split(".").every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)); }

/** True when `value` is an aweb team id, `<name>:<namespace>`. */
export function validAwebTeamId(value) { const m = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127}):([^:]+)$/.exec(String(value || "")); return !!m && validHostname(m[2]); }

/** The team id as aw spells it (awid/team_id.go:8-32, BuildTeamID and ParseTeamID, at the
 *  tested version): the name lowercased and trimmed, the domain lowercased, trimmed and
 *  without a trailing dot. Undefined for anything that is not `<name>:<domain>`. */
export function canonicalAwebTeamId(value) {
  if (typeof value !== "string") return undefined;
  const at = value.indexOf(":");
  if (at < 0) return undefined;
  const name = value.slice(0, at).trim().toLowerCase();
  const domain = value.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  return name && domain ? `${name}:${domain}` : undefined;
}
/** True when aw reads `a` and `b` as one team. */
export const sameAwebTeamId = (a, b) => { const x = canonicalAwebTeamId(a); return x !== undefined && x === canonicalAwebTeamId(b); };
