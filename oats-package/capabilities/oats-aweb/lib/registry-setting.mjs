// A saved aw URL is a locator. Only this operator-owned setting grants a
// process private-network registry access (aw rc.3 registry_pin.go).
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

export const REGISTRY_SETTING='settings.oats.aweb.registry';
export const REGISTRY_MIGRATION='registry-setting-required: record the operator pin with `oats aweb setup --registry <origin>` in the deployment, then restart each resident serve process by rerunning `oats aweb resident create <name>` and restart the wake daemon with `oats aweb wake install` in the operator shell. A saved identity.yaml or teams.yaml registry_url never grants private-network access.';
const invalid=detail=>{throw new Error(`${REGISTRY_SETTING}: ${detail}`);};
export function registryOrigin(settings={}) {
  if(!Object.hasOwn(settings,'registry')) return undefined;
  const raw=settings.registry;
  if(typeof raw!=='string'||!raw||/[\s\\\x00-\x1f\x7f]/.test(raw)) invalid('must be an absolute http/https origin without whitespace or backslashes');
  if(raw.includes('?')||raw.includes('#')) invalid('queries and fragments, including empty delimiters, are unsupported; use an http/https origin');
  // Inspect the original path before WHATWG normalization could erase /../.
  const parts=/^https?:\/\/([^/]+)(\/.*)?$/i.exec(raw);
  if(!parts) invalid('must be an absolute http/https origin');
  if(parts[1].includes('@')) invalid('userinfo is unsupported; use an origin without credentials');
  if(parts[2]&&parts[2]!=='/') invalid(parts[2].replace(/\/+$/, '')==='/api' ? '/api aliases are unsupported in this setting; give the bare origin (aw treats it as equivalent)' : 'path-prefixed registry URLs are unsupported; put the registry on its own hostname and give an origin with no path');
  let url;
  try {url=new URL(raw);} catch {invalid('must be an absolute http/https origin');}
  if(url.hostname.endsWith('.')) url.hostname=url.hostname.slice(0,-1);
  return url.origin;
}

/** Explicit pins go only to online commands. Version/help, offline doctors,
 * recorded team lists, local custody and wake control never need admission. */
export function registryCommand(args) {
  args=[...args];
  if(args[0]==='aw') args.shift();
  while(args[0]?.startsWith('--')) {
    const flag=args.shift();
    if(!flag.includes('=')) args.shift(); // --identity-home <path>
  }
  if(args.includes('--help')||args.includes('--offline')) return false;
  const [command,sub,action]=args;
  if(command==='init'||command==='whoami'||command==='heartbeat'||command==='mail'||command==='chat'||command==='status'||command==='status-host') return true;
  if(command==='workspace') return ['connect','delete','status'].includes(sub);
  if(command==='team') return sub==='invite';
  if(command==='id') return sub==='grant'||(sub==='team'&&action!=='list')||sub==='show';
  if(command==='doctor') return sub==='registry'&&args.includes('--online');
  return (command==='custody'&&sub==='serve')||(command==='wake'&&sub==='run');
}
export function registryEnv(settings,args) {
  const origin=registryOrigin(settings);
  return origin&&(!args||registryCommand(args))?{AWID_REGISTRY_URL:origin}:{};
}
/** POSIX shell text for an operator's retry command, never an argv or URL parser. */
export function registryShellAssignment(origin) {
  return `AWID_REGISTRY_URL='${origin.replace(/'/g,"'\\''")}'`;
}
export function registryMigration(settings,env=process.env,{custody}={}) {
  if(registryOrigin(settings)) return undefined;
  if(Object.hasOwn(env,'AWID_REGISTRY_URL')) return REGISTRY_MIGRATION;
  if(custody) {
    let text;
    try {text=readFileSync(join(custody,'.aw','identity.yaml'),'utf8');} catch {return undefined;}
    // Detection only: never turn a saved URL into an environment or a command.
    const raw=/^registry_url:[ \t]*(.*)$/m.exec(text)?.[1]?.trim();
    if(raw) {
      let url;
      try {url=new URL(raw.replace(/^['"]|['"]$/g,''));} catch {return REGISTRY_MIGRATION;}
      if(url.origin!=='https://api.awid.ai'||url.username||url.password||url.search||url.hash||!['/','/api','/api/'].includes(url.pathname)) return REGISTRY_MIGRATION;
    }
  }
  return undefined;
}
