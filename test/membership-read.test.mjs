import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fakeAwSetupPath} from './helpers/fake-aw-setup.mjs';
import {currentRootQuery} from './helpers/current-root-query.mjs';
import {fakeKernelTeamConfig,joinKernelEnvironment} from './helpers/fake-kernel-team-config.mjs';

const HOOK=fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs',import.meta.url));
const TEAM='t:example.test',OTHER='wider:example.test';
function fixture(t) {
  const base=realpathSync(mkdtempSync(join(tmpdir(),'membership-read-')));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const root=join(base,'root'),home=join(base,'home');
  mkdirSync(join(root,'.aw'),{recursive:true});mkdirSync(home);
  writeFileSync(join(base,'oats-local.yaml'),'schemaVersion: 2\nworkspace: local\n');
  const file=join(root,'.aw','teams.json');
  writeFileSync(file,JSON.stringify({memberships:[{team_id:TEAM}]}));
  const fake=fakeAwSetupPath(t),settings={root};
  const env={HOME:base,PATH:fake.path,OATS_TEAM_SCOPE:base,OATS_WORKSPACE:base,OATS_HOME:home,OATS_INSTANCE:'probe',
    OATS_DEFAULT_TEAM:'default',OATS_DEFAULT_TEAM_ID:TEAM,OATS_DEFAULT_TEAM_FROM:'deployment',
    OATS_TEAMS:JSON.stringify([{label:'default',team:TEAM,default:true,from:'local'},{label:'wider',team:OTHER,from:'shared'}]),
    OATS_SETTINGS:JSON.stringify(settings)};
  const run=(args,extra={})=>{
    const r=spawnSync(process.execPath,[HOOK,...args],{cwd:base,encoding:'utf8',env:{...env,...extra},timeout:15000});
    let doc;try {doc=JSON.parse(r.stdout.trim().split('\n').at(-1));}catch{doc=undefined;}
    return {...r,doc};
  };
  return {base,root,home,file,fake,settings,env,run};
}
const failureModes=[
  {AW_LIST_ERROR:'dial tcp: connection refused SECRET-NATIVE-OUTPUT'},
  {AW_LIST_TEAMS:'SECRET-NATIVE-OUTPUT'},
  {AW_LIST_TEAMS:'{}'},
  {AW_LIST_TEAMS:'{"memberships":{}}'},
  {AW_LIST_TEAMS:'{"memberships":[{"team_id":null}]}'},
  {AW_LIST_TEAMS:'{"memberships":[{"team_id":"bogus"}]}'},
];
for (const [i,mode] of failureModes.entries()) test(`setup membership read failure ${i} refuses before init or invite`,t=>{
  const f=fixture(t),before=readFileSync(f.file,'utf8');
  const r=f.run(['setup'],{...mode,AWEB_API_KEY:'SECRET-API-KEY'});
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stderr,/could not check membership/i);
  assert.doesNotMatch(r.stdout+r.stderr,/SECRET-|not a member|no membership matching|ask its owner/);
  if(mode.AW_LIST_ERROR) assert.match(r.stderr,/network or TLS failure/);
  assert.equal(readFileSync(f.file,'utf8'),before);
  assert.ok(f.fake.readCalls().every(c=>c.args[0]==='team'&&c.args[1]==='list'));
});

test('check-only distinguishes confirmed nonmembership from unreadable membership',t=>{
  const f=fixture(t);
  const absent=f.run(['setup','--check-only','--json'],{AW_LIST_TEAMS:'{"memberships":[]}'});
  assert.equal(absent.status,0,absent.stderr);assert.equal(absent.doc.member,false);
  const unread=f.run(['setup','--check-only','--json'],failureModes[0]);
  assert.equal(unread.status,1);assert.equal(unread.doc.member,null);
  assert.deepEqual(Object.keys(unread.doc).sort(),Object.keys(absent.doc).sort());
  assert.match(unread.stderr,/could not check membership.*network or TLS failure/i);
  assert.doesNotMatch(unread.stderr,/SECRET-/);
});

test('a shared-root read failure is never an invitation remedy',t=>{
  const f=fixture(t),wider=join(f.base,'wider');mkdirSync(join(wider,'.aw'),{recursive:true});
  writeFileSync(join(wider,'.aw','teams.json'),'not-json');
  const r=f.run(['setup'],{OATS_SETTINGS:JSON.stringify({root:f.root,roots:{[OTHER]:wider}})});
  assert.equal(r.status,1);assert.match(r.stderr,/could not check membership/);
  assert.doesNotMatch(r.stdout+r.stderr,/not a member|ask its owner|--invite/);
  assert.ok(!f.fake.readCalls().some(c=>c.args[0]==='init'||c.args[1]==='invite'));
});

