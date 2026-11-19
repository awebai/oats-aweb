import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkRecordedAwArgv } from '../scripts/check-aw-argv.mjs';

// Test the guard itself at its external CLI boundary. These cases are also
// checked with the installed real binary by CI after the recording test group.
test('argv guard rejects a missing nested command and an unknown flag', t => {
  const base = mkdtempSync(join(tmpdir(), 'aw-guard-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const aw = join(base, 'aw');
  writeFileSync(aw, `#!${process.execPath}\nconst cmd = process.argv.slice(2, -1).join(' ');\nconsole.log('Usage:\\n  aw ' + (cmd === 'id team nonexistent' ? 'id team' : cmd) + ' [flags]\\nFlags:\\n      --json    Output as JSON');\n`, { mode: 0o755 });
  assert.deepEqual(checkRecordedAwArgv(aw, [{ command: 'id team members', flags: ['--json'] }]), ['id team members']);
  assert.throws(() => checkRecordedAwArgv(aw, [{ command: 'id team nonexistent', flags: [] }]), /missing full command/);
  assert.throws(() => checkRecordedAwArgv(aw, [{ command: 'id team members', flags: ['--nonexistent'] }]), /does not accept --nonexistent/);
  assert.throws(() => checkRecordedAwArgv(aw, []), /no hook argv/);
});
