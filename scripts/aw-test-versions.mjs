import { AW_MIN, AW_TESTED } from '../oats-package/capabilities/oats-aweb/lib/aw-floor.mjs';
// The tested aw before AW_TESTED: CI keeps running it after `tested` moves, so the
// release a deployment may still run stays qualified.
export const AW_PREVIOUS = '1.36.58';
// Explicit next-version qualification, separate from the released support window.
// It may equal AW_TESTED, as now (1.36.59); the set keeps one entry.
export const AW_NEXT = '1.36.59';
export const AW_TEST_VERSIONS = [...new Set([AW_MIN, AW_PREVIOUS, AW_TESTED, AW_NEXT])];

/** The npm integrity of the pinned next aw, as its registry published it
 *  (`npm view @awebai/aw@<version> dist.integrity`): CI installs it only when it is
 *  these exact bytes (scripts/check-aw-integrity.mjs). The platform entry is the one
 *  CI runs on. */
export const AW_NEXT_INTEGRITY = Object.freeze({
  '@awebai/aw': 'sha512-FVkx3CSP+tlpfm3mGgqFQrICBQOqi8Emt1EX1VKR7P4whUL3BhemEpSGkSXeuCgtMipUSjAkvPWKQ+vqWxGztg==',
  '@awebai/aw-linux-x64': 'sha512-fIsZ64YK9yaB5jMjfdlHUHd+nG7Yvs/R3k+DHBX8YOA/KTU+DzsJfYqaPciqY0O8QLK54hipWFrHQqF3JRiRUg==',
});
