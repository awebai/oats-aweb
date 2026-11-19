// messaging:mail (lib/mail-read.mjs): the read-only argv guard, the merged
// newest-first page, its bounds, partial threads, paging, per-identity errors.
// aw is an external CLI over the network, so these cases stand a scripted aw
// at that boundary; test/mail-read-native.test.mjs checks the argv against the
// real aw, and the stack journey in test/resident-journey.test.mjs reads real
// mail through the kernel and proves nothing is acknowledged.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAIL_BODY_MAX_BYTES, MAIL_IDENTITY_ERRORS, MAIL_LIMIT_MAX, MAIL_SHOW_LIMIT, assertReadOnlyAwArgv, decodeCursor, encodeCursor,
  escapeMarkdown, mailPriority, mailVerification, parseMailArgs, readMail, truncateUtf8,
} from '../oats-package/capabilities/oats-aweb/lib/mail-read.mjs';

const H1 = '/fixture/home/.aw', H2 = '/fixture/home/.aweb-identity-alpha';
const ME = { did: 'did:key:z6MkMe', stable_id: 'did:aw:me', alias: 'dev-1', address: 'acme.test/dev-1' };
const ME2 = { did: 'did:key:z6MkMe2', alias: 'dev-1', address: 'alpha.test/dev-1' };
const iso = (minute) => new Date(Date.UTC(2026, 10, 19, 10, minute)).toISOString();

/** One message as aw's `mail show --json` gives it. */
function msg(id, minute, { from = 'peer', to = 'me', self = ME, conversation = 'c1', ...rest } = {}) {
  const party = (who) => (who === 'me'
    ? { did: self.did, stable: self.stable_id, alias: self.alias, address: self.address }
    : { did: `did:key:z6Mk${who}`, stable: undefined, alias: who, address: `acme.test/${who}` });
  const f = party(from), t = party(to);
  return {
    message_id: id, conversation_id: conversation, subject: `subject ${id}`, body: `body ${id}`, created_at: iso(minute),
    from_did: f.did, ...(f.stable ? { from_stable_id: f.stable } : {}), from_alias: f.alias, from_address: f.address,
    to_did: t.did, ...(t.stable ? { to_stable_id: t.stable } : {}), to_alias: t.alias, to_address: t.address,
    read_at: null, priority: 'normal', verification_status: 'verified', ...rest,
  };
}
const thread = (id, minute, extra = {}) => ({ conversation_type: 'mail', conversation_id: id, title: `thread ${id}`, last_message_at: iso(minute), ...extra });

/** A scripted aw per identity home: whoami, thread pages, conversations. Every
 *  call is checked by the same guard the read uses, and recorded. */
