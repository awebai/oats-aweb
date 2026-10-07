// Both the CLI primitive and server freshness behavior need published, qualified
// contracts. This gate has no environment/flag bypass and never uses a canary send.
import {refuse} from './probe-runtime.mjs';

// Release-owner constants belong here only after publication and qualification.
export const PROBE_RELEASE_SUPPORT = null;

/** Exact selected service only. URL.origin strips /api without switching host;
 * credentials, query strings and fragments are never accepted as an authority. */
export function probeMetadataUrl(awebUrl) {
  let url;
  try { url = new URL(awebUrl); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['/', '/api', '/api/'].includes(url.pathname)) return null;
  return `${url.origin}/meta`;
}
function stableSemver(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
function atLeast(value, floor) {
  const v = stableSemver(value), f = stableSemver(floor);
  if (!v || !f) return false;
  for (let i = 0; i < 3; i++) if (v[i] !== f[i]) return v[i] > f[i];
  return true;
}
/** Pure offline projection, not a live service observation. Future admission
 * must supply metadata fetched from this exact URL with the total budget and
 * no cross-origin redirects, plus the exact CLI binary's version observation. */
export function projectProbeSupport({awebUrl, cliVersion, metadata, observedUrl, policy = PROBE_RELEASE_SUPPORT}) {
  const metadataUrl = probeMetadataUrl(awebUrl);
  const origin = metadataUrl ? new URL(metadataUrl).origin : null;
  const supported = !!(metadataUrl && policy && Array.isArray(policy.origins) && policy.origins.includes(origin) && observedUrl === metadataUrl && atLeast(cliVersion, policy.cliFloor) && atLeast(metadata?.build?.aweb_version, policy.serverFloor));
  return {supported, origin, metadataUrl, reason: supported ? null : `fresh-conversation support unknown/unsupported on ${origin ?? 'unknown origin'}`};
}
export async function qualifyProbeSupport() {
  // The source for the exact selected service and the shipped allowlist/floors
  // are not frozen. Do not turn a fake projection into production admission.
  refuse('probe-cli-and-server-support-unqualified');
}
