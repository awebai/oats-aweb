// awebai/oats-aweb#52: `oats aweb join` in a running home resolves the minting
// root from the deployment's LIVE settings, so a team root added to
// oats-local.yaml after the spawn can be joined. When the live settings cannot
// be read, or name no root for the team, it refuses before any invite is
// minted, naming the cause and the fix. A failed invite names its cause, the
// root and the setting that chose it, never the token.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fakeAwSetupPath } from './helpers/fake-aw-setup.mjs';
import { currentRootQuery } from './helpers/current-root-query.mjs';
const hook=fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs',import.meta.url));
const DEFAULT='default:example.invalid', TEAM='joined:example.invalid', TOKEN='SEEDED-INVITE-TOKEN-0123456789abcdef';
const member=(dir,...teams)=>{mkdirSync(join(dir,'.aw'),{recursive:true});writeFileSync(join(dir,'.aw','teams.json'),JSON.stringify({active_team:teams[0]??'',memberships:teams.map(team_id=>({team_id,alias:'host',active:false}))}));return dir;};
// The report's topology: the home was spawned when the deployment's settings
// named only the default team's root (OATS_SETTINGS, captured at spawn). The
// operator then set up the joined team's root and recorded roots[TEAM] in
// oats-local.yaml; only the live query (`oats inspect`) knows about it.
function fixture(t,{live,change=''}={}) {
 const base=realpathSync(mkdtempSync(join(tmpdir(),'join-root-52-')));t.after(()=>rmSync(base,{recursive:true,force:true}));
 const deployment=join(base,'deployment'), home=join(deployment,'agents','dev','instances','dev-1');mkdirSync(home,{recursive:true});
 writeFileSync(join(deployment,'oats-local.yaml'),'schemaVersion: 2\nworkspace: fixture\n');
 // The default root also lists the joined team, so only the setting that is
 // read decides which root mints: a captured-settings join would mint here.
 const defaultRoot=member(join(deployment,'.aweb-roots','default'),DEFAULT);
 const addedRoot=member(join(deployment,'.aweb-roots','joined'),TEAM);
 const fake=fakeAwSetupPath(t), env=Object.fromEntries(Object.entries(process.env).filter(([k])=>! /^(OATS_|AWEB_)/.test(k)));
 Object.assign(env,{PATH:fake.path,OATS_HOME:home,OATS_INSTANCE:'dev-1',OATS_TEAM_SCOPE:deployment,OATS_WORKSPACE_NAME:'fixture',OATS_DEFAULT_TEAM:'default',OATS_DEFAULT_TEAM_ID:DEFAULT,
  OATS_TEAMS:JSON.stringify([{label:'default',team:DEFAULT,default:true},{label:'joined',team:TEAM,default:false}]),
  OATS_SETTINGS:JSON.stringify({root:defaultRoot}),AW_INVITE_TOKEN:TOKEN,AW_FAKE_TEAM:TEAM});
 const q=currentRootQuery(base,{home,deployment,settings:live?live({defaultRoot,addedRoot}):{root:defaultRoot,roots:{[TEAM]:addedRoot}},change});
 env.OATS_CLI_BIN=q.cli;
 const run=(args,extra={})=>spawnSync(process.execPath,[hook,...args],{cwd:home,env:{...env,...extra},encoding:'utf8',timeout:15000});
 const calls=()=>fake.readCalls();
 // Every way aw can mint an invite: `aw team invite` and `aw id team invite`.
 const mints=()=>calls().filter(c=>(c.args[0]==='team'&&c.args[1]==='invite')||(c.args[0]==='id'&&c.args[1]==='team'&&c.args[2]==='invite'));
 return {base,deployment,home,defaultRoot,addedRoot,fake,q,run,calls,mints};
}

test('a team root added to the live settings after spawn is joined from that root', t=>{
 const f=fixture(t);
 member(f.defaultRoot,DEFAULT,TEAM);
 const r=f.run(['join','--labels','joined','--json']);
 assert.equal(r.status,0,r.stderr);
 assert.deepEqual(f.mints().map(c=>c.cwd),[f.addedRoot],'minted only from the root added after spawn, never the captured default root');
 assert.deepEqual(JSON.parse(r.stdout).joined.map(j=>[j.label,j.team]),[['joined',TEAM]]);
 assert.doesNotMatch(r.stdout+r.stderr,new RegExp(TOKEN));
});