function scriptedAw(script) {
  const calls = [];
  const aw = async (home, args) => {
    assertReadOnlyAwArgv(['--identity-home', home, ...args]);
    calls.push([home, ...args]);
    const s = script[home];
    if (!s) return { status: 1, stdout: '', stderr: 'no identity' };
    const json = (doc) => ({ status: 0, stdout: JSON.stringify(doc), stderr: '' });
    if (args[0] === 'whoami') return s.whoami ? json(s.whoami) : { status: 1, stdout: '', stderr: 'aweb: http 401' };
    if (args[1] === 'threads') {
      if (s.threadsError) return { status: 1, stdout: '', stderr: s.threadsError };
      const cursor = args.includes('--cursor') ? args[args.indexOf('--cursor') + 1] : '0';
      const pages = s.threads ?? [[]];
      const i = Number(cursor);
      return json({ conversations: pages[i] ?? [], ...(i + 1 < pages.length ? { next_cursor: String(i + 1) } : {}) });
    }
    if (args[1] === 'show') {
      const key = args.includes('--conversation-id') ? args[args.indexOf('--conversation-id') + 1] : args[args.indexOf('--message-id') + 1];
      const messages = s.conversations?.[key];
      if (messages === 'error') return { status: 1, stdout: '', stderr: 'decrypt failed' };
      if (!messages) return { status: 1, stdout: '', stderr: `mail conversation not found: ${key}` };
      return json({ messages });
    }
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  return { aw, calls, shows: () => calls.filter((c) => c[2] === 'show').length };
}
const read = (script, options = {}) => {
  const s = scriptedAw(script);
  const identities = options.identities ?? [{ team: 'acme', identityHome: H1, primary: true }];
  return readMail({ identities, aw: s.aw, now: () => new Date('2026-11-19T12:00:00Z'), ...options }).then((result) => ({ result, ...s }));
};

test('the argv guard admits only version, whoami, mail threads and mail show', () => {
  for (const args of [['version'], ['whoami', '--json'], ['mail', 'threads', '--limit', '50', '--json'], ['mail', 'threads', '--limit', '50', '--cursor', 'abc', '--json'],
    ['mail', 'show', '--conversation-id', 'c1', '--limit', '500', '--json'], ['mail', 'show', '--message-id', 'm1', '--json'],
    ['--identity-home', '/h/.aw', 'mail', 'threads', '--json']]) assert.doesNotThrow(() => assertReadOnlyAwArgv(args), args.join(' '));
  for (const args of [['mail', 'inbox'], ['mail', 'inbox', '--json'], ['mail', 'inbox', '--count-only', '--json'], ['mail', 'inbox', '--show-all', '--json'], ['mail', 'inbox', '--count-only', '--show-all'],
    ['mail', 'ack', 'm1'], ['mail', 'reply', 'm1', '--body-file', 'f'], ['mail', 'send', '--to', 'x'], ['log'], ['log', '--json'], ['chat', 'pending'],
    ['mail', 'show', '--json'], ['mail', 'show', '--conversation-id', 'c', '--message-id', 'm'], ['mail', 'show', '--conversation-id', '--json'],
    ['mail', 'threads', '--team', 'x'], ['whoami', '--json', '--json'], ['--identity-home', '/h', '--team', 't', 'whoami'], ['mail', 'inbox', '--count-only', '--cursor', 'x']]) {
    assert.throws(() => assertReadOnlyAwArgv(args), { code: 'E_MAIL_ARGV' }, args.join(' '));
  }
});

test('mail from every identity merges newest first, labelled by team, with direction, read state and the contract enums', async () => {
  const { result } = await read({
    [H1]: { whoami: ME, threads: [[thread('c1', 30), thread('c2', 20)]], conversations: {
      c1: [msg('m1', 10), msg('m3', 30, { from: 'me', to: 'peer', read_at: null })],
      c2: [msg('m2', 20, { read_at: iso(21), verification_status: 'identity_mismatch', priority: 'urgent', content_mode: 'encrypted_v2', encrypted_envelope: {} , conversation: 'c2' })],
    } },
    [H2]: { whoami: ME2, threads: [[thread('a1', 25)]], conversations: { a1: [msg('n1', 25, { self: ME2, conversation: 'a1', verification_status: 'verification_stale', priority: 'low' })] } },
  }, { identities: [{ team: 'acme', identityHome: H1, primary: true }, { team: 'alpha', identityHome: H2, primary: false }] });
  const { mail } = result;
  assert.equal(mail.mailApi, 1);
  assert.equal(mail.acknowledges, false);
  assert.equal(mail.observedAt, '2026-11-19T12:00:00.000Z');
  assert.deepEqual(mail.identities, [
    { team: 'acme', alias: 'dev-1', identity: 'did:aw:me', primary: true, error: null },
    { team: 'alpha', alias: 'dev-1', identity: 'did:key:z6MkMe2', primary: false, error: null },
  ]);
  assert.deepEqual(mail.messages.map((m) => [m.id, m.team, m.direction]), [['m3', 'acme', 'sent'], ['n1', 'alpha', 'received'], ['m2', 'acme', 'received'], ['m1', 'acme', 'received']]);
  const [m3, n1, m2, m1] = mail.messages;
  assert.deepEqual(m3.from, { alias: 'dev-1', address: 'acme.test/dev-1', identity: 'did:aw:me' });
  assert.deepEqual(m3.to, { alias: 'peer', address: 'acme.test/peer', identity: 'did:key:z6Mkpeer' });
  assert.equal(m3.readByAgent, true, 'the agent wrote what it sent');
  assert.equal(m1.readByAgent, false);
  assert.equal(m2.readByAgent, true);
  assert.equal(m1.threadTitle, 'thread c1');
  assert.deepEqual([m2.verification, m2.priority, m2.encrypted], ['failed', 'high', true]);
  assert.deepEqual([n1.verification, n1.priority, n1.encrypted], ['unknown', 'normal', false]);
  assert.deepEqual(Object.keys(m1).sort(), ['body', 'conversationId', 'createdAt', 'direction', 'encrypted', 'from', 'id', 'priority', 'readByAgent', 'subject', 'team', 'threadTitle', 'to', 'truncated', 'verification']);
  assert.deepEqual(mail.conversations.map((c) => [c.id, c.partial]).sort(), [['a1', null], ['c1', null], ['c2', null]]);
  assert.equal(mail.hasMore, false);
  assert.equal(mail.nextCursor, null);
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].label, 'Mail');
  assert.equal(result.documents[0].kind, 'markdown');
  assert.match(result.documents[0].text, /never acknowledges/);
});

