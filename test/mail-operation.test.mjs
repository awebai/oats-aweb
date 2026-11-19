// `oats operation run messaging:mail` as the kernel runs it: `node
// bin/oats-aweb.mjs mail [--limit N] [--cursor C] [--conversation ID] --json`
// in the home, with OATS_OPERATION set. The fake aw validates every argv
// against the captured aw grammar and records it for the real-aw help check
// (scripts/check-aw-argv.mjs); it answers from a script per identity home.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fakeAwArgvCheck } from './helpers/aw-argv.mjs';
import { assertKernelOperationAnswer } from './helpers/kernel-operation-envelope-rule.mjs';
import { assertReadOnlyAwArgv } from '../oats-package/capabilities/oats-aweb/lib/mail-read.mjs';

const HOOK = fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs', import.meta.url));

function fixture(t, { version = '1.36.58', script }) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'oats-aweb-mail-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'agents', 'dev', 'instances', 'dev-1'), bin = join(base, 'bin'), calls = join(base, 'calls.jsonl');
  const joined = join(home, '.aweb-identity-alpha');
  for (const d of [join(home, '.aw'), joined, bin, join(base, 'user')]) mkdirSync(d, { recursive: true });
  const data = typeof script === 'function' ? script({ primary: join(home, '.aw'), joined }) : script;
  writeFileSync(join(base, 'script.json'), JSON.stringify(data));
  writeFileSync(join(home, 'instance.json'), JSON.stringify({ instance: 'dev-1', capabilityMeta: { 'oats.aweb': {
    team: 'default:acme.test', alias: 'dev-1', identity: { mode: 'local', alias: 'dev-1', team: 'default:acme.test' },
    defaultTeam: { label: 'acme', team: 'default:acme.test', from: 'deployment' },
    joinedTeams: [{ label: 'alpha', team: 'default:alpha.test', identityHome: joined, receive: 'poll', since: '2026-11-19T00:00:00Z' }],
  } } }));
  writeFileSync(join(bin, 'aw'), `#!${process.execPath}
const fs = require('node:fs');
let args = process.argv.slice(2);
${fakeAwArgvCheck('args')}
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
let identityHome = null;
if (args[0] === '--identity-home') { identityHome = args[1]; args = args.slice(2); }
// SPLIT_UTF8: write the answer in two chunks, cut inside its first multibyte character.
const emit = (o) => {
  const bytes = Buffer.from(JSON.stringify(o) + '\\n');
  const at = process.env.SPLIT_UTF8 ? bytes.findIndex((b) => b >= 0xc0) + 1 : 0;
  if (at <= 0) { process.stdout.write(bytes, () => process.exit(0)); return; }
  process.stdout.write(bytes.subarray(0, at), () => setTimeout(() => process.stdout.write(bytes.subarray(at), () => process.exit(0)), 100));
};
if (args[0] === 'version') { console.log('aw ${version}\\n  commit: 0000000000000000000000000000000000000000 (github.com/awebai/aw)'); process.exit(0); }
const s = JSON.parse(fs.readFileSync(${JSON.stringify(join(base, 'script.json'))}, 'utf8'))[identityHome] || {};
const flag = (n) => args.includes(n) ? args[args.indexOf(n) + 1] : undefined;
if (args[0] === 'whoami' && s.whoami) emit(s.whoami);
else if (args[0] === 'mail' && args[1] === 'threads' && s.threads) emit({ conversations: s.threads });
else if (args[0] === 'mail' && args[1] === 'show' && s.conversations && s.conversations[flag('--conversation-id')]) emit({ messages: s.conversations[flag('--conversation-id')] });
else { console.error('mail conversation not found'); process.exit(1); }
`, { mode: 0o755 });
  const env = { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(base, 'user'), AW_NO_UPDATE_CHECK: '1',
    OATS_SETTINGS: '{}', OATS_DEFAULT_TEAM: 'acme', OATS_DEFAULT_TEAM_ID: 'default:acme.test', OATS_INSTANCE: 'dev-1', OATS_INSTANCE_HOME: home, OATS_HOME: home };
  const operation = (args = [], extra = {}) => spawnSync(process.execPath, [HOOK, 'mail', ...args, '--json'], { cwd: home, env: { ...env, ...extra, OATS_OPERATION: 'messaging:mail' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
  const readCalls = () => { try { return readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
  return { home, joined, env, operation, readCalls };
}

const message = (id, minute, from, to, extra = {}) => ({ message_id: id, conversation_id: 'c1', subject: `s ${id}`, body: `b ${id}`, created_at: new Date(Date.UTC(2026, 10, 19, 9, minute)).toISOString(),
  from_did: from, to_did: to, from_alias: from.slice(-4), to_alias: to.slice(-4), read_at: null, priority: 'normal', verification_status: 'verified', ...extra });

test('messaging:mail answers one envelope with documents and the mail field, reading both identities and running only read-only aw', (t) => {
  const f = fixture(t, { script: ({ primary, joined }) => ({
    [primary]: { whoami: { did: 'did:key:z6Mkdev1', alias: 'dev-1', address: 'acme.test/dev-1' }, threads: [{ conversation_type: 'mail', conversation_id: 'c1', title: 'hello', last_message_at: '2026-11-19T09:05:00Z' }],
      conversations: { c1: [message('m1', 1, 'did:key:z6Mkpeer', 'did:key:z6Mkdev1'), message('m2', 5, 'did:key:z6Mkdev1', 'did:key:z6Mkpeer')] } },
    [joined]: { whoami: { did: 'did:key:z6Mkdev2', alias: 'dev-1', address: 'alpha.test/dev-1' }, threads: [{ conversation_type: 'mail', conversation_id: 'a1', last_message_at: '2026-11-19T09:03:00Z' }],
      conversations: { a1: [message('n1', 3, 'did:key:z6Mkzzzz', 'did:key:z6Mkdev2', { conversation_id: 'a1' })] } },
  }) });
  const v = assertKernelOperationAnswer(f.operation(), { ok: true, label: 'messaging:mail' });
  // The kernel's view rule: documents [{label, kind?, path?, text?}].
  assert.ok(Array.isArray(v.result.documents) && v.result.documents.every((d) => typeof d.label === 'string' && d.label && ['markdown', 'text'].includes(d.kind) && typeof d.text === 'string'));
  assert.deepEqual(Object.keys(v.result).sort(), ['documents', 'mail']);
  const { mail } = v.result;
  assert.deepEqual(mail.messages.map((m) => [m.id, m.team, m.direction]), [['m2', 'acme', 'sent'], ['n1', 'alpha', 'received'], ['m1', 'acme', 'received']]);
  assert.deepEqual(mail.identities.map((i) => [i.team, i.primary, i.error]), [['acme', true, null], ['alpha', false, null]]);
  assert.equal(mail.acknowledges, false);
  const calls = f.readCalls();
  for (const argv of calls) assert.doesNotThrow(() => assertReadOnlyAwArgv(argv), argv.join(' '));
  const command = (a) => { const rest = a[0] === '--identity-home' ? a.slice(2) : a; return rest.slice(0, rest[0] === 'mail' ? 2 : 1).join(' '); };
  assert.deepEqual([...new Set(calls.map(command))].sort(), ['mail show', 'mail threads', 'version', 'whoami']);
  assert.ok(calls.filter((a) => a[0] !== 'version').every((a) => a[0] === '--identity-home' && [join(f.home, '.aw'), f.joined].includes(a[1])), 'every mail read runs as one of this home\'s identities');
});

test('messaging:mail passes limit, cursor and conversation, and refuses a bad limit with E_BAD_ARGS', (t) => {
  const f = fixture(t, { script: ({ primary }) => ({ [primary]: { whoami: { did: 'did:key:z6Mkdev1', alias: 'dev-1' }, threads: [],
    conversations: { c1: [message('m1', 1, 'did:key:z6Mkpeer', 'did:key:z6Mkdev1'), message('m2', 2, 'did:key:z6Mkpeer', 'did:key:z6Mkdev1')] } } }) });
  let v = assertKernelOperationAnswer(f.operation(['--conversation', 'c1', '--limit', '1']), { ok: true, label: 'one conversation' });
  assert.deepEqual(v.result.mail.messages.map((m) => m.id), ['m2']);
  assert.equal(v.result.mail.hasMore, true);
  v = assertKernelOperationAnswer(f.operation(['--conversation', 'c1', '--limit', '1', '--cursor', v.result.mail.nextCursor]), { ok: true, label: 'next page' });
  assert.deepEqual(v.result.mail.messages.map((m) => m.id), ['m1']);
  assert.equal(f.readCalls().filter((a) => a.includes('threads')).length, 0);
  v = assertKernelOperationAnswer(f.operation(['--limit', '201']), { ok: false, label: 'limit 201' });
  assert.equal(v.code, 'E_BAD_ARGS');
});

for (const version of ['1.36.40', '1.36.32']) {
  test(`aw ${version}, below 1.36.53${version === '1.36.32' ? ' and the provider\'s own floor' : ''}, answers E_AW_TOO_OLD with the version it needs, before any mail call`, (t) => {
    const f = fixture(t, { version, script: {} });
    const v = assertKernelOperationAnswer(f.operation(), { ok: false, label: 'old aw' });
    assert.equal(v.code, 'E_AW_TOO_OLD');
    assert.match(v.message, new RegExp(`aw ${version.replace(/\./g, '\\.')} .*needs aw >= 1\\.36\\.53`));
    assert.deepEqual(v.envelope.error.details, { version, needs: '1.36.53' });
    assert.deepEqual(f.readCalls().map((a) => a[0]), ['version']);
  });
}

test('a UTF-8 character split across aw\'s output chunks reaches the answer whole', (t) => {
  const body = 'café 😀 ünïcödé';
  const f = fixture(t, { script: ({ primary }) => ({ [primary]: { whoami: { did: 'did:key:z6Mkdév1', alias: 'dév-1' }, threads: [],
    conversations: { c1: [message('m1', 1, 'did:key:z6Mkpeer', 'did:key:z6Mkdév1', { subject: 'ça va', body })] } } }) });
  const v = assertKernelOperationAnswer(f.operation(['--conversation', 'c1'], { SPLIT_UTF8: '1' }), { ok: true, label: 'split utf-8' });
  const [m] = v.result.mail.messages;
  assert.equal(m.body, body);
  assert.equal(m.subject, 'ça va');
  assert.equal(v.result.mail.identities[0].alias, 'dév-1');
  assert.equal(m.direction, 'received');
});

test('no identity readable fails whole with E_MAIL_UNREADABLE and each identity\'s error', (t) => {
  const f = fixture(t, { script: {} });
  const v = assertKernelOperationAnswer(f.operation(), { ok: false, label: 'unreadable' });
  assert.equal(v.code, 'E_MAIL_UNREADABLE');
  assert.deepEqual(v.envelope.error.details.identities.map((i) => [i.team, i.error]), [['acme', 'identity-unreadable'], ['alpha', 'identity-unreadable']]);
});
