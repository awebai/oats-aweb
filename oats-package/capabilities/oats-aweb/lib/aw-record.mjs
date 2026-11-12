// The top-level `aweb_url` of a record aw writes (a `.aw/workspace.yaml`), read in the closed
// grammar aw's writer produces: on every file the grammar accepts, the aweb_url text it returns is
// the scalar YAML 1.1 reads there, and every other file is refused. aw writes with Go's yaml.v3:
// one `key: value` per top-level line, a value plain or quoted on that one line, and its
// `memberships:` list, a block sequence of flat mappings at a fixed indentation (`    - key: v`,
// then `      key: v`), under a key with no value. The grammar is:
//
//   - a blank line, or a comment line (`#` after any indentation);
//   - a top-level entry at column 0: `key:` then nothing (a list may follow) or one scalar; the key
//     is an identifier ([A-Za-z_][A-Za-z0-9_-]*), and no key appears twice;
//   - under a top-level key with no value only, a list item `    - key:` or `    - key: scalar` (4
//     spaces), and after an item its further keys, `      key:` or `      key: scalar` (6 spaces);
//   - a scalar: double-quoted with no `"` or `\` inside, single-quoted with no `'` inside, or plain:
//     not starting with a YAML indicator or a space, and holding no `:` before a space or a tab and
//     no trailing `:` (a comment after a scalar, ` #` onwards, is allowed and dropped).
//
// So no flow collection, block scalar, multi-line or escaped quote, anchor, alias, tag, quoted or
// complex key, directive, document marker, tab or other indentation is accepted: every line is
// what it appears to be, and a column-0 line is always a top-level entry. Only aweb_url's text is
// returned, which the caller accepts only as an http(s) URL; such a string is a string to YAML,
// never a null, bool, number or timestamp. A line ends at `\n` or `\r\n`; a file holding any other
// break YAML 1.1 parsers (libyaml, and the yaml.v3 aw uses) take as a line end (a lone `\r`, NEL,
// U+2028, U+2029) is refused, so no line is split differently here than there.

const KEY = '[A-Za-z_][A-Za-z0-9_-]*';
const TOP = new RegExp(`^(${KEY}):(.*)$`, 's');
const ITEM = new RegExp(`^ {4}- (${KEY}):(.*)$`, 's');
const ITEM_KEY = new RegExp(`^ {6}(${KEY}):(.*)$`, 's');
const PLAIN_START = /^[^\s\-?:,[\]{}#&*!|>'"%@`]/;

/** The text of one scalar, comment dropped; undefined when it is outside the grammar. */
function scalar(raw) {
  const text = raw.replace(/[ \t]+$/, '');
  const quoted = /^"([^"\\]*)"(?:[ \t]+#.*)?$/s.exec(text) ?? /^'([^']*)'(?:[ \t]+#.*)?$/s.exec(text);
  if (quoted) return quoted[1];
  const plain = text.replace(/[ \t]+#.*$/s, '');
  if (!PLAIN_START.test(plain) || /:[ \t]/.test(plain) || plain.endsWith(':')) return undefined;
  return plain;
}

/** After `key:`, the value part: null for none, the scalar's text, or undefined when it is
 *  outside the grammar. */
function entryValue(rest) {
  if (rest !== '' && !/^[ \t]/.test(rest)) return undefined;
  const value = rest.replace(/^[ \t]+/, '');
  if (value === '' || value.startsWith('#')) return null;
  return scalar(value);
}

/** `{ awebUrl }` for a record in aw's grammar: the top-level aweb_url's text, null when the key
 *  has no value, undefined when there is no such key. undefined when the file is outside the
 *  grammar, from which nothing is taken. */
export function readAwebUrl(text) {
  if (/\r(?!\n)|[\u0085\u2028\u2029]/.test(String(text))) return undefined;
  const keys = new Set();
  let awebUrl;
  let list = 'none'; // 'open': the last top-level key had no value; 'item': inside a list item
  for (const line of String(text).split('\n').map((l) => l.replace(/\r$/, ''))) {
    if (/^[ \t]*$/.test(line) || /^[ \t]*#/.test(line)) continue;
    const top = TOP.exec(line);
    if (top) {
      const value = entryValue(top[2]);
      if (value === undefined || keys.has(top[1])) return undefined;
      keys.add(top[1]);
      if (top[1] === 'aweb_url') awebUrl = value;
      list = value === null ? 'open' : 'none';
      continue;
    }
    const item = ITEM.exec(line), itemKey = ITEM_KEY.exec(line);
    if (item && list !== 'none' && entryValue(item[2]) !== undefined) { list = 'item'; continue; }
    if (itemKey && list === 'item' && entryValue(itemKey[2]) !== undefined) continue;
    return undefined;
  }
  return { awebUrl };
}
