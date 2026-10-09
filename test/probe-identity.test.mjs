import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, LOCAL_CAPTURE, TARGET_DID} from './helpers/probe-fixture.mjs';
import {validateProbeIdentity} from '../oats-package/capabilities/oats-aweb/lib/probe-target.mjs';
import {runProbe} from '../oats-package/capabilities/oats-aweb/lib/probe.mjs';
const validate = who => validateProbeIdentity(who, LOCAL_CAPTURE.teams, 'worker-1', 'aweb:test.example');
test('captured LOCAL member omits custody and still validates', () => {
  assert.equal(Object.hasOwn(LOCAL_CAPTURE.whoami, 'custody'), false);
  assert.equal(Object.hasOwn(LOCAL_CAPTURE.whoami, 'stable_id'), false);
  assert.equal(Object.hasOwn(LOCAL_CAPTURE.whoami, 'grant_id'), false);
  assert.equal(validate(LOCAL_CAPTURE.whoami), TARGET_DID);
  assert.equal(validate({...LOCAL_CAPTURE.whoami, custody: 'self'}), TARGET_DID);
});
for (const custody of ['custodial', 'hosted', '', null, false, 1, {}, [], undefined]) test(`present non-self custody refuses ${JSON.stringify(custody)}`, () => {
  assert.throws(() => validate({...LOCAL_CAPTURE.whoami, custody}), e => e.reason === 'unsupported-identity');
});
test('missing custody never admits global, grant or contradictory membership', () => {
  for (const delta of [{identity_scope:'global'}, {grant_id:'grant'}, {stable_id:'did:aw:global'}, {did:null}]) assert.throws(()=>validate({...LOCAL_CAPTURE.whoami,...delta}));
  assert.throws(()=>validateProbeIdentity(LOCAL_CAPTURE.whoami,{...LOCAL_CAPTURE.teams,active_team:'other:team'},'worker-1','aweb:test.example'));
  assert.throws(()=>validateProbeIdentity(LOCAL_CAPTURE.whoami,{...LOCAL_CAPTURE.teams,memberships:[...LOCAL_CAPTURE.teams.memberships,...LOCAL_CAPTURE.teams.memberships]},'worker-1','aweb:test.example'));
});
test('round trip uses per-command native selectors for initial and final identity reads', async t => {
  const f=fixture(t),result=await runProbe(f.args,f.deps);
  assert.equal(result.outcome,'PASS',result.reason);
  const ids=f.calls.filter(c=>c.args.includes('id'));
  assert.equal(ids.length,4);
  for(const call of ids)assert.deepEqual(call.args,['--identity-home',call.args[1],'id','team','list','--json']);
  const who=f.calls.filter(c=>c.args.includes('whoami'));
  assert.equal(who.length,4);
  for(const call of who)assert.deepEqual(call.args,['--identity-home',call.args[1],'--team','aweb:test.example','whoami','--json']);
  for(const call of f.calls.filter(c=>c.args.includes('mail')))assert.deepEqual(call.args.slice(0,5),['--identity-home',call.args[1],'--team','aweb:test.example','mail']);
});
test('present non-self custody refuses before mail send in orchestration',async t=>{
  const f=fixture(t,{onCall:({args})=>args.includes('whoami')?{...LOCAL_CAPTURE.whoami,custody:'custodial'}:undefined});
  assert.equal((await runProbe(f.args,f.deps)).reason,'unsupported-identity');
  assert.equal(f.calls.filter(c=>c.args.includes('send')).length,0);
});
test('captured exact mail projection retains field presence/types without raw content',()=>{
  const m=LOCAL_CAPTURE.mail.messages[0];
  assert.equal(LOCAL_CAPTURE.mail.has_more,false);
  assert.equal(m.thread_id,null);
  for(const key of ['body','signed_payload','signature','read_at','from_address','to_address'])assert.equal(typeof m[key],'string');
  assert.equal(m.message_version,1);assert.equal(m.verification_status,'verified');
  const signed=JSON.parse(m.signed_payload);assert.equal(signed.body,m.body);assert.equal(signed.message_id,m.message_id);
  assert.equal(m.signature,'synthetic-signature-not-cryptographic');
});
