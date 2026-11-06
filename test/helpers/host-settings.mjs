// A test deployment's host attribution, written into its oats-local.yaml by
// the provider's own writers, as the bind writes it.
import { recordAwebScalar, recordAwebSetting } from "../../oats-package/capabilities/oats-aweb/lib/local-settings.mjs";

/** Writes `human`, `steward` and then `attribution` from `settings`, each when present. */
export function writeHostSettings(deployment, settings) {
  for (const map of ["human", "steward"]) for (const [key, value] of Object.entries(settings[map] || {})) recordAwebSetting(map, key, value, { start: deployment });
  if (settings.attribution) recordAwebScalar("attribution", settings.attribution, { start: deployment });
}
