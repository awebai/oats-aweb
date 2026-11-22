import { AW_MIN, AW_TESTED } from '../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs';
// Explicit next-version qualification, separate from the released support window.
export const AW_NEXT = '1.36.59-rc.6';
export const AW_TEST_VERSIONS = [...new Set([AW_MIN, AW_TESTED, AW_NEXT])];
