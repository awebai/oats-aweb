// Native LOCAL certificate reads, using the generated certificate shape from
// username-native.test.mjs. No server, signup, invite or remote account exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {fakeKernelTeamConfig} from './helpers/fake-kernel-team-config.mjs';

const HOOK=fileURLToPath(new URL('../oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs',import.meta.url));
const TEAM='joined:fixture.test',OTHER='other:fixture.test';
function key() {
  const pair=generateKeyPairSync('ed25519'),pub=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32);
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n=BigInt('0x'+Buffer.concat([Buffer.from([0xed,1]),pub]).toString('hex')),encoded='';
  while(n){encoded=alphabet[Number(n%58n)]+encoded;n/=58n;}
  return {...pair,did:'did:key:z'+encoded};
}

test('real aw tokenless setup selects its LOCAL root and refuses unreadable target membership',t=>{
  const selected=process.env.OATS_AWEB_TEST_AW;
  if(!selected) {
    assert.notEqual(process.env.OATS_SETUP_ROOT_NATIVE_REQUIRED,'1','set OATS_AWEB_TEST_AW to the selected aw executable');
    t.skip('requires an explicitly selected real aw');return;
  }
  const binary=realpathSync(resolve(selected));
  const base=realpathSync(mkdtempSync(join(tmpdir(),'setup-root-native-')));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const home=join(base,'home'),bin=join(base,'bin'),root=join(base,'default-root'),target=join(base,'.aweb-roots','joined');
  for(const dir of [home,bin,join(root,'.aw'),join(target,'.aw','team-certs')])mkdirSync(dir,{recursive:true});
  symlinkSync(binary,join(bin,'aw'));
  const env={HOME:home,PATH:`${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,XDG_CONFIG_HOME:join(home,'config'),XDG_CACHE_HOME:join(home,'cache'),TMPDIR:base,AW_NO_UPDATE_CHECK:'1'};
  const run=(command,args,cwd,extra={})=>spawnSync(command,args,{cwd,env:{...env,...extra},encoding:'utf8',timeout:15000});
  const version=run(binary,['version'],base);assert.equal(version.status,0,version.stderr);
  t.diagnostic(version.stdout.trim());
  const unreadable='memberships: [\n';writeFileSync(join(root,'.aw','teams.yaml'),unreadable);
  const member=key(),issuer=key();
  const certificate={version:1,certificate_id:randomUUID(),team_id:TEAM,team_did_key:issuer.did,member_did_key:member.did,
    alias:'fixture-root',identity_scope:'local',issued_at:new Date().toISOString().replace(/\.\d+Z$/,'Z')};
  certificate.signature=sign(null,Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(certificate).sort().map(k=>[k,certificate[k]])))),issuer.privateKey).toString('base64').replace(/=+$/,'');
  const certFile=join(target,'.aw','team-certs','joined__fixture.test.pem');
  writeFileSync(certFile,JSON.stringify(certificate),{mode:0o600});
  // Native format documented by lib/member-key.mjs: a 32-byte Ed25519 seed.
  const seed=member.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('base64');
  writeFileSync(join(target,'.aw','signing.key'),`-----BEGIN ED25519 PRIVATE KEY-----\n${seed}\n-----END ED25519 PRIVATE KEY-----\n`,{mode:0o600});
  writeFileSync(join(target,'.aw','identity.yaml'),`did: ${member.did}\ncustody: self\nidentity_scope: local\n`);
  writeFileSync(join(target,'.aw','teams.yaml'),`active_team: ${TEAM}\nmemberships:\n  - team_id: ${TEAM}\n    alias: fixture-root\n    cert_path: team-certs/joined__fixture.test.pem\n    aweb_url: https://service.example.invalid/api\n`);
  writeFileSync(join(target,'.aw','workspace.yaml'),'alias: fixture-root\naweb_url: https://service.example.invalid/api\n');
  writeFileSync(join(base,'oats-local.yaml'),'schemaVersion: 2\nworkspace: fixture\n');
  const kernel=fakeKernelTeamConfig(join(base,'kernel'),base,{
    teams:[{label:'other',team:OTHER,from:'local'},{label:'joined',team:TEAM,from:'local'}],
    defaultTeam:{label:'other',team:OTHER,from:'deployment'},
  });
  const cli=join(base,'oats.mjs');writeFileSync(cli,`#!${process.execPath}\nimport ${JSON.stringify(kernel.cli)};`,{mode:0o755});
  const absent=run(binary,['team','list','--json'],root);assert.equal(absent.signal,null);assert.notEqual(absent.status,0);
  const present=run(binary,['team','list','--json'],target);assert.equal(present.status,0,present.stdout+present.stderr);
  const admitted=run(binary,['--identity-home',join(target,'.aw'),'id','team','list','--json'],target);
  assert.equal(admitted.status,0,admitted.stdout+admitted.stderr);
  const hookEnv={OATS_EVENT:'setup',OATS_HOME:join(base,'instance'),OATS_TEAM_SCOPE:base,OATS_WORKSPACE:base,OATS_CLI_BIN:cli,
    OATS_DEFAULT_TEAM:'other',OATS_DEFAULT_TEAM_ID:OTHER,OATS_TEAMS:JSON.stringify([{label:'other',team:OTHER,default:true,from:'local'},{label:'joined',team:TEAM,from:'local'}]),OATS_SETTINGS:JSON.stringify({root})};
  const args=[HOOK,'setup','--join','joined','--name','fixture-root','--json'];
  const result=run(process.execPath,args,base,hookEnv);
  assert.equal(result.status,0,result.stdout+result.stderr);
  const doc=JSON.parse(result.stdout);assert.equal(doc.result.team,TEAM);assert.equal(doc.result.membershipVerified,true);
  assert.equal(kernel.read().defaultTeam.team,OTHER);
  assert.equal(readFileSync(join(root,'.aw','teams.yaml'),'utf8'),unreadable);
  const before=readFileSync(join(base,'oats-local.yaml'),'utf8'),cert=readFileSync(certFile,'utf8');
  writeFileSync(join(target,'.aw','teams.yaml'),unreadable);
  const refused=run(process.execPath,args,base,hookEnv);
  assert.equal(refused.status,1,refused.stdout+refused.stderr);
  assert.match(refused.stdout,/E_SETUP_MEMBERSHIP|could not check membership/);
  assert.equal(readFileSync(join(base,'oats-local.yaml'),'utf8'),before);assert.equal(readFileSync(certFile,'utf8'),cert);
  assert.equal(existsSync(join(target,'.aw','signing.key')),true);
  assert.equal(existsSync(join(home,'.awid')),false,'no registry identity or controller key was provisioned');
});
