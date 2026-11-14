// The refusal sites of the spawn's modules, found in their source: every message template that
// carries a fix (" → "), and every message given to attributionError or to a wrapper that takes
// its message from its caller. test/attribution-refusal-room.test.mjs gives each one a row.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const CAPABILITY = "oats-package/capabilities/oats-aweb";
/** The modules a spawn's refusals come from, and in bin, the calls that build one. */
export const SPAWN_MODULES = ["lib/admission.mjs", "lib/attribution.mjs", "lib/admission-lock.mjs"].map((f) => `${CAPABILITY}/${f}`);
export const BIN = `${CAPABILITY}/bin/oats-aweb.mjs`;
/** Wrappers whose message is their caller's argument: [file, name, the argument's index]. */
const MESSAGE_WRAPPERS = [[`${CAPABILITY}/lib/admission.mjs`, "refused", 0], [`${CAPABILITY}/lib/attribution.mjs`, "fail", 1]];

/** The literal starting at `src[i]` (a quote or a backtick): its end, and its text with each
 *  `${…}` replaced by `${}`. Nested templates inside a `${…}` are skipped whole. */
function literalAt(src, i) {
  const q = src[i];
  let out = "", j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { out += src.slice(j, j + 2); j += 2; continue; }
    if (c === q) return { end: j + 1, text: out };
    if (q === "`" && c === "$" && src[j + 1] === "{") { j = skipExpression(src, j + 2); out += "${}"; continue; }
    out += c; j += 1;
  }
  throw new Error(`unterminated literal at ${i}`);
}
/** The index after the `}` that closes the expression starting at `j`. */
function skipExpression(src, j) {
  let depth = 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "`" || c === '"' || c === "'") { j = literalAt(src, j).end; continue; }
    if (c === "{") depth += 1;
    if (c === "}") { depth -= 1; if (depth === 0) return j + 1; }
    j += 1;
  }
  throw new Error("unterminated expression");
}
/** Every top-level literal in `src` (comments skipped), with its line: [{line, text, start}]. */
function literals(src) {
  const found = [];
  let i = 0, line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") { line += 1; i += 1; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i += 1; continue; }
    if (c === "/" && src[i + 1] === "*") { const end = src.indexOf("*/", i + 2); line += src.slice(i, end).split("\n").length - 1; i = end + 2; continue; }
    if (c === "/" && /[(,=:[!&|?{};]\s*$/.test(src.slice(Math.max(0, i - 20), i))) {
      // A regex literal: skipped, so its quotes aren't read as strings.
      let j = i + 1, cls = false;
      while (j < src.length && (cls || src[j] !== "/")) { if (src[j] === "\\") j += 1; else if (src[j] === "[") cls = true; else if (src[j] === "]") cls = false; j += 1; }
      i = j + 1; continue;
    }
    if (c === "`" || c === '"' || c === "'") {
      const lit = literalAt(src, i);
      found.push({ line, text: lit.text, start: i });
      line += src.slice(i, lit.end).split("\n").length - 1;
      i = lit.end; continue;
    }
    i += 1;
  }
  return found;
}
/** The site's template as a matcher: each `${}` matches anything. */
export const templateMatcher = (text) => new RegExp(`^${text.split("${}").map((p) => p.replace(/\\(.)/g, "$1").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*")}$`);

/** The refusal sites: [{file, line, template}], `template` being the message with `${}` holes. */
export function refusalSites() {
  const sites = [];
  const seen = new Set();
  const add = (file, src, at, template) => {
    const line = src.slice(0, at).split("\n").length, key = `${file}:${line}:${template}`;
    if (!seen.has(key)) { seen.add(key); sites.push({ file, line, template }); }
  };
  for (const file of [...SPAWN_MODULES, BIN]) {
    const src = readFileSync(join(ROOT, file), "utf8");
    // Each message given to attributionError, or to a wrapper that takes its caller's message:
    // read where the call is, so nothing before it can mislead the reading.
    const calls = [/attributionError\(\s*"E_[A-Z_]+",\s*/g, ...MESSAGE_WRAPPERS.filter(([f]) => f === file).map(([, name, index]) => new RegExp(`\\b${name}\\(${index ? '\\s*"[a-z-]+",' : ""}\\s*(?=[\`"'])`, "g"))];
    for (const re of calls) for (const m of src.matchAll(re)) {
      const at = m.index + m[0].length, c = src[at];
      if (c === "`" || c === '"' || c === "'") add(file, src, at, literalAt(src, at).text);
      else add(file, src, at, `<${src.slice(at).split(/[,\n]/)[0].trim().slice(0, 60)}>`);
    }
    // In the library modules, every template that carries a fix ("→"), wherever it is built.
    if (file !== BIN) for (const lit of literals(src)) if (lit.text.includes(" → ")) add(file, src, lit.start, lit.text);
  }
  return sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
