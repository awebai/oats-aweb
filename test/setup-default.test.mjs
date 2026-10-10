import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fakeAwSetupPath } from './helpers/fake-aw-setup.mjs';
import { fakeKernelTeamConfig } from './helpers/fake-kernel-team-config.mjs';
const hook=fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs',import.meta.url));
function fixture(t, state={}) {
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'setup-default-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const dep=join(dir,'deployment'),root=join(dir,'root');mkdirSync(dep);writeFileSync(join(dep,'oats-local.yaml'),'schemaVersion: 2\nworkspace: fixture\n');
 const kernel=fakeKernelTeamConfig(join(dir,'kernel'),dep,state),aw=fakeAwSetupPath(t);
 const installs=join(dir,'installs');writeFileSync(join(aw.path.split(':')[0],'npm'),`#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(installs)},'attempt\\n');process.exit(98);`,{mode:0o755});
 const env={...process.env,PATH:aw.path,OATS_EVENT:'setup',OATS_TEAM_SCOPE:dep,OATS_WORKSPACE:dep,OATS_WORKSPACE_NAME:'fixture',OATS_SETTINGS:JSON.stringify({root}),OATS_CLI_BIN:kernel.cli,AWEB_API_KEY:'',OATS_AGENT:'poison',OATS_HOME:'/foreign/home',AWEB_IDENTITY_HOME:'/foreign/identity'};
 const run=(args=[],extra={})=>spawnSync(process.execPath,[hook,'setup','--username','alice','--name','root-1','--json',...args],{cwd:dep,env:{...env,...extra},encoding:'utf8'});
 const member=facts=>{mkdirSync(join(root,'.aw'),{recursive:true});writeFileSync(join(root,'.aw','teams.json'),JSON.stringify({memberships:facts}));writeFileSync(join(root,'.aw','sentinel'),'preserve');};
 return {dir,dep,root,kernel,aw,run,member,installs};
}
const row={team_id:'default:alice.aweb.ai',alias:'root-1',identity_scope:'local'};
const answer=r=>{assert.equal(r.status,0,r.stdout+r.stderr);return JSON.parse(r.stdout).result;};
test('username setup applies mapping and implicit default, then resumes without signup',t=>{
 const f=fixture(t),first=answer(f.run());assert.equal(first.team,row.team_id);assert.equal(first.membershipVerified,true);
 assert.deepEqual(f.kernel.calls().filter(c=>['add','default'].includes(c.args[1])).map(c=>c.args[1]),['add']);
 assert.equal(first.observed.defaultTeam.label,'alice');assert.equal(answer(f.run()).steps[0].status,'reused');
 assert.equal(f.aw.readCalls().filter(c=>c.args[0]==='init').length,1);
 for(const call of f.kernel.calls()){assert.equal(call.cwd,f.dep);assert.ok(call.args.includes('--dir'));assert.ok(call.args.includes('--json'));assert.equal(call.ambientAgent,undefined);assert.equal(call.ambientHome,undefined);}
});
test('plan previews conditional mapping/default commands with no native signup/install/root/write',t=>{
 const f=fixture(t),plan=answer(f.run(['--plan','--install-aw']));assert.equal(plan.plan,true);assert.equal(plan.predictedTeam,row.team_id);assert.equal(plan.team,null);
 assert.equal(plan.configuration.commands.length,2);assert.match(plan.configuration.note,/may also set/);assert.equal(existsSync(f.root),false);
 assert.deepEqual(f.aw.readCalls(),[]);assert.equal(f.kernel.calls().some(c=>['add','default'].includes(c.args[1])),false);
});
test('closed policy and conflicting mapping refuse before bootstrap',t=>{
 for(const [state,code] of [[{localTeams:false},'E_SETUP_POLICY'],[{teams:[{label:'alice',team:'other:example.invalid',from:'shared'}]},'E_SETUP_TEAM_CONFLICT'],[{teams:[{label:'alice',team:null,from:'shared'}]},'E_SETUP_TEAM_CONFLICT']]) {
  const f=fixture(t,state),r=f.run(['--install-aw']);assert.equal(r.status,1);const error=JSON.parse(r.stdout).error;assert.equal(error.code,code);assert.equal(error.details.commands.length,2);assert.equal(existsSync(f.root),false);assert.deepEqual(f.aw.readCalls(),[]);
 }
});
test('exact shared mapping is reused and default is explicitly applied only when needed',t=>{
 const f=fixture(t,{teams:[{label:'alice',team:row.team_id,from:'shared'},{label:'old',team:'old:example.invalid',from:'shared'}],defaultTeam:{label:'old',team:'old:example.invalid'}});
 f.member([row]);answer(f.run());assert.deepEqual(f.kernel.calls().filter(c=>['add','default'].includes(c.args[1])).map(c=>c.args[1]),['default']);assert.equal(f.aw.readCalls().some(c=>c.args[0]==='init'),false);
});
test('mismatched/ambiguous/missing alias or scope membership retains root and never signs up again',t=>{
 for(const rows of [[{...row,team_id:'default:bob.aweb.ai'}],[{...row,alias:'other'}],[{...row,identity_scope:'global'}],[{team_id:row.team_id}],[row,row],[]]) {
  const f=fixture(t);f.member(rows);for(let i=0;i<2;i++){const r=f.run();assert.equal(JSON.parse(r.stdout).error.code,'E_SETUP_MEMBERSHIP');}
  assert.equal(readFileSync(join(f.root,'.aw','sentinel'),'utf8'),'preserve');assert.equal(f.aw.readCalls().some(c=>c.args[0]==='init'),false);assert.equal(f.kernel.calls().some(c=>['add','default'].includes(c.args[1])),false);
 }
});
for(const failure of ['add-before','add-after','default-before','default-after','readback-add','readback-default'])test(`partial ${failure} never reports success and preserves a resumable root`,t=>{
 const prior=failure.includes('default')?{teams:[{label:'old',team:'old:example.invalid'}],defaultTeam:{label:'old',team:'old:example.invalid'}}:{};
 const f=fixture(t,{...prior,failure}),r=f.run();assert.equal(r.status,1);const err=JSON.parse(r.stdout).error;assert.match(err.code,/E_SETUP_(KERNEL|READBACK)/);assert.doesNotMatch(r.stdout+r.stderr,/SECRET_KERNEL_BODY/);assert.ok(existsSync(join(f.root,'.aw')));
 const state=f.kernel.read();if(failure==='add-after')assert.equal(err.details.observed.defaultTeam.label,'alice');
 delete state.failure;f.kernel.set(state);answer(f.run());assert.equal(f.aw.readCalls().filter(c=>c.args[0]==='init').length,1);
});
test('malformed/unsupported/query failures are configuration errors, not closed policy',t=>{
 for(const state of [{teamsApi:1},{failure:'query'},{localTeams:'false'},{problems:[{code:'UNKNOWN'}]}]) {
  const f=fixture(t,state),r=f.run();assert.equal(r.status,1);assert.notEqual(JSON.parse(r.stdout).error.code,'E_SETUP_POLICY');assert.equal(existsSync(f.root),false);assert.deepEqual(f.aw.readCalls(),[]);
 }
});
test('explicit label overrides normalized username without rewriting native account input',t=>{
 const f=fixture(t),r=answer(f.run(['--label','chosen.label']));assert.equal(r.label,'chosen.label');assert.deepEqual(f.aw.readCalls().find(c=>c.args[0]==='init').args,['init','--new-account','--username','alice','--name','root-1']);
});
test('malformed settings, invalid explicit root and conflicting deployment refuse without effects',t=>{
 for(const settings of ['null','not-json','[]',JSON.stringify({roots:[]}),JSON.stringify({root:'relative'}),JSON.stringify({identity:{mode:'global'}})]) {
  const f=fixture(t),r=f.run(['--install-aw'],{OATS_SETTINGS:settings});assert.equal(r.status,1);assert.match(JSON.parse(r.stdout).error.code,/^E_SETUP_/);assert.equal(existsSync(f.root),false);assert.deepEqual(f.aw.readCalls(),[]);
 }
 const f=fixture(t);assert.equal(JSON.parse(f.run(['--dir',f.dir]).stdout).error.code,'E_SETUP_DEPLOYMENT');assert.deepEqual(f.aw.readCalls(),[]);
});
test('invalid account or label options refuse before native/bootstrap effects',t=>{
 const f=fixture(t);for(const args of [['--label','Bad Label'],['--username= bad'],['--username=--bad']]) {
  const r=f.run(args);assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).error.code,'E_SETUP_ARGUMENT');
 }
 assert.deepEqual(f.aw.readCalls(),[]);assert.equal(existsSync(f.root),false);
});
test('unrelated warnings permit setup while selected-label warning is a typed configuration refusal',t=>{
 const f=fixture(t,{problems:[{code:'team-soul-unknown',severity:'warning',key:'unknown',at:'fixture'}]});answer(f.run());
 const g=fixture(t,{teams:[{label:'alice',team:row.team_id,from:'shared'}],problems:[{code:'team-label-collision',severity:'warning',label:'alice'}]});
 assert.equal(JSON.parse(g.run().stdout).error.code,'E_SETUP_CONFIGURATION');assert.deepEqual(g.aw.readCalls(),[]);assert.equal(existsSync(g.root),false);
});
test('plan verifies an existing root and changes neither membership nor kernel configuration',t=>{
 const f=fixture(t);f.member([row]);const before=readFileSync(join(f.root,'.aw','teams.json'),'utf8'),state=f.kernel.read();
 const r=answer(f.run(['--plan']));assert.equal(r.bootstrap,'reuse');assert.equal(r.team,row.team_id);
 assert.equal(readFileSync(join(f.root,'.aw','teams.json'),'utf8'),before);assert.deepEqual(f.kernel.read(),state);assert.equal(f.aw.readCalls().some(c=>c.args[0]==='init'),false);
});

