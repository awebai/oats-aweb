import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,realpathSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fakeAwSetupPath} from './helpers/fake-aw-setup.mjs';
import {fakeKernelTeamConfig} from './helpers/fake-kernel-team-config.mjs';

const HOOK=fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs',import.meta.url));
const BINDING=fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb-binding.mjs',import.meta.url));
const DEFAULT='default:example.test',TEAM='joined:example.test',SERVICE='https://service.example.test';
function fixture(t) {
  const base=realpathSync(mkdtempSync(join(tmpdir(),'setup-root-choice-')));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const root=join(base,'default-root'),target=join(base,'.aweb-roots','joined'),home=join(base,'home');
  mkdirSync(home);mkdirSync(join(root,'.aw'),{recursive:true});
  writeFileSync(join(base,'oats-local.yaml'),'schemaVersion: 2\nworkspace: fixture\n');
  writeFileSync(join(root,'.aw','identity.yaml'),'did: did:key:zFixture\n');
  writeFileSync(join(root,'.aw','teams.json'),JSON.stringify({memberships:[{team_id:DEFAULT}]}));
  const fake=fakeAwSetupPath(t,{version:'1.36.58',activeTeam:TEAM});
  const kernel=fakeKernelTeamConfig(join(base,'kernel'),base,{
    teams:[{label:'default',team:DEFAULT,from:'local'}],defaultTeam:{label:'default',team:DEFAULT,from:'deployment'},
  });
  const cli=join(base,'oats.mjs');writeFileSync(cli,`#!${process.execPath}\nimport ${JSON.stringify(kernel.cli)};`,{mode:0o755});
  const env={HOME:base,PATH:fake.path,OATS_HOME:home,OATS_INSTANCE:'probe',OATS_TEAM_SCOPE:base,OATS_WORKSPACE:base,
    OATS_DEFAULT_TEAM:'default',OATS_DEFAULT_TEAM_ID:DEFAULT,OATS_DEFAULT_TEAM_FROM:'deployment',
    OATS_TEAMS:JSON.stringify([{label:'default',team:DEFAULT,default:true,from:'local'},{label:'joined',team:TEAM,from:'local'}]),
    OATS_SETTINGS:JSON.stringify({root}),OATS_CLI_BIN:cli,AW_FAKE_TEAM:TEAM,AWEB_URL:SERVICE};
  const run=(args,extra={},input)=>spawnSync(process.execPath,[HOOK,...args],{cwd:base,env:{...env,...extra},input,encoding:'utf8',timeout:15000});
  const targetIdentity=(team=TEAM)=>{
    mkdirSync(join(target,'.aw'),{recursive:true});
    writeFileSync(join(target,'.aw','identity.yaml'),'did: did:key:zTarget\n');
    writeFileSync(join(target,'.aw','teams.json'),JSON.stringify({memberships:[{team_id:team,alias:'host',identity_scope:'local'}]}));
    writeFileSync(join(target,'.aw','workspace.yaml'),`team_id: ${team}\naweb_url: ${SERVICE}\n`);
  };
  const joinMapping=()=>{const state=kernel.read();state.teams.push({label:'joined',team:TEAM,from:'local'});kernel.set(state);};
  return {base,root,target,home,fake,kernel,env,run,targetIdentity,joinMapping};
}
const create=['setup','--create','joined','--namespace','example.test','--name','host'];
const resume=['setup','--join','joined','--name','host'];
const identityRead=c=>c.args[0]==='whoami'||(c.args[0]==='team'&&c.args[1]==='list')||(c.args[0]==='id'&&c.args[1]==='team'&&c.args[2]==='list');
const mutation=c=>c.args[0]==='init'||c.args[0]==='workspace'||(c.args[0]==='id'&&c.args[1]==='team'&&['create','register','set-server','invite','accept-invite'].includes(c.args[2]));

