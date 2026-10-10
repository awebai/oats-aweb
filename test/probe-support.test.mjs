import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, symlinkSync, mkdirSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {fixture} from './helpers/probe-fixture.mjs';
import {runProbe} from '../oats-package/capabilities/oats-aweb/lib/probe.mjs';
import {ProbeBudget} from '../oats-package/capabilities/oats-aweb/lib/probe-runtime.mjs';
import {projectWorkspaceService, readWorkspaceService} from '../oats-package/capabilities/oats-aweb/lib/probe-service.mjs';
import {PROBE_RELEASE_SUPPORT, qualifyProbeSupport, observeProbeMetadata, probeAwVersion, resolveProbeAw} from '../oats-package/capabilities/oats-aweb/lib/probe-support.mjs';
const native = readFileSync(new URL('./fixtures/probe/native-workspace-1.36.28.yaml', import.meta.url), 'utf8');
const url = 'https://app.aweb.ai/api', meta = 'https://app.aweb.ai/meta';
const metadata = {version: '0.0.1', build: {aweb_version: '1.27.12'}};
function configured(t, options = {}) {
  const f = fixture(t, options);
  for (const home of [join(f.root, '.aw'), join(f.home, '.aw')]) writeFileSync(join(home, 'workspace.yaml'), native);
  const binary = join(f.deployment, 'aw'); writeFileSync(binary, 'offline executable fixture', {mode: 0o700});
  const requests = [];
  f.deps.support = args => qualifyProbeSupport({...args, resolveAw: () => binary, observe: async (u, budget) => {budget.check();requests.push(u);return metadata;}, execute: async (cmd, argv, cap) => argv[0] === 'version' ? Buffer.from('aw 1.36.33\n  commit: 877bbee94ce45aa1ff103912bc9850556e61dfb4 (github.com/awebai/aw)\n  built:  2026-10-10T13:18:16Z\n') : args.execute(cmd, argv, cap)});
  return {...f, binary, requests};
}
test('released floors: probe-only origins and server floor, and the provider aw floor', () => assert.deepEqual(PROBE_RELEASE_SUPPORT, {origins:['https://app.aweb.ai'],cliFloor:'1.36.33',serverFloor:'1.27.12'}));
test('native-generated service projection and qualified scalar variants', () => {
  assert.equal(projectWorkspaceService(native), url);
  for (const v of [url, `"${url}"`, `'${url}'`]) assert.equal(projectWorkspaceService(native.replace(url,v)),url);
});
for (const [name, text] of Object.entries({missing:native.replace(/^aweb_url:.*\n/,''), duplicate:`${native}aweb_url: ${url}\n`, quotedKey:native.replace('aweb_url:', '"aweb_url":'), alias:native.replace(url,'*url'), tag:native.replace(url,`!!str ${url}`), folded:native.replace(url,`>\n  ${url}`), literal:native.replace(url,`|\n  ${url}`), merge:`<<: *defaults\n${native}`, document:`---\n${native}`, continuation:native.replace(url,`${url}\n  hidden`), tab:native.replace('    -','\t-'), duplicateMember:native.replace('      alias: worker-1','      alias: worker-1\n      alias: other'), flow:`{aweb_url: "${url}"}`, multiline:`human_name: "unfinished\naweb_url: ${url}\n"`, oversized:'x'.repeat(65537)})) test(`ambiguous/unsupported config refuses ${name}`, () => assert.throws(()=>projectWorkspaceService(text),e=>e.reason==='selected-service-config-unavailable'));
test('workspace reader rejects symlink and directories without fallback', t => {
  const f=configured(t), file=join(f.root,'.aw','workspace.yaml');
  unlinkSync(file);symlinkSync(join(f.home,'.aw','workspace.yaml'),file);
  assert.throws(()=>readWorkspaceService(join(f.root,'.aw')));
  mkdirSync(join(f.deployment,'bad'));mkdirSync(join(f.deployment,'bad','workspace.yaml'));
  assert.throws(()=>readWorkspaceService(join(f.deployment,'bad')));
});
test('version text is anchored to released output, never JSON or prerelease',()=>{
  assert.equal(probeAwVersion('aw 1.36.28\n'), '1.36.28');
  for(const s of ['aw 1.36.28','v1.36.28\n','noise\naw 1.36.28\n','aw 1.36.28-dev\n','aw 01.36.28\n','{"version":"1.36.28"}','aw 1.36.28\naw 1.36.29\n']) assert.equal(probeAwVersion(s),null,s);
});
test('executable selection ignores relative/empty PATH entries and pins real path',t=>{
  const f=configured(t);assert.equal(resolveProbeAw(`.:relative::${f.deployment}`),f.binary);
  const bin=join(f.deployment,'bin');mkdirSync(bin);symlinkSync(f.binary,join(bin,'aw'));assert.equal(resolveProbeAw(bin),f.binary);
  assert.throws(()=>resolveProbeAw('.:relative:'),e=>e.reason==='probe-cli-unavailable');
});
test('actual admission composes with full offline reply proof',async t=>{
  const f=configured(t),r=await runProbe(f.args,f.deps);assert.equal(r.outcome,'PASS',r.reason);
  assert.deepEqual(f.requests,[meta]);assert.equal(r.diagnostics.versions.aw.version,'1.36.33');
  assert.equal(f.calls.filter(c=>c.args.includes('send')).length,1);
});
for(const [name,delta,expected] of [
 ['older CLI',{version:'aw 1.36.27\n'},'probe-cli-version-unsupported'],
 ['CLI below the provider floor',{version:'aw 1.36.29\n'},'probe-cli-version-unsupported'],
 ['malformed CLI',{version:'secret'},'probe-cli-version-unsupported'],
 ['version subprocess failure',{versionError:true},'probe-cli-version-unavailable'],
 ['older server',{metadata:{build:{aweb_version:'1.27.11'}}},null],
 ['top-level version only',{metadata:{version:'99.0.0'}},null],
 ['missing build',{metadata:{}},null],
 ['malformed version',{metadata:{build:{aweb_version:12712}}},null],
 ['prerelease',{metadata:{build:{aweb_version:'1.27.12-rc.1'}}},null],
 ['unavailable metadata',{metaError:true},null],
 ['foreign service',{url:'https://other.example/api'},null],
 ['http service',{url:'http://app.aweb.ai/api'},null],
 ['credentials',{url:'https://name:secret@app.aweb.ai/api'},null],
 ['query',{url:'https://app.aweb.ai/api?secret'},null],
 ['fragment',{url:'https://app.aweb.ai/api#secret'},null],
 ['wrong port',{url:'https://app.aweb.ai:444/api'},null],
 ['wrong path',{url:'https://app.aweb.ai/api/v1/release'},null],
 ['different target',{targetUrl:'https://other.example/api'},'selected-service-mismatch']
]) test(`admission refuses before send: ${name}`,async t=>{
 const f=configured(t);let reads=0,versions=0;
 if(delta.url)for(const home of [f.root,f.home])writeFileSync(join(home,'.aw','workspace.yaml'),native.replace(url,JSON.stringify(delta.url)));
 if(delta.targetUrl)writeFileSync(join(f.home,'.aw','workspace.yaml'),native.replace(url,delta.targetUrl));
 f.deps.support=args=>qualifyProbeSupport({...args,resolveAw:()=>f.binary,execute:async()=>{versions++;if(delta.versionError)throw Error('secret');return Buffer.from(delta.version??'aw 1.36.33\n');},observe:async()=>{reads++;if(delta.metaError)throw Error('secret');return delta.metadata??metadata;}});
 const r=await runProbe(f.args,f.deps);assert.equal(r.outcome,'FAIL');if(expected)assert.equal(r.reason,expected);else assert.match(r.reason,/^fresh-conversation support unknown\/unsupported on /);
 assert.equal(f.calls.filter(c=>c.args.includes('send')).length,0);assert(!JSON.stringify(r).includes('secret'));
 if(delta.version||delta.versionError||delta.url||delta.targetUrl)assert.equal(reads,0);
 if(delta.url||delta.targetUrl)assert.equal(versions,0);
});
for(const which of ['root','target','binary']) test(`drift ${which} after metadata refuses before send`,async t=>{
 const f=configured(t);f.deps.support=args=>qualifyProbeSupport({...args,resolveAw:()=>f.binary,execute:async()=>Buffer.from('aw 1.36.33\n'),observe:async()=>{
  if(which==='binary')writeFileSync(f.binary,'changed executable');else writeFileSync(join(which==='root'?f.root:f.home,'.aw','workspace.yaml'),native+'# changed\n');return metadata;
 }});
 const r=await runProbe(f.args,f.deps);assert.equal(r.reason,which==='binary'?'probe-cli-changed':'selected-service-config-changed');assert.equal(f.calls.filter(c=>c.args.includes('send')).length,0);
});
test('drift during identity reads refuses immediately before send',async t=>{
 let count=0;const f=configured(t,{onCall:({args})=>{if(args.includes('whoami')&&++count===2)writeFileSync(join(f.root,'.aw','workspace.yaml'),native+'# drift\n');}});
 const r=await runProbe(f.args,f.deps);assert.equal(r.reason,'selected-service-config-changed');assert.equal(f.calls.filter(c=>c.args.includes('send')).length,0);
});
function transport({status=200,body=JSON.stringify(metadata),hang=false,onRequest}={}){
 return (u,opts,callback)=>{onRequest?.(u,opts);const req=new EventEmitter();req.destroy=()=>{req.destroyed=true;};req.end=()=>{if(hang)return;queueMicrotask(()=>{const res=new PassThrough();res.statusCode=status;callback(res);res.end(body);});};return req;};
}
test('metadata transport requests only exact URL with no credentials/redirects',async()=>{
 const value=await observeProbeMetadata(meta,new ProbeBudget(1),transport({onRequest:(u,opts)=>{assert.equal(u,meta);assert.deepEqual(opts,{method:'GET',agent:false,rejectUnauthorized:true,headers:{accept:'application/json'}});}}));assert.equal(JSON.stringify(value),JSON.stringify(metadata));
 for(const status of [301,302,307,308,401,404,500])await assert.rejects(observeProbeMetadata(meta,new ProbeBudget(1),transport({status})));
});
test('metadata body is bounded and parsed strictly',async()=>{
 for(const body of ['x'.repeat(65537),'{','{"build":{},"build":{}}','['.repeat(30)+']'.repeat(30)])await assert.rejects(observeProbeMetadata(meta,new ProbeBudget(1),transport({body})));
});
test('metadata deadline and cancellation destroy the request',async()=>{
 for(const cancel of [false,true]){
  let req;const c=new AbortController(),budget=new ProbeBudget(cancel?1:.02,{signal:c.signal});
  const request=(...args)=>{req=transport({hang:true})(...args);return req;};
  const promise=observeProbeMetadata(meta,budget,request);if(cancel)c.abort();await assert.rejects(promise);assert(req.destroyed);
 }
});
test('metadata expiration/cancellation remain total-budget reasons and cannot send',async t=>{
 for(const cancel of [false,true]){
  const f=configured(t),c=new AbortController();f.deps.signal=c.signal;
  f.deps.support=args=>qualifyProbeSupport({...args,resolveAw:()=>f.binary,execute:async()=>Buffer.from('aw 1.36.33\n'),observe:async()=>{if(cancel)c.abort();else args.budget.deadline=0;throw Error('secret');}});
  const r=await runProbe(f.args,f.deps);assert.equal(r.reason,cancel?'cancelled':'timeout');assert.equal(f.calls.filter(c=>c.args.includes('send')).length,0);
 }
});
