import { AW_MIN, AW_TESTED } from '../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs';
// Explicit next-version qualification, separate from the released support window.
export const AW_NEXT = '1.36.59-rc.6';
export const AW_TEST_VERSIONS = [...new Set([AW_MIN, AW_TESTED, AW_NEXT])];

/** The npm integrity of the pinned next aw, as its registry published it
 *  (`npm view @awebai/aw@<version> dist.integrity`): a prerelease is not on the
 *  released support window, so CI installs it only when it is these exact bytes
 *  (scripts/check-aw-integrity.mjs). The platform entry is the one CI runs on. */
export const AW_NEXT_INTEGRITY = Object.freeze({
  '@awebai/aw': 'sha512-mSA1saZgjeoYIDqD7/ZwHP8uAuzCN2iz+4vD+De78RoqhCw2bG2KGsGGNdCCep5XphNZqMLqeTTPiOwQRnD36Q==',
  '@awebai/aw-linux-x64': 'sha512-nK5iq+5Bty1nQ5jjr+6fiQ5YclNmfPKqRJf6YRLvNqY1hWfCyMMA+mF1QWR1cItymnkvf8HUo2i0DIAO2bU0iw==',
});
