// Host-only provider settings in a deployment's oats-local.yaml: one entry of a
// block-style map under settings.oats.aweb (`roots`: team id → minting root,
// `residents`: resident name → custody directory, `health`: the status
// publisher's settings). Only block-style YAML is
// edited; anything else refuses with the exact line to add by hand.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The singular a map's messages use for one of its entries. */
const ENTRY_NOUN = { roots: "root", residents: "resident", health: "health setting", human: "bound human field", steward: "steward field" };

export const yamlQuote = (value) => JSON.stringify(String(value));
/** A setting's YAML scalar: a boolean as itself, anything else quoted. */
const yamlScalar = (value) => (typeof value === "boolean" ? String(value) : yamlQuote(value));
function blockEnd(lines, start, indent) {
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (lines[i].trim() && !lines[i].startsWith(" ".repeat(indent + 1))) { end = i; break; }
  return end;
}
function ensureYamlBlock(lines, parentStart, parentEnd, indent, header) {
  const row = `${" ".repeat(indent)}${header}:`;
  for (let i = parentStart + 1; i < parentEnd; i++) if (lines[i].trimEnd() === row) return i;
  lines.splice(parentEnd, 0, row);
  return parentEnd;
}
export function atomicWrite(file, text, mode = 0o600) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${basenameForTemp(file)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, text, { mode });
  renameSync(tmp, file);
}
function basenameForTemp(file) { return file.split(/[\\/]/).pop() || "oats-local.yaml"; }
function unsupportedLocalYaml(file, map, detail, key, value) {
  throw new Error(`${file}: cannot safely update settings.oats.aweb.${map} automatically (${detail}); add this line by hand under block-style settings.oats.aweb.${map}: ${yamlQuote(key)}: ${yamlScalar(value)}`);
}
function findBlockHeader(lines, start, end, indent, names) {
  const pad = " ".repeat(indent);
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!line.startsWith(pad) || line.startsWith(pad + " ")) continue;
    const trimmed = line.slice(indent).trimEnd();
    for (const name of names) if (trimmed === `${name}:`) return i;
    for (const name of names) if (trimmed.startsWith(`${name}:`)) return { unsupported: i, line };
  }
  return -1;
}
/** Refuses, before any effect, when `settings.oats.aweb.<map>` could not be updated safely. */
export function assertAwebSettingRecordable(map, key, value, { start = process.env.OATS_WORKSPACE || process.cwd() } = {}) {
  const file = join(start, "oats-local.yaml");
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  let settings = findBlockHeader(lines, 0, lines.length, 0, ["settings"]);
  if (typeof settings === "object") unsupportedLocalYaml(file, map, `line ${settings.unsupported + 1} is not a block-style settings: mapping`, key, value);
  if (settings < 0) return;
  const settingsEnd = blockEnd(lines, settings, 0);
  let aweb = findBlockHeader(lines, settings + 1, settingsEnd, 2, ["oats.aweb", '"oats.aweb"', "'oats.aweb'"]);
  if (typeof aweb === "object") unsupportedLocalYaml(file, map, `line ${aweb.unsupported + 1} is not a block-style oats.aweb: mapping`, key, value);
  if (aweb < 0) return;
  const awebEnd = blockEnd(lines, aweb, 2);
  const block = findBlockHeader(lines, aweb + 1, awebEnd, 4, [map]);
  if (typeof block === "object") unsupportedLocalYaml(file, map, `line ${block.unsupported + 1} is not a block-style ${map}: mapping`, key, value);
}
/** Sets `settings.oats.aweb.<map>[key]: value` in the deployment's oats-local.yaml. */
export function recordAwebSetting(map, entryKey, entryValue, { start = process.env.OATS_WORKSPACE || process.cwd() } = {}) {
  const noun = ENTRY_NOUN[map];
  const file = join(start, "oats-local.yaml");
  const existed = existsSync(file);
  const lines = existed ? readFileSync(file, "utf8").split(/\r?\n/) : ["schemaVersion: 2", "workspace: local"];
  while (lines.length && lines.at(-1) === "") lines.pop();
  let settings = findBlockHeader(lines, 0, lines.length, 0, ["settings"]);
  if (typeof settings === "object") unsupportedLocalYaml(file, map, `line ${settings.unsupported + 1} is not a block-style settings: mapping`, entryKey, entryValue);
  if (settings < 0) { lines.push("settings:"); settings = lines.length - 1; }
  let settingsEnd = blockEnd(lines, settings, 0);
  let aweb = findBlockHeader(lines, settings + 1, settingsEnd, 2, ["oats.aweb", '"oats.aweb"', "'oats.aweb'"]);
  if (typeof aweb === "object") unsupportedLocalYaml(file, map, `line ${aweb.unsupported + 1} is not a block-style oats.aweb: mapping`, entryKey, entryValue);
  if (aweb < 0) { aweb = ensureYamlBlock(lines, settings, settingsEnd, 2, "oats.aweb"); settingsEnd++; }
  let awebEnd = blockEnd(lines, aweb, 2);
  let block = findBlockHeader(lines, aweb + 1, awebEnd, 4, [map]);
  if (typeof block === "object") unsupportedLocalYaml(file, map, `line ${block.unsupported + 1} is not a block-style ${map}: mapping`, entryKey, entryValue);
  if (block < 0) { block = ensureYamlBlock(lines, aweb, awebEnd, 4, map); awebEnd++; }
  const blockEndIndex = blockEnd(lines, block, 4);
  const key = yamlQuote(entryKey), value = yamlScalar(entryValue), row = `      ${key}: ${value}`;
  // The public kernel serializer may wrap a scalar value and may choose a
  // plain or single-quoted key. Replace the entire scalar entry,
  // not just its first line, so a tokenless resume remains valid YAML.
  const keys = [key, entryKey, "'" + entryKey + "'"];
  // Identify the key/delimiter before examining the value. Empty or unsupported
  // tails must refuse, not disappear from duplicate detection.
  const matches = lines.flatMap((line, index) => {
    if (index <= block || index >= blockEndIndex || !line.startsWith("      ") || line.startsWith("       ")) return [];
    const entry = line.slice(6);
    for (const candidate of keys) {
      if (!entry.startsWith(candidate)) continue;
      const delimiter = /^[ \t]*:(.*)$/.exec(entry.slice(candidate.length));
      if (delimiter) return [{ index, tail: delimiter[1] }];
    }
    return [];
  });
  if (matches.length > 1) unsupportedLocalYaml(file, map, `duplicate ${noun} key`, entryKey, entryValue);
  if (matches.length) {
    const { index: existing, tail } = matches[0];
    if (tail && !/^[ \t]/.test(tail)) unsupportedLocalYaml(file, map, `unsupported ${noun} delimiter`, entryKey, entryValue);
    const scalar = tail.trimStart();
    let end = existing + 1, comment = "";
    if (scalar.startsWith('"') || scalar.startsWith("'")) {
      const quote = scalar[0];
      let closed = false, escaped = false;
      for (let i = existing; i < blockEndIndex && !closed; i++) {
        if (i > existing && (!lines[i].startsWith("       ") || !lines[i].trim() || lines[i].trimStart().startsWith("#"))) break;
        const part = i === existing ? scalar.slice(1) : lines[i].trimStart();
        for (let j = 0; j < part.length; j++) {
          const char = part[j];
          if (quote === '"' && escaped) { escaped = false; continue; }
          if (quote === '"' && char === "\\") { escaped = true; continue; }
          if (char !== quote) continue;
          if (quote === "'" && part[j + 1] === "'") { j++; continue; }
          const tail = part.slice(j + 1).trim();
          if (tail && !tail.startsWith("#")) unsupportedLocalYaml(file, map, `ambiguous ${noun} scalar`, entryKey, entryValue);
          comment = tail; closed = true; end = i + 1; break;
        }
        // A YAML backslash at end of line escapes the line break, not the
        // first character on the next line.
        escaped = false;
      }
      if (!closed) unsupportedLocalYaml(file, map, `unterminated or unsupported ${noun} scalar`, entryKey, entryValue);
    } else {
      if (!scalar || scalar.startsWith("#") || scalar === "null" || scalar === "~" || /^[|>&*!{[]/.test(scalar)) unsupportedLocalYaml(file, map, `unsupported ${noun} scalar`, entryKey, entryValue);
      comment = scalar.match(/\s+(#.*)$/)?.[1] || "";
    }
    // Never consume another setting, nested mapping or comment as a scalar.
    if (end < blockEndIndex && lines[end].trim() && !lines[end].trimStart().startsWith("#") && lines[end].startsWith("       ")) {
      unsupportedLocalYaml(file, map, `ambiguous ${noun} continuation`, entryKey, entryValue);
    }
    lines.splice(existing, end - existing, row + (comment ? " " + comment : ""));
  } else lines.splice(blockEndIndex, 0, row);
  atomicWrite(file, `${lines.join("\n")}\n`);
}
/** Sets the scalar `settings.oats.aweb.<name>: value` (such as `attribution`)
 *  in the deployment's oats-local.yaml. A one-line plain or quoted value is
 *  replaced in place, keeping a trailing comment; anything else refuses. */
export function recordAwebScalar(name, value, { start = process.env.OATS_WORKSPACE || process.cwd() } = {}) {
  const file = join(start, "oats-local.yaml");
  const row = `    ${name}: ${yamlScalar(value)}`;
  const refuse = (detail) => { throw new Error(`${file}: cannot safely update settings.oats.aweb.${name} automatically (${detail}); add this line by hand under block-style settings.oats.aweb: ${name}: ${yamlScalar(value)}`); };
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : ["schemaVersion: 2", "workspace: local"];
  while (lines.length && lines.at(-1) === "") lines.pop();
  let settings = findBlockHeader(lines, 0, lines.length, 0, ["settings"]);
  if (typeof settings === "object") refuse(`line ${settings.unsupported + 1} is not a block-style settings: mapping`);
  if (settings < 0) { lines.push("settings:"); settings = lines.length - 1; }
  const settingsEnd = blockEnd(lines, settings, 0);
  let aweb = findBlockHeader(lines, settings + 1, settingsEnd, 2, ["oats.aweb", '"oats.aweb"', "'oats.aweb'"]);
  if (typeof aweb === "object") refuse(`line ${aweb.unsupported + 1} is not a block-style oats.aweb: mapping`);
  if (aweb < 0) aweb = ensureYamlBlock(lines, settings, settingsEnd, 2, "oats.aweb");
  const awebEnd = blockEnd(lines, aweb, 2);
  // The key plain or quoted, and any spacing before the colon, as
  // recordAwebSetting matches an entry's key.
  const matches = [];
  for (let i = aweb + 1; i < awebEnd; i++) {
    if (!lines[i].startsWith("    ") || lines[i].startsWith("     ")) continue;
    const entry = lines[i].slice(4);
    for (const key of [name, `"${name}"`, `'${name}'`]) {
      const delimiter = entry.startsWith(key) ? /^[ \t]*:(.*)$/.exec(entry.slice(key.length)) : null;
      if (delimiter) { matches.push({ at: i, tail: delimiter[1] }); break; }
    }
  }
  if (matches.length > 1) refuse(`duplicate ${name} key`);
  if (!matches.length) { lines.splice(awebEnd, 0, row); atomicWrite(file, `${lines.join("\n")}\n`); return; }
  const { at, tail } = matches[0];
  if (tail && !/^[ \t]/.test(tail)) refuse(`unsupported ${name} delimiter`);
  const scalar = tail.trim();
  const parsed = /^("[^"\\]*"|'[^']*'|[A-Za-z0-9_-]+)(\s+#.*)?$/.exec(scalar);
  if (!parsed) refuse(`unsupported ${name} value`);
  if (at + 1 < awebEnd && lines[at + 1].startsWith("     ") && lines[at + 1].trim() && !lines[at + 1].trimStart().startsWith("#")) refuse(`ambiguous ${name} continuation`);
  lines[at] = row + (parsed[2] ? ` ${parsed[2].trim()}` : "");
  atomicWrite(file, `${lines.join("\n")}\n`);
}

const HOST_MAPS = { human: ["id", "label"], steward: ["id", "home"] };
const ENTRY_KEY = /^(?:"([^"\\]*)"|'([^']*)'|([A-Za-z0-9_.-]+))[ \t]*:(.*)$/;
/** An entry's scalar as recordAwebSetting writes or replaces it: a one-line
 *  plain value, or a quoted one that may continue on deeper lines; undefined
 *  for anything else. */
function hostScalar(tail, more) {
  const text = tail.trim();
  if (text.startsWith('"') || text.startsWith("'")) {
    const quote = text[0];
    let out = "", rest = text.slice(1), next = 0;
    for (;;) {
      for (let i = 0; i < rest.length; i++) {
        const c = rest[i];
        if (c === quote && quote === "'" && rest[i + 1] === "'") { out += "'"; i++; continue; }
        if (c === quote) { const after = rest.slice(i + 1); return !after.trim() || /^\s+#/.test(after) ? out : undefined; }
        if (quote === '"' && c === "\\") {
          const e = rest[i + 1];
          // An escaped line break joins the next line with no space.
          if (e === undefined) { if (next >= more.length) return undefined; rest = more[next++].trimStart(); i = -1; continue; }
          const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", " ": " " }[e];
          if (simple !== undefined) { out += simple; i++; continue; }
          if (e === "u" && /^[0-9a-fA-F]{4}$/.test(rest.slice(i + 2, i + 6))) { out += String.fromCharCode(Number.parseInt(rest.slice(i + 2, i + 6), 16)); i += 5; continue; }
          return undefined;
        }
        if (c < " ") return undefined;
        out += c;
      }
      // An unescaped line break inside quotes folds to a space.
      if (next >= more.length) return undefined;
      out += " ";
      rest = more[next++].trimStart();
    }
  }
  if (more.length || !text || /^[|>&*!{}[\]%@`#,?"']/.test(text) || /^-(\s|$)/.test(text)) return undefined;
  const value = text.replace(/\s+#.*$/, "");
  return value === "null" || value === "~" || /:\s|:$/.test(value) ? undefined : value;
}

/**
 * The host's attribution switch: `attribution`, `human` and `steward` from the
 * deployment-level settings.oats.aweb block of `<deployment>/oats-local.yaml`,
 * in the block style recordAwebSetting and recordAwebScalar write. Unlike the
 * settings a launch hook is given, this is read here: attribution is
 * host-only, so where it was set matters, and the kernel gives a start no
 * origins of current settings. Returns {settings}; absent is `{}` (off), and
 * any form outside that style is `{settings: {}, unreadable: true}` (off).
 */
export function readHostAttribution(deployment) {
  const OFF = { settings: {} }, UNREADABLE = { settings: {}, unreadable: true };
  let lines;
  try { lines = readFileSync(join(deployment, "oats-local.yaml"), "utf8").split(/\r?\n/); } catch (e) { return e.code === "ENOENT" ? OFF : UNREADABLE; }
  // A block's header, once: another, or one in flow style, is unreadable.
  const header = (start, end, indent, names) => {
    const at = findBlockHeader(lines, start, end, indent, names);
    if (typeof at === "object" || at >= 0 && findBlockHeader(lines, at + 1, end, indent, names) !== -1) return { unreadable: true };
    return { at };
  };
  const settings = header(0, lines.length, 0, ["settings"]);
  if (settings.unreadable) return UNREADABLE;
  if (settings.at < 0) return OFF;
  const settingsEnd = blockEnd(lines, settings.at, 0);
  const aweb = header(settings.at + 1, settingsEnd, 2, ["oats.aweb", '"oats.aweb"', "'oats.aweb'"]);
  if (aweb.unreadable) return UNREADABLE;
  if (aweb.at < 0) return OFF;
  const awebEnd = blockEnd(lines, aweb.at, 2);
  const out = {}, content = (i) => lines[i].trim() && !lines[i].trimStart().startsWith("#");
  /** The lines that continue the entry at `i`: deeper than `indent`, up to the next entry. */
  const continuation = (i, indent) => { const more = []; for (let j = i + 1; j < awebEnd && (!content(j) || lines[j].startsWith(" ".repeat(indent + 1))); j++) if (content(j)) more.push(lines[j]); return more; };
  for (let i = aweb.at + 1; i < awebEnd; i++) {
    if (!content(i) || lines[i].startsWith("     ")) continue;
    if (!lines[i].startsWith("    ") || /\t/.test(lines[i])) return UNREADABLE;
    const m = ENTRY_KEY.exec(lines[i].slice(4));
    if (!m) return UNREADABLE;
    const key = m[1] ?? m[2] ?? m[3], tail = m[4];
    if (key === "attribution") {
      if (Object.hasOwn(out, key) || continuation(i, 4).length) return UNREADABLE;
      const v = /^\s+("([^"\\]*)"|'([^']*)'|([A-Za-z0-9_-]+))(\s+#.*)?$/.exec(tail);
      if (!v) return UNREADABLE;
      out.attribution = v[2] ?? v[3] ?? v[4];
    } else if (HOST_MAPS[key]) {
      // recordAwebSetting finds the map by its plain header alone.
      if (Object.hasOwn(out, key) || m[3] === undefined || tail.trim()) return UNREADABLE;
      const map = {};
      for (let j = i + 1; j < awebEnd && (!content(j) || lines[j].startsWith("     ")); j++) {
        if (!content(j) || lines[j].startsWith("       ")) continue;
        if (!lines[j].startsWith("      ") || /\t/.test(lines[j])) return UNREADABLE;
        const e = ENTRY_KEY.exec(lines[j].slice(6));
        if (!e) return UNREADABLE;
        const name = e[1] ?? e[2] ?? e[3], value = hostScalar(e[4], continuation(j, 6));
        if (value === undefined || Object.hasOwn(map, name)) return UNREADABLE;
        if (HOST_MAPS[key].includes(name)) map[name] = value;
      }
      out[key] = map;
    }
  }
  return { settings: out };
}
