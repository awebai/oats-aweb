// Stateful public CLI fixture; only its private JSON is mutated, never a real deployment.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
export function fakeKernelTeamConfig(dir, deployment, initial = {}) {
  mkdirSync(dir, { recursive: true });
  const state = join(dir, 'team-state.json'), calls = join(dir, 'calls.jsonl'), cli = join(dir, 'kernel.mjs');
  writeFileSync(state, JSON.stringify({ teamsApi: 2, deployment, localTeams: true, defaultTeam: null, teams: [], problems: [], ...initial }));
  writeFileSync(cli, `import fs from 'node:fs';
const args=process.argv.slice(2),file=${JSON.stringify(state)},calls=${JSON.stringify(calls)};
const doc=JSON.parse(fs.readFileSync(file,'utf8'));
fs.appendFileSync(calls,JSON.stringify({args,cwd:process.cwd(),ambientAgent:process.env.OATS_AGENT,ambientHome:process.env.OATS_HOME})+'\\n');
const fail=()=>{console.log(JSON.stringify({schemaVersion:1,ok:false,error:{code:'E_LOCAL_CHANGED',message:'SECRET_KERNEL_BODY'}}));process.exit(1);};
if(args[1]==='add'||args[1]==='default'){
 const verb=args[1];if(doc.failure===verb+'-before')fail();
 if(doc.localTeams===false){console.log(JSON.stringify({schemaVersion:1,ok:false,error:{code:'E_WORKSPACE_SCHEMA',details:{reason:'local-teams-closed'}}}));process.exit(1);}
 const label=args[2],team=args.find(a=>a.startsWith('--team='))?.slice(7);
 if(verb==='add'){
  if(doc.teams.some(r=>r.label===label))fail();
  doc.teams.push({label,team,from:'local'});
  if(doc.defaultTeam===null)doc.defaultTeam={label,team,from:'deployment'};
 }else{const row=doc.teams.find(r=>r.label===label);if(!row)fail();doc.defaultTeam={label,team:row.team,from:'deployment'};}
 doc.lastMutation=verb;fs.writeFileSync(file,JSON.stringify(doc));
 if(doc.failure===verb+'-after')fail();
 console.log(JSON.stringify({schemaVersion:1,ok:true,result:{changed:true}}));
}else{
 if(doc.failure==='query'||doc.failure==='readback-'+doc.lastMutation)fail();
 console.log(JSON.stringify({schemaVersion:1,ok:true,result:doc}));
}
`);
  return { cli, state, read: () => JSON.parse(readFileSync(state, 'utf8')), set: value => writeFileSync(state, JSON.stringify(value)), calls: () => existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [] };
}