test('live settings with no root for the team refuse before any mint, naming the cause and the fix', t=>{
 const f=fixture(t,{live:({defaultRoot})=>({roots:{[DEFAULT]:defaultRoot}})});
 const r=f.run(['join','--labels','joined']);
 assert.equal(r.status,1,r.stdout);
 assert.match(r.stderr,/cannot join team joined:example\.invalid: no root for this team in the deployment's live settings/);
 assert.match(r.stderr,/nothing was minted/);
 assert.match(r.stderr,/oats aweb setup --join joined --invite-stdin/);
 assert.deepEqual(f.mints(),[]);
});

for(const [name,options,cause,flag] of [
 ['the kernel cannot be run',{extra:{OATS_CLI_BIN:'/absent/oats'}},/the deployment's live settings could not be read \(oats inspect did not answer\)/,'home'],
 ['the kernel refuses the query',{change:"doc={schemaVersion:1,ok:false,error:{code:'E_SOUL_UNKNOWN',message:'SECRET'}};"},/the deployment's live settings could not be read \(oats inspect returned no usable answer\)/,'home'],
 ['the live settings are stale',{change:"doc.result.teamsSource='recorded';"},/the deployment's live settings could not be read \(oats inspect answered from recorded, not live, settings\)/,'soul'],
]) test(`unreadable live settings refuse before any mint when ${name}`, t=>{
 const f=fixture(t,options);
 const r=f.run(['join','--labels','joined'],options.extra);
 assert.equal(r.status,1,r.stdout);
 assert.match(r.stderr,cause);
 assert.match(r.stderr,/nothing was minted/);
 // Before the home's soul is known, the read to repair is the home's; after, the soul's.
 const subject=flag==='home'?`--home ${f.home}`:'--soul dev';
 assert.ok(r.stderr.includes(`run oats inspect ${subject} --dir ${f.deployment} --json in the deployment`),r.stderr);
 assert.doesNotMatch(r.stderr,/SECRET/);
 assert.deepEqual(f.mints(),[]);
});

for(const [name,extra,cause] of [
 ['an unreachable service',{AW_INVITE_FAIL:'1',AW_INVITE_FAIL_STDERR:`Error: Post "https://aweb.example.invalid/v1/teams/invite": dial tcp: lookup aweb.example.invalid: no such host ${TOKEN}`},/the aweb service could not be reached: a network or TLS failure/],
 ['an aw error code',{AW_INVITE_FAIL:'1',AW_INVITE_FAIL_STDERR:'',AW_INVITE_FAIL_STDOUT:JSON.stringify({error:{code:'unknown_or_invalid',message:`refused ${TOKEN}`}})},/aw error unknown_or_invalid/],
 ['unrecognised output',{AW_INVITE_FAIL:'1',AW_INVITE_FAIL_STDERR:`something odd ${TOKEN}`},/no HTTP status, aw error code or network failure in its output/],
]) test(`a failed invite with ${name} names its cause, root and setting, never the token`, t=>{
 const f=fixture(t);
 const r=f.run(['join','--labels','joined'],extra);
 assert.equal(r.status,1,r.stdout);
 assert.match(r.stderr,/aw team invite failed \(exit 5\)/);
 assert.match(r.stderr,cause);
 assert.match(r.stderr,new RegExp(`root ${f.addedRoot.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')} \\(from roots\\[team\\]\\)`));
 assert.match(r.stderr,/nothing was joined/);
 assert.match(r.stderr,/oats aweb join --labels joined --plan/);
 assert.doesNotMatch(r.stdout+r.stderr,new RegExp(TOKEN));
 assert.doesNotMatch(r.stderr,/aweb\.example\.invalid|something odd/,'none of aw\'s own output is relayed');
});

// The live settings name a root for the team that cannot mint: each says why, before any mint.
for(const [name,live,cause] of [
 ['roots is not a map',()=>({roots:[]}),/cannot join team joined:example\.invalid: the live settings\.oats\.aweb\.roots is not a map; nothing was minted; check settings\.oats\.aweb\.roots/],
 ['the root has no readable .aw',({base})=>({roots:{[TEAM]:join(base,'no-aw')}}),/cannot join team joined:example\.invalid: the live roots\[team\] root is missing, not absolute or has no readable \.aw; nothing was minted; check settings\.oats\.aweb\.roots/],
]) test(`a live root that ${name} refuses before any mint, naming the cause and the fix`, t=>{
 const f=fixture(t,{live:({defaultRoot,addedRoot})=>live({base:dirname(dirname(dirname(defaultRoot))),defaultRoot,addedRoot})});
 mkdirSync(join(dirname(dirname(dirname(f.defaultRoot))),'no-aw'),{recursive:true});
 const r=f.run(['join','--labels','joined']);
 assert.equal(r.status,1,r.stdout);
 assert.match(r.stderr,cause);
 assert.match(r.stderr,/oats aweb setup --join joined --invite-stdin/);
 assert.deepEqual(f.mints(),[]);
});

// A spawn-time join (settings.join) has no home to run --plan from: its invite failure names
// the root and the setting that chose it, and no --plan hint.
test('a spawn-time join whose invite fails names root and setting, with no --plan hint', t=>{
 const f=fixture(t);
 const env={OATS_EVENT:'spawn',OATS_WORKSPACE:f.deployment,OATS_RUNTIME:'claude',OATS_SETTINGS:JSON.stringify({join:'joined',roots:{[DEFAULT]:f.defaultRoot,[TEAM]:f.addedRoot}}),AW_INVITE_FAIL:'1',AW_INVITE_FAIL_STDERR:`something odd ${TOKEN}`};
 const r=f.run(['spawn'],env);
 assert.equal(r.status,1,r.stdout+r.stderr);
 const warning=JSON.parse(r.stdout).warning;
 assert.match(warning,/aw team invite failed \(exit 5\)/);
 assert.match(warning,/nothing was joined; root /);
 assert.doesNotMatch(warning,/--plan/);
 assert.doesNotMatch(r.stdout+r.stderr,new RegExp(TOKEN));
});