for(const action of ['create','resume']) test(`${action} uses its selected root despite an unreadable default root`,t=>{
  const f=fixture(t);
  writeFileSync(join(f.root,'.aw','teams.json'),'not-json');
  if(action==='resume'){f.targetIdentity();f.joinMapping();}
  const before=readFileSync(join(f.root,'.aw','teams.json'),'utf8');
  const r=f.run(action==='create'?create:resume);
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/readiness: ready/);
  assert.ok(r.stdout.includes(f.target));
  assert.match(r.stdout,/from (?:roots\[team\]|the deployment's per-team directory)/);
  assert.ok(!f.fake.readCalls().some(c=>c.cwd===f.root&&identityRead(c)),JSON.stringify(f.fake.readCalls()));
  assert.equal(readFileSync(join(f.root,'.aw','teams.json'),'utf8'),before);
  assert.ok(existsSync(join(f.target,'.aw','workspace.yaml')));
});

for(const action of ['create','resume']) for(const unreadable of [false,true]) test(`${action} refuses a ${unreadable?'unreadable':'wrong-team'} selected root before effects`,t=>{
  const f=fixture(t);f.targetIdentity(unreadable?TEAM:DEFAULT);
  if(unreadable)writeFileSync(join(f.target,'.aw','teams.json'),'not-json');
  if(action==='resume')f.joinMapping();
  const before=readFileSync(join(f.base,'oats-local.yaml'),'utf8');
  const r=f.run(action==='create'?create:resume);
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.ok((r.stdout+r.stderr).includes(f.target));
  assert.ok(!f.fake.readCalls().some(mutation),JSON.stringify(f.fake.readCalls()));
  assert.equal(readFileSync(join(f.base,'oats-local.yaml'),'utf8'),before);
});

test('explicit create values avoid default-root alias and service reads',t=>{
  const f=fixture(t);
  writeFileSync(join(f.root,'.aw','teams.json'),'not-json');
  writeFileSync(join(f.root,'.aw','workspace.yaml'),'aweb_url: https://wrong.example.test\n');
  const r=f.run(create,{AW_WHOAMI_FAIL:'1'});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.ok(!f.fake.readCalls().some(c=>c.cwd===f.root&&identityRead(c)));
  assert.ok(f.fake.readCalls().find(c=>c.args[2]==='accept-invite').args.includes('--name=host'));
  assert.ok(readFileSync(join(f.target,'.aw','workspace.yaml'),'utf8').includes(SERVICE));
});

test('an unavailable needed alias locator refuses before create and teaches --name',t=>{
  const f=fixture(t);writeFileSync(join(f.root,'.aw','teams.json'),'not-json');
  const r=f.run(create.slice(0,-2),{AW_WHOAMI_FAIL:'1'});
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stderr,/--name <alias>/);
  assert.ok(!f.fake.readCalls().some(mutation));
});

test('an unavailable needed service locator refuses before create and teaches AWEB_URL',t=>{
  const f=fixture(t);writeFileSync(join(f.root,'.aw','teams.json'),'not-json');
  const r=f.run(create,{AWEB_URL:''});
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stderr,/AWEB_URL/);
  assert.ok(!f.fake.readCalls().some(mutation));
});

test('bare API-key setup refuses another team root and names both explicit destinations',t=>{
  const f=fixture(t);
  writeFileSync(join(f.root,'.aw','teams.json'),JSON.stringify({memberships:[{team_id:TEAM}]}));
  const r=f.run(['setup'],{AWEB_API_KEY:'SECRET-KEY'});
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.ok(r.stderr.includes(DEFAULT));assert.ok(r.stderr.includes(f.root));
  assert.match(r.stderr,/from root/);assert.match(r.stderr,/roots\[/);
  assert.ok(r.stderr.includes(join(f.base,'.aweb-roots','default')));
  assert.ok(!f.fake.readCalls().some(mutation));
  assert.doesNotMatch(r.stdout+r.stderr,/SECRET-KEY/);
});

for(const label of ['', 'unmapped']) test(`bare API-key setup without a configured team gives the ${label?'unmapped-label':'no-team'} remedy`,t=>{
  const f=fixture(t);
  const r=f.run(['setup'],{AWEB_API_KEY:'SECRET-KEY',OATS_DEFAULT_TEAM:label,OATS_DEFAULT_TEAM_ID:'',OATS_DEFAULT_TEAM_FROM:'',OATS_WORKSPACE_NAME:'fixture'});
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stderr,/no team is configured/);
  assert.ok(r.stderr.includes(`${f.root} (from root)`),r.stderr);
  assert.match(r.stderr,label?/default team unmapped has no provider id yet/:/no teams configured: run `oats aweb setup`/);
  assert.ok(!f.fake.readCalls().some(mutation));
  assert.doesNotMatch(r.stdout+r.stderr,/does not normalize|SECRET-KEY/);
});

