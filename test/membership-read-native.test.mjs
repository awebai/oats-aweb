import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const AW=process.env.OATS_AWEB_TEST_AW;
const HOOK=fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs',import.meta.url));

for(const state of ['missing','malformed']) test(`real aw membership ${state} stays unknown through check-only`,t=>{
  if(!AW) {
    assert.notEqual(process.env.OATS_MEMBERSHIP_NATIVE_REQUIRED,'1','select the matrix native aw with OATS_AWEB_TEST_AW');
    t.skip('requires an explicitly selected native aw');return;
  }
  const root=realpathSync(mkdtempSync(join(tmpdir(),'membership-native-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'.aw'));
  if(state==='malformed') writeFileSync(join(root,'.aw','teams.yaml'),'memberships: [SECRET-NATIVE-INPUT\n');
  const env={HOME:root,PATH:`${dirname(AW)}:${dirname(process.execPath)}:/usr/bin:/bin`,AW_NO_UPDATE_CHECK:'1',
    OATS_DEFAULT_TEAM:'default',OATS_DEFAULT_TEAM_ID:'t:example.test',OATS_SETTINGS:JSON.stringify({root})};
  const native=spawnSync(AW,['team','list','--json'],{cwd:root,env,encoding:'utf8',timeout:10000});
  assert.notEqual(native.status,0,'native aw refuses the unreadable membership');
  assert.equal(native.error,undefined,'native failure came from aw, not the fixture');
  const provider=spawnSync(process.execPath,[HOOK,'setup','--check-only','--json'],{cwd:root,env,encoding:'utf8',timeout:10000});
  assert.equal(provider.status,1,provider.stdout+provider.stderr);
  const doc=JSON.parse(provider.stdout);
  assert.equal(doc.member,null);assert.equal(doc.aw.status,'ok');
  assert.deepEqual(Object.keys(doc).sort(),['aw','defaultTeam','member','root']);
  assert.match(provider.stderr,/could not check membership/);
  assert.ok(provider.stderr.includes(`failed (exit ${native.status})`));
  assert.doesNotMatch(provider.stderr,/SECRET-NATIVE-INPUT|not a member/);
});
