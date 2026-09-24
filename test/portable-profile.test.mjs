// New portable-provider boundary fixtures only: no aweb service, SDK, backend,
// identity enrollment, or current operator profile/credential reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseBindingJson} from '../oats-package/capabilities/oats-aweb/lib/binding-wire.mjs';
import {invocationFor} from './helpers/invocation-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),cap=join(root,'oats-package/capabilities/oats-aweb');
const declaredReasons=new Set(JSON.parse(fs.readFileSync(join(cap,'oats.json'))).binding.reasons);
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
function fixture(t){const base=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'aweb-portable-profile-')));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const bin=join(base,'bin'),home=join(base,'home'),root=join(base,'root');fs.mkdirSync(bin);fs.mkdirSync(home);fs.mkdirSync(join(root,'.aw'),{recursive:true});const marker=join(base,'native-called');fs.writeFileSync(join(bin,'aw'),`#!/bin/sh\nprintf called >> '${marker}'\nexit 99\n`,{mode:0o755});return{base,home,root,marker,env:{HOME:home,PATH:bin}};}
const reviewedDynamicHostReadiness=message=>message==='no team: set messaging.byTeam.<label>.team in the workspace file or settings.oats.aweb.team'||/^no messaging root at \/.*: run oats aweb setup there or set settings\.oats\.aweb\.root$/.test(message)||/^custody preflight failed for .*: status=/.test(message)||/^identity\.mode "global" resident /.test(message)||/^identity\.mode "global" requires identity\.resident/.test(message)||message==='E2E encryption is disabled for this grant and custody encryption is not ready; encrypted mail/chat will not be available in this session.';
function invoke(f,phase,value,extraEnv={}){const r=spawnSync(process.execPath,[join(cap,'bin/oats-aweb-binding.mjs'),phase],{env:{...f.env,...extraEnv},cwd:f.base,input:Buffer.isBuffer(value)?value:JSON.stringify(value),encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024});assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');const response=JSON.parse(r.stdout);for(const message of [response.error?.message,...(response.result?.problems??[]).map(p=>p.message),...(response.result?.warnings??[]).map(p=>p.message)].filter(v=>v!==undefined))assert.ok(declaredReasons.has(message)||reviewedDynamicHostReadiness(message),'fixed reasons must be declared; host-readiness problems may name the configured root');return{bytes:Buffer.from(r.stdout),value:response};}
const choose=candidates=>Object.fromEntries(candidates.map(c=>[c.key,{value:c.value,selectedBy:c.origin,constraints:[],considered:[{...c,disposition:'selected'}]}])); // UNIT data only; coupled case uses the real kernel solver.
function bind(f,ds=declarations){const n=request('normalize',{declarations:ds,context}),normalized=invoke(f,'normalize',n);assert.equal(normalized.value.ok,true);const b=request('bind',{context,model:normalized.value.result.model,choices:choose(normalized.value.result.candidates)}),bound=invoke(f,'bind',b);assert.equal(bound.value.ok,true);const {messagingChoice,...fields}=bound.value.result;return{n,normalized,b,bound,binding:{schemaVersion:1,capability:'oats.aweb',...fields},messagingChoice};}

test('portable declarations retain explicit session delivery, private context and wider consent without native probes',t=>{
 const f=fixture(t),p=bind(f);
 const full=structuredClone(declarations);Object.assign(full[0].value,{schemaVersion:1,name:'example',work:'directory',requires:{messaging:{capability:'oats.aweb',source:'repo:package'}}});Object.assign(full[2].value,{policy:{},document:operator.document});full[2].value.bindings.stores={otherProvider:'retained'};
 assert.deepEqual(bind(f,full).binding,p.binding,'whole kernel declarations and unrelated provider fields do not replace or invalidate messaging selections');
 assert.deepEqual(p.n.settings,{delivery:'session'});assert.deepEqual(p.binding.payload.responsibleHuman,human);assert.deepEqual(p.binding.payload.privateTeam,team);assert.deepEqual(p.binding.payload.wider,[]);assert.deepEqual(p.binding.payload.context,{kind:'workspace',identity:context.identity});assert.deepEqual(p.binding.credentialRefs,{});assert.equal(p.messagingChoice.enabled,true);
 const unconfigured=invoke(f,'check',request('check',{binding:p.binding,context,action:{kind:'inspect'}}));assert.deepEqual(unconfigured.value.result,{status:'needs-configuration',problems:[{code:'needs-configuration',message:`no messaging root at ${f.base}: run oats aweb setup there or set settings.oats.aweb.root`},{code:'needs-configuration',message:'no team: set messaging.byTeam.<label>.team in the workspace file or settings.oats.aweb.team'}]},'host readiness problems are reported before captured invocation is required');
 const checked=invoke(f,'check',request('check',{binding:p.binding,context,action:{kind:'inspect'}},{delivery:'session',root:f.root,team:team.id}));assert.deepEqual(checked.value.result,{status:'ready',problems:[]},'configured host readiness is ready without inline invocation for inspect');assert.equal(fs.existsSync(f.marker),false);
 const missing=structuredClone(declarations);delete missing[2].value.bindings.privateTeam;const partial=bind(f,missing);assert.deepEqual(invoke(f,'check',request('check',{binding:partial.binding,context,action:{kind:'inspect'}},{delivery:'session',root:f.root,team:team.id})).value.result,{status:'needs-configuration',problems:[{code:'needs-configuration',message:'an explicit private-team binding is required'}]},'missing private-team binding remains a structural problem before host readiness');
});
test('binding-less workspace readiness check follows settings roots, team labels and read-only custody',t=>{
 const f=fixture(t),workspaceContext={kind:'workspace',workspace:'fixture-workspace',deployment:f.root,soul:'example',team:'experts',instance:null,home:null},action={kind:'readiness'};
 let checked=invoke(f,'check',request('check',{context:workspaceContext,action},{delivery:'session',root:f.root,team:team.id}));
 assert.deepEqual(checked.value.result,{status:'ready',problems:[],warnings:[]});assert.equal(fs.existsSync(f.marker),false);
 const absent=join(f.base,'absent-deployment');fs.mkdirSync(absent);
 checked=invoke(f,'check',request('check',{context:{...workspaceContext,deployment:absent},action},{delivery:'session'}));
 assert.deepEqual(checked.value.result,{status:'needs-configuration',problems:[{code:'needs-configuration',message:`no messaging root at ${absent}: run oats aweb setup there or set settings.oats.aweb.root`},{code:'needs-configuration',message:'no team: set messaging.byTeam.<label>.team in the workspace file or settings.oats.aweb.team'}],warnings:[]});
 checked=invoke(f,'check',request('check',{context:workspaceContext,action},{delivery:'session',root:f.root}),{OATS_TEAM_LABEL:'experts'});
 assert.deepEqual(checked.value.result,{status:'needs-configuration',problems:[{code:'needs-configuration',message:'no team: set messaging.byTeam.<label>.team in the workspace file or settings.oats.aweb.team'}],warnings:[]});
 const custody=join(f.base,'custody');fs.mkdirSync(join(custody,'.aw'),{recursive:true});fs.writeFileSync(join(custody,'.aw','identity.yaml'),'alias: resident\n');
 fs.writeFileSync(join(f.base,'bin','aw'),`#!${process.execPath}\nconst status=process.env.FAKE_CUSTODY_STATUS||'running';\nconst encryptionReady=process.env.FAKE_ENCRYPTION_READY!=='0';\nconsole.log(JSON.stringify({status,teams:[{team_id:'${team.id}',ready:true,certificate_present:true,grant_status_endpoint_ready:true}],keys:{signing_ready:true,encryption_ready:encryptionReady},ops:['sign_plain_message.v1','create_e2ee_envelope.v1','unwrap_e2ee_message.v1'],errors:status==='running'?[]:['custody_unavailable']}));\n`,{mode:0o755});
 checked=invoke(f,'check',request('check',{context:workspaceContext,action},{delivery:'session',root:f.root,team:team.id,identity:{mode:'global',resident:'merlin'},residents:{merlin:custody}}),{FAKE_CUSTODY_STATUS:'not_running'});
 assert.equal(checked.value.result.status,'needs-configuration');assert.deepEqual(checked.value.result.problems.map(p=>p.code),['custody']);assert.match(checked.value.result.problems[0].message,/custody preflight failed for merlin: status=not_running error=custody_unavailable/);assert.deepEqual(checked.value.result.warnings,[]);
 checked=invoke(f,'check',request('check',{context:workspaceContext,action},{delivery:'session',root:f.root,team:team.id,identity:{mode:'global',resident:'merlin',e2ee:false},residents:{merlin:custody}}),{FAKE_ENCRYPTION_READY:'0'});
 assert.deepEqual(checked.value.result,{status:'ready',problems:[],warnings:[{code:'e2ee-disabled',message:'E2E encryption is disabled for this grant and custody encryption is not ready; encrypted mail/chat will not be available in this session.'}]});
 assert.equal(invoke(f,'check',request('check',{context:{...workspaceContext,kind:'foreign'},action},{delivery:'session',root:f.root,team:team.id})).value.ok,false);
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
 assert.deepEqual(invoke(f,'check',request('check',input,{delivery:'session',root:f.root,team:team.id})).value.result,{status:'needs-configuration',problems:[{code:'needs-configuration',message:'an admitted captured instance intent is required for execution'}]});
 invocation.intent={schemaVersion:1,executionId:'controlled-fixture',incarnationId:invocation.instance.incarnationId,attempt:1};invocation.priorReceipt={canSetup:true,state:'configured'};
 assert.deepEqual(invoke(f,'check',request('check',input,{delivery:'session',root:f.root,team:team.id})).value.result,{status:'needs-configuration',problems:[{code:'needs-configuration',message:'caller-owned OATS_CLI_BIN and readable kernel version are required'}]});
 for(const change of [{responsibleHuman:{provider:'oats.aweb',id:'foreign'}},{action:{...action,name:'other'}},{context:{kind:'standalone',key:'foreign'}},{capability:'oats.okf'}])assert.equal(invoke(f,'check',request('check',{...input,invocation:{...invocation,...change}})).value.ok,false);
 assert.equal(fs.existsSync(f.marker),false);
});
test('all captured native entrypoints refuse before ambient lookup/enrollment/wake even with invalid-present pointers',t=>{
 const f=fixture(t);
 for(const action of ['spawn','retire','setup','roster'])for(const marker of ['OATS_BINDING_FILE','OATS_INVOCATION_CONTEXT_FILE','OATS_SOURCE_RECEIPT_FILE']){
  const r=spawnSync(process.execPath,[join(cap,'bin/oats-aweb.mjs'),action],{env:{...f.env,OATS_SETTINGS:'{"delivery":"session"}',[marker]:'/must-not-read/private-fixture',OATS_TEAM_ID:'must-not-borrow:example.invalid'},cwd:f.home,encoding:'utf8',timeout:10000});
  assert.equal(r.status,1);assert.match(JSON.parse(r.stdout).warning,/invalid or changed captured aweb execution input/);assert.doesNotMatch(r.stdout+r.stderr,/must-not-read|must-not-borrow/);assert.equal(fs.existsSync(f.marker),false);
 }
 const legacy=spawnSync(process.execPath,[join(cap,'bin/oats-aweb.mjs'),'retire'],{env:{...f.env,OATS_META:'{}'},cwd:f.home,encoding:'utf8',timeout:10000});assert.equal(legacy.status,0,legacy.stderr);assert.equal(JSON.parse(legacy.stdout).meta.reason,'nothing-to-delete');assert.equal(fs.existsSync(f.marker),false);
});
test('normalize and bind errors name fixed missing items without reflecting aliases, keys or input text',t=>{
 const f=fixture(t),secret='SYNTHETIC_PRIVATE_ALIAS';
 const expect=(phase,input,code,message)=>{
  const result=invoke(f,phase,request(phase,input));assert.equal(result.value.ok,false);
  assert.deepEqual(result.value.error,{code,message});assert.doesNotMatch(result.bytes.toString(),/SYNTHETIC_PRIVATE_ALIAS/);
 };
 expect('normalize',{declarations:[],context},'needs-configuration','messaging binding needs one soul declaration');
 expect('normalize',{declarations,context:{kind:'standalone',key:null}},'needs-configuration','messaging-enabled standalone preparation needs an explicit context key');
 const noPolicy=structuredClone(declarations);delete noPolicy[1].value.teams.private;
 expect('normalize',{declarations:noPolicy,context},'needs-configuration','messaging workspace must declare private: per-human');
 const conflict=[...declarations,...['first','second'].map(target=>({kind:'adoption',value:{teamAliases:{[secret]:target}},origin:origin('import-adoption'),origins:{}}))];
 expect('normalize',{declarations:conflict,context},'requirement-conflict','adoption team aliases have conflicting mappings');
 const malformed=structuredClone(declarations);malformed[2].value.bindings.responsibleHuman[secret]='private-value';
 expect('normalize',{declarations:malformed,context},'invalid-binding','messaging input must match the supported binding contract');
 const p=bind(f);
 for(const [key,message] of [['/bindings/messaging/responsibleHuman','an explicit responsible-human binding is required'],['/bindings/messaging/wider','an explicit wider-membership consent list is required']]){
  const choices=structuredClone(p.b.input.choices);delete choices[key];expect('bind',{context,model:p.b.input.model,choices},'needs-configuration',message);
 }
 const ds=structuredClone(declarations);ds[0].value.teams=[secret];ds[2].value.bindings.wider=[secret];
 const normalized=invoke(f,'normalize',request('normalize',{declarations:ds,context})).value.result;
 expect('bind',{context,model:normalized.model,choices:choose(normalized.candidates)},'needs-configuration','a selected wider alias needs an explicit workspace team mapping');
 ds[1].value.teams[secret]={provider:'oats.aweb',id:'other:example.invalid'};
 const mapped=invoke(f,'normalize',request('normalize',{declarations:ds,context})).value.result,choices=choose(mapped.candidates);delete choices['/bindings/messaging/teams/'+secret];
 expect('bind',{context,model:mapped.model,choices},'needs-configuration','a selected wider-team binding is required');
 assert.equal(fs.existsSync(f.marker),false);
});
test('manifest keeps required messaging and both delivery resource closures, with canonical codec commands',()=>{
 const m=JSON.parse(fs.readFileSync(join(cap,'oats.json')));assert.equal(m.layer,'messaging');assert.equal(m.hooks.spawn.required,true);assert.equal(m.settings.delivery.default,'channel');assert.deepEqual(m.settings.delivery.values,['channel','session']);assert.ok(m.requires.some(r=>r.command==='aw'));
 for(const runtime of ['pi','claude']){assert.ok(m.requires.some(r=>r.runtime===runtime&&r.when?.delivery==='channel'&&r.package));assert.ok(m.requires.some(r=>r.runtime===runtime&&r.when?.delivery==='session'&&r.ifInstalled===true&&r.minVersion));}
 const {keys,reasons,...phases}=m.binding;
 assert.deepEqual(phases,{version:1,normalize:'binding-normalize',bind:'binding-bind',check:'binding-check'});
 assert.deepEqual(keys,['responsibleHuman','privateTeam','wider']);
 assert.equal(reasons.length,30);assert.equal(new Set(reasons).size,30);assert.ok(reasons.every(reason=>typeof reason==='string'&&reason.length>0));
 assert.equal(m.compatibility.oats,'>=0.25.6');
 for(const key of ['root','roots','residents'])assert.equal(m.settings[key]?.hostOnly,true,`${key} is a host fact and must be rejected outside oats-local.yaml by kernels that enforce hostOnly`);
 // A harvest helper has no messaging identity: the aweb briefing is omitted from helper compositions (second-operator finding, 2026-09-21).
 assert.deepEqual(m.helperInjection,{version:1,mode:'omit'});
 const distribution=JSON.parse(fs.readFileSync(join(root,'oats-package/oats-package.json'))),tooling=JSON.parse(fs.readFileSync(join(root,'package.json')));
 assert.equal(distribution.compatibility.oats,m.compatibility.oats);for(const value of [m,distribution,tooling])assert.equal(value.version,'1.13.0');
});
test('coupled current kernel wire and sole resolver accept actual codec output but do not turn binding into readiness',async t=>{
 const framework=process.env.OATS_P1_FRAMEWORK_ROOT;if(!framework){t.skip('requires explicitly pinned current framework source');return;}
 const f=fixture(t),wire=await import(pathToFileURL(join(framework,'lib/provider-binding-wire.mjs'))),{resolveChoices}=await import(pathToFileURL(join(framework,'lib/portable-choices.mjs')));
 const n=request('normalize',{declarations,context}),normalized=invoke(f,'normalize',n);const accepted=wire.decodeBindingResponse(normalized.bytes,n);assert.equal(accepted.ok,true);
 const selected=resolveChoices(accepted.result);assert.equal(selected.status,'resolved');
 const b=request('bind',{context,model:accepted.result.model,choices:selected.choices}),bound=invoke(f,'bind',b),decoded=wire.decodeBindingResponse(bound.bytes,b);assert.equal(decoded.ok,true);assert.deepEqual(decoded.result.messagingChoice.wider,[]);
 const c=request('check',{binding:decoded.result.binding,context,action:{kind:'inspect'}}),checked=invoke(f,'check',c);assert.deepEqual(wire.decodeBindingResponse(checked.bytes,c),{ok:true,result:{status:'needs-configuration',problems:[{code:'needs-configuration'}]}});
 assert.equal(fs.existsSync(f.marker),false);assert.equal(fs.existsSync(join(f.home,'.aw')),false);
});
