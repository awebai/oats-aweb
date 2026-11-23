import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fakeWakeHost} from './helpers/fake-wake-host.mjs';
import {renderWakeUnit,wakeMain,wakeUnitPath} from '../oats-package/capabilities/oats-aweb/lib/wake-service.mjs';
import {renderUnit} from '../oats-package/capabilities/oats-aweb/lib/custody-unit.mjs';
import {healthHost} from '../oats-package/capabilities/oats-aweb/lib/health-host.mjs';
import {joinFromFake} from './helpers/fake-aw-join-from.mjs';

const hook=resolve('oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs');
function fixture(t) {
  const base=realpathSync(mkdtempSync(join(tmpdir(),'registry-setting-')));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const bin=join(base,'bin'), home=join(base,'home'), log=join(base,'calls');
  mkdirSync(bin);mkdirSync(home);mkdirSync(join(home,'.aw'));
  writeFileSync(join(base,'oats-local.yaml'),'schemaVersion: 2\nworkspace: fixture\nsettings:\n  unrelated: true\n');
  writeFileSync(join(bin,'aw'),`#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),registry:process.env.AWID_REGISTRY_URL})+'\\n'); if(process.argv[2]==='version')console.log('aw 1.36.58');else if(process.argv[2]==='wake')console.log('{}');else if(process.argv[2]==='workspace')console.log('{"alias_released":true,"alias_released_reason":"fixture"}');else process.exit(94);`);
  chmodSync(join(bin,'aw'),0o755);
  const env={PATH:`${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,HOME:base,OATS_HOME:home, OATS_INSTANCE_HOME:home,OATS_INSTANCE:'fixture',OATS_TEAM_SCOPE:base,OATS_WORKSPACE:base,OATS_WORKSPACE_NAME:'fixture',OATS_DEFAULT_TEAM:'default',OATS_DEFAULT_TEAM_ID:'t:example.invalid',OATS_SETTINGS:'{}',OATS_META:'{"alias":"fixture","runtime":"pi","delivery":"channel"}'};
  const run=(event,args=[],extra={})=>spawnSync(process.execPath,[hook,event,...args],{cwd:base,env:{...env,OATS_EVENT:event,...extra},encoding:'utf8'});
  return {base,home,env,run,local:()=>readFileSync(join(base,'oats-local.yaml'),'utf8'),calls:()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]};
}

test('setup --registry records one canonical operator setting without bootstrapping',t=>{
  const f=fixture(t),r=f.run('setup',['--registry','HTTP://[::1]:80/','--json'],{AWEB_API_KEY:'unused-fixture-key',AWID_REGISTRY_URL:'http://poison.invalid'});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(f.local(),/registry: "http:\/\/\[::1\]"/);
  assert.match(f.local(),/unrelated: true/);
  assert.equal(JSON.parse(r.stdout).result.registry,'http://[::1]');
  assert.match(r.stdout,/wake install/);assert.match(r.stdout,/resident create/);
  assert.deepEqual(f.calls(),[],'configuration does not bootstrap an account');
});

test('registry updates preserve unrelated mappings and refuse ambiguous YAML keys',t=>{
  const f=fixture(t),file=join(f.base,'oats-local.yaml');
  writeFileSync(file,'settings:\n  "oats.aweb":\n    "registry": "http://old.invalid"\n    roots:\n      team: /keep\n  unrelated: true\n');
  const r=f.run('setup',['--registry','https://new.invalid:443','--json']);
  assert.equal(r.status,0,r.stdout+r.stderr);assert.match(f.local(),/roots:\n      team: \/keep/);
  assert.match(f.local(),/registry: "https:\/\/new.invalid"/);assert.match(f.local(),/unrelated: true/);
  for(const text of ['settings:\n oats.aweb:\n','settings:\n  oats.aweb:\n      registry: http://old.invalid\n','settings :\n  oats.aweb:\n','settings:\n  oats.aweb:\n    registry : http://old.invalid\n','settings:\n  oats.aweb:\n    registry: http://one.invalid\n    "registry": http://two.invalid\n','settings:\n  oats.aweb:\n    registry: &pin http://old.invalid\n']) {
    writeFileSync(file,text);const refused=f.run('setup',['--registry','http://new.invalid','--json']);
    assert.equal(refused.status,1,refused.stdout+refused.stderr);assert.match(refused.stdout,/cannot safely update/);assert.equal(f.local(),text);
  }
  assert.deepEqual(f.calls(),[]);
});

test('registry plan and unsafe YAML never write or invoke aw',t=>{
  const f=fixture(t),before=f.local();
  const plan=f.run('setup',['--registry','http://127.0.0.1:18010','--plan','--json']);
  assert.equal(plan.status,0,plan.stdout+plan.stderr);assert.equal(f.local(),before);
  writeFileSync(join(f.base,'oats-local.yaml'),'settings: {oats.aweb: {root: /keep}}\n');
  const unsafe=f.run('setup',['--registry','http://127.0.0.1:18010','--json']);
  assert.equal(unsafe.status,1);assert.match(unsafe.stdout,/cannot safely update/);
  assert.equal(f.local(),'settings: {oats.aweb: {root: /keep}}\n');assert.deepEqual(f.calls(),[]);
});

test('spawn and join refuse the legacy ambient pin with the complete migration',t=>{
  for(const event of ['spawn','join']) {
    const f=fixture(t),r=f.run(event,[],{AWID_REGISTRY_URL:'http://127.0.0.1:18010'});
    assert.equal(r.status,1,r.stdout+r.stderr);
    assert.match(r.stdout+r.stderr,/registry-setting-required/);
    assert.match(r.stdout+r.stderr,/oats aweb setup --registry <origin>/);
    assert.match(r.stdout+r.stderr,/wake install/);assert.match(r.stdout+r.stderr,/resident create/);
    assert.deepEqual(f.calls(),[],'migration is checked before native calls');
  }
});

test('retire pins only the explicit registry and ignores a poisoned ambient origin',t=>{
  const f=fixture(t),r=f.run('retire',[],{AWID_REGISTRY_URL:'http://poison.invalid',OATS_SETTINGS:JSON.stringify({registry:'http://127.0.0.1:18010'})});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(f.calls().find(c=>c.args[0]==='workspace')?.registry,'http://127.0.0.1:18010');
  assert.ok(f.calls().filter(c=>['version','wake'].includes(c.args[0])).every(c=>c.registry===undefined));
});

test('LOCAL mint and session receive the configured pin while stored URLs stay locators',t=>{
  const f=fixture(t),root=join(f.base,'root'),registry='http://127.0.0.1:18010';
  mkdirSync(join(root,'.aw'),{recursive:true});writeFileSync(join(root,'.aw','teams.yaml'),'memberships:\n  - team_id: t:example.invalid\n    registry_url: http://stored.invalid\n');
  const aw=join(f.base,'bin','aw'),before=readFileSync(aw,'utf8');
  writeFileSync(aw,before.replace("if(process.argv[2]==='version')",`if((${joinFromFake.toString()})(process.argv.slice(2)))process.exit(0); if(process.argv[2]==='version')`));
  const r=f.run('spawn',[],{AWID_REGISTRY_URL:'http://poison.invalid',OATS_RUNTIME:'pi',OATS_SETTINGS:JSON.stringify({root,registry})});
  assert.equal(r.status,0,r.stdout+r.stderr);
  const init=f.calls().find(c=>c.args[0]==='init');assert.ok(init);assert.equal(init.registry,registry);
  assert.equal(JSON.parse(r.stdout).env.AWID_REGISTRY_URL,registry);
  assert.doesNotMatch(r.stdout,/stored.invalid|poison.invalid/);
});

test('one registry validator refuses unsupported forms without echoing input',async()=>{
  const {registryOrigin}=await import('../oats-package/capabilities/oats-aweb/lib/registry-setting.mjs');
  for(const raw of [null,3,'','local','ftp://fixture.invalid','http://user:SECRET@fixture.invalid','http://fixture.invalid/api','http://fixture.invalid/prefix','http://fixture.invalid?','http://fixture.invalid#','http://fixture.invalid?SECRET','http://fixture.invalid#SECRET','http://fixture.invalid/../','http:\\\\fixture.invalid','http://fixture.invalid\n']) {
    assert.throws(()=>registryOrigin({registry:raw}),e=>/settings.oats.aweb.registry/.test(e.message)&&!e.message.includes('SECRET'));
  }
  assert.equal(registryOrigin({registry:'HTTP://EXAMPLE.INVALID:80/'}),'http://example.invalid');
  assert.equal(registryOrigin({registry:'https://[::1]:443/'}),'https://[::1]');
  assert.equal(registryOrigin({}),undefined);
});

test('a printed registry assignment preserves IPv6 and quotes under a real shell',async()=>{
  const {registryOrigin,registryShellAssignment}=await import('../oats-package/capabilities/oats-aweb/lib/registry-setting.mjs');
  for(const value of ['http://[::1]:18010',"http://a'b.invalid"]) {
    const origin=registryOrigin({registry:value});
    const r=spawnSync('/bin/sh',['-c',registryShellAssignment(origin)+'; printf %s "$AWID_REGISTRY_URL"'],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,origin);
  }
});

test('readiness gives the same complete migration without promoting a saved GLOBAL URL',t=>{
  const f=fixture(t),custody=join(f.base,'resident');mkdirSync(join(custody,'.aw'),{recursive:true});
  writeFileSync(join(custody,'.aw','identity.yaml'),'registry_url: http://127.0.0.1:18010\n');
  const binding=resolve('oats-package/capabilities/oats-aweb/bin/oats-aweb-binding.mjs');
  const input={schemaVersion:1,phase:'check',slot:'messaging',capability:'oats.aweb',settings:{identity:{mode:'global',resident:'owner'},residents:{owner:custody}},input:{action:{kind:'readiness'},context:{kind:'workspace',workspace:'fixture',deployment:f.base,soul:'probe'}}};
  const r=spawnSync(process.execPath,[binding,'check'],{env:f.env,input:JSON.stringify(input),encoding:'utf8'});
  assert.match(r.stdout,/registry-setting-required/);assert.match(r.stdout,/oats aweb setup --registry <origin>/);
  assert.match(r.stdout,/wake install/);assert.match(r.stdout,/resident create/);
  for(const c of f.calls())assert.equal(c.registry,undefined);
});

test('the native default registry remains default with YAML quotes, comments or a DNS dot',async t=>{
  const {registryMigration}=await import('../oats-package/capabilities/oats-aweb/lib/registry-setting.mjs');
  const f=fixture(t);
  for(const value of ['https://api.awid.ai.','"https://api.awid.ai" # comment',"'https://api.awid.ai/' # comment"]) {
    writeFileSync(join(f.home,'.aw','identity.yaml'),`registry_url: ${value}\n`);
    assert.equal(registryMigration({}, {}, {custody:f.home}),undefined);
  }
});

test('health registry reads get the setting; local wake control does not',async t=>{
  const f=fixture(t),host=healthHost({deployment:f.home,env:{...f.env,AWID_REGISTRY_URL:'http://poison.invalid'},settings:{registry:'http://127.0.0.1:18010'}});
  await host.unreadCount(f.home);await host.wakeStatus();
  assert.equal(f.calls().find(c=>c.args.includes('mail'))?.registry,'http://127.0.0.1:18010');
  assert.equal(f.calls().find(c=>c.args[0]==='wake')?.registry,undefined);
});

for(const platform of ['darwin','linux'])test(`${platform} service invocations carry only the configured pin`,()=>{
  const common={platform,aw:'/bin/aw',path:'/bin',home:'/tmp/operator',registry:'http://[::1]:18010'};
  const wake=renderWakeUnit({...common,oats:'/bin/oats'}),custody=renderUnit({...common,label:'ai.aweb.custody.test',root:'/tmp/resident',address:'example.invalid/owner'});
  for(const text of [wake,custody])assert.match(text,/AWID_REGISTRY_URL[\s\S]*http:\/\/\[::1\]:18010/);
});

for(const platform of ['darwin','linux'])test(`${platform} wake reinstall refuses a conflicting pin before writes or manager mutations`,async t=>{
  const host=fakeWakeHost(t),file=wakeUnitPath({platform,home:host.home,xdgConfigHome:host.env.XDG_CONFIG_HOME});
  mkdirSync(dirname(file),{recursive:true});
  const before=renderWakeUnit({platform,aw:join(host.bin,'aw'),oats:join(host.bin,'oats'),path:host.env.PATH,home:host.home,registry:'http://127.0.0.1:18010'});
  writeFileSync(file,before);
  let output='';const code=await wakeMain(['install','--plan','--json'],{platform,env:{...host.env,OATS_SETTINGS:JSON.stringify({registry:'http://127.0.0.1:28010'})},print:(_fd,s)=>output+=s,uid:501,user:'alice'});
  assert.equal(code,1,output);assert.match(output,/E_WAKE_REGISTRY_CONFLICT/);
  assert.match(output,/one registry/);assert.match(output,/another host user/);assert.match(output,/deregister/);
  assert.doesNotMatch(output,/delivery: session/);assert.equal(readFileSync(file,'utf8'),before);assert.deepEqual(host.changes(),[]);
});


test('public ambient registry aliases remain harmless while private or malformed ambient values require migration', async () => {
  const {registryMigration, REGISTRY_MIGRATION} = await import('../oats-package/capabilities/oats-aweb/lib/registry-setting.mjs');
  for (const value of ['', 'https://api.awid.ai', 'https://api.awid.ai/api', 'HTTPS://API.AWID.AI.:443/api/']) {
    assert.equal(registryMigration({}, {AWID_REGISTRY_URL:value}), undefined, value);
  }
  for (const value of ['http://127.0.0.1:18010', 'https://private.invalid', 'not-a-url', 'https://api.awid.ai/other']) {
    assert.equal(registryMigration({}, {AWID_REGISTRY_URL:value}), REGISTRY_MIGRATION, value);
  }
});

for(const platform of ['darwin','linux'])test(`${platform} adding a pin names the effect on an unpinned wake daemon`,async t=>{
  const host=fakeWakeHost(t),file=wakeUnitPath({platform,home:host.home,xdgConfigHome:host.env.XDG_CONFIG_HOME});
  mkdirSync(dirname(file),{recursive:true});
  const before=renderWakeUnit({platform,aw:join(host.bin,'aw'),oats:join(host.bin,'oats'),path:host.env.PATH,home:host.home});
  writeFileSync(file,before);
  let output='';const code=await wakeMain(['install','--plan','--json'],{platform,env:{...host.env,OATS_SETTINGS:JSON.stringify({registry:'http://127.0.0.1:18010'})},print:(_fd,s)=>output+=s,uid:501,user:'alice'});
  assert.equal(code,1,output);assert.match(output,/currently unpinned/);assert.match(output,/every registration/);
  assert.match(output,/another host user/);assert.match(output,/deregister/);
  assert.equal(readFileSync(file,'utf8'),before);assert.deepEqual(host.changes(),[]);
});


test('a value-less or unknown leading global flag fails toward registry pinning', async () => {
  const {registryEnv} = await import('../oats-package/capabilities/oats-aweb/lib/registry-setting.mjs');
  const settings = {registry:'http://127.0.0.1:18010'};
  for (const args of [['aw','--json','id','team','members'], ['-q','id','team','members'], ['--future-global','version'], ['--future-global=value','version'], ['--identity-home']]) {
    assert.deepEqual(registryEnv(settings,args), {AWID_REGISTRY_URL:settings.registry}, JSON.stringify(args));
  }
  for (const args of [['--identity-home','/fixture/.aw','version'], ['--identity-home=/fixture/.aw','version']]) {
    assert.deepEqual(registryEnv(settings,args), {}, JSON.stringify(args));
  }
});

test('retire with an invalid registry reports no cleanup and the repair before any child or key removal', t => {
  const f = fixture(t), key = join(f.home,'.aw','signing.key');
  writeFileSync(key,'fixture authority retained');
  const r = f.run('retire',[],{OATS_SETTINGS:JSON.stringify({registry:'https://user:SECRET@registry.invalid'})});
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stdout,/nothing was cleaned/);
  assert.match(r.stdout,/settings\.oats\.aweb\.registry/);
  assert.match(r.stdout,/oats aweb setup --registry <origin>/);
  assert.match(r.stdout,/retry retire/);
  assert.doesNotMatch(r.stdout+r.stderr,/SECRET|user@|registry\.invalid/);
  // Kept for the retry, held where aw doesn't look (awebai/oats-aweb#318).
  assert.equal(existsSync(join(f.home,'.aw')),false);
  assert.equal(readFileSync(join(f.home,'.oats-aweb','held','.aw','signing.key'),'utf8'),'fixture authority retained');
  assert.deepEqual(f.calls(),[]);
});

test('P5 (aw who) is a registry read: the setting reaches it pinned, and nothing does unpinned', async () => {
  const {registryEnv} = await import('../oats-package/capabilities/oats-aweb/lib/registry-setting.mjs');
  const registry = 'https://registry.example.test';
  for (const args of [['aw','--identity-home','/fixture/.aw','who','--json'], ['--identity-home=/fixture/.aw','who','--json'], ['who','--json']]) {
    assert.deepEqual(registryEnv({registry},args), {AWID_REGISTRY_URL:registry}, JSON.stringify(args));
    assert.deepEqual(registryEnv({},args), {}, JSON.stringify(args));
  }
  assert.deepEqual(registryEnv({registry},['--identity-home','/fixture/.aw','who','--help']), {}, 'help reads no registry');
});
