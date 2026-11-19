import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createResident} from '../oats-package/capabilities/oats-aweb/lib/resident.mjs';
import {setup,NAME,initCalls} from './helpers/resident-harness.mjs';

for(const platform of ['darwin','linux']) for(const custody of ['unreadable','malformed','missing-status']) {
  test(`${platform}: ${custody} custody status refuses adoption and plan before supervisor writes`,async t=>{
    const s=setup(t,{custody});mkdirSync(join(s.root,'.aw'),{recursive:true});
    for(const f of ['identity.yaml','signing.key','workspace.yaml']) writeFileSync(join(s.root,'.aw',f),'fixture');
    const before=s.localYaml();
    for(const plan of [false,true]) await assert.rejects(createResident({name:NAME,plan},{
      env:s.env,platform,stdin:{isTTY:false},stderr:{isTTY:false},
    }),e=>{
      assert.equal(e.code,'E_RESIDENT_VERIFY');assert.equal(e.stage,'preflight');
      assert.match(e.message,/could not check custody status/);
      assert.doesNotMatch(e.message,/SECRET-|not running|custody stop/);
      return true;
    });
    assert.equal(s.localYaml(),before);assert.equal(initCalls(s.fake).length,0);
    assert.ok(!s.fake.calls().some(c=>['launchctl','systemctl'].includes(c.cmd)));
    assert.equal(readFileSync(join(s.root,'.aw','signing.key'),'utf8'),'fixture');
    assert.equal(existsSync(s.unitPath),false);
  });
}
