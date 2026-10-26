// The human's alias on a computer, for the threaded human channel (awebai/oats
// docs/design/2026-10-26-threaded-human-channel.md §2): `<os-user>-<host>`,
// from the OS user running the command and the host's recorded name
// (`host.name` in the deployment's oats-local.yaml, else the OS hostname cut at
// its first "."), both lowercased and reduced to `[a-z0-9-]`. It is
// deterministic, so a spawn can NAME the alias in a `threads` soul's brief
// without the identity existing, and the later mint (`oats aweb threads send`,
// a later release) yields the same name. Nothing here reads `.aw`, calls `aw`
// or writes anything; every input is injectable for tests and every failure
// falls back, so the derivation never throws into a spawn.
import { existsSync, readFileSync } from "node:fs";
import { hostname as osHostname, userInfo } from "node:os";
import { join } from "node:path";

/** aw's alias rule (bin/oats-aweb.mjs AWEB_ALIAS_RE): at most 64 characters. */
export const ALIAS_MAX_LENGTH = 64;

/** One part of the alias: lowercased, every run outside [a-z0-9] one "-", trimmed of "-". */
export function aliasPart(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** The OS user running the command: `os.userInfo().username`, else `$USER` when userInfo throws. */
export function osUser({ userInfo: info = userInfo, env = process.env } = {}) {
  try { return String(info().username || ""); } catch { return String(env.USER || ""); }
}

/** The OS hostname (`os.hostname()` unless given) cut at its first ".". */
export function shortHostname(hostname) {
  try { return String((hostname === undefined ? osHostname() : hostname) || "").split(".")[0]; } catch { return ""; }
}

/** A YAML line with its `#` comment removed, respecting quotes. */
function stripComment(line) {
  let quote = null, escaped = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (quote === '"' && escaped) escaped = false;
      else if (quote === '"' && c === "\\") escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/** A block-style scalar value: `"quoted"`, `'quoted'` or bare; `undefined` when it is not one. */
function scalarOf(raw) {
  const text = raw.trim();
  if (!text) return undefined;
  if (text.startsWith('"')) {
    try { const parsed = JSON.parse(text); return typeof parsed === "string" ? parsed : undefined; } catch { return undefined; }
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) return undefined;
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[|>&*!{[]/.test(text) || text === "~" || text === "null") return undefined;
  return text;
}

/** `host.name` from a block-style oats-local.yaml text: a top-level `host:` line,
 *  then an indented `name:` scalar inside its block. Anything else → `undefined`
 *  (no YAML dependency: the package has none, like lib/local-settings.mjs). */
export function hostNameFromLocalYaml(text) {
  if (typeof text !== "string") return undefined;
  const lines = text.split(/\r?\n/).map(stripComment);
  const start = lines.findIndex((line) => line.trimEnd() === "host:");
  if (start < 0) return undefined;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) break; // the host: block ended
    const match = /^\s+name\s*:(.*)$/.exec(line.trimEnd());
    if (!match) continue;
    const value = scalarOf(match[1]);
    return value && value.trim() ? value.trim() : undefined;
  }
  return undefined;
}

/** `host.name` of `<deployment>/oats-local.yaml`, or `undefined` when the file, the key or the shape is missing. */
export function recordedHostName(deployment, { readFile = readFileSync, exists = existsSync } = {}) {
  if (!deployment) return undefined;
  const file = join(deployment, "oats-local.yaml");
  try {
    if (!exists(file)) return undefined;
    return hostNameFromLocalYaml(readFile(file, "utf8"));
  } catch { return undefined; }
}

/** The deployment directory, as bin/oats-aweb.mjs's rootSettingCandidate finds it. */
export const deploymentDir = ({ env = process.env, cwd = process.cwd } = {}) => env.OATS_WORKSPACE || cwd();

/** The host part of the alias: the deployment's recorded `host.name`, else the
 *  short form of `hostname` (the OS hostname unless given). */
export function hostPart({ deployment = deploymentDir(), hostname, readFile, exists } = {}) {
  return recordedHostName(deployment, { readFile, exists }) || shortHostname(hostname);
}

/** The human's alias on this computer: `<os-user>-<host>`, at most 64 characters,
 *  matching aw's alias rule. Pure and injectable: `user` is the OS user name,
 *  `hostname` what `os.hostname()` answers (cut at its first "."), `deployment`
 *  the directory whose oats-local.yaml may record `host.name`; each defaults to
 *  the real one. Never throws: a part that cannot be derived is left out. */
export function humanAlias({ deployment, user, hostname, env = process.env, cwd = process.cwd, readFile, exists } = {}) {
  const userPart = aliasPart(user === undefined ? osUser({ env }) : user);
  const host = hostPart({ deployment: deployment === undefined ? deploymentDir({ env, cwd }) : deployment, hostname, readFile, exists });
  const alias = [userPart, aliasPart(host)].filter(Boolean).join("-");
  return alias.slice(0, ALIAS_MAX_LENGTH).replace(/-+$/g, "");
}
