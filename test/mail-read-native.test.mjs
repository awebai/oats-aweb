// The argv messaging:mail builds, admitted by the real aw at each CI matrix
// version (OATS_TEST_AW). Help reads no identity and calls no server. Below
// MAIL_AW_MIN the real aw has no `mail threads`, and the operation refuses
// before any mail call (test/mail-operation.test.mjs).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { versionAtLeast } from '../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs';
import { MAIL_AW_MIN, assertReadOnlyAwArgv, readMail } from '../oats-package/capabilities/oats-aweb/lib/mail-read.mjs';
import { verifyPinnedAw } from './helpers/pinned-aw.mjs';

const skip = !process.env.OATS_TEST_AW && 'set OATS_TEST_AW to a pinned real aw';
test('real aw: every argv messaging:mail runs exists with these flags, and nothing else is run', { skip }, async (t) => {
  const binary = realpathSync(process.env.OATS_TEST_AW);
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'mail-native-help-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const native = (args) => spawnSync(binary, args, { cwd: home, encoding: 'utf8', timeout: 10000,
    env: { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, AW_NO_UPDATE_CHECK: '1' } });
  const version = /^aw (\S+)$/m.exec(verifyPinnedAw(binary, native(['version'])).version)[1];

  // Every form the read builds: whoami, a threads page and the next one, a
  // conversation, a legacy message, and the one-conversation read.
  const seen = [];
  const at = '2026-11-19T10:00:00Z';
  const aw = async (identityHome, args) => {
    seen.push(['--identity-home', identityHome, ...args]);
    const json = (doc) => ({ status: 0, stdout: JSON.stringify(doc), stderr: '' });
    if (args[0] === 'whoami') return json({ did: 'did:key:z6Mkme', alias: 'me' });
    if (args[1] === 'threads') return json(args.includes('--cursor') ? { conversations: [{ conversation_type: 'mail', legacy_message_id: 'm-legacy', last_message_at: at }] } : { conversations: [{ conversation_type: 'mail', conversation_id: 'c1', last_message_at: at }], next_cursor: 'next' });
    return json({ messages: [] });
  };
  await readMail({ identities: [{ team: 't', identityHome: join(home, '.aw'), primary: true }], aw });
  await readMail({ identities: [{ team: 't', identityHome: join(home, '.aw'), primary: true }], aw, conversation: 'c1' });
  const forms = new Map(seen.map((argv) => [argv.filter((a) => a.startsWith('--') || ['whoami', 'mail', 'threads', 'show'].includes(a)).join(' '), argv]));
  assert.deepEqual([...forms.keys()].sort(), [
    '--identity-home mail show --conversation-id --limit --json',
    '--identity-home mail show --message-id --json',
    '--identity-home mail threads --limit --cursor --json',
    '--identity-home mail threads --limit --json',
    '--identity-home whoami --json',
  ]);
  for (const argv of [...forms.values(), ['version']]) assert.doesNotThrow(() => assertReadOnlyAwArgv(argv));

  const usage = (command) => { const r = native([...command.split(' '), '--help']); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const hasCommand = (command) => { const out = usage(command); return out.includes(`\n  aw ${command} `) || out.includes(`\n  aw ${command}\n`); };
  if (!versionAtLeast(version, MAIL_AW_MIN)) {
    assert.equal(hasCommand('mail threads'), false, `aw ${version} unexpectedly has mail threads; lower MAIL_AW_MIN`);
    t.diagnostic(`aw ${version} lacks mail threads; messaging:mail refuses it with E_AW_TOO_OLD`);
  } else {
    for (const argv of forms.values()) {
      const command = argv.slice(2, argv[2] === 'mail' ? 4 : 3).join(' ');
      assert.ok(hasCommand(command), `aw ${version} has ${command}`);
      // The exact argv, values included, parsed together.
      const admitted = native([...argv, '--help']);
      assert.equal(admitted.status, 0, `${argv.join(' ')}: ${admitted.stderr}`);
    }
    // Read-only by aw's own words.
    assert.match(usage('mail threads'), /Listing marks nothing read/);
  }
  assert.deepEqual(readdirSync(home), [], 'help leaves its disposable HOME empty');
});
