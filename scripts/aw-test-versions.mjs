import { AW_MIN, AW_TESTED } from '../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs';
// Explicit next-version qualification, separate from the released support window.
export const AW_NEXT = '1.36.59-rc.5';
export const AW_TEST_VERSIONS = [...new Set([AW_MIN, AW_TESTED, AW_NEXT])];

/** The npm integrity of the pinned next aw, as its registry published it
 *  (`npm view @awebai/aw@<version> dist.integrity`): a prerelease is not on the
 *  released support window, so CI installs it only when it is these exact bytes
 *  (scripts/check-aw-integrity.mjs). The platform entry is the one CI runs on. */
export const AW_NEXT_INTEGRITY = Object.freeze({
  '@awebai/aw': 'sha512-apLTsVk9mfYNu9rILnwweeVU12EfgDu0McPkEb3Amx4lCXFodKP8KkwcTjpuHr/nnz5OtDfQ6IEG1WX8v4bO3g==',
  '@awebai/aw-linux-x64': 'sha512-2PAtHVgK+5nXPFT+7muve4KswCaEkU4K4g1A18uioUhWwx4CcKlUXHlxojq+gRmJtgMx1JgH3n4VtU1PcjrWHA==',
});