for(const labelled of [false,true]) test(`roster prints a normal membership refusal for ${labelled?'labelled':'recorded'} team`,t=>{
  const f=fixture(t);
  writeFileSync(f.file,'not-json');
  const r=f.run(['roster',...(labelled?['--label','wider']:[])],{
    OATS_SETTINGS:JSON.stringify({root:f.root,roots:{[OTHER]:f.root}}),
    OATS_META:JSON.stringify({defaultTeam:{label:'wider',team:OTHER}}),
  });
  assert.equal(r.status,1);
  assert.equal(r.stdout,'');
  assert.match(r.stderr,/^oats aweb roster: could not check membership/);
  assert.doesNotMatch(r.stderr,/file:\/\/|^\s+at |^Error:/m);
  assert.ok(f.fake.readCalls().every(c=>c.args[0]==='team'&&c.args[1]==='list'));
});

for(const onDisk of [false,true]) test(`pending mint from ${onDisk?'disk':'metadata'} keeps its outcome when the fallback root is unreadable`,t=>{
  const f=fixture(t),intent={team:OTHER,alias:'probe',root:join(f.base,'gone-root')};
  mkdirSync(join(f.home,'.aw'));writeFileSync(join(f.home,'.aw','signing.key'),'fixture-key-kept');
  const marker=join(f.home,'.oats-aweb','pending-mint.json');
  const recorded=JSON.stringify({schemaVersion:1,...intent});
  if(onDisk) {mkdirSync(join(f.home,'.oats-aweb'));writeFileSync(marker,recorded);}
  writeFileSync(f.file,'not-json');
  const r=f.run(['retire'],{
    OATS_SETTINGS:JSON.stringify({root:f.root,roots:{[OTHER]:f.root}}),
    OATS_META:JSON.stringify(onDisk?{}:{pendingMint:intent}),
  });
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.ok(r.doc,'retire must return metadata even when root selection fails: '+r.stderr);
  assert.equal(r.doc.meta.retired,false);
  assert.equal(r.doc.meta.reason,'mint-outcome-unknown');
  assert.deepEqual(r.doc.meta.pendingMint,intent);
  assert.match(r.doc.warning,/could not check membership/);
  assert.ok(r.doc.warning.includes(`aw id team members --team-id=${OTHER} --json`));
  assert.match(r.doc.warning,/home and its record of the mint are kept/);
  assert.doesNotMatch(r.stderr,/file:\/\/|^\s+at |^Error:/m);
  assert.equal(readFileSync(join(f.home,'.aw','signing.key'),'utf8'),'fixture-key-kept');
  if(onDisk) assert.equal(readFileSync(marker,'utf8'),recorded);
  assert.ok(f.fake.readCalls().every(c=>c.args[0]==='wake'||(c.args[0]==='team'&&c.args[1]==='list')));
});

