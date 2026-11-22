import { AW_MIN, AW_TESTED } from '../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs';
// Explicit next-version qualification, separate from the released support window.
export const AW_NEXT = '1.36.59-rc.4';
export const AW_TEST_VERSIONS = [...new Set([AW_MIN, AW_TESTED, AW_NEXT])];

/** The npm integrity of the pinned next aw, as its registry published it
 *  (`npm view @awebai/aw@<version> dist.integrity`): a prerelease is not on the
 *  released support window, so CI installs it only when it is these exact bytes
 *  (scripts/check-aw-integrity.mjs). The platform entry is the one CI runs on. */
export const AW_NEXT_INTEGRITY = Object.freeze({
  '@awebai/aw': 'sha512-hTnCK7+1Cgk9wSRVOaMCwepbCYqozRYyIkvLQNsZ8aGtnnrbLdzbn7WONPgfUfCXoXDb+nOHPjH21l08nhA9xQ==',
  '@awebai/aw-linux-x64': 'sha512-AxaBuPYee5//Ew6/j2sDI9eqm8FjAuEEQGK/TPBRAPf/Fby4vNyphX+CPVctOf4zj/hsTOb0ul29tVAfuL7ckA==',
});
