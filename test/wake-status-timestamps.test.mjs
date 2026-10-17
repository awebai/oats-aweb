import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parseTimestamp,targetReceiveAssessment} from '../oats-package/capabilities/oats-aweb/lib/wake-receive.mjs';

const capture=()=>JSON.parse(readFileSync(new URL('./fixtures/wake-status/client-1.36.40-daemon-1.36.37.json',import.meta.url),'utf8'));
function assess(status,options={}) {
  const row=status.instances[0];
  const expected={home:row.home,primary:row.identity_home,runtimeDelivery:'external-session',bindings:[{identity_home:row.identity_home,team:'fixture:example.test',controls:true,event_classes:[]}]};
  return targetReceiveAssessment(status,expected,{minimumVersion:'1.36.33',now:Date.parse('2026-10-17T06:08:42Z'),...options});
}

test('captured wire timing and shape parse without rewriting timestamps',()=>{
  const status=capture();
  assert.equal(status.daemon_version,'1.36.37');
  for (const value of [status.updated_at,status.instances[0].last_inspect_at,status.instances[0].registered_at,status.instances[0].channel_core.last_run_at,status.instances[0].receive_identities[0].connected_at]) assert.ok(Number.isFinite(parseTimestamp(value)),value);
  assert.deepEqual(assess(status).problems,[]);
});

test('supported RFC 3339 precision and timezone variants remain accepted',()=>{
  for (const suffix of ['Z','+00:00','-04:00']) for (const fraction of ['',...Array.from({length:9},(_,i)=>'.'+'1'.repeat(i+1))]) {
    const value='2026-10-17T06:08:41'+fraction+suffix;
    assert.equal(parseTimestamp(value),Date.parse(value),value);
  }
});

test('malformed time has an unknown diagnostic, missing time warns, and actual future time fails',()=>{
  const status=capture();status.updated_at='invalid';
  assert.match(assess(status).problems[0].message,/status\.updated_at.*aw client unknown; daemon 1\.36\.37/);
  assert.equal(assess(status,{clientVersion:'1.36.40'}).problems[0].code,'wake-status-timestamp-unknown');
  assert.match(assess(status,{clientVersion:'1.36.40'}).problems[0].message,/aw client 1\.36\.40; daemon 1\.36\.37/);
  delete status.updated_at;
  assert.deepEqual(assess(status).problems,[]);
  assert.ok(assess(status).warnings.some(w=>w.code==='receive-observation-unproven'));
  status.updated_at='2026-10-17T06:08:42.001Z';
  assert.equal(assess(status).problems[0].code,'wake-status-stale');
});
