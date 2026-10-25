// awebai/oats-aweb#149: a joined team is minted only from a root that proves
// membership in that exact team. The home's own .aw, the cwd and OATS_WORKSPACE
// are never minting roots for it; `join --plan` resolves as the join would and
// changes nothing; a withheld invite failure still names its class.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fakeAwSetupPath } from './helpers/fake-aw-setup.mjs';
import { currentRootQuery } from './helpers/current-root-query.mjs';
const hook=fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs',import.meta.url));
const DEFAULT='default:example.invalid', TEAM='joined:example.invalid', TOKEN='SEEDED-INVITE-TOKEN-0123456789abcdef';
const member=(dir,...teams)=>{mkdirSync(join(dir,'.aw'),{recursive:true});writeFileSync(join(dir,'.aw','teams.json'),JSON.stringify({active_team:teams[0]??'',memberships:teams.map(team_id=>({team_id,alias:'host',active:false}))}));return dir;};
// The topology of the report: the home's .aw is a member of the default team
// only, the captured settings name only the default team's root, and the team
// to join is in the live eligible list.
function fixture(t,{live}={}) {
 const base=realpathSync(mkdtempSync(join(tmpdir(),'join-root-149-')));t.after(()=>rmSync(base,{recursive:true,force:true}));
 const deployment=join(base,'deployment'), home=join(deployment,'agents','dev','instances','dev-1');mkdirSync(home,{recursive:true});
 writeFileSync(join(deployment,'oats-local.yaml'),'schemaVersion: 2\nworkspace: fixture\n');
 const defaultRoot=member(join(deployment,'.aweb-roots','default'),DEFAULT), joinedRoot=member(join(deployment,'.aweb-roots','joined'),TEAM);
 member(home,DEFAULT);
 const fake=fakeAwSetupPath(t), env=Object.fromEntries(Object.entries(process.env).filter(([k])=>! /^(OATS_|AWEB_)/.test(k)));
 Object.assign(env,{PATH:fake.path,OATS_HOME:home,OATS_INSTANCE:'dev-1',OATS_TEAM_SCOPE:deployment,OATS_WORKSPACE_NAME:'fixture',OATS_DEFAULT_TEAM:'default',OATS_DEFAULT_TEAM_ID:DEFAULT,
  OATS_TEAMS:JSON.stringify([{label:'default',team:DEFAULT,default:true},{label:'joined',team:TEAM,default:false}]),OATS_SETTINGS:JSON.stringify({roots:{[DEFAULT]:defaultRoot}}),AW_INVITE_TOKEN:TOKEN,AW_FAKE_TEAM:TEAM});
 const q=currentRootQuery(base,{home,deployment,settings:live?live({defaultRoot,joinedRoot}):{roots:{[DEFAULT]:defaultRoot,[TEAM]:joinedRoot}}});
 env.OATS_CLI_BIN=q.cli;
 const run=(args,extra={})=>spawnSync(process.execPath,[hook,...args],{cwd:home,env:{...env,...extra},encoding:'utf8',timeout:15000});
 const calls=()=>fake.readCalls();
 const invites=()=>calls().filter(c=>c.args[0]==='team'&&c.args[1]==='invite');
 return {base,deployment,home,defaultRoot,joinedRoot,fake,env,q,run,calls,invites};
}