test('bare API-key setup keeps bootstrap for a root with confirmed empty membership',t=>{
  const f=fixture(t);rmSync(join(f.root,'.aw','identity.yaml'));
  writeFileSync(join(f.root,'.aw','teams.json'),JSON.stringify({memberships:[]}));
  const r=f.run(['setup'],{AWEB_API_KEY:'SECRET-KEY',AW_FAKE_TEAM:DEFAULT});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/readiness: ready/);
  const init=f.fake.readCalls().filter(c=>c.args[0]==='init');
  assert.equal(init.length,1);assert.equal(init[0].cwd,f.root);assert.equal(init[0].hasApiKey,true);
  assert.doesNotMatch(r.stdout+r.stderr,/SECRET-KEY/);
});

for(const source of ['root','roots[team]','the workspace directory']) test(`successful bare setup reports ${source} as its root source`,t=>{
  const f=fixture(t),settings=source==='root'?{root:f.root}:source==='roots[team]'?{roots:{[DEFAULT]:f.root}}:{};
  if(source==='the workspace directory') {
    mkdirSync(join(f.base,'.aw'));writeFileSync(join(f.base,'.aw','teams.json'),JSON.stringify({memberships:[{team_id:DEFAULT}]}));
  }
  const r=f.run(['setup'],{OATS_SETTINGS:JSON.stringify(settings)});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/readiness: ready/);
  assert.ok(r.stdout.includes(`from ${source}`),r.stdout);
});

test('successful username setup reports the source of its selected account root',t=>{
  const f=fixture(t);f.kernel.set({...f.kernel.read(),teams:[],defaultTeam:null});
  const r=f.run(['setup','--username','fixture-user','--name','host','--label','joined'],{OATS_SETTINGS:JSON.stringify({root:f.target})});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.ok(r.stdout.includes(f.target));assert.match(r.stdout,/from root/);
});

test('successful invited join names the selected target source in human output',t=>{
  const f=fixture(t);f.joinMapping();
  const r=f.run(['setup','--join','joined','--invite-stdin','--name','host','--service',SERVICE],{},'FIXTURE-INVITE\n');
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.ok(r.stdout.includes(`${f.target} (from the deployment's per-team directory)`),r.stdout);
});

test('bare setup truthfully names an absent default identity and keeps onboarding remedies',t=>{
  const f=fixture(t);rmSync(join(f.root,'.aw'),{recursive:true});
  const r=f.run(['setup']);
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/default root has no identity yet/i);
  assert.match(r.stdout,/--username|AWEB_API_KEY/);
  assert.match(r.stdout,/--join/);
  assert.doesNotMatch(r.stdout,/Workspace initialized/);
  assert.ok(!f.fake.readCalls().some(identityRead));
});

for(const source of ['settings.oats.aweb.root',`settings.oats.aweb.roots["${DEFAULT}"]`,'the workspace directory']) test(`doctor's existing missing-root diagnostic names ${source}`,t=>{
  const f=fixture(t),settings=source==='settings.oats.aweb.root'?{root:f.target}:source==='the workspace directory'?{}:{roots:{[DEFAULT]:f.target}};
  const request={schemaVersion:1,phase:'check',slot:'messaging',capability:'oats.aweb',settings:{delivery:'session',...settings},
    input:{action:{kind:'readiness'},context:{kind:'workspace',workspace:f.base,deployment:f.base,soul:'dev'}}};
  const r=spawnSync(process.execPath,[BINDING,'check'],{cwd:f.base,env:f.env,input:JSON.stringify(request),encoding:'utf8',timeout:15000});
  assert.equal(r.status,0,r.stdout+r.stderr);
  const doc=JSON.parse(r.stdout);assert.equal(doc.ok,true);
  const problem=doc.result.problems.find(p=>p.message.startsWith('no messaging root at '));
  assert.ok(problem,r.stdout);assert.ok(problem.message.includes(`from ${source}`),problem.message);
  assert.deepEqual(Object.keys(doc.result).sort(),['problems','status','warnings']);
});