test('the enum maps and the identity rule', () => {
  assert.deepEqual(['verified', 'verified_legacy', 'verified_custodial', 'unverified', 'failed', 'identity_mismatch', 'verification_stale', '', undefined, 'new'].map(mailVerification),
    ['verified', 'verified', 'verified', 'unverified', 'failed', 'failed', 'unknown', 'unknown', 'unknown', 'unknown']);
  assert.deepEqual(['low', 'normal', 'high', 'urgent', '', undefined, 'other'].map(mailPriority), ['normal', 'normal', 'high', 'high', 'unknown', 'unknown', 'unknown']);
});

test('a body is cut at 16 KiB of UTF-8 on a character boundary, and marked truncated', async () => {
  const long = 'é'.repeat(MAIL_BODY_MAX_BYTES); // 2 bytes each
  const emoji = `${'a'.repeat(MAIL_BODY_MAX_BYTES - 2)}😀tail`; // the emoji (4 bytes) would cross the bound
  assert.deepEqual(truncateUtf8('short'), { text: 'short', truncated: false });
  const cut = truncateUtf8(long);
  assert.equal(cut.truncated, true);
  assert.equal(Buffer.byteLength(cut.text), MAIL_BODY_MAX_BYTES);
  const e = truncateUtf8(emoji);
  assert.equal(e.text, 'a'.repeat(MAIL_BODY_MAX_BYTES - 2));
  assert.equal(truncateUtf8('a'.repeat(MAIL_BODY_MAX_BYTES)).truncated, false);
  const { result } = await read({ [H1]: { whoami: ME, threads: [[thread('c1', 5)]], conversations: { c1: [msg('m1', 5, { body: emoji })] } } });
  assert.equal(result.mail.messages[0].truncated, true);
  assert.ok(Buffer.byteLength(result.mail.messages[0].body) <= MAIL_BODY_MAX_BYTES);
});

test('the whole result stays within 256 KiB: past it the answer stops with hasMore and a cursor, and the next page continues', async () => {
  const big = 'x'.repeat(MAIL_BODY_MAX_BYTES);
  const messages = Array.from({ length: 30 }, (_, i) => msg(`m${String(i).padStart(2, '0')}`, i, { body: big }));
  const script = { [H1]: { whoami: ME, threads: [[thread('c1', 29)]], conversations: { c1: messages } } };
  const first = (await read(script)).result;
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 256 * 1024);
  assert.equal(first.mail.hasMore, true);
  assert.ok(first.mail.messages.length > 5 && first.mail.messages.length < 30);
  const next = (await read(script, { cursor: decodeCursor(first.mail.nextCursor) })).result;
  const ids = [...first.mail.messages, ...next.mail.messages].map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'no overlap');
  assert.deepEqual(ids, messages.map((m) => m.message_id).reverse().slice(0, ids.length));
});

test('a conversation aw can only read from its oldest end is listed partial: oldest-first-only', async () => {
  const messages = Array.from({ length: MAIL_SHOW_LIMIT }, (_, i) => msg(`m${i}`, 0, { conversation: 'long', created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), body: '' }));
  const { result } = await read({ [H1]: { whoami: ME, threads: [[thread('long', 59), thread('short', 1)]], conversations: { long: messages, short: [msg('s1', 1, { conversation: 'short' })] } } }, { limit: 10 });
  assert.deepEqual(result.mail.messages.map((m) => m.conversationId), ['short', ...Array(9).fill('long')]);
  assert.deepEqual(result.mail.conversations, [{ id: 'long', partial: 'oldest-first-only' }, { id: 'short', partial: null }]);
  assert.match(result.documents[0].text, /older part of a long conversation shown; the newest messages can't be read yet/);
});

