// Execute the real kernel's launch-hook producer in disposable homes. aw is
// deliberately fake: this proves selected-target env and provider decisions,
// not live registration, delivery, or backend launch success.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {fakeAwWake} from './helpers/fake-aw-wake.mjs';
const kernel = process.env.OATS_PREVIEW_KERNEL_ROOT;
if (process.env.OATS_PREVIEW_KERNEL_REQUIRED === '1') assert.ok(kernel, 'required delivery test needs OATS_PREVIEW_KERNEL_ROOT');
const capability = fileURLToPath(new URL('../oats-package/capabilities/oats-aweb', import.meta.url));
const FLAG = '--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace';

for (const joined of [false,true]) test(`real kernel supplies Codex to preview/real hooks despite stale Claude recipe (joined=${joined})`, {skip:!kernel}, async t => {
  const {prepareLaunchHooks} = await import(pathToFileURL(join(kernel,'lib/core.mjs')));
  t.diagnostic(`kernel ${JSON.parse(readFileSync(join(kernel,'package.json'))).version}; fake aw only`);
  const fake = fakeAwWake(t);
  const base = realpathSync(mkdtempSync(join(tmpdir(),'kernel-codex-delivery-')));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const home = join(base,'agents','dev','instances','fixture');
  mkdirSync(join(home,'.aw'),{recursive:true});
  mkdirSync(join(home,'.oats-aweb'),{recursive:true});
  const joinedTeams = joined ? [{label:'alpha',team:'alpha:example.invalid',identityHome:join(home,'.aweb-identity-alpha'),receive:'native'}] : [];
  for (const j of joinedTeams) mkdirSync(j.identityHome);
  writeFileSync(join(home,'.oats-aweb','teams.json'),JSON.stringify({joinedTeams}));
  cpSync(capability,join(home,'.oats','modules','oats.aweb'),{recursive:true});
  const settings = {delivery:'channel',claudeChannelMode:'development',identity:{mode:'local'}};
  const previousMeta = {delivery:'channel',runtime:'claude',claudeChannelMode:'development',joinedTeams,identity:{mode:'local',team:'default:example.invalid'}};
  const meta = {instance:'fixture',agent:'dev',harness:'claude',modules:{'oats.aweb':{}},capabilityMeta:{'oats.aweb':previousMeta}};
  const frozen = {harness:'claude',launchConfig:'claude-aweb-native',hooks:{launch:{claude:FLAG},env:{},contributions:[{capability:'oats.aweb',layer:'messaging',settings,launch:{claude:FLAG},env:[]}]}};
  writeFileSync(join(home,'instance.json'),JSON.stringify({...meta,launch:frozen}));
  const old = {PATH:process.env.PATH,OATS_RUNTIME:process.env.OATS_RUNTIME,OATS_HARNESS:process.env.OATS_HARNESS};
  Object.assign(process.env,{PATH:fake.path,OATS_RUNTIME:'claude',OATS_HARNESS:'claude'});
  t.after(()=>{for(const [k,v] of Object.entries(old)) if(v===undefined)delete process.env[k];else process.env[k]=v;});
  // Do not supply any runtime in extraEnv: prepareLaunchHooks must supply it.
  const options = {frozen,harness:'codex',home,meta,contextDir:base};
  const before = readFileSync(join(home,'instance.json'),'utf8');
  const preview = prepareLaunchHooks({...options,pass:'preview'});
  assert.deepEqual(fake.readCalls(),[],'preview never invokes aw');
  assert.deepEqual(preview.launch,{});
  assert.equal(preview.env.AWEB_DELIVERY,'session');
  assert.equal(preview.meta,undefined);
  const planned = prepareLaunchHooks({...options,pass:'plan'});
  assert.deepEqual(fake.readCalls(),[],'start preflight is also read-only');
  const real = prepareLaunchHooks({...options,frozen:{...frozen,hooks:planned},pass:'real'});
  assert.deepEqual(real.launch,preview.launch);
  assert.deepEqual(real.env,preview.env);
  assert.equal(real.meta['oats.aweb'].runtime,'codex');
  assert.equal(real.meta['oats.aweb'].claudeChannelMode,undefined);
  const reg = fake.registrations()[home];
  assert.equal(reg.delivery,'session');
  assert.equal(reg.identity_home,join(home,'.aw'));
  if(joined){
    assert.equal(reg.runtime_delivery,'external-session');
    assert.deepEqual(reg.receive_identities.map(r=>r.identity_home),[join(home,'.aw'),joinedTeams[0].identityHome]);
    assert.equal(reg.receive_identities[0].controls,true);
  }
  assert.ok(fake.readCalls().some(c=>c.args[0]==='wake'&&c.args[1]==='register'));
  assert.equal(fake.readCalls().some(c=>c.args[1]==='deregister'),false);
  assert.equal(readFileSync(join(home,'instance.json'),'utf8'),before,'hook results are prospective; only the kernel publishes a launch receipt');
});
