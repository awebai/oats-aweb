import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {unrevokedGrant} from '../oats-package/capabilities/oats-aweb/lib/seat-grants.mjs';

test('the printed recovery command preserves opaque receipt values as shell arguments', t => {
  const base = mkdtempSync(join(tmpdir(),'seat-grant-command-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const bin = join(base,'bin'), log = join(base,'args.json');
  mkdirSync(bin);
  writeFileSync(join(bin,'aw'),`#!${process.execPath}
require('node:fs').writeFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2)));
`,{mode:0o755});
  for (const [grant, team] of [
    ['grant-$(printf injected)', 'x:h$(printf injected)'],
    ["grant-'quoted'; value", "x:h'quoted; `printf injected`"],
    ['--help', 't:example.test'],
  ]) {
    const note = unrevokedGrant({grant,team,custody:base,expiresAt:'never'});
    const command = note.slice(note.indexOf(': run `')+7,note.lastIndexOf('` in '));
    const r = spawnSync('/bin/sh',['-c',command],{cwd:base,encoding:'utf8',env:{HOME:base,PATH:`${bin}:/usr/bin:/bin`}});
    assert.equal(r.status,0,r.stdout+r.stderr);
    assert.deepEqual(JSON.parse(readFileSync(log,'utf8')),['id','grant','revoke',`--team=${team}`,'--',grant]);
  }
});
