import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Agents copy these examples literally: a fixed /tmp body file on a shared host
// lets one agent's draft go out in another's mail.
const root = fileURLToPath(new URL('../', import.meta.url));
const capabilities = join(root, 'oats-package/capabilities');
const markdown = (dir) => readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.md')).map((f) => join(dir, f));
const shipped = () => [
  join(root, 'README.md'),
  ...readdirSync(capabilities).flatMap((cap) => ['skills', 'injects'].flatMap((sub) => {
    try { return markdown(join(capabilities, cap, sub)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  })),
];

const TMP_FILE_FLAG = /--[a-z]+-file(?:\s+|=)["']?\/tmp\//;

test('the /tmp file-flag guard sees both flag forms', () => {
  for (const example of ['--body-file /tmp/draft', '--body-file=/tmp/draft', "--notes-file '/tmp/n'", '--body-file="/tmp/x.md"']) assert.match(example, TMP_FILE_FLAG, example);
  assert.doesNotMatch('--body-file <body-file>', TMP_FILE_FLAG);
});

test('no shipped skill, inject or README example writes a message or task body to a fixed /tmp path', () => {
  const files = shipped();
  assert.ok(files.length >= 6, 'the scan found the shipped markdown');
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, TMP_FILE_FLAG, `${file} passes a /tmp path to a file flag`);
    assert.doesNotMatch(text, /\/tmp\/[\w.-]+\.(?:md|txt)\b/, `${file} names a fixed /tmp file`);
  }
});

test('the documented draft recipe creates distinct owner-only disposable files', t => {
  const home = mkdtempSync(join(tmpdir(), 'aweb-draft-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const skill = readFileSync(join(capabilities, 'oats-aweb/skills/oats-aweb/SKILL.md'), 'utf8');
  const recipe = skill.split('\n').find(line => line.startsWith('(umask 077;'));
  assert.ok(recipe, 'the executable recipe is present');
  const run = () => {
    const r = spawnSync('/bin/sh', ['-c', recipe], { env: { PATH: '/usr/bin:/bin', OATS_INSTANCE_HOME: home }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const first = run(), second = run();
  assert.notEqual(first, second);
  const manifest = JSON.parse(readFileSync(join(capabilities, 'oats-aweb/oats.json'), 'utf8'));
  for (const file of [first, second]) {
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.ok(file.startsWith(home + '/'));
    assert.ok(manifest.retirement.disposable.home.includes(file.slice(home.length + 1).split('/')[0]));
  }
});
