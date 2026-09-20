// New portable-provider boundary fixtures only: no aweb service, SDK, backend,
// identity enrollment, or current operator profile/credential reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {handleBindingRequest,parseBindingJson} from '../oats-package/capabilities/oats-aweb/lib/binding-wire.mjs';
import {invocationFor} from './helpers/invocation-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),cap=join(root,'oats-package/capabilities/oats-aweb');
const origin=(kind,path='soul.yaml')=>({kind,document:{kind:'source',source:'git:https://example.invalid/source.git',revision:'a'.repeat(40),path,integrity:{format:'oats.bytes.v1',value:'sha256-'+'b'.repeat(64)}},pointer:''});
const operator={kind:'operator',document:{kind:'operator',id:'fixture-operator'},pointer:''};
const context={kind:'workspace',identity:{repository:{kind:'canonical-remote',remote:'git:https://example.invalid/workspace.git'},path:'oats-workspace.yaml'},observation:origin('workspace-default','oats-workspace.yaml')};
const human={provider:'oats.aweb',id:'explicit-human'},team={provider:'oats.aweb',id:'private-pilot:example.invalid'};
const declarations=[
 {kind:'soul',value:{teams:['experts']},origin:origin('soul-requirement'),origins:{}},
 {kind:'workspace',value:{teams:{private:'per-human',experts:{provider:'oats.aweb',id:'experts:example.invalid'}}},origin:context.observation,origins:{}},
 {kind:'operator',value:{bindings:{responsibleHuman:human,privateTeam:team,wider:[]}},origin:operator,origins:{}}
];
const request=(phase,input,settings={delivery:'session'})=>({schemaVersion:1,phase,slot:'messaging',capability:'oats.aweb',settings,input});
function fixture(t){const base=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'aweb-portable-profile-')));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const bin=join(base,'bin'),home=join(base,'home');fs.mkdirSync(bin);fs.mkdirSync(home);const marker=join(base,'native-called');fs.writeFileSync(join(bin,'aw'),`#!/bin/sh\nprintf called >> '${marker}'\nexit 99\n`,{mode:0o755});return{base,home,marker,env:{HOME:home,PATH:bin}};}
function invoke(f,phase,value){const r=spawnSync(process.execPath,[join(cap,'bin/oats-aweb-binding.mjs'),phase],{env:f.env,cwd:f.base,input:Buffer.isBuffer(value)?value:JSON.stringify(value),encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024});assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');return{bytes:Buffer.from(r.stdout),value:JSON.parse(r.stdout)};}
const choose=candidates=>Object.fromEntries(candidates.map(c=>[c.key,{value:c.value,selectedBy:c.origin,constraints:[],considered:[{...c,disposition:'selected'}]}])); // UNIT data only; coupled case uses the real kernel solver.
function bind(f,ds=declarations){const n=request('normalize',{declarations:ds,context}),normalized=invoke(f,'normalize',n);assert.equal(normalized.value.ok,true);const b=request('bind',{context,model:normalized.value.result.model,choices:choose(normalized.value.result.candidates)}),bound=invoke(f,'bind',b);assert.equal(bound.value.ok,true);const {messagingChoice,...fields}=bound.value.result;return{n,normalized,b,bound,binding:{schemaVersion:1,capability:'oats.aweb',...fields},messagingChoice};}

test('portable declarations retain explicit session delivery, private context and wider consent without native probes',t=>{
 const f=fixture(t),p=bind(f);assert.deepEqual(p.n.settings,{delivery:'session'});assert.deepEqual(p.binding.payload.responsibleHuman,human);assert.deepEqual(p.binding.payload.privateTeam,team);assert.deepEqual(p.binding.payload.wider,[]);assert.deepEqual(p.binding.payload.context,{kind:'workspace',identity:context.identity});assert.deepEqual(p.binding.credentialRefs,{});assert.equal(p.messagingChoice.enabled,true);
 const checked=invoke(f,'check',request('check',{binding:p.binding,context,action:{kind:'inspect'}}));assert.deepEqual(checked.value.result,{status:'unavailable',problems:[{code:'provider-not-qualified'}]});assert.equal(fs.existsSync(f.marker),false);
 const missing=structuredClone(declarations);delete missing[2].value.bindings.privateTeam;const partial=bind(f,missing);assert.deepEqual(invoke(f,'check',request('check',{binding:partial.binding,context,action:{kind:'inspect'}})).value.result,{status:'needs-configuration',problems:[{code:'needs-configuration'}]});
});
test('malformed/unknown input never supplies authority, default context, identity copying or delivery downgrade',t=>{
 const f=fixture(t),base=request('normalize',{declarations,context});
 for(const settings of [{delivery:'none'},{delivery:'invalid'},{identity:{source:'/must-not-read/.aw'},delivery:'session'}])assert.equal(invoke(f,'normalize',{...base,settings}).value.ok,false);
 for(const bytes of [Buffer.from('{"schemaVersion":1,"schemaVersion":1}'),Buffer.from([0xff]),Buffer.from('{} trailing'),Buffer.alloc(1024*1024+1,32)])assert.equal(invoke(f,'normalize',bytes).value.ok,false);
 assert.throws(()=>parseBindingJson(Buffer.from('[[[[1]]]]'),{bytes:100,depth:3,entries:20}));
 const noHuman=structuredClone(declarations);delete noHuman[2].value.bindings.responsibleHuman;const n=invoke(f,'normalize',request('normalize',{declarations:noHuman,context}));assert.equal(n.value.ok,true);assert.equal(invoke(f,'bind',request('bind',{context,model:n.value.result.model,choices:choose(n.value.result.candidates)})).value.ok,false);
 assert.equal(invoke(f,'normalize',request('normalize',{declarations,context:{kind:'standalone',key:null}})).value.ok,false);assert.equal(fs.existsSync(f.marker),false);
});
test('inline invocation matches binding/action but shape, admission and supplied receipts do not prove native readiness',t=>{
 const f=fixture(t),p=bind(f),action={kind:'command',namespace:'aweb',name:'setup'};
 const invocation=invocationFor({binding:p.binding,context,action});
 const input={binding:p.binding,context,action,invocation};
 assert.deepEqual(handleBindingRequest('check',request('check',input)),{status:'needs-configuration',problems:[{code:'needs-configuration'}]});
 invocation.intent={schemaVersion:1,executionId:'controlled-fixture',incarnationId:invocation.instance.incarnationId,attempt:1};invocation.priorReceipt={canSetup:true,state:'configured'};
 assert.deepEqual(handleBindingRequest('check',request('check',input)),{status:'unavailable',problems:[{code:'provider-not-qualified'}]});
 for(const change of [{responsibleHuman:{provider:'oats.aweb',id:'foreign'}},{action:{...action,name:'other'}},{context:{kind:'standalone',key:'foreign'}},{capability:'oats.okf'}])assert.equal(invoke(f,'check',request('check',{...input,invocation:{...invocation,...change}})).value.ok,false);
 assert.equal(fs.existsSync(f.marker),false);
});
test('all captured native entrypoints refuse before ambient lookup/enrollment/wake even with invalid-present pointers',t=>{
 const f=fixture(t);
 for(const action of ['spawn','retire','setup','roster'])for(const marker of ['OATS_BINDING_FILE','OATS_INVOCATION_CONTEXT_FILE','OATS_SOURCE_RECEIPT_FILE']){
  const r=spawnSync(process.execPath,[join(cap,'bin/oats-aweb.mjs'),action],{env:{...f.env,OATS_SETTINGS:'{"delivery":"session"}',[marker]:'/must-not-read/private-fixture',OATS_TEAM_ID:'must-not-borrow:example.invalid'},cwd:f.home,encoding:'utf8',timeout:10000});
  assert.equal(r.status,1);assert.match(JSON.parse(r.stdout).warning,/captured messaging action is not qualified/);assert.doesNotMatch(r.stdout+r.stderr,/must-not-read|must-not-borrow/);assert.equal(fs.existsSync(f.marker),false);
 }
 const legacy=spawnSync(process.execPath,[join(cap,'bin/oats-aweb.mjs'),'retire'],{env:{...f.env,OATS_META:'{}'},cwd:f.home,encoding:'utf8',timeout:10000});assert.equal(legacy.status,0,legacy.stderr);assert.equal(JSON.parse(legacy.stdout).meta.reason,'nothing-to-delete');assert.equal(fs.existsSync(f.marker),false);
});
test('manifest keeps required messaging and both delivery resource closures, with canonical codec commands',()=>{
 const m=JSON.parse(fs.readFileSync(join(cap,'oats.json')));assert.equal(m.layer,'messaging');assert.equal(m.hooks.spawn.required,true);assert.equal(m.settings.delivery.default,'channel');assert.deepEqual(m.settings.delivery.values,['channel','session']);assert.ok(m.requires.some(r=>r.command==='aw'));
 for(const runtime of ['pi','claude']){assert.ok(m.requires.some(r=>r.runtime===runtime&&r.when?.delivery==='channel'&&r.package));assert.ok(m.requires.some(r=>r.runtime===runtime&&r.when?.delivery==='session'&&r.ifInstalled===true&&r.minVersion));}
 assert.deepEqual(m.binding,{version:1,normalize:'binding-normalize',bind:'binding-bind',check:'binding-check'});assert.equal(m.compatibility.oats,'>=0.24.0');
});
test('coupled current kernel wire and sole resolver accept actual codec output but do not turn binding into readiness',async t=>{
 const framework=process.env.OATS_P1_FRAMEWORK_ROOT;if(!framework){t.skip('requires explicitly pinned current framework source');return;}
 const f=fixture(t),wire=await import(pathToFileURL(join(framework,'lib/provider-binding-wire.mjs'))),{resolveChoices}=await import(pathToFileURL(join(framework,'lib/portable-choices.mjs')));
 const n=request('normalize',{declarations,context}),normalized=invoke(f,'normalize',n);const accepted=wire.decodeBindingResponse(normalized.bytes,n);assert.equal(accepted.ok,true);
 const selected=resolveChoices(accepted.result);assert.equal(selected.status,'resolved');
 const b=request('bind',{context,model:accepted.result.model,choices:selected.choices}),bound=invoke(f,'bind',b),decoded=wire.decodeBindingResponse(bound.bytes,b);assert.equal(decoded.ok,true);assert.deepEqual(decoded.result.messagingChoice.wider,[]);
 const c=request('check',{binding:decoded.result.binding,context,action:{kind:'inspect'}}),checked=invoke(f,'check',c);assert.deepEqual(wire.decodeBindingResponse(checked.bytes,c),{ok:true,result:{status:'unavailable',problems:[{code:'provider-not-qualified'}]}});
 assert.equal(fs.existsSync(f.marker),false);assert.equal(fs.existsSync(join(f.home,'.aw')),false);
});
