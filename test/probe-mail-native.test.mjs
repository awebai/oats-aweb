// Native argv admission and the provider's single-send path with a controlled
// external transport. No native mail, Cloud request or live identity is used.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { runProbe } from '../oats-package/capabilities/oats-aweb/lib/probe.mjs';
import { qualifyProbeSupport } from '../oats-package/capabilities/oats-aweb/lib/probe-support.mjs';
import { verifyPinnedAw } from './helpers/pinned-aw.mjs';
import { fixture } from './helpers/probe-fixture.mjs';

const skip = !process.env.OATS_TEST_AW && 'set OATS_TEST_AW to a pinned real aw';
test('native probe argv selects the fresh-send contract and preserves one send with full reply proof', { skip }, async t => {
  const binary = realpathSync(process.env.OATS_TEST_AW);
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'probe-native-help-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const native = args => spawnSync(binary, args, { cwd: home, encoding: 'utf8', timeout: 10000,
    env: { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, AW_NO_UPDATE_CHECK: '1' } });
  const reported = native(['version']);
  verifyPinnedAw(binary, reported);
  const version = /^aw (\S+)$/m.exec(reported.stdout)[1];
  const newConversationFlag = version === '1.36.33';
  const f = fixture(t, { newConversationFlag });
  for (const root of [f.root, f.home]) writeFileSync(join(root, '.aw', 'workspace.yaml'), 'aweb_url: https://app.aweb.ai/api\n');
  f.deps.support = args => qualifyProbeSupport({ ...args, resolveAw: () => binary,
    observe: async () => ({ build: { aweb_version: '1.27.12' } }),
    execute: async (cmd, argv, cap) => {
      if (argv.join(' ') === 'version' || argv.join(' ') === 'mail send --help') {
        const result = native(argv); assert.equal(result.status, 0, result.stderr); return Buffer.from(result.stdout);
      }
      return args.execute(cmd, argv, cap);
    } });
  const result = await runProbe(f.args, f.deps);
  assert.equal(result.outcome, 'PASS', result.reason);
  const sends = f.calls.filter(c => c.args.includes('send'));
  assert.equal(sends.length, 1);
  assert.equal(sends[0].args.includes('--new-conversation'), newConversationFlag);
  assert.equal(f.calls.find(c => c.args.includes('mail')), sends[0], 'no prior conversation/inbox discovery');
  // Admit the actual provider-built argv, including leading identity/team flags,
  // against this native CLI. Help reads no body file and performs no send/read.
  const seen = new Set();
  for (const call of f.calls.filter(c => c.cmd === binary && c.args.includes('mail'))) {
    const key = JSON.stringify(call.args);
    if (seen.has(key)) continue;
    seen.add(key);
    const admitted = native([...call.args, '--help']);
    assert.equal(admitted.status, 0, admitted.stderr);
  }
  assert.ok(f.calls.some(c => c.args.includes('--message-id')));
  assert.ok(f.calls.some(c => c.args.includes('--conversation-id') && c.args.includes('--limit')));
  assert.deepEqual(readdirSync(home), [], 'native qualification/help leaves its disposable HOME empty');
});
