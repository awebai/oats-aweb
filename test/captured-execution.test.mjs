// Inert execution-transport fixtures. Kernel-shaped data is NOT real admission
// or human/native authority. No aw, SDK, backend, credential or source reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {loadCapturedAwebExecution,requireCapturedAwebAction} from '../oats-package/capabilities/oats-aweb/lib/captured-execution.mjs';
import {invocationFor,helperSubject,FIXTURE_INCARNATION_ID} from './helpers/invocation-fixture.mjs';
const manifest=JSON.parse(fs.readFileSync(new URL('../oats-package/capabilities/oats-aweb/oats.json',import.meta.url)));
const invalid={code:'invalid-binding'};
function fixture(t,{helper=false}={}){
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'aweb-execution-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const home=join(root,'instance'),work=join(home,'work');fs.mkdirSync(work,{recursive:true});
 const binding={schemaVersion:1,capability:'oats.aweb',payloadContract:'oats.aweb.messaging',payloadVersion:1,payload:{responsibleHuman:{provider:'oats.aweb',id:'explicit-fixture-human'},context:{kind:'standalone',key:'fixture-context'},privateTeam:{provider:'oats.aweb',id:'private:example.invalid'},wider:[]},credentialRefs:{},provenance:[]};
 const context=invocationFor({binding,context:binding.payload.context,action:{kind:'hook',capability:'oats.aweb',name:'spawn'},...(helper?{subject:helperSubject('memory-harvest')}:{})});
 context.executionBinding.deployment=root;context.instance={home,work,name:'instance',agent:helper?'memory-harvest':'example',incarnationId:FIXTURE_INCARNATION_ID};context.intent={schemaVersion:1,executionId:'fixture-admitted-shape',incarnationId:FIXTURE_INCARNATION_ID,attempt:1};
 const env={OATS_BINDING_FILE:join(root,'binding.json'),OATS_INVOCATION_CONTEXT_FILE:join(root,'invocation.json')};
 const save=()=>{fs.writeFileSync(env.OATS_BINDING_FILE,JSON.stringify(binding),{mode:0o600});fs.writeFileSync(env.OATS_INVOCATION_CONTEXT_FILE,JSON.stringify(context),{mode:0o600});};save();
 const receipt={schemaVersion:1,kind:context.subject.kind,home,work,context:root,agent:context.instance.agent,instance:'instance',sourceIdentity:helper?null:context.subject.soul.identity,role:'worker',executionBinding:context.executionBinding,responsibleHuman:context.responsibleHuman,binding};
 return {root,home,work,binding,context,env,save,receipt};
}
function action(f,env=f.env){return requireCapturedAwebAction(loadCapturedAwebExecution(env),'spawn',manifest,{env,cwd:f.home});}

