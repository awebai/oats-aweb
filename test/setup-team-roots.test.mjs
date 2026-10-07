import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fakeAwSetupPath } from './helpers/fake-aw-setup.mjs';
import { currentRootQuery } from './helpers/current-root-query.mjs';
const hook=fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs',import.meta.url));
const TEAM='joined:example.invalid';
function fixture(t, outside=false) {
 const base=realpathSync(mkdtempSync(join(tmpdir(),'team-roots-')));t.after(()=>rmSync(base,{recursive:true,force:true}));
 const deployment=join(base,'deployment'), root=outside?join(base,'external-root'):join(deployment,'.aweb-roots','default');
 const home=join(deployment,'agents','dev','instances','dev-1');mkdirSync(home,{recursive:true});mkdirSync(join(root,'.aw'),{recursive:true});
 writeFileSync(join(deployment,'oats-local.yaml'),'schemaVersion: 2\nworkspace: fixture\n');
 writeFileSync(join(root,'.aw','teams.json'),JSON.stringify({memberships:[{team_id:'default:example.invalid'}]}));
 const fake=fakeAwSetupPath(t), env=Object.fromEntries(Object.entries(process.env).filter(([k])=>! /^(OATS_|AWEB_)/.test(k)));
 Object.assign(env,{PATH:fake.path,OATS_HOME:home,OATS_INSTANCE:'dev-1',OATS_TEAM_SCOPE:deployment,OATS_WORKSPACE_NAME:'fixture',OATS_DEFAULT_TEAM:'default',OATS_DEFAULT_TEAM_ID:'default:example.invalid',OATS_TEAMS:JSON.stringify([{label:'default',team:'default:example.invalid',default:true},{label:'joined',team:TEAM,default:false}]),OATS_SETTINGS:JSON.stringify({root}),AW_FAKE_TEAM:TEAM,AWEB_IDENTITY_HOME:'/caller/identity'});
 const run=(args, extra={},input)=>spawnSync(process.execPath,[hook,...args],{cwd:deployment,env:{...env,...extra},input,encoding:'utf8',timeout:15000});
 return {base,deployment,root,home,fake,env,run};
}
for(const outside of [false,true]) test(`setup join places sibling at deployment with ${outside?'external':'nested default'} authority`,t=>{
 const f=fixture(t,outside), r=f.run(['setup','--join','joined','--invite-stdin','--name','host','--service','https://service.invalid'],{},'SECRET\n');
 assert.equal(r.status,0,r.stderr);const target=join(f.deployment,'.aweb-roots','joined');
 assert.ok(existsSync(join(target,'.aw','workspace.yaml')));assert.ok(!existsSync(join(f.root,'.aweb-roots')));
 assert.match(readFileSync(join(f.deployment,'oats-local.yaml'),'utf8'),new RegExp(target));
 assert.ok(!existsSync(join(f.root,'oats-local.yaml')));assert.doesNotMatch(r.stdout+r.stderr,/SECRET/);
});
for(const variant of ['absent','contradictory','missing-local','wrong-dir']) test(`setup ${variant} deployment refuses before writes`,t=>{
 const f=fixture(t);const extra={};const args=['setup','--join','joined','--invite','SECRET'];
 if(variant==='absent')extra.OATS_TEAM_SCOPE='';
 if(variant==='contradictory')extra.OATS_WORKSPACE=f.root;
 if(variant==='missing-local')rmSync(join(f.deployment,'oats-local.yaml'));
 if(variant==='wrong-dir')args.push('--dir',f.root);
 const r=f.run(args,extra);assert.equal(r.status,1);assert.match(r.stderr,/deployment/);assert.equal(f.fake.readCalls().length,0);assert.ok(!existsSync(join(f.deployment,'.aweb-roots','joined')));
});
test('recorded nested root resumes without a second acceptance',t=>{
 const f=fixture(t), nested=join(f.root,'.aweb-roots','joined');mkdirSync(join(nested,'.aw'),{recursive:true});
 writeFileSync(join(nested,'.aw','identity.yaml'),'did: did:key:fixture\n');writeFileSync(join(nested,'.aw','teams.json'),JSON.stringify({memberships:[{team_id:TEAM}]}));
 const env={OATS_SETTINGS:JSON.stringify({root:f.root,roots:{[TEAM]:nested}})};
 for(let i=0;i<2;i++) {const r=f.run(['setup','--join','joined','--service','https://service.invalid'],env);assert.equal(r.status,0,r.stderr);}
 assert.equal(f.fake.readCalls().filter(c=>c.args.includes('accept-invite')).length,0);
 assert.equal(f.fake.readCalls().filter(c=>c.args[0]==='workspace'&&c.args[1]==='connect').length,1);
 assert.ok(!existsSync(join(f.deployment,'.aweb-roots','joined')));
});
test('actual verdict remedy is parsed into join and token-only remains refused',t=>{
 const f=fixture(t);writeFileSync(join(f.root,'.aw','teams.json'),'{"memberships":[]}');const r=f.run(['setup','--soul','dev','--dir',f.deployment]);assert.equal(r.status,0,r.stderr);
 const command=r.stdout.match(/Existing team path:.*`(oats aweb setup [^`]+)`/)[1];
 assert.match(command,/--join default --invite-stdin/);assert.doesNotMatch(command,/aw team join/);
 const expanded=command.replace('<alias>','host').replace('<url>','https://service.invalid');
 const args=expanded.split(' ').slice(2);
 // An absent deployment is the effect boundary: parser reaches join, no acceptance.
 const checked=f.run(args,{OATS_TEAM_SCOPE:''},'SECRET\n');assert.equal(checked.status,1);assert.match(checked.stderr,/selected deployment/);assert.doesNotMatch(checked.stderr,/usage:/);
 const refused=f.run(['setup','--invite-stdin'],{},'SECRET\n');assert.equal(refused.status,2);assert.match(refused.stderr,/requires --join/);
});
test('hosted create diagnostic distinguishes native 1.36.24 from unsupported wrapper and 1.36.23',t=>{
 const f=fixture(t),r=f.run(['setup','--create','sibling']);assert.equal(r.status,1);assert.match(r.stderr,/provider setup --create without --namespace is not supported/);assert.match(r.stderr,/native aw 1\.36\.24 supports id team create --hosted/);assert.match(r.stderr,/not available in aw 1\.36\.23/);assert.doesNotMatch(r.stderr,/not yet released/);assert.ok(!f.fake.readCalls().some(c=>c.args.includes('create')));
});
function joinFixture(t,{settings,change=''}={}) {
 const f=fixture(t),current=join(f.base,'current-root');mkdirSync(join(current,'.aw'),{recursive:true});writeFileSync(join(current,'.aw','teams.json'),JSON.stringify({memberships:[{team_id:TEAM}]}));
 const q=currentRootQuery(f.base,{home:f.home,deployment:f.deployment,settings:settings?settings(f,current):{roots:{[TEAM]:current}},change});
 const run=extra=>f.run(['join','--labels','joined','--json'],{OATS_CLI_BIN:q.cli,OATS_AGENT:'spoofed',OATS_SOUL_ID:'also-spoofed',...extra});
 return {...f,current,q,run};
}
test('explicit join uses current exact-team root and recorded soul, sanitizes query env and native identity',t=>{
 const f=joinFixture(t),r=f.run();assert.equal(r.status,0,r.stderr);const calls=f.fake.readCalls();
 assert.equal(calls.find(c=>c.args[0]==='team'&&c.args[1]==='invite').cwd,f.current);
 const queries=readFileSync(f.q.calls,'utf8').trim().split('\n').map(JSON.parse);assert.equal(queries.length,2);assert.ok(queries[1].args.includes('dev'));assert.ok(!queries[1].args.includes('spoofed'));for(const q of queries){assert.equal(q.cwd,f.deployment);assert.deepEqual(q.selectors,[]);}
 const retried=f.run({OATS_CLI_BIN:'/unavailable'});assert.equal(retried.status,0,retried.stderr);assert.equal(f.fake.readCalls().filter(c=>c.args[1]==='invite').length,1);
});
test('current shared multi-team root can mint the exact requested team',t=>{
 const f=joinFixture(t,{settings:(f)=>({root:f.root,delivery:'session',identity:{mode:'global'}})});
 writeFileSync(join(f.root,'.aw','teams.json'),JSON.stringify({memberships:[{team_id:TEAM},{team_id:'default:example.invalid'}]}));
 const r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(f.fake.readCalls().find(c=>c.args[1]==='invite').cwd,f.root);
});
const failures={
 'missing-root':{settings:()=>({})},'invalid-explicit':{settings:f=>({root:f.root,roots:{[TEAM]:null}})},
 'relative-root':{settings:()=>({roots:{[TEAM]:'relative'}})},'unreadable-root':{settings:()=>({roots:{[TEAM]:'/absent'}})},
 'bad-roots-map':{settings:()=>({roots:[]})},
 'malformed-json':{change:"console.log('SECRET malformed');process.exit(0);"},
 'failed-query':{change:"console.error('SECRET');process.exit(1);"},
 'failed-envelope':{change:"doc.ok=false;doc.error={code:'E_SOUL_UNKNOWN',message:'SECRET'};"},
 'wrong-schema':{change:'doc.schemaVersion=2;'},'wrong-home':{change:"if(isHome)doc.result.subject.home=deployment;"},
 'wrong-soul':{change:"if(!isHome)doc.result.subject.soul='other';"},'missing-soul':{change:"delete doc.result.subject.soul;"},
 'wrong-deployment':{change:"doc.result.workspace.deployment=home;"},'stale':{change:"doc.result.teamsSource='recorded';"},
 'duplicate-provider':{change:'doc.result.capabilities.push(doc.result.capabilities[0]);'},'incompatible':{change:'doc.result.capabilities[0].compatibility.ok=false;'},
 'problem':{change:"doc.result.problems=[{code:'unresolved'}];"},'wrong-settings':{change:'doc.result.capabilities[0].settings=null;'}
};
for(const [name,options] of Object.entries(failures))test(`current authority ${name} mints zero invites`,t=>{
 const f=joinFixture(t,options),r=f.run();assert.equal(r.status,1,r.stdout);assert.doesNotMatch(r.stdout+r.stderr,/SECRET/);assert.ok(!f.fake.readCalls().some(c=>c.args[1]==='invite'));
});
for(const kind of ['wrong-membership','spoofed-workspace','query-unavailable'])test(`${kind} refuses before invite`,t=>{
 const f=joinFixture(t);if(kind==='wrong-membership')writeFileSync(join(f.current,'.aw','teams.json'),'{"memberships":[]}');
 const r=f.run(kind==='spoofed-workspace'?{OATS_WORKSPACE:f.root}:kind==='query-unavailable'?{OATS_CLI_BIN:'/absent'}:{});assert.equal(r.status,1);assert.ok(!f.fake.readCalls().some(c=>c.args[1]==='invite'));
});

for(const outside of [false,true])test(`create uses deployment sibling with ${outside?'external':'nested'} authority`,t=>{
 const f=fixture(t,outside), cli=join(f.base,'teams-cli');
 writeFileSync(cli,`#!${process.execPath}\nconsole.log(JSON.stringify({schemaVersion:1,ok:true,result:{localTeams:false,defaultTeam:{label:'default'}}}));`,{mode:0o755});
 const r=f.run(['setup','--create','joined','--namespace','example.invalid'],{OATS_CLI_BIN:cli});assert.equal(r.status,0,r.stderr);
 assert.ok(existsSync(join(f.deployment,'.aweb-roots','joined','.aw','workspace.yaml')));assert.ok(!existsSync(join(f.root,'.aweb-roots')));
});
for(const event of ['launch','retire'])test(`${event} never queries current roots`,t=>{
 const f=fixture(t),q=currentRootQuery(f.base,{home:f.home,deployment:f.deployment,settings:{}});
 const r=f.run([event],{OATS_CLI_BIN:q.cli,OATS_LAUNCH_PREVIEW:'1',OATS_META:JSON.stringify({team:'default:example.invalid',alias:'dev-1',runtime:'claude',delivery:'channel'})});
 assert.ok(!existsSync(q.calls));assert.doesNotMatch(r.stdout+r.stderr,/current root query/);
});
test('GLOBAL error and operation error envelope remain intact',t=>{
 const f=joinFixture(t),r=f.run({OATS_OPERATION:'messaging:join',OATS_SETTINGS:JSON.stringify({identity:{mode:'global'}})});
 assert.equal(r.status,1);const doc=JSON.parse(r.stdout);assert.equal(doc.schemaVersion,1);assert.equal(doc.ok,false);assert.equal(doc.error.code,'E_TEAM_GLOBAL_MODE');assert.ok(!existsSync(f.q.calls));
});

