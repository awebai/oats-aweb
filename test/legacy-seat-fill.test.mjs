import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, statSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fakeAw} from './helpers/fake-aw-grant.mjs';

const HOOK = fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs', import.meta.url));
const TEAM = 't:example.test', OTHER = 'other:example.test';
function legacy(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'oats-legacy-fill-')));
  t.after(() => rmSync(base, {recursive:true, force:true}));
  const bin = fakeAw(base), home = join(base, 'seat'), custody = join(base, 'custody');
  const grantHome = join(home, '.aweb-identity'), state = join(home, '.oats-aweb');
  mkdirSync(grantHome, {recursive:true});
  mkdirSync(join(custody, '.aw'), {recursive:true});
  writeFileSync(join(custody, '.aw', 'identity.yaml'), 'alias: resident-alias\n');
  const yaml = join(grantHome, 'grant.yaml'), record = join(state, 'seat.json');
  writeFileSync(yaml, `version: 1\ngrant_id: grant-old\nteam_id: ${TEAM}\nexpires_at: 2099-01-01T00:00:00Z\ncustody:\n  socket_path: /fixture/custody.sock\n`);
  // 1.24 metadata has neither identity.seat nor a provider seat.json.
  const meta = {delivery:'channel', identity:{mode:'global',alias:'resident-alias',team:TEAM,resident:'merlin',address:null,
    grant:{id:'grant-old',expiresAt:'2099-01-01T00:00:00Z',ttl:'720h',scopes:['mail.read'],home:grantHome}}};
  const settings = {identity:{mode:'global',resident:'merlin',renew:'off'}, residents:{merlin:custody}};
  const grantsFile = join(base, 'grants.json');
  const grants = () => JSON.parse(readFileSync(grantsFile, 'utf8'));
  const save = g => writeFileSync(grantsFile, JSON.stringify(g));
  save([{grant_id:'grant-old',team_id:TEAM,status:'active',label:'oats:probe',expires_at:'2099-01-01T00:00:00Z'}]);
  const calls = () => existsSync(join(base,'aw.log')) ? readFileSync(join(base,'aw.log'),'utf8').trim().split('\n').map(JSON.parse) : [];
  const run = (event='launch', input=meta, extra={}, preload) => {
    const r = spawnSync(process.execPath, [...(preload ? ['--import',preload] : []),HOOK,event], {cwd:home, encoding:'utf8', env:{
      HOME:base, PATH:`${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      OATS_EVENT:event, OATS_INSTANCE:'probe', OATS_HOME:home, OATS_WORKSPACE:base, OATS_CONTEXT:base,
      OATS_RUNTIME:'pi', OATS_DEFAULT_TEAM:'default', OATS_DEFAULT_TEAM_ID:TEAM, OATS_DEFAULT_TEAM_FROM:'deployment',
      OATS_SETTINGS:JSON.stringify(settings), OATS_META:JSON.stringify(input), ...extra,
    }});
    let doc; try {doc=JSON.parse(r.stdout.trim().split('\n').at(-1));} catch { /* killed hook has no answer */ }
    return {...r,doc};
  };
  return {base,home,custody,grantHome,state,yaml,record,meta,settings,grants,save,calls,run};
}
const ok = r => assert.equal(r.status,0,r.stdout+r.stderr);
const snapshot = dir => Object.fromEntries(readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory()
  ? Object.entries(snapshot(join(dir,e.name))).map(([k,v])=>[`${e.name}/${k}`,v])
  : [[e.name,readFileSync(join(dir,e.name),'utf8')]]));

for (const renew of ['off','launch']) test(`legacy bare-label seat fills before sweep and ${renew === 'off' ? 'retire' : 'renewal'}`, t => {
  const s=legacy(t), yaml=readFileSync(s.yaml,'utf8');
  s.settings.identity.renew=renew;
  const r=s.run(); ok(r);
  const seat=JSON.parse(readFileSync(s.record,'utf8'));
  assert.match(seat.seat,/^[0-9a-f]{16}$/);
  assert.deepEqual(seat,{seat:seat.seat,instance:'probe',resident:'merlin',team:TEAM});
  assert.equal(statSync(s.record).mode & 0o777,0o600);
  assert.equal(r.doc.meta.identity.seat,seat.seat);
  assert.equal(s.calls().filter(c=>c.argv.slice(0,2).join(' ')==='id grant')[0].argv[2],'show');
  assert.ok(s.calls().filter(c=>c.argv.slice(0,2).join(' ')==='id grant').every(c=>c.cwd===s.custody && c.argv.includes(`--team=${TEAM}`)));
  assert.equal(s.grants().find(g=>g.grant_id==='grant-old').status,renew==='off'?'active':'revoked');
  if (renew==='off') assert.equal(readFileSync(s.yaml,'utf8'),yaml);
  else assert.equal(s.grants().find(g=>g.grant_id===r.doc.meta.identity.grant.id).label,`oats:probe:${seat.seat}`);
  // A later sweep uses the filled record and keeps the selected legacy grant.
  s.save([...s.grants(),{grant_id:'stray',team_id:TEAM,label:`oats:probe:${seat.seat}`,status:'active',expires_at:'never'}]);
  s.settings.identity.renew='off';
  const again=s.run('launch',r.doc.meta); ok(again);
  assert.equal(s.grants().find(g=>g.grant_id==='stray').status,'revoked');
  ok(s.run('retire',again.doc.meta));
  assert.ok(s.grants().every(g=>g.status==='revoked'));
});

for (const scenario of ['team mismatch','grant mismatch','missing yaml','unreadable custody','inactive grant','custody team mismatch','custody grant mismatch','resident missing','meta team missing','changed default']) {
  test(`legacy fill refuses ${scenario} without changing the home`, t => {
    const s=legacy(t);
    if(scenario==='team mismatch') writeFileSync(s.yaml,readFileSync(s.yaml,'utf8').replace(TEAM,OTHER));
    if(scenario==='grant mismatch') writeFileSync(s.yaml,readFileSync(s.yaml,'utf8').replace('grant-old','grant-other'));
    if(scenario==='missing yaml') rmSync(s.yaml);
    if(scenario==='resident missing') s.settings.residents={};
    if(scenario==='meta team missing') delete s.meta.identity.team;
    const extra = scenario==='unreadable custody'?{FAKE_GRANT_SHOW_FAIL:'custody socket refused'}:
      scenario==='inactive grant'?{FAKE_GRANT_SHOW_STATUS:'revoked'}:
      scenario==='custody team mismatch'?{FAKE_GRANT_SHOW_REPLY:JSON.stringify({...s.grants()[0],team_id:OTHER})}:
      scenario==='custody grant mismatch'?{FAKE_GRANT_SHOW_REPLY:JSON.stringify({...s.grants()[0],grant_id:'wrong'})}:
      scenario==='changed default'?{OATS_DEFAULT_TEAM_ID:OTHER}:{};
    const before=snapshot(s.home), r=s.run('launch',s.meta,extra);
    assert.equal(r.status,1,r.stdout+r.stderr);
    assert.match(r.doc.warning,/respawn/);
    assert.deepEqual(snapshot(s.home),before);
    assert.deepEqual(r.doc.meta.identity,s.meta.identity);
    assert.ok(s.grants().every(g=>g.status==='active'));
    if(scenario==='team mismatch') {
      assert.ok(r.doc.warning.includes(`aw id grant revoke --team=${OTHER} -- grant-old`),r.doc.warning);
      assert.match(r.doc.warning,/oats retire probe --force/);
    }
    if(scenario==='unreadable custody') assert.match(r.doc.warning,/custody socket refused/);
    if(scenario==='resident missing') assert.match(r.doc.warning,/settings.oats.aweb.residents.merlin/);
  });
}

test('legacy preview has no custody read or write; the real launch refuses unavailable custody', t => {
  const s=legacy(t), before=snapshot(s.home), extra={FAKE_GRANT_SHOW_FAIL:'custody down'};
  ok(s.run('launch',s.meta,{...extra,OATS_LAUNCH_PREVIEW:'1'}));
  assert.deepEqual(s.calls(),[]);
  assert.deepEqual(snapshot(s.home),before);
  const real=s.run('launch',s.meta,extra);
  assert.equal(real.status,1,real.stdout);
  assert.match(real.doc.warning,/custody down/);
  assert.deepEqual(snapshot(s.home),before);
});

test('an existing seat record skips legacy custody verification and stays byte for byte', t => {
  const s=legacy(t), seat={seat:'0123456789abcdef',instance:'probe',resident:'merlin',team:TEAM};
  mkdirSync(s.state); const text=JSON.stringify(seat,null,2); writeFileSync(s.record,text);
  ok(s.run('launch',s.meta,{FAKE_GRANT_SHOW_FAIL:'must not read legacy custody'}));
  assert.equal(readFileSync(s.record,'utf8'),text);
  assert.ok(!s.calls().some(c=>c.argv.slice(0,3).join(' ')==='id grant show'));
});

test('a label that already encodes a seat id preserves that id', t => {
  const s=legacy(t), id='fedcba9876543210';
  s.save(s.grants().map(g=>({...g,label:`oats:probe:${id}`})));
  ok(s.run()); assert.equal(JSON.parse(readFileSync(s.record,'utf8')).seat,id);
});

for(const when of ['during temp write','after rename']) test(`legacy fill killed ${when} recovers without a partial seat file`, t => {
  const s=legacy(t), preload=join(s.base,'kill.mjs');
  // Kill at the real filesystem boundary, leaving the writer's actual bytes.
  const intercept=when==='after rename'
    ? `const rename=fs.renameSync;
fs.renameSync=(from,to)=>{
 const result=rename(from,to);
 if(String(to)===${JSON.stringify(s.record)}) process.kill(process.pid,'SIGKILL');
 return result;
};`
    : `const write=fs.writeFileSync;
fs.writeFileSync=(path,data,options)=>{
 if(String(path).startsWith(${JSON.stringify(s.record+'.')}) && String(path).endsWith('.tmp')) {
  write(path,String(data).slice(0,12),options);
  process.kill(process.pid,'SIGKILL');
 }
 return write(path,data,options);
};`;
  writeFileSync(preload,`import fs from 'node:fs';\nimport {syncBuiltinESMExports} from 'node:module';\n${intercept}\nsyncBuiltinESMExports();\n`);
  const killed=s.run('launch',s.meta,{},preload);
  assert.equal(killed.signal,'SIGKILL',killed.stdout+killed.stderr);
  assert.equal(existsSync(s.record),when==='after rename');
  if(when==='during temp write') {
    const temp=readdirSync(s.state).find(n=>n.endsWith('.tmp'));
    assert.ok(temp);
    assert.throws(()=>JSON.parse(readFileSync(join(s.state,temp),'utf8')));
  }
  const existing=existsSync(s.record)?readFileSync(s.record,'utf8'):undefined;
  const again=s.run(); ok(again);
  const text=readFileSync(s.record,'utf8'); assert.match(JSON.parse(text).seat,/^[0-9a-f]{16}$/);
  if(existing) assert.equal(text,existing);
  assert.equal(s.grants().length,1,'recovery with renew off never mints a second grant');
  ok(s.run('retire',again.doc.meta));
  assert.equal(s.grants()[0].status,'revoked');
});

for (const field of ['grant_id','team_id']) test(`duplicate ${field} in legacy grant.yaml refuses without a write`, t => {
  const s=legacy(t);
  writeFileSync(s.yaml,readFileSync(s.yaml,'utf8')+`${field}: conflicting\n`);
  const before=snapshot(s.home), r=s.run();
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.deepEqual(snapshot(s.home),before);
  assert.deepEqual(s.calls(),[]);
});

test('LOCAL and retained homes never enter the legacy grant fill', t => {
  for (const shape of ['LOCAL','retained without grant','retained with grant','identity.source with grant']) {
    const s=legacy(t);
    if(shape==='LOCAL') {
      s.meta.identity.mode='local';
      s.settings.identity.mode='local';
    } else if(shape.startsWith('retained')) {
      s.meta.retained=true;
      if(shape==='retained without grant') delete s.meta.identity.grant;
    } else s.settings.identity.source=join(s.base,'retained-source','.aw');
    const before=snapshot(s.home), r=s.run('launch',s.meta,{FAKE_GRANT_SHOW_FAIL:'must not read custody'});
    ok(r); assert.deepEqual(snapshot(s.home),before,shape);
    assert.ok(!s.calls().some(c=>c.argv.slice(0,2).join(' ')==='id grant'),shape);
  }
});

for (const renew of ['off','launch']) test(`an expired legacy grant refuses with renewal ${renew} and leaves the home unchanged`, t => {
  const s=legacy(t);
  s.settings.identity.renew=renew;
  s.meta.identity.grant.expiresAt='2020-01-01T00:00:00Z';
  writeFileSync(s.yaml,readFileSync(s.yaml,'utf8').replace('2099-01-01T00:00:00Z','2020-01-01T00:00:00Z'));
  // The native list endpoint computes status from expiry, not a stored flag.
  s.save(s.grants().map(g=>({...g,status:'expired',expires_at:'2020-01-01T00:00:00Z'})));
  const before=snapshot(s.home), r=s.run();
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.doc.warning,/respawn.*custody grant is not active/);
  assert.deepEqual(snapshot(s.home),before);
  assert.deepEqual(r.doc.meta.identity,s.meta.identity);
  assert.deepEqual(s.calls().map(c=>c.argv.slice(0,3).join(' ')),['id grant show']);
  assert.equal(s.grants().length,1,'neither renewal mode mints on an expired legacy grant');
});

test('a meta-only preflight seat id is replaced when the legacy grant label has no id', t => {
  const s=legacy(t), metaOnlySeat='0123456789abcdef';
  s.meta.identity.seat=metaOnlySeat;
  const r=s.run(); ok(r);
  const seat=JSON.parse(readFileSync(s.record,'utf8')).seat;
  assert.match(seat,/^[0-9a-f]{16}$/);
  assert.notEqual(seat,metaOnlySeat);
  assert.equal(r.doc.meta.identity.seat,seat);
  ok(s.run('retire',r.doc.meta));
  assert.equal(s.grants()[0].status,'revoked');
});

test('upgrade adopts legacy metadata without effects and the next start fills the record', t => {
  const s=legacy(t), before=snapshot(s.home);
  const adopted=s.run('upgrade',s.meta,{OATS_UPGRADE_PHASE:'apply'}); ok(adopted);
  assert.deepEqual(snapshot(s.home),before);
  assert.deepEqual(s.calls(),[]);
  assert.deepEqual(adopted.doc.meta.identity,s.meta.identity);
  const launched=s.run('launch',adopted.doc.meta); ok(launched);
  assert.match(JSON.parse(readFileSync(s.record,'utf8')).seat,/^[0-9a-f]{16}$/);
  ok(s.run('retire',launched.doc.meta));
});

for (const [key,value,warning] of [['ttl','1d',/E_GRANT_TTL/],['renew','sometimes',/identity\.renew must be "off" or "launch"/]]) {
  for (const preview of [false,true]) test(`invalid legacy ${key} refuses before custody or writes: ${preview?'preview':'real start'}`, t => {
    const s=legacy(t);
    s.settings.identity[key]=value;
    const before=snapshot(s.home);
    const r=s.run('launch',s.meta,preview?{OATS_LAUNCH_PREVIEW:'1'}:{});
    assert.equal(r.status,1,r.stdout+r.stderr);
    assert.match(r.doc.warning,warning);
    assert.deepEqual(snapshot(s.home),before,'a refused legacy home stays exactly as it was');
    assert.equal(existsSync(s.record),false);
    assert.deepEqual(s.calls(),[],'configuration refuses before the legacy custody show');
    assert.equal(s.grants()[0].status,'active');
  });
}