test('actual distinct selected inputs support persistent and qualified helper subjects without a live source checkout',t=>{
 for(const helper of [false,true]){
  const f=fixture(t,{helper}),loaded=loadCapturedAwebExecution(f.env);assert.equal(loaded.kind,'captured');assert.deepEqual(JSON.parse(JSON.stringify(loaded.context)),f.context);assert.equal(loaded.sourceReceipt,null);assert.equal(Object.isFrozen(loaded.context.subject),true);action(f).assertCurrent();
  f.env.OATS_SOURCE_RECEIPT_FILE=join(f.root,'source.json');fs.writeFileSync(f.env.OATS_SOURCE_RECEIPT_FILE,JSON.stringify(f.receipt),{mode:0o600});action(f).assertCurrent();
  f.receipt.instance='foreign';fs.writeFileSync(f.env.OATS_SOURCE_RECEIPT_FILE,JSON.stringify(f.receipt));assert.throws(()=>action(f),invalid);
 }
 assert.deepEqual(loadCapturedAwebExecution({}),{kind:'legacy'});
});
test('missing/unpaired, malformed, linked, permissive or contradictory snapshots never select legacy',t=>{
 const f=fixture(t);
 for(const env of [{OATS_SOURCE_RECEIPT_FILE:'absent'},{OATS_BINDING_FILE:''},{OATS_INVOCATION_CONTEXT_FILE:f.env.OATS_INVOCATION_CONTEXT_FILE},{...f.env,OATS_BINDING_FILE:f.env.OATS_INVOCATION_CONTEXT_FILE}])assert.throws(()=>loadCapturedAwebExecution(env),invalid);
 const p=f.env.OATS_BINDING_FILE;
 for(const bytes of [Buffer.from('{"schemaVersion":1,"schemaVersion":1}'),Buffer.from([0xff]),Buffer.from('{} trailing')]){fs.writeFileSync(p,bytes);assert.throws(()=>loadCapturedAwebExecution(f.env),invalid);}f.save();
 fs.chmodSync(p,0o644);assert.throws(()=>loadCapturedAwebExecution(f.env),invalid);fs.chmodSync(p,0o600);
 fs.linkSync(p,p+'.hardlink');assert.throws(()=>loadCapturedAwebExecution(f.env),invalid);fs.unlinkSync(p+'.hardlink');
 fs.renameSync(p,p+'.owned');fs.symlinkSync(p+'.owned',p);assert.throws(()=>loadCapturedAwebExecution(f.env),invalid);fs.unlinkSync(p);fs.renameSync(p+'.owned',p);
 f.context.responsibleHuman={provider:'oats.aweb',id:'foreign'};f.save();assert.throws(()=>loadCapturedAwebExecution(f.env),invalid);
});
test('exact declared entrypoint, admitted intent and home selectors precede any native boundary',t=>{
 const f=fixture(t),loaded=loadCapturedAwebExecution(f.env);
 assert.throws(()=>requireCapturedAwebAction(loaded,'retire',manifest,{env:f.env,cwd:f.home}),invalid);
 assert.throws(()=>requireCapturedAwebAction(loaded,'spawn',manifest,{env:f.env,cwd:f.root}),invalid);
 for(const key of ['OATS_HOME','OATS_AGENT','OATS_INSTANCE','OATS_CONTEXT','OATS_RESOLUTION','OATS_CAPABILITY','OATS_EVENT'])assert.throws(()=>action(f,{...f.env,[key]:'foreign'}),invalid);
 f.context.intent=null;f.save();assert.throws(()=>action(f),{code:'authorization-required'});
});
test('each native boundary revalidates original files and directories; matching JSON cannot replace custody',t=>{
 for(const replace of ['binding','home']){
  const f=fixture(t),selected=action(f);selected.assertCurrent();
  if(replace==='binding'){fs.renameSync(f.env.OATS_BINDING_FILE,f.env.OATS_BINDING_FILE+'.old');fs.writeFileSync(f.env.OATS_BINDING_FILE,JSON.stringify(f.binding),{mode:0o600});}
  else{fs.renameSync(f.home,f.home+'.old');fs.mkdirSync(f.work,{recursive:true});}
  let calls=0;assert.throws(()=>{selected.assertCurrent();calls++;},invalid);assert.equal(calls,0);
 }
});
test('open redirection and a named replacement between read chunks refuse before reading foreign bytes',t=>{
 const f=fixture(t),p=f.env.OATS_BINDING_FILE,foreign=p+'.foreign';fs.writeFileSync(foreign,JSON.stringify(f.binding),{mode:0o600});
 const open=fs.openSync,read=fs.readSync;let foreignFD,foreignReads=0;
 try{
  fs.openSync=function(path,...args){const fd=Reflect.apply(open,fs,[path===p?foreign:path,...args]);if(path===p)foreignFD=fd;return fd;};
  fs.readSync=function(fd,...args){if(fd===foreignFD)foreignReads++;return Reflect.apply(read,fs,[fd,...args]);};
  assert.throws(()=>loadCapturedAwebExecution(f.env),invalid);assert.equal(foreignReads,0);
 }finally{fs.openSync=open;fs.readSync=read;}
 let selectedFD,reads=0;
 try{
  fs.openSync=function(path,...args){const fd=Reflect.apply(open,fs,[path,...args]);if(path===p)selectedFD=fd;return fd;};
  fs.readSync=function(fd,buffer,offset,length,position){if(fd!==selectedFD)return Reflect.apply(read,fs,[fd,buffer,offset,length,position]);reads++;const n=Reflect.apply(read,fs,[fd,buffer,offset,1,position]);fs.renameSync(p,p+'.old');fs.renameSync(foreign,p);return n;};
  assert.throws(()=>loadCapturedAwebExecution(f.env),invalid);assert.equal(reads,1);
 }finally{fs.openSync=open;fs.readSync=read;}
});
test('current kernel private snapshot writers couple with the provider consumer without new transport/schema',async t=>{
 const root=process.env.OATS_P1_FRAMEWORK_ROOT;if(!root){t.skip('requires explicitly pinned framework source');return;}
 const f=fixture(t),{withCapturedBindingFile}=await import(pathToFileURL(join(root,'lib/captured-binding-file.mjs'))),{withCapturedInvocationContextFile}=await import(pathToFileURL(join(root,'lib/captured-invocation-context.mjs')));
 withCapturedInvocationContextFile(f.context,inv=>withCapturedBindingFile({deployment:f.root,record:{bindings:{messaging:f.binding}},capability:{id:'oats.aweb'}},bound=>{
  const env={...inv,...bound};assert.notEqual(env.OATS_BINDING_FILE,env.OATS_INVOCATION_CONTEXT_FILE);action(f,env).assertCurrent();
 }));
});
