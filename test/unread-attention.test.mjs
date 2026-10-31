import test from 'node:test';
import assert from 'node:assert/strict';
import {brokerFailure, observeUnreadAttention} from '../oats-package/capabilities/oats-aweb/lib/unread-attention.mjs';

const HOME = '/scratch/agents/plain/instances/unread';
const row = {home: HOME, capabilityMeta: {'oats.aweb': {}}};
const target = () => ({home: HOME, delivery: 'session', channel_core: {last_error: 'unsafe sender content', binding_errors: {lane: 'active error'}}, receive_identities: [{identity_home: `${HOME}/.aw`, unread_count: 999}]});
function fixture({targets = [target()], counts = [2], supported = true, rows = [row]} = {}) {
  const calls = [], reads = [], cache = {};
  const host = {
    supportsWaiting: async () => supported,
    status: async () => ({agents: [{instances: rows}]}),
    wakeStatus: async () => ({instances: targets}),
    unreadCount: async h => { reads.push(h); return counts[Math.min(reads.length - 1, counts.length - 1)]; },
    readCache: async file => cache[file] ?? null,
    writeCache: async (file, value) => { cache[file] = value; },
    waiting: async (home, message) => calls.push({home, message}),
  };
  return {host, calls, reads, cache};
}

test('fresh count and active binding error set a content-free attention message', async () => {
  const f = fixture();
  assert.equal((await observeUnreadAttention(f)).set, 1);
  assert.deepEqual(f.calls, [{home: HOME, message: 'aweb: 2 unread; broker error (broker-binding-error)'}]);
});

test('error classes never extract codes, trace ids, or any other sender-controlled bytes', () => {
  const t = target();
  t.channel_core.binding_errors = {};
  t.channel_core.last_error = 'E_SECRET_subject\n\u001b[31m';
  t.channel_core.trace_message_id = 'do not copy';
  assert.equal(brokerFailure(t), null);
  delete t.channel_core.last_error;
  t.channel_core.binding_errors = {'private-id': 'private content'};
  assert.equal(brokerFailure(t), 'broker-binding-error');
  t.channel_core.binding_errors = {};
  t.receive_identities[0].stream_error = 'private content';
  assert.equal(brokerFailure(t), 'broker-stream-error');
});

test('joined identities use fresh count-only reads and aggregate once per home', async () => {
  const t = target();
  t.receive_identities.push({identity_home: `${HOME}/joined`, unread_count: 0});
  const f = fixture({targets: [t], counts: [1, 3]});
  await observeUnreadAttention(f);
  assert.deepEqual(f.reads, [`${HOME}/.aw`, `${HOME}/joined`]);
  assert.match(f.calls[0].message, /4 unread/);
});

for (const count of [null, undefined, -1, 1.2, '0', NaN]) test(`count ${String(count)} is unknown and preserves existing state`, async () => {
  const f = fixture({counts: [count]});
  assert.equal((await observeUnreadAttention(f)).unknown, 1);
  assert.deepEqual(f.calls, []);
});

test('partial successful counts cannot set or clear a claim', async () => {
  const t = target(); t.receive_identities.push({identity_home: `${HOME}/joined`});
  const f = fixture({targets: [t], counts: [3, null]});
  await observeUnreadAttention(f);
  assert.deepEqual(f.calls, []);
});

for (const mode of ['empty', 'delivered', 'unregistered', 'retiring', 'native-channel', 'native-pi']) test(`clears only this producer on ${mode}`, async () => {
  const t = target();
  if (mode === 'delivered') {delete t.channel_core.last_error; t.channel_core.binding_errors = {};}
  if (mode.startsWith('native-')) t.delivery = mode;
  const f = fixture({targets: mode === 'unregistered' ? [] : [t], counts: [mode === 'empty' ? 0 : 2], rows: [{...row, retirePending: mode === 'retiring'}]});
  assert.equal((await observeUnreadAttention(f)).cleared, 1);
  assert.deepEqual(f.calls, [{home: HOME, message: null}]);
});

test('unsupported kernel does not even read roster or broker', async () => {
  const f = fixture({supported: false});
  f.host.status = f.host.wakeStatus = async () => { throw Error('must not run'); };
  assert.equal((await observeUnreadAttention(f)).supported, false);
  assert.deepEqual(f.calls, []);
});

test('unknown broker status preserves claims; duplicate and malformed targets are unknown', async () => {
  for (const targets of [undefined, [target(), target()], [{...target(), receive_identities: []}]]) {
    const f = fixture(); f.host.wakeStatus = async () => ({instances: targets});
    assert.equal((await observeUnreadAttention(f)).unknown, 1);
    assert.deepEqual(f.calls, []);
  }
});

test('disable clears without broker/count reads; one failed home does not hide siblings', async () => {
  const f = fixture({rows: [row, {...row, home: `${HOME}-other`}]});
  f.host.wakeStatus = f.host.unreadCount = async () => { throw Error('must not run'); };
  f.host.waiting = async (home, message) => { if (home === HOME) throw Error('private failure'); f.calls.push({home, message}); };
  const r = await observeUnreadAttention({...f, clear: true});
  assert.equal(r.failed, 1); assert.equal(r.cleared, 1);
  assert.equal(f.calls[0].message, null);
});

