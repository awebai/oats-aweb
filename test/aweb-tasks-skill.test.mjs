import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSkillArgv } from '../scripts/check-aweb-tasks-argv.mjs';

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
});

test('argv checker supports the read-only identity check through help only', () => {
  const calls = [];
  checkSkillArgv('```bash\naw whoami\n```', (argv) => {
    calls.push(argv);
    return '  aw whoami [flags]';
  });
  assert.deepEqual(calls, [['whoami', '--help']]);
});
