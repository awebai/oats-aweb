import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fakeAwSetupPath } from './helpers/fake-aw-setup.mjs';
import { fakeKernelTeamConfig } from './helpers/fake-kernel-team-config.mjs';
const hook=fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs',import.meta.url));
const team='joined:example.invalid', row={team_id:team,identity_scope:'local',alias:'root-1'};
function fixture(t,state={}) {
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'join-default-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const dep=join(dir,'deployment'),root=join(dep,'.aweb-roots','joined');mkdirSync(dep);writeFileSync(join(dep,'oats-local.yaml'),'schemaVersion: 2\nworkspace: fixture\n');
 const kernel=fakeKernelTeamConfig(join(dir,'kernel'),dep,state),aw=fakeAwSetupPath(t);
 const clean=Object.fromEntries(Object.entries(process.env).filter(([k])=>! /^(OATS_|AWEB_)/.test(k)));
 const env={...clean,PATH:aw.path,OATS_TEAM_SCOPE:dep,OATS_WORKSPACE:dep,OATS_WORKSPACE_NAME:'fixture',OATS_SETTINGS:'{}',
 OATS_CLI_BIN:kernel.cli,OATS_TEAMS:'[]',AW_FAKE_TEAM:team,AWEB_IDENTITY_HOME:'/foreign/home',OATS_AGENT:'foreign',OATS_HOME:'/foreign/home'};
 const run=(args=[],extra={})=>spawnSync(process.execPath,[hook,'setup','--join','joined','--name','root-1','--service','https://fixture.invalid','--json',...args],
 {cwd:dep,env:{...env,...extra},encoding:'utf8',input:'SECRET-FIXTURE\n'});
 const member=(rows=[row])=>{mkdirSync(join(root,'.aw'),{recursive:true});writeFileSync(join(root,'.aw','identity.yaml'),'fixture');writeFileSync(join(root,'.aw','workspace.yaml'),'aweb_url: https://fixture.invalid\n');writeFileSync(join(root,'.aw','teams.json'),JSON.stringify({memberships:rows}));};
 const mutations=()=>kernel.calls().filter(c=>['add','default'].includes(c.args[1]));
 return {dir,dep,root,kernel,aw,run,member,mutations};
}
const answer=r=>{assert.equal(r.status,0,r.stdout+r.stderr);return JSON.parse(r.stdout).result;};
const error=r=>{assert.equal(r.status,1,r.stdout+r.stderr);assert.doesNotMatch(r.stdout+r.stderr,/SECRET-FIXTURE|SECRET_KERNEL_BODY/);return JSON.parse(r.stdout).error;};
test('fresh labelled join verifies membership, adds mapping with implicit default, resumes without redemption',t=>{
 const f=fixture(t),result=answer(f.run(['--invite-stdin']));
 assert.equal(result.team,team);assert.equal(result.observed.defaultTeam.label,'joined');assert.equal(result.membershipVerified,true);
 assert.deepEqual(f.mutations().map(c=>c.args[1]),['add']);
 answer(f.run());assert.equal(f.aw.readCalls().filter(c=>c.args.includes('accept-invite')).length,1);
 for(const c of f.kernel.calls()){assert.equal(c.cwd,f.dep);assert.equal(c.args[c.args.indexOf('--dir')+1],f.dep);assert.equal(c.ambientAgent,undefined);assert.equal(c.ambientHome,undefined);}
});
test('exact shared mapping without default reuses mapping and sets default',t=>{
 const f=fixture(t,{teams:[{label:'joined',team,from:'shared'}]});answer(f.run(['--invite-stdin']));
 assert.deepEqual(f.mutations().map(c=>c.args[1]),['default']);
});
test('existing local default is preserved while joined mapping is added',t=>{
 const d={label:'prior',team:'prior:example.invalid',from:'deployment'},f=fixture(t,{teams:[{...d,from:'local'}],defaultTeam:d});
 const result=answer(f.run(['--invite-stdin']));assert.deepEqual(f.kernel.read().defaultTeam,d);
 assert.deepEqual(f.mutations().map(c=>c.args[1]),['add']);assert.deepEqual(result.remaining,[['oats','teams','default','joined','--dir',f.dep]]);
});
test('inherited workspace default and missing mapping refuses unsafe add, retaining any admitted root',t=>{
 const d={label:'prior',team:'prior:example.invalid',from:'workspace'},f=fixture(t,{teams:[{...d,from:'shared'}],defaultTeam:d});
 f.member();const before=f.kernel.read(),err=error(f.run());
 assert.equal(err.code,'E_SETUP_DEFAULT_PRESERVE');assert.match(err.message,/already has an effective default from the workspace/);
 assert.deepEqual(err.details.commands,[['oats','teams','add','joined','--team',team,'--dir',f.dep]]);
 assert.deepEqual(f.kernel.read(),before);assert.deepEqual(f.mutations(),[]);assert.ok(existsSync(join(f.root,'.aw','identity.yaml')));
});
test('inherited default with exact joined mapping reuses mapping and never sets default',t=>{
 const d={label:'prior',team:'prior:example.invalid',from:'workspace'},f=fixture(t,{teams:[{...d,from:'shared'},{label:'joined',team,from:'shared'}],defaultTeam:d});
 answer(f.run(['--invite-stdin']));assert.deepEqual(f.mutations(),[]);assert.deepEqual(f.kernel.read().defaultTeam,d);
});
test('closed and unmapped policy refuses before acceptance',t=>{
 for(const state of [{localTeams:false},{teams:[{label:'joined',team:null,from:'shared'}]}]){
  const f=fixture(t,state),err=error(f.run(['--invite-stdin']));
  assert.match(err.code,/E_SETUP_(POLICY|TEAM_CONFLICT)/);assert.deepEqual(f.aw.readCalls(),[]);assert.equal(existsSync(f.root),false);assert.deepEqual(f.mutations(),[]);
 }
});
test('known mapping constrains admitted canonical team; no mapping/default mutation on mismatch',t=>{
 const f=fixture(t,{teams:[{label:'joined',team:'other:example.invalid',from:'shared'}]});
 const err=error(f.run(['--invite-stdin']));assert.match(err.message,/differs from requested/);assert.deepEqual(f.mutations(),[]);
});
test('unmapped connected root resumes from exact native membership without redeeming',t=>{
 const f=fixture(t);f.member();answer(f.run());assert.equal(f.aw.readCalls().some(c=>c.args.includes('accept-invite')),false);
 assert.equal(f.kernel.read().defaultTeam.label,'joined');
});
test('ambiguous, GLOBAL, malformed or wrong alias retained membership never writes config or redeems',t=>{
 for(const rows of [[row,row],[{...row,identity_scope:'global'}],[{...row,alias:'other'}],[{...row,team_id:'bad'}],[]]){
  const f=fixture(t);f.member(rows);assert.equal(error(f.run()).code,'E_SETUP_MEMBERSHIP');assert.deepEqual(f.mutations(),[]);
  assert.equal(f.aw.readCalls().some(c=>c.args.includes('accept-invite')),false);assert.ok(existsSync(join(f.root,'.aw','identity.yaml')));
 }
});
for(const failure of ['add-before','add-after','readback-add','default-before','default-after','readback-default']){
 test('join partial '+failure+' is honest and retry preserves root without redemption',t=>{
  const state=failure.includes('default')?{teams:[{label:'joined',team,from:'shared'}]}:{};
  const f=fixture(t,{...state,failure}),err=error(f.run(['--invite-stdin']));
  assert.match(err.code,/E_SETUP_(KERNEL|READBACK)/);assert.ok(existsSync(join(f.root,'.aw','identity.yaml')));
  if(failure==='add-after')assert.equal(err.details.observed.defaultTeam.label,'joined');
  if(failure.startsWith('readback'))assert.equal(err.details.observed,undefined);
  const next=f.kernel.read();delete next.failure;f.kernel.set(next);answer(f.run());
  assert.equal(f.aw.readCalls().filter(c=>c.args.includes('accept-invite')).length,1);
 });
}
test('malformed public schema and deployment fail before accept',t=>{
 for(const state of [{teamsApi:1},{deployment:'/wrong'},{localTeams:'true'},{problems:[{code:'bad'}]},{teams:[{label:'joined',team:'invalid'}]}]){
  const f=fixture(t,state);assert.match(error(f.run(['--invite-stdin'])).code,/E_SETUP_(QUERY|KERNEL)/);assert.deepEqual(f.aw.readCalls(),[]);
 }
});

