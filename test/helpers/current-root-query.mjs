import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Controlled public JSON responses. Native calls remain the provider's real children.
export function currentRootQuery(dir, { home, deployment, settings, soul = 'dev', change = '' }) {
  const cli = join(dir, 'kernel-query.cjs'), calls = join(dir, 'kernel-query.jsonl');
  writeFileSync(cli, `const fs=require('node:fs');
const args=process.argv.slice(2), home=${JSON.stringify(home)}, deployment=${JSON.stringify(deployment)}, soul=${JSON.stringify(soul)};
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({args,cwd:process.cwd(),selectors:Object.keys(process.env).filter(k=>/^(OATS_|OAS_|PI_AGENT_)/.test(k))})+'\\n');
const isHome=args.includes('--home');
let doc={schemaVersion:1,ok:true,result:{subject:isHome?{kind:'instance',home,soul}:{kind:'soul',soul},workspace:{deployment},teamsSource:'live',problems:[],layers:{messaging:{id:'oats.aweb'}},capabilities:[{id:'oats.aweb',layer:'messaging',settings:${JSON.stringify(settings)},compatibility:{ok:true}}]}};
${change}
console.log(JSON.stringify(doc));
`);
  return { cli, calls };
}
