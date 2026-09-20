// Pure policy fixtures for the public projection. These are NOT evidence of an
// installed0.24.2 kernel, native authority, broker or model qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {assessCapturedSessionReadiness,kernelMeetsHomeRouteFloor,kernelQueryEnvironment,querySelectedKernel} from '../oats-package/capabilities/oats-aweb/lib/session-readiness.mjs';
import {invocationFor} from './helpers/invocation-fixture.mjs';
const context={kind:'standalone',key:'controlled-fixture'};
const binding={schemaVersion:1,capability:'oats.aweb',payloadContract:'oats.aweb.messaging',payloadVersion:1,payload:{responsibleHuman:{provider:'oats.aweb',id:'explicit-fixture-human'},context,privateTeam:{provider:'oats.aweb',id:'private:example.invalid'},wider:[]},credentialRefs:{},provenance:[]};
const invocation=invocationFor({binding,context,action:{kind:'inspect'}}),input={binding,invocation,settings:{delivery:'session'}};
function assess({version='0.24.2',launchSelection={runtime:'claude',model:null},resolution=invocation.executionBinding.resolution,omit=false}={},value=input){
 const calls=[];const result=assessCapturedSessionReadiness(value,{query:args=>{calls.push(args);return args[0]==='--version'?{schemaVersion:1,name:'@awebai/oats',version}:{schemaVersion:1,ok:true,result:{resolution,...(omit?{}:{launchSelection})}};}});return{result,calls};
}
test('stable kernel floor and missing actual projection hold; a planned version is not availability',()=>{
 for(const value of ['0.24.0','0.24.1','0.23.99','0.24.2-rc.1','planned',null])assert.equal(kernelMeetsHomeRouteFloor(value),false);
 for(const value of ['0.24.2','0.25.0','1.0.0'])assert.equal(kernelMeetsHomeRouteFloor(value),true);
 const old=assess({version:'0.24.0'});assert.equal(old.result.status,'needs-configuration');assert.match(old.result.problems[0].message,/>=0\.24\.2/);assert.equal(old.calls.length,1);
 for(const change of [{omit:true},{launchSelection:null},{launchSelection:{runtime:'claude'}},{resolution:{schemaVersion:1,id:'sha256-'+'f'.repeat(64)}}])assert.equal(assess(change).result.status,'needs-configuration');
 assert.throws(()=>querySelectedKernel(['--version','--json'],{env:{}}),{code:'provider-unavailable'});
});
test('pinned Pi print holds even above floor; only exact ordinary retained profile passes this scoped policy',()=>{
 const pi=assess({launchSelection:{runtime:'pi',model:'explicit/model'}});assert.equal(pi.result.status,'needs-configuration');assert.match(pi.result.problems[0].message,/Pi strict print does not support session input/);assert.equal(pi.calls.length,2);
 for(const runtime of ['claude','codex']){
  const {result,calls}=assess({launchSelection:{runtime,model:null}});assert.deepEqual(result,{status:'ready',problems:[]});assert.deepEqual(calls[1],['inspect','--deployment',invocation.executionBinding.deployment,'--resolution',invocation.executionBinding.resolution.id,'--json']);
 }
 const channel=assess({}, {...input,settings:{delivery:'channel'}});assert.equal(channel.result.status,'needs-configuration');assert.equal(channel.calls.length,0);assert.equal(input.settings.delivery,'session');
 const noHome=assess({}, {...input,invocation:{...invocation,instance:null}});assert.equal(noHome.result.status,'needs-configuration');assert.equal(noHome.calls.length,0);
 const bad={...input,binding:{...binding,capability:'foreign.provider'}};assert.throws(()=>assess({},bad),{code:'invalid-binding'});
});
test('read-only kernel child retains normal native context while removing invoking instance selectors',()=>{
 const env={HOME:'/native/home',PI_CODING_AGENT_DIR:'/native/pi',NATIVE_AUTH_HELPER:'SYNTHETIC',GIT_CONFIG_GLOBAL:'/native/git',OATS_HOME_DIR:'/scope/data',OATS_DEPLOYMENT:'/wrong',OATS_RESOLUTION:'wrong',OATS_CLI_BIN:'/selected/kernel',OATS_BINDING_FILE:'/private/snapshot',PI_AGENT_HOME:'/wrong',PI_AGENTS_ROOT:'/wrong',OAS_CONTEXT:'/wrong'};
 const original={...env},clean=kernelQueryEnvironment(env);
 for(const key of ['HOME','PI_CODING_AGENT_DIR','NATIVE_AUTH_HELPER','GIT_CONFIG_GLOBAL','OATS_HOME_DIR'])assert.equal(clean[key],env[key]);
 for(const key of ['OATS_DEPLOYMENT','OATS_RESOLUTION','OATS_CLI_BIN','OATS_BINDING_FILE','PI_AGENT_HOME','PI_AGENTS_ROOT','OAS_CONTEXT'])assert.equal(Object.hasOwn(clean,key),false);
 assert.deepEqual(env,original);
});
