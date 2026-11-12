// The shape of an aweb team id, `<name>:<namespace>`: the name matches
// ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ and the namespace is a hostname. The hook and the libs
// that need it (a command built from a team id) share this one check.

/** True when `value` is a hostname: dot-separated labels of letters, digits and inner hyphens. */
export function validHostname(value) { const s = String(value || ""); return s.length <= 253 && s.split(".").every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)); }

/** True when `value` is an aweb team id, `<name>:<namespace>`. */
export function validAwebTeamId(value) { const m = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127}):([^:]+)$/.exec(String(value || "")); return !!m && validHostname(m[2]); }
