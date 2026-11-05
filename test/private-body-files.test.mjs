import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
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

test('the oats-aweb draft recipe makes a unique owner-only file in a home entry retirement drops', () => {
  const skill = readFileSync(join(capabilities, 'oats-aweb/skills/oats-aweb/SKILL.md'), 'utf8');
  const recipe = skill.match(/^\(umask 077; mkdir -p "\$\{OATS_INSTANCE_HOME:\?\}\/([^/"]+)\/drafts" && mktemp "\$OATS_INSTANCE_HOME\/\1\/drafts\/(X+)"\)$/m);
  assert.ok(recipe, 'section 3 carries the draft recipe');
  assert.ok(recipe[2].length >= 6, 'enough random characters, and the X run ends the template (BSD mktemp)');
  const manifest = JSON.parse(readFileSync(join(capabilities, 'oats-aweb/oats.json'), 'utf8'));
  assert.ok(manifest.retirement.disposable.home.includes(recipe[1]), `${recipe[1]} is declared disposable, so retirement neither fingerprints nor copies drafts`);
  for (const example of skill.matchAll(/--body-file(?:\s+|=)(\S+)/g)) assert.equal(example[1], '<body-file>');
});
