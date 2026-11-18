import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, symlinkSync, lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fakeAw} from './helpers/fake-aw-grant.mjs';

const HOOK = fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs', import.meta.url));
const TEAM = 't:example.test', OTHER = 'other:example.test';
function seat(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'oats-grant-team-')));
  t.after(() => rmSync(base, {recursive:true, force:true}));
  const bin = fakeAw(base), home = join(base, 'seat'), custody = join(base, 'custody');
  mkdirSync(home);
  mkdirSync(join(custody, '.aw'), {recursive:true});
  writeFileSync(join(custody, '.aw', 'identity.yaml'), 'alias: resident-alias\n');
  const settings = {identity:{mode:'global', resident:'merlin'}, residents:{merlin:custody}};
  const recordPath = join(home, '.oats-aweb', 'seat.json');
  const run = (event, meta = {}, env = {}) => {
    const r = spawnSync(process.execPath, [HOOK, event], {cwd:home, encoding:'utf8', env:{
      HOME:base, PATH:`${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      OATS_EVENT:event, OATS_INSTANCE:'probe', OATS_HOME:home, OATS_WORKSPACE:base,
      OATS_CONTEXT:base, OATS_DEFAULT_TEAM:'default', OATS_DEFAULT_TEAM_ID:TEAM,
      OATS_DEFAULT_TEAM_FROM:'deployment', OATS_TEAMS:JSON.stringify([{label:'default',team:TEAM,default:true,from:'local'}]),
      OATS_SETTINGS:JSON.stringify(settings), OATS_META:JSON.stringify(meta),
      FAKE_ACTIVE_TEAM:OTHER, FAKE_CUSTODY_TEAMS:JSON.stringify([{team_id:TEAM,ready:true,certificate_present:true},{team_id:OTHER,ready:true,certificate_present:true}]),
      ...env,
    }});
    let doc; try { doc = JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch { doc = undefined; }
    return {...r, doc};
  };
  const grants = () => JSON.parse(readFileSync(join(base,'grants.json'),'utf8'));
  const calls = () => readFileSync(join(base,'aw.log'),'utf8').trim().split('\n').map(JSON.parse);
  return {base, home, custody, settings, recordPath, run, grants, calls};
}
const ok = r => assert.equal(r.status, 0, r.stdout + r.stderr);

test('renewal and retire revoke in seat team X while resident custody selects Y', t => {
  const s = seat(t), spawned = s.run('spawn'); ok(spawned);
  const launched = s.run('launch', spawned.doc.meta); ok(launched);
  assert.equal(s.grants().find(g=>g.grant_id===spawned.doc.meta.identity.grant.id).status, 'revoked');
  const retired = s.run('retire', launched.doc.meta); ok(retired);
  assert.ok(s.grants().every(g=>g.status==='revoked'));
});

test('uncertain revoke is confirmed by show in seat team X, not active team Y', t => {
  const s = seat(t), spawned = s.run('spawn'); ok(spawned);
  const retired = s.run('retire', spawned.doc.meta, {FAKE_REVOKE_APPLIED_TIMEOUT:'1'}); ok(retired);
  assert.ok(s.calls().some(c=>c.argv.slice(0,3).join(' ')==='id grant show'));
  assert.ok(s.grants().every(g=>g.status==='revoked'));
});

test('failed revoke remedy names the seat team', t => {
  const s = seat(t), spawned = s.run('spawn'); ok(spawned);
  const retired = s.run('retire', spawned.doc.meta, {FAKE_REVOKE_FAIL:'1'});
  assert.equal(retired.status, 1);
  assert.ok(retired.doc.warning.includes(`aw id grant revoke ${spawned.doc.meta.identity.grant.id} --team=${TEAM}`), retired.stdout);
});

test('renewal refuses changed team or resident settings before minting', t => {
  for (const env of [
    {OATS_DEFAULT_TEAM_ID:OTHER},
    {OATS_SETTINGS:JSON.stringify({identity:{mode:'global',resident:'different'},residents:{}})},
  ]) {
    const s = seat(t), spawned = s.run('spawn'); ok(spawned);
    const before = readFileSync(s.recordPath,'utf8');
    const calls = s.calls().length;
    for (const preview of [false, true]) {
      const launched = s.run('launch', spawned.doc.meta, {...env, ...(preview ? {OATS_LAUNCH_PREVIEW:'1'} : {})});
      assert.equal(launched.status, 1, launched.stdout + launched.stderr);
      assert.match(launched.doc.warning, /respawn/i);
      assert.equal(s.calls().length, calls, 'refusal precedes all aw calls');
    }
    assert.equal(s.grants().length, 1);
    assert.equal(readFileSync(s.recordPath,'utf8'), before);
  }
});

test('retire uses seat record despite different settings and meta team/resident/seat', t => {
  const s = seat(t), spawned = s.run('spawn'); ok(spawned);
  const meta = {...spawned.doc.meta, identity:{...spawned.doc.meta.identity,team:OTHER,resident:'different',seat:'0123456789abcdef'}};
  const retired = s.run('retire', meta, {OATS_DEFAULT_TEAM_ID:OTHER}); ok(retired);
  assert.ok(s.grants().every(g=>g.status==='revoked'));
});

test('unreadable or incomplete seat record refuses launch and retire without replacing it', t => {
  for (const contents of ['{truncated', JSON.stringify({seat:'0123456789abcdef'})]) {
    const s = seat(t), spawned = s.run('spawn'); ok(spawned);
    writeFileSync(s.recordPath,contents);
    for (const event of ['launch','retire']) {
      const r = s.run(event, spawned.doc.meta);
      assert.equal(r.status, 1, event + ': ' + r.stdout + r.stderr);
      assert.match(r.doc.warning, /respawn/i);
      assert.equal(readFileSync(s.recordPath,'utf8'), contents);
      assert.ok(s.grants().every(g=>g.status==='active'));
    }
  }
});

test('sweep and renewal use the record when meta has another seat, team and resident', t => {
  const s = seat(t), spawned = s.run('spawn'); ok(spawned);
  const record = JSON.parse(readFileSync(s.recordPath,'utf8'));
  writeFileSync(join(s.base,'grants.json'), JSON.stringify([...s.grants(), {
    grant_id:'stray', team_id:TEAM, status:'active', label:`oats:probe:${record.seat}`, expires_at:'never',
  }]));
  const meta = {...spawned.doc.meta, identity:{...spawned.doc.meta.identity,team:OTHER,resident:'different',seat:'0123456789abcdef'}};
  const launched = s.run('launch',meta); ok(launched);
  assert.equal(launched.doc.meta.identity.team, TEAM);
  assert.equal(launched.doc.meta.identity.resident, record.resident);
  assert.equal(launched.doc.meta.identity.seat, record.seat);
  assert.equal(s.grants().find(g=>g.grant_id==='stray').status, 'revoked');
  ok(s.run('retire',launched.doc.meta));
});

test('spawn rollback revokes in the mint team while custody selects another team', t => {
  const s = seat(t);
  const failed = s.run('spawn',{}, {FAKE_VERIFY_ERROR:'attachment refused'});
  assert.equal(failed.status, 1);
  assert.ok(s.grants().every(g=>g.status==='revoked'));
  ok(s.run('retire',failed.doc.meta));
});

test('a dangling seat record is unreadable, never treated as an absent legacy record', t => {
  const s = seat(t), spawned = s.run('spawn'); ok(spawned);
  rmSync(s.recordPath);
  symlinkSync(join(s.base,'missing-record'), s.recordPath);
  for (const event of ['launch','retire']) {
    const r = s.run(event, spawned.doc.meta);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.doc.warning, /unreadable or incomplete/);
    assert.ok(lstatSync(s.recordPath).isSymbolicLink(), 'the unreadable record was not replaced');
    assert.equal(s.grants().length, 1);
    assert.equal(s.grants()[0].status, 'active');
  }
});

test('a long home path cannot truncate the respawn remedy from a launch refusal', t => {
  const s = seat(t), spawned = s.run('spawn'); ok(spawned);
  const longHome = join(s.home,'a'.repeat(150),'b'.repeat(150));
  const record = join(longHome,'.oats-aweb','seat.json');
  mkdirSync(dirname(record),{recursive:true});
  writeFileSync(record,readFileSync(s.recordPath));
  const r = s.run('launch',spawned.doc.meta,{OATS_HOME:longHome,OATS_DEFAULT_TEAM_ID:OTHER});
  assert.equal(r.status,1);
  assert.match(r.doc.warning,/respawn this home/);
  writeFileSync(record,'{truncated');
  const unreadable = s.run('launch',spawned.doc.meta,{OATS_HOME:longHome});
  assert.equal(unreadable.status,1);
  assert.match(unreadable.doc.warning,/respawn this home/);
});
