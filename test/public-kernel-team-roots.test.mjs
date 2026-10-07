// Opt-in actual public kernel dispatch, with local git inputs and inert aw only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeAwSetupPath } from './helpers/fake-aw-setup.mjs';
const packageRoot=fileURLToPath(new URL('../oats-package',import.meta.url));
test('pinned public operator dispatch supplies deployment independently of nested minting root', {timeout:120000}, t=>{
 const kernel=process.env.OATS_HOST_ONLY_KERNEL_ROOT;
 if(!kernel){if(process.env.OATS_HOST_ONLY_REQUIRED==='1')assert.fail('pinned kernel required');t.skip('requires pinned bb2ba8c public kernel checkout');return;}
 assert.equal(execFileSync('git',['-C',kernel,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'bb2ba8c9a254edb745913b9c5a9d9b833fda932d');
 const base=realpathSync(mkdtempSync(join(tmpdir(),'public-team-roots-')));t.after(()=>rmSync(base,{recursive:true,force:true}));
 const host=join(base,'source'),dep=join(base,'deployment'),root=join(dep,'.aweb-roots','default'),privateHome=join(base,'home');
 mkdirSync(join(host,'souls','probe'),{recursive:true});mkdirSync(join(root,'.aw'),{recursive:true});mkdirSync(privateHome);
 const fake=fakeAwSetupPath(t),env={PATH:`${fake.path}:${dirname(process.execPath)}:/usr/bin:/bin`,HOME:privateHome,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',OATS_REMOTE_CACHE:join(base,'cache'),AW_NO_UPDATE_CHECK:'1',AW_FAKE_TEAM:'joined:example.invalid',OATS_AGENT:'spoofed-ambient-soul'};
 const git=(...args)=>execFileSync('git',['-C',host,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null',...args],{env,encoding:'utf8'}).trim();
 const ref=pathToFileURL(host).href;
 writeFileSync(join(host,'oats-workspace.yaml'),`schemaVersion: 2\nname: fixture\nmembers:\n  - ${ref}\nteams:\n  default: { team: 'default:example.invalid' }\n  joined: { team: 'joined:example.invalid' }\n  unrelated: {}\ndefaultTeam: default\nlocalTeams: true\ndefaults:\n  messaging:\n    oats.aweb: { from: local/${host} }\n`);
 writeFileSync(join(host,'oats-membership.yaml'),`schemaVersion: 2\nworkspace: ${ref}\n`);
 writeFileSync(join(host,'souls/probe/soul.yaml'),'schemaVersion: 2\nname: probe\ndescription: probe\nwork: directory\n');writeFileSync(join(host,'souls/probe/AGENTS.md'),'Fixture only.\n');
 cpSync(join(packageRoot,'capabilities','oats-aweb'),join(host,'capabilities','oats-aweb'),{recursive:true});
 git('init','-q');git('add','.');git('commit','-qm','isolated fixture');
 writeFileSync(join(dep,'oats-local.yaml'),`schemaVersion: 2\nworkspace: ${ref}\nsettings:\n  oats.aweb:\n    root: ${root}\n`);
 writeFileSync(join(root,'.aw','teams.json'),'{"memberships":[{"team_id":"default:example.invalid"}]}');
 const run=(args,extra={},cwd=dep)=>spawnSync(process.execPath,[join(kernel,'bin/oats.mjs'),...args],{cwd,env:{...env,...extra},encoding:'utf8',timeout:30000});
 let r=run(['aweb','setup','--soul','probe','--join','joined','--invite','FIXTURE-TOKEN','--name','host','--service','https://service.invalid']);
 assert.equal(r.status,0,r.stdout+r.stderr);assert.ok(existsSync(join(dep,'.aweb-roots','joined','.aw','workspace.yaml')));assert.ok(!existsSync(join(root,'.aweb-roots')));
 assert.match(readFileSync(join(dep,'oats-local.yaml'),'utf8'),/"joined:example.invalid"/);
 // Old public dispatcher inherits this caller variable: provider must refuse it.
 const before=fake.readCalls().length;
 r=run(['aweb','setup','--soul','probe','--join','other','--invite','FIXTURE-TOKEN'],{OATS_WORKSPACE:root});
 assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stderr,/deployment.*inconsistent/);assert.equal(fake.readCalls().length,before);
 // Confirm the real public shape: an unmapped non-default label is a warning.
 r=run(['teams','--dir',dep,'--json']);assert.equal(r.status,0,r.stdout+r.stderr);
 assert.ok(JSON.parse(r.stdout).result.problems.some(p=>p.code==='team-unmapped'&&p.severity==='warning'&&p.label==='unrelated'));
 // Public dispatch of invitation planning must read the selected root and never mint.
 const invitesBefore=fake.readCalls().filter(c=>c.args?.[0]==='team'&&c.args?.[1]==='invite').length;
 r=run(['aweb','invite','--soul','probe','--plan','--json']);
 assert.equal(r.status,0,r.stdout+r.stderr);
 const plan=JSON.parse(r.stdout);assert.equal(plan.ok,true);assert.equal(plan.result.team,'default:example.invalid');assert.equal(plan.result.root,root);assert.equal(plan.result.plan,true);assert.equal(plan.result.token,undefined);
 assert.equal(fake.readCalls().filter(c=>c.args?.[0]==='team'&&c.args?.[1]==='invite').length,invitesBefore);
 // Fresh hosted username setup plans without effects, then uses public team verbs.
 const fresh=join(base,'fresh-deployment'),freshRoot=join(fresh,'root');mkdirSync(fresh);
 writeFileSync(join(fresh,'oats-local.yaml'),`schemaVersion: 2\nworkspace: ${ref}\nsettings:\n  oats.aweb:\n    root: ${freshRoot}\n`);
 const setupArgs=['aweb','setup','--soul','probe','--dir',fresh,'--username','alice','--name','root-1','--json'];
 r=run([...setupArgs,'--plan'],{},fresh);assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout).result.plan,true);assert.equal(existsSync(freshRoot),false);
 r=run(setupArgs,{},fresh);assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout).result.team,'default:alice.aweb.ai');
 r=run(['teams','--dir',fresh,'--json']);assert.equal(r.status,0,r.stdout+r.stderr);const configured=JSON.parse(r.stdout).result;
 assert.equal(configured.defaultTeam.label,'alice');assert.equal(configured.defaultTeam.team,'default:alice.aweb.ai');
 const initializations=fake.readCalls().filter(c=>c.args[0]==='init').length;
 r=run(setupArgs,{},fresh);assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(fake.readCalls().filter(c=>c.args[0]==='init').length,initializations);
 // A real local default typo is a named failure, without exposing diagnostic text.
 const localPath=join(dep,'oats-local.yaml'),savedLocal=readFileSync(localPath,'utf8');
 writeFileSync(localPath,savedLocal+'\ndefaultTeam: typo\n');
 r=run(['teams','--dir',dep,'--json']);assert.equal(r.status,0,r.stdout+r.stderr);
 assert.ok(JSON.parse(r.stdout).result.problems.some(p=>p.code==='E_TEAM_UNKNOWN'&&p.severity==='failure'&&p.label==='typo'));
 const nativeBefore=fake.readCalls().length;
 // Exercise the provider query directly: public soul dispatch may itself refuse the typo.
 r=spawnSync(process.execPath,[join(packageRoot,'capabilities/oats-aweb/bin/oats-aweb.mjs'),'invite','--label','default','--plan','--json'],{cwd:dep,env:{...env,OATS_CLI_BIN:join(kernel,'bin/oats.mjs'),OATS_TEAM_SCOPE:dep,OATS_SETTINGS:JSON.stringify({root})},encoding:'utf8'});
 assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout).error.code,'E_INVITE_TEAM_QUERY');assert.match(JSON.parse(r.stdout).error.message,/E_TEAM_UNKNOWN/);assert.equal(fake.readCalls().length,nativeBefore);
 writeFileSync(localPath,savedLocal);
 // The actual public JSON seam, without trusting ambient OATS_AGENT.
 r=run(['inspect','--soul','probe','--dir',dep,'--json']);assert.equal(r.status,0,r.stdout+r.stderr);
 const doc=JSON.parse(r.stdout);assert.equal(doc.schemaVersion,1);assert.equal(doc.ok,true);assert.equal(doc.result.workspace.deployment,dep);assert.equal(doc.result.subject.kind,'soul');assert.notEqual(doc.result.subject.soul,'spoofed-ambient-soul');
 assert.equal(doc.result.capabilities.filter(c=>c.id==='oats.aweb').length,1);assert.equal(doc.result.capabilities.find(c=>c.id==='oats.aweb').settings.roots['joined:example.invalid'],join(dep,'.aweb-roots','joined'));
});