test('(i) join from a home with stale captured roots uses the live member root, never the home', t=>{
 const f=fixture(t), r=f.run(['join','--labels','joined','--json']);
 assert.equal(r.status,0,r.stderr);
 assert.deepEqual(f.invites().map(c=>c.cwd),[f.joinedRoot]);
 assert.ok(!f.calls().some(c=>c.cwd===f.home&&c.args[0]==='team'),'no team command runs as the home identity');
 assert.deepEqual(JSON.parse(r.stdout).joined.map(j=>[j.label,j.team]),[['joined',TEAM]]);
});
for(const json of [true,false]) test(`(i) join --plan${json?' --json':''} reports the live member root and its source`,t=>{
 const f=fixture(t), r=f.run(['join','--labels','joined','--plan',...(json?['--json']:[])]);
 assert.equal(r.status,0,r.stderr);
 if(json) assert.deepEqual(JSON.parse(r.stdout).plan,[{label:'joined',team:TEAM,root:f.joinedRoot,source:'roots[team]',member:true}]);
 else { assert.match(r.stdout,new RegExp(`joined \\(${TEAM}\\): root ${f.joinedRoot} from roots\\[team\\], membership confirmed`)); }
 assert.ok(!f.calls().some(c=>c.cwd===f.home));
});
test('(i) join --plan names root as the source when the live root is the shared settings.root', t=>{
 const f=fixture(t,{live:({defaultRoot})=>({root:defaultRoot})});member(f.defaultRoot,DEFAULT,TEAM);
 const r=f.run(['join','--labels','joined','--plan','--json']);assert.equal(r.status,0,r.stderr);
 assert.deepEqual(JSON.parse(r.stdout).plan,[{label:'joined',team:TEAM,root:f.defaultRoot,source:'root',member:true}]);
});
test('(ii) live settings with no roots[team] and no root refuse the join and the plan, with no invite', t=>{
 const f=fixture(t,{live:({defaultRoot})=>({roots:{[DEFAULT]:defaultRoot}})});
 for(const args of [['join','--labels','joined','--json'],['join','--labels','joined','--plan','--json']]) {
  const r=f.run(args);assert.equal(r.status,1,r.stdout);assert.match(r.stdout+r.stderr,/cannot join team joined:example\.invalid/);
 }
 assert.deepEqual(f.invites(),[]);
});
test('(iii) a live root that is not a member of the team refuses the join and the plan', t=>{
 const f=fixture(t);member(f.joinedRoot,DEFAULT);
 for(const args of [['join','--labels','joined','--json'],['join','--labels','joined','--plan']]) {
  const r=f.run(args);assert.equal(r.status,1,r.stdout);assert.match(r.stdout+r.stderr,/cannot prove membership in this exact team/);
 }
 assert.deepEqual(f.invites(),[]);
});
for(const json of [true,false]) test(`(v) join --plan${json?' --json':''} mutates nothing and prints no token`,t=>{
 const f=fixture(t), r=f.run(['join','--labels','joined','--plan',...(json?['--json']:[])]);
 assert.equal(r.status,0,r.stderr);
 const mutations=f.calls().filter(c=>(c.args[0]==='team'&&['invite','join'].includes(c.args[1]))||(c.args[0]==='id'&&c.args[1]==='create')||c.args[0]==='init'||(c.args[0]==='id'&&c.args[1]==='team'&&c.args[2]==='accept-invite')||c.args[0]==='wake'||c.args[0]==='workspace');
 assert.deepEqual(mutations,[]);
 assert.equal(existsSync(join(f.home,'.aweb-identity-joined')),false);
 assert.equal(existsSync(join(f.home,'.oats-aweb')),false);
 assert.doesNotMatch(r.stdout+r.stderr,new RegExp(TOKEN));
 assert.doesNotMatch(r.stdout+r.stderr,/[A-Za-z0-9_-]{32,}/,'no token-shaped value in the output');
});