test('it reads only the threads it needs: once it has `limit` messages newer than every unread thread, it stops', async () => {
  const threads = Array.from({ length: 120 }, (_, i) => thread(`c${i}`, 59 - (i % 60), {}));
  threads.sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
  const conversations = Object.fromEntries(threads.map((t) => [t.conversation_id, [msg(`${t.conversation_id}-m`, Number(t.last_message_at.slice(14, 16)), { conversation: t.conversation_id })]]));
  const pages = [threads.slice(0, 50), threads.slice(50, 100), threads.slice(100)];
  const r = await read({ [H1]: { whoami: ME, threads: pages, conversations } }, { limit: 5 });
  assert.equal(r.result.mail.messages.length, 5);
  assert.ok(r.shows() <= 12, `read ${r.shows()} conversations for 5 messages`);
  assert.equal(r.result.mail.hasMore, true);
  assert.equal(r.calls.filter((c) => c[2] === 'threads').length, 1, 'only the first thread page');
});

test('pages through the merged stream, newest first, with no gap and no overlap', async () => {
  const script = {
    [H1]: { whoami: ME, threads: [[thread('c1', 50), thread('c2', 40)], [thread('c3', 10)]], conversations: {
      c1: [msg('a', 1), msg('b', 45), msg('c', 50)], c2: [msg('d', 40, { conversation: 'c2' }), msg('e', 2, { conversation: 'c2' })], c3: [msg('f', 10, { conversation: 'c3' })] } },
    [H2]: { whoami: ME2, threads: [[thread('x', 30)]], conversations: { x: [msg('g', 30, { self: ME2, conversation: 'x' }), msg('h', 3, { self: ME2, conversation: 'x' })] } },
  };
  const identities = [{ team: 'acme', identityHome: H1, primary: true }, { team: 'alpha', identityHome: H2, primary: false }];
  const seen = [];
  let cursor = null;
  for (let i = 0; i < 10; i++) {
    const { result } = await read(script, { identities, limit: 2, cursor });
    seen.push(...result.mail.messages.map((m) => m.id));
    if (!result.mail.hasMore) break;
    if (result.mail.nextCursor) cursor = decodeCursor(result.mail.nextCursor);
  }
  assert.deepEqual(seen, ['c', 'b', 'd', 'g', 'f', 'h', 'e', 'a']);
});

test('--conversation reads one conversation newest first, on whichever identity has it', async () => {
  const r = await read({
    [H1]: { whoami: ME, threads: [[thread('c1', 50)]], conversations: { c1: [msg('a', 1), msg('b', 2), msg('c', 3)] } },
    [H2]: { whoami: ME2, threads: [[]], conversations: {} },
  }, { identities: [{ team: 'acme', identityHome: H1, primary: true }, { team: 'alpha', identityHome: H2, primary: false }], conversation: 'c1', limit: 2 });
  assert.deepEqual(r.result.mail.messages.map((m) => m.id), ['c', 'b']);
  assert.equal(r.result.mail.hasMore, true);
  assert.deepEqual(r.result.mail.identities.map((i) => i.error), [null, null], 'not found on an identity is no error');
  assert.equal(r.calls.filter((c) => c[2] === 'threads').length, 0);
  const cursor = decodeCursor(r.result.mail.nextCursor, 'c1');
  const rest = await read({ [H1]: { whoami: ME, conversations: { c1: [msg('a', 1), msg('b', 2), msg('c', 3)] } } }, { conversation: 'c1', cursor, limit: 2 });
  assert.deepEqual(rest.result.mail.messages.map((m) => m.id), ['a']);
  assert.equal(rest.result.mail.hasMore, false);
  assert.throws(() => decodeCursor(r.result.mail.nextCursor), { code: 'E_BAD_ARGS' }, 'a conversation cursor is not a whole-mail cursor');
});