for (const destination of ['existing-root', 'deployment']) {
 for (const failure of ['alias', 'accept']) test(`failed ${failure} preserves pre-existing ${destination} and operator data`, t => {
  const f = fixture(t);
  const target = destination === 'deployment' ? f.deployment : join(f.base, 'operator-root');
  mkdirSync(target, {recursive: true});
  const sentinel = join(target, 'operator-data');
  writeFileSync(sentinel, 'keep me');
  const localBefore = readFileSync(join(f.deployment, 'oats-local.yaml'), 'utf8');
  const r = f.run(['setup', '--join', 'joined', '--invite', 'SECRET', '--name', failure === 'alias' ? 'invalid alias' : 'host', '--service', 'https://service.invalid'], {
   OATS_SETTINGS: JSON.stringify({root: f.root, roots: {[TEAM]: target}}),
   ...(failure === 'accept' ? {AW_ACCEPT_FAIL: '1'} : {}),
  });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, failure === 'alias' ? /aliases must match/ : /failed/);
  assert.equal(readFileSync(sentinel, 'utf8'), 'keep me');
  assert.equal(readFileSync(join(f.deployment, 'oats-local.yaml'), 'utf8'), localBefore);
  assert.ok(existsSync(f.home));
  assert.equal(f.fake.readCalls().filter(c => c.args.includes('accept-invite')).length, failure === 'accept' ? 1 : 0);
  assert.doesNotMatch(r.stdout + r.stderr, /SECRET/);
 });
}
for (const failure of ['alias', 'accept']) test(`failed ${failure} leaves no new team root`, t => {
 const f = fixture(t);
 const r = f.run(['setup', '--join', 'joined', '--invite', 'SECRET', '--name', failure === 'alias' ? 'invalid alias' : 'host', '--service', 'https://service.invalid'], failure === 'accept' ? {AW_ACCEPT_FAIL: '1'} : {});
 assert.equal(r.status, 1);
 assert.ok(!existsSync(join(f.deployment, '.aweb-roots', 'joined')));
});

for (const residue of ['addition', 'partial']) test(`failed accept retains new root containing ${residue}`, t => {
 const f = fixture(t), target = join(f.deployment, '.aweb-roots', 'joined');
 const r = f.run(['setup', '--join', 'joined', '--invite', 'SECRET', '--name', 'host', '--service', 'https://service.invalid'], {
  AW_ACCEPT_FAIL: '1', [residue === 'addition' ? 'AW_ACCEPT_FAIL_ADDITION' : 'AW_ACCEPT_FAIL_PARTIAL']: '1',
 });
 assert.equal(r.status, 1);
 assert.equal(readFileSync(residue === 'addition' ? join(target, 'concurrent-data') : join(target, '.aw', 'identity.yaml'), 'utf8'), residue === 'addition' ? 'keep addition' : 'partial identity');
});
