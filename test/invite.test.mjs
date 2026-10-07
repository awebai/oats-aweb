import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const cap=fileURLToPath(new URL('../oats-package/capabilities/oats-aweb',import.meta.url)),hook=join(cap,'bin/oats-aweb.mjs');
function fixture(t,{native='success',member='team:fixture.aweb.ai',team='team:fixture.aweb.ai',settings,query='ok'}={}){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'invite-test-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const dep=join(dir,'dep'),root=join(dir,'root'),foreign=join(dir,'foreign'),bin=join(dir,'bin'),calls=join(dir,'calls');for(const p of [dep,join(root,'.aw'),foreign,bin])mkdirSync(p,{recursive:true});writeFileSync(join(dep,'oats-local.yaml'),'schemaVersion: 2\nworkspace: local\n');writeFileSync(join(foreign,'sentinel'),'untouched');
 const kernel=join(bin,'kernel');writeFileSync(kernel,`#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({kind:'kernel',args:process.argv.slice(2),cwd:process.cwd()})+'\\n');console.log(JSON.stringify(${JSON.stringify({schemaVersion:1,ok:true,result:{teamsApi:2,deployment:query==='wrong'?root:dep,teams:[{label:'default',team},{label:'other',team:'other:fixture.aweb.ai'}],problems:[]}})}));`,{mode:0o755});
 writeFileSync(join(bin,'aw'),`#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({kind:'aw',args,cwd:process.cwd(),env:process.env})+'\\n');if(args[1]==='list'){console.log(JSON.stringify({memberships:[{team_id:${JSON.stringify(member)}}]}));process.exit(0);}const mode=${JSON.stringify(native)};if(mode==='success')console.log(JSON.stringify({status:'created',invite_id:'synthetic',token:'aw_inv_SYNTHETIC'}));else if(mode==='malformed')console.log('aw_inv_SECRET_NOT_JSON');else if(mode==='byot')console.log(JSON.stringify({status:'created',invite_id:'x',token:'LOCAL_SECRET'}));else{console.error(mode==='lookalike'?'arbitrary body create hosted team invite: aweb: http 403: SECRET':mode==='transport'?'connect refused SECRET':'create hosted team invite: aweb: http '+mode+': SECRET');process.exit(1);}`,{mode:0o755});
 const env={...process.env,PATH:bin,OATS_EVENT:'invite',OATS_CLI_BIN:kernel,OATS_TEAM_SCOPE:dep,OATS_WORKSPACE:dep,OATS_DEFAULT_TEAM:'default',OATS_DEFAULT_TEAM_ID:team,OATS_SETTINGS:JSON.stringify(settings||{root}),AWEB_IDENTITY_HOME:foreign,AWEB_URL:'https://poison.invalid',AWEB_API_KEY:'FOREIGN_SECRET',AWID_REGISTRY_URL:'https://poison.invalid',AWEB_TEAM_ID:'poison',HOME:foreign,HTTP_PROXY:'http://poison.invalid'};
 return {dir,dep,root,foreign,env,read:()=>existsSync(calls)?readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse):[],run:(args=[],extra={})=>spawnSync(process.execPath,[hook,'invite',...args],{cwd:dep,env:{...env,...extra},encoding:'utf8'})};
}
test('invite selects explicit team/root and emits token once with isolated native authority',t=>{
 const f=fixture(t),r=f.run(['--json']);assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);assert.equal(d.schemaVersion,1);assert.equal(d.ok,true);assert.equal(d.result.team,'team:fixture.aweb.ai');assert.equal(r.stdout.split('aw_inv_SYNTHETIC').length-1,1);assert.equal(r.stderr,'');
 const calls=f.read().filter(c=>c.kind==='aw'),mint=calls.find(c=>c.args[1]==='invite');assert.deepEqual(mint.args,['team','invite','--team-id','team:fixture.aweb.ai','--member-local','--json']);assert.equal(mint.cwd,f.root);assert.notEqual(mint.env.HOME,f.foreign);assert.equal(existsSync(mint.env.HOME),false);for(const key of ['AWEB_IDENTITY_HOME','AWEB_API_KEY','AWEB_URL','AWID_REGISTRY_URL','HTTP_PROXY','OATS_AGENT'])assert.equal(mint.env[key],undefined);assert.equal(readFileSync(join(f.foreign,'sentinel'),'utf8'),'untouched');
});
test('invite plan only reads and makes no permission claim or native issuance',t=>{const f=fixture(t),r=f.run(['--plan','--json']);assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout).result;assert.equal(d.plan,true);assert.equal(d.token,undefined);assert.match(d.authority,/decides/);assert.equal(f.read().filter(c=>c.kind==='aw'&&c.args[1]==='invite').length,0);assert.deepEqual(readdirSync(f.root),['.aw']);assert.deepEqual(readdirSync(join(f.root,'.aw')),[]);});
test('invite rejects positional recipient and malformed options before queries',t=>{for(const args of [['alice'],['--alias','alice'],['--label'],['--json','--json'],['--plan=true']]){const f=fixture(t),r=f.run([...args,'--json']);assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).error.code,'E_INVITE_ARGUMENT');assert.deepEqual(f.read(),[]);}});
test('invite validates team/current deployment/membership before issuance',t=>{for(const [options,args,code] of [[{},['--label','unknown'],'E_INVITE_TEAM'],[{query:'wrong'},[],'E_INVITE_TEAM_QUERY'],[{member:'foreign:fixture.aweb.ai'},[],'E_INVITE_MEMBERSHIP']]){const f=fixture(t,options),r=f.run([...args,'--json']);assert.equal(JSON.parse(r.stdout).error.code,code);assert.equal(f.read().some(c=>c.args[1]==='invite'),false);}});
test('invalid explicit root never falls back, valid explicit override wins',t=>{const f=fixture(t);for(const root of [null,'relative','/nonexistent-invite-fixture']){const r=f.run(['--json'],{OATS_SETTINGS:JSON.stringify({root:f.root,roots:{'team:fixture.aweb.ai':root}})});assert.equal(JSON.parse(r.stdout).error.code,'E_INVITE_ROOT');}const r=f.run(['--json'],{OATS_SETTINGS:JSON.stringify({root:'/invalid-fallback',roots:{'team:fixture.aweb.ai':f.root}})});assert.equal(r.status,0,r.stderr);});
for(const [mode,code] of [['401','E_INVITE_DENIED'],['403','E_INVITE_DENIED'],['409','E_INVITE_NATIVE'],['500','E_INVITE_NATIVE'],['lookalike','E_INVITE_NATIVE'],['transport','E_INVITE_NATIVE'],['malformed','E_INVITE_OUTPUT'],['byot','E_INVITE_OUTPUT']])test(`invite ${mode} remains secret-safe and classified without body matching`,t=>{const f=fixture(t,{native:mode}),r=f.run(['--json']);assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).error.code,code);assert.doesNotMatch(r.stdout+r.stderr,/SECRET|aw_inv_/);assert.equal(f.read().filter(c=>c.args[1]==='invite').length,1);});
test('invite text success is token only and operation returns one versioned envelope',t=>{const f=fixture(t);assert.equal(f.run().stdout,'aw_inv_SYNTHETIC\n');const r=f.run([],{OATS_OPERATION:'messaging:invite'});assert.equal(JSON.parse(r.stdout).ok,true);assert.equal(r.stdout.trim().split('\n').length,1);});
test('invite malformed settings and inconsistent default refuse without issuance', t => {
 const f=fixture(t);
 for (const extra of [
  {OATS_SETTINGS:'not json'}, {OATS_SETTINGS:'[]'}, {OATS_SETTINGS:'{"roots":[]}'},
  {OATS_SETTINGS:JSON.stringify({root:f.root,team:'foreign'})},
  {OATS_DEFAULT_TEAM_ID:'foreign:fixture.aweb.ai'}, {OATS_DEFAULT_TEAM:''},
  {OATS_TEAM_SCOPE:f.root}, {OATS_CLI_BIN:'/not/a/kernel.mjs'},
 ]) {
  const r=f.run(['--json'],extra);assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).ok,false);
 }
 assert.equal(f.read().some(c=>c.args[1]==='invite'),false);
});
test('invite invalid kernel envelopes fail closed with no native calls', t => {
 const f=fixture(t);
 for (const doc of [null,{}, {schemaVersion:1,ok:false}, {schemaVersion:1,ok:true,result:{teamsApi:99}},
  {schemaVersion:1,ok:true,result:{teamsApi:2,deployment:f.dep,teams:[],problems:[{code:'invalid'}]}}]) {
  writeFileSync(f.env.OATS_CLI_BIN,`console.log(${JSON.stringify(JSON.stringify(doc))});`);
  const r=f.run(['--json']);assert.equal(JSON.parse(r.stdout).error.code,'E_INVITE_TEAM_QUERY');
 }
 assert.equal(f.read().some(c=>c.kind==='aw'),false);
});
test('explicit label selects its canonical team independently of root active/default team', t => {
 const f=fixture(t,{member:'other:fixture.aweb.ai'}),r=f.run(['--label','other','--json']);
 assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout).result.team,'other:fixture.aweb.ai');
 assert.equal(f.read().find(c=>c.args[1]==='invite').args[3],'other:fixture.aweb.ai');
});

test('canonical team validation preserves existing dotted names and refuses invalid namespaces', t => {
 const team='team.name:fixture.aweb.ai',f=fixture(t,{team,member:team});
 assert.equal(f.run(['--plan','--json']).status,0);
 for(const team of ['team:bad..invalid','team:-bad.invalid','team:bad-.invalid','team:bad/invalid']) {
  const f=fixture(t,{team,member:team}),r=f.run(['--json']);
  assert.equal(JSON.parse(r.stdout).error.code,'E_INVITE_TEAM');assert.equal(f.read().some(c=>c.kind==='aw'),false);
 }
});
