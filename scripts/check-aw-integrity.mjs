// usage: node scripts/check-aw-integrity.mjs <npm install prefix> <aw version>
// For the pinned next aw (AW_NEXT), the npm install under <prefix> must hold exactly
// the published bytes in AW_NEXT_INTEGRITY: the wrapper and this host's platform
// package, by their lockfile integrity. Any other version passes through: released
// versions are the support window's, installed by exact version.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AW_NEXT, AW_NEXT_INTEGRITY } from './aw-test-versions.mjs';

export function checkAwIntegrity(prefix, version, { platform = process.platform, arch = process.arch } = {}) {
  if (version !== AW_NEXT) return [];
  const lock = JSON.parse(readFileSync(join(prefix, 'package-lock.json'), 'utf8'));
  const checked = [];
  for (const name of ['@awebai/aw', `@awebai/aw-${platform}-${arch}`]) {
    const pinned = AW_NEXT_INTEGRITY[name];
    assert.ok(pinned, `no pinned integrity for ${name}@${version}; add it to scripts/aw-test-versions.mjs from npm view ${name}@${version} dist.integrity`);
    const entry = lock.packages?.[`node_modules/${name}`];
    assert.equal(entry?.version, version, `${name} installed is not ${version}`);
    assert.equal(entry.integrity, pinned, `${name}@${version} is not the pinned bytes`);
    checked.push(name);
  }
  return checked;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checked = checkAwIntegrity(process.argv[2], process.argv[3]);
  console.log(checked.length ? `aw ${process.argv[3]}: pinned integrity holds for ${checked.join(', ')}` : `aw ${process.argv[3]}: a released version, no pin to check`);
}