test('errors are per identity; the read fails whole only when no identity can be read', async () => {
  const identities = [{ team: 'acme', identityHome: H1, primary: true }, { team: 'alpha', identityHome: H2, primary: false }, { team: 'beta', identityHome: '/gone/.aw', primary: false }];
  const r = await read({
    [H1]: { whoami: ME, threads: [[thread('c1', 5), thread('bad', 4)]], conversations: { c1: [msg('m1', 5)], bad: 'error' } },
    [H2]: { whoami: { ...ME2, grant_scopes: ['mail.send'] } },
  }, { identities, exists: (p) => !p.startsWith('/gone') });
  assert.deepEqual(r.result.mail.identities.map((i) => [i.team, i.error]), [['acme', MAIL_IDENTITY_ERRORS.conversation], ['alpha', MAIL_IDENTITY_ERRORS.noMailRead], ['beta', MAIL_IDENTITY_ERRORS.missing]]);
  assert.deepEqual(r.result.mail.messages.map((m) => m.id), ['m1']);
  assert.ok(!r.calls.some((c) => c[0] === H2 && c[1] === 'mail'), 'a grant without mail.read is not asked for mail');
  await assert.rejects(read({ [H1]: { whoami: ME, threadsError: 'aweb: http 500' }, [H2]: {} }, { identities: identities.slice(0, 2) }), (e) => e.code === 'E_MAIL_UNREADABLE' && e.details.identities.length === 2);
  await assert.rejects(read({}, { identities: [{ team: 'acme', identityHome: undefined, primary: true }] }), { code: 'E_MAIL_UNREADABLE' });
});

test('a read past its conversation budget answers only what it can prove is newest', async () => {
  const threads = Array.from({ length: 20 }, (_, i) => thread(`c${i}`, 59 - i));
  const conversations = Object.fromEntries(threads.map((t, i) => [t.conversation_id, [msg(`m${i}`, 0, { conversation: t.conversation_id, created_at: iso(0) })]]));
  const r = await read({ [H1]: { whoami: ME, threads: [threads], conversations } }, { limit: 5, maxReads: 4 });
  assert.deepEqual(r.result.mail.messages, [], 'old messages in recently active threads cannot be ordered within the budget');
  assert.equal(r.result.mail.identities[0].error, MAIL_IDENTITY_ERRORS.tooMany);
  assert.equal(r.result.mail.hasMore, false);
  assert.equal(r.shows(), 4);
});

test('arguments: limit 1 to 200, an opaque cursor from an answer, one conversation id', () => {
  assert.deepEqual(parseMailArgs(['--json']), { limit: 50, cursor: null, conversation: null, json: true, home: undefined });
  assert.equal(parseMailArgs(['--limit', '200']).limit, MAIL_LIMIT_MAX);
  for (const bad of [['--limit', '0'], ['--limit', '201'], ['--limit', '1.5'], ['--limit', 'x'], ['--cursor', 'not a cursor'], ['--cursor', Buffer.from('{"v":2}').toString('base64url')], ['--conversation', '--json'], ['--other']]) {
    assert.throws(() => parseMailArgs(bad), { code: 'E_BAD_ARGS' }, bad.join(' '));
  }
  const cursor = encodeCursor({ createdAt: iso(1), id: 'm1', team: 'acme' }, null);
  assert.deepEqual(parseMailArgs(['--cursor', cursor]).cursor, { createdAt: iso(1), id: 'm1', team: 'acme', ms: Date.parse(iso(1)) });
  assert.throws(() => parseMailArgs(['--cursor', cursor, '--conversation', 'c1']), { code: 'E_BAD_ARGS' });
});

