// Inert public-CLI/aw doubles. Private files contain controlled kernel-shaped
// data, NOT admission or account/grant proof. No real SDK/backend/provider call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {invocationFor,FIXTURE_INCARNATION_ID} from './helpers/invocation-fixture.mjs';
const cap=process.env.OATS_S3_BASELINE_CAP||fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/',import.meta.url));
function fixture(t,{runtime='codex',version='0.24.2',nativeMode='normal',projection=true}={}){
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'aweb-native-adapter-')));t.diagnostic('preserved fixture '+root);
 const deployment=join(root,'deployment'),home=join(deployment,'instance'),work=join(home,'work'),bin=join(root,'bin'),calls=join(root,'native-calls.jsonl'),kernelCalls=join(root,'kernel-calls.jsonl');
 fs.mkdirSync(work,{recursive:true});fs.mkdirSync(join(deployment,'.aw'));fs.mkdirSync(bin);
 const context={kind:'standalone',key:'fixture-workspace'},binding={schemaVersion:1,capability:'oats.aweb',payloadContract:'oats.aweb.messaging',payloadVersion:1,payload:{responsibleHuman:{provider:'oats.aweb',id:'explicit-fixture-human'},context,privateTeam:{provider:'oats.aweb',id:'private:example.invalid'},wider:[]},credentialRefs:{},provenance:[]};
 const invocation=invocationFor({binding,context,action:{kind:'hook',capability:'oats.aweb',name:'spawn'}});
 invocation.executionBinding.deployment=deployment;invocation.instance={home,work,name:'instance',agent:'example',incarnationId:FIXTURE_INCARNATION_ID};invocation.intent={schemaVersion:1,executionId:'fixture-intent',incarnationId:FIXTURE_INCARNATION_ID,attempt:1};
 const bindingFile=join(root,'binding.json'),invocationFile=join(root,'invocation.json'),kernel=join(root,'kernel.mjs');
 const save=()=>{fs.writeFileSync(bindingFile,JSON.stringify(binding),{mode:0o600});fs.writeFileSync(invocationFile,JSON.stringify(invocation),{mode:0o600});};save();
 fs.writeFileSync(kernel,`import fs from 'node:fs';const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(kernelCalls)},JSON.stringify(args)+'\\n');console.log(JSON.stringify(args[0]==='--version'?{schemaVersion:1,name:'@awebai/oats',version:${JSON.stringify(version)}}:{schemaVersion:1,ok:true,result:{resolution:${JSON.stringify(invocation.executionBinding.resolution)},...(${projection}?{launchSelection:{runtime:${JSON.stringify(runtime)},model:'explicit/model'}}:{})}}));`);
 const facts={home,deployment,calls,nativeMode,team:binding.payload.privateTeam.id};
 fs.writeFileSync(join(bin,'aw'),`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),f=${JSON.stringify(facts)};let a=process.argv.slice(2);fs.appendFileSync(f.calls,JSON.stringify({args:a,cwd:process.cwd()})+'\\n');if(a[0]==='--team'){if(a[1]!==f.team)process.exit(96);a=a.slice(2);}const emit=o=>console.log(JSON.stringify(o));
if(a[0]==='team'&&a[1]==='invite'){if(process.cwd()!==f.deployment||a[a.indexOf('--team-id')+1]!==f.team)process.exit(95);emit({token:f.nativeMode==='token-as-did'?'did:key:zSyntheticInviteToken':'SYNTHETIC-INVITE-NOT-A-CREDENTIAL'});}
else if(a[0]==='team'&&a[1]==='join'){if(process.cwd()!==f.home)process.exit(94);fs.mkdirSync(path.join(f.home,'.aw'));if(f.nativeMode==='join-failure'){console.error('SYNTHETIC-INVITE-NOT-A-CREDENTIAL');process.exit(7);}emit({alias:'instance',team_id:f.nativeMode==='wrong-team'?'foreign:example.invalid':f.team});}
else if(a[0]==='init')console.log('initialized');
else if(a[0]==='whoami'){if(f.nativeMode==='replace-home'){fs.renameSync(f.home,f.home+'-original');fs.cpSync(f.home+'-original',f.home,{recursive:true});}emit({alias:'instance',did:f.nativeMode==='token-as-did'?'did:key:zSyntheticInviteToken':'did:key:zFixtureOwnIdentity'});}
else if(a[0]==='workspace'&&a[1]==='status')emit({selected_team:f.team,workspace:{alias:'instance',workspace_path:f.home}});
else if(a[0]==='wake')console.log('registered-or-deregistered');
else if(a[0]==='workspace'&&a[1]==='delete'){fs.rmSync(path.join(f.home,'.aw'),{recursive:true});emit({alias:'instance',deleted_at:'fixture-time',alias_released:true});}
else {console.error('unexpected fake native command');process.exit(93);}
`,{mode:0o755});
 const env={PATH:bin,HOME:root,OATS_BINDING_FILE:bindingFile,OATS_INVOCATION_CONTEXT_FILE:invocationFile,OATS_CLI_BIN:kernel,OATS_SETTINGS:'{"delivery":"session"}',OATS_HOME:home,OATS_INSTANCE:'instance',OATS_EVENT:'spawn'};
 const run=(event='spawn',extra={})=>{const r=spawnSync(process.execPath,[join(cap,'bin/oats-aweb.mjs'),event],{cwd:home,env:{...env,OATS_EVENT:event,...extra},encoding:'utf8',timeout:15000});let output;try{output=JSON.parse(r.stdout);}catch{}return {...r,output};};
 const readCalls=()=>fs.existsSync(calls)?fs.readFileSync(calls,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 return{root,home,work,deployment,binding,context,invocation,env,save,run,readCalls};
}
test('captured session policy and native HOME setup use selected identity/team and normal registration',t=>{
 const f=fixture(t),r=f.run();assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.output.meta.team,f.binding.payload.privateTeam.id);assert.equal(r.output.meta.did,'did:key:zFixtureOwnIdentity');assert.deepEqual(r.output.env,{AWEB_DELIVERY:'session'});assert.doesNotMatch(r.stdout+r.stderr,/SYNTHETIC-INVITE/);
 const calls=f.readCalls();assert.equal(calls[0].cwd,f.deployment);assert.equal(calls[1].cwd,f.home);assert.deepEqual(calls.at(-1).args,['wake','register','--home',f.home,'--identity-home',join(f.home,'.aw'),'--delivery','session']);
 f.invocation.action={kind:'hook',capability:'oats.aweb',name:'retire'};f.invocation.intent.executionId='fixture-retire';f.invocation.priorReceipt=r.output.meta;f.save();const retired=f.run('retire');assert.equal(retired.status,0,retired.stdout);assert.equal(retired.output.meta.retired,true);assert.equal(retired.output.meta.aliasReusable,true);assert.equal(fs.existsSync(join(f.home,'.aw')),false);
});
test('actual codec emits fixed missing-item messages and conditional readiness, never guesses a profile',t=>{
 for(const [options,status,message] of [[{runtime:'pi'},'needs-configuration',/Pi strict print/],[{version:'0.24.1'},'needs-configuration',/>=0\.24\.2/],[{projection:false},'needs-configuration',/launchSelection/],[{},'ready',null]]){
  const f=fixture(t,options),action={kind:'inspect'},request={schemaVersion:1,phase:'check',slot:'messaging',capability:'oats.aweb',settings:{delivery:'session'},input:{binding:f.binding,context:f.context,action,invocation:{...f.invocation,action,intent:null}}};
  const r=spawnSync(process.execPath,[join(cap,'bin/oats-aweb-binding.mjs'),'check'],{cwd:f.home,env:f.env,input:JSON.stringify(request),encoding:'utf8',timeout:15000});assert.equal(r.status,0,r.stderr);const out=JSON.parse(r.stdout);assert.equal(out.ok,true);assert.equal(out.result.status,status);if(message)assert.match(out.result.problems[0].message,message);assert.equal(f.readCalls().length,0);
 }
});
test('Pi, old kernel and missing public projection refuse before any native setup effects',t=>{
 for(const options of [{runtime:'pi'},{version:'0.24.0'},{version:'0.24.1'},{projection:false}]){const f=fixture(t,options),r=f.run();assert.equal(r.status,1);assert.equal(r.output.status,'needs-configuration');assert.equal(f.readCalls().length,0);assert.equal(fs.existsSync(join(f.home,'.aw')),false);}
});
test('no ambient authority/identity fallback and no auto-retry of partial native setup',t=>{
 const f=fixture(t);fs.rmSync(join(f.deployment,'.aw'),{recursive:true});const foreign=join(f.root,'foreign');fs.mkdirSync(join(foreign,'.aw'),{recursive:true});
 const r=f.run('spawn',{OATS_TEAM_SCOPE:foreign,OATS_TEAM_ID:'foreign:example.invalid'});assert.equal(r.status,1);assert.equal(f.readCalls().length,0);
 const g=fixture(t),overridden=g.run('spawn',{AWEB_IDENTITY_HOME:join(foreign,'.aw')});assert.equal(overridden.status,1);assert.equal(g.readCalls().length,0);
 const h=fixture(t,{nativeMode:'join-failure'}),partial=h.run();assert.equal(partial.status,1);assert.equal(partial.output.meta.pending,'join');assert.doesNotMatch(partial.stdout+partial.stderr,/SYNTHETIC-INVITE/);const before=h.readCalls().length;h.invocation.priorReceipt=partial.output.meta;h.save();assert.equal(h.run().status,1);assert.equal(h.readCalls().length,before);
});
test('native mismatch or physical custody loss preserves partial receipt and prevents wake transport',t=>{
 for(const nativeMode of ['wrong-team','replace-home','token-as-did']){const f=fixture(t,{nativeMode}),r=f.run();assert.equal(r.status,1,r.stdout);assert.ok(r.output.meta);assert.equal(f.readCalls().some(c=>c.args[0]==='wake'),false);assert.doesNotMatch(r.stdout+r.stderr,/SYNTHETIC-INVITE|zSyntheticInviteToken/);}
});
