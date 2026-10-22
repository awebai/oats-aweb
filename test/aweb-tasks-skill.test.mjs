import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkSkillArgv, documentedCommands } from '../scripts/check-aweb-tasks-argv.mjs';

const root = new URL('../', import.meta.url);
const skill = () => readFileSync(new URL('oats-package/capabilities/oats-aweb-tasks/skills/aweb-tasks/SKILL.md', root), 'utf8');
const inject = () => readFileSync(new URL('oats-package/capabilities/oats-aweb-tasks/injects/aweb-tasks.md', root), 'utf8');

test('tasks skill covers identity, claims, blockers, handoff, and safe text inputs', () => {
  const text = skill();
  for (const required of [
    'aw work ready', 'aw work active', 'aw work blocked',
    '--assignee', '--status', '--labels', '--description-file', '--notes-file',
    '--body-file', '--reason-file', '--type epic', '--parent', '--identity-home',
    'aw task dep add', 'aw task dep remove', 'aw task comment add',
    'aw task close', 'aw task reopen', 'workspace_id', '/v1/claims',
    '200', 'roster', 'human', 'fenced', 'data', 'messaging',
  ]) assert.ok(text.includes(required), `missing ${required}`);
  assert.doesNotMatch(text, /--(?:description|notes|reason|body)(?![\w-])/);
  assert.match(text, /--title "\$\(cat [^)]+\)"/);
  assert.match(text, /one line/);
  assert.match(text, /status open --assignee/);
  assert.match(text, /in_progress[\s\S]*actor/);
});

test('tasks inject routes only task coordination to its skill', () => {
  const text = inject();
  assert.match(text, /\/aweb-tasks/);
  assert.match(text, /instance home/);
  assert.match(text, /human/);
  assert.match(text, /messaging/);
});

test('tasks skill starts with identity verification and stops on failure', () => {
  const text = skill();
  assert.match(text.slice(text.indexOf('# aweb tasks')), /^# aweb tasks\s+First, run this read-only identity check from your instance home:\s+```bash\naw whoami\n```/);
  assert.match(text, /If it fails, report the exact failure to your human and do not use tasks/);
});

test('argv checker extracts examples and only requests help without example arguments', () => {
  const markdown = '```bash\naw --identity-home <identityHome> task create --title "$(cat /path/title.txt)" --description-file /path/description.md\n```\nAlso `aw work ready`.';
  const calls = [];
  const result = checkSkillArgv(markdown, (argv) => {
    calls.push(argv);
    if (argv[0] === 'task') return '  aw task create [flags]\n --identity-home string\n --title string\n --description-file string';
    return '  aw work ready [flags]';
  });
  assert.deepEqual(calls, [['task', 'create', '--help'], ['work', 'ready', '--help']]);
  assert.equal(result.examples, 2);
});

test('argv checker rejects unknown commands, flags and unverified prose flags', () => {
  const help = () => '  aw task list [flags]\n --status string';
  assert.throws(() => checkSkillArgv('`aw task nonexistent`', help), /Command missing/);
  assert.throws(() => checkSkillArgv('`aw task list --nonexistent x`', help), /missing from help/);
  assert.throws(() => checkSkillArgv('`aw task list` uses `--nonexistent`', help), /no verified example/);
  assert.ok(documentedCommands(skill()).length >= 20);
});

test('argv checker supports the read-only identity check through help only', () => {
  const calls = [];
  checkSkillArgv('```bash\naw whoami\n```', (argv) => {
    calls.push(argv);
    return '  aw whoami [flags]';
  });
  assert.deepEqual(calls, [['whoami', '--help']]);
});
