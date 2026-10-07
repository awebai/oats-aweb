// Actual generic kernel hostOnly contract, opt-in locally and REQUIRED in CI.
// Pinned source bb2ba8c9 (0.42.0); no claim about another installed kernel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {selectClaudeChannel} from '../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs';
const root=process.env.OATS_HOST_ONLY_KERNEL_ROOT;
if(process.env.OATS_HOST_ONLY_REQUIRED==='1') assert.ok(root,'required hostOnly test needs OATS_HOST_ONLY_KERNEL_ROOT');
const manifest=JSON.parse(readFileSync(new URL('../oats-package/capabilities/oats-aweb/oats.json',import.meta.url),'utf8'));
const kernel=root?await import(pathToFileURL(join(root,'lib/resolve.mjs'))):null;
const remoteModule=root?await import(pathToFileURL(join(root,'lib/remote.mjs'))):null;
if(root) assert.equal(JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version,'0.42.0');
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
test('real hostOnly omission keeps the provider development default', {skip:!root},async()=>{
  const {soul,discovery,options}=fixture();
  const result=await kernel.resolveSoul(discovery,soul,options);
  assert.equal(manifest.settings.claudeChannelMode.default,'development');
  assert.equal(result.payloads['oats.aweb'].claudeChannelMode,'development');
  assert.equal(selectClaudeChannel().mode,'development');
  assert.equal(selectClaudeChannel(result.payloads['oats.aweb'].claudeChannelMode).mode,'development');
});