// Spawn-time joins (settings.join) and the roster resolve through awebRootForTeam
// with the captured settings.
// The cwd (the home) and OATS_WORKSPACE both hold a .aw that lists the joined team.
function spawnFixture(t,{settings}={}) {
 const f=fixture(t);
 member(f.deployment,DEFAULT,TEAM);member(f.home,DEFAULT,TEAM);
 const env={OATS_EVENT:'spawn',OATS_WORKSPACE:f.deployment,OATS_RUNTIME:'claude',OATS_SETTINGS:JSON.stringify({join:'joined',...settings({...f})})};
 const spawn=()=>spawnSync(process.execPath,[hook,'spawn'],{cwd:f.home,env:{...f.env,...env},encoding:'utf8',timeout:15000});
 return {...f,spawn};
}
test('(iv) spawn-time join with no captured root for the joined team refuses, without the cwd or OATS_WORKSPACE', t=>{
 const f=spawnFixture(t,{settings:({defaultRoot})=>({roots:{[DEFAULT]:defaultRoot}})});
 const r=f.spawn();assert.equal(r.status,1,r.stdout+r.stderr);
 const doc=JSON.parse(r.stdout);
 assert.match(doc.warning,/team joined \(joined:example\.invalid\) has no member root/);
 assert.match(doc.warning,/settings\.oats\.aweb\.roots\["joined:example\.invalid"\]/);
 assert.match(doc.warning,/oats aweb setup --join joined --invite-stdin/);
 assert.ok(doc.meta?.alias,'the default identity minted before the failure is reported for compensation');
 assert.deepEqual(f.invites(),[]);
});
test('(iv) spawn-time join refuses a captured root that is not a member of the joined team', t=>{
 const f=spawnFixture(t,{settings:({defaultRoot,joinedRoot})=>({roots:{[DEFAULT]:defaultRoot,[TEAM]:joinedRoot}})});member(f.joinedRoot,DEFAULT);
 const r=f.spawn();assert.equal(r.status,1,r.stdout+r.stderr);
 assert.match(JSON.parse(r.stdout).warning,/aw team list there: not a member of joined:example\.invalid/);
 assert.deepEqual(f.invites(),[]);
});
test('(iv) spawn-time join refuses the instance home as a captured root', t=>{
 const f=spawnFixture(t,{settings:({defaultRoot,home})=>({roots:{[DEFAULT]:defaultRoot,[TEAM]:home}})});
 const r=f.spawn();assert.equal(r.status,1,r.stdout+r.stderr);
 assert.match(JSON.parse(r.stdout).warning,/the instance home's own identity/);
 assert.deepEqual(f.invites(),[]);
});
for(const kind of ['a symlink to the home','a root whose .aw links to the home .aw']) test(`(iv) spawn-time join refuses ${kind} as a captured root`,t=>{
 const f=spawnFixture(t,{settings:({defaultRoot,base})=>({roots:{[DEFAULT]:defaultRoot,[TEAM]:join(base,'alias')}})});
 if(kind==='a symlink to the home') symlinkSync(f.home,join(f.base,'alias'));
 else { mkdirSync(join(f.base,'alias'));symlinkSync(join(f.home,'.aw'),join(f.base,'alias','.aw')); }
 const r=f.spawn();assert.equal(r.status,1,r.stdout+r.stderr);
 assert.match(JSON.parse(r.stdout).warning,/the instance home's own identity/);
 assert.deepEqual(f.invites(),[]);
 assert.ok(!f.calls().some(c=>c.cwd===join(f.base,'alias')),'no aw call runs as the home identity');
});
test('(iv) a spawn-time refusal keeps its remedy when the captured root path is long', t=>{
 const f=spawnFixture(t,{settings:({defaultRoot,base})=>({roots:{[DEFAULT]:defaultRoot,[TEAM]:join(base,'r'.repeat(150))}})});member(join(f.base,'r'.repeat(150)),DEFAULT);
 const r=f.spawn();assert.equal(r.status,1,r.stdout+r.stderr);
 assert.match(JSON.parse(r.stdout).warning,/oats aweb setup --join joined --invite-stdin/);
});
for(const [name,settings,root] of [
 ['captured roots[team]',({defaultRoot,joinedRoot})=>({roots:{[DEFAULT]:defaultRoot,[TEAM]:joinedRoot}}),f=>f.joinedRoot],
 ['a shared settings.root that proves membership',({defaultRoot})=>({root:defaultRoot}),f=>f.defaultRoot],
]) test(`(iv) spawn-time join mints from ${name}`,t=>{
 const f=spawnFixture(t,{settings});member(f.defaultRoot,DEFAULT,TEAM);
 const r=f.spawn();assert.equal(r.status,0,r.stdout+r.stderr);
 assert.deepEqual(f.invites().map(c=>c.cwd),[root(f)]);
});
test('(iv) roster --label with no captured root for the team refuses, without the cwd or OATS_WORKSPACE', t=>{
 const f=fixture(t);member(f.deployment,DEFAULT,TEAM);member(f.home,DEFAULT,TEAM);
 const r=f.run(['roster','--label','joined','--json'],{OATS_WORKSPACE:f.deployment});
 assert.equal(r.status,1,r.stdout);
 assert.match(r.stderr,/team joined \(joined:example\.invalid\) has no member root/);
 assert.ok(!f.calls().some(c=>c.args[0]==='id'&&c.args[2]==='members'),'no roster read from a non-root');
});

test('a withheld invite failure reports its exit code, HTTP status and redacted server detail', t=>{
 const f=fixture(t);
 const stderr=`Error: aweb: http 403 (x-request-id: req-1): {"detail":"Authenticated team does not match requested team ${TOKEN}"}`;
 const r=f.run(['join','--labels','joined','--json'],{AW_INVITE_FAIL:'1',AW_INVITE_FAIL_STDERR:stderr});
 assert.equal(r.status,1,r.stdout);
 assert.match(r.stderr,/team invite failed \(exit 5\)/);
 assert.match(r.stderr,/output withheld: this command handles credentials/);
 assert.match(r.stderr,/http 403/);
 assert.match(r.stderr,/detail: "Authenticated team does not match requested team <redacted>"/);
 assert.doesNotMatch(r.stderr,new RegExp(TOKEN));
 assert.doesNotMatch(r.stderr,/req-1/);
});
