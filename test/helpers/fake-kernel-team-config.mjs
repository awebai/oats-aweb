// Stateful public CLI fixture; only its private JSON is mutated, never a real deployment.
// Its answers follow the real kernel's: `oats --version --json` is the
// unenveloped version document (bin/oats.mjs), `teams --json` the teams
// document, and `teams add|default` the verbs of lib/teams-verbs.mjs, all of
// @awebai/oats 0.50.0. `teams-conditional-default` (OATS 0.48.0) is in the
// feature list unless `version` names an older kernel: `0.42.0` answers with
// the 0.42.0 kernel's feature list, which lacks it.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
export function fakeKernelTeamConfig(dir, deployment, { version = '0.50.0', ...initial } = {}) {
  mkdirSync(dir, { recursive: true });
  const state = join(dir, 'team-state.json'), calls = join(dir, 'calls.jsonl'), cli = join(dir, 'kernel.mjs');
  writeFileSync(state, JSON.stringify({ teamsApi: 2, deployment, localTeams: true, defaultTeam: null, teams: [], problems: [], ...initial }));
  const features = version === '0.42.0' ? FEATURES_0_42_0 : [...FEATURES_0_42_0, 'teams-conditional-default'];
  writeFileSync(cli, `import fs from 'node:fs';
const args=process.argv.slice(2),file=${JSON.stringify(state)},calls=${JSON.stringify(calls)};
const doc=JSON.parse(fs.readFileSync(file,'utf8'));
fs.appendFileSync(calls,JSON.stringify({args,cwd:process.cwd(),ambientAgent:process.env.OATS_AGENT,ambientHome:process.env.OATS_HOME,awebEnv:Object.keys(process.env).filter(k=>/^(AWEB_|AWID_)/.test(k))})+'\\n');
const fail=()=>{console.log(JSON.stringify({schemaVersion:1,ok:false,error:{code:'E_LOCAL_CHANGED',message:'SECRET_KERNEL_BODY'}}));process.exit(1);};
const refuse=(code,details)=>{console.log(JSON.stringify({schemaVersion:1,ok:false,error:{code,message:code,details}}));process.exit(1);};
if(args[0]==='--version'){
 console.log(JSON.stringify({schemaVersion:1,name:'@awebai/oats',version:${JSON.stringify(version)},desktopApi:1,features:${JSON.stringify(features)}}));
}else if(args[1]==='add'||args[1]==='default'){
 const verb=args[1];if(doc.failure===verb+'-before')fail();
 if(doc.localTeams===false)refuse('E_WORKSPACE_SCHEMA',{reason:'local-teams-closed'});
 const label=args[2],team=args.find(a=>a.startsWith('--team='))?.slice(7);
 if(verb==='add'){
  const noDefault=args.includes('--no-default'),existing=doc.teams.find(r=>r.label===label);
  if(existing&&noDefault&&existing.team===team){console.log(JSON.stringify({schemaVersion:1,ok:true,result:{changed:false,reused:true}}));process.exit(0);}
  if(existing)refuse('E_TEAM_EXISTS',{label,from:existing.from,observed:existing});
  doc.teams.push({label,team,from:'local'});
  // The first team added becomes the LOCAL default, which wins over the workspace's.
  if(!noDefault&&(doc.defaultTeam===null||doc.defaultTeam.from==='workspace'))doc.defaultTeam={label,team,from:'deployment'};
 }else{
  const row=doc.teams.find(r=>r.label===label);if(!row)refuse('E_TEAM_UNKNOWN',{label});
  if(args.includes('--if-absent')&&doc.defaultTeam!==null)refuse('E_TEAM_DEFAULT_MISMATCH',{expected:{absent:true},observed:doc.defaultTeam});
  doc.defaultTeam={label,team:row.team,from:'deployment'};
 }
 doc.lastMutation=verb;fs.writeFileSync(file,JSON.stringify(doc));
 if(doc.failure===verb+'-after')fail();
 console.log(JSON.stringify({schemaVersion:1,ok:true,result:{changed:true}}));
}else{
 if(doc.queryChanges){
  doc.queryCount=(doc.queryCount||0)+1;
  const change=doc.queryChanges[doc.queryCount];if(change)Object.assign(doc,change);
  fs.writeFileSync(file,JSON.stringify(doc));
 }
 if(doc.failure==='query'||doc.failure==='readback-'+doc.lastMutation)fail();
 console.log(JSON.stringify({schemaVersion:1,ok:true,result:doc}));
}
`);
  return { cli, state, read: () => JSON.parse(readFileSync(state, 'utf8')), set: value => writeFileSync(state, JSON.stringify(value)), calls: () => existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [] };
}

// Older direct-hook setup tests supply dispatch facts rather than running the
// public dispatcher. Give those fixtures an explicit, stateful selected query.
export function joinKernelEnvironment(env, deployment) {
  if (env.OATS_CLI_BIN) return env;
  const dir = join(deployment, '.fixture-kernel');
  const cli = join(dir, 'kernel.mjs');
  if (!existsSync(cli)) {
    const teams = JSON.parse(env.OATS_TEAMS || '[]');
    const label = env.OATS_DEFAULT_TEAM, team = env.OATS_DEFAULT_TEAM_ID;
    if (label && !teams.some(r => r.label === label)) teams.push({ label, team: team || null, from: 'local' });
    fakeKernelTeamConfig(dir, deployment, { teams,
      defaultTeam: label ? { label, team: team || null, from: 'deployment' } : null });
  }
  return { ...env, OATS_CLI_BIN: cli };
}

/** `oats --version --json` features of the 0.42.0 kernel (bb2ba8c9). */
const FEATURES_0_42_0 = ['retire-home', 'session-start', 'session-restart', 'launch-config', 'schedule', 'schedule-host-caps', 'session-upload', 'operations', 'instance-git', 'instance-git-remote', 'souls-declarations', 'lifecycle-plans', 'retire-retention', 'readiness', 'spawn-preview', 'instance-events', 'instance-events-2', 'schedule-history', 'schedule-read-2', 'spawn-preview-2', 'spawn-idempotency', 'spawn-idempotency-2', 'spawn-apply-2', 'workspace-v2', 'instance-modules', 'spawn-provider-payload', 'served-identity', 'packages-no-approval', 'spawn-name', 'settings-origins', 'team-model-3', 'settings-declared', 'capabilities-private', 'layers-from', 'harness', 'package-souls', 'triggers', 'automations', 'desktop-facts', 'launch-preference', 'preview-composed-from', 'observe-max-age', 'spawn-preview-max-age', 'launch-config-default', 'capability-show', 'capture-file', 'workspace-identity', 'server-connect', 'capability-route', 'servers-per-workspace', 'operator-default-soul', 'waiting-on-you'];
