// The top-level values of a record aw writes (a `.aw/workspace.yaml`), read in the closed grammar
// aw's writer produces, so that on every file the grammar accepts the values are the ones a YAML
// parser gives, and every other file is refused (null). aw writes with Go's yaml.v3: one
// `key: value` per top-level line, a value plain or quoted on that one line, and nested blocks
// (its `memberships:` list) only under a key with no value, indented with spaces. The grammar is:
//
//   - a blank line, or a comment line (`#` after any indentation);
//   - a top-level entry at column 0: `key:` then nothing (a nested block may follow) or one
//     scalar; the key is an identifier ([A-Za-z_][A-Za-z0-9_-]*), and no key appears twice;
//   - a nested line: indented with spaces only, under a top-level key with no value, holding an
//     optional `- ` and then `key:`, `key: scalar` or a scalar;
//   - a scalar: double-quoted with no `"` or `\` inside, single-quoted with no `'` inside, or plain:
//     not starting with a YAML indicator or a space, and holding no `:` before a space or a tab and
//     no trailing `:` (a comment after a scalar, ` #` onwards, is allowed and dropped).
//
// So no flow collection, block scalar, multi-line or escaped quote, anchor, alias, tag, quoted or
// complex key, directive, document marker or tab indentation is accepted, and no line can belong
// to anything but the entry it appears to: a column-0 line is always a top-level entry. A value is
// the scalar's text, as aw's typed (string) fields take it. A line ends at `\n` (a `\r` before it
// is dropped); a file holding any other break YAML 1.1 parsers (libyaml, and Go's yaml.v3 that aw
// uses) take as a line end (a lone `\r`, NEL, U+2028, U+2029) is refused, so no line is split
// differently here than there.

const KEY = '[A-Za-z_][A-Za-z0-9_-]*';
const TOP = new RegExp(`^(${KEY}):(.*)$`, 's');
const NESTED = new RegExp(`^ +(?:- )?(?:(${KEY}):(.*)|(.*))$`, 's');
const PLAIN_START = /^[^\s\-?:,[\]{}#&*!|>'"%@`]/;

/** The text of one scalar as YAML reads it, comment dropped; undefined when it is outside the
 *  grammar. */
function scalar(raw) {
  const text = raw.replace(/[ \t]+$/, '');
  const quoted = /^"([^"\\]*)"(?:[ \t]+#.*)?$/s.exec(text) ?? /^'([^']*)'(?:[ \t]+#.*)?$/s.exec(text);
  if (quoted) return quoted[1];
  const plain = text.replace(/[ \t]+#.*$/s, '');
  if (!PLAIN_START.test(plain) || /:[ \t]/.test(plain) || plain.endsWith(':')) return undefined;
  return plain;
}

/** After `key:`, the value part: null for none (a nested block may follow), the scalar's text,
 *  or undefined when it is outside the grammar. */
function entryValue(rest) {
  if (rest !== '' && !/^[ \t]/.test(rest)) return undefined;
  const value = rest.replace(/^[ \t]+/, '');
  if (value === '' || value.startsWith('#')) return null;
  return scalar(value);
}

/** A Map of the record's top-level keys to their values (a string, or null for a key with no
 *  value), or null when the text is outside the grammar above. */
export function readAwRecord(text) {
  if (/\r(?!\n)|[\u0085\u2028\u2029]/.test(String(text))) return null;
  const entries = new Map();
  let open = false; // the last top-level key had no value, so nested lines may follow it
  for (const line of String(text).split('\n').map((l) => l.replace(/\r$/, ''))) {
    if (/^[ \t]*$/.test(line) || /^[ \t]*#/.test(line)) continue;
    const top = TOP.exec(line);
    if (top) {
      const value = entryValue(top[2]);
      if (value === undefined || entries.has(top[1])) return null;
      entries.set(top[1], value);
      open = value === null;
      continue;
    }
    const nested = NESTED.exec(line);
    if (!open || !nested) return null;
    if (nested[1] !== undefined ? entryValue(nested[2]) === undefined : scalar(nested[3]) === undefined) return null;
  }
  return entries;
}
