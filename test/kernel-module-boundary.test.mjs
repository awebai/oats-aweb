// A package never names or imports a kernel-private module. OATS mirrors each
// capability under oats-package/capabilities/ byte for byte, and its test "the
// package mirrors respect the actual public kernel module boundary"
// (test/capabilities.test.mjs) refuses a mirrored executable that names the
// kernel's private module file, imports a non-public @awebai/oats subpath or
// resolves kernel files through `oats root`. This test applies the same three
// patterns here, so a release can't break the pin that mirrors it (1.42.1).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const capabilities = fileURLToPath(new URL('../oats-package/capabilities/', import.meta.url));

function executables(dir) {
  const files = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') files.push(...executables(p)); }
    else if (e.isFile() && (p.endsWith('.mjs') || p.endsWith('.js'))) files.push(p);
  }
  return files;
}

test('no mirrored executable names, imports or resolves a kernel-private module', () => {
  const files = executables(capabilities);
  assert.ok(files.length >= 4, `expected the package's executables, saw ${files.length}`);
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const name = relative(capabilities, f);
    // The filename, not the path: OATS's pattern, which a dynamically joined path can't read past.
    assert.doesNotMatch(text, /core\.mjs/, `${name} names the kernel-private module`);
    assert.doesNotMatch(text, /@awebai\/oats\/(?!(?:core|package\.json)["'`])[^"'`]+/, `${name} imports a non-public kernel subpath`);
    assert.doesNotMatch(text, /\boats root\b/, `${name} resolves kernel files through \`oats root\``);
  }
});
