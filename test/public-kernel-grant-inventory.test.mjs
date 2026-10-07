// Public CLI projection over a disposable deployment; inert native grant only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {fakeAw} from './helpers/fake-aw-grant.mjs';
for (const old of [false,true]) test(`${old ? '0.42 omitted warning control' : '0.47 warning projection'}: public inspect persists actual spawn snapshot; public preview warns without mint or metadata write`,{timeout:120000},async t=>{
 const kernel=process.env[old ? "OATS_APP_INVENTORY_OLD_KERNEL_ROOT" : "OATS_APP_INVENTORY_KERNEL_ROOT"];
 if(!kernel){if(process.env.OATS_APP_INVENTORY_KERNEL_REQUIRED==='1')assert.fail('pinned kernel required');t.skip('requires 0.47.0 public kernel');return;}
 assert.equal(execFileSync('git',['-C',kernel,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),old ? 'bb2ba8c9a254edb745913b9c5a9d9b833fda932d' : 'e6e75ed8ba5a0a07a4b3e26fc627cac9064c730b');
 // The pinned helper creates disposable git/config inputs; all exercised
 // provider/kernel behavior below enters through CLI, not kernel internals.
 const {v2Deployment}=await import(pathToFileURL(join(kernel,'test/helpers/v2-deployment.mjs')));
 const base=mkdtempSync(join(tmpdir(),'grant-public-'));t.after(()=>rmSync(base,{recursive:true,force:true}));
 const bin=fakeAw(base),custody=join(base,'custody');mkdirSync(join(custody,'.aw'),{recursive:true});
 writeFileSync(join(custody,'.aw/identity.yaml'),'alias: resident-alias\n');
 const receipt=JSON.parse(readFileSync(new URL('./fixtures/grant-mint/catalog.json',import.meta.url),'utf8'));
 const fx=v2Deployment({souls:{probe:{soul:{capabilities:{'oats.aweb':{from:'here'}}}}},capabilityDirs:{'oats-aweb':fileURLToPath(new URL('../oats-package/capabilities/oats-aweb',import.meta.url))},workspace:{teams:{global:{team:'t:example.test'}},defaultTeam:'global'},local:{settings:{'oats.aweb':{identity:{mode:'global',resident:'merlin'},residents:{merlin:custody}}}}});
 t.after(()=>fx.cleanup());
 const env={PATH:`${bin}:${fx.env.PATH}`,FAKE_APP_INVENTORY:JSON.stringify({apps:receipt.apps,skipped_apps:receipt.skipped_apps})};
 let r=fx.cli(['spawn','probe','--name','inventory-probe','--no-launch','--harness','codex','--json'],{env});
 assert.equal(r.status,0,r.stdout+r.stderr);
 const home=join(fx.root,'probe','instances','inventory-probe');
 const record=readFileSync(join(home,'instance.json'),'utf8'),brief=readFileSync(join(home,'TASK.md'),'utf8');
 assert.match(brief,/At-mint grant snapshot/);
 assert.match(brief,/"tool_count":2/);assert.doesNotMatch(brief,/manifest_sha256|https:\/\/notes.example|"create"|"list"/);
 r=fx.cli(['inspect','--home',home,'--json'],{env});assert.equal(r.status,0,r.stdout+r.stderr);
 assert.deepEqual(r.json().result.identity.grant.apps,receipt.apps);
 assert.equal(r.json().result.identity.grant.id,JSON.parse(record).capabilityMeta['oats.aweb'].identity.grant.id);
 const before=readFileSync(join(base,'aw.log'),'utf8');
 r=fx.cli(['launch-config','preview','--home',home,'--json'],{env});assert.equal(r.status,0,r.stdout+r.stderr);
 const preview=r.json();
 if(old) assert.equal(preview.result.warnings,undefined,'older public preview omits warnings, not empty inventory');
 else {
  const warning=JSON.stringify(preview.result.warnings);
  assert.match(warning,/Retained last-successful grant snapshot.*Pending re-mint inventory is unknown/);
  assert.doesNotMatch(warning,/manifest_sha256|https:\/\/notes.example|\\"create\\"|\\"list\\"/);
 }
 assert.equal(preview.result.hookMeta,undefined);assert.equal(preview.result.brief,undefined);
 assert.equal(readFileSync(join(base,'aw.log'),'utf8'),before);assert.equal(readFileSync(join(home,'instance.json'),'utf8'),record);assert.equal(readFileSync(join(home,'TASK.md'),'utf8'),brief);
});