test('closed and conflicting policy cannot trigger even explicitly requested missing-floor installation',t=>{
 for(const state of [{localTeams:false},{teams:[{label:'alice',team:'other:example.invalid'}]}]) {
  const f=fixture(t,state),r=f.run(['--install-aw'],{AW_FAKE_VERSION:'0.0.1'});
  assert.match(JSON.parse(r.stdout).error.code,/E_SETUP_(POLICY|TEAM_CONFLICT)/);assert.equal(existsSync(f.installs),false);assert.equal(existsSync(f.root),false);
 }
});
test('post-signup membership mismatch preserves root and retry never signs up again',t=>{
 const f=fixture(t),extra={AW_LIST_TEAMS:JSON.stringify({memberships:[{...row,alias:'unexpected'}]})};
 for(let i=0;i<2;i++){const r=f.run([],extra);assert.equal(JSON.parse(r.stdout).error.code,'E_SETUP_MEMBERSHIP');}
 assert.ok(existsSync(join(f.root,'.aw')));assert.equal(f.aw.readCalls().filter(c=>c.args[0]==='init').length,1);assert.equal(f.kernel.calls().some(c=>['add','default'].includes(c.args[1])),false);
});

test('username setup on a closed workspace whose committed default already names the label for the predicted team bootstraps the account without a team write',t=>{
 const committed={label:'alice',team:'default:alice.aweb.ai',from:'workspace'};
 const f=fixture(t,{localTeams:false,teams:[committed],defaultTeam:committed});
 const r=answer(f.run([],{OATS_DEFAULT_TEAM_FROM:'workspace'}));
 assert.deepEqual(f.aw.readCalls().find(c=>c.args[0]==='init').args,['init','--new-account','--username','alice','--name','root-1'],'the account bootstrap runs');
 assert.deepEqual(f.kernel.calls().filter(c=>c.args[1]==='add'||c.args[1]==='default'),[],'no local team write on a closed workspace');
 assert.equal(f.kernel.read().lastMutation,undefined);
 assert.equal(r.label,'alice');
});
