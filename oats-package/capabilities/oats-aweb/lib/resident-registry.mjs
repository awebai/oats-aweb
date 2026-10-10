// The awid registry a GLOBAL seat must verify against: the one its resident's
// identity records. A grant home pins no registry, so for an addressless
// sender aw falls back to AWID_REGISTRY_URL, else to its default registry,
// and mail from a resident on another registry reads as verification_stale.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { yamlScalar } from "./binding-wire.mjs";

// aw's default registry: awid.DefaultAWIDRegistryURL (aw 877bbee, awid/registry_dns.go:16).
const AW_DEFAULT_REGISTRY = "https://api.awid.ai";

/** The canonical origin of an http(s) server URL, by aw's own rules
 *  (canonicalRegistryServerOrigin, canonicalServerOrigin): no userinfo, query,
 *  fragment or path but `/` (`/api` for a registry), lowercase scheme and
 *  host, no default port. Throws why a value is not one. */
function registryServerOrigin(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("it is not a URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("its scheme is not http or https");
  if (url.username || url.password) throw new Error("it includes userinfo");
  if (url.search || url.hash) throw new Error("it includes a query or fragment");
  if (!["", "/", "/api", "/api/"].includes(url.pathname)) throw new Error("it includes a path");
  return url.origin;
}

/** The registry to give a seat on the resident whose custody directory is
 *  `custody`, from that resident's .aw/identity.yaml and nothing else:
 *  `{ env }`, with AWID_REGISTRY_URL set to the recorded value only when its
 *  origin differs from aw's default, or `{ env: {}, problem }` when the
 *  recorded value is not an http(s) origin, which is never passed on. */
export function residentRegistryEnv(custody) {
  let text;
  try { text = readFileSync(join(custody, ".aw", "identity.yaml"), "utf8"); } catch { return { env: {} }; }
  const recorded = yamlScalar(text, "registry_url");
  if (!recorded) return { env: {} };
  let origin;
  try { origin = registryServerOrigin(recorded); }
  catch (e) { return { env: {}, problem: `the resident's identity at ${join(custody, ".aw", "identity.yaml")} records registry_url ${JSON.stringify(recorded).slice(0, 200)}, which is not an http(s) registry origin (${e.message}); repair it there, else the seat verifies senders at aw's default registry` }; }
  return origin === AW_DEFAULT_REGISTRY ? { env: {} } : { env: { AWID_REGISTRY_URL: recorded } };
}
