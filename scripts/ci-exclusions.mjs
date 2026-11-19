// CI exclusions name exact, literal top-level tests. Refuse stale names before
// launching a group; a renamed test must not silently change its CI coverage.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function exclusionArgs(names, files) {
  const sources = files.map(file => readFileSync(file, 'utf8'));
  for (const name of names) {
    const literals = [JSON.stringify(name), "'" + name.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'"];
    const declarations = literals.map(literal => new RegExp('\\btest\\s*\\(\\s*' + escape(literal) + '\\s*[,)]'));
    assert.ok(sources.some(source => declarations.some(pattern => pattern.test(source))), `CI exclusion names no declared literal test: ${name}`);
  }
  return names.map(name => '--test-skip-pattern=^' + escape(name) + '$');
}
