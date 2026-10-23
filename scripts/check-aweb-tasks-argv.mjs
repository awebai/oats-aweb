import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const defaultSkill = new URL('../oats-package/capabilities/oats-aweb-tasks/skills/aweb-tasks/SKILL.md', import.meta.url);

// Extract documentation, never execute shell examples or interpolate their text.
export function documentedCommands(markdown) {
  const snippets = [];
  let inBash = false;
  for (const line of markdown.split('\n')) {
    if (/^```bash\s*$/.test(line)) { inBash = true; continue; }
    if (inBash && /^```\s*$/.test(line)) { inBash = false; continue; }
    if (inBash && /^aw\s/.test(line)) snippets.push(line);
    if (!inBash) {
      for (const match of line.matchAll(/`(aw(?:\s[^`\n]*)?)`/g)) snippets.push(match[1]);
    }
  }
  return snippets.map((example) => {
    const command = example.match(/\b(task|work|whoami)(?:\s+[a-z][a-z-]*)*/)?.[0];
    assert.ok(command, `Unsupported aw command example: ${example}`);
    return {
      example,
      path: command.split(/\s+/),
      flags: [...new Set(example.match(/--[a-z][a-z-]*/g) ?? [])],
    };
  });
}

export function checkSkillArgv(markdown, help) {
  const commands = documentedCommands(markdown);
  assert.ok(commands.length > 0, 'No documented commands found');
  const cache = new Map();
  const documentedFlags = new Set();
  for (const { example, path, flags } of commands) {
    const key = path.join(' ');
    if (!cache.has(key)) cache.set(key, help([...path, '--help']));
    const output = cache.get(key);
    // Cobra can print parent help for an unrecognized child; require exact usage.
    assert.ok(output.includes(`  aw ${key} `) || output.includes(`  aw ${key}\n`), `Command missing from help: ${example}`);
    const availableFlags = new Set(output.match(/--[a-z][a-z-]*/g) ?? []);
    for (const flag of flags) {
      assert.ok(availableFlags.has(flag), `${flag} missing from help for ${key}`);
      documentedFlags.add(flag);
    }
  }
  // Also check flags mentioned outside command examples against a verified use.
  for (const flag of markdown.match(/--[a-z][a-z-]*/g) ?? []) {
    assert.ok(documentedFlags.has(flag), `Flag has no verified example: ${flag}`);
  }
  return { examples: commands.length, helpCommands: cache.size, flags: documentedFlags.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = (args) => {
    const result = spawnSync('aw', args, {
      encoding: 'utf8',
      env: { ...process.env, AW_NO_UPDATE_CHECK: '1' },
      timeout: 10_000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr || `aw ${args.join(' ')} failed`);
    return result.stdout;
  };
  const version = run(['version']);
  assert.match(version, /^aw 1\.36\.47\n/, 'Run the recorded check with aw 1.36.47');
  const result = checkSkillArgv(readFileSync(defaultSkill, 'utf8'), run);
  console.log(`aw 1.36.47: verified ${result.examples} examples, ${result.helpCommands} help commands, ${result.flags} flags; no task writes`);
}
