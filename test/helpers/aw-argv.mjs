import { readFileSync } from 'node:fs';
const grammar = JSON.parse(readFileSync(new URL('../fixtures/aw-argv/grammar.json', import.meta.url), 'utf8')).commands;

// Embedded in CommonJS fake executables. Validate before any fixture side effect.
function checkAwArgv(args, commands, recordPath) {
  const original = args;
  const leadingFlags = [];
  if (args[0] === '--identity-home') { leadingFlags.push('--identity-home'); args = args.slice(2); }
  const command = Object.keys(commands).sort((a, b) => b.split(' ').length - a.split(' ').length).find(c => c.split(' ').every((word, i) => args[i] === word));
  const fail = (why) => { console.error('fake aw: ' + why + '; argv=' + JSON.stringify(original)); process.exit(2); };
  if (!command) fail('unknown command');
  const flags = commands[command];
  const seen = [...leadingFlags];
  for (let i = command.split(' ').length; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-') || arg === '-') continue;
    if (arg === '--') break;
    const name = arg.split('=')[0];
    if (!Object.hasOwn(flags, name)) fail('unknown flag ' + name);
    seen.push(name);
    if (flags[name] && !arg.includes('=')) {
      if (++i >= args.length) fail('missing value for ' + name);
    }
  }
  // The suites themselves exercise the hook's paths. Record flags, never fixture
  // tokens or private values, for a separate real-aw full-subcommand help check.
  const log = recordPath || process.env.OATS_TEST_AW_ARGV_LOG;
  if (log) require('node:fs').appendFileSync(log, JSON.stringify({ command, flags: [...new Set(seen)].sort() }) + '\n');
}
export const awArgvCheckSource = `(${checkAwArgv})`;
export const awGrammar = grammar;
export const fakeAwArgvCheck = (argsName) => `${awArgvCheckSource}(${argsName}, ${JSON.stringify(grammar)}, ${JSON.stringify(process.env.OATS_TEST_AW_ARGV_LOG)});`;