for(const action of ['create','join']) test(`setup ${action} refuses an unreadable default root before any effect`,t=>{
  const f=fixture(t),before=readFileSync(join(f.base,'oats-local.yaml'),'utf8');
  const env=joinKernelEnvironment(f.env,f.base);
  const args=action==='create'?['--create','wider','--namespace','example.test']:['--join','wider','--service','https://service.example.test/api'];
  const r=f.run(['setup',...args,'--json'],{...env,AW_FAKE_VERSION:'1.36.56',AW_LIST_TEAMS:'{}'});
  const output=r.stdout+r.stderr;
  assert.equal(r.status,1,output);
  assert.match(output,/configured default root/);
  assert.ok(output.includes(f.root));
  assert.match(output,/make that root's membership readable/);
  assert.ok(output.includes('oats teams default <label>'));
  assert.match(output,/nothing was created or redeemed/);
  assert.deepEqual(f.fake.readCalls().map(c=>c.args),[['team','list','--json']]);
  assert.equal(readFileSync(join(f.base,'oats-local.yaml'),'utf8'),before);
});

test('create skips an absent default identity but refuses an existing unreadable one',t=>{
  for(const existing of [false,true]) {
    const f=fixture(t),created='created:example.test',target=join(f.base,'.aweb-roots','created');
    if(!existing) rmSync(join(f.root,'.aw'),{recursive:true});
    const kernel=fakeKernelTeamConfig(join(f.base,'create-kernel'),f.base,{
      teams:[{label:'default',team:TEAM,from:'local'}],defaultTeam:{label:'default',team:TEAM,from:'deployment'},
    });
    const cli=join(f.base,'create-kernel.mjs');
    writeFileSync(cli,`#!${process.execPath}\nimport ${JSON.stringify(kernel.cli)};`,{mode:0o755});
    const r=f.run(['setup','--create','created','--namespace','example.test','--name','host'],{
      OATS_CLI_BIN:cli,AW_FAKE_TEAM:created,AW_FAKE_VERSION:'1.36.56',AWEB_URL:'https://service.example.test',
      AW_LIST_ERROR:'current identity is missing .aw/teams.yaml; join a team first',
    });
    if(existing) {
      assert.equal(r.status,1,r.stdout+r.stderr);
      assert.match(r.stderr,/could not check membership/);
      assert.match(r.stderr,/nothing was created or redeemed/);
      assert.deepEqual(f.fake.readCalls().map(c=>c.args),[['team','list','--json']]);
      assert.ok(!kernel.read().teams.some(row=>row.label==='created'));
      assert.ok(!readFileSync(join(f.base,'oats-local.yaml'),'utf8').includes(created));
      assert.ok(!f.fake.readCalls().some(c=>c.args.includes('create')));
    } else {
      assert.equal(r.status,0,r.stdout+r.stderr);
      assert.ok(r.stdout.includes(`✓ created ${created}`));
      assert.ok(kernel.read().teams.some(row=>row.label==='created'&&row.team===created));
      assert.ok(readFileSync(join(f.base,'oats-local.yaml'),'utf8').includes(target));
      assert.ok(readFileSync(join(target,'.aw','workspace.yaml'),'utf8').includes('https://service.example.test'));
      assert.ok(!f.fake.readCalls().some(c=>c.cwd===f.root&&c.args[0]==='team'&&c.args[1]==='list'));
    }
  }
});

for(const closed of [false,true]) test(`create reports completed work before an unreadable verdict with local teams ${closed?'closed':'allowed'}`,t=>{
  const f=fixture(t),created='created:example.test',target=join(f.base,'.aweb-roots','created');
  const kernel=fakeKernelTeamConfig(join(f.base,'create-kernel'),f.base,{
    localTeams:!closed,teams:[{label:'default',team:TEAM,from:'local'}],defaultTeam:{label:'default',team:TEAM,from:'deployment'},
  });
  const cli=join(f.base,'create-kernel.mjs');
  writeFileSync(cli,`#!${process.execPath}\nimport ${JSON.stringify(kernel.cli)};`,{mode:0o755});
  const r=f.run(['setup','--create','created','--namespace','example.test','--name','host'],{
    OATS_CLI_BIN:cli,AW_FAKE_TEAM:created,AW_FAKE_VERSION:'1.36.56',AWEB_URL:'https://service.example.test',
    AW_LIST_ERROR:'connection refused SECRET-POST-CREATE',AW_LIST_ERROR_AFTER:'1',
  });
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.ok(r.stdout.includes(`✓ created ${created}, accepted it into ${target}, recorded roots[${created}]`),r.stdout+r.stderr);
  assert.match(r.stderr,/could not check membership.*network or TLS failure/);
  assert.doesNotMatch(r.stdout+r.stderr,/SECRET-/);
  assert.match(readFileSync(join(f.base,'oats-local.yaml'),'utf8'),/created:example\.test/);
  assert.ok(readFileSync(join(target,'.aw','workspace.yaml'),'utf8').includes('https://service.example.test'));
  if(closed) {
    assert.match(r.stdout,/commit the team in oats-workspace.yaml/);
    assert.ok(!kernel.calls().some(c=>c.args[1]==='add'));
  } else {
    assert.ok(kernel.read().teams.some(row=>row.label==='created'&&row.team===created));
    assert.match(r.stdout,/recorded local team created/);
  }
});

for(const plan of [false,true]) test(`current-root membership read failure refuses ${plan?'plan without a false row':'join before mint'}`,t=>{
  const f=fixture(t),query=currentRootQuery(f.base,{home:f.home,deployment:f.base,settings:{roots:{[OTHER]:f.root}}});
  const r=f.run(['join','--labels','wider','--json',...(plan?['--plan']:[])],{OATS_CLI_BIN:query.cli,...failureModes[0]});
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stdout+r.stderr,/E_SETUP_MEMBERSHIP/);
  assert.match(r.stdout+r.stderr,/could not check membership/);
  assert.doesNotMatch(r.stdout+r.stderr,/SECRET-|"member":false|appropriate owner invite/);
  assert.ok(!f.fake.readCalls().some(c=>c.args[1]==='invite'));
});

for(const hostUnknown of [true,false]) test(`connect stops on ${hostUnknown?'host':'local'} unreadable membership before mint`,t=>{
  const f=fixture(t),cli=join(f.base,'route.cjs');
  writeFileSync(cli,`#!${process.execPath}\nconsole.log(JSON.stringify({aw:{status:'ok',version:'1.36.33'},defaultTeam:{label:'default',team:${JSON.stringify(TEAM)}},member:${hostUnknown?'null':'false'},root:'/host/root'}));process.exit(${hostUnknown?1:0});`,{mode:0o755});
  const r=f.run(['connect','remote','--json'],{OATS_CLI_BIN:cli,...failureModes[0]});
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.equal(r.doc.error.code,'E_SETUP_MEMBERSHIP');
  assert.match(r.doc.error.message,/could not check.*membership/i);
  assert.doesNotMatch(r.stdout+r.stderr,/SECRET-|not a member/);
  assert.ok(!f.fake.readCalls().some(c=>c.args[1]==='invite'));
});
