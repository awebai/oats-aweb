import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readWakeStatus} from '../oats-package/capabilities/oats-aweb-tasks/lib/claim-floors.mjs';
import {AW_UNSET_ENV} from '../oats-package/capabilities/oats-aweb/lib/aw-child-env.mjs';
import {AW_UNSET_ENV as TASKS_UNSET_ENV} from '../oats-package/capabilities/oats-aweb-tasks/lib/aw-child-env.mjs';

test('tasks native wake child strips the same selectors and keeps its stricter OATS scrub', t => {
  const base = mkdtempSync(join(tmpdir(), 'tasks-aw-env-'));
  t.after(() => rmSync(base, {recursive: true, force: true}));
  const bin = join(base, 'bin'), log = join(base, 'env.json'); mkdirSync(bin);
  writeFileSync(join(bin, 'aw'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.env)); console.log('{"daemon_running":true}');\n`);
  chmodSync(join(bin, 'aw'), 0o755);
  const env = {HOME: base, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, OATS_HOME: '/caller', SAFE_MARKER: 'keep', ...Object.fromEntries(AW_UNSET_ENV.map(k => [k, 'caller']))};
  assert.deepEqual(readWakeStatus({cwd: base, timeout: 2000, env}), {daemon_running: true});
  const got = JSON.parse(readFileSync(log, 'utf8'));
  for (const k of AW_UNSET_ENV) assert.equal(got[k], undefined, k);
  assert.equal(got.OATS_HOME, undefined); assert.equal(got.SAFE_MARKER, 'keep'); assert.equal(got.AW_NO_UPDATE_CHECK, '1');
});


test('the independently materialized tasks selector list equals messaging', t => {
  assert.deepEqual(TASKS_UNSET_ENV, AW_UNSET_ENV);
  const base=mkdtempSync(join(tmpdir(),'tasks-aw-isolated-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const capability=join(base,'tasks');
  cpSync(resolve('oats-package/capabilities/oats-aweb-tasks'),capability,{recursive:true});
  const moduleUrl=pathToFileURL(join(capability,'lib','claim-floors.mjs')).href;
  const r=spawnSync(process.execPath,['--input-type=module','-e',`import {readWakeStatus} from ${JSON.stringify(moduleUrl)}; console.log(typeof readWakeStatus);`],{cwd:base,env:{HOME:base,PATH:'/usr/bin:/bin'},encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.stdout.trim(),'function');
});
