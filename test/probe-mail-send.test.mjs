import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runProbe } from '../oats-package/capabilities/oats-aweb/lib/probe.mjs';
import { freshMailSendFlag } from '../oats-package/capabilities/oats-aweb/lib/probe-support.mjs';
import { AW_MIN, versionAtLeast } from '../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs';
import { fixture } from './helpers/probe-fixture.mjs';

const captured = version => readFileSync(new URL(`./fixtures/probe/mail-send-help-${version}.txt`, import.meta.url), 'utf8');

for (const [version, expected] of [['1.36.33', true], ['1.36.58', false], ['1.36.59-rc.3', false]]) {
  test(`fresh-send admission matches native aw ${version} help`, () => {
    assert.equal(freshMailSendFlag(captured(version)), expected);
  });
}

test('fresh-send admission refuses unknown or incomplete native help', () => {
  const modern = captured('1.36.58');
  for (const text of ['', 'unrecognized contract', modern.replace('--to string', '--other string'), modern.replace('\n  aw mail send [flags]', '\n  aw mail [flags]'), modern.replace('send starts a new thread', 'unknown thread behavior')]) {
    assert.notEqual(text, modern, 'each refusal vector must change the native help');
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

test('the legacy fresh-thread branch cannot outlive its supported floor', () => {
  assert.ok(!versionAtLeast(AW_MIN, '1.36.53'), 'floor contains 91ea73fe: delete the --new-conversation branch');
});

test('an incomplete or non-boolean fresh-send qualification cannot send', async t => {
  for (const newConversationFlag of [undefined, 'false', 0, null]) {
    const f = fixture(t);
    f.deps.support = async () => ({cli: true, server: true, awBinary: '/fixture/aw', newConversationFlag});
    const result = await runProbe(f.args, f.deps);
    assert.equal(result.reason, 'probe-cli-fresh-send-unqualified');
    assert.equal(f.calls.some(c => c.args.includes('send')), false);
  }
});