test('observed intervening default prevents a default write; changed policy prevents mapping',t=>{
 const prior={label:'prior',team:'prior:example.invalid',from:'deployment'};
 const f=fixture(t,{teams:[{label:'joined',team,from:'shared'},{...prior,from:'shared'}],
  queryChanges:{3:{defaultTeam:prior}}});
 answer(f.run(['--invite-stdin']));assert.deepEqual(f.mutations(),[]);assert.deepEqual(f.kernel.read().defaultTeam,prior);
 const g=fixture(t,{queryChanges:{2:{localTeams:false}}});
 const err=error(g.run(['--invite-stdin']));assert.equal(err.code,'E_SETUP_POLICY');assert.deepEqual(g.mutations(),[]);
 assert.ok(existsSync(join(g.root,'.aw','identity.yaml')));
});
test('mapping changed after initial query refuses with root retained',t=>{
 const f=fixture(t,{queryChanges:{2:{teams:[{label:'joined',team:'other:example.invalid',from:'shared'}]}}});
 assert.equal(error(f.run(['--invite-stdin'])).code,'E_SETUP_TEAM_CONFLICT');
 assert.deepEqual(f.mutations(),[]);assert.ok(existsSync(join(f.root,'.aw','identity.yaml')));
});

test('soul-only or missing provenance cannot masquerade as a local default',t=>{
 for(const from of ['soul',undefined]){
  const f=fixture(t,{teams:[{label:'prior',team:'prior:example.invalid',from:'shared'}],defaultTeam:{label:'prior',team:'prior:example.invalid',from}});
  assert.equal(error(f.run(['--invite-stdin'])).code,'E_SETUP_QUERY');assert.deepEqual(f.aw.readCalls(),[]);
 }
});
