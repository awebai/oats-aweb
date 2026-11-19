// Prove the fixture's selected-kernel handoff without a real kernel or tmux.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScratchDeployment } from './helpers/scratch-deployment.mjs';
import { healthHost } from '../oats-package/capabilities/oats-aweb/lib/health-host.mjs';

test('scratch host readers execute the selected kernel even when oats is absent from PATH', async t => {
  const kernel = mkdtempSync(join(tmpdir(), 'scratch-selected-kernel-'));
  t.after(() => rmSync(kernel, { recursive: true, force: true }));
  mkdirSync(join(kernel, 'bin'));
  // The kernel CLI is an external process boundary. It provisions only a
  // minimal fixture file, then independently identifies its status response.
  writeFileSync(join(kernel, 'bin', 'oats.mjs'), `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [command, deployment] = process.argv.slice(2);
if (command === 'onboard') {
  mkdirSync(deployment, { recursive: true });
  writeFileSync(join(deployment, 'oats-local.yaml'), 'schemaVersion: 2\\nworkspace: local\\n');
  console.log(JSON.stringify({ ok: true }));
} else if (command === 'status') {
  console.log(JSON.stringify({ agents: [{ name: 'selected-kernel' }] }));
} else process.exit(97);
`);
  const scratch = createScratchDeployment({ kernel });
  t.after(() => scratch.dispose());
  const emptyPath = join(kernel, 'empty-path');
  mkdirSync(emptyPath);
  const host = healthHost({ deployment: scratch.deployment, env: { ...scratch.env, PATH: emptyPath } });
  assert.deepEqual(await host.status(), { agents: [{ name: 'selected-kernel' }] });
});
