import { AW_MIN, AW_TESTED } from '../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs';
// Explicit next-version qualification, separate from the released support window.
export const AW_NEXT = '1.36.59';
export const AW_TEST_VERSIONS = [...new Set([AW_MIN, AW_TESTED, AW_NEXT])];

/** The npm integrity of the pinned next aw, as its registry published it
 *  (`npm view @awebai/aw@<version> dist.integrity`): a prerelease is not on the
 *  released support window, so CI installs it only when it is these exact bytes
 *  (scripts/check-aw-integrity.mjs). The platform entry is the one CI runs on. */
export const AW_NEXT_INTEGRITY = Object.freeze({
  '@awebai/aw': 'sha512-qZrYnWTZWi37ZKB4/49OxfjJZSL/vAXDDClcb5j7yab6ER3m7Qi3ZL14ufs8ukIEC79R4BsaUonWBlw4eb1oNQ==',
  '@awebai/aw-linux-x64': 'sha512-Q22hVg8COYeS4bBjmtoVMYg7BRgfzDbFuVpZ1NVVgg9lh9mAdTV202P8dnT+X5Ka14nOO/+xOT91/UB0o+dBHA==',
});