for (const corrupt of [
  t => delete t.channel_core,
  t => t.channel_core.last_error = 12,
  t => t.channel_core.binding_errors = null,
  t => t.channel_core.binding_errors = {id: false},
  t => t.receive_identities[0].stream_error = {},
]) test('malformed error evidence cannot clear a live claim', async () => {
  const t = target(); corrupt(t);
  const f = fixture({targets: [t]});
  assert.equal((await observeUnreadAttention(f)).unknown, 1);
  assert.deepEqual(f.calls, []);
});

test('budgeted ticks rotate the roster; explicit disable visits every home', async () => {
  const rows = Array.from({length: 8}, (_, i) => ({...row, home: `${HOME}-${i}`}));
  const targets = rows.map(r => ({...target(), home: r.home}));
  const f = fixture({rows, targets});
  let clock = 0;
  f.host.unreadCount = async () => { clock += 100; return 1; };
  await observeUnreadAttention({...f, now: () => clock, budgetMs: 1});
  const first = f.calls[0].home;
  clock = 60000;
  await observeUnreadAttention({...f, now: () => clock, budgetMs: 1});
  assert.notEqual(f.calls[1].home, first);
  f.calls.length = 0;
  const r = await observeUnreadAttention({...f, clear: true, budgetMs: 0});
  assert.equal(r.cleared, rows.length);
  assert.equal(r.unknown, 0);
});

test('historical worker error alone needs two consecutive minute observations without progress', async () => {
  const t = target(); t.channel_core.binding_errors = {};
  const f = fixture({targets: [t]});
  assert.equal((await observeUnreadAttention({...f, now: () => 60000})).set, 0);
  assert.equal((await observeUnreadAttention({...f, now: () => 120000})).set, 1);
  assert.equal(f.calls.at(-1).message, 'aweb: 2 unread; broker error (broker-worker-error)');
  assert.doesNotMatch(JSON.stringify(f.cache), /unsafe sender content/);
});

for (const progress of ['unread-drop', 'input', 'success', 'error-change', 'gap']) test(`stale worker error cannot flag across ${progress}`, async () => {
  const t = target(); t.channel_core.binding_errors = {};
  const f = fixture({targets: [t], counts: progress === 'unread-drop' ? [3, 2] : [2]});
  await observeUnreadAttention({...f, now: () => 60000});
  if (progress === 'input') t.channel_core.last_input_at = '2026-10-30T00:01:00Z';
  if (progress === 'success') t.channel_core.last_success_at = '2026-10-30T00:01:00Z';
  if (progress === 'error-change') t.channel_core.last_error = 'different error';
  assert.equal((await observeUnreadAttention({...f, now: () => progress === 'gap' ? 180000 : 120000})).set, 0);
  assert.equal(f.calls.at(-1).message, null);
});

for (const grant of [{scopes: ['mail.read']}, {scopes: ['mail.read', 'mail.send']}, {}]) test('grant-backed home is excluded before reading counts', async () => {
  const granted = {...row, capabilityMeta: {'oats.aweb': {identity: {mode: 'global', grant}}}};
  const f = fixture({rows: [granted]});
  await observeUnreadAttention(f);
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.calls, [{home: HOME, message: null}]);
});

test('same-minute repeated publish preserves an established worker-error claim', async () => {
  const t = target(); t.channel_core.binding_errors = {};
  const f = fixture({targets: [t]});
  await observeUnreadAttention({...f, now: () => 60000});
  assert.equal((await observeUnreadAttention({...f, now: () => 120000})).set, 1);
  assert.equal((await observeUnreadAttention({...f, now: () => 121000})).set, 1);
  assert.equal(f.calls.at(-1).message, 'aweb: 2 unread; broker error (broker-worker-error)');
});

test('same-minute repeats retain initial baseline time and qualification across minute boundaries', async () => {
  const t = target(); t.channel_core.binding_errors = {};
  const f = fixture({targets: [t]});
  await observeUnreadAttention({...f, now: () => 60000});
  await observeUnreadAttention({...f, now: () => 119000});
  assert.equal((await observeUnreadAttention({...f, now: () => 120000})).set, 1);
  await observeUnreadAttention({...f, now: () => 179000});
  assert.equal((await observeUnreadAttention({...f, now: () => 180000})).set, 1);
});

for (const recovery of ['empty', 'no-error']) test(`cache invalidation failure cannot block clear on ${recovery}`, async () => {
  const t = target(); t.channel_core.binding_errors = {};
  if (recovery === 'no-error') delete t.channel_core.last_error;
  const f = fixture({targets: [t], counts: [recovery === 'empty' ? 0 : 2]});
  f.host.writeCache = async () => { throw Error('read-only cache'); };
  assert.equal((await observeUnreadAttention(f)).cleared, 1);
  assert.equal(f.calls.at(-1).message, null);
});
