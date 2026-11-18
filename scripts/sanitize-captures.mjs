// Public CLI output only. Fail rather than log or upload private material.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function sanitizeCaptures(root, env = process.env) {
  for (const name of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!name.isFile()) continue;
    const path = join(name.parentPath, name.name);
    assert.match(name.name, /\.(?:json|yaml|stdout|stderr|exit|txt)$/);
    let text = readFileSync(path, 'utf8');
    // Boolean assertions deliberately exclude the original text from errors.
    assert.equal(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text), false, `${path} contains a private key`);
    assert.equal(/"(?:api_key|private_key|secret|token)"\s*:\s*"[^"\s]+"/.test(text), false, `${path} contains a credential field`);
    assert.equal(/(?:^|\n)\s*(?:api_key|private_key|secret|token):\s*\S+/.test(text), false, `${path} contains a YAML credential field`);
    text = text.replace(/aw_(?:sk|inv)_[A-Za-z0-9_-]+/g, '<redacted>');
    for (const [from, to] of [[env.RUNNER_TEMP, '/fixture/capture'], [env.GITHUB_WORKSPACE, '/fixture/repo']]) if (from) text = text.split(from).join(to);
    writeFileSync(path, text);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  sanitizeCaptures(resolve(process.argv[2]));
  console.log('Sanitized public native captures; no credential fields or private keys.');
}
