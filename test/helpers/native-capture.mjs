// CI-only capture of public wire observations, never an identity directory.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function nativeCapture(name, value, { version, commit, paths = {} } = {}) {
  const output = process.env.OATS_AWEB_CAPTURE_DIR;
  if (!output) return;
  assert.match(name, /^[a-z0-9-]+$/);
  const replacements = Object.entries(paths).sort((a, b) => b[0].length - a[0].length);
  const scrub = (v) => {
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v)
      .filter(([k]) => !/^(?:token|api_key|private_key|secret|signing_key|encryption_key)$/.test(k)).map(([k, item]) => [k, scrub(item)]));
    if (typeof v !== 'string') return v;
    assert.equal(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(v), false, 'private key material cannot enter a capture');
    for (const [from, to] of replacements) v = v.split(from).join(to);
    return v.replace(/aw_(?:sk|inv)_[A-Za-z0-9_-]+/g, '<redacted>');
  };
  const clean = scrub(value);
  mkdirSync(output, { recursive: true, mode: 0o700 });
  writeFileSync(join(output, `${name}.json`), JSON.stringify(clean, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(join(output, `${name}.provenance.json`), JSON.stringify({ aw: version, awCommit: commit, stackCommit: process.env.OATS_AWEB_CAPTURE_STACK_COMMIT, kernelCommit: process.env.OATS_AWEB_CAPTURE_KERNEL_COMMIT, packageCommit: process.env.OATS_AWEB_CAPTURE_PACKAGE_COMMIT, capture: name, source: 'disposable real aw and OSS stack in resident-journey', capturedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
}
