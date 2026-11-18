import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fakeAw} from './helpers/fake-aw-grant.mjs';
import {fakeAwSetupPath} from './helpers/fake-aw-setup.mjs';

const HOOK = resolve('oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs');
const BINDING = resolve('oats-package/capabilities/oats-aweb/bin/oats-aweb-binding.mjs');
const TEAM = 't:example.test';
const mode = p => lstatSync(p).mode & 0o777;
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'seat-modes-'));
  t.after(() => rmSync(base, {recursive: true, force: true}));
  const source = join(base, 'source', '.aw'), home = join(base, 'home'), root = join(base, 'root');
  const write = (p, text) => {mkdirSync(dirname(p), {recursive: true, mode: 0o755}); writeFileSync(p, text, {mode: 0o644}); chmodSync(p, 0o644);};
  mkdirSync(home); mkdirSync(join(root, '.aw'), {recursive: true});
  write(join(source, 'signing.key'), 'source-key');
  write(join(source, 'identity.yaml'), 'alias: retained\ndid: did:key:zRetained\naddress: fixture.test/retained\n');
  write(join(source, 'teams.yaml'), `active_team: ${TEAM}\n`);
  write(join(source, 'workspace.yaml'), 'aweb_url: https://fixture.invalid/api\n');
  const bin = fakeAw(base);
  const env = {PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: base, OATS_EVENT: 'spawn',
    OATS_INSTANCE: 'retained', OATS_HOME: home, OATS_TEAM_SCOPE: base,
    OATS_DEFAULT_TEAM: 'default', OATS_DEFAULT_TEAM_ID: TEAM, OATS_DEFAULT_TEAM_FROM: 'deployment',
    OATS_TEAMS: JSON.stringify([{label: 'default', team: TEAM, default: true}]), OATS_RUNTIME: 'codex', FAKE_RETAINED: '1',
    OATS_SETTINGS: JSON.stringify({identity: {mode: 'local', source}, delivery: 'session'})};
  const run = (extra = {}) => spawnSync(process.execPath, [HOOK, 'spawn'], {cwd: home, env: {...env, ...extra}, encoding: 'utf8'});
  return {base, home, source, root, write, env, run};
}

test('all copied authority depths have private modes without changing the source', t => {
  const f = fixture(t);
  for (const p of ['encryption-keys/one.key', 'encryption-keys/deep/two/three.key', 'team-certs/deep/two.pem']) f.write(join(f.source, p), p);
  const r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(mode(join(f.home, '.aw')), 0o700);
  for (const p of ['signing.key', 'identity.yaml', 'teams.yaml', 'encryption-keys/one.key', 'encryption-keys/deep/two/three.key', 'team-certs/deep/two.pem']) {
    assert.equal(mode(join(f.home, '.aw', p)), 0o600, p);
    assert.equal(mode(join(f.source, p)), 0o644, `source ${p} untouched`);
    assert.equal(readFileSync(join(f.home, '.aw', p), 'utf8'), readFileSync(join(f.source, p), 'utf8'));
  }
  for (const p of ['encryption-keys', 'encryption-keys/deep', 'encryption-keys/deep/two', 'team-certs', 'team-certs/deep']) assert.equal(mode(join(f.home, '.aw', p)), 0o700, p);
});

test('authority symlinks at any depth refuse before copying and leave the source untouched', t => {
  for (const p of ['signing.key', 'encryption-keys/deep/link', 'team-certs', 'encryption-keys/dangling']) {
    const f = fixture(t), outside = join(f.base, 'outside'), link = join(f.source, p);
    f.write(outside, 'outside-private-material');
    rmSync(link, {force: true, recursive: true}); mkdirSync(dirname(link), {recursive: true});
    symlinkSync(p.endsWith('dangling') ? join(f.base, 'missing') : outside, link);
    const r = f.run();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok((r.stdout + r.stderr).includes(link), r.stdout + r.stderr);
    assert.match(r.stdout, /symlink.*replace.*real file.*source/);
    assert.equal(existsSync(join(f.home, '.aw')), false, 'nothing copied');
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.equal(mode(outside), 0o644); assert.equal(readFileSync(outside, 'utf8'), 'outside-private-material');
  }
});

test('retained verification uses native status and whoami, never check --online', t => {
  const f = fixture(t), r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
  const calls = readFileSync(join(f.base, 'aw.log'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  assert.ok(calls.some(c => c.argv.join(' ') === 'workspace status --json'));
  assert.ok(calls.some(c => c.argv.join(' ') === 'whoami --json'));
  assert.equal(calls.some(c => c.argv[0] === 'check'), false);
});

test('soul readiness reports the same authority-symlink refusal as spawn', t => {
  const f=fixture(t), link=join(f.source,'encryption-keys','nested','key');
  mkdirSync(dirname(link),{recursive:true});symlinkSync(join(f.base,'missing'),link);
  const spawned=f.run();assert.equal(spawned.status,1,spawned.stdout+spawned.stderr);
  const request={schemaVersion:1,phase:'check',slot:'messaging',capability:'oats.aweb',settings:JSON.parse(f.env.OATS_SETTINGS),
    input:{action:{kind:'readiness'},context:{kind:'workspace',workspace:'fixture',deployment:f.base,soul:'probe',home:null}}};
  const checked=spawnSync(process.execPath,[BINDING,'check'],{env:f.env,input:JSON.stringify(request),encoding:'utf8'});
  assert.equal(checked.status,0,checked.stdout+checked.stderr);
  const problems=JSON.parse(checked.stdout).result.problems;
  assert.ok(problems.some(p=>JSON.parse(spawned.stdout).warning.includes(p.message)&&p.message.includes(link)),checked.stdout);
});

test('seat and pending-mint records are owner-only even with a permissive umask', t => {
  const priorMask = process.umask(0);
  t.after(() => process.umask(priorMask));
  const f = fixture(t), custody = join(f.base, 'custody');
  f.write(join(custody, '.aw', 'identity.yaml'), 'alias: resident-alias\n');
  f.write(join(custody, '.aw', 'teams.yaml'), `active_team: ${TEAM}\n`);
  const global = f.run({FAKE_RETAINED: '', OATS_SETTINGS: JSON.stringify({delivery: 'session', identity: {mode: 'global', resident: 'resident'}, residents: {resident: custody}})});
  assert.equal(global.status, 0, global.stdout + global.stderr);
  assert.equal(mode(join(f.home, '.oats-aweb', 'seat.json')), 0o600);
  const second = fixture(t), fake = fakeAwSetupPath(t);
  second.write(join(second.root, '.aw', 'teams.json'), JSON.stringify({memberships: [{team_id: TEAM}]}));
  const pending = second.run({PATH: fake.path, FAKE_RETAINED: '', FAKE_JOIN_FROM_FAIL_AFTER_REGISTER: 'storage unavailable', OATS_SETTINGS: JSON.stringify({root: second.root, delivery: 'session'})});
  assert.equal(pending.status, 1, pending.stdout + pending.stderr);
  assert.equal(mode(join(second.home, '.oats-aweb', 'pending-mint.json')), 0o600);
});
