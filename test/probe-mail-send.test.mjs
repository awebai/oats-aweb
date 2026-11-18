import assert from 'node:assert/strict';
import test from 'node:test';
import { runProbe } from '../oats-package/capabilities/oats-aweb/lib/probe.mjs';
import { freshMailSendFlag } from '../oats-package/capabilities/oats-aweb/lib/probe-support.mjs';
import { fixture } from './helpers/probe-fixture.mjs';

const flags = '\nUsage:\n  aw mail send [flags]\nFlags:\n      --to string   Recipient\n      --subject string   Subject\n      --body-file string   Body file\n';
const legacy = 'Reuse an existing conversation by default.\n' + flags + '      --new-conversation   Start fresh\n';
const modern = 'With a recipient (--to, --to-did or --to-address), send starts a new thread\ntitled by --subject, which is required.\n' + flags;

test('fresh-send admission distinguishes both native contracts and refuses unknown help', () => {
  assert.equal(freshMailSendFlag(legacy), true);
  assert.equal(freshMailSendFlag(modern), false);
  for (const text of ['', flags, modern.replace('--to string', '--other string'), modern.replace('aw mail send', 'aw mail')]) {
    assert.throws(() => freshMailSendFlag(text), e => e.reason === 'probe-cli-fresh-send-unsupported');
  }
});

for (const newConversationFlag of [true, false]) test(`probe sends once with fresh conversation flag=${newConversationFlag}`, async t => {
  const f = fixture(t, { newConversationFlag });
  const r = await runProbe(f.args, f.deps);
  assert.equal(r.outcome, 'PASS', r.reason);
  const sends = f.calls.filter(c => c.args.includes('send'));
  assert.equal(sends.length, 1);
  assert.equal(sends[0].args.includes('--new-conversation'), newConversationFlag);
  assert.equal(sends[0].args.includes('--conversation-id'), false);
  const firstMail = f.calls.find(c => c.args.includes('mail'));
  assert.equal(firstMail, sends[0], 'no conversation or inbox discovery before the send');
});
