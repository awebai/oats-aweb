// Actual generic kernel hostOnly contract, opt-in locally and REQUIRED in CI.
// The OATS v0.68.1 release pin reports 0.68.1.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {selectClaudeChannel} from '../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs';
const PINNED_VERSION = '0.68.1';
const root=process.env.OATS_HOST_ONLY_KERNEL_ROOT;
if(process.env.OATS_HOST_ONLY_REQUIRED==='1') assert.ok(root,'required hostOnly test needs OATS_HOST_ONLY_KERNEL_ROOT');
const manifest=JSON.parse(readFileSync(new URL('../oats-package/capabilities/oats-aweb/oats.json',import.meta.url),'utf8'));
const kernel=root?await import(pathToFileURL(join(root,'lib/resolve.mjs'))):null;
const remoteModule=root?await import(pathToFileURL(join(root,'lib/remote.mjs'))):null;
if(root) assert.equal(JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version,PINNED_VERSION);
function fixture(){
  const key='github.com/example/fixture',commit='a'.repeat(40);
  const soul={name:'dev',repoKey:key,commit,path:'souls/dev',definition:{schemaVersion:2,name:'dev',work:'directory',capabilities:{'oats.aweb':{from:'here'}}}};
  const cap={name:'oats.aweb',repoKey:key,commit,path:'capabilities/oats-aweb',manifest,listing:manifest.skills.map(path=>({path:`${path}/SKILL.md`,type:'blob'}))};
  const discovery={key,workspace:{members:[`git:${key}`]},members:[{key,commit,confirmed:true,souls:[soul],capabilities:[cap]}]};
  const unexpected=()=>{throw new Error('unexpected remote operation in isolated hostOnly test');};
  const options={remote:{parseRepoRef:remoteModule.parseRepoRef,readRemoteFile:unexpected,listRemoteTree:unexpected}};
  return {soul,discovery,options};
}
for(const value of ['approved','development']) for(const layer of ['soul','workspace','spawn']) test(`real hostOnly rejects ${value} from ${layer}`,{skip:!root},async()=>{
  const {soul,discovery,options}=fixture();
  if(layer==='soul') soul.definition.messaging={claudeChannelMode:value};
  if(layer==='workspace') discovery.workspace.messaging={claudeChannelMode:value};
  if(layer==='spawn') options.spawn={providers:{'oats.aweb':{claudeChannelMode:value}}};
  await assert.rejects(kernel.resolveSoul(discovery,soul,options),error=>{
    assert.equal(error.code,'E_WORKSPACE_SCHEMA');
    assert.equal(error.details.reason,'host-only-key');
    assert.equal(error.details.key,'claudeChannelMode');
    assert.equal(error.details.capability,'oats.aweb');
    assert.equal(error.details.path,layer==='spawn'?'/spawn/providers/oats.aweb/claudeChannelMode':'/messaging/claudeChannelMode');
    assert.match(error.message,/oats-local.yaml/);
    return true;
  });
});
for(const value of ['approved','development']) test(`real hostOnly accepts host-local ${value} with host origin`,{skip:!root},async()=>{
  const {soul,discovery,options}=fixture();
  options.local={settings:{'oats.aweb':{claudeChannelMode:value}}};
  const result=await kernel.resolveSoul(discovery,soul,options);
  assert.equal(result.payloads['oats.aweb'].claudeChannelMode,value);
  assert.deepEqual(result.payloadOrigins['oats.aweb']['/claudeChannelMode'],{kind:'host',at:'oats-local.yaml#/settings/oats.aweb'});
});
// Human attribution is a per-deployment opt-in (spec C-1): a committed value
// or a spawn flag would opt every deployment of the workspace in.
const ATTRIBUTION={root:{id:'did:aw:root1',home:'/srv/deploy/.aweb-endorsed-root/acme-root'},human:{id:'did:aw:human1',label:'Juan'},service:{id:'svc-acme',profile:'/srv/deploy/profile.json',profileDigest:`sha256:${'b'.repeat(64)}`},teams:['backend:acme.example'],endorsement:{operationId:'3f2b8c1e-9d4a-4b6e-8f0a-1c2d3e4f5a6b',policy:{version:3,digest:`sha256:${'a'.repeat(64)}`}}};
for(const layer of ['soul','workspace','spawn']) test(`real hostOnly rejects attribution from ${layer}`,{skip:!root},async()=>{
  const {soul,discovery,options}=fixture();
  if(layer==='soul') soul.definition.messaging={attribution:ATTRIBUTION};
  if(layer==='workspace') discovery.workspace.messaging={attribution:ATTRIBUTION};
  if(layer==='spawn') options.spawn={providers:{'oats.aweb':{attribution:ATTRIBUTION}}};
  await assert.rejects(kernel.resolveSoul(discovery,soul,options),error=>{
    assert.equal(error.code,'E_WORKSPACE_SCHEMA');
    assert.equal(error.details.reason,'host-only-key');
    assert.equal(error.details.key,'attribution');
    assert.match(error.message,/oats-local.yaml/);
    return true;
  });
});
test('real hostOnly accepts host-local attribution with host origin',{skip:!root},async()=>{
  const {soul,discovery,options}=fixture();
  options.local={settings:{'oats.aweb':{attribution:ATTRIBUTION}}};
  const result=await kernel.resolveSoul(discovery,soul,options);
  assert.deepEqual(result.payloads['oats.aweb'].attribution,ATTRIBUTION);
  for(const leaf of ['/attribution/root/id','/attribution/human/label','/attribution/service/profileDigest','/attribution/teams','/attribution/endorsement/policy/version'])
    assert.deepEqual(result.payloadOrigins['oats.aweb'][leaf],{kind:'host',at:'oats-local.yaml#/settings/oats.aweb'},leaf);
});
test('real hostOnly omission keeps the provider development default', {skip:!root},async()=>{
  const {soul,discovery,options}=fixture();
  const result=await kernel.resolveSoul(discovery,soul,options);
  assert.equal(manifest.settings.claudeChannelMode.default,'development');
  assert.equal(result.payloads['oats.aweb'].claudeChannelMode,'development');
  assert.equal(selectClaudeChannel().mode,'development');
  assert.equal(selectClaudeChannel(result.payloads['oats.aweb'].claudeChannelMode).mode,'development');
});
