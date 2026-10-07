import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { grantAppInventory, grantInventoryAdvisory } from '../oats-package/capabilities/oats-aweb/lib/grant-app-inventory.mjs';
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/grant-mint/${name}.json`, import.meta.url)));
for (const name of ['empty', 'catalog', 'legacy', 'skipped']) test(`exact aw873ed2bf synthetic ${name} inventory`, () => {
 const native=fixture(name), parsed=grantAppInventory(native);
 assert.equal(parsed.appInventoryStatus,'known');assert.deepEqual(parsed.apps,native.apps);assert.deepEqual(parsed.skipped_apps,native.skipped_apps);
 const out=grantInventoryAdvisory({id:native.grant_id,...parsed});
 assert.ok(!out.includes(native.out));assert.ok(!out.includes(native.custody_socket_path));
});
test('absent legacy versus malformed pair; no partial list or hostile text',()=>{
 assert.deepEqual(grantAppInventory({}),{appInventoryStatus:'unavailable'});
 const good=fixture('catalog');
 const cases=[null,{apps:[]},{skipped_apps:[]},{apps:null,skipped_apps:[]},{apps:[],skipped_apps:{}},
  {...good,apps:[good.apps[0],good.apps[0]]}, {...good,skipped_apps:[{app_id:'notes',code:'app_missing'}]},
  {...good,skipped_apps:[{app_id:'bad',code:'SECRET\nINJECT'}]}];
 for(const field of ['app_id','origin','manifest_sha256','tools']) {const doc=structuredClone(good);doc.apps[0][field]=field==='tools'?['bad\nSECRET']: 'bad\nSECRET';cases.push(doc);}
 for(const tools of [['same','same'],[null],['\u202eSECRET'],[{}]]){const doc=structuredClone(good);doc.apps[0].tools=tools;cases.push(doc);}
 for(const value of cases){const p=grantAppInventory(value);assert.deepEqual(p,{appInventoryStatus:'unavailable',appInventoryError:'E_GRANT_APP_INVENTORY'});assert.doesNotMatch(grantInventoryAdvisory({id:'new',...p}),/SECRET|INJECT/);}
});
test('retained and pending are distinct; grant labels do not inject control characters',()=>{
 const grant={id:'old',...grantAppInventory(fixture('catalog'))};
 assert.match(grantInventoryAdvisory(grant,{retained:true,pending:true}),/Retained.*old.*Pending re-mint inventory is unknown/);
 assert.doesNotMatch(grantInventoryAdvisory(grant,{retained:true}),/Pending/);
 assert.doesNotMatch(grantInventoryAdvisory({id:'bad\nSECRET'}),/SECRET/);
});

test('bounded display data and unsafe URL/digest shapes become unavailable without coercion',()=>{
 const good=fixture('catalog');
 const mutate=fn=>{const r=structuredClone(good);fn(r);return r;};
 const cases=[
  mutate(r=>r.apps[0].origin='https://user:password@example.invalid'),
  mutate(r=>r.apps[0].origin='https://example.invalid/?token=secret'),
  mutate(r=>r.apps[0].manifest_sha256='sha256:bad'),
  mutate(r=>r.apps[0].tools=Array.from({length:1025},(_,i)=>String(i))),
  mutate(r=>r.apps[0].tools=['x'.repeat(2049)]),
  mutate(r=>r.apps[0].tools=Array.from({length:50},(_,i)=>`${i}${'x'.repeat(2000)}`)),
  mutate(r=>r.apps=Array.from({length:257},(_,i)=>({...r.apps[0],app_id:String(i)}))),
  mutate(r=>r.apps[0].extra='unexpected'),
 ];
 for(const r of cases)assert.equal(grantAppInventory(r).appInventoryError,'E_GRANT_APP_INVENTORY');
 const p=grantAppInventory(good);p.apps[0].tools.push('mutated');assert.notDeepEqual(p.apps,good.apps);
});


test('native app names and canonical origin-only values; independent path refusals',()=>{
 const good=fixture('catalog');
 for(const origin of ['https://notes.example/PRIVATE_TOKEN','https://notes.example/','https://NOTES.example','https://notes.example.','https://notes.example:443','http://notes.example:80']) {
  const r=structuredClone(good);r.apps[0].origin=origin;
  const p=grantAppInventory(r);assert.equal(p.appInventoryError,'E_GRANT_APP_INVENTORY');
  assert.equal(p.apps,undefined);assert.equal(p.skipped_apps,undefined);
  assert.doesNotMatch(grantInventoryAdvisory({id:'valid',...p}),/PRIVATE_TOKEN/);
 }
 for(const id of ['/tmp/PRIVATE_KEY','-leading','../relative','name.with.dot','na me']) for(const skipped of [false,true]){
  const r=structuredClone(good);if(skipped)r.skipped_apps=[{app_id:id,code:'app_missing'}];else r.apps[0].app_id=id;
  const p=grantAppInventory(r);assert.equal(p.appInventoryError,'E_GRANT_APP_INVENTORY');assert.equal(p.apps,undefined);assert.equal(p.skipped_apps,undefined);
  assert.doesNotMatch(grantInventoryAdvisory({id:'valid',...p}),/PRIVATE_KEY/);
 }
 for(const origin of ['https://notes.example','http://localhost:8080','https://[::1]:8443']){
  const r=structuredClone(good);r.apps[0].origin=origin;r.apps[0].app_id='Notes_2-x';assert.equal(grantAppInventory(r).appInventoryStatus,'known');
 }
});
