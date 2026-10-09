import {mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, readFileSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {ProbeError} from '../../oats-package/capabilities/oats-aweb/lib/probe-runtime.mjs';
export const LOCAL_CAPTURE = JSON.parse(readFileSync(new URL('../fixtures/probe/local-member-capture.json', import.meta.url), 'utf8'));
export const NONCE = '0123456789abcdef0123456789abcdef';
export const ROOT_DID = 'did:key:z6Mksender';
export const TARGET_DID = 'did:key:z6Mktarget';
export const AT = '2026-10-07T01:00:00Z';
export function message(id = 'reply-1', from = TARGET_DID, to = ROOT_DID, body = `Reply ${NONCE}`) {
  const m = {...structuredClone(LOCAL_CAPTURE.mail.messages[0]), message_id: id, conversation_id: 'conversation-1', from_did: from, to_did: to, body, created_at: AT, read_at: null, verification_status: 'verified', content_mode: 'legacy_plaintext_v1', message_version: 1};
  m.signed_payload = JSON.stringify({...JSON.parse(LOCAL_CAPTURE.mail.messages[0].signed_payload), type: 'mail', body, message_id: id, conversation_id: m.conversation_id, from_did: from, to_did: to});
  return m;
}
export function encryptedMessage() {
  const m = message(); delete m.signed_payload;
  Object.assign(m, {content_mode: 'encrypted_v2', message_version: 2,
    encrypted_envelope: {message_version: 2, envelope_type: 'aweb.e2ee.message', kind: 'mail', message_id: m.message_id, conversation_id: m.conversation_id, from: {did: TARGET_DID}, recipients: [{did: ROOT_DID}]}});
  return m;
}
export function fixture(t, {reply = message(), onCall, delay = 0, readAt = null} = {}) {
  const deployment = realpathSync(mkdtempSync(join(tmpdir(), 'probe-test-')));
  t.after(() => rmSync(deployment, {recursive: true, force: true}));
  const home = join(deployment, 'agents', 'worker', 'instances', 'worker-1'), root = join(deployment, 'root');
  mkdirSync(join(home, '.aw'), {recursive: true}); mkdirSync(join(root, '.aw'), {recursive: true});
  const primary = {label: 'aweb', team: 'aweb:test.example', from: 'workspace'};
  const doc = {agent: 'worker', instance: 'worker-1', workspace: {deployment}, modules: {'oats.aweb': {}},
    providers: {'oats.aweb': {root, delivery: 'channel'}}, defaultTeam: primary, teams: [{...primary, default: true}],
    harness: 'codex', launch: {harness: 'codex', hooks: {env: {AWEB_IDENTITY_HOME: join(home, '.aw')}}},
    capabilityMeta: {'oats.aweb': {alias: 'worker-1', team: primary.team, defaultTeam: primary, runtime: 'codex', delivery: 'channel', identity: {mode: 'local', alias: 'worker-1', team: primary.team, address: null, resident: null}}}};
  const save = () => writeFileSync(join(home, 'instance.json'), JSON.stringify(doc)); save();
  let clock = 0, poll = 0, request;
  const calls = [], env = {PATH: process.env.PATH, HOME: process.env.HOME, OATS_WORKSPACE: deployment, OATS_CLI_BIN: '/fixture/oats.mjs', AWEB_IDENTITY_HOME: '/wrong', AWEB_API_KEY: 'secret', AWEB_URL: 'https://wrong', OATS_META: 'wrong', OATS_DEFAULT_TEAM_ID: 'wrong'};
  const kernel = result => ({schemaVersion: 1, ok: true, result});
  const deps = {env, now: () => clock, wall: () => new Date(Date.parse(AT) + clock).toISOString(), nonce: () => NONCE,
    support: async () => ({cli: true, server: true, awBinary: '/fixture/aw'}),
    sleep: async (ms, budget) => { clock += ms; budget.check(); },
    child: async (cmd, args, options) => {
      options.budget.check(); clock += 1;
      calls.push({cmd, args, options});
      const custom = await onCall?.({cmd, args, options, calls, doc, save, setClock: v => { clock = v; }});
      if (custom !== undefined) return Buffer.isBuffer(custom) ? custom : Buffer.from(JSON.stringify(custom));
      assert.equal(options.env.AWEB_IDENTITY_HOME, undefined); assert.equal(options.env.AWEB_API_KEY, undefined); assert.equal(options.env.AWEB_URL, undefined); assert.equal(options.env.OATS_META, undefined);
      assert.equal(options.env.AW_NO_UPDATE_CHECK, '1');
      assert(!args.some(arg => ['inbox', 'ack', 'input', 'install', 'setup', 'init', 'connect'].includes(arg)));
      const output = value => Buffer.from(JSON.stringify(value));
      if (cmd === process.execPath) {
        const a = args.slice(1);
        if (a[0] === 'inspect') return output(kernel({operationsApi: 2, subject: {kind: 'instance', home}, instance: {home, harness: 'codex'}, layers: {messaging: {id: 'oats.aweb'}}, teamsSource: 'live', defaultTeam: primary, recordedDefaultTeam: primary, identity: {...doc.capabilityMeta['oats.aweb'].identity, provider: 'oats.aweb'}}));
        if (a[0] === 'session') return output(kernel({home, state: 'unknown', present: true}));
        if (a[0] === 'readiness') return output(kernel({readinessApi: 2, subject: {home, kind: 'instance'}, at: AT, summary: {required: 1, ready: true, pass: 1, fail: 0, unknown: 0}}));
      }
      const identityHome = args[1], hasTeam = args[2] === '--team';
      const a = args.slice(hasTeam ? 4 : 2, -1), isRoot = identityHome === join(root, '.aw'), alias = isRoot ? 'root' : 'worker-1';
      assert.equal(args[0], '--identity-home');
      assert.equal(hasTeam, a[0] === 'whoami' || a[0] === 'mail', 'native --team is bound only on admitted command families');
      if (hasTeam) assert.equal(args[3], primary.team);
      if (a[0] === 'whoami') return output({...LOCAL_CAPTURE.whoami, alias, name: alias, address: `test.example/${alias}`, did: isRoot ? ROOT_DID : TARGET_DID});
      if (a[0] === 'id') {
        assert.deepEqual(a, ['id', 'team', 'list']);
        const teams = structuredClone(LOCAL_CAPTURE.teams);
        teams.active_team = primary.team;
        Object.assign(teams.memberships[0], {team_id: primary.team, alias, name: alias});
        return output(teams);
      }
      assert(isRoot, 'mail must only use root identity');
      if (a[1] === 'send') {
        assert(a.includes('--new-conversation'));
        const file = a[a.indexOf('--body-file') + 1];
        assert.equal(statSync(file).mode & 0o777, 0o600); assert.equal(statSync(options.cwd).mode & 0o777, 0o700);
        request = message('request-1', ROOT_DID, TARGET_DID, readFileSync(file, 'utf8').trimEnd()); request.read_at = readAt;
        return output({message_id: 'request-1', conversation_id: 'conversation-1', status: 'delivered', delivered_at: AT});
      }
      if (a[1] === 'show' && a[2] === '--message-id') return output({...LOCAL_CAPTURE.mail, messages: [a[3] === 'request-1' ? request : reply]});
      if (a[1] === 'show' && a[2] === '--conversation-id') { poll++; return output({messages: [request, ...(reply && poll > delay ? [reply] : [])], has_more: false}); }
      throw new ProbeError('unexpected-test-command');
    }};
  return {home, root, deployment, doc, save, deps, calls, args: ['--home', home, '--timeout', '5', '--json']};
}
