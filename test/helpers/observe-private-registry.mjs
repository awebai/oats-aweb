// CI diagnostic boundary: preserve native argv/env/output/exit, recording only
// whether init --join-from reported one known private-registry refusal.
import { join } from 'node:path';
import { unlinkSync, writeFileSync } from 'node:fs';

export function observePrivateRegistryAw(directory, nativeAw) {
  const observer = join(directory, 'observe-private-registry.cjs');
  const log = join(directory, 'join-private-registry.jsonl');
  writeFileSync(observer, `const { spawn } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const child = spawn(${JSON.stringify(nativeAw)}, process.argv.slice(2), { stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
let stdout = '', stderr = '';
child.stdout.on('data', data => { stdout += data; process.stdout.write(data); });
child.stderr.on('data', data => { stderr += data; process.stderr.write(data); });
const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
for (const signal of signals) process.on(signal, () => child.kill(signal));
child.on('error', () => { process.stderr.write('observed native aw failed to execute\\n'); });
child.on('close', (status, signal) => {
  // d36bfb9d awid/registry_pin.go:59,74,94. No raw output is persisted.
  const output = stdout + '\\n' + stderr;
  const refused = output.includes('a registry not named by AWID_REGISTRY_URL or the command line must use https')
    || output.includes('a registry not named by AWID_REGISTRY_URL or the command line must be named by host, not address')
    || (output.includes('resolves to an address that is not public') && output.includes('for a private self-hosted registry, name it with AWID_REGISTRY_URL'));
  appendFileSync(${JSON.stringify(log)}, JSON.stringify(refused) + '\\n', { mode: 0o600 });
  if (signal) { process.removeAllListeners(signal); process.kill(process.pid, signal); }
  else process.exitCode = status ?? 1;
});
`, { mode: 0o700 });
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  // Remove only this fixture's symlink before writing, never its native target.
  try { unlinkSync(join(directory, 'aw')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  writeFileSync(join(directory, 'aw'), `#!/bin/sh
if [ "$1" = init ]; then
  for argument in "$@"; do
    case "$argument" in
      --join-from|--join-from=*) exec ${quote(process.execPath)} ${quote(observer)} "$@" ;;
    esac
  done
fi
exec ${quote(nativeAw)} "$@"
`, { mode: 0o700 });
  return log;
}
