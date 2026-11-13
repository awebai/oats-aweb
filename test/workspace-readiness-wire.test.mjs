// The binding wire's live check: the workspace readiness phase `oats readiness` asks
// (context kind workspace, action readiness), its bounded input, and the manifest it is
// declared in. No aweb service, SDK, backend, identity enrollment, or current operator
// profile/credential reads. The captured bindings are removed (awebai/oats-aweb#242;
// test/captured-removed-242.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseBindingJson} from '../oats-package/capabilities/oats-aweb/lib/binding-wire.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),cap=join(root,'oats-package/capabilities/oats-aweb');
const declaredReasons=new Set(JSON.parse(fs.readFileSync(join(cap,'oats.json'))).binding.reasons);
const team={provider:'oats.aweb',id:'private-pilot:example.invalid'};
const request=(phase,input,settings={delivery:'session'})=>({schemaVersion:1,phase,slot:'messaging',capability:'oats.aweb',settings,input});
// Soul-scope readiness reads the host wake daemon once when the spawn will need
// it (delivery: session; oats.aweb 1.28.0, awebai/oats#1224): every fake aw
// answers that read with a running daemon and counts it in <base>/wake-called;
// any other native call still trips the marker.
const WAKE_STATUS='{"daemon_running":true,"daemon_pid":4242,"daemon_version":"1.36.33","daemon_version_state":"reported","instances":[]}';
const shWake=base=>`if [ "$1" = "wake" ] && [ "$2" = "status" ]; then printf x >> '${join(base,'wake-called')}'; echo '${WAKE_STATUS}'; exit 0; fi\n`;
const jsWake=base=>`if(process.argv[2]==='wake'&&process.argv[3]==='status'){require('node:fs').appendFileSync(${JSON.stringify(join(base,'wake-called'))},'x');console.log(${JSON.stringify(WAKE_STATUS)});process.exit(0);}\n`;
const wakeReads=f=>{try{return fs.readFileSync(join(f.base,'wake-called'),'utf8').length;}catch{return 0;}};
function fixture(t){const base=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'aweb-portable-profile-')));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const bin=join(base,'bin'),home=join(base,'home'),root=join(base,'root');fs.mkdirSync(bin);fs.mkdirSync(home);fs.mkdirSync(join(root,'.aw'),{recursive:true});const marker=join(base,'native-called');fs.writeFileSync(join(bin,'aw'),`#!/bin/sh\nif [ "$1" = "version" ]; then echo "aw 1.36.33"; exit 0; fi\n${shWake(base)}printf called >> '${marker}'\nexit 99\n`,{mode:0o755});return{base,home,root,marker,env:{HOME:home,PATH:bin,OATS_DEFAULT_TEAM:'private',OATS_DEFAULT_TEAM_ID:team.id,OATS_DEFAULT_TEAM_FROM:'deployment',OATS_TEAMS:JSON.stringify([{label:'private',team:team.id,default:true,from:'local'}])}};}
function noAwPath(f){const p=join(f.base,'no-aw');fs.mkdirSync(p,{recursive:true});return p;}
const reviewedDynamicHostReadiness=message=>message==='no teams configured: run `oats aweb setup`'||/^no messaging root at \/.*: run oats aweb setup there or set settings\.oats\.aweb\.root$/.test(message)||/^aw CLI not on PATH; install aw >= 1\.36\.33 with `npm i -g @awebai\/aw@latest` \(or `npm i -g @awebai\/aw@1\.36\.33`\)$/.test(message)||/^aw version could not be read; install aw >= 1\.36\.33 with `npm i -g @awebai\/aw@latest` \(or `npm i -g @awebai\/aw@1\.36\.33`\)$/.test(message)||/^aw \d+\.\d+\.\d+ is older than required 1\.36\.33; upgrade with `npm i -g @awebai\/aw@latest` \(or `npm i -g @awebai\/aw@1\.36\.33`\)$/.test(message)||/^custody preflight failed for .*: status=/.test(message)||/^identity\.mode "global" resident /.test(message)||/^identity\.mode "global" requires identity\.resident/.test(message)||/^host wake daemon version is unknown; compatibility unproven; required 1\.36\.13; upgrade aw, then restart the host wake daemon$/.test(message)||message==='E2E encryption is disabled for this grant and custody encryption is not ready; encrypted mail/chat will not be available in this session.';
function invoke(f,phase,value,extraEnv={}){const r=spawnSync(process.execPath,[join(cap,'bin/oats-aweb-binding.mjs'),phase],{env:{...f.env,...extraEnv},cwd:f.base,input:Buffer.isBuffer(value)?value:JSON.stringify(value),encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024});assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');const response=JSON.parse(r.stdout);for(const message of [response.error?.message,...(response.result?.problems??[]).map(p=>p.message),...(response.result?.warnings??[]).map(p=>p.message)].filter(v=>v!==undefined))assert.ok(declaredReasons.has(message)||reviewedDynamicHostReadiness(message),'fixed reasons must be declared; host-readiness problems may name the configured root: '+message);return{bytes:Buffer.from(r.stdout),value:response};}

test('binding-less workspace readiness check follows settings roots, team labels and read-only custody',t=>{
 const f=fixture(t),workspaceContext={kind:'workspace',workspace:'fixture-workspace',deployment:f.root,soul:'example',team:'experts',instance:null,home:null},action={kind:'readiness'};
 let checked=invoke(f,'check',request('check',{context:workspaceContext,action},{delivery:'session',root:f.root}));
 assert.deepEqual(checked.value.result,{status:'ready',problems:[],warnings:[]});assert.equal(fs.existsSync(f.marker),false);assert.equal(wakeReads(f),1,'one wake status read, nothing else native');
 checked=invoke(f,'check',request('check',{context:workspaceContext,action},{delivery:'channel',root:f.root}));
 assert.deepEqual(checked.value.result,{status:'ready',problems:[],warnings:[]});assert.equal(wakeReads(f),1,'a channel spawn with no join needs no broker read');
 checked=invoke(f,'check',request('check',{context:workspaceContext,action},{delivery:'session',root:f.root}),{PATH:noAwPath(f)});
 assert.deepEqual(checked.value.result,{status:'needs-configuration',problems:[{code:'needs-configuration',message:'aw CLI not on PATH; install aw >= 1.36.33 with `npm i -g @awebai/aw@latest` (or `npm i -g @awebai/aw@1.36.33`)'}],warnings:[]});
 fs.writeFileSync(join(f.base,'bin','aw'),`#!/bin/sh\nif [ "$1" = "version" ]; then exit 42; fi\nexit 99\n`,{mode:0o755});
 checked=invoke(f,'check',request('check',{context:workspaceContext,action},{delivery:'session',root:f.root}));
 assert.deepEqual(checked.value.result,{status:'needs-configuration',problems:[{code:'needs-configuration',message:'aw version could not be read; install aw >= 1.36.33 with `npm i -g @awebai/aw@latest` (or `npm i -g @awebai/aw@1.36.33`)'}],warnings:[]});
 fs.writeFileSync(join(f.base,'bin','aw'),`#!/bin/sh\nif [ "$1" = "version" ]; then echo "aw 1.36.12"; exit 0; fi\nexit 99\n`,{mode:0o755});
 checked=invoke(f,'check',request('check',{context:workspaceContext,action},{delivery:'session',root:f.root}));
 assert.deepEqual(checked.value.result,{status:'needs-configuration',problems:[{code:'needs-configuration',message:'aw 1.36.12 is older than required 1.36.33; upgrade with `npm i -g @awebai/aw@latest` (or `npm i -g @awebai/aw@1.36.33`)'}],warnings:[]});
 fs.writeFileSync(join(f.base,'bin','aw'),`#!/bin/sh\nif [ "$1" = "version" ]; then echo "aw 1.36.33"; exit 0; fi\n${shWake(f.base)}printf called >> '${f.marker}'\nexit 99\n`,{mode:0o755});
 checked=invoke(f,'check',request('check',{context:{...workspaceContext,team:null},action},{delivery:'session',root:f.root}));
 assert.deepEqual(checked.value.result,{status:'ready',problems:[],warnings:[]},'a teamless soul context is valid and settings/team env still drive readiness');
 const absent=join(f.base,'absent-deployment');fs.mkdirSync(absent);
 checked=invoke(f,'check',request('check',{context:{...workspaceContext,deployment:absent},action},{delivery:'session'}));
 assert.deepEqual(checked.value.result,{status:'needs-configuration',problems:[{code:'needs-configuration',message:`no messaging root at ${absent}: run oats aweb setup there or set settings.oats.aweb.root`}],warnings:[]});
 checked=invoke(f,'check',request('check',{context:workspaceContext,action},{delivery:'session',root:f.root}),{OATS_TEAM_LABEL:'experts'});
 assert.deepEqual(checked.value.result,{status:'ready',problems:[],warnings:[]});
 const custody=join(f.base,'custody');fs.mkdirSync(join(custody,'.aw'),{recursive:true});fs.writeFileSync(join(custody,'.aw','identity.yaml'),'alias: resident\n');
 fs.writeFileSync(join(f.base,'bin','aw'),`#!${process.execPath}\n${jsWake(f.base)}const args=process.argv.slice(2);\nif(args[0]==='version'){console.log('aw 1.36.33');process.exit(0);}\nconst status=process.env.FAKE_CUSTODY_STATUS||'running';\nconst encryptionReady=process.env.FAKE_ENCRYPTION_READY!=='0';\nconsole.log(JSON.stringify({status,teams:[{team_id:'${team.id}',ready:true,certificate_present:true,grant_status_endpoint_ready:true}],keys:{signing_ready:true,encryption_ready:encryptionReady},ops:['status.v1','sign_plain_message.v1','sign_app_request.v1','grant_never_ttl.v1','create_e2ee_envelope.v1','unwrap_e2ee_message.v1','mail_reply_continuation.v1'],errors:status==='running'?[]:['custody_unavailable']}));\n`,{mode:0o755});
 checked=invoke(f,'check',request('check',{context:workspaceContext,action},{delivery:'session',root:f.root,identity:{mode:'global',resident:'merlin'},residents:{merlin:custody}}),{FAKE_CUSTODY_STATUS:'not_running'});
 assert.equal(checked.value.result.status,'needs-configuration');assert.deepEqual(checked.value.result.problems.map(p=>p.code),['custody']);assert.match(checked.value.result.problems[0].message,/custody preflight failed for merlin: status=not_running error=custody_unavailable/);assert.deepEqual(checked.value.result.warnings,[]);
 checked=invoke(f,'check',request('check',{context:workspaceContext,action},{delivery:'session',root:f.root,identity:{mode:'global',resident:'merlin',e2ee:false},residents:{merlin:custody}}),{FAKE_ENCRYPTION_READY:'0'});
 assert.deepEqual(checked.value.result,{status:'ready',problems:[],warnings:[{code:'e2ee-disabled',message:'E2E encryption is disabled for this grant and custody encryption is not ready; encrypted mail/chat will not be available in this session.'}]});
 assert.equal(invoke(f,'check',request('check',{context:{...workspaceContext,kind:'foreign'},action},{delivery:'session',root:f.root})).value.ok,false);
});

test('in a deployment with no .aw, a global seat with a resident needs no minting root; local mode and a global seat without a resident still do',t=>{
 // A deployment that holds only residents, as resident create makes it. The
 // resident's identity, aw's version and its custody status are the real aw
 // 1.36.33 captures in test/fixtures/resident, so the team is the captured one.
 const f=fixture(t),deployment=join(f.base,'residents-only');fs.mkdirSync(deployment);
 const custody=join(f.base,'custody');fs.mkdirSync(join(custody,'.aw'),{recursive:true});fs.copyFileSync(join(root,'test/fixtures/resident/identity-global.yaml'),join(custody,'.aw','identity.yaml'));
 const captured=name=>JSON.stringify(join(root,'test/fixtures/resident',name));
 fs.writeFileSync(join(f.base,'bin','aw'),`#!${process.execPath}\n${jsWake(f.base)}const {readFileSync}=require('node:fs');\nprocess.stdout.write(readFileSync(process.argv[2]==='version'?${captured('aw-version.txt')}:${captured('custody-status-running.stdout')}));\n`,{mode:0o755});
 const capturedTeam='default:fixture-6400.test',env={OATS_DEFAULT_TEAM_ID:capturedTeam,OATS_TEAMS:JSON.stringify([{label:'private',team:capturedTeam,default:true,from:'local'}])};
 const noRoot={code:'needs-configuration',message:`no messaging root at ${deployment}: run oats aweb setup there or set settings.oats.aweb.root`};
 const noResident={code:'custody',message:'identity.mode "global" requires identity.resident; set oats-local.yaml settings.oats.aweb.residents.<name> to the absolute custody directory for that resident identity'};
 const global={delivery:'session',identity:{mode:'global',resident:'merlin'},residents:{merlin:custody}},local={delivery:'session',residents:{merlin:custody}},residentless={delivery:'session',identity:{mode:'global'},residents:{merlin:custody}};
 // The workspace readiness phase, as `oats readiness` asks it for the deployment.
 const workspace=settings=>invoke(f,'check',request('check',{context:{kind:'workspace',workspace:'fixture-workspace',deployment,soul:'example',team:null,instance:null,home:null},action:{kind:'readiness'}},settings),env).value.result;
 assert.deepEqual(workspace(global),{status:'ready',problems:[],warnings:[]});
 assert.deepEqual(workspace(local),{status:'needs-configuration',problems:[noRoot],warnings:[]});
 assert.deepEqual(workspace(residentless),{status:'needs-configuration',problems:[noRoot,noResident],warnings:[]});
});
test('malformed check input never supplies authority or a default context, and the wire parser stays bounded',t=>{
 const f=fixture(t),workspaceContext={kind:'workspace',workspace:'fixture-workspace',deployment:f.root,soul:'example',team:null,instance:null,home:null},action={kind:'readiness'};
 for(const settings of [{delivery:'none'},{delivery:'invalid'}])assert.equal(invoke(f,'check',request('check',{context:workspaceContext,action},{...settings,root:f.root})).value.ok,false);
 for(const bytes of [Buffer.from('{"schemaVersion":1,"schemaVersion":1}'),Buffer.from([0xff]),Buffer.from('{} trailing'),Buffer.alloc(1024*1024+1,32)])assert.equal(invoke(f,'check',bytes).value.ok,false);
 assert.throws(()=>parseBindingJson(Buffer.from('[[[[1]]]]'),{bytes:100,depth:3,entries:20}));
 assert.equal(fs.existsSync(f.marker),false);
});
test('manifest keeps required messaging and both delivery resource closures, with canonical codec commands',()=>{
 const m=JSON.parse(fs.readFileSync(join(cap,'oats.json')));assert.equal(m.layer,'messaging');assert.equal(m.hooks.spawn.required,true);assert.equal(m.settings.delivery.default,'channel');assert.deepEqual(m.settings.delivery.values,['channel','session']);assert.ok(m.requires.some(r=>r.command==='aw'));
 for(const runtime of ['pi','claude']){assert.ok(m.requires.some(r=>r.runtime===runtime&&r.when?.delivery==='channel'&&r.package));assert.ok(m.requires.some(r=>r.runtime===runtime&&r.when?.delivery==='session'&&r.ifInstalled===true&&r.minVersion));}
 const {keys,reasons,...phases}=m.binding;
 assert.deepEqual(phases,{version:1,normalize:'binding-normalize',bind:'binding-bind',check:'binding-check'});
 assert.deepEqual(keys,['responsibleHuman','privateTeam','wider']);
 assert.equal(reasons.length,6);assert.equal(new Set(reasons).size,6);assert.ok(reasons.every(reason=>typeof reason==='string'&&reason.length>0));
 assert.equal(m.compatibility.oats,'>=0.68.0');
 for(const key of ['root','roots','residents'])assert.equal(m.settings[key]?.hostOnly,true,`${key} is a host fact and must be rejected outside oats-local.yaml by kernels that enforce hostOnly`);
 assert.equal(Object.hasOwn(m,'helperInjection'),false);
 const distribution=JSON.parse(fs.readFileSync(join(root,'oats-package/oats-package.json'))),tooling=JSON.parse(fs.readFileSync(join(root,'package.json')));
 assert.equal(distribution.compatibility.oats,m.compatibility.oats);for(const value of [m,distribution,tooling])assert.equal(value.version,'1.42.1');
});
