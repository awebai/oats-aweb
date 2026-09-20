// Inert coupling to an explicitly pinned real kernel export. Public prepare,
// approval/scaffold, broker and CLI only; no native setup/launch/auth/backend.
// The private invocation builder is used ONLY as the kernel's test producer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import cp,{execFileSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {querySelectedKernel,kernelMeetsHomeRouteFloor} from '../oats-package/capabilities/oats-aweb/lib/session-readiness.mjs';
const packageRoot=fileURLToPath(new URL('../oats-package',import.meta.url));
test('actual kernel enforces package floor or couples aweb codecs and retained runtime without a source-version rewrite',async t=>{
 const framework=process.env.OATS_S3_FRAMEWORK_ROOT;if(!framework){t.skip('requires explicitly pinned merged framework source');return;}
 const {prepareCapturedComposition,approveAvailableCapability,loadCapturedDispatch,scaffoldCapturedInstance,runCapturedProviderBinding,capabilityCompatibility}=await import(pathToFileURL(join(framework,'lib/core.mjs')));
 const {buildCapturedInvocationContext}=await import(pathToFileURL(join(framework,'lib/captured-invocation-context.mjs')));
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'aweb-public-producer-')));t.diagnostic('preserved fixture '+root);
 const repo=join(root,'source'),deployment=join(root,'deployment'),tools=join(root,'tools'),marker=join(root,'native-called');
 for(const p of [repo,deployment,tools])fs.mkdirSync(p);
 fs.writeFileSync(join(tools,'aw'),`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'forbidden');process.exit(99);`,{mode:0o700});
 const gitConfig=join(root,'gitconfig');fs.writeFileSync(gitConfig,'');
 const env={PATH:`${tools}:${dirname(process.execPath)}:/usr/bin:/bin`,HOME:root,GIT_CONFIG_GLOBAL:gitConfig,GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 t.after(()=>{for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const write=(p,v)=>{fs.mkdirSync(dirname(join(repo,p)),{recursive:true});fs.writeFileSync(join(repo,p),typeof v==='string'?v:JSON.stringify(v));};
 write('oats.yaml',{schemaVersion:1,exports:{souls:[{path:'agents/example',definition:'agents/example/soul.yaml'}]}});
 write('agents/example/soul.yaml',{schemaVersion:1,name:'example',work:'directory',teams:[],requires:{messaging:{capability:'oats.aweb',source:'repo:package',settings:{delivery:'session'}}}});
 write('agents/example/AGENTS.md','Controlled inert source. Never run a native tool.\n');fs.symlinkSync('AGENTS.md',join(repo,'agents/example/CLAUDE.md'));fs.cpSync(packageRoot,join(repo,'package'),{recursive:true});
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-C',repo,...args],{env,encoding:'utf8'}).trim();
 git('init','--quiet','--initial-branch=fixture');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','uploadpack.allowFilter','true');git('config','uploadpack.allowAnySHA1InWant','true');
 const source='git:https://example.invalid/aweb-public.git';git('config','--file',gitConfig,`url.${pathToFileURL(repo).href}.insteadOf`,source.slice(4));git('add','.');git('commit','--quiet','-m','controlled source');
 const input={deployment,source:{source,soul:'agents/example',revision:git('rev-parse','HEAD'),alias:'example'},standaloneContextKey:'explicit-fixture',operator:{policy:{},document:{kind:'operator',id:'fixture'},bindings:{responsibleHuman:{provider:'oats.aweb',id:'fixture-human'},privateTeam:{provider:'oats.aweb',id:'private:example.invalid'},wider:[]}}};
 const options={repositoryOptions:{environment:env,allowLocalGit:true}};
 const sourceVersion=JSON.parse(fs.readFileSync(join(framework,'package.json'))).version;
 const packageManifest=JSON.parse(fs.readFileSync(join(packageRoot,'oats-package.json')));
 const packageFloor=packageManifest.compatibility.oats;
 // Use the same public kernel compatibility rule as real preparation, not the
 // provider's lower underlying HOME/profile API floor or a second version parser.
 if(!capabilityCompatibility(packageManifest).compatible){
  let boundary;
  assert.throws(()=>prepareCapturedComposition(input,options),error=>{
   if(error.code==='incompatible-oats'&&error.message.includes(`requires OATS ${packageFloor}`)){boundary='package floor';return true;}
   // Old closed readers can reject the new manifest fields before the floor
   // comparison. Accept only these exact typed refusals, never arbitrary errors.
   if(error.code==='invalid-declaration'&&['unknown field at /binding/keys','unknown field at /binding/reasons'].includes(error.message)){boundary='closed binding-interface schema';return true;}
   return false;
  });
  assert.equal(fs.existsSync(marker),false);
  t.diagnostic(`actual kernel ${sourceVersion}: expected ${boundary} refusal before codecs/native effects; no compatible-version coupling claim`);
  return;
 }
 const pending=prepareCapturedComposition(input,options);
 assert.equal(pending.resolution,null,JSON.stringify(pending));assert.ok(pending.problems.some(p=>p.code==='approval-required'));
 approveAvailableCapability(deployment,pending.selections[0].artifactSet,'oats.aweb',{kind:'operator',document:{kind:'operator',id:'fixture-approval'},pointer:''});
 const launch={runtime:'claude',executable:process.execPath,args:[],env:{},model:'retained/model',yolo:false};
 // Preserve the real Claude session ifInstalled closure and its kernel hold.
 // Codex below is a separate explicit INERT observation fixture, not a pilot
 // runtime fallback or removal of the original provider requirements.
 assert.throws(()=>prepareCapturedComposition({...input,launch},options),error=>error.code==='needs-configuration'&&/runtime package requirements/.test(error.message));
 const prepared=prepareCapturedComposition({...input,launch:{...launch,runtime:'codex'}},options);
 assert.equal(prepared.status,'prepared',JSON.stringify(prepared));const noLaunch=prepareCapturedComposition(input,options);assert.equal(noLaunch.status,'prepared',JSON.stringify(noLaunch));
 const home=join(root,'example-1');scaffoldCapturedInstance({deployment,resolution:prepared.resolution,home,instance:'example-1'});
 const loaded=loadCapturedDispatch({deployment,resolution:prepared.resolution,action:{kind:'inspect'}}),capability=loaded.capabilities.get('oats.aweb');
 const invocation=buildCapturedInvocationContext({loaded:{...loaded,capability},action:{kind:'inspect'},instance:{home,work:join(home,'work'),name:'example-1',agent:'example'}});
 fs.renameSync(repo,repo+'-preserved');fs.writeFileSync(join(deployment,'oats-config.yaml'),'poisoned current runtime/model config');
 const cli=fs.realpathSync(join(framework,'bin/oats.mjs')),queryEnv={...env,OATS_CLI_BIN:cli,OATS_RUNTIME:'pi',OATS_MODEL:'wrong',OATS_DEPLOYMENT:'/wrong',OATS_RESOLUTION:'wrong'};
 const version=querySelectedKernel(['--version','--json'],{env:queryEnv});assert.equal(version.version,JSON.parse(fs.readFileSync(join(framework,'package.json'))).version);
 const observed=JSON.parse(JSON.stringify(querySelectedKernel(['inspect','--deployment',deployment,'--resolution',prepared.resolution.id,'--json'],{env:queryEnv})));
 assert.equal(observed.ok,true);assert.deepEqual(observed.result.resolution,JSON.parse(JSON.stringify(prepared.resolution)));assert.deepEqual(observed.result.launchSelection,{runtime:'codex',model:'retained/model'});
 assert.equal(querySelectedKernel(['inspect','--deployment',deployment,'--resolution',noLaunch.resolution.id,'--json'],{env:queryEnv}).result.launchSelection,null);
 const priorCli=process.env.OATS_CLI_BIN;process.env.OATS_CLI_BIN='/poison/not-the-selected-kernel';
 // Observe the real child's bytes/environment, without substituting execution
 // or response. Older kernel decoders deliberately omit free-text messages.
 const originalSpawn=cp.spawnSync;let observation,checked;
 cp.spawnSync=(...args)=>{const result=originalSpawn(...args);if(args[2]?.env?.OATS_CAPABILITY==='oats.aweb'&&args[1].at(-1)==='check')observation={cli:args[2].env.OATS_CLI_BIN,response:JSON.parse(result.stdout)};return result;};syncBuiltinESMExports();
 try{checked=runCapturedProviderBinding({deployment,artifacts:loaded.record.artifacts,capability:'oats.aweb',phase:'check',settings:capability.settings,input:{binding:loaded.record.bindings.messaging,context:loaded.record.context,action:{kind:'inspect'},invocation}});}finally{cp.spawnSync=originalSpawn;syncBuiltinESMExports();if(priorCli===undefined)delete process.env.OATS_CLI_BIN;else process.env.OATS_CLI_BIN=priorCli;}
 assert.equal(observation.cli,cli);assert.equal(observation.response.ok,true);
 // b92f0d07 deliberately still identifies as0.24.1 before release versioning.
 // Keep the real floor hold; do not rewrite package.json or fake a version probe.
 assert.equal(checked.status,kernelMeetsHomeRouteFloor(version.version)?'ready':'needs-configuration');
 if(checked.status!=='ready'){
  assert.equal(checked.problems[0].code,'needs-configuration');
  assert.match(observation.response.result.problems[0].message,/>=0\.24\.2/);
 }
 assert.equal(fs.existsSync(marker),false);assert.equal(fs.existsSync(join(home,'.aw')),false);
 t.diagnostic(`actual kernel version ${version.version}; provider status ${checked.status}; retained projection verified, no native dispatch`);
});