test('sender text cannot add markdown structure to the plain rendering', async () => {
  assert.equal(escapeMarkdown('# [x](http://e) `y`'), '\\# \\[x\\]\\(http://e\\) \\`y\\`');
  const { result } = await read({ [H1]: { whoami: ME, threads: [[thread('c1', 5)]], conversations: { c1: [msg('m1', 5, { subject: '# boom', body: 'line\n## two\n<script>' })] } } });
  const text = result.documents[0].text;
  assert.ok(!/^## two/m.test(text) && !/^# boom/m.test(text) && !text.includes('<script>'), text);
  assert.match(text, /^> \\#\\# two$/m);
});

test('a budget that runs out at a thread page boundary keeps the next page\'s frontier: nothing older is passed off as newest', async () => {
  let now = 0;
  const script = { [H1]: { whoami: ME, threads: [[thread('old-in-active', 59)], [thread('later', 50)]], conversations: {
    'old-in-active': [msg('m-old', 1, { conversation: 'old-in-active' })], later: [msg('m-50', 50, { conversation: 'later' })] } } };
  const s = scriptedAw(script);
  const aw = async (home, args) => { const r = await s.aw(home, args); if (args[1] === 'show') now = 1e9; return r; };
  const result = await readMail({ identities: [{ team: 'acme', identityHome: H1, primary: true }], aw, clock: () => now, budgetMs: 1000 });
  assert.deepEqual(result.mail.messages, [], 'm-old is older than what the unlisted page may hold');
  assert.equal(result.mail.identities[0].error, MAIL_IDENTITY_ERRORS.tooMany);
  // With time, the next page is listed and the order is right.
  const full = await readMail({ identities: [{ team: 'acme', identityHome: H1, primary: true }], aw: scriptedAw(script).aw });
  assert.deepEqual(full.mail.messages.map((m) => m.id), ['m-50', 'm-old']);
  assert.equal(full.mail.hasMore, false);
});

test('a partial conversation is listed even when none of its old messages make the page, or the size cut drops them', async () => {
  const long = Array.from({ length: MAIL_SHOW_LIMIT }, (_, i) => msg(`l${i}`, 0, { conversation: 'long', created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), body: '' }));
  const script = { [H1]: { whoami: ME, threads: [[thread('long', 59), thread('short', 30)]], conversations: { long, short: [msg('s1', 30, { conversation: 'short' })] } } };
  const { result } = await read(script, { limit: 1 });
  assert.deepEqual(result.mail.messages.map((m) => m.id), ['s1']);
  assert.deepEqual(result.mail.conversations, [{ id: 'long', partial: 'oldest-first-only' }, { id: 'short', partial: null }]);
  assert.match(result.documents[0].text, /newest messages can't be read yet/);
  const cut = (await read(script, { limit: 50, resultMaxBytes: 20 * 1024 })).result;
  assert.ok(cut.mail.messages.length < 50 && cut.mail.hasMore);
  assert.ok(cut.mail.conversations.some((c) => c.id === 'long' && c.partial === 'oldest-first-only'));
  assert.ok(Buffer.byteLength(JSON.stringify(cut)) <= 20 * 1024);
});

test('a refused conversation is that conversation\'s: the identity\'s other conversations, past the first batch, are still read', async () => {
  const threads = Array.from({ length: 7 }, (_, i) => thread(`c${i}`, 59 - i));
  const conversations = Object.fromEntries(threads.map((t, i) => [t.conversation_id, [msg(`m${i}`, 59 - i, { conversation: t.conversation_id })]]));
  const s = scriptedAw({ [H1]: { whoami: ME, threads: [threads], conversations } });
  const aw = async (home, args) => (args[1] === 'show' && args.includes('c0') ? { status: 1, stdout: '', stderr: 'aweb: http 403 Forbidden' } : s.aw(home, args));
  const result = await readMail({ identities: [{ team: 'acme', identityHome: H1, primary: true }], aw, limit: 10 });
  assert.deepEqual(result.mail.messages.map((m) => m.id), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
  assert.equal(result.mail.identities[0].error, MAIL_IDENTITY_ERRORS.conversation);
});

test('a cursor whose fields are not a time, an id and a team is E_BAD_ARGS', () => {
  const raw = (doc) => Buffer.from(JSON.stringify(doc)).toString('base64url');
  for (const doc of [{ v: 1, at: 'not-a-date', id: 'm1', team: 'acme' }, { v: 1, at: iso(1), id: '', team: 'acme' }, { v: 1, at: iso(1), id: 'm1', team: '' }, { v: 1, at: iso(1), id: 7, team: 'acme' }]) {
    assert.throws(() => parseMailArgs(['--cursor', raw(doc)]), { code: 'E_BAD_ARGS' }, JSON.stringify(doc));
  }
});
