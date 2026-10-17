// Captured native schema evidence. Negative controls below are local mutations
// of that capture; they are not samples of live failures or registration proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {targetReceiveAssessment} from '../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs';
const captured=JSON.parse(readFileSync(new URL('./fixtures/codex-delivery/aw-1.36.40-daemon-1.36.37.json',import.meta.url)));
const expected={home:'/fixture/codex',runtime:'codex',runtimeDelivery:'external-session',primary:'/fixture/codex/.aw',bindings:[{identity_home:'/fixture/codex/.aw',team:'fixture:example.invalid',controls:true,event_classes:[]}]};
const options={minimumVersion:'1.36.33',now:Date.parse(captured.updated_at)};
test('real aw 1.36.40 read of daemon 1.36.37 establishes admitted broker stream schema',()=>{
  assert.equal(captured.daemon_version,'1.36.37');
  const result=targetReceiveAssessment(captured,expected,options);
  assert.deepEqual(result.problems,[]);
});
for(const missing of ['target','primary','stream-list']) test(`locally removed ${missing} from native capture requires Codex stream`,()=>{
  const status=structuredClone(captured);
  if(missing==='target')status.instances=[];
  else if(missing==='stream-list')delete status.instances[0].receive_identities;
  else status.instances[0].receive_identities=[];
  assert.equal(targetReceiveAssessment(status,expected,options).problems[0].code,'wake-stream-missing');
});

for(const missing of ['target','primary','stream-list']) test(`incomplete Codex record still diagnoses missing ${missing} from native capture`,()=>{
  const status=structuredClone(captured);
  if(missing==='target')status.instances=[];
  else if(missing==='stream-list')delete status.instances[0].receive_identities;
  else status.instances[0].receive_identities=[];
  const incomplete={...expected,bindings:[],incomplete:true};
  assert.equal(targetReceiveAssessment(status,incomplete,options).problems[0].code,'wake-stream-missing');
});
